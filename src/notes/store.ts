/**
 * NoteStore (Mejoras 2 · E14): un único documento en memoria por nota y un único guardado.
 * La pestaña Notas y los paneles del lienzo se suscriben al mismo documento: lo que se
 * escribe en uno aparece en el otro al instante, sin pisarse. El archivo .md sigue siendo
 * la fuente de verdad: si cambia por fuera (importar, mover, restaurar) y no hay cambios
 * pendientes, el documento se vuelve a leer.
 */
import { createAutosave, type Autosaver } from '../lib/autosave';
import type { VaultAdapter } from '../vault/types';
import { readTextOr } from '../vault/util';

type Listener = (text: string) => void;
interface Entry { text: string | null; listeners: Set<Listener>; saver: Autosaver<string>; loading: Promise<string> | null }

const docs = new Map<string, Entry>();
/** Lo que pasa tras cada guardado (historial de versiones, índice de búsqueda). */
let afterSave: (vault: VaultAdapter, path: string, text: string) => Promise<void> = async () => {};
export function onNoteSaved(fn: typeof afterSave) { afterSave = fn; }

function entry(vault: VaultAdapter, path: string): Entry {
  let e = docs.get(path);
  if (!e) {
    e = { text: null, listeners: new Set(), loading: null, saver: createAutosave(async (t: string) => { await vault.write(path, t); await afterSave(vault, path, t); }) };
    docs.set(path, e);
  }
  return e;
}

export const noteStore = {
  async load(vault: VaultAdapter, path: string): Promise<string> {
    const e = entry(vault, path);
    if (e.text !== null) return e.text;
    // una lectura fallida no se cachea como "" (teclear sobre "" pisaría la nota): se propaga
    e.loading ??= readTextOr(vault, path, '').then((t) => ((e.text ??= t), (e.loading = null), e.text), (err) => { e.loading = null; throw err; });
    return e.loading;
  },
  peek: (path: string) => docs.get(path)?.text ?? null,
  set(vault: VaultAdapter, path: string, text: string) {
    const e = entry(vault, path);
    if (e.text === text) return;
    e.text = text;
    e.saver.schedule(text);
    for (const l of e.listeners) l(text);
  },
  subscribe(vault: VaultAdapter, path: string, l: Listener): () => void {
    const e = entry(vault, path);
    e.listeners.add(l);
    return () => {
      e.listeners.delete(l);
      if (!e.listeners.size) void e.saver.flush();
    };
  },
  flush: (path: string) => docs.get(path)?.saver.flush() ?? Promise.resolve(),
  /** El archivo pudo cambiar por fuera: recargar si no hay cambios sin guardar. */
  async refresh(vault: VaultAdapter, path: string) {
    const e = docs.get(path);
    if (!e || e.saver.pending || e.text === null) return;
    const t = await readTextOr(vault, path, '').catch(() => null); // solo lectura: sin cambios si falla
    if (t !== null && t !== e.text && !e.saver.pending) (e.text = t, e.listeners.forEach((l) => l(t)));
  },
  /** La nota se movió o se borró: olvidar el documento (tras guardar lo pendiente). */
  async forget(path: string) {
    const e = docs.get(path);
    if (!e) return;
    await e.saver.flush();
    docs.delete(path);
  },
};
