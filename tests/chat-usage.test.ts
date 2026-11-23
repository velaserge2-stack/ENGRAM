import { describe, expect, it } from 'vitest';
import { PROVIDERS } from '../src/chat/providers';
import { bar, emptyUsage, fromHeaders, record, setHdr } from '../src/chat/usage';

const T = Date.UTC(2026, 5, 1, 10, 0, 30);
const L = { rpm: 10, rpd: 100, tpm: 1000, tpd: 5000 };

describe('chat usage', () => {
  it('record: acumula, reinicia minuto y día', () => {
    let u = record(emptyUsage(), 'a', 10, T);
    u = record(u, 'a', 5, T + 1000);
    expect(u.perKey.a).toMatchObject({ req: 2, tok: 15, min: { req: 2, tok: 15 } });
    u = record(u, 'a', 1, T + 120_000);
    expect(u.perKey.a).toMatchObject({ req: 3, tok: 16, min: { req: 1, tok: 1 } });
    u = record(u, 'a', 1, T + 86_400_000);
    expect(u.perKey.a).toMatchObject({ req: 1, tok: 1 });
  });
  it('fromHeaders Groq y Gemini', () => {
    const h = { 'x-ratelimit-limit-requests': '1000', 'x-ratelimit-remaining-requests': '990', 'x-ratelimit-remaining-tokens': '11000', 'x-ratelimit-limit-tokens': '12000', 'x-ratelimit-reset-requests': '1m30s' };
    expect(fromHeaders('groq', h, 0)).toMatchObject({ remainingReq: 990, remainingTok: 11000, limitReq: 1000, resetAt: 90000 });
    expect(fromHeaders('groq', new Headers(h), 0)?.remainingReq).toBe(990);
    expect(fromHeaders('groq', {}, 0)).toBeNull();
    expect(fromHeaders('gemini', h, 0)).toBeNull();
  });
  it('bar 0/79/80/100 %', () => {
    const at = (n: number) => bar({ v: 1, perKey: { a: { day: '2026-06-01', req: n, tok: 0, min: { t: 0, req: 0, tok: 0 } } } }, 'a', L, T);
    expect(at(0)).toMatchObject({ pct: 0, level: 'ok', show: false });
    expect(at(79)).toMatchObject({ level: 'ok', label: '79 %' });
    expect(at(80)).toMatchObject({ level: 'near', show: true });
    expect(at(100)).toMatchObject({ pct: 1, level: 'full' });
    expect(at(150).pct).toBe(1);
  });
  it('la cabecera manda sobre la cuenta local', () => {
    let u = record(emptyUsage(), 'a', 0, T);
    u = setHdr(u, 'a', { remainingReq: 5, limitReq: 100, resetAt: T + 1000 });
    expect(bar(u, 'a', L, T).pct).toBeCloseTo(0.95);
    expect(bar(u, 'a', L, T + 2000).pct).toBeCloseTo(0.1); // cabecera vencida → local (1/10 por minuto)
  });
  it('proveedores con host exacto', () => {
    expect(Object.values(PROVIDERS).map((p) => p.host).sort()).toEqual(['api.groq.com', 'generativelanguage.googleapis.com']);
  });
});
