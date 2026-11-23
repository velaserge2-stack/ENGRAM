// Citas del Asistente: `[[Nota]]` y `[PDF: nombre p.N]`. Solo se enlaza lo que una herramienta devolvió en ese turno.
import { pdfLink } from '../pdf/library';
import type { Source } from './tools';

export const PDF_CITE = /\[PDF:\s*([^\]\n]+?)\s+p\.?\s*(\d{1,5})\]/gi;
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\.(md|pdf)$/, '').replace(/\s+/g, ' ').trim();

export function resolveNote(name: string, sources: readonly Source[]): Source | null {
  const n = norm(name);
  return n ? sources.find((s) => s.tipo === 'nota' && norm(s.titulo) === n) ?? null : null;
}
/** La página citada debe ser una de las devueltas (no se inventan páginas). */
export function resolvePdf(name: string, page: number, sources: readonly Source[]): Source | null {
  const n = norm(name);
  return sources.find((s) => s.tipo === 'pdf' && s.pagina === page && norm(s.titulo) === n) ?? null;
}
export const citeHref = (s: Source): string => (s.tipo === 'pdf' ? pdfLink(s.ruta, s.pagina) : '#/notas/' + s.ruta.slice(6).split('/').map(encodeURIComponent).join('/'));
export const citeLabel = (s: Source): string => (s.tipo === 'pdf' ? `${s.titulo} p.${s.pagina}` : s.titulo);
