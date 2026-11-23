// Clasificación de errores (contrato §5). Devuelve códigos, nunca frases. Sin importar el SDK.
import type { ProviderId } from './providers';

export type Kind = 'quota' | 'rate' | 'auth' | 'network' | 'server' | 'aborted' | 'other';
export interface Classified { kind: Kind; retryAfterMs?: number; resetAt?: number }
export type Decision = 'rotate' | 'wait' | 'fail';

export const decide = (k: Kind): Decision => (k === 'quota' || k === 'auth' ? 'rotate' : k === 'rate' ? 'wait' : 'fail');

/** "1h2m3.5s", "250ms", "30" (s) → ms. */
export function parseDuration(s: string | undefined): number | undefined {
  if (!s) return undefined;
  if (/^\d+(\.\d+)?$/.test(s.trim())) return Math.round(parseFloat(s) * 1000);
  let ms = 0, any = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    any = true;
    ms += parseFloat(m[1]!) * ({ ms: 1, h: 3_600_000, m: 60_000, s: 1000 }[m[2] as 'ms']);
  }
  return any ? Math.round(ms) : undefined;
}

/** Gemini reinicia la cuota diaria a medianoche del Pacífico. */
export function nextPacificMidnight(now: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(now));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0) % 24;
  return now + 86_400_000 - ((g('hour') * 60 + g('minute')) * 60 + g('second')) * 1000;
}

interface Errish { name?: string; message?: string; statusCode?: number; responseHeaders?: Record<string, string>; responseBody?: string; cause?: unknown; lastError?: unknown; errors?: unknown[] }

function hdr(h: Record<string, string> | undefined, name: string): string | undefined {
  if (!h) return undefined;
  const k = Object.keys(h).find((x) => x.toLowerCase() === name);
  return k ? h[k] : undefined;
}

export function classify(p: ProviderId, e: unknown, now = Date.now()): Classified {
  const x = (e ?? {}) as Errish;
  if (x.name === 'AbortError' || x.name === 'TimeoutError') return { kind: 'aborted' };
  // RetryError (por si maxRetries se subiera) trae el último fallo.
  if (x.statusCode === undefined && x.lastError) return classify(p, x.lastError, now);
  const st = x.statusCode;
  if (st === undefined) {
    const c = x.cause as Errish | undefined;
    if (e instanceof TypeError || c instanceof TypeError || c?.name === 'AbortError' || /fetch failed|network|Failed to fetch/i.test(String(x.message))) {
      return { kind: c?.name === 'AbortError' ? 'aborted' : 'network' };
    }
    return { kind: 'other' };
  }
  const body = x.responseBody ?? '';
  const retryAfterMs = parseDuration(hdr(x.responseHeaders, 'retry-after')) ?? parseDuration(/"retryDelay"\s*:\s*"([^"]+)"/.exec(body)?.[1]);
  if (st >= 500) return { kind: 'server' };
  if (st === 401 || st === 403) return { kind: 'auth' };
  if (st === 400 && /API_KEY_INVALID|API key not valid|invalid_api_key/i.test(body)) return { kind: 'auth' };
  if (st === 429) {
    if (p === 'gemini') {
      return /PerDay/.test(body) ? { kind: 'quota', resetAt: nextPacificMidnight(now) } : { kind: 'rate', retryAfterMs };
    }
    if (/per day|requests per day|tokens per day|\bRPD\b|\bTPD\b/i.test(body)) {
      const r = parseDuration(hdr(x.responseHeaders, 'x-ratelimit-reset-requests')) ?? parseDuration(hdr(x.responseHeaders, 'x-ratelimit-reset-tokens'));
      return { kind: 'quota', resetAt: now + (r ?? retryAfterMs ?? 3_600_000) };
    }
    return { kind: 'rate', retryAfterMs };
  }
  return { kind: 'other' };
}

const KEY_PATTERNS = [/AIza[\w-]{20,}/g, /gsk_[\w-]{16,}/g, /(key|token)=[^&\s"']+/gi, /Bearer\s+[\w.~+/=-]{12,}/gi];

/** Quita cualquier clave (conocida o con forma de clave) de un texto. */
export function redact(s: string, keys: readonly string[] = []): string {
  let out = s;
  for (const k of keys) if (k.length >= 8) out = out.split(k).join('••••');
  for (const re of KEY_PATTERNS) out = out.replace(re, (m) => (/^(key|token)=/i.test(m) ? m.split('=')[0] + '=••••' : '••••'));
  return out;
}
