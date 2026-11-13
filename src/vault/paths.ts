import { VaultError } from './types';

const MAX_DEPTH = 16;
const MAX_SEGMENT = 255;

/**
 * Normaliza y valida una ruta de la bóveda. Rechaza `..`, rutas absolutas
 * de Windows, NUL y profundidad excesiva: todo archivo importado es no confiable.
 */
export function normalizePath(input: string): string {
  if (typeof input !== 'string') throw new VaultError('Ruta inválida', 'invalid-path');
  if (input.includes('\0')) throw new VaultError('Ruta con carácter nulo', 'invalid-path', input);
  const raw = input.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(raw)) throw new VaultError('Ruta absoluta no permitida', 'invalid-path', input);
  const parts: string[] = [];
  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') throw new VaultError('Ruta con ".." no permitida', 'invalid-path', input);
    if (seg.length > MAX_SEGMENT) throw new VaultError('Nombre demasiado largo', 'invalid-path', input);
    parts.push(seg.normalize('NFC'));
  }
  if (parts.length > MAX_DEPTH) throw new VaultError('Ruta demasiado profunda', 'invalid-path', input);
  return parts.join('/');
}

export function splitPath(path: string): string[] {
  const p = normalizePath(path);
  return p === '' ? [] : p.split('/');
}

export function basename(path: string): string {
  const parts = splitPath(path);
  return parts[parts.length - 1] ?? '';
}

export function dirname(path: string): string {
  const parts = splitPath(path);
  return parts.slice(0, -1).join('/');
}

export function extname(path: string): string {
  const b = basename(path);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
}

/** "notas/x.md" → "notas/x (2).md" */
export function withSuffix(path: string, n: number): string {
  const dir = dirname(path);
  const b = basename(path);
  const i = b.lastIndexOf('.');
  const name = i > 0 ? `${b.slice(0, i)} (${n})${b.slice(i)}` : `${b} (${n})`;
  return dir ? `${dir}/${name}` : name;
}
