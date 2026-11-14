import { type FileStat, type VaultAdapter, VaultError } from './types';

export const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');
const decFatal = new TextDecoder('utf-8', { fatal: true });

export function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? enc.encode(data) : data;
}

export function decodeText(bytes: Uint8Array, strict = false): string {
  return (strict ? decFatal : dec).decode(bytes);
}

export async function readText(vault: VaultAdapter, path: string): Promise<string> {
  const bytes = await vault.read(path);
  try {
    return decodeText(bytes, true);
  } catch {
    // no es UTF-8 (p. ej. Latin-1 de otro programa): se lee como windows-1252 para no sembrar U+FFFD al guardar
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** El archivo no existe (VaultError o DOMException de FS Access); cualquier otro fallo NO lo es. */
export function isNotFound(e: unknown): boolean {
  if (e instanceof VaultError) return e.code === 'not-found';
  const name = (e as { name?: unknown } | null)?.name;
  return e instanceof DOMException && (name === 'NotFoundError' || name === 'TypeMismatchError');
}

/**
 * `fallback` SOLO si el archivo no existe. Un fallo de lectura (cuota, permiso, Worker) se propaga:
 * leer «vacío» y luego escribir sustituiría el archivo del usuario.
 */
export async function readTextOr(vault: VaultAdapter, path: string, fallback: string): Promise<string> {
  try {
    return await readText(vault, path);
  } catch (e) {
    if (isNotFound(e)) return fallback;
    throw e;
  }
}

/**
 * Colas por bóveda y ruta: leer-modificar-escribir de un mismo archivo nunca se intercala. Entre
 * pestañas, el cerrojo de SafeVault solo cubre la escritura (otra pestaña podría leer entre medias y
 * pisar las líneas añadidas): si existe `navigator.locks`, el ciclo entero toma `engrama-file:<ruta>`
 * (otro nombre que el de SafeVault: los cerrojos no son reentrantes).
 */
const fileQueues = new WeakMap<VaultAdapter, Map<string, Promise<unknown>>>();
type Locks = { request<T>(name: string, cb: () => Promise<T>): Promise<T> };
export function serialFile<T>(vault: VaultAdapter, path: string, fn: () => Promise<T>): Promise<T> {
  let m = fileQueues.get(vault);
  if (!m) fileQueues.set(vault, (m = new Map()));
  const nav = typeof navigator === 'undefined' ? null : (navigator as Navigator & { locks?: Locks });
  const lk = nav && 'locks' in nav && nav.locks ? nav.locks : null;
  const locked = () => (lk ? lk.request(`engrama-file:${path}`, fn) : fn());
  const run = (m.get(path) ?? Promise.resolve()).then(locked, locked);
  const tail = run.catch(() => undefined);
  m.set(path, tail);
  void tail.then(() => m.get(path) === tail && m.delete(path));
  return run;
}

/**
 * Añade líneas al final de un `.jsonl` (historial, intentos, pomodoro) en cola por ruta y con lectura
 * estricta: si leer falla, no se escribe nada. `lines` puede decidir según lo que ya hay (p. ej. sin
 * duplicados). Devuelve cuántas líneas añadió.
 */
export function appendLines(vault: VaultAdapter, path: string, lines: string[] | ((prev: string) => string[])): Promise<number> {
  return appendLinesAt(vault, path, lines).then((r) => r.n);
}

type Appender = { append(path: string, data: Uint8Array): Promise<{ at: number; written: Uint8Array }> };
const appender = (v: VaultAdapter): Appender | null => ('append' in v && typeof (v as Partial<Appender>).append === 'function' ? (v as unknown as Appender) : null);

/**
 * Como `appendLines`, y además dónde empezó lo añadido y sus bytes (Prompt 21 · 4: con `SafeVault.append`
 * no se lee ni se reescribe el archivo; solo se lee si `lines` necesita ver lo que hay). Sin añadido real
 * (otro backend), `at` = -1 y `written` = null.
 */
export function appendLinesAt(vault: VaultAdapter, path: string, lines: string[] | ((prev: string) => string[])): Promise<{ n: number; at: number; written: Uint8Array | null }> {
  return serialFile(vault, path, async () => {
    const ap = appender(vault);
    const prev = typeof lines === 'function' || !ap ? await readTextOr(vault, path, '') : '';
    const add = typeof lines === 'function' ? lines(prev) : lines;
    if (!add.length) return { n: 0, at: -1, written: null };
    if (ap) return { n: add.length, ...(await ap.append(path, toBytes(`${add.join('\n')}\n`))) };
    await vault.write(path, `${prev && !prev.endsWith('\n') ? `${prev}\n` : prev}${add.join('\n')}\n`);
    return { n: add.length, at: -1, written: null };
  });
}

/** Recorre recursivamente y devuelve solo archivos. */
export async function walk(
  vault: VaultAdapter,
  root = '',
  skip: (path: string) => boolean = () => false,
): Promise<FileStat[]> {
  const out: FileStat[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const e of await vault.list(dir)) {
      if (skip(e.path)) continue;
      if (e.kind === 'dir') stack.push(e.path);
      else out.push(e);
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** FNV-1a de 32 bits: suficiente para detectar un temporal truncado (no es criptográfico). */
export const FNV_INIT = 0x811c9dc5;
/** Suma incremental: misma salida que `checksum` si se alimenta por trozos en orden. */
export function fnvUpdate(h: number, bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return h;
}
export const fnvHex = (h: number) => (h >>> 0).toString(16).padStart(8, '0');
export function checksum(bytes: Uint8Array): string {
  return fnvHex(fnvUpdate(FNV_INIT, bytes));
}

/** Tamaño de trozo para escribir y sumar archivos grandes sin cargarlos enteros. */
export const CHUNK = 4 * 1024 * 1024;

/** Suma de un Blob por trozos, cediendo el hilo entre trozos. */
export async function blobChecksum(blob: Blob, signal?: AbortSignal): Promise<string> {
  let h = FNV_INIT;
  for (let at = 0; at < blob.size; at += CHUNK) {
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    h = fnvUpdate(h, new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer()));
    await new Promise((r) => setTimeout(r, 0));
  }
  return fnvHex(h);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
