// Lienzo interactivo de un diagrama (Pointer Events). El documento es el texto de la nota: aquí solo se
// lee (`text`) y cada gesto termina en UNA operación `Edit` que decide el padre (`onEdit`). Estado propio
// solo de vista: escala, desplazamiento, selección y el gesto en curso. Durante el gesto nada se re-renderiza:
// la vista y el nodo arrastrado se mueven escribiendo `transform`/`d` en el DOM; el acomodo no se recalcula.
// Edición en el sitio (§P22.6): doble clic/doble toque/F2/Intro abren un <textarea> sobre el nodo; un nodo nuevo
// es un «fantasma» (se pinta con el borrador aplicado al texto, sin escribir) hasta confirmar con UNA edición.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Maximize, Plus, ZoomIn, ZoomOut } from 'lucide-preact';
import { raw, t, tn } from '../i18n';
import { isPhone } from '../theme';
import { edgeGeometry, type EdgeGeo } from './edges';
import { EdgeG, MIN, NodeText, backdropClass, buildModel, edgeGeo, inline, nodeClass, nodeFont, useFontsTick } from './view';
import {
  TOUCH_R, dragFrame, dropAt, fitView, hitEdge, hitNode, isDrag, links, nodeKey, resolveNode,
  startDrag, toWorld, type Box, type Drag, type Link, type Pt, type View,
} from './gestures';
import {
  commitInline, ensureVisible, MAX_PASTE, isDoubleTap, neighbor, pasteEdits, pinch4, previewText, wheel4, zoomBy4, type Inline, type Tap,
} from './inline';
import { Handles, nodeMin, sizeEdit } from './handles';
import type { Backdrop, DiagramKind, DiagramNode, Edit } from './types';
import { MAX_TEXT } from './types';
import './diagram.css';

export type DiagramSelection = { type: 'node' | 'edge'; id: string } | null;

/** Lado del nodo por el que sale un chip «+». */
export type ChipSide = 'arriba' | 'abajo' | 'izquierda' | 'derecha';

/** Órdenes desde fuera del lienzo (barra del editor): crear o editar en el sitio y fijar la selección. */
export interface CanvasControl {
  addChild: (id: string) => void;
  addSibling: (id: string) => void;
  addFree: () => void;
  edit: (id: string) => void;
  editLabel: (edgeId: string) => void;
  select: (sel: DiagramSelection) => void;
}

export interface DiagramCanvasProps {
  text: string;
  kind: DiagramKind;
  onEdit: (edit: Edit) => void;
  /** Varias ediciones = UN paso de historial (pegar una lista en un flujo). Sin él, se llama a `onEdit` por cada una. */
  onEdits?: (edits: Edit[]) => void;
  /** Lo rellena el lienzo en cada render (ver `CanvasControl`). */
  control?: { current: CanvasControl | null };
  onSelect?: (sel: DiagramSelection) => void;
  /** Clic en un chip «+» (añadir hijo hacia ese lado). Sin él, crea un hijo fantasma en edición. */
  onChip?: (nodeId: string, side: ChipSide) => void;
  /** Arrastrar un chip «+» y soltar en el vacío (punto del mundo). Sin él, crea ahí un hijo fantasma en edición. */
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

export function DiagramCanvas({ text, kind, onEdit, onEdits, control, onSelect, onChip, onChipDrop, backdrop, phone }: DiagramCanvasProps): JSX.Element {
  const tick = useFontsTick();
  const [inl, setInlState] = useState<Inline | null>(null);
  const inlRef = useRef<Inline | null>(null);
  const setInl = (v: Inline | null) => { inlRef.current = v; setInlState(v); };
  // Con un editor abierto se pinta el texto con el borrador aplicado (el nodo crece, el fantasma ya está colocado).
  const shown = useMemo(() => (inl ? previewText(text, kind, inl) : { text, id: null }), [text, kind, inl]);
  // Medir una vez por texto (no por fotograma de arrastre: durante el gesto este memo no se recalcula).
  const m = useMemo(() => buildModel(shown.text, kind), [shown.text, kind, tick]);
  const textRef = useRef(text);
  textRef.current = text;
  const [inlKey, setInlKey] = useState(0); // sube al abrir un editor: enfocar y seleccionar todo una vez
  const [say, setSay] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const lastTap = useRef<(Tap & { target: string }) | null>(null);
  const chain = useRef<string | null>(null); // nodo recién confirmado: Intro = hermano, flechas = cambiar de nodo
  const pending = useRef<{ text: string; id: string | null; then?: 'child' } | null>(null);
  const focusNext = useRef<string | null>(null);
  const space = useRef(false);
  const labelAt = useRef(new Map<string, Pt>());
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
  const cb = useRef({ onEdit, onEdits, onSelect, onChip, onChipDrop });
  cb.current = { onEdit, onEdits, onSelect, onChip, onChipDrop };

  const { doc, layout } = m;
  const isMap = kind === 'mapa';
  const editId = inl ? (inl.mode === 'edit' ? inl.id : inl.mode === 'new' ? shown.id : null) : null;
  const live = !inl && sel && (sel.type === 'node' ? layout?.pos.has(sel.id) : doc.edges.some((e) => e.id === sel.id)) ? sel : null;
  const allLinks = useMemo(() => links(doc), [doc]);
  const linksRef = useRef(allLinks);
  linksRef.current = allLinks;

  const emit = (edits: Edit[]) => {
    if (edits.length === 1) cb.current.onEdit(edits[0]!);
    else if (cb.current.onEdits) cb.current.onEdits(edits);
    else for (const e of edits) cb.current.onEdit(e);
  };
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
      apply(wheel4(view.current, e.deltaX, e.deltaY, e.ctrlKey || e.metaKey, { x: e.clientX - r.left, y: e.clientY - r.top }));
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

  const select = (s: DiagramSelection) => { setSel(s); cb.current.onSelect?.(s); };

  // ---- Edición en el sitio ----
  const nodeOf = (id: string) => model.current.doc.nodes.find((x) => x.id === id);
  const open = (v: Inline) => {
    cancel();
    lastTap.current = null;
    setHover(null); hoverRef.current = null;
    setInl(v);
    setInlKey((k) => k + 1);
  };
  /** Nodo nuevo (fantasma) en edición: hijo, hermano o suelto; hereda la forma del origen. */
  const startNew = (rel: 'child' | 'sibling' | 'free', id?: string, pos?: Pt) => {
    if (inlRef.current) return;
    const n = id ? nodeOf(id) : undefined;
    if (rel !== 'free' && !n) return;
    const shape = isMap ? 'rect' : n?.shape ?? 'rect';
    const p = pos ? { x: Math.round(pos.x), y: Math.round(pos.y) } : {};
    if (rel === 'sibling' && n && !(isMap && n.depth === 0)) open({ mode: 'new', after: n.id, shape, text: '', ...p });
    else if (n) open({ mode: 'new', parent: n.id, shape, text: '', ...p });
    else open({ mode: 'new', shape, text: '', ...p });
  };
  const startEdit = (id: string) => {
    const n = nodeOf(id);
    if (!n || inlRef.current) return;
    select({ type: 'node', id });
    open({ mode: 'edit', id, text: n.text, orig: n.text });
  };
  const startLabel = (id: string) => {
    const e = model.current.doc.edges.find((x) => x.id === id);
    if (!e || inlRef.current) return;
    select({ type: 'edge', id });
    open({ mode: 'label', id, text: e.label ?? '', orig: e.label ?? '' });
  };
  /** Doble clic / doble toque en un punto (px del lienzo). */
  const edgeAt = (el: EventTarget | null) => (el as Element | null)?.closest?.('[data-hit]')?.getAttribute('data-hit') ?? null;
  const openAt = (p: Pt, hitEl: EventTarget | null = null) => {
    const L = model.current.layout;
    if (!L || inlRef.current) return;
    const v = view.current, w = toWorld(v, p);
    const nid = hitNode(L.pos, w);
    if (nid) return startEdit(nid);
    if (!isMap) {
      const lab = model.current.doc.edges.find((e) => {
        const at = labelAt.current.get(e.id);
        return at && Math.abs(at.x - w.x) <= 40 / v.k + 20 && Math.abs(at.y - w.y) <= 22 / v.k;
      });
      const eid = lab?.id ?? edgeAt(hitEl) ?? hitEdge(L.paths, w, TOUCH_R / v.k);
      if (eid) return startLabel(eid);
      return startNew('free', undefined, w);
    }
    const cur = sel?.type === 'node' && L.pos.has(sel.id) ? sel.id : model.current.doc.nodes.find((n) => n.depth === 0)?.id;
    if (cur) startNew('child', cur);
  };
  /** Cierra el editor. ok = confirmar (UNA edición o nada); then = encadenar un hijo del nodo confirmado. */
  const finish = (ok: boolean, then?: 'child') => {
    const cur = inlRef.current;
    if (!cur) return;
    setInl(null);
    const origin = cur.mode === 'new' ? cur.parent ?? cur.after ?? null : cur.mode === 'edit' ? cur.id : null;
    if (!ok) { chain.current = origin; focusNext.current = origin ?? '@board'; return; }
    const c = commitInline(textRef.current, kind, cur);
    if (!c.edits.length) {
      if (cur.text.length > MAX_TEXT) setSay(t('diag.texto_largo', { n: MAX_TEXT }));
      else if (cur.mode === 'edit' && then) { chain.current = cur.id; startNew('child', cur.id); return; }
      chain.current = origin;
      focusNext.current = origin ?? '@board';
      return;
    }
    pending.current = { text: c.text, id: cur.mode === 'label' ? null : c.id, then };
    setSay(cur.mode === 'new' ? t('diag.nodo_creado') : t('diag.texto_guardado'));
    emit(c.edits);
  };
  const pasteInto = (txt: string, base: { parent?: string; after?: string; shape?: DiagramNode['shape'] }): boolean => {
    const r = pasteEdits(textRef.current, kind, base, txt);
    if (!r) {
      if (kind !== 'mapa' && txt.split(/\r?\n/).filter((l) => l.trim()).length > MAX_PASTE) setSay(t('diag.pegar_tope', { n: MAX_PASTE }));
      return false;
    }
    setSay(tn('diag.pegar_creadas', r.count));
    emit(r.edits);
    return true;
  };
  const onAreaPaste = (e: ClipboardEvent) => {
    const cur = inlRef.current;
    const txt = e.clipboardData?.getData('text/plain') ?? '';
    if (!cur || cur.mode === 'label') return;
    const base = cur.mode === 'edit' ? { parent: cur.id, shape: nodeOf(cur.id)?.shape } : { parent: cur.parent, after: cur.after, shape: cur.shape };
    if (cur.mode === 'new' && !cur.parent && !cur.after) return; // suelto: se pega como texto
    if (!pasteInto(txt, base)) return;
    e.preventDefault();
    setInl(null);
    focusNext.current = base.parent ?? null;
  };
  const onAreaKey = (e: KeyboardEvent) => {
    e.stopPropagation(); // ni el lienzo ni el editor ven las teclas del cuadro
    if (e.isComposing || composing.current || e.keyCode === 229) return; // IME: Intro elige la conversión
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'Tab') { e.preventDefault(); const cur = inlRef.current; finish(true, e.shiftKey || cur?.mode === 'label' ? undefined : 'child'); }
  };
  const onAreaInput = (e: Event) => {
    const cur = inlRef.current;
    if (cur) setInl({ ...cur, text: (e.target as HTMLTextAreaElement).value });
  };

  // Enfocar y seleccionar todo al abrir (sin desplazar la página: el teclado virtual no mueve la vista).
  useLayoutEffect(() => {
    const el = area.current;
    if (!el || !inlRef.current) return;
    el.value = inlRef.current.text;
    try { el.focus({ preventScroll: true }); } catch { el.focus(); }
    el.select();
  }, [inlKey]);
  // Al llegar el texto confirmado: seleccionar el nodo creado/editado y, con Tab, abrir el siguiente hijo.
  useLayoutEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    if (text !== p.text) return;
    if (!p.id) { focusNext.current = '@board'; return; }
    select({ type: 'node', id: p.id });
    chain.current = p.id;
    if (p.then) startNew('child', p.id);
    else focusNext.current = p.id;
  }, [text]);
  // Foco de vuelta al nodo (o al lienzo) al terminar.
  useLayoutEffect(() => {
    const f = focusNext.current;
    if (!f || inlRef.current) return;
    focusNext.current = null;
    const el = f === '@board' ? board.current : nodeEl(f);
    try { el?.focus({ preventScroll: true }); } catch { el?.focus(); }
  });
  // Mantener visible el nodo en edición: paneo mínimo dentro del lienzo y de la ventana visual (teclado virtual).
  const keepVisible = () => {
    const L = model.current.layout, el = board.current;
    const id = editIdRef.current;
    const b = id ? L?.pos.get(id) : undefined;
    if (!el || !b) return;
    const r = el.getBoundingClientRect();
    const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
    const top = vv ? Math.max(0, vv.offsetTop - r.top) : 0;
    const bottom = vv ? Math.min(r.height, vv.offsetTop + vv.height - r.top) : r.height;
    const next = ensureVisible(view.current, { ...b, h: Math.max(MIN, b.h) }, { x0: 0, y0: top, x1: r.width, y1: bottom });
    if (next !== view.current) apply(next);
  };
  const editIdRef = useRef<string | null>(null);
  editIdRef.current = editId;
  useLayoutEffect(() => { if (inl) keepVisible(); }, [inlKey, layout]);
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
    if (!inl || !vv) return;
    vv.addEventListener('resize', keepVisible);
    vv.addEventListener('scroll', keepVisible);
    return () => { vv.removeEventListener('resize', keepVisible); vv.removeEventListener('scroll', keepVisible); };
  }, [!!inl]);
  useEffect(() => {
    const up = (e: KeyboardEvent) => { if (e.key === ' ') { space.current = false; board.current?.classList.remove('diag-space'); } };
    const blur = () => { space.current = false; board.current?.classList.remove('diag-space'); };
    addEventListener('keyup', up);
    addEventListener('blur', blur);
    return () => { removeEventListener('keyup', up); removeEventListener('blur', blur); };
  }, []);

  const chipAct = (id: string, side: ChipSide) => {
    if (cb.current.onChip) cb.current.onChip(id, side);
    else startNew('child', id);
  };
  if (control) {
    control.current = {
      addChild: (id) => startNew('child', id),
      addSibling: (id) => startNew('sibling', id),
      addFree: () => startNew('free'),
      edit: startEdit,
      editLabel: startLabel,
      select: (s2) => { select(s2); if (s2?.type === 'node') focusNext.current = s2.id; },
    };
  }

  const onDown = (e: PointerEvent) => {
    const L = model.current.layout;
    if (!L || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if ((e.target as Element | null)?.closest?.('.diag-inline')) return; // sobre el editor: ni paneo, ni arrastre, ni pellizco
    if (inlRef.current) { e.preventDefault(); finish(true); return; } // tocar fuera = confirmar
    chain.current = null;
    const r = board.current!.getBoundingClientRect();
    rect.current = { left: r.left, top: r.top };
    const p = local(e);
    pts.current.set(e.pointerId, p);
    try { board.current!.setPointerCapture(e.pointerId); } catch { /* sin captura (pruebas) */ }
    if (pts.current.size === 2) { // segundo dedo: lo que hubiera en curso se descarta (sin Edit) y empieza el pellizco
      cancel();
      const [[a, a0], [b, b0]] = [...pts.current] as [[number, Pt], [number, Pt]];
      g.current = { t: 'pinch', a, b, a0, b0, v0: view.current };
      lastTap.current = null;
      return;
    }
    if (pts.current.size > 2 || g.current.t !== 'idle') return;
    const v = view.current;
    if (space.current && e.pointerType === 'mouse') { g.current = { t: 'pan', pid: e.pointerId, start: p, v0: v }; busy(true); return; } // espacio + arrastre
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
    // la flecha pintada (curva de edgeGeometry) manda: su trazo de 44 px dice qué flecha es; si no, el cálculo
    const eid = nid || isMap ? null : edgeAt(e.target) ?? hitEdge(L.paths, w, TOUCH_R / v.k);
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
      if (a1 && b1) apply(pinch4(s.v0, s.a0, s.b0, a1, b1));
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
      const key = tg.kind === 'bg' ? 'bg' : tg.kind + ':' + tg.id;
      const tap = { t: performance.now(), x: s.start.x, y: s.start.y, target: key };
      // Doble toque (dedo o lápiz; el ratón usa dblclick): dos toques < 300 ms y < 10 px sobre lo mismo.
      if (e.pointerType !== 'mouse' && lastTap.current?.target === key && isDoubleTap(lastTap.current, tap)) {
        lastTap.current = null;
        if (tg.kind === 'edge') startLabel(tg.id); else openAt(s.start);
        return;
      }
      lastTap.current = tap;
      // Teléfono: tocar el nodo ya seleccionado lo edita (toques simples).
      if ((phone ?? isPhone()) && tg.kind === 'node' && live?.type === 'node' && live.id === tg.id) { startEdit(tg.id); return; }
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
      else if (from && !to) {
        if (cb.current.onChipDrop) cb.current.onChipDrop(from, s.side, s.last);
        else startNew('child', from, s.last);
      }
    }
  };

  // Teclado: alternativa al arrastre (WCAG 2.5.7). Enter/Espacio selecciona; flechas mueven (una `move` por pulsación).
  // F2/Intro editan el nodo seleccionado; Intro tras confirmar = hermano; Tab = hijo; espacio sostenido + arrastre = paneo.
  const onKey = (e: KeyboardEvent) => {
    if (inlRef.current) return;
    if (e.key === 'Escape') { cancel(); chain.current = null; select(null); return; }
    const id = (e.target as HTMLElement).dataset?.id;
    if (e.key === ' ' && !e.repeat) { space.current = true; board.current?.classList.add('diag-space'); }
    if (e.key === ' ' && !id) { e.preventDefault(); return; }
    if (!id || !layout) return;
    const n = doc.nodes.find((x) => x.id === id);
    if (!n) return;
    const selected = live?.type === 'node' && live.id === id;
    if (e.key === 'F2') { e.preventDefault(); chain.current = null; startEdit(id); return; }
    if (e.key === 'Tab' && !e.shiftKey && !e.altKey && selected) { e.preventDefault(); startNew('child', id); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!selected) { select({ type: 'node', id }); return; }
      if (chain.current === id && !(isMap && n.depth === 0)) startNew('sibling', id);
      else { chain.current = null; startEdit(id); }
      return;
    }
    if (e.key === ' ') { e.preventDefault(); select({ type: 'node', id }); return; }
    const dir: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dir[e.key];
    const b = layout.pos.get(id);
    if (!d || !b) return;
    if (chain.current === id) { // al terminar de editar, las flechas cambian de nodo
      e.preventDefault();
      const to = neighbor(layout.pos, id, d[0], d[1]);
      if (to) { chain.current = to; select({ type: 'node', id: to }); nodeEl(to)?.focus({ preventScroll: true }); }
      return;
    }
    if ((isMap && n.depth === 0) || (phone ?? isPhone())) return;
    e.preventDefault();
    onEdit({ op: 'move', id, x: Math.round(b.x + d[0] * STEP), y: Math.round(b.y + d[1] * STEP) });
  };
  const onBoardPaste = (e: ClipboardEvent) => {
    if (inlRef.current || live?.type !== 'node') return;
    const n = nodeOf(live.id);
    if (n && pasteInto(e.clipboardData?.getData('text/plain') ?? '', { parent: n.id, shape: n.shape })) e.preventDefault();
  };
  const onDbl = (e: MouseEvent) => {
    if ((e.target as Element | null)?.closest?.('.diag-inline, .diag-chip')) return;
    const r = board.current!.getBoundingClientRect();
    e.preventDefault();
    openAt({ x: e.clientX - r.left, y: e.clientY - r.top }, e.target);
  };

  const tools = (
    <div class="diag-tools glass">
      <button type="button" class="btn icon ghost" aria-label={t('pdf.alejar')} onClick={() => { const { w, h } = size(); apply(zoomBy4(view.current, 1 / 1.25, w, h)); }}><ZoomOut size={20} aria-hidden="true" /></button>
      <button type="button" class="btn icon ghost" aria-label={t('pdf.acercar')} onClick={() => { const { w, h } = size(); apply(zoomBy4(view.current, 1.25, w, h)); }}><ZoomIn size={20} aria-hidden="true" /></button>
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

  // Cuadro de edición: dentro del nodo (hereda fondo, color y fuente), escalado con el lienzo. Su font-size calculado
  // es ≥ 16 px (iOS no amplía al enfocar): se agranda ×s y se compensa con scale(1/s), así se ve igual que el nodo.
  const areaProps = (label: string) => ({
    ref: area, class: 'diag-inline', role: 'textbox' as const, 'aria-label': label, 'aria-multiline': true, 'data-user-content': true,
    spellcheck: true, rows: 1, onInput: onAreaInput, onKeyDown: onAreaKey, onPaste: onAreaPaste, onBlur: () => finish(true),
    onCompositionStart: () => { composing.current = true; }, onCompositionEnd: () => { composing.current = false; },
  });
  const nodeEditor = (n: DiagramNode, p: Box) => {
    const fp = parseFloat(nodeFont(n)) || 15, s = Math.max(1, 16 / fp);
    const bw = !isMap ? (n.shape === 'diamond' ? 0 : 2) : n.depth <= 1 ? 2 : 1;
    const w = Math.max(1, p.w - 2 * bw), hh = Math.max(1, Math.max(MIN, p.h) - 2 * bw);
    const px = !isMap && n.shape === 'diamond' ? p.w * (1 - Math.SQRT1_2) / 2 + 12 : (!isMap && (n.shape === 'round' || n.shape === 'io') ? 20 : 12) - bw;
    const lines = Math.max(1, m.measured.get(n.id)?.lines.length ?? 1, (inl?.text.match(/\n/g)?.length ?? 0) + 1);
    const py = Math.max(0, (hh - lines * 1.3 * fp) / 2);
    return (
      <textarea {...areaProps(t('diag.editar_texto_nodo'))}
        style={{ width: `${w * s}px`, height: `${hh * s}px`, fontSize: `${fp * s}px`, padding: `${py * s}px ${Math.max(0, px) * s}px`, transform: `scale(${1 / s})` }} />
    );
  };

  const nodes = doc.nodes.filter((n) => layout.pos.has(n.id)).map((n) => {
    const p = layout.pos.get(n.id)!;
    const on = live?.type === 'node' && live.id === n.id;
    const ed = editId === n.id;
    const ghost = ed && inl?.mode === 'new';
    const cls = nodeClass(n, isMap, !!n.folded && hasKids.has(n.id), (on ? ' diag-sel' : '') + (ed ? ' diag-editing' : '') + (ghost ? ' diag-ghost' : ''));
    return (
      <div key={n.id} data-id={n.id} class={cls} role={ed ? 'group' : 'button'} tabIndex={ed ? -1 : 0} aria-pressed={ed ? undefined : on}
        style={{ width: `${Math.round(p.w)}px`, height: `${Math.max(MIN, Math.round(p.h))}px`, fontSize: nodeFont(n), transform: boxCss(p) }}>
        {ghost ? <span class="diag-text" /> : <NodeText n={n} />}
        {ed && nodeEditor(n, p)}
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
      labelAt.current.set(e.id, geo.labelAt);
      if (inl?.mode === 'label' && inl.id === e.id) {
        const s = 16 / 12, ww = Math.min(480, Math.max(96, inl.text.length * 7 + 40));
        labels.push(<textarea key={'ed' + e.id} {...areaProps(t('diag.editar_etiqueta'))} data-edge={e.id}
          style={{ width: `${ww * s}px`, height: `${28 * s}px`, fontSize: `${12 * s}px`, padding: `${5 * s}px ${8 * s}px`,
            transform: `translate(${Math.round(geo.labelAt.x)}px, ${Math.round(geo.labelAt.y)}px) translate(-50%, -50%) scale(${1 / s})` }} />);
      } else if (e.label) {
        labels.push(<span key={e.id} class="diag-label" data-label={e.id} data-user-content
          style={{ transform: `translate(${Math.round(geo.labelAt.x)}px, ${Math.round(geo.labelAt.y)}px) translate(-50%, -50%)` }}>{inline(e.label)}</span>);
      }
    }
  }

  // Asas de redimensionar: solo el nodo seleccionado, sin editar en el sitio y fuera del teléfono.
  const handleNode = !inl && live?.type === 'node' ? byId.get(live.id) : undefined;

  // Chips «+»: nodo seleccionado o con hover (ratón); nunca en teléfono. Mapa: solo hacia afuera de la rama.
  const chipNodes = tel || inl ? [] : [...new Set([live?.type === 'node' ? live.id : null, hover].filter((x): x is string => !!x))];
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
        tabIndex={-1} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}
        onDblClick={onDbl} onPaste={onBoardPaste}
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
          {handleNode && !tel && (
            <Handles key={handleNode.id} id={handleNode.id} box={layout.pos.get(handleNode.id)!} min={nodeMin(handleNode, kind)} scale={() => view.current.k}
              nodeEl={() => stage.current?.querySelector<HTMLElement>(`.diag-node[data-id="${handleNode.id}"]`) ?? null}
              onCommit={(id, s) => emit([sizeEdit(id, s)])} />
          )}
          {chips.length > 0 && <div class="diag-chips">{chips}</div>}
        </div>
      </div>
      {tools}
      <div class="sr-only" role="status" aria-live="polite">{say}</div>
    </div>
  );
}
