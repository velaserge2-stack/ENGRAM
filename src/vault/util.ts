import type { FileStat, VaultAdapter } from './types';

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
  return decodeText(await vault.read(path));
}

export async function readTextOr(vault: VaultAdapter, path: string, fallback: string): Promise<string> {
  try {
    return await readText(vault, path);
  } catch {
    return fallback;
  }
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
