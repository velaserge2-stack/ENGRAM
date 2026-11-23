// @vitest-environment jsdom
// Fase 5 · parte 1: hallazgos de la revisión de seguridad del Asistente.
import { jsonSchema, tool } from 'ai';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { harden } from '../src/chat/conv';
import { redact } from '../src/chat/errors';
import { addKey, loadKeys, saveKeys } from '../src/chat/keys';
import { runTurn } from '../src/chat/session';
import type { Source } from '../src/chat/tools';
import { t } from '../src/i18n';
import { renderMarkdown } from '../src/md/render';
import { mergeSettings } from '../src/lib/settings';
import { Ctx } from '../src/state';

const getPage = vi.fn(async () => ({ getTextContent: async () => ({ items: [] }), cleanup() {} }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 500, getPage }), destroy: async () => {} }) }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'w.js' }));

const SK1 = 'gsk_PRIMERAclave1234567890', SK2 = 'gsk_SEGUNDAclave1234567890', SK3 = 'gsk_TERCERAclave1234567890';
beforeEach(() => {
  localStorage.clear();
  let s = addKey(loadKeys(), 'groq', 'uno', SK1)!;
  s = addKey(s, 'groq', 'dos', SK2)!;
  saveKeys(s);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const usage = { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 };
const ck = (delta: object, fin: string | null = null, extra: object = {}) => `data: ${JSON.stringify({ id: '1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: fin }], ...extra })}\n\n`;
const hdrs = { 'content-type': 'text/event-stream' };
const sse = (text: string) => new Response(ck({ role: 'assistant', content: text }) + ck({}, 'stop', { usage }) + 'data: [DONE]\n\n', { status: 200, headers: hdrs });
const toolCall = () => new Response(ck({ role: 'assistant', tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'buscar', arguments: '{}' } }] }) + ck({}, 'tool_calls', { usage }) + 'data: [DONE]\n\n', { status: 200, headers: hdrs });
const err = (status: number, body = '{"error":{"message":"x"}}') => new Response(body, { status, headers: { 'content-type': 'application/json' } });
const base = { messages: [{ role: 'user' as const, content: 'hola' }], sleep: async () => {} };
const seq = (...rs: Array<Response | (() => Response)>) => {
  const calls: string[] = [];
  const f = (async (_u: unknown, init?: RequestInit) => {
    calls.push(new Headers(init?.headers).get('authorization') ?? '');
    const r = rs[Math.min(calls.length - 1, rs.length - 1)]!;
    return typeof r === 'function' ? r() : r.clone();
  }) as typeof fetch;
  return { f, calls };
};

describe('rotación y herramientas', () => {
  it('(a) una clave borrada durante el turno no reaparece al rotar', async () => {
    const { f, calls } = seq(() => { saveKeys({ v: 1, keys: loadKeys().keys.filter((k) => k.alias !== 'uno') }); return err(429, 'tokens per day (TPD)'); }, sse('ok'));
    const r = await runTurn({ ...base, fetch: f });
    expect(r).toMatchObject({ ok: true, alias: 'dos' });
    expect(calls).toHaveLength(2);
    expect(loadKeys().keys.map((k) => k.alias)).toEqual(['dos']);
  });
  it('(b) un error tras una herramienta no repite la herramienta ni rota', async () => {
    let runs = 0;
    const tools = { buscar: tool({ description: 'x', inputSchema: jsonSchema({ type: 'object', properties: {} }), execute: async () => { runs++; return { ok: 1 }; } }) };
    const { f, calls } = seq(toolCall(), err(429, 'tokens per day (TPD)'));
    const r = await runTurn({ ...base, fetch: f, tools });
    expect(r.ok).toBe(false);
    expect(runs).toBe(1);
    expect(calls).toHaveLength(2);
  });
  it('(8) con 3 claves rota hasta la tercera, una vez por clave', async () => {
    saveKeys(addKey(loadKeys(), 'groq', 'tres', SK3)!);
    const { f, calls } = seq(err(429, 'tokens per day'), err(429, 'tokens per day'), sse('ok'));
    expect(await runTurn({ ...base, fetch: f })).toMatchObject({ ok: true, alias: 'tres' });
    expect(calls).toEqual(['Bearer ' + SK1, 'Bearer ' + SK2, 'Bearer ' + SK3]);
    const f2 = seq(err(401), err(401), err(401));
    localStorage.clear(); saveKeys(addKey(addKey(addKey({ v: 1, keys: [] }, 'groq', 'a', SK1)!, 'groq', 'b', SK2)!, 'groq', 'c', SK3)!);
    expect(await runTurn({ ...base, fetch: f2.f })).toMatchObject({ ok: false, code: 'auth' });
    expect(f2.calls).toHaveLength(3);
  });
  it('403 pausa la clave (no queda invalid para siempre)', async () => {
    await runTurn({ ...base, fetch: seq(err(403), sse('ok')).f });
    expect(loadKeys().keys[0]!.status).toBe('paused');
  });
});

describe('PDF y tiempo', () => {
  it('(c) un PDF de 500 páginas solo lee 60', async () => {
    const { pdfText } = await import('../src/io/extract');
    getPage.mockClear();
    const r = await pdfText(new Uint8Array(4), 60);
    expect(getPage).toHaveBeenCalledTimes(60);
    expect(r.pages).toHaveLength(60);
  });
  it('(f) un stream colgado termina por timeout y no rota', async () => {
    vi.useFakeTimers();
    const f = ((_u: unknown, init?: RequestInit) => new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' }))))) as typeof fetch;
    const p = runTurn({ ...base, fetch: f });
    await vi.advanceTimersByTimeAsync(120_001);
    expect(await p).toMatchObject({ ok: false, code: 'network' });
    expect(loadKeys().keys.every((k) => k.status === 'active')).toBe(true);
  });
  it('(h) la clave no aparece en el mensaje con responseBody/requestBodyValues/cabeceras', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const body = JSON.stringify({ error: { message: `bad ${SK1}` } });
    const f = (async () => new Response(body, { status: 500, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + SK1, 'x-goog-api-key': SK1 } })) as typeof fetch;
    const r = await runTurn({ ...base, fetch: f });
    expect(JSON.stringify(r)).not.toContain(SK1);
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining(SK1));
    for (const s of [`{"x-goog-api-key": "${SK1}"}`, `x-goog-api-key: ${SK1}`, `Authorization: Bearer ${SK1}`, `{"authorization":"Bearer ${SK1}"}`]) expect(redact(s)).not.toContain(SK1.slice(6));
  });
});

describe('render del chat', () => {
  const src: Source[] = [{ tipo: 'nota', ruta: 'notes/Real.md', titulo: 'Real' }];
  it('(d) sin href externo, javascript:, data: ni medios; [[X]] no citado es inerte', () => {
    const el = document.createElement('div');
    el.innerHTML = renderMarkdown('[x](https://evil.test/?d=SECRETO) [j](javascript:alert(1)) [d](data:text/html,hola) ![](https://evil.test/p.png) ![[foto.png]] [[Real]] [[Inventada]]');
    harden(el, src);
    expect(el.querySelectorAll('img, audio, video, [data-media]').length).toBe(0);
    const hrefs = [...el.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs).toEqual(['#/notas/Real.md']);
    expect([...el.querySelectorAll('[href],[src]')].map((n) => n.getAttribute('href') ?? n.getAttribute('src')).join()).not.toMatch(/evil|javascript|data:/);
    expect(el.textContent).toContain('(evil.test)');
    expect(el.querySelector('.chat-cite.off')?.textContent).toContain('Inventada');
  });
});

describe('Probar durante un turno', () => {
  it('(e) con un turno en curso, «Probar» está deshabilitado y no hace petición', async () => {
    let n = 0;
    const f = (() => { n++; return new Promise(() => {}); }) as typeof fetch;
    void runTurn({ ...base, fetch: f });
    await new Promise((r) => setTimeout(r, 20));
    const { AssistantBody } = await import('../src/screens/assistant');
    const host = document.createElement('div');
    document.body.append(host);
    await act(() => { render(h(Ctx.Provider, { value: { settings: mergeSettings({}) } as never }, h(AssistantBody, {})), host); });
    const btn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(t('chat.probar')))!;
    expect(btn.disabled).toBe(true);
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(n).toBe(1);
  });
});
