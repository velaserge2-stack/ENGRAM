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

export async function readJson<T>(vault: VaultAdapter, path: string, fallback: T): Promise<T> {
  if (!(await vault.exists(path))) return fallback;
  return JSON.parse(await readText(vault, path)) as T;
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
export function checksum(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
