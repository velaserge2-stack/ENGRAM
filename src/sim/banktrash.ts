/**
 * Papelera de bancos de preguntas: el mismo patrón que la de mazos (`src/data/decktrash.ts`).
 * Borrar MUEVE `exams-bank/<nombre>.md` a `.app/papelera-bancos/<id>/` con un `meta.json`;
 * nada se borra de verdad hasta «Eliminar definitivamente» o el vaciado automático
 * (`deckTrashDays`, 0 = nunca).
 *
 * Orden: primero el meta, luego `vault.move` (SafeVault escribe el destino por el diario y solo
 * después quita el original). Si la app se cierra a medias, el banco sigue en su sitio o ya está
 * entero en la papelera; un meta sin archivo no se lista.
 * Los intentos guardan copia de sus preguntas: no dependen del archivo del banco.
 */
import { basename, dirname } from '../vault/paths';
import type { VaultAdapter } from '../vault/types';
import { readTextOr, walk } from '../vault/util';

export const BANK_TRASH = '.app/papelera-bancos';
const DAY = 86_400_000;

export interface BankTrashEntry { id: string; deletedAt: number; path: string; name: string; questions: number }

const fileOf = (e: BankTrashEntry) => `${BANK_TRASH}/${e.id}/${basename(e.path)}`;

export async function trashBank(vault: VaultAdapter, b: { path: string; name: string; questions: number }, now = Date.now()): Promise<BankTrashEntry> {
  let id = now.toString(36);
  for (let n = 2; await vault.exists(`${BANK_TRASH}/${id}`); n++) id = `${now.toString(36)}-${n}`;
  const e: BankTrashEntry = { id, deletedAt: now, ...b };
  await vault.write(`${BANK_TRASH}/${id}/meta.json`, JSON.stringify(e, null, 1));
  await vault.move(b.path, fileOf(e));
  return e;
}

export async function listBankTrash(vault: VaultAdapter): Promise<BankTrashEntry[]> {
  const out: BankTrashEntry[] = [];
  for (const f of await walk(vault, BANK_TRASH)) {
    if (!f.path.endsWith('/meta.json')) continue;
    try {
      const e = JSON.parse(await readTextOr(vault, f.path, '')) as BankTrashEntry;
      if (await vault.exists(fileOf(e))) out.push(e);
    } catch { /* meta dañado: se deja estar */ }
  }
  return out.sort((a, b) => b.deletedAt - a.deletedAt);
}

/** Ruta libre para restaurar: la original, o «Nombre (restaurado).md», «(restaurado 2)»… Nunca sobrescribe. */
async function freeBankPath(vault: VaultAdapter, path: string): Promise<string> {
  if (!(await vault.exists(path))) return path;
  const dir = dirname(path), stem = basename(path).replace(/\.md$/, '');
  for (let n = 1; ; n++) {
    const to = `${dir ? dir + '/' : ''}${stem} (restaurado${n > 1 ? ' ' + n : ''}).md`;
    if (!(await vault.exists(to))) return to;
  }
}

/** Devuelve el banco a su sitio (o a una ruta libre) y quita la entrada. `null` si ya no estaba. */
export async function restoreBank(vault: VaultAdapter, e: BankTrashEntry): Promise<string | null> {
  const from = fileOf(e);
  if (!(await vault.exists(from))) return null;
  const to = await freeBankPath(vault, e.path);
  await vault.move(from, to);
  await vault.remove(`${BANK_TRASH}/${e.id}`);
  return to;
}

export async function purgeBank(vault: VaultAdapter, e: BankTrashEntry): Promise<void> {
  await vault.remove(`${BANK_TRASH}/${e.id}`);
}

/** Vaciado automático con los mismos días que la papelera de mazos (0 = nunca). */
export async function autoPurgeBanks(vault: VaultAdapter, days: number, now = Date.now()): Promise<number> {
  if (!days) return 0;
  let n = 0;
  for (const e of await listBankTrash(vault)) if (now - e.deletedAt > days * DAY) (await purgeBank(vault, e), n++);
  return n;
}
