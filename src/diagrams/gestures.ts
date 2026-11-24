// Lógica pura de los gestos del lienzo de diagramas (sin DOM, sin estado). Coordenadas del «mundo» = las del
// acomodo (`Layout.pos` guarda el CENTRO de cada nodo); pantalla = mundo · k + (x, y).
import { clampZoom, zoomAt, type View } from '../lib/canvaszoom';
import type { DiagramDoc, Layout } from './types';

export type { View };
export interface Pt { x: number; y: number }
export type Box = { x: number; y: number; w: number; h: number };

/** Umbral (px de pantalla) que separa un toque de un arrastre. */
export const DRAG_SLOP = 8;
/** Radio táctil (px de pantalla): 22 → objetivo de 44 px. */
export const TOUCH_R = 22;
/** Tope de ampliación de «Ajustar» (300 %); el zoom manual llega a `ZOOM_MAX` (canvaszoom). */
export const FIT_MAX = 3;
/** Alto (px) permitido del lienzo en un bloque o embed (CONTRATO §P22.1: 160–2000). */
export const H_MIN = 160, H_MAX = 2000;
/** Alto mínimo del lienzo de una nota de diagrama completa. */
export const FILL_MIN = 360;

export const clampHeight = (h: number) => Math.min(H_MAX, Math.max(H_MIN, Math.round(h)));
/** Alto del lienzo de una nota completa: lo que queda de la ventana desde el borde superior del tablero. */
export const fillHeight = (innerH: number, top: number, bottom = 16) => Math.max(FILL_MIN, Math.floor(innerH - Math.max(0, top) - bottom));

/** Ventana visual (pellizco de la página): posición de la barra flotante para que siga fija y del mismo tamaño en pantalla.
 *  Sin zoom de página (escala ≈ 1) devuelve null: manda el CSS (`bottom` + `--kb-inset`). Abajo-centro de la ventana visual, con margen. */
export interface VV { scale: number; offsetLeft: number; offsetTop: number; width: number; height: number }
export function fbarPlace(vv: VV, margin = 12): { left: number; top: number; scale: number } | null {
  if (!(vv.scale > 1.01)) return null;
  const k = 1 / vv.scale;
  return { left: vv.offsetLeft + vv.width / 2, top: vv.offsetTop + vv.height - margin * k, scale: k };
}

/** Dentro de `el` el pellizco (ctrl+rueda del trackpad, `gesture*` de Safari) no escala la página: la barra y los controles no se pierden. */
export function blockPageZoom(el: HTMLElement): () => void {
  const wheel = (e: WheelEvent) => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
  const no = (e: Event) => e.preventDefault();
  const G = ['gesturestart', 'gesturechange', 'gestureend'];
  el.addEventListener('wheel', wheel, { passive: false });
  for (const g of G) el.addEventListener(g, no);
  return () => { el.removeEventListener('wheel', wheel); for (const g of G) el.removeEventListener(g, no); };
}

export const isDrag = (a: Pt, b: Pt, slop = DRAG_SLOP) => Math.hypot(b.x - a.x, b.y - a.y) >= slop;

export const toWorld = (v: View, p: Pt): Pt => ({ x: (p.x - v.x) / v.k, y: (p.y - v.y) / v.k });
export const toScreen = (v: View, p: Pt): Pt => ({ x: p.x * v.k + v.x, y: p.y * v.k + v.y });

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * Pellizco y dos dedos a la vez: el punto del mundo bajo el punto medio inicial queda bajo el punto medio
 * actual, y la escala sigue la razón de distancias (con los topes de `canvaszoom`).
 */
export function pinch(v0: View, a0: Pt, b0: Pt, a1: Pt, b1: Pt): View {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const f = d0 > 0 && d1 > 0 ? d1 / d0 : 1;
  const k = clampZoom(v0.k * f);
  const w = toWorld(v0, mid(a0, b0));
  const m = mid(a1, b1);
  return { k, x: m.x - w.x * k, y: m.y - w.y * k };
}

/** Rueda: con Ctrl/Cmd (o pellizco del trackpad, que Safari/Chrome mandan con ctrlKey) acerca; si no, desplaza. */
export function wheel(v: View, dx: number, dy: number, zoom: boolean, at: Pt): View {
  if (zoom) return zoomAt(v, Math.exp(-dy * 0.01), at.x, at.y);
  return { ...v, x: v.x - dx, y: v.y - dy };
}

/**
 * Vista que encuadra `b` en un lienzo de w × h con margen `pad`; sin tamaño aún → escala 1 en el margen.
 * Escala hasta `FIT_MAX`. En cada eje, si el contenido llena ≥ 85 % se centra; si queda mucho más chico se
 * alinea arriba-izquierda con margen (no flota en el centro).
 */
export function fitView(b: Box, w: number, h: number, pad = 24): View {
  if (!(w > 0 && h > 0)) return { k: 1, x: pad - b.x, y: pad - b.y };
  const k = clampZoom(Math.min(FIT_MAX, (w - pad * 2) / Math.max(1, b.w), (h - pad * 2) / Math.max(1, b.h)));
  const place = (size: number, o: number, len: number) => {
    const free = size - len * k;
    return (free < size * 0.15 ? free / 2 : pad) - o * k;
  };
  return { k, x: place(w, b.x, b.w), y: place(h, b.y, b.h) };
}

const inBox = (b: Box, p: Pt, m = 0) => Math.abs(p.x - b.x) <= b.w / 2 + m && Math.abs(p.y - b.y) <= b.h / 2 + m;

/** Nodo bajo un punto del mundo (el último pintado gana). `minH` = alto mínimo pintado (44 px). */
export function hitNode(pos: Layout['pos'], p: Pt, minH = 44): string | null {
  let hit: string | null = null;
  for (const [id, b] of pos) if (inBox({ ...b, h: Math.max(minH, b.h) }, p)) hit = id;
  return hit;
}

/** Centro del asa de conectar: a la derecha del nodo, separada su radio en pantalla. */
export const handleAt = (b: Box, k: number): Pt => ({ x: b.x + b.w / 2 + TOUCH_R / k, y: b.y });
export const hitHandle = (b: Box, p: Pt, k: number) => {
  const c = handleAt(b, k);
  return Math.hypot(p.x - c.x, p.y - c.y) <= TOUCH_R / k;
};

// --- Flechas: el trazo del acomodo (`M`, `L`, `C`) como polilínea muestreada ---
export function pathPoints(d: string): Pt[] {
  const tk = d.match(/[MLC]|-?\d+(?:\.\d+)?/g) ?? [];
  const out: Pt[] = [];
  let cmd = '';
  for (let i = 0; i < tk.length;) {
    if (/[MLC]/.test(tk[i]!)) { cmd = tk[i++]!; continue; }
    const n = (j: number) => Number(tk[i + j]);
    if (cmd === 'C') {
      if (i + 5 >= tk.length || !out.length) break;
      const p0 = out[out.length - 1]!, c1 = { x: n(0), y: n(1) }, c2 = { x: n(2), y: n(3) }, p3 = { x: n(4), y: n(5) };
      for (let s = 1; s <= 8; s++) {
        const t = s / 8, u = 1 - t;
        out.push({
          x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
          y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
        });
      }
      i += 6;
    } else {
      if (i + 1 >= tk.length) break;
      out.push({ x: n(0), y: n(1) });
      i += 2;
    }
  }
  return out;
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Flecha más cercana a `p` dentro de `tol` (mundo). */
export function hitEdge(paths: Layout['paths'], p: Pt, tol: number): string | null {
  let best: string | null = null, bd = tol;
  for (const [id, d] of paths) {
    const ps = pathPoints(d);
    for (let i = 1; i < ps.length; i++) {
      const s = segDist(p, ps[i - 1]!, ps[i]!);
      if (s <= bd) { bd = s; best = id; }
    }
  }
  return best;
}

/** Punto donde el segmento centro(a) → `to` sale del rectángulo `a`. */
export function exitPoint(a: Box, to: Pt): Pt {
  const dx = to.x - a.x, dy = to.y - a.y;
  if (!dx && !dy) return { x: a.x, y: a.y };
  const t = Math.min(dx ? a.w / 2 / Math.abs(dx) : Infinity, dy ? a.h / 2 / Math.abs(dy) : Infinity, 1);
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/** Trazo provisional recto entre dos cajas (durante el arrastre; el acomodo real llega al soltar). */
export function straight(a: Box, b: Box): string {
  const p = exitPoint(a, b), q = exitPoint(b, a);
  return `M ${Math.round(p.x)} ${Math.round(p.y)} L ${Math.round(q.x)} ${Math.round(q.y)}`;
}

// --- Arrastre ---
/** Conectores dibujados: clave del trazo en `Layout.paths` y sus extremos. */
export interface Link { key: string; from: string; to: string }
export function links(doc: DiagramDoc): Link[] {
  if (doc.kind === 'mapa') return doc.nodes.filter((n) => n.parent).map((n) => ({ key: n.id, from: n.parent!, to: n.id }));
  return doc.edges.map((e) => ({ key: e.id, from: e.from, to: e.to }));
}

export interface Drag {
  id: string;
  /** Nodos que se mueven con él (mapa: descendientes sin posición propia) y su caja inicial. */
  moving: Map<string, Box>;
  /** Conectores con algún extremo en movimiento. */
  touched: Link[];
  start: Pt; // mundo
}

export function startDrag(doc: DiagramDoc, layout: Layout, all: Link[], id: string, start: Pt): Drag | null {
  const b = layout.pos.get(id);
  if (!b) return null;
  const moving = new Map<string, Box>([[id, b]]);
  if (doc.kind === 'mapa') {
    const idx = doc.nodes.findIndex((n) => n.id === id);
    const me = doc.nodes[idx]!;
    for (let k = idx + 1; k < doc.nodes.length && doc.nodes[k]!.depth > me.depth; k++) {
      const n = doc.nodes[k]!;
      const pb = layout.pos.get(n.id);
      // sigue al padre si no tiene posición propia y su padre también se mueve
      if (pb && n.parent && moving.has(n.parent) && n.x === undefined) moving.set(n.id, pb);
    }
  }
  const touched = all.filter((l) => moving.has(l.from) || moving.has(l.to));
  return { id, moving, touched, start };
}

/** Un fotograma: cajas nuevas de lo que se mueve y trazos provisionales. Coste O(movidos + tocados). */
export function dragFrame(d: Drag, layout: Layout, p: Pt): { boxes: Map<string, Box>; paths: Map<string, string> } {
  const dx = p.x - d.start.x, dy = p.y - d.start.y;
  const boxes = new Map<string, Box>();
  for (const [id, b] of d.moving) boxes.set(id, { ...b, x: b.x + dx, y: b.y + dy });
  const at = (id: string) => boxes.get(id) ?? layout.pos.get(id);
  const paths = new Map<string, string>();
  for (const l of d.touched) {
    const a = at(l.from), b = at(l.to);
    if (a && b) paths.set(l.key, straight(a, b));
  }
  return { boxes, paths };
}

/** Posición final (enteros) del nodo arrastrado. */
export function dropAt(d: Drag, p: Pt): { x: number; y: number } {
  const b = d.moving.get(d.id)!;
  return { x: Math.round(b.x + p.x - d.start.x), y: Math.round(b.y + p.y - d.start.y) };
}

/**
 * Concurrencia: el texto puede cambiar mientras dura el gesto (otra pestaña, deshacer). Devuelve el id actual
 * del nodo que al empezar era `id` con forma+texto `key`; si ya no existe, null (el gesto se descarta).
 */
export const nodeKey = (n: { shape: string; text: string }) => `${n.shape}\u0000${n.text}`;
export function resolveNode(doc: DiagramDoc, id: string, key: string): string | null {
  const same = doc.nodes.find((n) => n.id === id);
  if (same && nodeKey(same) === key) return id;
  return doc.nodes.find((n) => nodeKey(n) === key)?.id ?? null;
}
