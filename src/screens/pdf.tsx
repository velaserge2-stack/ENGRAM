/**
 * Visor PDF (SPEC §10d): páginas renderizadas bajo demanda y liberadas fuera de
 * pantalla; escala ≤ 2× y tope de ~16 MP por lienzo (límite de Safari); capa de
 * texto seleccionable; búsqueda; miniaturas; resaltado y dibujo con Pencil
 * guardados APARTE en .app/annotations/ (el PDF original no se modifica).
 */
import { Highlighter, PencilLine, Quote, Search, Sparkles } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { pdfjs } from '../io/extract';
import { useApp } from '../state';
import { readTextOr } from '../vault/util';
import { Sheet } from '../ui/kit';
import { CardForm } from './deck';
import { appendCard } from '../data/ops';
import { listNotes } from '../notes/model';

const MAX_PIXELS = 16_000_000;
type Stroke = { pts: [number, number, number][]; w: number };
type Ann = { pages: Record<number, { strokes: Stroke[]; highlights: { rects: [number, number, number, number][]; text: string }[] }> };
type PDFDoc = Awaited<ReturnType<Awaited<ReturnType<typeof pdfjs>>['getDocument']>['promise']>;

export function PdfViewer(props: { path: string; page?: number }) {
  const app = useApp();
  const [doc, setDoc] = useState<PDFDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [width, setWidth] = useState(600);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<number[]>([]);
  const [draw, setDraw] = useState(false);
  const [ann, setAnn] = useState<Ann>({ pages: {} });
  const [sel, setSel] = useState<{ text: string; page: number } | null>(null);
  const [mk, setMk] = useState<'card' | 'quote' | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const annPath = `.app/annotations/${props.path.replace(/\//g, '__')}.json`;
  useEffect(() => {
    let task: { destroy(): Promise<void>; promise: Promise<PDFDoc> } | null = null;
    void (async () => {
      try {
        const bytes = await app.vault.read(props.path);
        if (bytes.length > 50 * 1024 * 1024) app.toast('PDF de más de 50 MB: puede ir lento en el iPad');
        const lib = await pdfjs();
        task = lib.getDocument({ data: bytes }) as unknown as typeof task;
        setDoc(await task!.promise);
        try { setAnn(JSON.parse(await readTextOr(app.vault, annPath, '{"pages":{}}')) as Ann); } catch { /* sin anotaciones */ }
      } catch (e) {
        setErr((e as Error).message);
      }
    })();
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e!.contentRect.width - 24)));
    if (box.current) ro.observe(box.current);
    return () => { ro.disconnect(); void task?.destroy(); };
  }, [props.path]);
  useEffect(() => {
    if (doc && props.page) setTimeout(() => box.current?.querySelector(`[data-page="${props.page}"]`)?.scrollIntoView(), 300);
  }, [doc, props.page]);
  const saveAnn = (a: Ann) => (setAnn(a), void app.vault.write(annPath, JSON.stringify(a)));
  const find = async () => {
    if (!doc || !q.trim()) return setHits([]);
    const out: number[] = [];
    const nq = q.toLowerCase();
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      if ((tc.items as { str?: string }[]).map((x) => x.str ?? '').join(' ').toLowerCase().includes(nq)) out.push(i);
    }
    setHits(out);
    if (out[0]) box.current?.querySelector(`[data-page="${out[0]}"]`)?.scrollIntoView({ behavior: 'smooth' });
  };
  const onSelect = () => {
    const s = getSelection();
    const t = s?.toString().trim();
    if (!t) return setSel(null);
    const page = Number((s!.anchorNode?.parentElement?.closest('[data-page]') as HTMLElement | null)?.dataset.page ?? 0);
    if (page) setSel({ text: t, page });
  };
  const highlight = () => {
    const s = getSelection();
    if (!s || !sel) return;
    const pageEl = box.current!.querySelector<HTMLElement>(`[data-page="${sel.page}"]`)!;
    const pr = pageEl.getBoundingClientRect();
    const rects = [...s.getRangeAt(0).getClientRects()].map((r) => [((r.left - pr.left) / pr.width) * 100, ((r.top - pr.top) / pr.height) * 100, (r.width / pr.width) * 100, (r.height / pr.height) * 100] as [number, number, number, number]);
    const pg = ann.pages[sel.page] ?? { strokes: [], highlights: [] };
    saveAnn({ pages: { ...ann.pages, [sel.page]: { ...pg, highlights: [...pg.highlights, { rects, text: sel.text }] } } });
    s.removeAllRanges();
    setSel(null);
  };
  if (err) return <div class="err">⚠ No se pudo abrir el PDF: {err}</div>;
  if (!doc) return <p class="t2" style={{ padding: '12px' }}>Abriendo PDF…</p>;
  const src = `${props.path}#p${sel?.page ?? 1}`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div class="row wrap" style={{ padding: '6px 10px', borderBottom: 'var(--hair) solid var(--line)' }}>
        <form class="row" onSubmit={(e) => (e.preventDefault(), void find())}><input class="input" style={{ width: '140px', minHeight: '34px' }} placeholder="Buscar" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Buscar en el PDF" /><button class="btn icon small" aria-label="Buscar"><Search size={16} /></button></form>
        {hits.length > 0 && <span class="foot">{hits.length} páginas: {hits.slice(0, 8).map((h) => <button type="button" class="link" style={{ minHeight: '24px' }} onClick={() => box.current?.querySelector(`[data-page="${h}"]`)?.scrollIntoView({ behavior: 'smooth' })}>{h} </button>)}</span>}
        <span class="grow" />
        <button type="button" class={`btn small${draw ? ' primary' : ''}`} aria-pressed={draw} onClick={() => setDraw(!draw)}><PencilLine size={16} /> Dibujar</button>
        {sel && (
          <>
            <button type="button" class="btn small" onClick={highlight}><Highlighter size={16} /> Resaltar</button>
            <button type="button" class="btn small" onClick={() => setMk('card')}><Sparkles size={16} /> Crear tarjeta</button>
            <button type="button" class="btn small" onClick={() => setMk('quote')}><Quote size={16} /> Cita en nota</button>
          </>
        )}
        <span class="foot">{doc.numPages} págs.</span>
      </div>
      <div ref={box} style={{ overflow: 'auto', flex: 1, padding: '0 12px' }} onPointerUp={onSelect} onKeyUp={onSelect}>
        {Array.from({ length: doc.numPages }, (_, i) => <Page key={i} doc={doc} n={i + 1} width={width} draw={draw} ann={ann.pages[i + 1]} onStroke={(st) => { const pg = ann.pages[i + 1] ?? { strokes: [], highlights: [] }; saveAnn({ pages: { ...ann.pages, [i + 1]: { ...pg, strokes: [...pg.strokes, st] } } }); }} />)}
      </div>
      {mk === 'card' && sel && (
        <Sheet title="Tarjeta desde el PDF" onClose={() => setMk(null)} wide>
          <CardForm initialFront={sel.text} onAdd={async (b) => { const d = app.col?.decks[0]?.path; if (!d) return app.toast('Crea un mazo primero'); await appendCard(app.vault, d, `${b} <!-- src: ${src} -->`, app.col); app.changed(); app.toast(`Tarjeta creada con origen ${src}`); setMk(null); }} />
          <p class="foot">Se guarda en tu primer mazo con su origen (página {sel.page}); muévela después si quieres.</p>
        </Sheet>
      )}
      {mk === 'quote' && sel && <QuoteToNote text={sel.text} src={src} onClose={() => setMk(null)} />}
    </div>
  );
}

function QuoteToNote(p: { text: string; src: string; onClose: () => void }) {
  const app = useApp();
  const [notes, setNotes] = useState<string[]>([]);
  const [target, setTarget] = useState('');
  useEffect(() => void listNotes(app.vault).then((n) => (setNotes(n.map((x) => x.path)), setTarget(n[0]?.path ?? ''))), []);
  return (
    <Sheet title="Insertar cita en nota" onClose={p.onClose}>
      <div class="stack">
        <blockquote class="note">{p.text}</blockquote>
        <select value={target} onChange={(e) => setTarget((e.target as HTMLSelectElement).value)}>{notes.map((n) => <option value={n}>{n.replace(/^notes\//, '')}</option>)}</select>
        <button type="button" class="btn primary" disabled={!target} onClick={async () => { const t = await readTextOr(app.vault, target, ''); await app.vault.write(target, `${t.replace(/\s*$/, '')}\n\n> ${p.text.replace(/\n/g, '\n> ')}\n> — [${p.src}](#/espacios/abrir/${encodeURIComponent(p.src)})\n`); app.changed(); app.toast('Cita insertada'); p.onClose(); }}>Insertar</button>
      </div>
    </Sheet>
  );
}

function Page(p: { doc: PDFDoc; n: number; width: number; draw: boolean; ann?: Ann['pages'][number]; onStroke: (s: Stroke) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const ink = useRef<HTMLCanvasElement>(null);
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
  // tinta (Pencil): presión → grosor
  useEffect(() => {
    const c = ink.current;
    if (!c || !size) return;
    c.width = size.w;
    c.height = size.h;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#d0021b';
    for (const s of p.ann?.strokes ?? []) {
      for (let i = 1; i < s.pts.length; i++) {
        const [x0, y0] = s.pts[i - 1]!;
        const [x1, y1, pr] = s.pts[i]!;
        ctx.lineWidth = s.w * (0.4 + pr);
        ctx.beginPath(); ctx.moveTo((x0 / 100) * c.width, (y0 / 100) * c.height); ctx.lineTo((x1 / 100) * c.width, (y1 / 100) * c.height); ctx.stroke();
      }
    }
  }, [p.ann, size]);
  const cur = useRef<Stroke | null>(null);
  return (
    <div ref={ref} class="pdf-page" data-page={p.n} data-user-content style={size ? { width: `${size.w}px`, height: `${size.h}px` } : { height: '400px' }}>
      <div class="pdf-text textLayer" />
      {p.ann?.highlights.map((h) => h.rects.map(([x, y, w, hh]) => <div style={{ position: 'absolute', left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${hh}%`, background: 'rgba(255,214,10,.4)', pointerEvents: 'none', mixBlendMode: 'multiply' }} />))}
      <canvas ref={ink} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: p.draw ? 'none' : 'auto', pointerEvents: p.draw ? 'auto' : 'none' }}
        onPointerDown={(e) => { if (!p.draw) return; (e.target as HTMLElement).setPointerCapture(e.pointerId); cur.current = { pts: [], w: e.pointerType === 'pen' ? 2 : 3 }; }}
        onPointerMove={(e) => {
          if (!cur.current) return;
          const r = (e.target as HTMLElement).getBoundingClientRect();
          const pt: [number, number, number] = [((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100, e.pressure || 0.5];
          const ctx = ink.current!.getContext('2d')!;
          const last = cur.current.pts[cur.current.pts.length - 1];
          if (last) { ctx.lineWidth = cur.current.w * (0.4 + pt[2]); ctx.strokeStyle = '#d0021b'; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo((last[0] / 100) * ink.current!.width, (last[1] / 100) * ink.current!.height); ctx.lineTo((pt[0] / 100) * ink.current!.width, (pt[1] / 100) * ink.current!.height); ctx.stroke(); }
          cur.current.pts.push(pt);
        }}
        onPointerUp={() => { if (cur.current && cur.current.pts.length > 1) p.onStroke(cur.current); cur.current = null; }} aria-hidden={!p.draw} />
      <span class="foot" style={{ position: 'absolute', bottom: '-18px', right: 0 }}>{p.n}</span>
    </div>
  );
}
