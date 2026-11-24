import { describe, expect, it, vi } from 'vitest';
import { listModels, parseGemini, parseGroq, suggest } from '../src/chat/models';
import { loadModel, modelOf, PROVIDERS, setModels } from '../src/chat/providers';
import { defaultChat, defaultSettings, mergeSettings, normModel, serializeSettings } from '../src/lib/settings';

const KEY = 'AIzaSyTESTKEY0123456789abcdefghij';
const res = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const gm = (name: string, m = ['generateContent']) => ({ name: 'models/' + name, supportedGenerationMethods: m });

describe('ajuste chat.models', () => {
  it('validación y merge', () => {
    expect(['gemini-2.5-flash', 'meta-llama/llama-4:x_1'].map(normModel)).toEqual(['gemini-2.5-flash', 'meta-llama/llama-4:x_1']);
    for (const bad of ['', ' ', 'a b', 'x'.repeat(81), '<b>', 7, null, 'a?key=1']) expect(normModel(bad)).toBe('');
    expect(mergeSettings({ chat: { models: { gemini: ' gemini-x ', groq: 'mal modelo', otro: 'zz' } } }).chat.models).toEqual({ gemini: 'gemini-x' });
    expect(mergeSettings({}).chat.models).toEqual({});
    expect(defaultChat().models).toEqual({});
    const j = serializeSettings({ ...defaultSettings(), chat: { ...defaultChat(), models: { groq: 'llama-x' } } });
    expect(JSON.parse(j).chat.models).toEqual({ groq: 'llama-x' });
    expect(j).not.toMatch(/apiKey|AIza|gsk_/);
  });
  it('el modelo elegido llega a loadModel; vacío = defecto', async () => {
    expect(modelOf('gemini')).toBe(PROVIDERS.gemini.model);
    setModels({ groq: 'llama-elegido' });
    expect(modelOf('groq')).toBe('llama-elegido');
    expect(modelOf('gemini')).toBe(PROVIDERS.gemini.model);
    const m = await loadModel('groq', 'gsk_0123456789abcdef0123', vi.fn() as never);
    expect((m as { modelId: string }).modelId).toBe('llama-elegido');
    setModels({});
    expect(((await loadModel('groq', 'gsk_0123456789abcdef0123', vi.fn() as never)) as { modelId: string }).modelId).toBe(PROVIDERS.groq.model);
  });
});

describe('listado de modelos', () => {
  it('parsea y filtra', () => {
    const g = parseGemini({ models: [gm('gemini-2.5-flash'), gm('gemini-2.5-pro'), gm('text-embedding-004', ['embedContent']), gm('gemini-2.5-flash-preview-tts'), { name: 3 }], nextPageToken: 'T' });
    expect(g).toEqual({ ids: ['gemini-2.5-flash', 'gemini-2.5-pro'], next: 'T' });
    expect(parseGemini(null).ids).toEqual([]);
    expect(parseGroq({ data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'whisper-large-v3' }, { id: 'llama-guard-4' }, { id: 'old', active: false }, { id: 'playai-tts' }, {}] }).ids).toEqual(['llama-3.3-70b-versatile']);
    expect(parseGroq(undefined).ids).toEqual([]);
    expect(suggest('gemini', ['gemini-pro', 'gemini-flash'])).toBe('gemini-flash');
    expect(suggest('groq', ['a', 'llama-x'])).toBe('llama-x');
    expect(suggest('groq', ['a'])).toBeUndefined();
  });
  it('Gemini: cabecera (no URL), paginación y orden', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return url.includes('pageToken=P2') ? res(200, { models: [gm('gemini-b-flash')] }) : res(200, { models: [gm('zeta-pro'), gm('gemini-a-flash')], nextPageToken: 'P2' }); });
    const r = await listModels('gemini', KEY, new AbortController().signal, f as never);
    expect(r).toEqual({ ok: true, ids: ['gemini-a-flash', 'gemini-b-flash', 'zeta-pro'], suggested: 'gemini-a-flash' });
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => !c.url.includes(KEY) && !/key=/.test(c.url) && (c.init.headers as Record<string, string>)['x-goog-api-key'] === KEY && c.init.method === 'GET')).toBe(true);
  });
  it('tope de páginas', async () => {
    const f = vi.fn(async () => res(200, { models: [gm('m' + Math.random())], nextPageToken: 'N' }));
    await listModels('gemini', KEY, new AbortController().signal, f as never);
    expect(f).toHaveBeenCalledTimes(5);
  });
  it('Groq: Bearer, una petición, vacío', async () => {
    const f = vi.fn(async () => res(200, { data: [] }));
    const r = await listModels('groq', 'gsk_0123456789abcdef0123', new AbortController().signal, f as never);
    expect(r).toEqual({ ok: true, ids: [], suggested: undefined });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/models');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_0123456789abcdef0123');
  });
  it.each([[401, 'auth'], [403, 'auth'], [404, 'model'], [500, 'server'], [503, 'server']])('error %i → %s, sin clave en el detalle', async (st, kind) => {
    const f = async () => res(st, { error: { code: st, status: 'X', message: `bad ${KEY} x-goog-api-key: ${KEY}` } });
    const r = await listModels('gemini', KEY, new AbortController().signal, f as never);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.c.kind).toBe(kind); expect(r.c.detail?.status).toBe(st); expect(JSON.stringify(r.c)).not.toContain(KEY); }
  });
  it('red caída, JSON malo y cancelación', async () => {
    const down = await listModels('groq', 'gsk_0123456789abcdef0123', new AbortController().signal, (async () => { throw new TypeError('Failed to fetch'); }) as never);
    expect(down).toMatchObject({ ok: false, c: { kind: 'network' } });
    expect(await listModels('groq', 'gsk_0123456789abcdef0123', new AbortController().signal, (async () => res(200, 'no json')) as never)).toMatchObject({ ok: false, c: { kind: 'other' } });
    const ac = new AbortController(); ac.abort();
    expect(await listModels('groq', 'gsk_0123456789abcdef0123', ac.signal, (async () => { throw new DOMException('x', 'AbortError'); }) as never)).toMatchObject({ ok: false, c: { kind: 'aborted' } });
  });
});
