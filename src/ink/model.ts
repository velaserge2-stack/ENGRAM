/**
 * Motor de tinta compartido (Prompt 5 · B): modelo puro, sin DOM.
 *
 * Los trazos se guardan VECTORIALES (puntos, presión, color, grosor) y normalizados al
 * ANCHO de la superficie: x e y van en «anchos» (0–1 en x; y crece hacia abajo). Así el
 * dibujo sobrevive al zoom, a la rotación de la pantalla y a un lienzo que crece hacia abajo.
 * El contorno suave lo calcula perfect-freehand (MIT) con el grosor según la presión.
 */
import { getStroke } from 'perfect-freehand';

export type Tool = 'pen' | 'highlighter' | 'eraser' | 'lasso';
export type FingerMode = 'pencil' | 'scroll' | 'draw';
export type Pt = [number, number, number]; // x, y (en anchos), presión 0–1

export interface Stroke { id: string; tool: 'pen' | 'highlighter'; color: string; size: number; pts: Pt[]; simulated?: boolean }
export interface InkDoc { v: 1; strokes: Stroke[] }
export const emptyInk = (): InkDoc => ({ v: 1, strokes: [] });

/** Paleta propia de la tinta (la tinta puede tener color; la interfaz sigue neutra). */
export const INK_COLORS = ['#1c1c1e', '#0a5cd6', '#c4262e', '#1f8a3c', '#7a3fc4', '#c46a00', '#ffd60a', '#ff6fb1'];
export const SIZES = [2, 4, 8];

let seq = 0;
export const strokeId = () => `${Date.now().toString(36)}${(++seq).toString(36)}`;

export function parseInk(text: string): InkDoc {
  try {
    const d = JSON.parse(text) as Partial<InkDoc>;
    if (!d || !Array.isArray(d.strokes)) return emptyInk();
    return { v: 1, strokes: d.strokes.filter((s) => s && Array.isArray(s.pts) && s.pts.every((p) => Array.isArray(p) && p.every(Number.isFinite))) as Stroke[] };
  } catch {
    return emptyInk();
  }
}

/** Contorno del trazo en píxeles para un ancho de superficie `w`. */
export function outline(s: Stroke, w: number): [number, number][] {
  const pts = s.pts.map(([x, y, p]) => [x * w, y * w, p] as [number, number, number]);
  const size = s.size * (w / 600) * (s.tool === 'highlighter' ? 4 : 1);
  return getStroke(pts, { size: Math.max(1, size), thinning: s.tool === 'highlighter' ? 0 : 0.6, smoothing: 0.5, streamline: 0.4, simulatePressure: !!s.simulated, last: true }) as [number, number][];
}

export function svgPath(poly: [number, number][]): string {
  if (!poly.length) return '';
  const d = poly.reduce((acc, [x0, y0], i, a) => {
    const [x1, y1] = a[(i + 1) % a.length]!;
    acc.push(x0.toFixed(2), y0.toFixed(2), ((x0 + x1) / 2).toFixed(2), ((y0 + y1) / 2).toFixed(2));
    return acc;
  }, ['M', ...poly[0]!.map((v) => v.toFixed(2)), 'Q'] as string[]);
  return d.join(' ') + ' Z';
}

const dist2 = (a: [number, number], b: [number, number]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
/** Distancia de un punto a un segmento (al cuadrado). */
function segDist2(p: [number, number], a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return dist2(p, [a[0] + t * dx, a[1] + t * dy]);
}

/** Borrador por trazo: quita los trazos que toca el punto (radio en anchos). */
export function eraseStrokes(doc: InkDoc, p: [number, number], r: number): InkDoc {
  const keep = doc.strokes.filter((s) => !s.pts.some((q, i) => (i ? segDist2(p, s.pts[i - 1]!, q) : dist2(p, [q[0], q[1]])) <= r * r));
  return keep.length === doc.strokes.length ? doc : { ...doc, strokes: keep };
}

/** Borrador por área: quita solo los puntos dentro del radio y parte el trazo en trozos. */
export function eraseArea(doc: InkDoc, p: [number, number], r: number): InkDoc {
  let changed = false;
  const out: Stroke[] = [];
  for (const s of doc.strokes) {
    let cur: Pt[] = [];
    const parts: Pt[][] = [];
    for (const q of s.pts) {
      if (dist2(p, [q[0], q[1]]) <= r * r) { changed = true; if (cur.length) parts.push(cur); cur = []; } else cur.push(q);
    }
    if (cur.length) parts.push(cur);
    if (parts.length === 1 && parts[0]!.length === s.pts.length) out.push(s);
    else parts.filter((x) => x.length > 1).forEach((pts, i) => out.push({ ...s, id: i ? strokeId() : s.id, pts }));
  }
  return changed ? { ...doc, strokes: out } : doc;
}

export function pointInPolygon(p: [number, number], poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Lazo: trazos con la mayoría de sus puntos dentro del contorno. */
export function lassoSelect(doc: InkDoc, poly: [number, number][]): Set<string> {
  return new Set(doc.strokes.filter((s) => s.pts.filter((q) => pointInPolygon([q[0], q[1]], poly)).length > s.pts.length / 2).map((s) => s.id));
}

export function moveStrokes(doc: InkDoc, ids: Set<string>, dx: number, dy: number): InkDoc {
  return { ...doc, strokes: doc.strokes.map((s) => (ids.has(s.id) ? { ...s, pts: s.pts.map(([x, y, p]) => [x + dx, y + dy, p] as Pt) } : s)) };
}

/** Regla: el trazo se vuelve una línea recta del primer al último punto. */
export function straighten(pts: Pt[]): Pt[] {
  if (pts.length < 2) return pts;
  const a = pts[0]!, b = pts[pts.length - 1]!;
  const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 100));
  return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, 0.5] as Pt);
}

/** Altura usada por la tinta (en anchos), para que un lienzo crezca hacia abajo. */
export function inkHeight(doc: InkDoc): number {
  return doc.strokes.reduce((m, s) => Math.max(m, ...s.pts.map((q) => q[1])), 0);
}

/**
 * Rechazo de palma: con «solo Pencil» (y «el dedo desplaza») el dedo nunca dibuja; con
 * «el dedo dibuja», un toque se ignora mientras hay un lápiz activo o hasta 500 ms después.
 */
export function acceptPointer(type: string, mode: FingerMode, lastPenAt: number, now: number, penDown: boolean): boolean {
  if (type === 'pen') return true;
  if (type === 'mouse') return true; // escritorio: el ratón dibuja (no hay palma)
  if (mode !== 'draw') return false;
  return !penDown && now - lastPenAt > 500;
}

/** Deshacer/rehacer ilimitado durante la sesión (instantáneas inmutables). */
export class History {
  private past: InkDoc[] = [];
  private future: InkDoc[] = [];
  constructor(public doc: InkDoc) {}
  push(next: InkDoc) { if (next === this.doc) return; this.past.push(this.doc); this.future = []; this.doc = next; }
  undo(): InkDoc { const d = this.past.pop(); if (d) (this.future.push(this.doc), (this.doc = d)); return this.doc; }
  redo(): InkDoc { const d = this.future.pop(); if (d) (this.past.push(this.doc), (this.doc = d)); return this.doc; }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}
