import { t } from '../i18n';
import { ArrowLeft, FileText, LayoutGrid, Tags, Upload } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { pdfjs } from '../io/extract';
import { listPdfs, pdfLink, progress, updatePdfMeta } from '../pdf/library';
import { useApp, useAsync } from '../state';
import { mediaUrl } from '../ui/background';
import { Bar, Empty, PageTitle } from '../ui/kit';
import { checksum } from '../vault/util';
import { PdfViewer } from './pdf';

const THUMBS = '.app/cache/pdf-thumbs';

/** Sección «PDFs» (Prompt 5 · C): biblioteca y visor. Rutas: #/pdfs y #/pdfs/ver/<ruta>?p=N */
export function Pdfs(props: { route: string[] }) {
  const [sub, ...rest] = props.route;
  if (sub === 'ver' && rest.length) {
    const page = Number(/[?&]p=(\d+)/.exec(location.hash)?.[1] ?? 0) || undefined;
    return <PdfScreen path={rest.join('/')} page={page} />;
  }
  return <Library />;
}

function PdfScreen(p: { path: string; page?: number }) {
  const name = p.path.split('/').pop()!.replace(/\.pdf$/i, '');
  return (
    <div class="stack-s">
      <div class="row wrap glass panel" style={{ padding: '8px 12px' }}>
        <a class="btn small" href="#/pdfs"><ArrowLeft size={16} />{' '}{t('pdfs.biblioteca')}</a>
        <b class="grow ellipsis" data-user-content>{name}</b>
        <a class="btn small" href={`#/espacios/abrir/${encodeURIComponent(p.path)}`}><LayoutGrid size={16} />{' '}{t('pdfs.abrir_en_espacio')}</a>
      </div>
      <section class="glass strong pdf-full" aria-label={name}><PdfViewer key={p.path + (p.page ?? '')} path={p.path} page={p.page} /></section>
    </div>
  );
}

/** Miniatura de la primera página (en caché, se regenera si cambia el archivo). */
function Thumb(p: { path: string; size: number }) {
  const app = useApp();
  const { data: url } = useAsync(async () => {
    const key = `${THUMBS}/${checksum(new TextEncoder().encode(p.path + p.size))}.jpg`;
    if (await app.vault.exists(key)) return mediaUrl(app.vault, key, 'image/jpeg');
    const lib = await pdfjs();
    const d = await lib.getDocument({ data: (await app.vault.read(p.path)).slice() }).promise;
    const pg = await d.getPage(1);
    const v = pg.getViewport({ scale: 220 / pg.getViewport({ scale: 1 }).width });
    const c = document.createElement('canvas');
    c.width = Math.ceil(v.width);
    c.height = Math.ceil(v.height);
    await pg.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: v } as never).promise;
    void (d as unknown as { destroy?: () => Promise<void> }).destroy?.();
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.75));
    if (blob) await app.vault.write(key, new Uint8Array(await blob.arrayBuffer()));
    return blob ? URL.createObjectURL(blob) : null;
  }, [p.path, p.size]);
  return url ? <img src={url} alt="" loading="lazy" /> : <FileText size={36} aria-hidden="true" />;
}

function Library() {
  const app = useApp();
  const { data } = useAsync(() => listPdfs(app.vault), [app.version]);
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState('');
  const [tag, setTag] = useState('');
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const take = async (files: FileList | File[] | null) => {
    const pdfs = [...(files ?? [])].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    for (const f of pdfs) {
      let path = `docs/${f.name.replace(/[\\/:*?"<>|#]+/g, '_')}`;
      for (let n = 2; await app.vault.exists(path); n++) path = `docs/${f.name.replace(/\.pdf$/i, '')} (${n}).pdf`;
      await app.vault.write(path, new Uint8Array(await f.arrayBuffer()));
    }
    if (pdfs.length) (app.changed(), app.toast(t('pdfs.n_importados', { n: pdfs.length })));
  };
  useEffect(() => { if (input.current) input.current.value = ''; }, [data]);
  const folders = [...new Set(data?.map((x) => x.folder).filter(Boolean))].sort();
  const tags = [...new Set(data?.flatMap((x) => x.meta.tags ?? []))].sort();
  const f = q.trim().toLowerCase();
  const list = (data ?? []).filter((x) => (!f || x.name.toLowerCase().includes(f)) && (!folder || x.folder === folder) && (!tag || x.meta.tags?.includes(tag))).sort((a, b) => (b.meta.opened ?? 0) - (a.meta.opened ?? 0) || a.name.localeCompare(b.name));
  return (
    <div class={`stack${over ? ' drop-over' : ''}`} onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={(e) => { e.preventDefault(); setOver(false); void take(e.dataTransfer?.files ?? null); }}>
      <PageTitle title={t('pdfs.pdfs')} sub={t('pdfs.sub', { n: data?.length ?? 0 })}>
        <label class="btn primary"><Upload size={18} />{' '}{t('pdfs.importar')}<input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => void take((e.target as HTMLInputElement).files)} /></label>
      </PageTitle>
      {!data?.length ? (
        <Empty icon={<FileText size={44} />} title={t('pdfs.vacia')}>{t('pdfs.vacia_sub')}</Empty>
      ) : (
        <>
          <div class="row wrap glass" style={{ padding: '6px 12px', borderRadius: 'var(--r-pill)' }}>
            <input class="input grow" type="search" value={q} placeholder={t('pdfs.buscar')} aria-label={t('pdfs.buscar')} onInput={(e) => setQ((e.target as HTMLInputElement).value)} style={{ border: 0, background: 'transparent' }} />
            {folders.length > 0 && <select aria-label={t('pdfs.carpeta')} value={folder} onChange={(e) => setFolder((e.target as HTMLSelectElement).value)}><option value="">{t('pdfs.todas_las_carpetas')}</option>{folders.map((x) => <option>{x}</option>)}</select>}
            {tags.length > 0 && <select aria-label={t('notes.etiqueta')} value={tag} onChange={(e) => setTag((e.target as HTMLSelectElement).value)}><option value="">{t('notes.todas_las_etiquetas')}</option>{tags.map((x) => <option>{x}</option>)}</select>}
          </div>
          <div class="pdf-grid">
            {list.map((x) => (
              <div class="pdf-card glass">
                <a class="pdf-cover" href={pdfLink(x.path)} aria-label={t('pdfs.abrir_x', { name: x.name })}><Thumb path={x.path} size={x.size} /></a>
                <div class="stack-s" style={{ padding: '8px 10px 10px', minWidth: 0 }}>
                  <a href={pdfLink(x.path)} class="ellipsis" style={{ fontWeight: 600, textDecoration: 'none' }} data-user-content>{x.name}</a>
                  <span class="foot ellipsis">{x.folder || 'docs'}{x.meta.pages ? ` · ${t('pdfs.pag_de', { a: x.meta.last ?? 1, b: x.meta.pages })}` : ''}</span>
                  <Bar value={progress(x.meta)} label={t('pdfs.progreso_x', { name: x.name })} />
                  <div class="row wrap" style={{ gap: '4px' }}>
                    {(x.meta.tags ?? []).map((g) => <span class="chip">#{g}</span>)}
                    <button type="button" class="btn icon small ghost" aria-label={t('pdfs.etiquetas_x', { name: x.name })} onClick={async () => { const v = prompt(t('pdfs.etiquetas_prompt'), (x.meta.tags ?? []).join(', ')); if (v === null) return; await updatePdfMeta(app.vault, x.path, { tags: v.split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean) }); app.changed(); }}><Tags size={14} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <p class="foot">{t('pdfs.nota')}</p>
    </div>
  );
}
