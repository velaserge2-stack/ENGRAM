// Lienzo interactivo de un diagrama (Pointer Events). El documento es el texto de la nota: aquí solo se
// lee (`text`) y cada gesto termina en UNA operación `Edit` que decide el padre (`onEdit`). Estado propio
// solo de vista: escala, desplazamiento, selección y el gesto en curso. Durante el gesto nada se re-renderiza:
// la vista y el nodo arrastrado se mueven escribiendo `transform`/`d` en el DOM; el acomodo no se recalcula.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Maximize, ZoomIn, ZoomOut } from 'lucide-preact';
import { raw, t } from '../i18n';
import { isPhone } from '../theme';
import { parseDiagram } from './parse';
import { layoutLayered, layoutTree } from './layout';
import { inline } from './view';
import {
  TOUCH_R, dragFrame, dropAt, fitView, hitEdge, hitHandle, hitNode, isDrag, links, nodeKey, pinch, resolveNode,
  startDrag, toWorld, wheel, zoomBy, exitPoint, type Box, type Drag, type Pt, type View,
} from './gestures';
import type { DiagramDoc, DiagramKind, DiagramNode, Edit, Layout } from './types';
import './diagram.css';

export type DiagramSelection = { type: 'node' | 'edge'; id: string } | null;

export interface DiagramCanvasProps {
  text: string;
  kind: DiagramKind;
  onEdit: (edit: Edit) => void;
  onSelect?: (sel: DiagramSelection) => void;
  /** Fuerza el modo teléfono (pruebas); por defecto `isPhone()` al empezar cada gesto. */
  phone?: boolean;
}

const MIN = 44;
const PAD = 24;
const STEP = 16; // flechas del teclado: px del mundo por pulsación
const NODE_CLASS: Record<DiagramNode['shape'], string> = {
  rect: '', round: ' diag-round', diamond: ' diag-decision', io: ' diag-io', note: ' diag-note',
};
// Claves que añade la integración (E); mientras tanto, texto de respaldo.
const tx = (k: string, fb: string) => raw(k) ?? fb;

interface Model { doc: DiagramDoc; layout: Layout | null }
function build(text: string, kind: DiagramKind): Model {
  const r = parseDiagram(text, kind);
  if (r.tooBig) return { doc: r.doc, layout: null };
  return { doc: r.doc, layout: kind === 'mapa' ? layoutTree(r.doc) : layoutLayered(r.doc, 'TB') };
}

const boxCss = (b: Box) => {
  const h = Math.max(MIN, b.h);
  return `translate(${Math.round(b.x - b.w / 2)}px, ${Math.round(b.y - h / 2)}px)`;
};

type Target = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | { kind: 'bg' };
type Gesture =
  | { t: 'idle' }
  | { t: 'press'; pid: number; start: Pt; v0: View; target: Target }
  | { t: 'pan'; pid: number; start: Pt; v0: View }
  | { t: 'drag'; pid: number; drag: Drag; key: string; els: Map<string, HTMLElement>; pathEls: Map<string, Element>; last: Pt }
  | { t: 'connect'; pid: number; from: string; key: string; last: Pt; over: string | null }
  | { t: 'pinch'; a: number; b: number; a0: Pt; b0: Pt; v0: View };

export function DiagramCanvas({ text, kind, onEdit, onSelect, phone }: DiagramCanvasProps): JSX.Element {
  const m = useMemo(() => build(text, kind), [text, kind]);
  const [sel, setSel] = useState<DiagramSelection>(null);
  const board = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const temp = useRef<SVGPathElement>(null);
  const view = useRef<View>({ k: 1, x: 0, y: 0 });
  const g = useRef<Gesture>({ t: 'idle' });
  const pts = useRef(new Map<number, Pt>());
  const rect = useRef({ left: 0, top: 0 });
  const model = useRef(m);
  model.current = m;
  const fitted = useRef(false);
  const arrowId = 'diag-arrow-' + useId().replace(/\W/g, '');
  const cb = useRef({ onEdit, onSelect });
  cb.current = { onEdit, onSelect };

  const { doc, layout } = m;
  const isMap = kind === 'mapa';
  const live = sel && (sel.type === 'node' ? layout?.pos.has(sel.id) : doc.edges.some((e) => e.id === sel.id)) ? sel : null;
  const allLinks = useMemo(() => links(doc), [doc]);
  const linksRef = useRef(allLinks);
  linksRef.current = allLinks;

  const apply = (v: View) => {
    view.current = v;
    const s = stage.current;
    if (!s) return;
    s.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
    s.style.setProperty('--diag-inv', String(1 / v.k));
  };
  const size = () => ({ w: board.current?.clientWidth ?? 0, h: board.current?.clientHeight ?? 0 });
  const fit = () => {
    const L = model.current.layout;
    if (!L) return;
    const { w, h } = size();
    apply(fitView(L.bounds, w, h, PAD));
  };

  useLayoutEffect(() => {
    if (!fitted.current && layout && layout.pos.size) { fitted.current = true; fit(); } else apply(view.current);
  }, [layout]);

  // Rueda: no pasiva para que no desplace la nota mientras el puntero está sobre el lienzo.
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    const on = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      apply(wheel(view.current, e.deltaX, e.deltaY, e.ctrlKey || e.metaKey, { x: e.clientX - r.left, y: e.clientY - r.top }));
    };
    el.addEventListener('wheel', on, { passive: false });
    return () => el.removeEventListener('wheel', on);
  }, []);

  const local = (e: PointerEvent): Pt => ({ x: e.clientX - rect.current.left, y: e.clientY - rect.current.top });
  const nodeEl = (id: string) => stage.current?.querySelector<HTMLElement>(`[data-id="${id}"]`) ?? null;

  // Devuelve al DOM lo que dice el acomodo (fin o cancelación de un arrastre).
  const restore = (s: Gesture) => {
    const L = model.current.layout;
    if (s.t === 'drag' && L) {
      for (const [id, el] of s.els) { const b = L.pos.get(id); if (b) el.style.transform = boxCss(b); }
      for (const [k, el] of s.pathEls) el.setAttribute('d', L.paths.get(k) ?? '');
    }
    if (s.t === 'connect') {
      temp.current?.setAttribute('d', '');
      if (s.over) nodeEl(s.over)?.classList.remove('diag-target');
    }
  };
  const cancel = () => { restore(g.current); g.current = { t: 'idle' }; };

  const select = (s: DiagramSelection) => { setSel(s); cb.current.onSelect?.(s); };

  const onDown = (e: PointerEvent) => {
    const L = model.current.layout;
    if (!L || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const r = board.current!.getBoundingClientRect();
    rect.current = { left: r.left, top: r.top };
    const p = local(e);
    pts.current.set(e.pointerId, p);
    try { board.current!.setPointerCapture(e.pointerId); } catch { /* sin captura (pruebas) */ }
    if (pts.current.size === 2) { // segundo dedo: lo que hubiera en curso se descarta (sin Edit) y empieza el pellizco
      cancel();
      const [[a, a0], [b, b0]] = [...pts.current] as [[number, Pt], [number, Pt]];
      g.current = { t: 'pinch', a, b, a0, b0, v0: view.current };
      return;
    }
    if (pts.current.size > 2 || g.current.t !== 'idle') return;
    const v = view.current;
    const w = toWorld(v, p);
    const tel = phone ?? isPhone();
    const cur = model.current;
    if (!tel && !isMap && live?.type === 'node') {
      const b = L.pos.get(live.id);
      const n = cur.doc.nodes.find((x) => x.id === live.id);
      if (b && n && hitHandle(b, w, v.k)) {
        g.current = { t: 'connect', pid: e.pointerId, from: n.id, key: nodeKey(n), last: w, over: null };
        return;
      }
    }
    const nid = hitNode(L.pos, w);
    const eid = nid || isMap ? null : hitEdge(L.paths, w, TOUCH_R / v.k);
    const target: Target = nid ? { kind: 'node', id: nid } : eid ? { kind: 'edge', id: eid } : { kind: 'bg' };
    g.current = { t: 'press', pid: e.pointerId, start: p, v0: v, target };
  };

  const onMove = (e: PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return;
    const p = local(e);
    pts.current.set(e.pointerId, p);
    const s = g.current;
    const L = model.current.layout;
    if (!L) return;
    if (s.t === 'pinch') {
      const a1 = pts.current.get(s.a), b1 = pts.current.get(s.b);
      if (a1 && b1) apply(pinch(s.v0, s.a0, s.b0, a1, b1));
      return;
    }
    if (!('pid' in s) || s.pid !== e.pointerId) return;
    if (s.t === 'press') {
      if (!isDrag(s.start, p)) return;
      const tgt = s.target;
      const cur = model.current;
      const n = tgt.kind === 'node' ? cur.doc.nodes.find((x) => x.id === tgt.id) : undefined;
      const tel = phone ?? isPhone();
      const fixedRoot = isMap && n?.depth === 0; // la raíz del mapa no se mueve (el acomodo la fija en 0,0)
      const d = n && !tel && !fixedRoot ? startDrag(cur.doc, L, linksRef.current, n.id, toWorld(s.v0, s.start)) : null;
      if (d && n) {
        const els = new Map<string, HTMLElement>();
        for (const id of d.moving.keys()) { const el = nodeEl(id); if (el) els.set(id, el); }
        const pathEls = new Map<string, Element>();
        for (const l of d.touched) { const el = stage.current?.querySelector(`[data-path="${l.key}"]`); if (el) pathEls.set(l.key, el); }
        els.get(n.id)?.classList.add('diag-dragging');
        g.current = { t: 'drag', pid: s.pid, drag: d, key: nodeKey(n), els, pathEls, last: d.start };
      } else g.current = { t: 'pan', pid: s.pid, start: s.start, v0: s.v0 };
    }
    const s2 = g.current;
    if (s2.t === 'pan') apply({ ...s2.v0, x: s2.v0.x + p.x - s2.start.x, y: s2.v0.y + p.y - s2.start.y });
    else if (s2.t === 'drag') {
      const w = toWorld(view.current, p);
      s2.last = w;
      const f = dragFrame(s2.drag, L, w);
      for (const [id, b] of f.boxes) { const el = s2.els.get(id); if (el) el.style.transform = boxCss(b); }
      for (const [k, d] of f.paths) s2.pathEls.get(k)?.setAttribute('d', d);
    } else if (s2.t === 'connect') {
      const w = toWorld(view.current, p);
      s2.last = w;
      const a = L.pos.get(s2.from);
      if (a) { const q = exitPoint(a, w); temp.current?.setAttribute('d', `M ${Math.round(q.x)} ${Math.round(q.y)} L ${Math.round(w.x)} ${Math.round(w.y)}`); }
      const over = hitNode(L.pos, w);
      const ov = over && over !== s2.from ? over : null;
      if (ov !== s2.over) {
        if (s2.over) nodeEl(s2.over)?.classList.remove('diag-target');
        if (ov) nodeEl(ov)?.classList.add('diag-target');
        s2.over = ov;
      }
    }
  };

  const onUp = (e: PointerEvent) => {
    if (!pts.current.delete(e.pointerId)) return;
    const s = g.current;
    if (s.t === 'pinch') { if (s.a === e.pointerId || s.b === e.pointerId) g.current = { t: 'idle' }; return; }
    if (!('pid' in s) || s.pid !== e.pointerId) return;
    g.current = { t: 'idle' };
    const cur = model.current;
    if (e.type === 'pointercancel') { restore(s); return; }
    if (s.t === 'press') {
      const tg = s.target;
      select(tg.kind === 'bg' ? null : { type: tg.kind, id: tg.id });
    } else if (s.t === 'drag') {
      s.els.get(s.drag.id)?.classList.remove('diag-dragging');
      restore(s);
      const id = resolveNode(cur.doc, s.drag.id, s.key);
      if (id) {
        const { x, y } = dropAt(s.drag, s.last);
        const b = s.drag.moving.get(s.drag.id)!;
        if (x !== Math.round(b.x) || y !== Math.round(b.y)) cb.current.onEdit({ op: 'move', id, x, y });
        select({ type: 'node', id });
      }
    } else if (s.t === 'connect') {
      restore(s);
      const from = resolveNode(cur.doc, s.from, s.key);
      const to = cur.layout ? hitNode(cur.layout.pos, s.last) : null;
      if (from && to && to !== from) cb.current.onEdit({ op: 'connect', from, to });
    }
  };

  // Teclado: alternativa al arrastre (WCAG 2.5.7). Enter/Espacio selecciona; flechas mueven (una `move` por pulsación).
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { cancel(); select(null); return; }
    const id = (e.target as HTMLElement).dataset?.id;
    if (!id || !layout) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select({ type: 'node', id }); return; }
    const dir: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dir[e.key];
    const n = doc.nodes.find((x) => x.id === id);
    const b = layout.pos.get(id);
    if (!d || !n || !b || (isMap && n.depth === 0) || (phone ?? isPhone())) return;
    e.preventDefault();
    onEdit({ op: 'move', id, x: Math.round(b.x + d[0] * STEP), y: Math.round(b.y + d[1] * STEP) });
  };

  const tools = (
    <div class="diag-tools glass">
      <button type="button" class="btn icon ghost" aria-label={t('pdf.alejar')} onClick={() => { const { w, h } = size(); apply(zoomBy(view.current, 1 / 1.25, w, h)); }}><ZoomOut size={20} aria-hidden="true" /></button>
      <button type="button" class="btn icon ghost" aria-label={t('pdf.acercar')} onClick={() => { const { w, h } = size(); apply(zoomBy(view.current, 1.25, w, h)); }}><ZoomIn size={20} aria-hidden="true" /></button>
      <button type="button" class="btn icon ghost" aria-label={t('spaces.ajustar_al_contenido')} onClick={fit}><Maximize size={20} aria-hidden="true" /></button>
    </div>
  );

  if (!layout) {
    return (
      <div class="diag-host-view">
        <p class="diag-warn" role="status">{t('diag.demasiados_nodos')}</p>
        <pre class="diag-src" data-user-content>{text}</pre>
      </div>
    );
  }

  const b = layout.bounds;
  const sx = Math.floor(b.x - PAD), sy = Math.floor(b.y - PAD);
  const W = Math.ceil(b.w + PAD * 2), H = Math.ceil(b.h + PAD * 2);
  const hasKids = new Set(doc.nodes.map((n) => n.parent).filter((p): p is string => !!p));
  const label = t(isMap ? 'diag.mapa' : 'diag.flujo');
  const selBox = live?.type === 'node' && !isMap ? layout.pos.get(live.id) : undefined;

  const nodes = doc.nodes.filter((n) => layout.pos.has(n.id)).map((n) => {
    const p = layout.pos.get(n.id)!;
    const lvl = isMap ? (n.depth <= 0 ? ' diag-root' : n.depth === 1 ? ' diag-l1' : ' diag-l2') : ' diag-l1';
    const on = live?.type === 'node' && live.id === n.id;
    const cls = 'diag-node' + lvl + NODE_CLASS[n.shape] + (n.folded && hasKids.has(n.id) ? ' diag-folded' : '') + (on ? ' diag-sel' : '');
    return (
      <div key={n.id} data-id={n.id} class={cls} role="button" tabIndex={0} aria-pressed={on} data-user-content
        style={{ width: `${Math.round(p.w)}px`, height: `${Math.max(MIN, Math.round(p.h))}px`, transform: boxCss(p) }}>
        <span class="diag-text">{inline(n.text)}</span>
      </div>
    );
  });

  const paths: JSX.Element[] = [];
  if (isMap) {
    for (const [id, d] of layout.paths) paths.push(<path key={id} data-path={id} class="diag-edge diag-w2" d={d} />);
  } else {
    for (const e of doc.edges) {
      const d = layout.paths.get(e.id);
      if (!d) continue;
      const on = live?.type === 'edge' && live.id === e.id;
      paths.push(<path key={e.id} data-path={e.id} class={'diag-edge diag-w2' + (on ? ' diag-edge-sel' : '')} d={d}
        marker-end={e.arrow !== 'none' ? `url(#${arrowId})` : undefined} marker-start={e.arrow === 'both' ? `url(#${arrowId})` : undefined} />);
    }
  }

  return (
    <div class="diag-board-wrap">
      <div ref={board} class="diag-board glass" role="application" aria-label={label}
        aria-roledescription={tx('diag.lienzo', 'lienzo')}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}>
        <div ref={stage} class="diag-board-stage">
          <svg class="diag-svg" aria-hidden="true" focusable="false"
            style={{ left: `${sx}px`, top: `${sy}px`, width: `${W}px`, height: `${H}px` }} viewBox={`${sx} ${sy} ${W} ${H}`}>
            <defs>
              <marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" class="diag-head" />
              </marker>
            </defs>
            {paths}
            <path ref={temp} class="diag-edge diag-w2 diag-temp" d="" marker-end={`url(#${arrowId})`} />
          </svg>
          {nodes}
          {selBox && (
            <div class="diag-handle" aria-hidden="true"
              style={{ transform: `translate(${Math.round(selBox.x + selBox.w / 2)}px, ${Math.round(selBox.y)}px) scale(var(--diag-inv, 1)) translate(0, -50%)` }} />
          )}
        </div>
      </div>
      {tools}
    </div>
  );
}
