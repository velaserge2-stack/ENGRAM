// Uso local y barra (contrato §7). Puro salvo load/save. Día = UTC (aproximación; manda la cabecera si existe).
import { isDemo, mem } from '../demo/state';
import type { Limits, ProviderId } from './providers';

export const USAGE_STORAGE = 'engrama.chat.usage';
export interface KeyUse { day: string; req: number; tok: number; min: { t: number; req: number; tok: number } }
export interface HdrQuota { remainingReq?: number; remainingTok?: number; limitReq?: number; limitTok?: number; resetAt: number }
export interface Usage { v: 1; perKey: Record<string, KeyUse>; hdr?: Record<string, HdrQuota> }

export const emptyUsage = (): Usage => ({ v: 1, perKey: {} });

export function loadUsage(): Usage {
  if (isDemo()) return mem.usage as Usage;
  try {
    const o = JSON.parse(localStorage.getItem(USAGE_STORAGE) ?? '') as Usage;
    if (o && o.v === 1 && o.perKey && typeof o.perKey === 'object') return o;
  } catch { /* vacío */ }
  return emptyUsage();
}
export function saveUsage(u: Usage): void {
  if (isDemo()) { mem.usage = u; return; }
  try { localStorage.setItem(USAGE_STORAGE, JSON.stringify(u)); } catch { /* sin acceso */ }
}

const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Cuenta una petición; reinicia día y minuto al cambiar. */
export function record(u: Usage, id: string, tokens: number, now: number): Usage {
  const day = dayOf(now), t = Math.floor(now / 60_000);
  const p = u.perKey[id];
  const d = p && p.day === day ? p : { day, req: 0, tok: 0, min: { t, req: 0, tok: 0 } };
  const m = d.min.t === t ? d.min : { t, req: 0, tok: 0 };
  return { ...u, perKey: { ...u.perKey, [id]: { day, req: d.req + 1, tok: d.tok + tokens, min: { t, req: m.req + 1, tok: m.tok + tokens } } } };
}

export function setHdr(u: Usage, id: string, h: HdrQuota | null): Usage {
  if (!h) return u;
  return { ...u, hdr: { ...u.hdr, [id]: h } };
}

type H = Headers | Record<string, string> | undefined;
const get = (h: H, n: string): string | undefined => {
  if (!h) return undefined;
  if (typeof (h as Headers).get === 'function') return (h as Headers).get(n) ?? undefined;
  const r = h as Record<string, string>;
  const k = Object.keys(r).find((x) => x.toLowerCase() === n);
  return k ? r[k] : undefined;
};
const dur = (s?: string): number => {
  if (!s) return 0;
  let ms = 0;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) ms += parseFloat(m[1]!) * ({ ms: 1, h: 3_600_000, m: 60_000, s: 1000 }[m[2] as 'ms']);
  return ms || (/^\d+(\.\d+)?$/.test(s) ? parseFloat(s) * 1000 : 0);
};
const num = (s?: string): number | undefined => (s !== undefined && s !== '' && Number.isFinite(Number(s)) ? Number(s) : undefined);

/** Groq manda x-ratelimit-*; Gemini no manda nada útil (→ null). */
export function fromHeaders(p: ProviderId, h: H, now = Date.now()): HdrQuota | null {
  if (p !== 'groq') return null;
  const remainingReq = num(get(h, 'x-ratelimit-remaining-requests'));
  const remainingTok = num(get(h, 'x-ratelimit-remaining-tokens'));
  if (remainingReq === undefined && remainingTok === undefined) return null;
  return {
    remainingReq, remainingTok,
    limitReq: num(get(h, 'x-ratelimit-limit-requests')), limitTok: num(get(h, 'x-ratelimit-limit-tokens')),
    resetAt: now + Math.max(dur(get(h, 'x-ratelimit-reset-requests')), dur(get(h, 'x-ratelimit-reset-tokens'))),
  };
}

export interface Bar { pct: number; level: 'ok' | 'near' | 'full'; show: boolean; label: string }

export function bar(u: Usage, id: string, limits: Limits, now: number, warnAt = 0.8): Bar {
  const h = u.hdr?.[id];
  let pct = 0;
  if (h && h.resetAt > now && ((h.remainingReq !== undefined && h.limitReq) || (h.remainingTok !== undefined && h.limitTok))) {
    if (h.remainingReq !== undefined && h.limitReq) pct = Math.max(pct, 1 - h.remainingReq / h.limitReq);
    if (h.remainingTok !== undefined && h.limitTok) pct = Math.max(pct, 1 - h.remainingTok / h.limitTok);
  } else {
    const k = u.perKey[id];
    if (k && k.day === dayOf(now)) {
      pct = Math.max(k.req / limits.rpd, limits.tpd ? k.tok / limits.tpd : 0);
      if (k.min.t === Math.floor(now / 60_000)) pct = Math.max(pct, k.min.req / limits.rpm, k.min.tok / limits.tpm);
    }
  }
  pct = Math.min(1, Math.max(0, pct));
  const level = pct >= 1 ? 'full' : pct >= warnAt ? 'near' : 'ok';
  return { pct, level, show: level !== 'ok', label: Math.round(pct * 100) + ' %' };
}
