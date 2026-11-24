import { beforeEach, describe, expect, it, vi } from 'vitest';
import { classify } from '../src/chat/errors';
import { trimMessages } from '../src/chat/history';
import { addKey, loadKeys, saveKeys } from '../src/chat/keys';
import { BUDGET, budget, estTokens, SYS_TOKENS, setModels, toolCap, type CtxMode, type ProviderId } from '../src/chat/providers';
import { runTurn } from '../src/chat/session';
import { makeTools, type ToolCtx } from '../src/chat/tools';
import { defaultSettings, mergeSettings, serializeSettings } from '../src/lib/settings';
import { MemoryBackend } from '../src/vault/memory';

vi.mock('../src/io/extract', () => ({
  pdfText: async (_b: unknown, upto: number) => ({ pages: Array.from({ length: Math.min(upto, 300) }, (_, i) => ({ lines: [{ text: `pagina ${i + 1} osmosis agua`, size: 12 }] })) }),
}));

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  setModels({}, 'normal');
});
const enc = (s: string) => new TextEncoder().encode(s);
const run = async (tools: any, name: string, input: object) => tools[name].execute(input, { toolCallId: 't', messages: [] }); // eslint-disable-line @typescript-eslint/no-explicit-any
const ctxOf = (v: MemoryBackend): ToolCtx => ({ vault: v, col: null, today: '2026-03-01', sources: [] });
const PROVS = Object.keys(BUDGET) as ProviderId[], MODES: CtxMode[] = ['normal', 'amplio'];

describe('presupuestos por proveedor y modo', () => {
  it('amplio >= normal en todo y todo es positivo', () => {
    for (const p of PROVS) {
      const n = BUDGET[p].normal, a = BUDGET[p].amplio;
      for (const k of ['maxOut', 'steps', 'histTokens', 'noteChars', 'writeChars'] as const) { expect(n[k]).toBeGreaterThan(0); expect(a[k]).toBeGreaterThanOrEqual(n[k]); }
      expect(a.frag.n).toBeGreaterThanOrEqual(n.frag.n); expect(a.pdf.pages).toBeGreaterThanOrEqual(n.pdf.pages);
    }
  });
  it('Gemini amplio y budget() sigue el modo', () => {
    expect(BUDGET.gemini.amplio).toMatchObject({ maxOut: 32_768, steps: 12, histTokens: 200_000, frag: { n: 16, chars: 2000 }, noteChars: 60_000, pdf: { files: 5, pages: 200 }, writeChars: 100_000 });
    setModels({}, 'amplio');
    expect(budget('gemini').maxOut).toBe(32_768);
    setModels({}, 'normal');
    expect(budget('gemini').maxOut).toBe(8192);
  });
  it('Groq nunca supera su tope (salida ≤ 8192 y total estimado ≤ ~10 000 tokens, 6 pasos)', () => {
    for (const m of MODES) {
      const b = BUDGET.groq[m];
      expect(b.maxOut).toBeLessThanOrEqual(8192);
      expect(b.steps).toBeLessThanOrEqual(6);
      expect(SYS_TOKENS + b.histTokens + estTokens(toolCap(b)) + b.maxOut).toBeLessThanOrEqual(10_000);
      expect(b.noteChars).toBeLessThanOrEqual(toolCap(b));
    }
  });
});

describe('ajuste settings.chat.context', () => {
  it('defecto normal, valores raros vuelven a normal, amplio se conserva', () => {
    expect(defaultSettings().chat.context).toBe('normal');
    const s = defaultSettings(); (s.chat as { context: unknown }).context = 'amplio';
    expect(mergeSettings(JSON.parse(serializeSettings(s))).chat.context).toBe('amplio');
    (s.chat as { context: unknown }).context = 'x';
    expect(mergeSettings(JSON.parse(JSON.stringify(s))).chat.context).toBe('normal');
    expect(mergeSettings({}).chat.context).toBe('normal');
  });
});

describe('historial por tokens', () => {
  const u = (c: string) => ({ role: 'user' as const, content: c }), a = (c: string) => ({ role: 'assistant' as const, content: c });
  it('sin exceso: igual', () => { const m = [u('hola'), a('qué tal'), u('bien')]; expect(trimMessages(m, 1000)).toEqual(m); });
  it('recorta lo antiguo, conserva el último del usuario y avisa de los omitidos', () => {
    const m = Array.from({ length: 20 }, (_, i) => (i % 2 ? a : u)(`m${i} ` + 'y'.repeat(396)));
    m.push(u('ÚLTIMA pregunta'));
    const out = trimMessages(m, 500);
    expect(out[out.length - 1]!.content).toBe('ÚLTIMA pregunta');
    expect(out[0]!.role).toBe('user');
    expect(String(out[0]!.content)).toMatch(/Se omitieron \d+ mensajes antiguos/);
    expect(out.length).toBeLessThan(m.length);
  });
  it('el último mensaje se conserva aunque él solo exceda el presupuesto; respuestas viejas se acortan antes de descartar', () => {
    expect(trimMessages([u('z'.repeat(4000))], 10)).toHaveLength(1);
    const m = [u('p1'), a('r'.repeat(3000)), u('p2'), a('s'), u('p3')];
    const out = trimMessages(m, 700);
    expect(out).toHaveLength(5); // cabe tras acortar la respuesta larga
    expect(String(out[1]!.content).length).toBeLessThan(900);
  });
});

describe('herramientas con presupuesto', () => {
  async function vault() {
    const v = new MemoryBackend();
    const body = Array.from({ length: 400 }, (_, i) => `Párrafo ${i} sobre mitosis y división.`).join('\n');
    await v.write('notes/Bio/Larga.md', enc(`---\ntipo: clase\n---\n# Larga\n\n${body}\n`));
    await v.write('docs/Fisio.pdf', enc('%PDF-fake'));
    return v;
  }
  it('leer_nota pagina con desde / siguiente_desde y reconstruye la nota', async () => {
    const tools = makeTools(ctxOf(await vault()));
    const nc = budget().noteChars;
    const r1 = await run(tools, 'leer_nota', { titulo: 'Larga' });
    expect(r1.truncado).toBe(true);
    expect(r1.fragmentos[0].texto.length).toBeLessThanOrEqual(nc);
    const r2 = await run(tools, 'leer_nota', { titulo: 'Larga', desde: r1.siguiente_desde });
    expect(r2.desde).toBe(r1.siguiente_desde);
    expect(r2.fragmentos[0].texto.startsWith('Párrafo')).toBe(true);
    expect(r2.siguiente_desde ?? r2.total).toBeGreaterThan(r1.siguiente_desde);
  });
  it('amplio devuelve más de la nota que normal', async () => {
    const v = await vault();
    const n = (await run(makeTools(ctxOf(v)), 'leer_nota', { titulo: 'Larga' })).fragmentos[0].texto.length;
    setModels({}, 'amplio');
    const w = (await run(makeTools(ctxOf(v)), 'leer_nota', { titulo: 'Larga' })).fragmentos[0].texto.length;
    expect(w).toBeGreaterThan(n);
  });
  it('leer_pdf: rango desde/hasta y ventana acotada por pdf.pages', async () => {
    const tools = makeTools(ctxOf(await vault()));
    const r = await run(tools, 'leer_pdf', { consulta: 'osmosis', desde: 10, hasta: 12 });
    expect(r.paginas_leidas).toBe('10-12');
    expect(r.fragmentos.map((f: { fuente: { pagina: number } }) => f.fuente.pagina).sort((x: number, y: number) => x - y)).toEqual([10, 11, 12]);
    const big = await run(tools, 'leer_pdf', { consulta: 'osmosis', desde: 1, hasta: 999 });
    expect(big.paginas_leidas).toBe(`1-${budget().pdf.pages}`);
  });
  it('tope global por turno: se recorta y luego se rechaza', async () => {
    setModels({}, 'normal');
    const tools = makeTools(ctxOf(await vault()));
    // groq: tope 8000 caracteres por turno
    const { setActive } = await import('../src/chat/providers');
    setActive('groq');
    let total = 0, tope = false;
    for (let i = 0; i < 10 && !tope; i++) {
      const r = await run(tools, 'leer_nota', { titulo: 'Larga', desde: i * 2000 });
      if (r.tope) tope = true; else total += JSON.stringify(r).length;
    }
    expect(tope).toBe(true);
    expect(total).toBeLessThanOrEqual(toolCap(BUDGET.groq.normal));
    setActive('gemini');
  });
  it('solo se pueden citar las fuentes cuyo fragmento llegó al modelo (las recortadas por el tope no)', async () => {
    const { capped } = await import('../src/chat/tools');
    const ctx = ctxOf(new MemoryBackend());
    const src = (n: number) => ({ tipo: 'nota' as const, ruta: `notes/N${n}.md`, titulo: `N${n}` });
    const run = async () => {
      const fr = [1, 2, 3, 4].map((n) => { ctx.sources.push(src(n)); return { fuente: src(n), texto: 'x'.repeat(300) }; });
      return { aviso: 'DATOS', fragmentos: fr };
    };
    const used = { n: toolCap(budget()) - 900 }; // caben ~2 de los 4 fragmentos
    const r = await capped(run, used, ctx)({}) as { fragmentos: { fuente: { ruta: string } }[]; truncado?: boolean };
    expect(r.truncado).toBe(true);
    expect(r.fragmentos.length).toBeLessThan(4);
    expect(ctx.sources.map((s) => s.ruta)).toEqual(r.fragmentos.map((f) => f.fuente.ruta)); // citable ⇔ recibido
  });
});

describe('400 por max_tokens', () => {
  const body = JSON.stringify({ error: { message: 'max_tokens is too large: 8192. This model supports at most 4096 completion tokens', code: 'invalid_request_error' } });
  it('classify: kind limit con detalle', () => {
    const c = classify('groq', { statusCode: 400, responseBody: body, message: 'bad' });
    expect(c.kind).toBe('limit');
    expect(c.detail?.status).toBe(400);
    expect(classify('gemini', { statusCode: 400, responseBody: '{"error":{"message":"maxOutputTokens must be less than 65536"}}' }).kind).toBe('limit');
    expect(classify('groq', { statusCode: 400, responseBody: '{"error":{"message":"model_not_found"}}' }).kind).toBe('model');
  });
  const ok = () => new Response('data: ' + JSON.stringify({ id: '1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'Hola' }, finish_reason: null }] }) + '\n\ndata: ' + JSON.stringify({ id: '1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }) + '\n\ndata: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  function fake(...rs: Array<() => Response>) {
    const calls: { auth: string | null; max: number }[] = [];
    const f = (async (_u: unknown, init?: RequestInit) => { calls.push({ auth: new Headers(init?.headers).get('authorization'), max: JSON.parse(String(init?.body)).max_tokens }); return rs[Math.min(calls.length - 1, rs.length - 1)]!(); }) as typeof fetch;
    return { f, calls };
  }
  const bad = () => new Response(body, { status: 400, headers: { 'content-type': 'application/json' } });
  beforeEach(() => { let s = addKey(loadKeys(), 'groq', 'uno', 'gsk_PRIMERAclave1234567890')!; s = addKey(s, 'groq', 'dos', 'gsk_SEGUNDAclave1234567890')!; saveKeys(s); });
  it('reintenta UNA vez con la mitad y la misma clave', async () => {
    const { f, calls } = fake(bad, ok);
    const r = await runTurn({ messages: [{ role: 'user', content: 'hola' }], fetch: f });
    expect(r).toMatchObject({ ok: true, text: 'Hola', rotated: false });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.max).toBe(BUDGET.groq.normal.maxOut);
    expect(calls[1]!.max).toBe(BUDGET.groq.normal.maxOut >> 1);
    expect(calls[1]!.auth).toBe(calls[0]!.auth);
  });
  it('si vuelve a fallar: error limit, sin segundo reintento ni rotación', async () => {
    const { f, calls } = fake(bad);
    const r = await runTurn({ messages: [{ role: 'user', content: 'hola' }], fetch: f });
    expect(r).toMatchObject({ ok: false, code: 'limit', rotated: false });
    expect(calls).toHaveLength(2);
  });
  it('amplio sube max_tokens de la petición', async () => {
    setModels({}, 'amplio');
    const { f, calls } = fake(ok);
    await runTurn({ messages: [{ role: 'user', content: 'hola' }], fetch: f });
    expect(calls[0]!.max).toBe(BUDGET.groq.amplio.maxOut);
  });
});
