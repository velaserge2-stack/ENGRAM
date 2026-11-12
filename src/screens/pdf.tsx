import { errMsg, t as tr } from '../i18n';
/**
 * Visor PDF (SPEC §10d + Prompt 5 · C): páginas renderizadas bajo demanda y liberadas fuera
 * de pantalla; escala ≤ 2× y tope de ~16 MP por lienzo (límite de Safari); capa de texto
 * seleccionable; búsqueda; continuo o por página; zoom; miniaturas; índice; última página
 * recordada. Anotar: resaltador inteligente (se ajusta a las líneas reales de texto),
 * subrayado, tachado, bolígrafo (motor de tinta compartido) y notas adhesivas, guardados APARTE
 * en `<pdf>.annots.json`; el PDF original no se modifica. Exportar PDF anotado (pdf-lib) o el
 * resumen de resaltados (.md).
 */
import { BookOpen, Columns2, Download, FileText, Highlighter, LayoutList, ListTree, Minus, PencilLine, Plus, Quote, Search, Sparkles, StickyNote, Strikethrough, Underline, X } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { pdfjs } from '../io/extract';
import { deliver } from '../io/share';
import { useApp } from '../state';
import { readTextOr } from '../vault/util';
import { Segmented, Sheet } from '../ui/kit';
import { CardForm } from './deck';
import { appendCard } from '../data/ops';
import { listNotes } from '../notes/model';
import { InkLayer, InkToolbar } from '../ink/InkLayer';
import { useInkTools } from '../ink/InkSurface';
import { History, type InkDoc, outline, svgPath } from '../ink/model';
import { type Annots, annotsPath, type CharBox, emptyPage, fingerprintFile, fromLegacy, legacyPath, type Mark, type MarkKind, marksToMarkdown, type PageAnn, parseAnnots, samePdf, snapToText } from '../pdf/annots';
import { pdfLink, updatePdfMeta } from '../pdf/library';
import { fileOf, openPdfFile } from '../pdf/open';
import { fitPixels, Heights, RenderQueue, visibleRange } from '../pdf/virtual';
import { perf } from '../lib/perf';

const MAX_PIXELS = 16_000_000;
type PDFDoc = Awaited<ReturnType<Awaited<ReturnType<typeof pdfjs>>['getDocument']>['promise']>;
type Act = { type: 'ink'; page: number } | { type: 'mark' | 'note'; page: number; id: string; item?: unknown };
const MARK_COLOR = '#ffd60a';

export function PdfViewer(props: { path: string; page?: number }) {
  const app = useApp();
  const [doc, setDoc] = useState<PDFDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [width, setWidth] = useState(600);
  const [zoom, setZoom] = useState(1);
  // Prompt 7 · 1: dentro del lienzo, el pellizco sobre el PDF es el zoom del PDF (lo envía el lienzo)
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const on = (e: Event) => setZoom((z) => Math.min(3, Math.max(0.5, +(z * (e as CustomEvent<{ f: number }>).detail.f).toFixed(3))));
    el.addEventListener('ownzoom', on);
    return () => el.removeEventListener('ownzoom', on);
  });
  // Prompt 7 · 2: siempre arranca «por página» (cambiar a continuo es manual y no se recuerda)
  const [mode, setMode] = useState<'scroll' | 'page'>('page');
  const [cur, setCur] = useState(props.page ?? 1);
  const [side, setSide] = useState<null | 'thumbs' | 'outline' | 'marks'>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<number[]>([]);
  const [ann, setAnn] = useState<Annots>({ v: 1, pdf: null, pages: {} });
  const [annotate, setAnnotate] = useState(false);
  const [markKind, setMarkKind] = useState<MarkKind>('highlight');
  const [sticky, setSticky] = useState(false);
  const [tools, setTools] = useInkTools();
  const [sel, setSel] = useState<{ text: string; page: number } | null>(null);
  const [mk, setMk] = useState<'card' | 'quote' | null>(null);
  const [exporting, setExporting] = useState<File | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const fp = useRef<{ size: number; hash: string } | null>(null);
  const hist = useRef(new Map<number, History>());
  const acts = useRef<{ undo: Act[]; redo: Act[] }>({ undo: [], redo: [] });
  const saveT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [, bump] = useState(0);
  // Prompt 11 · Fase 3: virtualización (alturas, ventana, cola de render, presupuesto de píxeles)
  const heights = useRef<Heights | null>(null);
  const queue = useRef(new RenderQueue(2));
  const pixels = useRef(new Map<number, number>());
  const [win, setWin] = useState({ from: 1, to: 3 });
  /** Con lienzo dibujado: solo la visible ±1 (la ventana ±2 monta el DOM sin pintar). */
  const [near, setNear] = useState({ from: 1, to: 3 });
  const scrollRaf = useRef(0);
  const aspectT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let opened: { destroy(): Promise<void> } | null = null;
    let gone = false;
    void (async () => {
      try {
        // Prompt 11: por rangos sobre el File (sin leer el archivo entero ni copiarlo)
        const file = await fileOf(app.vault, props.path);
        fp.current = await fingerprintFile(file);
        const o = await openPdfFile(file);
        if (gone) return void o.destroy();
        opened = o;
        const d = o.doc as unknown as PDFDoc;
        setDoc(d);
        // anotaciones: el archivo auxiliar o, si no existe, el formato de la fase 9 (se migra al guardar)
        let a = parseAnnots(await readTextOr(app.vault, annotsPath(props.path), ''));
        if (!Object.keys(a.pages).length) {
          const old = await readTextOr(app.vault, legacyPath(props.path), '');
          if (old) {
            const aspects = new Map<number, number>();
            for (const k of Object.keys((JSON.parse(old) as { pages?: object }).pages ?? {})) { const v = (await d.getPage(Number(k))).getViewport({ scale: 1 }); aspects.set(Number(k), v.height / v.width); }
            a = fromLegacy(old, (n) => aspects.get(n) ?? 1.3);
          }
        }
        if (a.pdf && !samePdf(a.pdf, fp.current)) app.toast(tr('pdf.version_distinta'));
        setAnn(a);
        // alturas: proporción de la pág. 1 (o la guardada) y las excepciones medidas antes; cero getPage de páginas lejanas
        const meta = await updatePdfMeta(app.vault, props.path, { pages: d.numPages, opened: Date.now() });
        let ratio = meta.ratio;
        if (!ratio) { const p1 = await d.getPage(1); const v = p1.getViewport({ scale: 1 }); ratio = v.height / v.width; p1.cleanup(); void updatePdfMeta(app.vault, props.path, { ratio }); }
        heights.current = new Heights(d.numPages, ratio, meta.aspects ?? {});
        bump((x) => x + 1);
        if (!props.page && meta.last && meta.last > 1) { setCur(meta.last); setTimeout(() => goTo(meta.last!, d.numPages), 350); }
      } catch (e) {
        setErr(errMsg(e));
      }
    })();
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e!.contentRect.width - 24)));
    if (box.current) ro.observe(box.current);
    return () => { gone = true; ro.disconnect(); void opened?.destroy(); clearTimeout(saveT.current); clearTimeout(aspectT.current); cancelAnimationFrame(scrollRaf.current); };
  }, [props.path]);
  useEffect(() => { if (doc && props.page) setTimeout(() => goTo(props.page!), 300); }, [doc, props.page]);
  // última página vista (para volver ahí)
  useEffect(() => {
    if (!doc) return;
    const tm = setTimeout(() => void updatePdfMeta(app.vault, props.path, { last: cur, pages: doc.numPages }), 800);
    return () => clearTimeout(tm);
  }, [cur, doc]);

  const goTo = (n: number, total = doc?.numPages ?? 1) => {
    const p = Math.max(1, Math.min(total, n));
    setCur(p);
    // continuo: la posición sale de la tabla de alturas (la página puede no estar montada)
    if (mode === 'scroll' && box.current && heights.current) { box.current.scrollTop = heights.current.top(p, pwRef.current); syncWindow(); }
  };
  const pwRef = useRef(600);
  /** Ventana visible (rAF): sin medir el DOM, con la tabla de alturas. */
  const syncWindow = () => {
    const b = box.current, h = heights.current;
    if (!b || !h) return;
    const r = visibleRange(h, pwRef.current, b.scrollTop, b.clientHeight, 2);
    setWin((w) => (w.from === r.from && w.to === r.to ? w : { from: r.from, to: r.to }));
    const r1 = visibleRange(h, pwRef.current, b.scrollTop, b.clientHeight, 1);
    setNear((w) => (w.from === r1.from && w.to === r1.to ? w : { from: r1.from, to: r1.to }));
    setCur(h.pageAt(b.scrollTop + 80, pwRef.current));
  };
  const onScroll = () => {
    if (mode !== 'scroll' || scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => { scrollRaf.current = 0; syncWindow(); });
  };
  /** Proporción medida al renderizar: corrige la tabla y compensa el scroll si la página está arriba. */
  const onRatio = (n: number, ratio: number) => {
    const h = heights.current, b = box.current;
    if (!h) return;
    const top = h.top(n, pwRef.current);
    const delta = h.set(n, ratio, pwRef.current);
    if (!delta) return;
    if (mode === 'scroll' && b && top < b.scrollTop) b.scrollTop += delta;
    bump((x) => x + 1);
    clearTimeout(aspectT.current);
    aspectT.current = setTimeout(() => void updatePdfMeta(app.vault, props.path, { aspects: h.exceptions(h.ratio(1)) }), 1500);
  };
  // prioridad de los renders pendientes: la página central primero
  useEffect(() => { queue.current.reprioritize((id) => Math.abs(Number(id.slice(1)) - cur)); }, [cur]);
  // continuo: al entrar o al cambiar el ancho, quedarse en la página actual
  useEffect(() => {
    if (mode !== 'scroll' || !box.current || !heights.current) return;
    box.current.scrollTop = heights.current.top(cur, pwRef.current);
    syncWindow();
  }, [mode, Math.round(width * zoom), !!heights.current]);
  const persist = (a: Annots) => {
    setAnn(a);
    clearTimeout(saveT.current);
    saveT.current = setTimeout(() => void app.vault.write(annotsPath(props.path), JSON.stringify({ ...a, pdf: fp.current })), 400);
  };
  const pageOf = (n: number): PageAnn => ann.pages[n] ?? emptyPage();
  const setPage = (n: number, pa: PageAnn) => persist({ ...ann, pages: { ...ann.pages, [n]: pa } });
  const histOf = (n: number) => { let h = hist.current.get(n); if (!h) hist.current.set(n, (h = new History(pageOf(n).ink))); return h; };
  const record = (a: Act) => { acts.current.undo.push(a); acts.current.redo = []; bump((x) => x + 1); };
  const undo = () => {
    const a = acts.current.undo.pop();
    if (!a) return;
    acts.current.redo.push(a);
    if (a.type === 'ink') setPage(a.page, { ...pageOf(a.page), ink: histOf(a.page).undo() });
    else if (a.type === 'mark') { const pg = pageOf(a.page); a.item = pg.marks.find((m) => m.id === a.id); setPage(a.page, { ...pg, marks: pg.marks.filter((m) => m.id !== a.id) }); }
    else { const pg = pageOf(a.page); a.item = pg.notes.find((m) => m.id === a.id); setPage(a.page, { ...pg, notes: pg.notes.filter((m) => m.id !== a.id) }); }
    bump((x) => x + 1);
  };
  const redo = () => {
    const a = acts.current.redo.pop();
    if (!a) return;
    acts.current.undo.push(a);
    if (a.type === 'ink') setPage(a.page, { ...pageOf(a.page), ink: histOf(a.page).redo() });
    else if (a.type === 'mark' && a.item) setPage(a.page, { ...pageOf(a.page), marks: [...pageOf(a.page).marks, a.item as Mark] });
    else if (a.type === 'note' && a.item) setPage(a.page, { ...pageOf(a.page), notes: [...pageOf(a.page).notes, a.item as PageAnn['notes'][number]] });
    bump((x) => x + 1);
  };

  // Prompt 11: búsqueda cancelable, cediendo el hilo, con progreso y con el texto en caché
  // (`.app/cache/pdf-text/<huella>.json`): la segunda búsqueda, o al reabrir, no relee el PDF.
  const texts = useRef<string[] | null>(null);
  const finding = useRef(0);
  const [findProgress, setFindProgress] = useState<{ done: number; total: number } | null>(null);
  const textCache = () => `.app/cache/pdf-text/${fp.current?.hash ?? 'x'}-${fp.current?.size ?? 0}.json`;
  const find = async () => {
    const token = ++finding.current;
    if (!doc || !q.trim()) return (setHits([]), setFindProgress(null));
    const nq = q.toLowerCase();
    if (!texts.current) {
      try { const c = JSON.parse(await readTextOr(app.vault, textCache(), 'null')) as string[] | null; if (Array.isArray(c) && c.length === doc.numPages) texts.current = c; } catch { /* sin caché */ }
    }
    if (!texts.current) {
      const out: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        if (token !== finding.current) return; // cancelada (nueva búsqueda o el visor se cerró)
        const pg = await doc.getPage(i);
        try {
          out.push((await pg.getTextContent()).items.map((x) => (x as { str?: string }).str ?? '').join(' ').toLowerCase());
        } finally {
          pg.cleanup();
        }
        if (i % 4 === 0) { setFindProgress({ done: i, total: doc.numPages }); await new Promise((r) => setTimeout(r, 0)); }
      }
      texts.current = out;
      void app.vault.write(textCache(), JSON.stringify(out));
    }
    setFindProgress(null);
    const hits = texts.current.flatMap((t, i) => (t.includes(nq) ? [i + 1] : []));
    setHits(hits);
    if (hits[0]) goTo(hits[0]);
  };
  useEffect(() => () => { finding.current++; }, []);
  const onSelect = () => {
    if (annotate) return;
    const s = getSelection();
    const t = s?.toString().trim();
    if (!t) return setSel(null);
    const page = Number((s!.anchorNode?.parentElement?.closest('[data-page]') as HTMLElement | null)?.dataset.page ?? 0);
    if (page) setSel({ text: t, page });
  };
  const markSelection = (kind: MarkKind) => {
    const s = getSelection();
    if (!s || !sel) return;
    const pageEl = box.current!.querySelector<HTMLElement>(`[data-page="${sel.page}"]`)!;
    const pr = pageEl.getBoundingClientRect();
    const rects = [...s.getRangeAt(0).getClientRects()].map((r) => [(r.left - pr.left) / pr.width, (r.top - pr.top) / pr.height, r.width / pr.width, r.height / pr.height] as [number, number, number, number]);
    const m: Mark = { id: Date.now().toString(36), kind, color: MARK_COLOR, rects, text: sel.text, ts: Date.now() };
    setPage(sel.page, { ...pageOf(sel.page), marks: [...pageOf(sel.page).marks, m] });
    record({ type: 'mark', page: sel.page, id: m.id });
    s.removeAllRanges();
    setSel(null);
  };
  const exportPdf = async () => {
    const bytes = await app.vault.read(props.path);
    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const hex = (c: string) => { const n = parseInt(c.slice(1), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
    pdf.getPages().forEach((pg, i) => {
      const a = ann.pages[i + 1];
      if (!a) return;
      const { width: W, height: H } = pg.getSize();
      for (const m of a.marks) for (const [x, y, w, h] of m.rects) {
        if (m.kind === 'highlight') pg.drawRectangle({ x: x * W, y: H - (y + h) * H, width: w * W, height: h * H, color: hex(m.color), opacity: 0.35 });
        else pg.drawRectangle({ x: x * W, y: H - (y + (m.kind === 'underline' ? h : h / 2)) * H, width: w * W, height: Math.max(0.8, h * H * 0.08), color: m.kind === 'underline' ? hex('#0a5cd6') : hex('#c4262e') });
      }
      for (const s of a.ink.strokes) pg.drawSvgPath(svgPath(outline(s, W)), { x: 0, y: H, color: hex(s.color), opacity: s.tool === 'highlighter' ? 0.35 : 1, borderWidth: 0 });
      for (const n of a.notes) {
        pg.drawRectangle({ x: n.x * W, y: H - n.y * H - 14, width: 14, height: 14, color: hex('#ffd60a') });
        pg.drawText(n.text.slice(0, 200), { x: n.x * W + 18, y: H - n.y * H - 11, size: 8, font, color: rgb(0.1, 0.1, 0.1), maxWidth: Math.max(80, W * 0.4) });
      }
    });
    const out = await pdf.save();
    setExporting(new File([out as BlobPart], props.path.split('/').pop()!.replace(/\.pdf$/i, '') + ' (anotado).pdf', { type: 'application/pdf' }));
  };
  const exportMd = async () => {
    const name = props.path.split('/').pop()!.replace(/\.pdf$/i, '');
    await deliver(new File([marksToMarkdown(name, props.path, ann, (p) => pdfLink(props.path, p))], `${name} (resaltados).md`, { type: 'text/markdown' }));
  };

  if (err) return <div class="err">{tr('pdf.no_se_pudo_abrir_el_pdf', { err: err })}</div>;
  if (!doc) return <p class="t2" style={{ padding: '12px' }}>{tr('pdf.abriendo_pdf')}</p>;
  const src = `${props.path}#p${sel?.page ?? 1}`;
  const pw = Math.round(width * zoom);
  pwRef.current = pw;
  const H = heights.current;
  // continuo: solo la ventana visible ± 2; el resto son espaciadores con su altura
  const wFrom = Math.min(win.from, doc.numPages), wTo = Math.min(win.to, doc.numPages);
  const pages = mode === 'scroll' ? (H ? Array.from({ length: wTo - wFrom + 1 }, (_, i) => wFrom + i) : []) : [cur];
  const allMarks = Object.entries(ann.pages).flatMap(([k, p]) => [...p.marks.map((m) => ({ page: Number(k), text: m.text || tr('pdf.resaltado'), kind: m.kind as string })), ...p.notes.map((n) => ({ page: Number(k), text: n.text, kind: 'note' }))]).sort((a, b) => a.page - b.page);
  return (
    <div ref={root} class="pdf-viewer" data-own-zoom style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div class="row wrap pdf-bar" style={{ padding: '6px 10px', borderBottom: 'var(--hair) solid var(--line)' }}>
        <form class="row" onSubmit={(e) => (e.preventDefault(), void find())}><input class="input" style={{ width: '140px', minHeight: '34px' }} placeholder={tr('inbox.buscar')} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label={tr('pdf.buscar_en_el_pdf')} /><button class="btn icon small" aria-label={tr('inbox.buscar')}><Search size={16} /></button></form>
        {findProgress && <span class="foot num" role="status">{tr('pdf.buscando', { a: findProgress.done, b: findProgress.total })}{' '}<button type="button" class="btn icon small" aria-label={tr('pdf.cancelar_busqueda')} onClick={() => { finding.current++; setFindProgress(null); }}><X size={14} /></button></span>}
        {hits.length > 0 && <span class="foot">{tr('pdf.n_paginas', { n: hits.length })}{' '}{hits.slice(0, 8).map((h) => <button type="button" class="link" style={{ minHeight: '24px' }} onClick={() => goTo(h)}>{h} </button>)}</span>}
        <span class="grow" />
        <button type="button" class="btn icon small" aria-label={tr('pdf.alejar')} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}><Minus size={16} /></button>
        <span class="foot num">{Math.round(zoom * 100)} %</span>
        <button type="button" class="btn icon small" aria-label={tr('pdf.acercar')} onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}><Plus size={16} /></button>
        <button type="button" class="btn icon small" aria-label={mode === 'scroll' ? tr('pdf.por_pagina') : tr('pdf.continuo')} aria-pressed={mode === 'page'} onClick={() => setMode(mode === 'scroll' ? 'page' : 'scroll')}>{mode === 'scroll' ? <Columns2 size={16} /> : <LayoutList size={16} />}</button>
        <button type="button" class="btn icon small" aria-label={tr('pdf.miniaturas')} aria-pressed={side === 'thumbs'} onClick={() => setSide(side === 'thumbs' ? null : 'thumbs')}><FileText size={16} /></button>
        <button type="button" class="btn icon small" aria-label={tr('pdf.indice')} aria-pressed={side === 'outline'} onClick={() => setSide(side === 'outline' ? null : 'outline')}><ListTree size={16} /></button>
        <button type="button" class="btn icon small" aria-label={tr('pdf.resaltados_n', { n: allMarks.length })} aria-pressed={side === 'marks'} onClick={() => setSide(side === 'marks' ? null : 'marks')}><BookOpen size={16} /></button>
        <button type="button" class={`btn small${annotate ? ' primary' : ''}`} aria-pressed={annotate} onClick={() => (setAnnotate(!annotate), setSel(null), setSticky(false))}><PencilLine size={16} />{' '}{tr('pdf.anotar')}</button>
        <button type="button" class="btn icon small" aria-label={tr('pdf.exportar_anotado')} onClick={() => void exportPdf()}><Download size={16} /></button>
        <button type="button" class="btn icon small" aria-label={tr('pdf.exportar_resumen')} onClick={() => void exportMd()}><Quote size={16} /></button>
        {sel && !annotate && (
          <>
            <button type="button" class="btn small" onClick={() => markSelection('highlight')}><Highlighter size={16} />{' '}{tr('notes.resaltar')}</button>
            <button type="button" class="btn small" onClick={() => setMk('card')}><Sparkles size={16} />{' '}{tr('pdf.crear_tarjeta')}</button>
            <button type="button" class="btn small" onClick={() => setMk('quote')}><Quote size={16} />{' '}{tr('pdf.cita_en_nota')}</button>
            <button type="button" class="btn small" onClick={() => (setQ(sel.text.slice(0, 60)), setTimeout(() => void find(), 0))}><Search size={16} />{' '}{tr('inbox.buscar')}</button>
          </>
        )}
        <span class="foot">{mode === 'page' ? `${cur} / ` : ''}{tr('pdf.numpages_pags', { numPages: doc.numPages })}</span>
      </div>
      {annotate && (
        <InkToolbar tools={tools} set={(x) => (setTools(x), setSticky(false))} canUndo={acts.current.undo.length > 0} canRedo={acts.current.redo.length > 0} onUndo={undo} onRedo={redo}
          extra={<>
            {tools.tool === 'highlighter' && <Segmented label={tr('pdf.tipo_de_marca')} value={markKind} onChange={setMarkKind} options={[['highlight', tr('pdf.resaltar')], ['underline', tr('pdf.subrayar')], ['strike', tr('pdf.tachar')]]} />}
            <button type="button" class="btn icon small" aria-label={tr('pdf.nota_adhesiva')} aria-pressed={sticky} onClick={() => setSticky(!sticky)}><StickyNote size={18} /></button>
          </>} />
      )}
      <div class="row" style={{ flex: 1, minHeight: 0, alignItems: 'stretch' }}>
        {side && (
          <aside class="pdf-side stack-s" aria-label={side === 'thumbs' ? tr('pdf.miniaturas') : side === 'outline' ? tr('pdf.indice') : tr('pdf.resaltados')}>
            {side === 'thumbs' && <ThumbList doc={doc} ratio={H?.ratio(1) ?? 1.414} cur={cur} onGo={goTo} />}
            {side === 'outline' && <Outline doc={doc} onGo={goTo} />}
            {side === 'marks' && (allMarks.length ? allMarks.map((m) => <button type="button" class="opt note pdf-mark-item" onClick={() => goTo(m.page)}><b class="num">{m.page}</b> {m.kind === 'note' ? <StickyNote size={14} /> : m.kind === 'underline' ? <Underline size={14} /> : m.kind === 'strike' ? <Strikethrough size={14} /> : <Highlighter size={14} />} <span class="ellipsis" data-user-content>{m.text}</span></button>) : <p class="t2 note">{tr('pdf.sin_resaltados')}</p>)}
          </aside>
        )}
        <div ref={box} class="pdf-scroll" style={{ overflow: 'auto', flex: 1, padding: '0 12px' }} onPointerUp={onSelect} onKeyUp={onSelect}
          onScroll={onScroll}>
          {mode === 'scroll' && H && <div aria-hidden="true" style={{ height: `${H.top(wFrom, pw)}px` }} />}
          {pages.map((n) => (
            <Page key={n} doc={doc} n={n} width={pw} ratio={H?.ratio(n) ?? 1.414} slot={mode === 'scroll'} near={mode !== 'scroll' || (n >= near.from && n <= near.to)} focused={n === cur} queue={queue.current} pixels={pixels.current} onRatio={onRatio} ann={ann.pages[n]} annotate={annotate} sticky={sticky} tools={tools} markKind={markKind} finger={app.settings.inkFinger} history={histOf(n)}
              onInk={(ink, snapped) => {
                const pg = pageOf(n);
                if (snapped) { setPage(n, { ...pg, ink, marks: [...pg.marks, snapped] }); histOf(n).undo(); record({ type: 'mark', page: n, id: snapped.id }); }
                else { setPage(n, { ...pg, ink }); record({ type: 'ink', page: n }); }
              }}
              onNote={(x, y) => { const text = prompt(tr('pdf.texto_de_la_nota')); if (!text) return; const st = { id: Date.now().toString(36), x, y, text, ts: Date.now() }; setPage(n, { ...pageOf(n), notes: [...pageOf(n).notes, st] }); record({ type: 'note', page: n, id: st.id }); }}
              onRemoveNote={(id) => { if (!confirm(tr('pdf.borrar_nota'))) return; setPage(n, { ...pageOf(n), notes: pageOf(n).notes.filter((x) => x.id !== id) }); }} />
          ))}
          {mode === 'scroll' && H && <div aria-hidden="true" style={{ height: `${H.total(pw) - H.top(wTo + 1, pw) + 10}px` }} />}
          {mode === 'page' && (
            <div class="row" style={{ justifyContent: 'center', padding: '8px' }}>
              <button type="button" class="btn small" disabled={cur <= 1} onClick={() => goTo(cur - 1)}>‹ {tr('pdf.anterior')}</button>
              <button type="button" class="btn small" disabled={cur >= doc.numPages} onClick={() => goTo(cur + 1)}>{tr('pdf.siguiente')} ›</button>
            </div>
          )}
        </div>
      </div>
      {mk === 'card' && sel && (
        <Sheet title={tr('pdf.tarjeta_desde_el_pdf')} onClose={() => setMk(null)} wide>
          <CardForm initialFront={sel.text} onAdd={async (b) => { const d = app.col?.decks[0]?.path; if (!d) return app.toast(tr('pdf.crea_un_mazo_primero')); await appendCard(app.vault, d, `${b} <!-- src: ${src} -->`, app.col); app.changed(); app.toast(tr('pdf.tarjeta_creada_origen', { src })); setMk(null); }} />
          <p class="foot">{tr('pdf.se_guarda_en_tu_primer_mazo', { page: sel.page })}</p>
        </Sheet>
      )}
      {mk === 'quote' && sel && <QuoteToNote text={sel.text} src={src} link={pdfLink(props.path, sel.page)} onClose={() => setMk(null)} />}
      {exporting && (
        <Sheet title={tr('pdf.exportar_anotado')} onClose={() => setExporting(null)}>
          <div class="stack"><p>{tr('decks.name_esta_listo', { name: exporting.name })}</p><button type="button" class="btn primary" onClick={async () => { await deliver(exporting); setExporting(null); }}>{tr('backup.guardar_en_archivos')}</button></div>
        </Sheet>
      )}
    </div>
  );
}

function QuoteToNote(p: { text: string; src: string; link: string; onClose: () => void }) {
  const app = useApp();
  const [notes, setNotes] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  useEffect(() => void listNotes(app.vault).then((n) => (setNotes(n.map((x) => x.path)), setTarget(n[0]?.path ?? ''))), []);
  return (
    <Sheet title={tr('pdf.insertar_cita_en_nota')} onClose={p.onClose}>
      <div class="stack">
        <blockquote class="note">{p.text}</blockquote>
        <select value={target} onChange={(e) => setTarget((e.target as HTMLSelectElement).value)}>{notes.map((n) => <option value={n}>{n.replace(/^notes\//, '')}</option>)}</select>
        <button type="button" class="btn primary" disabled={!target} onClick={async () => { const t = await readTextOr(app.vault, target, ''); await app.vault.write(target, `${t.replace(/\s*$/, '')}\n\n> ${p.text.replace(/\n/g, '\n> ')}\n> — [${p.src}](${p.link})\n`); app.changed(); app.toast(tr('pdf.cita_insertada')); p.onClose(); }}>{tr('pdf.insertar')}</button>
      </div>
    </Sheet>
  );
}

/**
 * Miniaturas laterales (Prompt 11): lista virtualizada (solo las visibles ± 4), generadas de una
 * en una, con caché limitada (las URL que salen de la caché se liberan) y sin pedir páginas lejanas.
 */
function ThumbList(p: { doc: PDFDoc; ratio: number; cur: number; onGo: (n: number) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<number, string>());
  const busy = useRef<Promise<unknown>>(Promise.resolve());
  const [range, setRange] = useState({ from: 1, to: 12 });
  const [, bump] = useState(0);
  const ROW = Math.round(96 * p.ratio) + 34;
  const n = p.doc.numPages;
  useEffect(() => {
    const sc = wrap.current?.closest('.pdf-side') as HTMLElement | null;
    if (!sc) return;
    let raf = 0;
    const on = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; const a = Math.floor(sc.scrollTop / ROW) + 1; setRange({ from: Math.max(1, a - 4), to: Math.min(n, a + Math.ceil(sc.clientHeight / ROW) + 4) }); }); };
    on();
    sc.scrollTop = Math.max(0, (p.cur - 2) * ROW);
    sc.addEventListener('scroll', on, { passive: true });
    return () => { sc.removeEventListener('scroll', on); cancelAnimationFrame(raf); };
  }, [ROW, n]);
  useEffect(() => () => { for (const u of cache.current.values()) URL.revokeObjectURL(u); cache.current.clear(); }, []);
  useEffect(() => {
    let alive = true;
    for (let i = range.from; i <= range.to; i++) {
      if (cache.current.has(i)) continue;
      const k = i;
      busy.current = busy.current.then(async () => {
        if (!alive || cache.current.has(k)) return;
        const pg = await p.doc.getPage(k);
        try {
          const v = pg.getViewport({ scale: 96 / pg.getViewport({ scale: 1 }).width });
          const c = document.createElement('canvas');
          c.width = Math.ceil(v.width);
          c.height = Math.ceil(v.height);
          await pg.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: v } as never).promise;
          const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.7));
          c.width = c.height = 0;
          if (!blob) return;
          cache.current.set(k, URL.createObjectURL(blob));
          // caché limitada: se liberan las más lejanas a la página actual
          if (cache.current.size > 60) {
            const far = [...cache.current.keys()].sort((a, b) => Math.abs(b - k) - Math.abs(a - k))[0]!;
            URL.revokeObjectURL(cache.current.get(far)!);
            cache.current.delete(far);
          }
          if (alive) bump((x) => x + 1);
        } finally {
          pg.cleanup();
        }
      }).catch(() => {});
    }
    return () => { alive = false; };
  }, [range.from, range.to]);
  const items = [];
  for (let i = range.from; i <= range.to; i++) {
    const url = cache.current.get(i);
    items.push(<button type="button" class={`pdf-thumb${p.cur === i ? ' cur' : ''}`} aria-label={tr('pdf.pagina_n', { n: i })} aria-current={p.cur === i ? 'page' : undefined} onClick={() => p.onGo(i)} style={{ height: `${ROW}px` }}>{url ? <img src={url} alt="" /> : <span />}<span class="foot num">{i}</span></button>);
  }
  return (
    <div ref={wrap}>
      <div aria-hidden="true" style={{ height: `${(range.from - 1) * ROW}px` }} />
      {items}
      <div aria-hidden="true" style={{ height: `${(n - range.to) * ROW}px` }} />
    </div>
  );
}

function Outline(p: { doc: PDFDoc; onGo: (n: number) => void }) {
  type Item = { title: string; dest: unknown; items?: Item[] };
  const [items, setItems] = useState<{ title: string; depth: number; dest: unknown }[] | null>(null);
  useEffect(() => {
    void (p.doc as unknown as { getOutline(): Promise<Item[] | null> }).getOutline().then((o) => {
      const out: { title: string; depth: number; dest: unknown }[] = [];
      const walk = (xs: Item[], d: number) => xs.forEach((x) => (out.push({ title: x.title, depth: d, dest: x.dest }), walk(x.items ?? [], d + 1)));
      walk(o ?? [], 0);
      setItems(out);
    }, () => setItems([]));
  }, []);
  const go = async (dest: unknown) => {
    const d = p.doc as unknown as { getDestination(s: string): Promise<unknown[] | null>; getPageIndex(r: unknown): Promise<number> };
    const arr = typeof dest === 'string' ? await d.getDestination(dest) : (dest as unknown[]);
    if (arr?.[0] != null) p.onGo((typeof arr[0] === 'number' ? arr[0] : await d.getPageIndex(arr[0])) + 1);
  };
  if (!items) return <p class="t2 note">…</p>;
  if (!items.length) return <p class="t2 note">{tr('pdf.sin_indice')}</p>;
  return <>{items.map((x) => <button type="button" class="opt note" style={{ paddingLeft: `${10 + x.depth * 12}px` }} onClick={() => void go(x.dest)}>{x.title}</button>)}</>;
}

/** Cajas de carácter de la capa de texto cerca de un trazo (en fracción de la página). */
function charBoxes(pageEl: HTMLElement, band: { x0: number; x1: number; y0: number; y1: number }): CharBox[] {
  const pr = pageEl.getBoundingClientRect();
  const out: CharBox[] = [];
  const range = document.createRange();
  for (const span of pageEl.querySelectorAll<HTMLElement>('.textLayer span')) {
    const r = span.getBoundingClientRect();
    if (!r.width || (r.bottom - pr.top) / pr.height < band.y0 - 0.02 || (r.top - pr.top) / pr.height > band.y1 + 0.02) continue;
    const tn = span.firstChild;
    if (!tn || tn.nodeType !== 3) continue;
    const s = tn.textContent ?? '';
    for (let i = 0; i < s.length; i++) {
      range.setStart(tn, i);
      range.setEnd(tn, i + 1);
      const c = range.getBoundingClientRect();
      if (!c.width && !/\s/.test(s[i]!)) continue;
      out.push({ ch: s[i]!, x: (c.left - pr.left) / pr.width, y: (c.top - pr.top) / pr.height, w: c.width / pr.width, h: c.height / pr.height });
    }
  }
  return out;
}

/** Presupuesto global de píxeles de lienzo del visor (≈ 160 MB a 4 bytes/píxel). */
const PIXEL_BUDGET = 40_000_000;
/** Safari solo libera la memoria de un lienzo si se le pone tamaño 0 antes de soltarlo. */
const freeCanvas = (c: HTMLCanvasElement | null | undefined) => { if (c) { c.width = 0; c.height = 0; c.remove(); } };

function Page(p: { doc: PDFDoc; n: number; width: number; ratio: number; slot: boolean; near: boolean; focused: boolean; queue: RenderQueue; pixels: Map<number, number>; onRatio: (n: number, r: number) => void; ann?: PageAnn; annotate: boolean; sticky: boolean; tools: ReturnType<typeof useInkTools>[0]; markKind: MarkKind; finger: 'pencil' | 'scroll' | 'draw'; history: History; onInk: (ink: InkDoc, snapped?: Mark) => void; onNote: (x: number, y: number) => void; onRemoveNote: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const size = { w: p.width, h: p.width * p.ratio };
  const lowRes = useRef(false);
  // Prompt 11: se renderiza al montarse (solo se montan las páginas cercanas), en la cola (2 a la vez,
  // la central primero) y dentro del presupuesto de píxeles; al desmontarse se libera todo.
  useEffect(() => {
    const host = ref.current;
    if (!host || !p.near) return;
    const id = `p${p.n}`;
    p.queue.add(id, p.focused ? 0 : 1, async (signal) => {
      const lib = await pdfjs();
      const pg = await p.doc.getPage(p.n);
      try {
        const base = pg.getViewport({ scale: 1 });
        p.onRatio(p.n, base.height / base.width);
        const want = (size.w / base.width) * Math.min(2, devicePixelRatio || 1);
        const used = [...p.pixels.entries()].reduce((a, [k, v]) => a + (k === p.n ? 0 : v), 0);
        const allowed = fitPixels(base.width * base.height * want * want, used, PIXEL_BUDGET, MAX_PIXELS, p.focused);
        const scale = Math.min(want, Math.sqrt(allowed / (base.width * base.height)));
        lowRes.current = scale < want * 0.95;
        const vp = pg.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = Math.floor(vp.width);
        c.height = Math.floor(vp.height);
        const rt = pg.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: vp } as never);
        signal.addEventListener('abort', () => rt.cancel());
        await rt.promise;
        if (signal.aborted || !host.isConnected) return freeCanvas(c);
        freeCanvas(host.querySelector<HTMLCanvasElement>('canvas.page'));
        c.className = 'page';
        host.prepend(c);
        p.pixels.set(p.n, c.width * c.height);
        perf.inc('pageRenders');
        const tl = host.querySelector<HTMLDivElement>('.pdf-text')!;
        tl.innerHTML = '';
        const cssVp = pg.getViewport({ scale: size.w / base.width });
        tl.style.setProperty('--scale-factor', String(cssVp.scale));
        tl.style.setProperty('--total-scale-factor', String(cssVp.scale));
        const TL = (lib as unknown as { TextLayer?: new (o: object) => { render(): Promise<void> } }).TextLayer;
        if (TL && !signal.aborted) await new TL({ textContentSource: await pg.getTextContent(), container: tl, viewport: cssVp }).render();
      } finally {
        pg.cleanup();
      }
    });
    return () => {
      p.queue.cancel(id);
      // liberar TODO al salir de la ventana: lienzo (a tamaño 0), capa de texto y cuenta de píxeles
      freeCanvas(host.querySelector<HTMLCanvasElement>('canvas.page'));
      const tl = host.querySelector<HTMLDivElement>('.pdf-text');
      if (tl) tl.innerHTML = '';
      p.pixels.delete(p.n);
    };
  }, [size.w, p.near, p.focused && lowRes.current]);
  const ink = p.ann?.ink ?? { v: 1 as const, strokes: [] };
  const inkActive = p.annotate && !p.sticky;
  const onInk = (next: InkDoc) => {
    const added = next.strokes.length === ink.strokes.length + 1 ? next.strokes[next.strokes.length - 1] : null;
    // resaltador inteligente: un trazo de resaltador sobre texto se vuelve una marca ajustada a las líneas
    if (added?.tool === 'highlighter' && ref.current && size) {
      const xs = added.pts.map((q) => q[0]), ys = added.pts.map((q) => (q[1] * size.w) / size.h);
      const pad = (added.size * 1.5) / size.h;
      const snap = snapToText(charBoxes(ref.current, { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys) - pad, y1: Math.max(...ys) + pad }), { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys) - pad, y1: Math.max(...ys) + pad });
      if (snap.rects.length) return p.onInk(ink, { id: Date.now().toString(36), kind: p.markKind, color: added.color === '#1c1c1e' ? MARK_COLOR : added.color, rects: snap.rects, text: snap.text, ts: Date.now() });
    }
    p.onInk(next);
  };
  const page = (
    <div ref={ref} class="pdf-page" data-page={p.n} data-user-content style={{ width: `${size.w}px`, height: `${size.h}px` }}
      onClick={(e) => { if (!p.sticky || !size) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); p.onNote((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }}>
      <div class="pdf-text textLayer" />
      {p.ann?.marks.map((m) => m.rects.map(([x, y, w, hh]) => <div class={`pdf-mark ${m.kind}`} data-mark={m.id} style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${hh * 100}%`, '--mk': m.color }} />))}
      {(p.annotate || ink.strokes.length > 0) && <InkLayer doc={ink} onChange={onInk} history={p.history} width={size.w} height={size.h} active={inkActive} tools={p.tools} finger={p.finger} label={tr('pdf.tinta_pagina_n', { n: p.n })} />}
      {p.ann?.notes.map((n) => (
        <div class="pdf-sticky" style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}>
          <button type="button" class="pdf-sticky-btn" aria-label={tr('pdf.nota_x', { text: n.text.slice(0, 40) })} onClick={(e) => (e.stopPropagation(), setOpenNote(openNote === n.id ? null : n.id))}><StickyNote size={16} /></button>
          {openNote === n.id && <div class="pdf-sticky-pop glass strong" onClick={(e) => e.stopPropagation()}><p style={{ whiteSpace: 'pre-wrap' }}>{n.text}</p><button type="button" class="btn icon small" aria-label={tr('pdf.borrar_nota')} onClick={() => p.onRemoveNote(n.id)}><X size={14} /></button></div>}
        </div>
      ))}
      <span class="foot" style={{ position: 'absolute', bottom: '-18px', right: 0 }}>{p.n}</span>
    </div>
  );
  // continuo: cada página va en un hueco de alto conocido (la tabla de alturas manda)
  return p.slot ? <div class="pdf-slot" style={{ height: `${size.h + 10}px` }}>{page}</div> : page;
}

