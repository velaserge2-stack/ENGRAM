/** Operaciones sobre mazos (escritura segura vía SafeVault). */
import { ensureIds, newId, parseDeck } from '../cards/parse';
import { parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter';
import type { VaultAdapter } from '../vault/types';
import { readTextOr } from '../vault/util';
import { appendLog, type Collection } from './collection';
import type { LogEntry, SrsParams } from '../srs/engine';
import { newState } from '../srs/engine';

export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Sin título';
}

export async function createDeck(vault: VaultAdapter, name: string, folder = ''): Promise<string> {
  const base = `decks/${folder ? folder + '/' : ''}${safeName(name)}`;
  let path = `${base}.md`;
  for (let i = 2; await vault.exists(path); i++) path = `${base} (${i}).md`;
  await vault.write(path, stringifyFrontmatter({ deck: name.trim() || 'Nuevo mazo', tags: [] }, '\n'));
  return path;
}

/** Añade un bloque de tarjeta al final del mazo con ID nuevo. */
export async function appendCard(vault: VaultAdapter, deckPath: string, block: string, col: Collection | null): Promise<string> {
  const text = await readTextOr(vault, deckPath, '');
  const taken = new Set<string>(col ? [...col.byCid.keys()].map((c) => c.split(':')[0]!) : []);
  for (const n of parseDeck(text).notes) if (n.id) taken.add(n.id);
  const id = newId(taken);
  const body = text.replace(/\s*$/, '');
  await vault.write(deckPath, `${body}\n\n${block.trim()} ^${id}\n`);
  return id;
}

export async function setDeckMeta(vault: VaultAdapter, deckPath: string, patch: Record<string, string | number | string[] | null>): Promise<void> {
  const text = await readTextOr(vault, deckPath, '');
  const { data, body } = parseFrontmatter(text);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === '') delete data[k];
    else data[k] = v;
  }
  await vault.write(deckPath, stringifyFrontmatter(data, body));
}

export async function saveDeckText(vault: VaultAdapter, deckPath: string, text: string, taken: Set<string>): Promise<{ added: string[] }> {
  const r = ensureIds(text, taken);
  await vault.write(deckPath, r.text);
  return { added: r.added };
}

/** Operación de estado (suspender, enterrar, olvidar) sobre varias tarjetas: se agrega al historial. */
export async function stateOp(vault: VaultAdapter, col: Collection, cids: string[], op: 'suspend' | 'unsuspend' | 'forget' | 'bury', params: SrsParams, ref?: string): Promise<void> {
  const ts = Date.now();
  const entries: LogEntry[] = cids.map((id, i) => ({ id, ts: ts + i, op, ...(ref ? { ref } : {}) }));
  for (const e of entries) {
    const st = col.states.get(e.id) ?? newState(e.ts);
    if (op === 'suspend') st.suspended = true;
    if (op === 'unsuspend') st.suspended = false;
    if (op === 'bury') st.buried = ref ?? null;
    if (op === 'forget') Object.assign(st, newState(e.ts), { history: st.history });
    col.states.set(e.id, st);
  }
  await appendLog(vault, col, entries, params);
}

/** Medios referenciados con ![[...]] en un texto. */
export function mediaRefs(text: string): string[] {
  return [...new Set([...text.matchAll(/!\[\[([^\]|]+)/g)].map((m) => m[1]!.trim()))];
}

/** Busca un medio por nombre en media/ (las referencias suelen ser solo el nombre). */
export async function resolveMedia(vault: VaultAdapter, name: string, index?: Map<string, string>): Promise<string | null> {
  if (name.includes('/') && (await vault.exists(name))) return name;
  if (await vault.exists(`media/${name}`)) return `media/${name}`;
  return index?.get(name.split('/').pop()!) ?? null;
}
