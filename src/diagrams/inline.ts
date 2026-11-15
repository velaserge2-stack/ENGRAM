// Edición en el sitio (CONTRATO §P22.6), parte pura: qué edición sale de un borrador, el texto «de vista
// previa» (con el fantasma dentro, sin escribir el archivo), pegar listas, doble toque, vecinos con flechas
// y el zoom propio del lienzo de diagramas (hasta 400 %, sin tocar el `ZOOM_MAX` compartido del Lienzo).
import { ZOOM_MIN, type View } from '../lib/canvaszoom';
import { applyEdit, parseOutline } from './edit';
import { parseDiagram } from './parse';
import { serializeDiagram } from './serialize';
import type { DiagramDoc, DiagramKind, Edit, NodeAttrs, Shape } from './types';

/** `new` = «fantasma»: no entra en el documento hasta confirmar. `label` = etiqueta de una flecha. */
export type Inline =
  | { mode: 'edit'; id: string; text: string; orig: string }
  | { mode: 'new'; parent?: string; after?: string; shape: Shape; x?: number; y?: number; text: string; attrs?: NodeAttrs }
  | { mode: 'label'; id: string; text: string; orig: string };

/** Tope de líneas pegadas en flujo/diagrama (cada una reanaliza el documento). */
export const MAX_PASTE = 500;

/** Relleno invisible del fantasma vacío: lo acepta el formato y mide el mínimo (no se escribe nunca). */
const GHOST = '​';
const clean = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ').trim();

const OPEN: Record<Shape, string> = { rect: '[', round: '(', diamond: '{', io: '[/', note: '<<' };
const CLOSE: Record<Shape, string> = { rect: ']', round: ')', diamond: '}', io: '/]', note: '>>' };
const LAST: Record<Shape, string> = { rect: ']', round: ')', diamond: '}', io: ']', note: '>' };

/** Nodo suelto de flujo/diagrama (sin padre), con posición opcional: una línea al final. */
export function looseLine(doc: DiagramDoc, shape: Shape, text: string, x?: number, y?: number): Edit {
  const n = doc.lines.length;
  const at = n > 1 && doc.lines[n - 1]!.raw === '' ? n - 1 : n;
  const body = clean(text).replace(/\\/g, '\\\\').split(LAST[shape]).join('\\' + LAST[shape]);
  const pos = x !== undefined && y !== undefined ? ` {x=${Math.round(x)},y=${Math.round(y)}}` : '';
  return { op: 'splice', at, remove: 0, insert: [OPEN[shape] + body + CLOSE[shape] + pos] };
}

/** La edición que produciría el borrador `text` (sin validar). */
export function draftEdit(doc: DiagramDoc, inl: Inline, text: string): Edit | null {
  if (inl.mode === 'edit') return { op: 'rename', id: inl.id, text };
  if (inl.mode === 'label') return { op: 'label', id: inl.id, label: text };
  const map = doc.kind === 'mapa';
  const pos = inl.x !== undefined && inl.y !== undefined ? { x: Math.round(inl.x), y: Math.round(inl.y) } : undefined;
  const attrs = pos || inl.attrs ? { ...inl.attrs, ...pos } : undefined;
  const extra = { ...(map ? {} : { shape: inl.shape }), ...(attrs ? { attrs } : {}) };
  if (inl.parent) return { op: 'addChild', parent: inl.parent, text, ...extra };
  if (inl.after) return { op: 'addSibling', id: inl.after, text, ...extra };
  return map ? null : looseLine(doc, inl.shape, text, inl.x, inl.y);
}

/** Id del nodo que creó `e` al pasar de `before` a `after` (mapa: la línea insertada; flujo: el último). */
function createdId(before: DiagramDoc, after: DiagramDoc, inv: Edit[], text: string, shape: Shape): string | null {
  if (after.kind === 'mapa') {
    const at = inv[0]?.op === 'splice' ? inv[0].at : -1;
    return after.nodes.find((n) => n.line === at)?.id ?? null;
  }
  if (after.nodes.length > before.nodes.length) return after.nodes[after.nodes.length - 1]!.id;
  const t = clean(text);
  return after.nodes.find((n) => n.shape === shape && n.text === t)?.id ?? null; // ya existía (mismo texto y forma)
}

/** Texto con el borrador aplicado, para pintar el nodo creciendo (o el fantasma) sin escribir el archivo. */
export function previewText(text: string, kind: DiagramKind, inl: Inline): { text: string; id: string | null } {
  if (inl.mode === 'label') return { text, id: null };
  const doc = parseDiagram(text, kind).doc;
  const tries = inl.mode === 'edit' ? [inl.text] : [inl.text, GHOST];
  for (const s of tries) {
    if (!clean(s)) continue;
    const e = draftEdit(doc, inl, s);
    const r = e && applyEdit(doc, e);
    if (!r || !r.inverse.length) continue;
    const id = inl.mode === 'edit' ? inl.id : createdId(doc, r.doc, r.inverse, s, inl.shape);
    return { text: serializeDiagram(r.doc), id };
  }
  return { text, id: inl.mode === 'edit' ? inl.id : null };
}

export interface Commit { edits: Edit[]; text: string; id: string | null }

/** Confirmar: `rename` solo si cambió (vacío = se restaura); fantasma vacío = nada; etiqueta = `label`. */
export function commitInline(text: string, kind: DiagramKind, inl: Inline): Commit {
  const none: Commit = { edits: [], text, id: inl.mode === 'new' ? null : inl.id };
  const doc = parseDiagram(text, kind).doc;
  const t = clean(inl.text);
  if (inl.mode === 'edit' && (!t || t === clean(inl.orig))) return none;
  if (inl.mode === 'new' && !t) return none;
  if (inl.mode === 'label' && t === clean(inl.orig)) return none;
  const e = draftEdit(doc, inl, t);
  const r = e && applyEdit(doc, e);
  if (!e || !r || !r.inverse.length) return none;
  const id = inl.mode === 'new' ? createdId(doc, r.doc, r.inverse, t, inl.shape) : inl.id;
  return { edits: [e], text: serializeDiagram(r.doc), id };
}

/**
 * Pegar varias líneas (o una lista con sangría): mapa = UN `addTree`; flujo = una cadena de `addChild`
 * (el padre de cada uno sale de aplicar los anteriores). Una sola línea → null (pegado normal).
 */
export function pasteEdits(text: string, kind: DiagramKind, base: { parent?: string; after?: string; shape?: Shape }, pasted: string): { edits: Edit[]; count: number } | null {
  if (!/\r|\n/.test(pasted.trim())) return null;
  const items = parseOutline(pasted);
  if (items.length < 2 || (kind !== 'mapa' && items.length > MAX_PASTE)) return null;
  let doc = parseDiagram(text, kind).doc;
  if (kind === 'mapa') {
    const parent = base.parent ?? doc.nodes.find((n) => n.id === base.after)?.parent;
    if (!parent) return null;
    const e: Edit = { op: 'addTree', parent, items };
    return applyEdit(doc, e).inverse.length ? { edits: [e], count: items.length } : null;
  }
  const edits: Edit[] = [];
  const chain: (string | undefined)[] = []; // id del último nodo creado en cada profundidad
  const shape = base.shape ?? 'rect';
  for (const it of items) {
    const parent = it.depth === 0 ? base.parent : chain[it.depth - 1];
    const e: Edit = parent ? { op: 'addChild', parent, text: it.text, shape } : looseLine(doc, shape, it.text);
    const r = applyEdit(doc, e);
    if (!r.inverse.length) return null;
    chain[it.depth] = createdId(doc, r.doc, r.inverse, it.text, shape) ?? undefined;
    chain.length = it.depth + 1;
    doc = r.doc;
    edits.push(e);
  }
  return { edits, count: items.length };
}

/** Doble toque: dos toques a menos de 300 ms y 10 px. */
export interface Tap { t: number; x: number; y: number }
export const isDoubleTap = (a: Tap | null, b: Tap) => !!a && b.t - a.t >= 0 && b.t - a.t < 300 && Math.hypot(b.x - a.x, b.y - a.y) < 10;

type Pos = Map<string, { x: number; y: number }>;
/** Nodo vecino en una dirección (flechas al terminar de editar): el más cercano dentro de un cono de ±60°. */
export function neighbor(pos: Pos, id: string, dx: number, dy: number): string | null {
  const a = pos.get(id);
  if (!a) return null;
  let best: string | null = null, score = Infinity;
  for (const [k, b] of pos) {
    if (k === id) continue;
    const vx = b.x - a.x, vy = b.y - a.y, d = Math.hypot(vx, vy);
    const along = vx * dx + vy * dy;
    if (d === 0 || along <= d * 0.5) continue;
    const s = d + (d - along) * 2;
    if (s < score) { score = s; best = k; }
  }
  return best;
}

// --- Zoom propio del diagrama: 0.1–4 (el compartido de canvaszoom llega a 3) ---
export const DIAG_ZOOM_MAX = 4;
export const clampZoom4 = (k: number) => Math.min(DIAG_ZOOM_MAX, Math.max(ZOOM_MIN, k));
/** Amortigua el último tramo antes de cada tope (como canvaszoom), con el tope del diagrama. */
function resist4(k: number, f: number): number {
  const M = DIAG_ZOOM_MAX;
  if (f < 1 && k < ZOOM_MIN * 2) return f ** Math.max(0.15, (k - ZOOM_MIN) / ZOOM_MIN);
  if (f > 1 && k > M / 1.5) return f ** Math.max(0.15, (M - k) / (M - M / 1.5));
  return f;
}
export function zoomAt4(v: View, f: number, cx: number, cy: number, soft = true): View {
  if (!Number.isFinite(f) || f <= 0) return v;
  const k = clampZoom4(v.k * (soft ? resist4(v.k, f) : f));
  const r = k / v.k;
  if (r === 1) return v;
  return { k, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r };
}
/** Botones ±: factor fijo sin amortiguar (llega exactamente al tope). */
export const zoomBy4 = (v: View, f: number, w: number, h: number) => zoomAt4(v, f, w / 2, h / 2, false);
export function wheel4(v: View, dx: number, dy: number, zoom: boolean, at: { x: number; y: number }): View {
  if (zoom) return zoomAt4(v, Math.exp(-dy * 0.01), at.x, at.y);
  return { ...v, x: v.x - dx, y: v.y - dy };
}
type P = { x: number; y: number };
export function pinch4(v0: View, a0: P, b0: P, a1: P, b1: P): View {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y), d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const k = clampZoom4(v0.k * (d0 > 0 && d1 > 0 ? d1 / d0 : 1));
  const wx = ((a0.x + b0.x) / 2 - v0.x) / v0.k, wy = ((a0.y + b0.y) / 2 - v0.y) / v0.k;
  return { k, x: (a1.x + b1.x) / 2 - wx * k, y: (a1.y + b1.y) / 2 - wy * k };
}

/** Paneo mínimo para que la caja (centro en el mundo) quede dentro del área visible (px del lienzo). */
export function ensureVisible(v: View, b: { x: number; y: number; w: number; h: number }, area: { x0: number; y0: number; x1: number; y1: number }, margin = 16): View {
  if (area.x1 - area.x0 <= 2 * margin || area.y1 - area.y0 <= 2 * margin) return v;
  const l = (b.x - b.w / 2) * v.k + v.x, r = (b.x + b.w / 2) * v.k + v.x;
  const t = (b.y - b.h / 2) * v.k + v.y, bo = (b.y + b.h / 2) * v.k + v.y;
  const shift = (lo: number, hi: number, a0: number, a1: number) =>
    hi - lo > a1 - a0 - 2 * margin ? a0 + margin - lo : lo < a0 + margin ? a0 + margin - lo : hi > a1 - margin ? a1 - margin - hi : 0;
  const dx = shift(l, r, area.x0, area.x1), dy = shift(t, bo, area.y0, area.y1);
  return dx || dy ? { ...v, x: v.x + dx, y: v.y + dy } : v;
}
