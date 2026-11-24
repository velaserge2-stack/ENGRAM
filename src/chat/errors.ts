// Clasificación de errores (contrato §5). Devuelve códigos, nunca frases. Sin importar el SDK.
import type { ProviderId } from './providers';

export type Kind = 'quota' | 'rate' | 'auth' | 'model' | 'network' | 'timeout' | 'server' | 'aborted' | 'empty' | 'other';
/** Diagnóstico seguro (ya redactado y truncado) para mostrar en la interfaz. */
export interface Detail { status?: number; code?: string; msg?: string; model?: string }
export interface Classified { kind: Kind; retryAfterMs?: number; resetAt?: number; detail?: Detail }
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

const MODEL_RE = /model[_ ]not[_ ]found|decommission|models\/\S+ is not found|is not found for API version|not supported for (generateContent|this)|model .{0,80}(does not exist|not supported)/i;

/** statusCode + `error.status|code|type|message` del cuerpo JSON; todo redactado y truncado. */
export function detailOf(x: Errish, keys: readonly string[] = []): Detail {
  const cut = (v: unknown, n: number) => (v === undefined || v === null || v === '' ? undefined : redact(String(v), keys).slice(0, n));
  let j: unknown;
  try { j = JSON.parse(x.responseBody ?? ''); } catch { /* no es JSON */ }
  if (Array.isArray(j)) j = j[0];
  const o = (j as { error?: Record<string, unknown> } | undefined)?.error ?? (j as Record<string, unknown> | undefined);
  const d: Detail = {};
  if (typeof x.statusCode === 'number') d.status = x.statusCode;
  const code = cut(o && typeof o === 'object' ? (o.status ?? o.code ?? o.type) : undefined, 60);
  if (code) d.code = code;
  const msg = cut(o && typeof o === 'object' && o.message ? o.message : x.message ?? (j === undefined ? x.responseBody : undefined), 200);
  if (msg) d.msg = msg;
  return d;
}

/** `[HTTP 404 · NOT_FOUND] mensaje` (sin traducir: es texto técnico del proveedor). */
export function techLine(d: Detail): string {
  const head = [d.status !== undefined ? `HTTP ${d.status}` : '', d.code ?? ''].filter(Boolean).join(' · ');
  return [head && `[${head}]`, d.msg ?? ''].filter(Boolean).join(' ');
}

export function classify(p: ProviderId, e: unknown, now = Date.now(), keys: readonly string[] = []): Classified {
  const r = classify0(p, e, now);
  return r.kind === 'aborted' ? r : { ...r, detail: detailOf(((e as Errish)?.statusCode === undefined && (e as Errish)?.lastError ? (e as Errish).lastError : e ?? {}) as Errish, keys) };
}

function classify0(p: ProviderId, e: unknown, now: number): Classified {
  const x = (e ?? {}) as Errish;
  if (x.name === 'AbortError' || x.name === 'TimeoutError') return { kind: 'aborted' };
  // RetryError (por si maxRetries se subiera) trae el último fallo.
  if (x.statusCode === undefined && x.lastError) return classify0(p, x.lastError, now);
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
  if (st === 404 || (st === 400 && MODEL_RE.test(body))) return { kind: 'model' };
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

const KEY_PATTERNS = [/(?:x-goog-[a-z]+-key|api-key|authorization)["']?\s*[:=]\s*["']?[^\s"',}]+/gi, /AIza[\w-]{20,}/g, /gsk_[\w-]{16,}/g, /(key|token)=[^&\s"']+/gi, /Bearer\s+[\w.~+/=-]{12,}/gi];

/** Quita cualquier clave (conocida o con forma de clave) de un texto. */
export function redact(s: string, keys: readonly string[] = []): string {
  let out = s;
  for (const k of keys) if (k.length >= 8) out = out.split(k).join('••••');
  for (const re of KEY_PATTERNS) out = out.replace(re, (m) => (/^(key|token)=/i.test(m) ? m.split('=')[0] + '=••••' : /^(x-goog|api-key|authorization)/i.test(m) ? m.replace(/[^\s"',}:=]+$/, '••••') : '••••'));
  return out;
}
