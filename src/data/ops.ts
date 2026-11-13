import { t } from '../i18n';
/** Operaciones sobre mazos (escritura segura vía SafeVault). */
import { newId, noteIdOf, parseDeck } from '../cards/parse';
import { noteStore } from '../notes/store';
import { parseFrontmatter, setKeys, stringifyFrontmatter } from '../lib/frontmatter';
import type { VaultAdapter } from '../vault/types';
import { readTextOr } from '../vault/util';
import { appendLog, type Collection } from './collection';
import type { LogEntry, SrsParams } from '../srs/engine';
import { newState } from '../srs/engine';

export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || t('inbox.sin_titulo');
}

export async function createDeck(vault: VaultAdapter, name: string, folder = ''): Promise<string> {
  const base = `decks/${folder ? folder + '/' : ''}${safeName(name)}`;
  let path = `${base}.md`;
  for (let i = 2; await vault.exists(path); i++) path = `${base} (${i}).md`;
  await vault.write(path, stringifyFrontmatter({ deck: name.trim() || t('ops.nuevo_mazo'), tags: [] }, '\n'));
  return path;
}

/** Añade un bloque de tarjeta al final del mazo con ID nuevo. */
export async function appendCard(vault: VaultAdapter, deckPath: string, block: string, col: Collection | null): Promise<string> {
  // si el mazo está abierto en un editor (NoteStore), se añade sobre ese documento y se guarda ya
  const open = noteStore.peek(deckPath);
  const text = open ?? (await readTextOr(vault, deckPath, ''));
  // también los IDs del historial (tarjetas archivadas o en la papelera): un ID nuevo no hereda su FSRS
  const taken = new Set<string>(col ? [...col.byCid.keys(), ...col.log.map((e) => e.id)].map(noteIdOf) : []);
  for (const n of parseDeck(text).notes) if (n.id) taken.add(n.id);
  const id = newId(taken);
  const body = text.replace(/\s*$/, '');
  const next = `${body}\n\n${block.trim()} ^${id}\n`;
  if (open !== null) (noteStore.set(vault, deckPath, next), await noteStore.flush(deckPath));
  else await vault.write(deckPath, next);
  return id;
}

export async function setDeckMeta(vault: VaultAdapter, deckPath: string, patch: Record<string, string | number | string[] | null>): Promise<void> {
  const text = await readTextOr(vault, deckPath, '');
  // solo las claves que cambian (setKeys): lo que el parser no entiende no se pierde
  await vault.write(deckPath, setKeys(text, Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === null || v === '' ? undefined : v]))));
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
