/**
 * Caché de textos de notas (Prompt 21 · 5, cuello #3). Abrir Notas leía las 2 000 notas una por una
 * (≈ 5 s en el Worker de OPFS, que hace una operación a la vez) para retroenlaces, grafo y búsqueda.
 *
 * Aquí cada nota se guarda en IndexedDB con la firma que da el listado (`walk`: tamaño + fecha de
 * modificación). Al abrir, solo se leen del disco las notas cuya firma cambió o que no están; las borradas
 * se quitan. Es una caché **reconstruible**: los archivos siguen siendo la verdad, la base lleva versión y,
 * si falta, no casa, falla o no hay IndexedDB, se lee todo como antes. Solo la usan vistas de lectura
 * (lista, grafo, retroenlaces, búsqueda); el editor lee siempre el archivo.
 */
import type { FileStat, VaultAdapter } from '../vault/types';
import { readTextOr } from '../vault/util';

const DB = 'engrama-cache';
const STORE = 'notas';
/** Subir si cambia la forma de lo guardado: la base se vacía y se rehace. */
const VERSION = 1;

interface Rec { k: string; size: number; mtime: number; text: string }

let dbp: Promise<IDBDatabase | null> | null = null;
function open(): Promise<IDBDatabase | null> {
  if (!('indexedDB' in globalThis)) return Promise.resolve(null);
  return (dbp ??= new Promise<IDBDatabase | null>((res) => {
    try {
      const r = indexedDB.open(DB, VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
        db.createObjectStore(STORE, { keyPath: 'k' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    } catch {
      res(null);
    }
  }));
}

const done = (t: IDBTransaction) => new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });

/** Prefijo por bóveda: dos bóvedas del mismo origen no comparten entradas. */
function scope(vault: VaultAdapter): string {
  const root = (vault as { raw?: { root?: { name?: string } }; root?: { name?: string } });
  return `${vault.kind}:${root.raw?.root?.name ?? root.root?.name ?? ''}|`;
}

/**
 * Textos de `files` (notas `.md` de un `walk`): de la caché si su firma casa; si no, del disco. Con
 * `strict`, un fallo al leer del disco se propaga (quien va a escribir no debe tomarlo por vacío).
 */
export async function noteTexts(vault: VaultAdapter, files: FileStat[], strict = false): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const read = (p: string) => (strict ? readTextOr(vault, p, '') : readTextOr(vault, p, '').catch(() => '')); // vistas de solo lectura: tolerante
  const db = await open().catch(() => null);
  if (!db) {
    for (const f of files) out.set(f.path, await read(f.path));
    return out;
  }
  const pre = scope(vault);
  let cached = new Map<string, Rec>();
  try {
    const t = db.transaction(STORE, 'readonly');
    const all = await new Promise<Rec[]>((res, rej) => {
      const q = t.objectStore(STORE).getAll(IDBKeyRange.bound(pre, `${pre}￿`));
      q.onsuccess = () => res(q.result as Rec[]);
      q.onerror = () => rej(q.error);
    });
    cached = new Map(all.map((r) => [r.k.slice(pre.length), r]));
  } catch {
    cached = new Map(); // caché ilegible: se lee todo y se rehace
  }
  const put: Rec[] = [];
  for (const f of files) {
    const c = cached.get(f.path);
    // sin fecha (algún backend) no hay firma fiable: siempre del disco
    if (c && f.mtime > 0 && c.size === f.size && c.mtime === f.mtime) out.set(f.path, c.text);
    else {
      const text = await read(f.path);
      out.set(f.path, text);
      if (f.mtime > 0) put.push({ k: pre + f.path, size: f.size, mtime: f.mtime, text });
    }
  }
  const gone = [...cached.keys()].filter((p) => !out.has(p));
  if (put.length || gone.length) {
    try {
      const t = db.transaction(STORE, 'readwrite');
      const s = t.objectStore(STORE);
      for (const r of put) s.put(r);
      for (const p of gone) s.delete(pre + p);
      await done(t);
    } catch {
      /* sin espacio o sin permiso: la próxima vez se vuelve a leer del disco */
    }
  }
  return out;
}
