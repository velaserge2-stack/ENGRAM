import { describe, expect, it } from 'vitest';
import { ACCT_URL, acctPct, fetchAcct, parseKimi, parseOR } from '../src/chat/account';
import { bar, emptyUsage, fromHeaders, realLine, setAcct, setHdr } from '../src/chat/usage';

const LIM = { rpm: 1000, rpd: 1000, tpm: 1e9 };
describe('uso real según el proveedor', () => {
  it('OpenRouter: restante, tope y plan gratuito', () => {
    expect(parseOR({ data: { usage: 1.5, limit: 5, limit_remaining: 3.5, is_free_tier: false } }, 1)).toEqual({ kind: 'or', at: 1, usage: 1.5, limit: 5, remaining: 3.5, free: false });
    expect(parseOR({ data: { usage: 0, limit: null, is_free_tier: true } }, 1)).toMatchObject({ limit: undefined, remaining: undefined, free: true });
    expect(parseOR({ data: { usage: 4, limit: 5 } }, 1)!.kind === 'or' && (parseOR({ data: { usage: 4, limit: 5 } }, 1) as { remaining: number }).remaining).toBe(1);
    expect(parseOR(null, 1)).toBeNull();
  });
  it('Kimi: saldo disponible', () => {
    expect(parseKimi({ code: 0, data: { available_balance: 12.34, cash_balance: 12.34 } }, 1)).toEqual({ kind: 'kimi', at: 1, balance: 12.34 });
    expect(parseKimi({ data: {} }, 1)).toBeNull();
  });
  it('la barra usa lo gastado en OpenRouter', () => {
    const u = setAcct(emptyUsage(), 'k', { kind: 'or', at: 1, usage: 4, limit: 5, remaining: 1 });
    expect(acctPct(u.acct!.k)).toBeCloseTo(0.8);
    expect(bar(u, 'k', LIM, 2, 0.8, 'openrouter')).toMatchObject({ level: 'near', label: '80 %' });
  });
  it('líneas «lo que queda»', () => {
    const g = setHdr(emptyUsage(), 'g', fromHeaders('groq', { 'x-ratelimit-remaining-requests': '998', 'x-ratelimit-limit-requests': '1000', 'x-ratelimit-remaining-tokens': '11650' }, 0));
    expect(realLine(g, 'g', 'groq')).toMatch(/quedan 998 de 1[,.]?000 peticiones · 11[,.]?650 tokens este minuto/);
    expect(realLine(emptyUsage(), 'g', 'groq')).toBeNull();
    expect(realLine(emptyUsage(), 'x', 'gemini')).toBeNull();
    expect(realLine(setAcct(emptyUsage(), 'o', { kind: 'or', at: 0, usage: 1, limit: 5, remaining: 4 }), 'o', 'openrouter')).toMatch(/^quedan \$4\.00 de \$5\.00/);
    expect(realLine(setAcct(emptyUsage(), 'o', { kind: 'or', at: 0, usage: 0.1, free: true }), 'o', 'openrouter')).toMatch(/^gastado \$0\.10, sin tope · plan gratuito/);
    expect(realLine(setAcct(emptyUsage(), 'm', { kind: 'kimi', at: 0, balance: 12.34 }), 'm', 'kimi')).toMatch(/^saldo \$12\.3/);
  });
  it('fetchAcct: GET con Bearer a la URL de cuenta; nunca la clave en la URL; null si falla', async () => {
    const calls: { url: string; auth: string | null }[] = [];
    const f = (async (u: unknown, init?: RequestInit) => { calls.push({ url: String(u), auth: new Headers(init?.headers).get('authorization') }); return new Response('{"data":{"available_balance":3}}', { status: 200 }); }) as typeof fetch;
    expect(await fetchAcct('kimi', 'sk-SECRETO', new AbortController().signal, f)).toMatchObject({ kind: 'kimi', balance: 3 });
    expect(calls).toEqual([{ url: ACCT_URL.kimi, auth: 'Bearer sk-SECRETO' }]);
    expect(await fetchAcct('openrouter', 'k', new AbortController().signal, (async () => new Response('x', { status: 401 })) as typeof fetch)).toBeNull();
    expect(await fetchAcct('gemini', 'k', new AbortController().signal, f)).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
