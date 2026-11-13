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
/** `closed`: la nota se movió o se borró con un panel aún suscrito; teclear ahí no la resucita. */
interface Entry { text: string | null; listeners: Set<Listener>; saver: Autosaver<string>; loading: Promise<string> | null; closed?: boolean }

const docs = new Map<string, Entry>();
/** Lo que pasa tras cada guardado (historial de versiones, índice de búsqueda). */
let afterSave: (vault: VaultAdapter, path: string, text: string) => Promise<void> = async () => {};
export function onNoteSaved(fn: typeof afterSave) { afterSave = fn; }

/** Aviso de un guardado fallido (también el del temporizador): una vez por ruta hasta que vuelva a guardar bien. */
let onFail: (path: string, err: unknown) => void = () => {};
export function onNoteSaveFailed(fn: typeof onFail) { onFail = fn; }
const failed = new Set<string>();

/** Los mazos (decks/*.md) usan el mismo modelo, pero sin historial de versiones ni índice de notas. */
const saverFor = (vault: VaultAdapter, path: string) => createAutosave(async (t: string) => {
  try {
    await vault.write(path, t);
  } catch (e) {
    if (!failed.has(path)) (failed.add(path), onFail(path, e));
    throw e;
  }
  failed.delete(path);
  if (!path.startsWith('decks/')) await afterSave(vault, path, t);
});

function entry(vault: VaultAdapter, path: string): Entry {
  let e = docs.get(path);
  if (!e) {
    e = { text: null, listeners: new Set(), loading: null, saver: saverFor(vault, path) };
    docs.set(path, e);
  }
  return e;
}

export const noteStore = {
  async load(vault: VaultAdapter, path: string): Promise<string> {
    const e = entry(vault, path);
    // la ruta vuelve a abrirse (deshacer mover, nota nueva con ese nombre): se relee del disco
    if (e.closed) Object.assign(e, { closed: false, text: null, saver: saverFor(vault, path) });
    if (e.text !== null) return e.text;
    // una lectura fallida no se cachea como "" (teclear sobre "" pisaría la nota): se propaga
    e.loading ??= readTextOr(vault, path, '').then((t) => ((e.text ??= t), (e.loading = null), e.text), (err) => { e.loading = null; throw err; });
    return e.loading;
  },
  peek: (path: string) => (docs.get(path)?.closed ? null : docs.get(path)?.text ?? null),
  set(vault: VaultAdapter, path: string, text: string) {
    const e = entry(vault, path);
    if (e.closed) return console.warn('Nota movida o borrada: no se guarda en la ruta vieja', path);
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
      if (e.listeners.size) return;
      if (e.closed) { if (docs.get(path) === e) docs.delete(path); } else void e.saver.flush();
    };
  },
  /** Hay cambios sin escribir en esa ruta (programados o en vuelo). */
  pending: (path: string) => !docs.get(path)?.closed && (docs.get(path)?.saver.pending ?? false),
  flush: (path: string) => docs.get(path)?.saver.flush() ?? Promise.resolve(),
  /** El archivo pudo cambiar por fuera: recargar si no hay cambios sin guardar. */
  async refresh(vault: VaultAdapter, path: string) {
    const e = docs.get(path);
    if (!e || e.closed || e.saver.pending || e.text === null) return;
    const before = e.text;
    const t = await readTextOr(vault, path, '').catch(() => null); // solo lectura: sin cambios si falla
    // si se tecleó o se guardó mientras se leía, lo leído es viejo: no se aplica
    if (t !== null && t !== e.text && e.text === before && !e.saver.pending && !e.closed) (e.text = t, e.listeners.forEach((l) => l(t)));
  },
  /** La nota se movió o se borró: guardar lo pendiente y cerrar el documento (sin resucitarlo). */
  async forget(path: string) {
    const e = docs.get(path);
    if (!e) return;
    await e.saver.flush();
    e.saver.dispose();
    if (e.listeners.size) e.closed = true; // un panel sigue abierto: se cierra cuando se desuscriba
    else if (docs.get(path) === e) docs.delete(path);
  },
};
