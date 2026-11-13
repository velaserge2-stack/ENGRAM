/**
 * Papelera de mazos (Mejoras 2 · C8). Borrar un mazo MUEVE su archivo .md a
 * `.app/papelera-mazos/<id>/` (con un `meta.json` de cifras); nada se borra de verdad
 * hasta «Eliminar definitivamente» o el vaciado automático.
 *
 * El historial NO se toca: `reviews.jsonl` solo se agrega. Mientras el mazo está en la
 * papelera sus tarjetas cuentan como archivadas; al restaurarlo, sus IDs vuelven a aparecer
 * y FSRS reproduce el mismo historial (el estado es idéntico al de antes de borrar).
 */
import type { Collection, Deck } from './collection';
import { withSuffix } from '../vault/paths';
import type { VaultAdapter } from '../vault/types';
import { readTextOr, walk } from '../vault/util';

export const DECK_TRASH = '.app/papelera-mazos';
const DAY = 86_400_000;

export interface TrashEntry {
  id: string;
  deletedAt: number;
  decks: { path: string; name: string }[];
  cards: number;
  reviews: number;
}

/** Un mazo y sus submazos (carpeta con el mismo nombre que el mazo, p. ej. decks/Cardio.md + decks/Cardio/…). */
export function withSubdecks(col: Collection, d: Deck): Deck[] {
  const sub = d.path.slice('decks/'.length, -3); // la carpeta sigue el nombre del archivo, no el `deck:` del frontmatter
  return [d, ...col.decks.filter((x) => x !== d && (x.folder === sub || x.folder.startsWith(sub + '/')))];
}

/** Decks dentro de una carpeta (para borrar una carpeta entera desde la selección múltiple). */
export function inFolder(col: Collection, folder: string): Deck[] {
  return col.decks.filter((x) => x.folder === folder || x.folder.startsWith(folder + '/'));
}

/** Cifras para la confirmación: tarjetas y repasos que se van a la papelera. */
export function trashPlan(col: Collection, decks: Deck[]): { cards: number; reviews: number } {
  const cids = new Set(decks.flatMap((d) => d.cards.map((c) => c.cid)));
  return { cards: cids.size, reviews: col.log.filter((e) => e.rating && cids.has(e.id)).length };
}

export async function trashDecks(vault: VaultAdapter, col: Collection, decks: Deck[], now = Date.now()): Promise<TrashEntry> {
  const id = now.toString(36);
  const entry: TrashEntry = { id, deletedAt: now, decks: decks.map((d) => ({ path: d.path, name: d.full })), ...trashPlan(col, decks) };
  // primero el meta: si la app se cierra a medias, la papelera sabe qué había
  await vault.write(`${DECK_TRASH}/${id}/meta.json`, JSON.stringify(entry, null, 1));
  for (const d of decks) await vault.move(d.path, `${DECK_TRASH}/${id}/${d.path}`);
  return entry;
}

export async function listTrash(vault: VaultAdapter): Promise<TrashEntry[]> {
  const out: TrashEntry[] = [];
  for (const f of await walk(vault, DECK_TRASH)) {
    if (!f.path.endsWith('/meta.json')) continue;
    try { out.push(JSON.parse(await readTextOr(vault, f.path, '')) as TrashEntry); } catch { /* meta dañado: se deja estar */ }
  }
  return out.sort((a, b) => b.deletedAt - a.deletedAt);
}

/** Devuelve los mazos a su sitio; si ya existe un archivo con ese nombre, se restaura como «(2)». */
export async function restoreTrash(vault: VaultAdapter, e: TrashEntry): Promise<string[]> {
  const restored: string[] = [];
  for (const d of e.decks) {
    const from = `${DECK_TRASH}/${e.id}/${d.path}`;
    if (!(await vault.exists(from))) continue;
    let to = d.path;
    for (let n = 2; await vault.exists(to); n++) to = withSuffix(d.path, n);
    await vault.move(from, to);
    restored.push(to);
  }
  await vault.remove(`${DECK_TRASH}/${e.id}`);
  return restored;
}

export async function purgeTrash(vault: VaultAdapter, e: TrashEntry): Promise<void> {
  await vault.remove(`${DECK_TRASH}/${e.id}`);
}

/** Vaciado automático: entradas con más de `days` días (0 = nunca). */
export async function autoPurge(vault: VaultAdapter, days: number, now = Date.now()): Promise<number> {
  if (!days) return 0;
  let n = 0;
  for (const e of await listTrash(vault)) if (now - e.deletedAt > days * DAY) (await purgeTrash(vault, e), n++);
  return n;
}
