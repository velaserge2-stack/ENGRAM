/**
 * Motor de tinta compartido (Prompt 5 · B): modelo puro, sin DOM.
 *
 * Los trazos se guardan VECTORIALES (puntos, presión, color, grosor) y normalizados al
 * ANCHO de la superficie: x e y van en «anchos» (0–1 en x; y crece hacia abajo). Así el
 * dibujo sobrevive al zoom, a la rotación de la pantalla y a un lienzo que crece hacia abajo.
 * El contorno suave lo calcula perfect-freehand (MIT) con el grosor según la presión.
 */
import { getStroke } from 'perfect-freehand';

export type Tool = 'pen' | 'highlighter' | 'marker' | 'eraser' | 'lasso';
export type FingerMode = 'pencil' | 'scroll' | 'draw';
export type Pt = [number, number, number]; // x, y (en anchos), presión 0–1

/**
 * Marcador (Prompt PDF · anotador): herramienta `marker`, pero se GUARDA como `highlighter` con
 * `free: true` (una build vieja lo ve como resaltador de tinta y no lo pierde). `alpha` es opcional
 * (por defecto 0,35, como el resaltador). El marcador nunca se ajusta al texto ni se vuelve `Mark`.
 */
export interface Stroke { id: string; tool: 'pen' | 'highlighter'; color: string; size: number; pts: Pt[]; simulated?: boolean; free?: boolean; alpha?: number }
export interface InkDoc { v: 1; strokes: Stroke[] }
export const emptyInk = (): InkDoc => ({ v: 1, strokes: [] });

/** Paleta propia de la tinta (la tinta puede tener color; la interfaz sigue neutra). */
export const INK_COLORS = ['#1c1c1e', '#0a5cd6', '#c4262e', '#1f8a3c', '#7a3fc4', '#c46a00', '#ffd60a', '#ff6fb1'];
export const SIZES = [2, 4, 8];
export const MARKER_ALPHAS = [0.25, 0.4, 0.6];
const HL_ALPHA = 0.35;
const WIDE = 4; // el resaltador y el marcador son ×4 del grosor

/** ¿Es un trazo de marcador (libre, sin ajustarse al texto)? Fase 2: `onInk` de pdf.tsx no lo ajusta. */
export const isFreeMarker = (s: Pick<Stroke, 'tool' | 'free'>) => s.tool === 'highlighter' && !!s.free;
/** Opacidad con la que se pinta el trazo. */
export const strokeAlpha = (s: Stroke) => (s.tool === 'pen' ? 1 : s.alpha ?? HL_ALPHA);
/** Fase 2 · exportPdf: opacidad y modo de mezcla del trazo (pdf-lib `blendMode`), o null si es normal. */
export const markerExport = (s: Stroke): { opacity: number; blendMode: 'Multiply' } | null => (s.tool === 'highlighter' ? { opacity: strokeAlpha(s), blendMode: 'Multiply' } : null);
/** Trazo de la herramienta: el marcador se crea ya en su forma guardada. */
export function newStroke(tool: Tool, id: string, color: string, size: number, pts: Pt[], simulated: boolean, alpha: number): Stroke | null {
  if (tool === 'pen') return { id, tool, color, size, pts, ...(simulated ? { simulated } : {}) };
  if (tool === 'highlighter') return { id, tool, color, size, pts, ...(simulated ? { simulated } : {}) };
  if (tool === 'marker') return { id, tool: 'highlighter', free: true, alpha, color, size, pts, ...(simulated ? { simulated } : {}) };
  return null;
}

let seq = 0;
export const strokeId = () => `${Date.now().toString(36)}${(++seq).toString(36)}`;

export function parseInk(text: string): InkDoc {
  try {
    const d = JSON.parse(text) as Partial<InkDoc>;
    if (!d || !Array.isArray(d.strokes)) return emptyInk();
    const ok = (s: Omit<Stroke, 'tool'> & { tool: string }) => s && (s.tool === 'pen' || s.tool === 'highlighter' || s.tool === 'marker') && Number.isFinite(s.size) && typeof s.color === 'string' && Array.isArray(s.pts) && s.pts.every((p) => Array.isArray(p) && p.every(Number.isFinite));
    // un `marker` suelto (nunca debería guardarse así) se normaliza a su forma guardada
    return { v: 1, strokes: (d.strokes as unknown as (Omit<Stroke, 'tool'> & { tool: string })[]).filter(ok).map((s) => (s.tool === 'marker' ? { ...s, tool: 'highlighter', free: true } : s)) as Stroke[] };
  } catch {
    return emptyInk();
  }
}

/** Contorno del trazo en píxeles para un ancho de superficie `w`. */
export function outline(s: Stroke, w: number): [number, number][] {
  const pts = s.pts.map(([x, y, p]) => [x * w, y * w, p] as [number, number, number]);
  const size = s.size * (w / 600) * (s.tool === 'highlighter' ? WIDE : 1);
  const flat = isFreeMarker(s) ? { start: { cap: false }, end: { cap: false } } : {}; // marcador: puntas planas
  return getStroke(pts, { size: Math.max(1, size), thinning: s.tool === 'highlighter' ? 0 : 0.6, smoothing: 0.5, streamline: 0.4, simulatePressure: !!s.simulated, last: true, ...flat }) as [number, number][];
}

/** Ancho en píxeles del trazo de un resaltador/marcador para una superficie de ancho `w`. */
export const wideWidth = (size: number, w: number) => Math.max(1, size * (w / 600) * WIDE);

/**
 * Tramos nuevos de un trazo ancho de ancho constante (vista previa en vivo, incremental):
 * un segmento por cada punto desde `from`, más un disco en la unión (sin disco en los extremos:
 * puntas planas como el trazo final). Concatenar tramos sucesivos == calcularlo de una vez.
 */
export function liveSegments(pts: Pt[], from: number): { a: [number, number]; b: [number, number]; join: boolean }[] {
  const out: { a: [number, number]; b: [number, number]; join: boolean }[] = [];
  for (let i = Math.max(1, from); i < pts.length; i++) out.push({ a: [pts[i - 1]![0], pts[i - 1]![1]], b: [pts[i]![0], pts[i]![1]], join: i >= 2 });
  return out;
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

function pointInPolygon(p: [number, number], poly: [number, number][]): boolean {
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
