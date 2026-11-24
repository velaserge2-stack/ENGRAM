import { beforeEach, describe, expect, it } from 'vitest';
import { classify, redact } from '../src/chat/errors';
import { addKey, loadKeys, MAX_KEYS, saveKeys } from '../src/chat/keys';
import { listModels } from '../src/chat/models';
import { loadModel, PROVIDERS, type ProviderId } from '../src/chat/providers';
import { runTurn } from '../src/chat/session';

const store = new Map<string, string>();
const OR = 'sk-or-v1-abcdef1234567890abcdef', KM = 'sk-moonshotABCDEFGH1234567890';
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
});
const chunk = (delta: object, fin: string | null = null) => `data: ${JSON.stringify({ id: '1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: fin }] })}\n\n`;
const sse = (...parts: string[]) => new Response(parts.join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
const text = (s: string) => sse(chunk({ role: 'assistant', content: s }), chunk({}, 'stop'));
const err = (status: number, body = '{"error":{"message":"x"}}', headers: Record<string, string> = {}) => new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } });
const rec = (...rs: Response[]) => {
  const calls: { url: string; auth: string | null; hdrs: string[]; body: string }[] = [];
  const f = (async (u: unknown, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    calls.push({ url: String(u), auth: h.get('authorization'), hdrs: [...h.keys()], body: String(init?.body ?? '') });
    return rs[Math.min(calls.length - 1, rs.length - 1)]!.clone();
  }) as typeof fetch;
  return { f, calls };
};
const base = { messages: [{ role: 'user' as const, content: 'hola' }], sleep: async () => {} };
const NEW = [['openrouter', OR, 'https://openrouter.ai/api/v1/chat/completions'], ['kimi', KM, 'https://api.moonshot.ai/v1/chat/completions']] as const;

describe.each(NEW)('%s · createOpenAICompatible', (p, key, url) => {
  it('texto en streaming: URL base, Bearer, modelo, sin cabeceras de identificación', async () => {
    saveKeys(addKey(loadKeys(), p, 'a', key)!);
    const { f, calls } = rec(text('Hola'));
    const parts: string[] = [];
    const r = await runTurn({ ...base, fetch: f, onText: (d) => parts.push(d) });
    expect(r).toMatchObject({ ok: true, text: 'Hola' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(url);
    expect(calls[0]!.auth).toBe('Bearer ' + key);
    expect(calls[0]!.body).toContain(PROVIDERS[p].model);
    expect(calls[0]!.hdrs).not.toContain('http-referer');
    expect(calls[0]!.hdrs).not.toContain('x-title');
    expect(calls.map((c) => c.url).join()).not.toContain(key);
  });
  it('tool-call', async () => {
    saveKeys(addKey(loadKeys(), p, 'a', key)!);
    const { f } = rec(sse(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'dime', arguments: '{"a":1}' } }] }), chunk({}, 'tool_calls')), text('listo'));
    const names: string[] = [];
    const core = await import('ai'), { z } = await import('zod');
    const r = await runTurn({ ...base, fetch: f, onTool: (n) => names.push(n), tools: { dime: core.tool({ description: 'x', inputSchema: z.object({ a: z.number() }), execute: async () => 'ok' }) } });
    expect(names).toEqual(['dime']);
    expect(r).toMatchObject({ ok: true, text: 'listo' });
  });
  it.each([[401, 'auth'], [402, 'quota'], [429, 'rate'], [404, 'model']] as const)('HTTP %i → %s', async (st, kind) => {
    saveKeys(addKey(loadKeys(), p, 'a', key)!);
    const r = await runTurn({ ...base, fetch: rec(err(st, `{"error":{"message":"fallo ${key}"}}`)).f });
    expect(r).toMatchObject({ ok: false, code: kind });
    expect(JSON.stringify(r)).not.toContain(key);
  });
  it('modelos: GET {base}/models con Bearer', async () => {
    const { f, calls } = rec(new Response(JSON.stringify({ data: [{ id: 'z/paga', pricing: { prompt: '0.1', completion: '0.1' } }, { id: 'a/gratis:free' }, { id: 'b/cero', pricing: { prompt: '0', completion: '0' } }] }), { status: 200 }));
    const r = await listModels(p, key, new AbortController().signal, f);
    expect(calls[0]).toMatchObject({ url: url.replace('/chat/completions', '/models'), auth: 'Bearer ' + key });
    expect(r.ok && r.ids.length).toBe(3);
    if (r.ok && p === 'openrouter') expect(r.ids.slice(0, 2).sort()).toEqual(['a/gratis:free', 'b/cero']);
  });
});

describe('classify OpenRouter / Kimi', () => {
  const c = (p: ProviderId, statusCode: number, responseBody = '', responseHeaders?: Record<string, string>) => classify(p, { statusCode, responseBody, responseHeaders }, 1_000_000);
  it.each([
    ['openrouter', 401, '', 'auth'], ['openrouter', 402, '', 'quota'], ['openrouter', 403, '{"error":{"message":"flagged"}}', 'other'],
    ['openrouter', 404, '', 'model'], ['openrouter', 400, '{"error":{"message":"x is not a valid model ID"}}', 'model'],
    ['openrouter', 429, '{"error":{"message":"Rate limit exceeded: free-models-per-day"}}', 'quota'], ['openrouter', 429, '{"error":{"message":"Rate limit"}}', 'rate'],
    ['openrouter', 503, '', 'server'],
    ['kimi', 401, '', 'auth'], ['kimi', 429, '{"error":{"type":"exceeded_current_quota_error","message":"x"}}', 'quota'],
    ['kimi', 429, '{"error":{"message":"insufficient balance"}}', 'quota'], ['kimi', 429, '{"error":{"type":"rate_limit_reached_error"}}', 'rate'],
    ['kimi', 400, '{"error":{"message":"Not found the model foo or Permission denied"}}', 'model'], ['kimi', 404, '', 'model'],
  ] as const)('%s %i → %s', (p, st, body, kind) => expect(c(p, st, body).kind).toBe(kind));
  it('429 respeta retry-after', () => expect(c('openrouter', 429, '', { 'retry-after': '7' }).retryAfterMs).toBe(7000));
  it('403 conserva detalle', () => expect(c('openrouter', 403, '{"error":{"message":"flagged"}}').detail).toMatchObject({ status: 403, msg: 'flagged' }));
  it('redact cubre sk-or-… y sk-…', () => {
    expect(redact(`k=${OR} y ${KM}`)).not.toMatch(/sk-or-v1|sk-moonshot/);
    expect(redact(`Authorization: Bearer ${KM}`)).not.toContain(KM);
  });
});

describe('4 claves y rotación', () => {
  it('rota por las cuatro en orden, una vez cada una', async () => {
    let s = loadKeys();
    const ks = ['gsk_uno1234567890123456', OR, KM, 'gsk_cuatro1234567890123'];
    s = ks.reduce((a, k, i) => addKey(a, i === 1 ? 'openrouter' : i === 2 ? 'kimi' : 'groq', 'k' + i, k)!, s);
    saveKeys(s);
    expect(addKey(s, 'groq', 'x', 'otra')).toBeNull();
    expect(MAX_KEYS).toBe(4);
    const { f, calls } = rec(err(401), err(402), err(429, '{"error":{"type":"exceeded_current_quota_error"}}'), text('ok'));
    const r = await runTurn({ ...base, fetch: f });
    expect(calls.map((c) => c.auth)).toEqual(ks.map((k) => 'Bearer ' + k));
    expect(r).toMatchObject({ ok: true, alias: 'k3', rotated: true });
  });
});

describe('loadModel', () => {
  it('no usa la pasarela de cadenas (objeto modelo)', async () => {
    expect(typeof (await loadModel('kimi', KM))).toBe('object');
  });
});
