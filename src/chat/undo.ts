// Deshacer de las escrituras del Asistente. Antes de cada escritura se guarda el «antes» de esa ruta; deshacer lo restaura.
// Decisión: nunca se borra. Si el archivo era nuevo (`before === null`) se restaura a VACÍO (un mazo, banco o .ics vacío no
// pierde nada y el usuario puede borrarlo a mano), y `undo` avisa con `emptied` para decírselo.
import { batch } from '../vault/safe';
import type { VaultAdapter } from '../vault/types';
import { readTextOr } from '../vault/util';

export interface Entry { path: string; before: string | null }
export type Writer = (path: string, text: string) => Promise<void>;

/** Restaura en orden inverso, todo o nada si el vault es SafeVault. Devuelve las rutas que quedaron vacías (eran nuevas). */
export async function undo(vault: VaultAdapter, group: readonly Entry[]): Promise<{ emptied: string[] }> {
  await batch(vault, async (tx) => {
    for (const e of [...group].reverse()) await tx.write(e.path, e.before ?? '');
  });
  return { emptied: group.filter((e) => e.before === null).map((e) => e.path) };
}

/**
 * Ejecuta `fn` con un escritor que anota el «antes» justo antes de escribir (una escritura que falla no se anota).
 * Si `fn` lanza a la mitad, lo ya escrito se deshace y el error se relanza.
 */
export async function tracked(vault: VaultAdapter, fn: (write: Writer) => Promise<void>): Promise<Entry[]> {
  const group: Entry[] = [];
  const write: Writer = async (path, text) => {
    const before = (await vault.exists(path)) ? await readTextOr(vault, path, '') : null;
    await vault.write(path, text);
    group.push({ path, before });
  };
  try { await fn(write); } catch (e) {
    await undo(vault, group).catch(() => undefined);
    throw e;
  }
  return group;
}
