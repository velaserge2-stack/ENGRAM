/**
 * Add-on «Sticky notes» (Prompt 19 · 3): cada sticky es una nota más, `notes/Stickies/<id>.md`.
 *   ---
 *   sticky: true
 *   orden: 30
 *   color: amarillo      (opcional; la paleta de colores de Notas)
 *   fijada: true         (opcional)
 *   archivada: true      (opcional)
 *   ---
 *   Cuerpo en Markdown.
 * Se buscan, enlazan, exportan y respaldan como cualquier nota, y se abren en el editor completo.
 * Las claves que no conocemos se conservan tal cual.
 */
import { headOf, parseFrontmatter, rewriteDoc, stringifyFrontmatter, type Frontmatter } from '../lib/frontmatter';
import { COLORS } from '../notes/format';

export const STICKY_DIR = 'notes/Stickies';
export type StickyColor = (typeof COLORS)[number];
export const STICKY_COLORS = COLORS;

export interface Sticky {
  path: string;
  body: string;
  order: number;
  color: StickyColor | null;
  pinned: boolean;
  archived: boolean;
  /** el resto del frontmatter, sin tocar */
  rest: Frontmatter;
  /** el texto leído: al reescribir, sus líneas ajenas del frontmatter se conservan byte a byte */
  raw?: string;
}

const KNOWN = ['sticky', 'orden', 'color', 'fijada', 'archivada'];

export function parseSticky(path: string, text: string): Sticky {
  const doc = parseFrontmatter(text);
  const d = doc.data;
  const rest: Frontmatter = {};
  for (const [k, v] of Object.entries(d)) if (!KNOWN.includes(k)) rest[k] = v;
  const color = typeof d.color === 'string' && (COLORS as readonly string[]).includes(d.color) ? (d.color as StickyColor) : null;
  return { path, body: doc.body.replace(/^\n/, ''), order: typeof d.orden === 'number' ? d.orden : Number(d.orden) || 0, color, pinned: d.fijada === true, archived: d.archivada === true, rest, raw: text };
}

/** Cuerpo como se lee de nuevo (`parseSticky` quita una línea en blanco inicial: se repone). */
const bodyFor = (s: Sticky, body: string) => (s.raw && /^\r?\n/.test(parseFrontmatter(s.raw).body) ? '\n' : '') + body;
/** Claves de sticky (undefined = quitarla). */
const stickyKeys = (s: Sticky) => ({ sticky: true, orden: s.order, color: s.color ?? undefined, fijada: s.pinned || undefined, archivada: s.archived || undefined });

export function serializeSticky(s: Sticky): string {
  const body = s.body.endsWith('\n') || !s.body ? s.body : s.body + '\n';
  if (s.raw && headOf(s.raw) !== null) return rewriteDoc(s.raw, bodyFor(s, body), stickyKeys(s));
  const data: Frontmatter = { sticky: true, orden: s.order, ...(s.color ? { color: s.color } : {}), ...(s.pinned ? { fijada: true } : {}), ...(s.archived ? { archivada: true } : {}), ...s.rest };
  return stringifyFrontmatter(data, body);
}

/** Fijadas primero; luego por `orden` y, a igualdad, por ruta (estable). */
export function sortStickies(list: Sticky[]): Sticky[] {
  return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order || a.path.localeCompare(b.path));
}

/**
 * Mueve `from` a la posición de `to` (índices de la lista ordenada) y renumera de 10 en 10.
 * Devuelve solo las stickies cuyo `orden` cambió (para escribir lo mínimo).
 */
export function reorder(sorted: Sticky[], from: number, to: number): Sticky[] {
  if (from === to || !sorted[from] || !sorted[to]) return [];
  const next = [...sorted];
  const [m] = next.splice(from, 1);
  next.splice(to, 0, m!);
  const changed: Sticky[] = [];
  next.forEach((s, i) => { if (s.order !== (i + 1) * 10) changed.push({ ...s, order: (i + 1) * 10 }); });
  return changed;
}

/** Ruta nueva y única (base 36 del instante; con sufijo si ya existe). */
export function newStickyPath(now: number, exists: (p: string) => boolean): string {
  const id = now.toString(36);
  let p = `${STICKY_DIR}/${id}.md`;
  for (let i = 2; exists(p); i++) p = `${STICKY_DIR}/${id}-${i}.md`;
  return p;
}

/** Título para «Convertir en nota»: la primera línea con texto, sin marcas de Markdown. */
export function stickyTitle(body: string, fallback: string): string {
  const line = body.split('\n').map((l) => l.replace(/^\s*(#{1,6}|[-*+]( \[[ xX]\])?|\d+\.|>)\s*/, '').replace(/[*~`=[\]]/g, '').replace(/(?<![\p{L}\p{N}+])\+\+(\S[^+]*?)\+\+/gu, '$1').replace(/(?<![\p{L}\p{N}])_+(\S[^_]*?)_+(?![\p{L}\p{N}])/gu, '$1').trim()).find(Boolean);
  return [...(line ?? fallback)].slice(0, 60).join('').trim() || fallback;
}

/** Texto de la nota completa: sin las claves de sticky (el resto del frontmatter se queda). */
export function asNote(s: Sticky): string {
  if (s.raw && headOf(s.raw) !== null) return rewriteDoc(s.raw, bodyFor(s, s.body.endsWith('\n') ? s.body : s.body + '\n'), Object.fromEntries(Object.keys(stickyKeys(s)).map((k) => [k, undefined])));
  return Object.keys(s.rest).length ? stringifyFrontmatter(s.rest, s.body.endsWith('\n') ? s.body : s.body + '\n') : s.body.endsWith('\n') ? s.body : s.body + '\n';
}
