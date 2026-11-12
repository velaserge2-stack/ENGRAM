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
import { type Annots, annotsPath, type CharBox, emptyPage, fingerprint, fromLegacy, legacyPath, type Mark, type MarkKind, marksToMarkdown, type PageAnn, parseAnnots, samePdf, snapToText } from '../pdf/annots';
import { pdfLink, updatePdfMeta } from '../pdf/library';

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
  const [mode, setMode] = useState<'scroll' | 'page'>('scroll');
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

  useEffect(() => {
    let task: { destroy(): Promise<void>; promise: Promise<PDFDoc> } | null = null;
    void (async () => {
      try {
        const bytes = await app.vault.read(props.path);
        if (bytes.length > 50 * 1024 * 1024) app.toast(tr('pdf.pdf_de_mas_de_50_mb'));
        fp.current = fingerprint(bytes);
        const lib = await pdfjs();
        task = lib.getDocument({ data: bytes.slice() }) as unknown as typeof task;
        const d = await task!.promise;
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
        if (!props.page) {
          const meta = await updatePdfMeta(app.vault, props.path, { pages: d.numPages, opened: Date.now() });
          if (meta.last && meta.last > 1) { setCur(meta.last); setTimeout(() => goTo(meta.last!, d.numPages), 350); }
        }
      } catch (e) {
        setErr(errMsg(e));
      }
    })();
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e!.contentRect.width - 24)));
    if (box.current) ro.observe(box.current);
    return () => { ro.disconnect(); void task?.destroy(); clearTimeout(saveT.current); };
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
    if (mode === 'scroll') box.current?.querySelector(`[data-page="${p}"]`)?.scrollIntoView({ block: 'start' });
  };
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

  const find = async () => {
    if (!doc || !q.trim()) return setHits([]);
    const out: number[] = [];
    const nq = q.toLowerCase();
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      if ((tc.items as { str?: string }[]).map((x) => x.str ?? '').join(' ').toLowerCase().includes(nq)) out.push(i);
    }
    setHits(out);
    if (out[0]) goTo(out[0]);
  };
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
  const pages = mode === 'scroll' ? Array.from({ length: doc.numPages }, (_, i) => i + 1) : [cur];
  const allMarks = Object.entries(ann.pages).flatMap(([k, p]) => [...p.marks.map((m) => ({ page: Number(k), text: m.text || tr('pdf.resaltado'), kind: m.kind as string })), ...p.notes.map((n) => ({ page: Number(k), text: n.text, kind: 'note' }))]).sort((a, b) => a.page - b.page);
  return (
    <div ref={root} class="pdf-viewer" data-own-zoom style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div class="row wrap pdf-bar" style={{ padding: '6px 10px', borderBottom: 'var(--hair) solid var(--line)' }}>
        <form class="row" onSubmit={(e) => (e.preventDefault(), void find())}><input class="input" style={{ width: '140px', minHeight: '34px' }} placeholder={tr('inbox.buscar')} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label={tr('pdf.buscar_en_el_pdf')} /><button class="btn icon small" aria-label={tr('inbox.buscar')}><Search size={16} /></button></form>
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
            {side === 'thumbs' && Array.from({ length: doc.numPages }, (_, i) => <Thumb doc={doc} n={i + 1} cur={cur === i + 1} onClick={() => goTo(i + 1)} />)}
            {side === 'outline' && <Outline doc={doc} onGo={goTo} />}
            {side === 'marks' && (allMarks.length ? allMarks.map((m) => <button type="button" class="opt note pdf-mark-item" onClick={() => goTo(m.page)}><b class="num">{m.page}</b> {m.kind === 'note' ? <StickyNote size={14} /> : m.kind === 'underline' ? <Underline size={14} /> : m.kind === 'strike' ? <Strikethrough size={14} /> : <Highlighter size={14} />} <span class="ellipsis" data-user-content>{m.text}</span></button>) : <p class="t2 note">{tr('pdf.sin_resaltados')}</p>)}
          </aside>
        )}
        <div ref={box} class="pdf-scroll" style={{ overflow: 'auto', flex: 1, padding: '0 12px' }} onPointerUp={onSelect} onKeyUp={onSelect}
          onScroll={() => { if (mode !== 'scroll' || !box.current) return; const top = box.current.getBoundingClientRect().top; const el = [...box.current.querySelectorAll<HTMLElement>('[data-page]')].find((x) => x.getBoundingClientRect().bottom > top + 80); if (el) setCur(Number(el.dataset.page)); }}>
          {pages.map((n) => (
            <Page key={n} doc={doc} n={n} width={pw} ann={ann.pages[n]} annotate={annotate} sticky={sticky} tools={tools} markKind={markKind} finger={app.settings.inkFinger} history={histOf(n)}
              onInk={(ink, snapped) => {
                const pg = pageOf(n);
                if (snapped) { setPage(n, { ...pg, ink, marks: [...pg.marks, snapped] }); histOf(n).undo(); record({ type: 'mark', page: n, id: snapped.id }); }
                else { setPage(n, { ...pg, ink }); record({ type: 'ink', page: n }); }
              }}
              onNote={(x, y) => { const text = prompt(tr('pdf.texto_de_la_nota')); if (!text) return; const st = { id: Date.now().toString(36), x, y, text, ts: Date.now() }; setPage(n, { ...pageOf(n), notes: [...pageOf(n).notes, st] }); record({ type: 'note', page: n, id: st.id }); }}
              onRemoveNote={(id) => { if (!confirm(tr('pdf.borrar_nota'))) return; setPage(n, { ...pageOf(n), notes: pageOf(n).notes.filter((x) => x.id !== id) }); }} />
          ))}
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

function Thumb(p: { doc: PDFDoc; n: number; cur: boolean; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let done = false;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e!.isIntersecting || done) return;
      done = true;
      const pg = await p.doc.getPage(p.n);
      const v = pg.getViewport({ scale: 96 / pg.getViewport({ scale: 1 }).width });
      const c = document.createElement('canvas');
      c.width = Math.ceil(v.width);
      c.height = Math.ceil(v.height);
      await pg.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: v } as never).promise;
      setUrl(c.toDataURL('image/jpeg', 0.7));
    }, { rootMargin: '300px' });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  return <button ref={ref} type="button" class={`pdf-thumb${p.cur ? ' cur' : ''}`} aria-label={tr('pdf.pagina_n', { n: p.n })} aria-current={p.cur ? 'page' : undefined} onClick={p.onClick}>{url ? <img src={url} alt="" /> : <span />}<span class="foot num">{p.n}</span></button>;
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

function Page(p: { doc: PDFDoc; n: number; width: number; ann?: PageAnn; annotate: boolean; sticky: boolean; tools: ReturnType<typeof useInkTools>[0]; markKind: MarkKind; finger: 'pencil' | 'scroll' | 'draw'; history: History; onInk: (ink: InkDoc, snapped?: Mark) => void; onNote: (x: number, y: number) => void; onRemoveNote: (id: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const [openNote, setOpenNote] = useState<string | null>(null);
  useEffect(() => {
    void p.doc.getPage(p.n).then((pg) => { const v = pg.getViewport({ scale: 1 }); setSize({ w: p.width, h: (p.width * v.height) / v.width }); });
  }, [p.width]);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e!.isIntersecting), { rootMargin: '600px 0px' });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !size || !ref.current) return;
    let cancelled = false;
    let renderTask: { cancel(): void } | null = null;
    const host = ref.current;
    void (async () => {
      const lib = await pdfjs();
      const pg = await p.doc.getPage(p.n);
      const base = pg.getViewport({ scale: 1 });
      let scale = (size.w / base.width) * Math.min(2, devicePixelRatio || 1);
      if (base.width * base.height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (base.width * base.height));
      const vp = pg.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      const rt = pg.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: vp } as never);
      renderTask = rt;
      await rt.promise;
      if (cancelled) return;
      host.querySelector('canvas.page')?.remove();
      c.className = 'page';
      host.prepend(c);
      const tl = host.querySelector<HTMLDivElement>('.pdf-text')!;
      tl.innerHTML = '';
      const cssVp = pg.getViewport({ scale: size.w / base.width });
      tl.style.setProperty('--scale-factor', String(cssVp.scale));
      tl.style.setProperty('--total-scale-factor', String(cssVp.scale));
      const TL = (lib as unknown as { TextLayer?: new (o: object) => { render(): Promise<void> } }).TextLayer;
      if (TL) await new TL({ textContentSource: await pg.getTextContent(), container: tl, viewport: cssVp }).render();
    })().catch(() => {});
    return () => {
      cancelled = true;
      renderTask?.cancel();
      // liberar memoria: quitar el lienzo de páginas fuera de pantalla
      host.querySelector('canvas.page')?.remove();
    };
  }, [visible, size?.w]);
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
  return (
    <div ref={ref} class="pdf-page" data-page={p.n} data-user-content style={size ? { width: `${size.w}px`, height: `${size.h}px` } : { height: '400px' }}
      onClick={(e) => { if (!p.sticky || !size) return; const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); p.onNote((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }}>
      <div class="pdf-text textLayer" />
      {p.ann?.marks.map((m) => m.rects.map(([x, y, w, hh]) => <div class={`pdf-mark ${m.kind}`} data-mark={m.id} style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${hh * 100}%`, '--mk': m.color }} />))}
      {size && <InkLayer doc={ink} onChange={onInk} history={p.history} width={size.w} height={size.h} active={inkActive} tools={p.tools} finger={p.finger} label={tr('pdf.tinta_pagina_n', { n: p.n })} />}
      {p.ann?.notes.map((n) => (
        <div class="pdf-sticky" style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}>
          <button type="button" class="pdf-sticky-btn" aria-label={tr('pdf.nota_x', { text: n.text.slice(0, 40) })} onClick={(e) => (e.stopPropagation(), setOpenNote(openNote === n.id ? null : n.id))}><StickyNote size={16} /></button>
          {openNote === n.id && <div class="pdf-sticky-pop glass strong" onClick={(e) => e.stopPropagation()}><p style={{ whiteSpace: 'pre-wrap' }}>{n.text}</p><button type="button" class="btn icon small" aria-label={tr('pdf.borrar_nota')} onClick={() => p.onRemoveNote(n.id)}><X size={14} /></button></div>}
        </div>
      ))}
      <span class="foot" style={{ position: 'absolute', bottom: '-18px', right: 0 }}>{p.n}</span>
    </div>
  );
}

