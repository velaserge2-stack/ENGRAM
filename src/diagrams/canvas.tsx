// Lienzo interactivo de un diagrama (Pointer Events). El documento es el texto de la nota: aquí solo se
// lee (`text`) y cada gesto termina en UNA operación `Edit` que decide el padre (`onEdit`). Estado propio
// solo de vista: escala, desplazamiento, selección y el gesto en curso. Durante el gesto nada se re-renderiza:
// la vista y el nodo arrastrado se mueven escribiendo `transform`/`d` en el DOM; el acomodo no se recalcula.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Maximize, Plus, ZoomIn, ZoomOut } from 'lucide-preact';
import { raw, t } from '../i18n';
import { isPhone } from '../theme';
import { edgeGeometry, type EdgeGeo } from './edges';
import { EdgeG, MIN, NodeText, backdropClass, buildModel, edgeGeo, inline, nodeClass, nodeFont, useFontsTick } from './view';
import {
  TOUCH_R, dragFrame, dropAt, fitView, hitEdge, hitNode, isDrag, links, nodeKey, pinch, resolveNode,
  startDrag, toWorld, wheel, zoomBy, type Box, type Drag, type Link, type Pt, type View,
} from './gestures';
import type { Backdrop, DiagramKind, Edit } from './types';
import './diagram.css';

export type DiagramSelection = { type: 'node' | 'edge'; id: string } | null;

/** Lado del nodo por el que sale un chip «+». */
export type ChipSide = 'arriba' | 'abajo' | 'izquierda' | 'derecha';

export interface DiagramCanvasProps {
  text: string;
  kind: DiagramKind;
  onEdit: (edit: Edit) => void;
  onSelect?: (sel: DiagramSelection) => void;
  /** Clic en un chip «+» (añadir hijo hacia ese lado). Sin él, añade un hijo con el texto por defecto. */
  onChip?: (nodeId: string, side: ChipSide) => void;
  /** Arrastrar un chip «+» y soltar en el vacío (punto del mundo). Sin él, no pasa nada. */
  onChipDrop?: (nodeId: string, side: ChipSide, point: { x: number; y: number }) => void;
  /** Fondo ya resuelto (frontmatter `fondo:`); si falta se lee del texto. */
  backdrop?: Backdrop;
  /** Fuerza el modo teléfono (pruebas); por defecto `isPhone()` al empezar cada gesto. */
  phone?: boolean;
}

const PAD = 24;
const STEP = 16; // flechas del teclado: px del mundo por pulsación
const CHIP_KEY: Record<ChipSide, string> = {
  arriba: 'diag.hijo_arriba', abajo: 'diag.hijo_abajo', izquierda: 'diag.hijo_izquierda', derecha: 'diag.hijo_derecha',
};
const CHIP_GAP = 12, CHIP_DOT = 22, CHIP_ZONE = 44; // px de pantalla (no escalan con el zoom)
// Claves que añade la integración; mientras tanto, texto de respaldo.
const tx = (k: string, fb: string) => raw(k) ?? fb;
const HOVER_KEEP = 56; // px de pantalla alrededor del nodo con hover donde los chips siguen visibles

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
  | { t: 'connect'; pid: number; from: string; key: string; last: Pt; over: string | null; side: ChipSide; start: Pt; moved: boolean }
  | { t: 'pinch'; a: number; b: number; a0: Pt; b0: Pt; v0: View };

export function DiagramCanvas({ text, kind, onEdit, onSelect, onChip, onChipDrop, backdrop, phone }: DiagramCanvasProps): JSX.Element {
  const tick = useFontsTick();
  // Medir una vez por texto (no por fotograma de arrastre: durante el gesto este memo no se recalcula).
  const m = useMemo(() => buildModel(text, kind), [text, kind, tick]);
  const [hover, setHover] = useState<string | null>(null);
  const [sel, setSel] = useState<DiagramSelection>(null);
  const board = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const temp = useRef<SVGPathElement>(null);
  const tempHead = useRef<SVGPathElement>(null);
  const view = useRef<View>({ k: 1, x: 0, y: 0 });
  const g = useRef<Gesture>({ t: 'idle' });
  const pts = useRef(new Map<number, Pt>());
  const rect = useRef({ left: 0, top: 0 });
  const model = useRef(m);
  model.current = m;
  const fitted = useRef(false);
  const cb = useRef({ onEdit, onSelect, onChip, onChipDrop });
  cb.current = { onEdit, onSelect, onChip, onChipDrop };

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

  const busy = (on: boolean) => board.current?.classList.toggle('diag-busy', on);
  const shapeOf = (id: string) => model.current.doc.nodes.find((x) => x.id === id)?.shape;
  // Pinta en el DOM la geometría de una flecha (línea, hit, puntas y etiqueta) sin re-renderizar.
  const paintEdge = (key: string, geo: EdgeGeo) => {
    const st = stage.current;
    if (!st) return;
    const q = (sel: string) => st.querySelector(`${sel}="${key}"]`);
    q('[data-path')?.setAttribute('d', geo.d);
    q('[data-hit')?.setAttribute('d', geo.d);
    q('[data-head')?.setAttribute('d', geo.head?.d ?? '');
    q('[data-tail')?.setAttribute('d', geo.tail?.d ?? '');
    const lb = q('[data-label') as HTMLElement | null;
    if (lb) lb.style.transform = `translate(${Math.round(geo.labelAt.x)}px, ${Math.round(geo.labelAt.y)}px) translate(-50%, -50%)`;
  };
  const flowGeo = (l: Link, boxOf: (id: string) => Box | undefined): EdgeGeo | null => {
    const e = model.current.doc.edges.find((x) => x.id === l.key);
    const a = boxOf(l.from), c = boxOf(l.to);
    return e && a && c ? edgeGeo(e, a, shapeOf(l.from), c, shapeOf(l.to)) : null;
  };

  // Devuelve al DOM lo que dice el acomodo (fin o cancelación de un arrastre).
  const restore = (s: Gesture) => {
    const L = model.current.layout;
    busy(false);
    if (s.t === 'drag' && L) {
      for (const [id, el] of s.els) { const b = L.pos.get(id); if (b) el.style.transform = boxCss(b); }
      for (const l of s.drag.touched) {
        if (model.current.doc.kind === 'mapa') s.pathEls.get(l.key)?.setAttribute('d', L.paths.get(l.key) ?? '');
        else { const geo = flowGeo(l, (id) => L.pos.get(id)); if (geo) paintEdge(l.key, geo); }
      }
    }
    if (s.t === 'connect') {
      temp.current?.setAttribute('d', '');
      tempHead.current?.setAttribute('d', '');
      if (s.over) nodeEl(s.over)?.classList.remove('diag-target');
    }
  };
  const cancel = () => { restore(g.current); g.current = { t: 'idle' }; };

  const chipAct = (id: string, side: ChipSide) => {
    if (cb.current.onChip) cb.current.onChip(id, side);
    else cb.current.onEdit({ op: 'addChild', parent: id, text: t('diag.nuevo_nodo') });
  };
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
    const chip = !tel ? (e.target as Element | null)?.closest?.('[data-chip]') as HTMLElement | null : null;
    if (chip) {
      const n = cur.doc.nodes.find((x) => x.id === chip.dataset.node);
      if (n) {
        g.current = { t: 'connect', pid: e.pointerId, from: n.id, key: nodeKey(n), last: w, over: null, side: chip.dataset.chip as ChipSide, start: p, moved: false };
        return;
      }
    }
    const nid = hitNode(L.pos, w);
    const eid = nid || isMap ? null : hitEdge(L.paths, w, TOUCH_R / v.k);
    const target: Target = nid ? { kind: 'node', id: nid } : eid ? { kind: 'edge', id: eid } : { kind: 'bg' };
    g.current = { t: 'press', pid: e.pointerId, start: p, v0: v, target };
  };

  // Hover (solo ratón, sin gesto): el nodo bajo el puntero, con margen para llegar a sus chips.
  const hoverAt = (e: PointerEvent) => {
    const L = model.current.layout;
    if (!L || e.pointerType !== 'mouse' || g.current.t !== 'idle') return;
    const r = board.current!.getBoundingClientRect();
    const v = view.current, w = toWorld(v, { x: e.clientX - r.left, y: e.clientY - r.top });
    const cur = hoverRef.current;
    const hb = cur ? L.pos.get(cur) : undefined;
    const mg = HOVER_KEEP / v.k;
    const next = hb && Math.abs(w.x - hb.x) <= hb.w / 2 + mg && Math.abs(w.y - hb.y) <= Math.max(MIN, hb.h) / 2 + mg ? cur : hitNode(L.pos, w);
    if (next !== cur) { hoverRef.current = next; setHover(next); }
  };
  const hoverRef = useRef<string | null>(null);

  const onMove = (e: PointerEvent) => {
    if (!pts.current.has(e.pointerId)) { hoverAt(e); return; }
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
      busy(true);
    }
    const s2 = g.current;
    if (s2.t === 'pan') apply({ ...s2.v0, x: s2.v0.x + p.x - s2.start.x, y: s2.v0.y + p.y - s2.start.y });
    else if (s2.t === 'drag') {
      const w = toWorld(view.current, p);
      s2.last = w;
      const f = dragFrame(s2.drag, L, w);
      for (const [id, b] of f.boxes) { const el = s2.els.get(id); if (el) el.style.transform = boxCss(b); }
      const cd = model.current.doc;
      for (const l of s2.drag.touched) {
        if (cd.kind === 'mapa') { const d = f.paths.get(l.key); if (d !== undefined) s2.pathEls.get(l.key)?.setAttribute('d', d); }
        else { const geo = flowGeo(l, (id) => f.boxes.get(id) ?? L.pos.get(id)); if (geo) paintEdge(l.key, geo); }
      }
    } else if (s2.t === 'connect') {
      const w = toWorld(view.current, p);
      s2.last = w;
      if (!s2.moved) { if (!isDrag(s2.start, p)) return; s2.moved = true; busy(true); }
      const a = L.pos.get(s2.from);
      const over = hitNode(L.pos, w);
      if (a) {
        const tb = over && over !== s2.from ? L.pos.get(over) : undefined;
        const geo = edgeGeometry({ ...a, h: Math.max(MIN, a.h), shape: shapeOf(s2.from) },
          tb ? { ...tb, h: Math.max(MIN, tb.h), shape: shapeOf(over!) } : { x: w.x, y: w.y, w: 2, h: 2 }, 'curva', { width: 2, ends: 'flecha' });
        temp.current?.setAttribute('d', geo.d);
        tempHead.current?.setAttribute('d', geo.head?.d ?? '');
      }
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
    busy(false);
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
      if (!s.moved) { if (from) chipAct(from, s.side); }
      else if (from && to && to !== from) cb.current.onEdit({ op: 'connect', from, to });
      else if (from && !to) cb.current.onChipDrop?.(from, s.side, s.last);
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
  const tel = phone ?? isPhone();

  const nodes = doc.nodes.filter((n) => layout.pos.has(n.id)).map((n) => {
    const p = layout.pos.get(n.id)!;
    const on = live?.type === 'node' && live.id === n.id;
    const cls = nodeClass(n, isMap, !!n.folded && hasKids.has(n.id), on ? ' diag-sel' : '');
    return (
      <div key={n.id} data-id={n.id} class={cls} role="button" tabIndex={0} aria-pressed={on}
        style={{ width: `${Math.round(p.w)}px`, height: `${Math.max(MIN, Math.round(p.h))}px`, fontSize: nodeFont(n), transform: boxCss(p) }}>
        <NodeText n={n} />
      </div>
    );
  });

  const paths: JSX.Element[] = [];
  const labels: JSX.Element[] = [];
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  if (isMap) {
    for (const [id, d] of layout.paths) paths.push(<path key={id} data-path={id} class="diag-edge diag-w2" d={d} />);
  } else {
    for (const e of doc.edges) {
      const a = layout.pos.get(e.from), c = layout.pos.get(e.to);
      if (!a || !c) continue;
      const geo = edgeGeo(e, a, byId.get(e.from)?.shape, c, byId.get(e.to)?.shape);
      paths.push(<EdgeG key={e.id} e={e} geo={geo} on={live?.type === 'edge' && live.id === e.id} />);
      if (e.label) {
        labels.push(<span key={e.id} class="diag-label" data-label={e.id} data-user-content
          style={{ transform: `translate(${Math.round(geo.labelAt.x)}px, ${Math.round(geo.labelAt.y)}px) translate(-50%, -50%)` }}>{inline(e.label)}</span>);
      }
    }
  }

  // Chips «+»: nodo seleccionado o con hover (ratón); nunca en teléfono. Mapa: solo hacia afuera de la rama.
  const chipNodes = tel ? [] : [...new Set([live?.type === 'node' ? live.id : null, hover].filter((x): x is string => !!x))];
  const sidesOf = (id: string): ChipSide[] => {
    const n = byId.get(id), bx = layout.pos.get(id);
    if (!n || !bx) return [];
    if (!isMap) return ['arriba', 'abajo', 'izquierda', 'derecha'];
    const pb = n.parent ? layout.pos.get(n.parent) : undefined;
    if (pb) return [bx.x < pb.x ? 'izquierda' : 'derecha'];
    const left = doc.nodes.some((c) => c.parent === id && (layout.pos.get(c.id)?.x ?? bx.x) < bx.x);
    return left ? ['izquierda', 'derecha'] : ['derecha'];
  };
  const chips: JSX.Element[] = [];
  for (const id of chipNodes) {
    const bx = layout.pos.get(id);
    if (!bx) continue;
    const hh = Math.max(MIN, bx.h) / 2, hw = bx.w / 2;
    const half = CHIP_ZONE / 2, d = CHIP_GAP + CHIP_DOT / 2; // la zona (origen = esquina sup. izq.) se centra a `d` del borde
    for (const side of sidesOf(id)) {
      const [ax, ay, dx, dy] = side === 'derecha' ? [bx.x + hw, bx.y, d - half, -half]
        : side === 'izquierda' ? [bx.x - hw, bx.y, -d - half, -half]
        : side === 'abajo' ? [bx.x, bx.y + hh, -half, d - half]
        : [bx.x, bx.y - hh, -half, -d - half];
      chips.push(
        <button type="button" key={id + side} class="diag-chip" data-chip={side} data-node={id} aria-label={t(CHIP_KEY[side])}
          style={{ transform: `translate(${Math.round(ax)}px, ${Math.round(ay)}px) scale(var(--diag-inv, 1)) translate(${dx}px, ${dy}px)` }}
          onClick={(ev) => { if ((ev as MouseEvent).detail === 0) chipAct(id, side); }}>
          <span class="diag-chip-dot"><Plus size={14} aria-hidden="true" /></span>
        </button>,
      );
    }
  }

  return (
    <div class="diag-board-wrap">
      <div ref={board} class={'diag-board glass' + backdropClass(backdrop ?? m.backdrop)} role="application" aria-label={label}
        aria-roledescription={tx('diag.lienzo', 'lienzo')}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}
        onPointerLeave={(e) => { if ((e as PointerEvent).pointerType === 'mouse' && g.current.t === 'idle') { hoverRef.current = null; setHover(null); } }}>
        <div ref={stage} class="diag-board-stage">
          <svg class="diag-svg" aria-hidden="true" focusable="false"
            style={{ left: `${sx}px`, top: `${sy}px`, width: `${W}px`, height: `${H}px` }} viewBox={`${sx} ${sy} ${W} ${H}`}>
            {paths}
            <path ref={temp} class="diag-temp" d="" />
            <path ref={tempHead} class="diag-temp-head" d="" />
          </svg>
          {nodes}
          {labels}
          {chips.length > 0 && <div class="diag-chips">{chips}</div>}
        </div>
      </div>
      {tools}
    </div>
  );
}
