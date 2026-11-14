/**
 * Vínculos del calendario con mazos, temas y notas (Mejora 1 · §2).
 * URI: engrama://deck/<id> · engrama://note/<id> · engrama://topic/<carpeta> · engrama://tag/<etiqueta>
 * El `id` corto vive en el frontmatter y se genera la PRIMERA vez que se vincula
 * (sin migraciones). Sin `id`, se resuelve por nombre o ruta; si no se encuentra, es un enlace roto.
 */
import { noteTexts } from '../notes/textcache';
import { newId } from '../cards/parse';
import { parseFrontmatter, setKeys } from './frontmatter';
import type { VaultAdapter } from '../vault/types';
import { readTextOr, walk } from '../vault/util';

export type LinkKind = 'deck' | 'note' | 'topic' | 'tag';

export interface LinkTarget {
  kind: LinkKind;
  /** ruta del archivo (mazo/nota) o filtro de estudio (tema/etiqueta) */
  path: string;
  name: string;
  id?: string;
}

export interface LinkIndex {
  decks: LinkTarget[];
  notes: LinkTarget[];
  topics: LinkTarget[];
  tags: LinkTarget[];
}

export interface Resolved {
  uri: string;
  kind: LinkKind;
  target: LinkTarget | null;
  /** nombre a mostrar (aunque esté roto) */
  label: string;
}

export function parseUri(uri: string): { kind: LinkKind; key: string } | null {
  const m = /^engrama:\/\/(deck|note|topic|tag)\/(.+)$/.exec(uri.trim());
  if (!m) return null;
  let key = m[2]!;
  try {
    key = decodeURIComponent(key);
  } catch {
    /* tal cual */
  }
  return { kind: m[1] as LinkKind, key };
}

export function makeUri(kind: LinkKind, key: string): string {
  return `engrama://${kind}/${encodeURIComponent(key)}`;
}

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\.md$/, '').trim();

export function resolveLink(uri: string, idx: LinkIndex): Resolved {
  const p = parseUri(uri);
  if (!p) return { uri, kind: 'note', target: null, label: uri };
  const list = p.kind === 'deck' ? idx.decks : p.kind === 'note' ? idx.notes : p.kind === 'topic' ? idx.topics : idx.tags;
  const k = norm(p.key);
  const t =
    list.find((x) => x.id && x.id === p.key) ??
    list.find((x) => norm(x.path) === k) ??
    list.find((x) => norm(x.name) === k) ??
    list.find((x) => p.kind === 'tag' && norm(x.path.replace(/^tag:/, '')) === k) ??
    list.find((x) => norm(x.path.split('/').pop() ?? '') === k) ??
    null;
  return { uri, kind: p.kind, target: t, label: t?.name ?? p.key };
}

/** Filtro de estudio para un conjunto de vínculos (mazos, carpetas, etiquetas); null si no hay mazos. */
export function studyFilter(resolved: Resolved[]): string | null {
  const parts = resolved.filter((r) => r.target && r.kind !== 'note').map((r) => r.target!.path);
  return parts.length ? parts.join('|') : null;
}

/** Devuelve el `id` del frontmatter; si no tiene, lo genera y lo escribe (solo esta vez). */
export async function ensureFileId(vault: VaultAdapter, path: string, taken: Set<string>): Promise<string> {
  const text = await readTextOr(vault, path, '');
  const doc = parseFrontmatter(text);
  if (typeof doc.data.id === 'string' && doc.data.id) return doc.data.id;
  if (typeof doc.data.id === 'number') return String(doc.data.id);
  const id = newId(taken);
  await vault.write(path, setKeys(text, { id })); // solo la línea `id:`: el resto del frontmatter queda intacto
  return id;
}

export async function buildLinkIndex(vault: VaultAdapter, decks: { path: string; full: string; folder: string; tags: string[]; data: Record<string, unknown> }[]): Promise<LinkIndex> {
  const notes: LinkTarget[] = [];
  // Prompt 21 · 6: los textos salen de la caché por firma del listado (`textcache.ts`); antes, cada
  // cambio leía las 2 000 notas solo para su `id:` (solo lectura)
  const files = (await walk(vault, 'notes')).filter((f) => f.path.endsWith('.md'));
  const texts = await noteTexts(vault, files);
  for (const f of files) {
    const fm = parseFrontmatter(texts.get(f.path) ?? '').data;
    notes.push({ kind: 'note', path: f.path, name: f.name.replace(/\.md$/, ''), ...(fm.id ? { id: String(fm.id) } : {}) });
  }
  const folders = new Set<string>();
  for (const d of decks) {
    const parts = d.folder ? d.folder.split('/') : [];
    for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  }
  return {
    decks: decks.map((d) => ({ kind: 'deck' as const, path: d.path, name: d.full, ...(d.data.id ? { id: String(d.data.id) } : {}) })),
    notes,
    topics: [...folders].sort().map((f) => ({ kind: 'topic' as const, path: `decks/${f}/`, name: f })),
    tags: [...new Set(decks.flatMap((d) => d.tags))].sort().map((t) => ({ kind: 'tag' as const, path: `tag:${t}`, name: `#${t}` })),
  };
}
