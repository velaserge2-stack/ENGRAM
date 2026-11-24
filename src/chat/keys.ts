// Claves propias (contrato §4). Solo localStorage; nunca en .app/, Settings, zip, logs ni errores.
import type { ProviderId } from './providers';

export const KEYS_STORAGE = 'engrama.chat.keys';
export const MAX_KEYS = 4;
/** Claves de localStorage que «Olvidar» borra junto con las claves. */
export const USAGE_RESET = ['engrama.chat.usage'];
export type KeyStatus = 'active' | 'exhausted' | 'invalid' | 'paused';
export interface KeyEntry { id: string; alias: string; provider: ProviderId; key: string; status: KeyStatus; until?: number }
export interface KeyStore { v: 1; keys: KeyEntry[] }

export const last4 = (k: string): string => k.slice(-4);
export const mask = (k: string): string => '••••' + last4(k);

function isEntry(e: unknown): e is KeyEntry {
  const x = e as KeyEntry;
  return !!x && typeof x.id === 'string' && typeof x.key === 'string' && typeof x.alias === 'string'
    && ['gemini', 'groq', 'openrouter', 'kimi'].includes(x.provider)
    && ['active', 'exhausted', 'invalid', 'paused'].includes(x.status);
}

export function loadKeys(): KeyStore {
  try {
    const o = JSON.parse(localStorage.getItem(KEYS_STORAGE) ?? '') as KeyStore;
    if (o && o.v === 1 && Array.isArray(o.keys)) return { v: 1, keys: o.keys.filter(isEntry).slice(0, MAX_KEYS) };
  } catch { /* sin acceso o JSON malo */ }
  return { v: 1, keys: [] };
}

export function saveKeys(s: KeyStore): boolean {
  try { localStorage.setItem(KEYS_STORAGE, JSON.stringify({ v: 1, keys: s.keys.slice(0, MAX_KEYS) })); return true; } catch { return false; }
}

export function pickKey(keys: readonly KeyEntry[], now: number, skip?: ReadonlySet<string>): KeyEntry | null {
  return keys.find((k) => !skip?.has(k.id) && (k.status === 'active' || (k.status === 'exhausted' && k.until !== undefined && k.until <= now))) ?? null;
}

export function markKey(s: KeyStore, id: string, status: KeyStatus, until?: number): KeyStore {
  return { v: 1, keys: s.keys.map((k) => (k.id === id ? { ...k, status, until } : k)) };
}

/** Añade una clave (null si ya hay 4 o está vacía). */
export function addKey(s: KeyStore, provider: ProviderId, alias: string, key: string): KeyStore | null {
  const k = key.trim();
  if (!k || s.keys.length >= MAX_KEYS) return null;
  const id = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return { v: 1, keys: [...s.keys, { id, alias: alias.trim() || `${provider} ${s.keys.length + 1}`, provider, key: k, status: 'active' }] };
}
