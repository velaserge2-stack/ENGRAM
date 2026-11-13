import { errMsg, t } from '../i18n';
import { formatBytes, storageInfo } from '../lib/storage';
import { ArrowLeft, FileText, LayoutGrid, Tags, Upload, X } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { fileOf, openPdfFile } from '../pdf/open';
import { listPdfs, pdfLink, progress, updatePdfMeta } from '../pdf/library';
import { useApp, useAsync } from '../state';
import { acquireMediaUrl, releaseMediaUrl } from '../ui/background';
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

/**
 * Miniaturas de la biblioteca (Prompt 11 · Fase 4): en caché (`THUMBS`, se regenera si cambia el
 * archivo), y si falta, se genera solo cuando la tarjeta es visible, de una en una (cola), leyendo
 * por rangos (nunca el PDF entero).
 */
let thumbQ: Promise<unknown> = Promise.resolve();
const thumbKey = (path: string, size: number) => `${THUMBS}/${checksum(new TextEncoder().encode(path + size))}.jpg`;
async function renderThumb(vault: ReturnType<typeof useApp>['vault'], path: string, file: Blob): Promise<Blob | null> {
  const { doc, destroy } = await openPdfFile(file);
  try {
    const pg = await doc.getPage(1);
    const v = pg.getViewport({ scale: 220 / pg.getViewport({ scale: 1 }).width });
    const c = document.createElement('canvas');
    c.width = Math.ceil(v.width);
    c.height = Math.ceil(v.height);
    await pg.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: v } as never).promise;
    pg.cleanup();
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.75));
    c.width = c.height = 0; // Safari libera la memoria del lienzo solo así
    if (blob) await vault.write(thumbKey(path, file.size), new Uint8Array(await blob.arrayBuffer()));
    return blob;
  } finally {
    await destroy();
  }
}
/** En cola (una a la vez). Al importar se llama con el File que ya está a mano. */
function thumbFromFile(vault: ReturnType<typeof useApp>['vault'], path: string, file: Blob): Promise<Blob | null> {
  const job = thumbQ.then(() => renderThumb(vault, path, file)).catch(() => null);
  thumbQ = job;
  return job;
}

function Thumb(p: { path: string; size: number }) {
  const app = useApp();
  const ref = useRef<HTMLSpanElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true, own: string | null = null, loaned: string | null = null;
    const io = new IntersectionObserver(([e]) => {
      if (!e!.isIntersecting) return;
      io.disconnect();
      void (async () => {
        const key = thumbKey(p.path, p.size);
        if (await app.vault.exists(key)) {
          // préstamo (no fijada): se devuelve al desmontar y la URL se libera si nadie más la usa
          const u = await acquireMediaUrl(app.vault, key, 'image/jpeg');
          if (!alive) return void releaseMediaUrl(key);
          loaned = key;
          return setUrl(u);
        }
        const blob = await thumbFromFile(app.vault, p.path, await fileOf(app.vault, p.path));
        if (blob && alive) setUrl((own = URL.createObjectURL(blob)));
      })().catch(() => {});
    }, { rootMargin: '200px' });
    if (ref.current) io.observe(ref.current);
    return () => { alive = false; io.disconnect(); if (own) URL.revokeObjectURL(own); if (loaned) releaseMediaUrl(loaned); };
  }, [p.path, p.size]);
  return <span ref={ref} class="pdf-thumb-slot">{url ? <img src={url} alt="" loading="lazy" /> : <FileText size={36} aria-hidden="true" />}</span>;
}

function Library() {
  const app = useApp();
  const { data } = useAsync(() => listPdfs(app.vault), [app.version]);
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState('');
  const [tag, setTag] = useState('');
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Prompt 11: se escribe por trozos (nunca el archivo entero en memoria), con progreso y Cancelar
  const [job, setJob] = useState<{ name: string; done: number; total: number; i: number; n: number; ac: AbortController } | null>(null);
  const take = async (files: FileList | File[] | null) => {
    const pdfs = [...(files ?? [])].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!pdfs.length || job) return;
    const need = pdfs.reduce((a, f) => a + f.size, 0);
    const info = await storageInfo();
    if (info.quota && info.usage !== null && info.quota - info.usage < need * 1.05) {
      return app.toast(t('pdfs.sin_espacio', { need: formatBytes(need), left: formatBytes(info.quota - info.usage) }));
    }
    const ac = new AbortController();
    let ok = 0;
    try {
      for (const [i, f] of pdfs.entries()) {
        let path = `docs/${f.name.replace(/[\\/:*?"<>|#]+/g, '_')}`;
        for (let n = 2; await app.vault.exists(path); n++) path = `docs/${f.name.replace(/\.pdf$/i, '')} (${n}).pdf`;
        setJob({ name: f.name, done: 0, total: f.size, i: i + 1, n: pdfs.length, ac });
        await app.vault.writeStream(path, f, { signal: ac.signal, onProgress: (done) => setJob((j) => j && { ...j, done }) });
        ok++;
        void thumbFromFile(app.vault, path, f); // miniatura ahora que el archivo está a mano
      }
    } catch (e) {
      const err = e as { name?: string; code?: string };
      app.toast(err.name === 'AbortError' ? t('pdfs.importacion_cancelada') : err.code === 'quota' || err.name === 'QuotaExceededError' ? t('pdfs.sin_espacio_corto') : errMsg(e));
    } finally {
      setJob(null);
    }
    if (ok) (app.changed(), app.toast(t('pdfs.n_importados', { n: ok })));
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
      {job && (
        <div class="glass panel stack-s pdf-import" role="status" aria-live="polite">
          <div class="row wrap"><b class="grow ellipsis" data-user-content>{job.name}</b><span class="foot num">{job.n > 1 ? `${job.i}/${job.n} · ` : ''}{formatBytes(job.done)} / {formatBytes(job.total)}</span>
            <button type="button" class="btn small" onClick={() => job.ac.abort()}><X size={16} />{' '}{t('pdfs.cancelar')}</button></div>
          <Bar value={job.total ? job.done / job.total : 0} label={t('pdfs.importando_x', { name: job.name })} />
          {job.total > 200 * 1048576 && <p class="foot">{t('pdfs.grande_nota', { size: formatBytes(job.total) })}</p>}
        </div>
      )}
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
