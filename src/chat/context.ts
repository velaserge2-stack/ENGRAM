// Contexto con el que se abre el chat (nota, PDF con página, mazo o espacio). El texto se inyecta recortado al presupuesto.
import type { Collection } from '../data/collection';
import { pdfText } from '../io/extract';
import type { VaultAdapter } from '../vault/types';
import { readTextOr } from '../vault/util';
import { budget, toolCap } from './providers';
import { MAX_PDF_BYTES, validPath, type Source } from './tools';

export type CtxKind = 'nota' | 'pdf' | 'mazo' | 'espacio';
export interface ChatCtx { kind: CtxKind; ref: string; page?: number }
/** Evento de apertura con contexto: `dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: ctx }))` (el sin detalle sigue funcionando). */
export const askEvent = (c: ChatCtx): CustomEvent<ChatCtx> => new CustomEvent('engrama:chat', { detail: c });

/** Valida lo que llega por el evento (no se confía en `detail`). */
export function readCtx(d: unknown): ChatCtx | null {
  const o = d as Partial<ChatCtx> | null;
  if (!o || typeof o !== 'object' || typeof o.ref !== 'string' || !o.ref || o.ref.length > 400) return null;
  if (o.kind !== 'nota' && o.kind !== 'pdf' && o.kind !== 'mazo' && o.kind !== 'espacio') return null;
  const page = typeof o.page === 'number' && Number.isInteger(o.page) && o.page >= 1 && o.page < 100000 ? o.page : undefined;
  return { kind: o.kind, ref: o.ref, ...(o.kind === 'pdf' && page ? { page } : {}) };
}

/** Caracteres de contexto inicial: un cuarto del tope de lectura de un turno (Groq: 2 000 de 8 000). */
export const ctxCap = (): number => Math.floor(toolCap(budget()) / 4);
export function clip(s: string, cap = ctxCap()): string {
  const t = s.trim();
  return t.length <= cap ? t : t.slice(0, cap - 1).replace(/\s+\S*$/, '') + '…';
}
const base = (p: string) => p.split('/').pop()!.replace(/\.(md|pdf)$/i, '');
export const ctxLabel = (c: ChatCtx, col?: Collection | null): string =>
  c.kind === 'pdf' ? `${base(c.ref)}${c.page ? ` p.${c.page}` : ''}` : c.kind === 'mazo' ? col?.decks.find((d) => d.path === c.ref)?.full ?? base(c.ref) : base(c.ref);

const deckText = (col: Collection | null, path: string): string =>
  (col?.decks.find((d) => d.path === path)?.notes ?? []).filter((x) => !x.errors.length).map((x) => [x.front, x.back || x.items.join('; ') || x.pairs.map((p) => p.join(' = ')).join('; ')].filter(Boolean).join(' → ')).join('\n');

/** Carga y recorta el texto; añade a `sources` lo que se puede citar. Devuelve null si no existe o no es válido. */
export async function loadCtx(env: { vault: VaultAdapter; col: Collection | null }, c: ChatCtx, sources: Source[]): Promise<{ label: string; body: string } | null> {
  const label = ctxLabel(c, env.col), cap = ctxCap();
  try {
    if (c.kind === 'nota') {
      if (!validPath(c.ref, 'notes', /\.md$/)) return null;
      const text = (await readTextOr(env.vault, c.ref, '')).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
      if (!text.trim()) return null;
      sources.push({ tipo: 'nota', ruta: c.ref, titulo: label });
      return { label, body: clip(text, cap) };
    }
    if (c.kind === 'pdf') {
      if (!validPath(c.ref, 'docs', /\.pdf$/i) || !(await env.vault.exists(c.ref))) return null;
      const bytes = await env.vault.read(c.ref);
      if (bytes.length > MAX_PDF_BYTES) return null;
      const from = Math.max(1, (c.page ?? 1) - 1), to = (c.page ?? 1) + 1; // la página abierta y sus vecinas
      const pages = (await pdfText(bytes, to)).pages.map((p, i) => ({ n: i + 1, t: p.lines.map((l) => l.text).join('\n') })).filter((p) => p.n >= from && p.t.trim());
      if (!pages.length) return null;
      const per = Math.floor(cap / pages.length), name = base(c.ref);
      for (const p of pages) sources.push({ tipo: 'pdf', ruta: c.ref, titulo: name, pagina: p.n });
      return { label, body: pages.map((p) => `[PDF: ${name} p.${p.n}]\n${clip(p.t, per)}`).join('\n\n') };
    }
    if (c.kind === 'mazo') {
      const body = deckText(env.col, c.ref);
      return body ? { label, body: clip(body, cap) } : null;
    }
    // espacio: sus paneles (nota/PDF/mazo por nombre; el texto solo de las notas, repartido)
    const sp = JSON.parse(await readTextOr(env.vault, `.app/spaces/${c.ref.replace(/[^\w-]/g, '')}.json`, 'null')) as { name?: string; panels?: { type?: string; arg?: string }[] } | null;
    const ps = (sp?.panels ?? []).filter((p) => typeof p.arg === 'string' && p.arg);
    if (!ps.length) return null;
    const notes = ps.filter((p) => p.type === 'nota' && validPath(p.arg!.split('#')[0], 'notes', /\.md$/)).slice(0, 4);
    const lines = ps.map((p) => `- ${p.type}: ${base(p.arg!.split('#')[0]!)}`).join('\n');
    let body = lines;
    for (const p of notes) {
      const path = p.arg!.split('#')[0]!, room = Math.floor((cap - lines.length) / notes.length);
      if (room < 80) break;
      body += `\n\n[[${base(path)}]]\n${clip((await readTextOr(env.vault, path, '')).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''), room)}`;
      sources.push({ tipo: 'nota', ruta: path, titulo: base(path) });
    }
    return { label: sp?.name || label, body: clip(body, cap) };
  } catch { return null; }
}
