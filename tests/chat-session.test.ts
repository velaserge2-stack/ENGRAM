import { beforeEach, describe, expect, it } from 'vitest';
import { addKey, loadKeys, saveKeys } from '../src/chat/keys';
import { busy, runTurn } from '../src/chat/session';
import { loadUsage } from '../src/chat/usage';

const store = new Map<string, string>();
const SK1 = 'gsk_PRIMERAclave1234567890', SK2 = 'gsk_SEGUNDAclave1234567890';
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  let s = addKey(loadKeys(), 'groq', 'uno', SK1)!;
  s = addKey(s, 'groq', 'dos', SK2)!;
  saveKeys(s);
});

const chunk = (delta: object, extra: object = {}) => `data: ${JSON.stringify({ id: '1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: null }], ...extra })}\n\n`;
const sse = (text: string) => new Response(
  chunk({ role: 'assistant', content: text }) +
  `data: ${JSON.stringify({ id: '1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], x_groq: { usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }, usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } })}\n\ndata: [DONE]\n\n`,
  { status: 200, headers: { 'content-type': 'text/event-stream', 'x-ratelimit-remaining-requests': '99', 'x-ratelimit-limit-requests': '100' } });
const err = (status: number, body = '{"error":{"message":"x"}}', headers: Record<string, string> = {}) => new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });

function fake(...rs: Array<Response | (() => Response) | Error>) {
  const calls: Array<{ auth: string | null }> = [];
  const f = (async (_u: unknown, init?: RequestInit) => {
    calls.push({ auth: new Headers(init?.headers).get('authorization') });
    const r = rs[Math.min(calls.length - 1, rs.length - 1)]!;
    if (r instanceof Error) throw r;
    return typeof r === 'function' ? r() : r.clone();
  }) as typeof fetch;
  return { f, calls };
}
const base = { messages: [{ role: 'user' as const, content: 'hola' }], sleep: async () => {} };

describe('chat session', () => {
  it('éxito: un solo fetch, sin reintentos, texto y uso', async () => {
    const { f, calls } = fake(sse('Hola'));
    const chunks: string[] = [];
    const r = await runTurn({ ...base, fetch: f, onText: (d) => chunks.push(d) });
    expect(r).toMatchObject({ ok: true, text: 'Hola', alias: 'uno', rotated: false, tokens: 7 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.auth).toBe('Bearer ' + SK1);
    expect(chunks.join('')).toBe('Hola');
    expect(Object.values(loadUsage().perKey)[0]!.req).toBe(1);
    expect(busy()).toBe(false);
  });
  it('quota (429 por día) rota una vez a la segunda clave', async () => {
    const { f, calls } = fake(err(429, 'Rate limit: tokens per day (TPD)'), sse('ok'));
    const st: string[] = [];
    const r = await runTurn({ ...base, fetch: f, onStatus: (s) => st.push(s.code) });
    expect(r).toMatchObject({ ok: true, alias: 'dos', rotated: true });
    expect(calls.map((c) => c.auth)).toEqual(['Bearer ' + SK1, 'Bearer ' + SK2]);
    expect(loadKeys().keys[0]!.status).toBe('exhausted');
    expect(st).toEqual(['rotated']);
  });
  it('401 marca invalid y rota; si la segunda también falla, no hay tercera', async () => {
    const { f, calls } = fake(err(401), err(401));
    const r = await runTurn({ ...base, fetch: f });
    expect(r).toMatchObject({ ok: false, code: 'auth', rotated: true });
    expect(calls).toHaveLength(2);
    expect(loadKeys().keys.map((k) => k.status)).toEqual(['invalid', 'active']);
  });
  it('429 por minuto espera retry-after (tope 60 s) con la misma clave', async () => {
    const { f, calls } = fake(err(429, 'tokens per minute', { 'retry-after': '500' }), sse('ok'));
    const waits: number[] = [];
    const r = await runTurn({ ...base, fetch: f, sleep: async (ms) => void waits.push(ms) });
    expect(r).toMatchObject({ ok: true, alias: 'uno', rotated: false });
    expect(waits).toEqual([60_000]);
    expect(calls.map((c) => c.auth)).toEqual(['Bearer ' + SK1, 'Bearer ' + SK1]);
  });
  it('red, 5xx y cancelado no rotan', async () => {
    for (const rs of [new TypeError('Failed to fetch'), err(503)]) {
      const { f, calls } = fake(rs);
      const r = await runTurn({ ...base, fetch: f });
      expect(r.ok).toBe(false);
      expect(calls).toHaveLength(1);
      expect(loadKeys().keys.every((k) => k.status === 'active')).toBe(true);
    }
    const ac = new AbortController(); ac.abort();
    const { f, calls } = fake(sse('x'));
    expect(await runTurn({ ...base, fetch: f, signal: ac.signal })).toMatchObject({ ok: false, code: 'aborted' });
    expect(calls.length).toBeLessThanOrEqual(1);
  });
  it('busy: la segunda llamada simultánea se rechaza', async () => {
    const { f } = fake(sse('a'));
    const p = runTurn({ ...base, fetch: f });
    expect(busy()).toBe(true);
    expect(await runTurn({ ...base, fetch: f })).toMatchObject({ ok: false, code: 'busy' });
    await p;
    expect(busy()).toBe(false);
  });
  it('sin claves: nokey; el mensaje de error no filtra la clave', async () => {
    store.clear();
    expect(await runTurn({ ...base })).toMatchObject({ ok: false, code: 'nokey' });
    saveKeys(addKey(loadKeys(), 'groq', 'a', SK1)!);
    const { f } = fake(err(500, `{"error":{"message":"fallo con ${SK1}"}}`));
    const r = await runTurn({ ...base, fetch: f });
    expect(JSON.stringify(r)).not.toContain(SK1);
  });
});
