// Un turno sin texto ni propuesta nunca es silencio: devuelve code 'empty' con el motivo (sin claves).
import { beforeEach, describe, expect, it } from 'vitest';
import { jsonSchema, tool } from 'ai';
import { addKey, loadKeys, saveKeys } from '../src/chat/keys';
import { runTurn } from '../src/chat/session';

const store = new Map<string, string>();
const KEY = 'gsk_SECRETAclave1234567890';
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  saveKeys(addKey(loadKeys(), 'groq', 'uno', KEY)!);
});
const ev = (delta: object, fin: string | null) => `data: ${JSON.stringify({ id: '1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: fin }] })}\n\n`;
const resp = (...evs: string[]) => new Response(evs.join('') + 'data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
const f = (mk: () => Response) => (async () => mk()) as unknown as typeof fetch;
const base = { messages: [{ role: 'user' as const, content: 'hola' }], sleep: async () => {} };
const tools = { crear_examen: tool({ description: 'x', inputSchema: jsonSchema<{ a: string }>({ type: 'object', properties: { a: { type: 'string' } } }), execute: async () => ({ ok: 1 }) }) };

describe('turno vacío', () => {
  it('sin texto y finish length → empty con motivo', async () => {
    const r = await runTurn({ ...base, fetch: f(() => resp(ev({ role: 'assistant' }, null), ev({}, 'length'))) });
    expect(r).toMatchObject({ ok: false, code: 'empty' });
    if (!r.ok) expect(r.detail?.msg).toMatch(/motivo: length · pasos 1/);
  });
  it('tool-calls truncados repetidos: el último paso va sin herramientas y cierra con texto', async () => {
    const call = () => resp(ev({ role: 'assistant', tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'crear_examen', arguments: `{"a":"${KEY}` } }] }, null), ev({}, 'tool_calls'));
    let n = 0, last: { tool_choice?: unknown } = {};
    const fx = (async (_u: unknown, init?: RequestInit) => {
      n++; last = JSON.parse(String(init?.body));
      return last.tool_choice === 'none' ? resp(ev({ role: 'assistant', content: 'No pude armar el examen.' }, null), ev({}, 'stop')) : call();
    }) as unknown as typeof fetch;
    const r = await runTurn({ ...base, tools, fetch: fx });
    expect(r).toMatchObject({ ok: true, text: 'No pude armar el examen.' });
    expect(n).toBe(6);
    expect(last.tool_choice).toBe('none');
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
  it('respuesta normal intacta', async () => {
    const r = await runTurn({ ...base, fetch: f(() => resp(ev({ role: 'assistant', content: 'Hola' }, null), ev({}, 'stop'))) });
    expect(r).toMatchObject({ ok: true, text: 'Hola' });
  });
  it('turno con propuesta no se marca vacío', async () => {
    const r = await runTurn({ ...base, produced: () => true, fetch: f(() => resp(ev({ role: 'assistant' }, null), ev({}, 'stop'))) });
    expect(r.ok).toBe(true);
  });
});
