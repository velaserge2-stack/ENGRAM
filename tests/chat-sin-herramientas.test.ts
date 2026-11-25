import { beforeEach, describe, expect, it } from 'vitest';
import { addKey, loadKeys, saveKeys } from '../src/chat/keys';
import { NO_TOOLS, runTurn } from '../src/chat/session';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
});
const chunk = (delta: object, fin: string | null = null) => `data: ${JSON.stringify({ id: '1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: fin }] })}\n\n`;
const text = (s: string) => new Response(chunk({ role: 'assistant', content: s }) + chunk({}, 'stop') + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
const GROQ_400 = '{"error":{"message":"`tool calling` is not supported with this model","type":"invalid_request_error"}}';

describe('modelo sin herramientas', () => {
  it('reconoce los mensajes de Groq, OpenRouter y genéricos', () => {
    expect(NO_TOOLS.test('`tool calling` is not supported with this model')).toBe(true);
    expect(NO_TOOLS.test('No endpoints found that support tool use.')).toBe(true);
    expect(NO_TOOLS.test('This model does not support tools')).toBe(true);
    expect(NO_TOOLS.test('model not found')).toBe(false);
  });
  it('Groq 400 «tool calling not supported» → repite una vez sin herramientas y avisa', async () => {
    saveKeys(addKey(loadKeys(), 'groq', 'G', 'gsk_TEST0123456789abcdef')!);
    const bodies: string[] = [];
    const rs = [new Response(GROQ_400, { status: 400, headers: { 'content-type': 'application/json' } }), text('Hola')];
    const f = (async (_u: unknown, init?: RequestInit) => { bodies.push(String(init?.body ?? '')); return rs[Math.min(bodies.length - 1, 1)]!.clone(); }) as typeof fetch;
    const core = await import('ai'), { z } = await import('zod');
    const st: string[] = [];
    const r = await runTurn({ messages: [{ role: 'user', content: 'hola' }], sleep: async () => {}, fetch: f, onStatus: (s) => st.push(s.code),
      tools: { dime: core.tool({ description: 'x', inputSchema: z.object({ a: z.number() }), execute: async () => 'ok' }) } });
    expect(r).toMatchObject({ ok: true, text: 'Hola' });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain('"tools"');
    expect(bodies[1]).not.toContain('"tools"');
    expect(st).toEqual(['notools']);
    expect(loadKeys().keys[0]!.status).toBe('active'); // la clave no se marca mala
  });
});
