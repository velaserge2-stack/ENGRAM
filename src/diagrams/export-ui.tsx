// Hoja «Exportar» del editor de diagramas. Se carga con `import()` al pulsar el botón.
// Preparar → entregar: los `File` (SVG y PNG) se construyen al abrir; el toque solo llama a `navigator.share` (o descarga).
import { useEffect, useMemo, useState } from 'preact/hooks';
import { Download, Share2 } from 'lucide-preact';
import { t, tn } from '../i18n';
import { Sheet } from '../ui/kit';
import { diagramToPngBlob, diagramToSvg, exportLayout } from './export';
import { layoutLayered, layoutTree } from './layout';
import type { DiagramDoc } from './types';

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

type PdfPrep = { file: File; pages: number; mode: 'vector' | 'raster' } | { error: 'paginas' | 'tamano' | 'fallo' } | null;
type PdfOpts = { page: 'ajustar' | 'a4' | 'carta'; fit: 'una' | 'varias'; margin: number; title: string; date: boolean };

// `title`: título de la nota (opcional). El editor aún no lo pasa; `backdrop` no existe en la hoja, así que no se envía.
export function ExportSheet(props: { doc: DiagramDoc; src: string; onClose: () => void; title?: string }) {
  const { doc } = props;
  const [tab, setTab] = useState<'img' | 'pdf'>('img');
  const [o, setO] = useState<PdfOpts>({ page: 'ajustar', fit: 'una', margin: 12, title: props.title ?? '', date: false });
  const [pdf, setPdf] = useState<PdfPrep>(null);
  const svg = useMemo(() => diagramToSvg(doc, doc.kind === 'mapa' ? layoutTree(doc) : layoutLayered(doc, 'TB')), [doc]);
  const svgFile = useMemo(() => new File([svg], 'diagrama.svg', { type: 'image/svg+xml' }), [svg]);
  const [png, setPng] = useState<File | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    diagramToPngBlob(svg).then((b) => {
      if (!live) return;
      if (b) setPng(new File([b], 'diagrama.png', { type: 'image/png' }));
      else setFailed(true);
    }, () => live && setFailed(true));
    return () => { live = false; };
  }, [svg]);

  // PDF: el módulo se importa al elegir PDF; el File se construye aquí, antes del toque.
  useEffect(() => {
    if (tab !== 'pdf') return;
    let live = true;
    setPdf(null);
    (async () => {
      const { exportPdf, PdfExportError } = await import('./export-pdf');
      try {
        const { layout, measured } = exportLayout(doc, {});
        const r = await exportPdf(doc, layout, measured, {
          page: o.page, fit: o.fit, margin: o.margin, title: o.title.trim() || undefined, date: o.date ? new Date().toLocaleDateString() : undefined,
        });
        const name = (o.title.trim() || props.title || 'diagrama').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
        if (live) setPdf({ file: new File([r.blob], `${name}.pdf`, { type: 'application/pdf' }), pages: r.pages, mode: r.mode });
      } catch (e) {
        const code = e instanceof PdfExportError && (e.code === 'paginas' || e.code === 'tamano') ? e.code : 'fallo';
        if (live) setPdf({ error: code });
      }
    })();
    return () => { live = false; };
  }, [tab, doc, o.page, o.fit, o.margin, o.title, o.date]);

  const deliver = (file: File | null) => {
    if (!file) return;
    // dentro del gesto, con el File ya construido
    if ('share' in navigator && 'canShare' in navigator && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch((e: Error) => { if (e.name !== 'AbortError') download(file); });
    } else download(file);
  };

  const Btn = (p: { file: File | null; label: string }) => (
    <button type="button" class="btn primary" style={{ minHeight: '44px' }} disabled={!p.file} onClick={() => deliver(p.file)}>
      {'share' in navigator ? <Share2 size={18} aria-hidden="true" /> : <Download size={18} aria-hidden="true" />} {p.label}
    </button>
  );

  const set = <K extends keyof PdfOpts>(k: K, v: PdfOpts[K]) => setO((x) => ({ ...x, [k]: v }));
  const err = pdf && 'error' in pdf ? pdf.error : null;
  const ready = pdf && 'file' in pdf ? pdf : null;
  const sel = (label: string, value: string, opts: [string, string][], on: (v: string) => void) => (
    <label class="stack-s">{label}
      <select class="input" style={{ minHeight: '44px' }} value={value} onChange={(e) => on((e.currentTarget as HTMLSelectElement).value)}>
        {opts.map(([v, l]) => <option value={v}>{l}</option>)}
      </select>
    </label>
  );
  const previewUrl = useMemo(() => (png ? URL.createObjectURL(png) : ''), [png]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  return (
    <Sheet title={t('diag.exportar')} onClose={props.onClose}>
      <div class="stack-s">
        <div class="row wrap">
          <Btn file={svgFile} label={t('diag.svg')} />
          {!failed && <Btn file={png} label={t('diag.png')} />}
          <button type="button" class="btn" style={{ minHeight: '44px' }} aria-pressed={tab === 'pdf'} onClick={() => setTab(tab === 'pdf' ? 'img' : 'pdf')}>{t('diag.pdf')}</button>
        </div>
        {tab === 'pdf' && (
          <div class="stack-s exp-pdf">
            {sel(t('diag.pdf_tamano'), o.page, [['ajustar', t('diag.pdf_ajustar')], ['a4', t('diag.pdf_a4')], ['carta', t('diag.pdf_carta')]], (v) => set('page', v as PdfOpts['page']))}
            {o.page !== 'ajustar' && sel('', o.fit, [['una', t('diag.pdf_una_pagina')], ['varias', t('diag.pdf_varias_paginas')]], (v) => set('fit', v as PdfOpts['fit']))}
            {sel(t('diag.pdf_margen'), String(o.margin), [0, 12, 24, 36].map((m) => [String(m), `${m} pt`]), (v) => set('margin', +v))}
            <label class="stack-s">{t('diag.pdf_titulo')}
              <input class="input" style={{ minHeight: '44px', fontSize: '16px' }} value={o.title} onInput={(e) => set('title', (e.currentTarget as HTMLInputElement).value)} data-user-content />
            </label>
            <label class="row"><input type="checkbox" checked={o.date} onChange={(e) => set('date', (e.currentTarget as HTMLInputElement).checked)} /> {t('diag.pdf_fecha')}</label>
            <div class="exp-prev" aria-live="polite">
              <b>{t('diag.pdf_vista_previa')}</b>
              {!pdf && <p>{t('diag.pdf_preparando')}</p>}
              {ready && <p>{tn('diag.pdf_paginas', ready.pages)}</p>}
              {previewUrl && <img src={previewUrl} alt="" style={{ maxWidth: '100%', maxHeight: '30dvh' }} />}
              {ready?.mode === 'raster' && <p role="status">{t('diag.pdf_imagen_aviso')}</p>}
              {err && err !== 'fallo' && <p role="alert">{t(`diag.pdf_err_${err}`)}</p>}
            </div>
            <button type="button" class="btn primary" style={{ minHeight: '44px' }} disabled={!ready} onClick={() => deliver(ready?.file ?? null)}>
              <Download size={18} aria-hidden="true" /> {t('diag.pdf_guardar')}
            </button>
          </div>
        )}
        {(failed || err === 'fallo') && (
          <div class="stack-s" role="alert">
            <p>{err === 'fallo' ? t('diag.pdf_err_fallo') : t('diag.exportar_fallo')}</p>
            <textarea class="input code" readOnly style={{ minHeight: '30dvh', width: '100%' }} value={props.src} aria-label={t('diag.texto_fuente')} data-user-content />
          </div>
        )}
      </div>
    </Sheet>
  );
}
