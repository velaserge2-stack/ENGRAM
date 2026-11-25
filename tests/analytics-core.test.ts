import { describe, expect, it } from 'vitest';
import { loadCollection, appendLog } from '../src/data/collection';
import { confusions, failedTopics, forecastRetention, masteryTree, relapses, smartNewGoals, weaknesses } from '../src/lib/analytics';
import { parseExam } from '../src/lib/exams';
import { applyReview, DEFAULT_PARAMS, scheduler, type Rating } from '../src/srs/engine';
import { buildAdaptiveQueue } from '../src/srs/adaptive';
import { stateOf } from '../src/srs/queue';
import { MemoryBackend } from '../src/vault/memory';
import { SafeVault } from '../src/vault/safe';

const P = { ...DEFAULT_PARAMS, fuzz: false };
const LIM = { newPerDay: 5, reviewLimit: 200, recoveryThreshold: 500, leechThreshold: 8, tz: 'UTC', dayStartHour: 0 };
const T0 = Date.parse('2026-03-01T10:00:00Z');
const MIN = 60_000, DAY = 86_400_000;

/** Bóveda con mazos `Med/Cardio` (a,b), `Med/Neuro` (c) y `Otro` (d); `script` = [cid, calificación, ts]. */
async function build(script: [string, Rating, number][], extra = '') {
  const v = new SafeVault(new MemoryBackend());
  const deck = (name: string, ids: string[], fm = '') => `---\ndeck: ${name}\n${fm}---\n${ids.map((i) => `Q:: P${i}\nA:: R${i} ^${i}`).join('\n\n')}\n`;
  await v.write('decks/cardio.md', deck('Med/Cardio', ['ca', 'cb', 'n1', 'n2']));
  await v.write('decks/neuro.md', deck('Med/Neuro', ['cc']));
  await v.write('decks/otro.md', deck('Otro', ['cd'], extra));
  const col = await loadCollection(v, P, T0);
  const f = scheduler(P);
  const sorted = [...script].sort((x, y) => x[2] - y[2]);
  for (const [cid, r, ts] of sorted) {
    const st = stateOf(col, cid);
    col.states.set(cid, st);
    await appendLog(v, col, [applyReview(f, st, cid, r, ts, 3000)], P);
  }
  return col;
}
// a: aprende y falla dos veces en Repaso; c: falla en sesión corta junto a a (tres episodios)
const FAILS: [string, Rating, number][] = [];
for (let k = 0; k < 3; k++) {
  const t = T0 + k * 2 * DAY;
  FAILS.push(['ca', 3, t], ['cc', 3, t + MIN]);
}
const SCRIPT: [string, Rating, number][] = [['ca', 3, T0 - 40 * DAY], ['ca', 3, T0 - 30 * DAY], ['ca', 1, T0 - 20 * DAY], ['ca', 3, T0 - 19 * DAY], ['ca', 1, T0 - 10 * DAY], ['ca', 1, T0 - 9 * DAY], ['ca', 3, T0 - 8 * DAY], ['cb', 3, T0 - 5 * DAY], ['cb', 3, T0 - 5 * DAY + 15 * MIN]];

describe('analytics', () => {
  it('vacío: no revienta y devuelve estructuras vacías', async () => {
    const col = await build([]);
    expect(weaknesses(col, T0)).toEqual({ cards: [], topics: [], tags: [] });
    expect(relapses(col)).toEqual([]);
    expect(confusions(col)).toEqual([]);
    expect(forecastRetention(col, T0, [7], P).overall.r[7]).toBeNull();
    const t = masteryTree(col, T0, P);
    expect(t.map((n) => n.name)).toEqual(['Med', 'Otro']);
    expect(t[0]!.mastery).toBe(0);
    expect(t[0]!.cards).toBe(5);
  });

  it('debilidades: ≥2 Again en los últimos 5 y rollup por ruta', async () => {
    const col = await build(SCRIPT);
    const w = weaknesses(col, T0);
    expect(w.cards.map((c) => c.cid)).toEqual(['ca']);
    expect(w.topics.map((g) => g.key)).toEqual(['Med', 'Med/Cardio']);
    // fuera de los 60 días → ya no es débil
    expect(weaknesses(col, T0 + 200 * DAY).cards).toEqual([]);
  });

  it('olvidos: solo Again estando en Repaso, ≥2, y los deshechos no cuentan', async () => {
    const col = await build(SCRIPT);
    // a: Again en Repaso el día -20 (state 2) y el -10; el del día -9 llega en Reaprendiendo (3)
    const r = relapses(col);
    expect(r.map((x) => [x.cid, x.count])).toEqual([['ca', 2]]);
    const last = col.log.filter((e) => e.id === 'ca' && e.rating === 1).at(-1)!;
    col.log.push({ id: 'ca', ts: T0, op: 'undo', ref: last.ts });
    col.log.push({ id: 'ca', ts: T0 + 1, op: 'undo', ref: col.log.filter((e) => e.id === 'ca' && e.rating === 1 && e.state === 2)[0]!.ts });
    expect(relapses(col)).toEqual([]);
  });

  it('árbol de dominio: agrega por ruta y es determinista', async () => {
    const col = await build(SCRIPT);
    const t = masteryTree(col, T0, P);
    const med = t[0]!;
    expect(med.children.map((c) => c.name)).toEqual(['Cardio', 'Neuro']);
    expect(med.seen).toBe(2);
    expect(med.mastery).toBeGreaterThan(0);
    expect(med.mastery).toBeLessThanOrEqual(1);
    expect(med.mastery).toBeCloseTo((med.children[0]!.mastery * 4 + med.children[1]!.mastery * 1) / 5, 10);
    expect(JSON.stringify(masteryTree(col, T0, P))).toBe(JSON.stringify(t));
  });

  it('predicción: la retención baja con el horizonte', async () => {
    const col = await build(SCRIPT);
    const f = forecastRetention(col, T0, [7, 30, 90], P);
    const r = f.overall.r;
    expect(r[7]!).toBeGreaterThan(r[30]!);
    expect(r[30]!).toBeGreaterThan(r[90]!);
    expect(f.decks.map((d) => d.key)).toEqual(['Med/Cardio']);
  });

  it('confusiones: lapsos de mazos distintos en ≤10 min, ≥2 episodios', async () => {
    const script: [string, Rating, number][] = [];
    for (let k = 0; k < 3; k++) script.push(['ca', 1, T0 + k * DAY], ['cc', 1, T0 + k * DAY + 2 * MIN]);
    script.push(['cb', 1, T0 + 5 * DAY], ['cd', 1, T0 + 5 * DAY + 30 * MIN]); // fuera de la ventana
    const col = await build(script);
    const c = confusions(col);
    expect(c).toEqual([{ kind: 'cards', a: 'ca', b: 'cc', count: 3, score: 3 }]);
    expect(FAILS.length).toBe(6);
  });

  it('confusiones por distractor en simulacros', () => {
    const q = { id: 'q1', options: [{ key: 'A', text: '' }, { key: 'B', text: '' }], answer: ['A'], topic: 'Med' };
    const mk = (given: string[], done = true) => ({ finishedAt: done ? 1 : undefined, qs: [{ q }], answers: { q1: given } });
    const col = { log: [], byCid: new Map(), states: new Map(), decks: [] } as never;
    expect(confusions(col, [mk(['B']), mk(['B']), mk(['A']), mk(['B'], false)])).toEqual([{ kind: 'distractor', a: 'q1', b: 'B', count: 2, score: 2 }]);
    expect(failedTopics([mk(['B']), mk(['A'])])).toEqual(['Med']);
  });

  it('objetivos: respetan el tope, priorizan examen y explican', async () => {
    const col = await build(SCRIPT, 'newPerDay: 1\n');
    const ex = parseExam('exams/x.md', '---\nexamen: Parcial\nfecha: 2026-03-11\ntemas: [Med/Neuro]\ncreado: 2026-03-01\ndias_repaso_final: 1\n---\n');
    const g = smartNewGoals(col, [ex], T0, { newPerDay: 5, reviewLimit: 200, tz: 'UTC', dayStartHour: 0 });
    for (const x of g) expect(x.goal).toBeLessThanOrEqual(Math.min(x.cap, x.newLeft));
    const neuro = g.find((x) => x.deck === 'Med/Neuro')!;
    expect(neuro.why[0]).toMatchObject({ kind: 'exam', exam: 'Parcial' });
    expect(neuro.goal).toBe(1);
    expect(g.find((x) => x.deck === 'Otro')!.goal).toBe(1); // tope del mazo = 1
    expect(g.find((x) => x.deck === 'Med/Cardio')!.goal).toBe(2); // base: 2 (de 3 nuevas)
    expect(smartNewGoals(col, [], T0, { newPerDay: 5, reviewLimit: 200, tz: 'UTC', dayStartHour: 0 })).toHaveLength(3);
  });

  it('cola adaptativa: vencidas + débiles, tope, estable y sin tocar el estado', async () => {
    const col = await build(SCRIPT);
    const snap = JSON.stringify([...col.states]);
    const now = T0 + 20 * DAY;
    const q1 = buildAdaptiveQueue(col, [], now, LIM, P, 30);
    const q2 = buildAdaptiveQueue(col, [], now, LIM, P, 30);
    expect(q1).toEqual(q2);
    expect(q1.review).toContain('ca');
    const small = buildAdaptiveQueue(col, [], now, LIM, P, 1);
    expect(small.review.length + small.learning.length).toBeLessThanOrEqual(1);
    // a (débil+olvidos) antes que b a igualdad de vencimiento
    expect(q1.review[0]).toBe('ca');
    // tema flojo fallado en simulacro: trae sus tarjetas aunque no estén vencidas
    expect(buildAdaptiveQueue(col, ['Med/Cardio'], T0, LIM, P, 30).review).toContain('cb');
    expect(buildAdaptiveQueue(await build([]), [], T0, LIM, P).review).toEqual([]);
    expect(JSON.stringify([...col.states])).toBe(snap);
  });
});
