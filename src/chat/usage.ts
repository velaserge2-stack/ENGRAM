// Uso local y barra (contrato §7). Puro salvo load/save. Día: Gemini = medianoche del Pacífico (como su cuota diaria); demás = UTC. Manda la cabecera si existe (Groq).
import { isDemo, mem } from '../demo/state';
import { t } from '../i18n';
import { acctPct, money, type Acct } from './account';
import type { Limits, ProviderId } from './providers';

export const USAGE_STORAGE = 'engrama.chat.usage';
export interface KeyUse { day: string; req: number; tok: number; min: { t: number; req: number; tok: number } }
export interface HdrQuota { remainingReq?: number; remainingTok?: number; limitReq?: number; limitTok?: number; resetAt: number; at?: number; /** cuándo se recargan las peticiones (día) y los tokens (minuto) */ reqAt?: number; tokAt?: number }
export interface Usage { v: 1; perKey: Record<string, KeyUse>; hdr?: Record<string, HdrQuota>; acct?: Record<string, Acct> }

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

/** Fecha del «día» de cuota: Gemini reinicia RPD a medianoche del Pacífico; los demás, UTC (aproximación). */
export function dayOf(now: number, p?: ProviderId): string {
  if (p === 'gemini') {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now)); } catch { /* sin zonas horarias: UTC */ }
  }
  return new Date(now).toISOString().slice(0, 10);
}

/** Cuenta una petición; reinicia día y minuto al cambiar. */
export function record(u: Usage, id: string, tokens: number, now: number, prov?: ProviderId): Usage {
  const day = dayOf(now, prov), t = Math.floor(now / 60_000);
  const p = u.perKey[id];
  const d = p && p.day === day ? p : { day, req: 0, tok: 0, min: { t, req: 0, tok: 0 } };
  const m = d.min.t === t ? d.min : { t, req: 0, tok: 0 };
  return { ...u, perKey: { ...u.perKey, [id]: { day, req: d.req + 1, tok: d.tok + tokens, min: { t, req: m.req + 1, tok: m.tok + tokens } } } };
}

export function setAcct(u: Usage, id: string, a: Acct | null): Usage {
  if (!a) return u;
  return { ...u, acct: { ...u.acct, [id]: a } };
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
    at: now,
    reqAt: get(h, 'x-ratelimit-reset-requests') ? now + dur(get(h, 'x-ratelimit-reset-requests')) : undefined,
    tokAt: get(h, 'x-ratelimit-reset-tokens') ? now + dur(get(h, 'x-ratelimit-reset-tokens')) : undefined,
    resetAt: now + Math.max(dur(get(h, 'x-ratelimit-reset-requests')), dur(get(h, 'x-ratelimit-reset-tokens'))),
  };
}

export interface Bar { pct: number; level: 'ok' | 'near' | 'full'; show: boolean; label: string }

export function bar(u: Usage, id: string, limits: Limits, now: number, warnAt = 0.8, p?: ProviderId): Bar {
  const h = u.hdr?.[id];
  let pct = 0;
  // cada cifra de Groq vale hasta su propio reinicio: los tokens por minuto se recargan antes que las peticiones del día
  const reqOk = !!h && h.remainingReq !== undefined && !!h.limitReq && (h.reqAt ?? h.resetAt) > now;
  const tokOk = !!h && h.remainingTok !== undefined && !!h.limitTok && (h.tokAt ?? h.resetAt) > now;
  if (h && (reqOk || tokOk)) {
    if (reqOk) pct = Math.max(pct, 1 - h.remainingReq! / h.limitReq!);
    if (tokOk) pct = Math.max(pct, 1 - h.remainingTok! / h.limitTok!);
  } else {
    const k = u.perKey[id];
    if (k && k.day === dayOf(now, p)) {
      pct = Math.max(k.req / limits.rpd, limits.tpd ? k.tok / limits.tpd : 0);
      if (k.min.t === Math.floor(now / 60_000)) pct = Math.max(pct, k.min.req / limits.rpm, k.min.tok / limits.tpm);
    }
  }
  const ap = acctPct(u.acct?.[id]); // OpenRouter con tope: lo gastado según el proveedor
  if (ap !== undefined) pct = Math.max(pct, ap);
  pct = Math.min(1, Math.max(0, pct));
  const level = pct >= 1 ? 'full' : pct >= warnAt ? 'near' : 'ok';
  return { pct, level, show: level !== 'ok', label: Math.round(pct * 100) + ' %' };
}

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const int = (v: number) => Math.round(v).toLocaleString();

/** Lo que el proveedor dijo que queda (null si no dijo nada: Gemini, o Groq sin cabeceras legibles). */
export function realLine(u: Usage, id: string, p: ProviderId, now = Date.now()): string | null {
  if (p === 'groq') {
    const h = u.hdr?.[id];
    if (!h) return null;
    const parts: string[] = [];
    // pasado su reinicio, la cifra vuelve al tope
    const req = h.remainingReq !== undefined && h.limitReq && h.reqAt !== undefined && h.reqAt <= now ? h.limitReq : h.remainingReq;
    const tok = h.remainingTok !== undefined && h.limitTok && h.tokAt !== undefined && h.tokAt <= now ? h.limitTok : h.remainingTok;
    if (req !== undefined) parts.push(h.limitReq ? t('chat.real_req_de', { n: int(req), de: int(h.limitReq) }) : t('chat.real_req', { n: int(req) }));
    if (tok !== undefined) parts.push(t('chat.real_tok', { n: int(tok) }));
    return parts.length ? parts.join(' · ') + (h.at ? ' · ' + hhmm(h.at) : '') : null;
  }
  const a = u.acct?.[id];
  if (!a) return null;
  const txt = a.kind === 'kimi' ? t('chat.real_saldo', { n: money(a.balance) })
    : a.limit !== undefined && a.remaining !== undefined ? t('chat.real_rest', { n: money(a.remaining), de: money(a.limit) })
    : t('chat.real_gastado', { n: money(a.usage ?? 0) }) + (a.free ? ' · ' + t('chat.real_gratis') : '');
  return txt + ' · ' + hhmm(a.at);
}
