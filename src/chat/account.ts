// Uso real de la cuenta, pedido al proveedor (solo al abrir «Modelo y claves» o al probar la conexión; nunca en segundo plano).
// OpenRouter: GET /api/v1/key (gasto, límite y restante en dólares). Kimi: GET /v1/users/me/balance (saldo).
// Groq no tiene consulta: manda sus cifras en las cabeceras de cada respuesta (usage.ts › fromHeaders). Gemini no expone nada.
import type { ProviderId } from './providers';

export type Acct =
  | { kind: 'or'; at: number; usage?: number; limit?: number; remaining?: number; free?: boolean }
  | { kind: 'kimi'; at: number; balance: number };

export const ACCT_URL: Partial<Record<ProviderId, string>> = {
  openrouter: 'https://openrouter.ai/api/v1/key',
  kimi: 'https://api.moonshot.ai/v1/users/me/balance',
};
export const hasAcct = (p: ProviderId): boolean => p in ACCT_URL;

const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** `{data:{usage, limit, limit_remaining, is_free_tier}}`; limit null = sin tope. */
export function parseOR(j: unknown, at: number): Acct | null {
  const d = (j as { data?: Record<string, unknown> } | null)?.data;
  if (!d || typeof d !== 'object') return null;
  const limit = n(d.limit), usage = n(d.usage);
  const remaining = n(d.limit_remaining) ?? (limit !== undefined && usage !== undefined ? Math.max(0, limit - usage) : undefined);
  return { kind: 'or', at, usage, limit, remaining, free: d.is_free_tier === true };
}
/** `{data:{available_balance, …}}`. */
export function parseKimi(j: unknown, at: number): Acct | null {
  const b = n((j as { data?: Record<string, unknown> } | null)?.data?.available_balance);
  return b === undefined ? null : { kind: 'kimi', at, balance: b };
}

/** Una petición; null si falla (no es un error para el usuario: la barra sigue con el conteo local). */
export async function fetchAcct(p: ProviderId, key: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<Acct | null> {
  const url = ACCT_URL[p];
  if (!url) return null;
  try {
    const res = await fetchImpl(url, { method: 'GET', signal, headers: { Authorization: 'Bearer ' + key } });
    if (!res.ok) return null;
    const j: unknown = await res.json();
    return p === 'openrouter' ? parseOR(j, Date.now()) : parseKimi(j, Date.now());
  } catch { return null; }
}

/** Fracción gastada (solo OpenRouter con tope). */
export const acctPct = (a: Acct | undefined): number | undefined =>
  a?.kind === 'or' && a.limit && a.remaining !== undefined ? Math.min(1, Math.max(0, 1 - a.remaining / a.limit)) : undefined;

export const money = (v: number): string => '$' + (Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1));
