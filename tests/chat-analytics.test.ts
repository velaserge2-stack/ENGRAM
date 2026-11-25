import { describe, expect, it } from 'vitest';
import { appendLog, loadCollection } from '../src/data/collection';
import { applyProposal, forgetProposals, undoProposal, revalidate, type Proposal } from '../src/chat/proposal';
import { setActive } from '../src/chat/providers';
import { makeAnalyticsTools, type AnalyticsCtx } from '../src/chat/tools-analytics';
import { applyReview, DEFAULT_PARAMS, scheduler, type Rating } from '../src/srs/engine';
import { stateOf } from '../src/srs/queue';
import { MemoryBackend } from '../src/vault/memory';
import { SafeVault } from '../src/vault/safe';
import { walk } from '../src/vault/util';

const P = { ...DEFAULT_PARAMS, fuzz: false };
const GOAL = { newPerDay: 5, reviewLimit: 200, tz: 'UTC', dayStartHour: 0 };
const T0 = Date.parse('2026-03-01T10:00:00Z');
const MIN = 60_000, DAY = 86_400_000;
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const run = async (tools: any, name: string, input: object = {}) => tools[name].execute(input, { toolCallId: 't', messages: [] }); // eslint-disable-line @typescript-eslint/no-explicit-any
const deck = (name: string, ids: string[], fm = '') => `---\ndeck: ${name}\n${fm}---\n${ids.map((i) => `Q:: P${i}\nA:: R${i} ^${i}`).join('\n\n')}\n`;

async function build(withReviews = true) {
  const v = new SafeVault(new MemoryBackend());
  await v.write('decks/cardio.md', enc(deck('Med/Cardio', ['ca', 'cb', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6'])));
  await v.write('decks/neuro.md', enc(deck('Med/Neuro', ['cc'])));
  await v.write('decks/otro.md', enc(deck('Otro', ['cd', 'ce', 'cf'], 'new_per_day: 9\n')));
  const col = await loadCollection(v, P, T0);
  if (withReviews) {
    const f = scheduler(P);
    const script: [string, Rating, number][] = [['ca', 3, T0 - 40 * DAY], ['ca', 3, T0 - 30 * DAY], ['ca', 1, T0 - 20 * DAY], ['ca', 1, T0 - 10 * DAY], ['ca', 1, T0 - 9 * DAY], ['cc', 3, T0 - 5 * DAY]];
    for (let k = 0; k < 3; k++) script.push(['ca', 3, T0 + k * 2 * DAY - 60 * DAY + 30 * DAY], ['cc', 3, T0 + k * 2 * DAY - 60 * DAY + 30 * DAY + MIN]);
    for (const [cid, r, ts] of script.sort((x, y) => x[2] - y[2])) {
      const st = stateOf(col, cid); col.states.set(cid, st);
      await appendLog(v, col, [applyReview(f, st, cid, r, ts, 3000)], P);
    }
  }
  const got: Proposal[] = [];
  const ctx = { vault: v, col, today: '2026-03-01', sources: [], allowed: () => true, propose: (p: Proposal) => got.push(p), params: P, goal: GOAL, now: () => T0 } as AnalyticsCtx;
  return { v, col, got, ctx };
}
async function snap(v: SafeVault) {
  const o: Record<string, string> = {};
  for (const f of await walk(v, '')) if (!f.path.startsWith('.app/')) o[f.path] = dec(await v.read(f.path));
  return o;
}
const READ = ['debilidades', 'dominio', 'prediccion', 'olvidos', 'confusiones', 'objetivos_hoy', 'plan_de_repaso'];

describe('herramientas del Analista', () => {
  it('determinista: dos llamadas dan lo mismo y traen datos', async () => {
    const { ctx } = await build();
    for (const n of READ) {
      const a = JSON.stringify(await run(makeAnalyticsTools(ctx), n)), b = JSON.stringify(await run(makeAnalyticsTools(ctx), n));
      expect(a).toBe(b);
      expect(a).not.toContain('"vacio"');
    }
    const plan = (await run(makeAnalyticsTools(ctx), 'plan_de_repaso')) as { acciones: unknown[] };
    expect(plan.acciones.length).toBeGreaterThan(0);
    expect(plan.acciones.length).toBeLessThanOrEqual(8);
  });

  it('sin datos o sin colección: respuesta vacía, no revienta', async () => {
    const { ctx } = await build(false);
    for (const n of ['debilidades', 'olvidos', 'confusiones']) expect(JSON.stringify(await run(makeAnalyticsTools(ctx), n))).toMatch(/\[\]|vacio/);
    const nocol = { ...ctx, col: null } as AnalyticsCtx;
    for (const n of READ) expect(await run(makeAnalyticsTools(nocol), n)).toMatchObject({ vacio: true });
  });

  it('topes de tokens: cada llamada cabe en el tope de Groq', async () => {
    const { ctx } = await build();
    setActive('groq');
    try {
      for (const n of READ) expect(JSON.stringify(await run(makeAnalyticsTools(ctx), n)).length).toBeLessThanOrEqual(1200 + 300);
    } finally { setActive('gemini'); }
  });

  it('aplicar_objetivos: propone sin escribir; aceptar cambia new_per_day y deshacer restaura byte a byte', async () => {
    const { v, col, got, ctx } = await build();
    forgetProposals();
    const before = await snap(v);
    const tools = makeAnalyticsTools(ctx);
    expect(await run(tools, 'aplicar_objetivos')).toMatchObject({ estado: expect.stringContaining('PROPUESTA') });
    expect(await snap(v)).toEqual(before); // proponer no escribe
    expect(got).toHaveLength(1);
    const p = got[0]!;
    expect(p.tipo).toBe('objetivos');
    expect(p.cambios!.length).toBeGreaterThan(0);
    expect(revalidate(p, { contenido: 'x' })).toBe(p);
    expect(await run(tools, 'aplicar_objetivos')).toHaveProperty('error'); // una por turno
    await applyProposal(v, col, p, 1);
    const after = await snap(v);
    expect(after).not.toEqual(before);
    for (const c of p.cambios!) expect(after[c.path]).toMatch(new RegExp(`new_per_day: ${c.despues}\\b`));
    await undoProposal(v, 1);
    expect(await snap(v)).toEqual(before);
  });

  it('aplicar_objetivos: sin pedido del usuario no propone; si el archivo cambió, no escribe nada', async () => {
    const { v, col, got, ctx } = await build();
    forgetProposals();
    expect(await run(makeAnalyticsTools({ ...ctx, allowed: () => false }), 'aplicar_objetivos')).toHaveProperty('error');
    expect(got).toHaveLength(0);
    await run(makeAnalyticsTools(ctx), 'aplicar_objetivos');
    const p = got[0]!;
    await v.write('decks/otro.md', enc(deck('Otro', ['cd', 'ce', 'cf'], 'new_per_day: 2\n')));
    const mid = await snap(v);
    await expect(applyProposal(v, col, p, 2)).rejects.toThrow('changed');
    expect(await snap(v)).toEqual(mid);
  });
});
