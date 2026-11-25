import { describe, expect, it } from 'vitest';
import { difficulty, dueFailed, MAX_WEIGHT, pickAdaptive, pickDynamic, pickExam, pickProgressive, type Pick, qStats, topicWeights } from '../src/sim/pick';
import { finalize, type Question } from '../src/sim/parse';

const mk = (i: number, topic: string): Question => finalize({ n: i, case: '', text: `Pregunta ${topic} ${i}`, options: [{ key: 'A', text: 'x' + i }, { key: 'B', text: 'y' + i }], answer: ['A'], explanation: 'e', topic });
const pool: Pick[] = ['Cardio', 'Neuro', 'Renal'].flatMap((t, k) => [0, 1, 2, 3, 4].map((i) => ({ bank: 'b', q: mk(k * 10 + i, t) })));
const att = (finishedAt: number, res: [Question, string][]) => ({ finishedAt, qs: res.map(([q]) => ({ q })), answers: Object.fromEntries(res.map(([q, k]) => [q.id, [k]])) });
const topics = (ps: Pick[]) => ps.map((p) => p.q.topic);

describe('pick', () => {
  it('dinámico: reparte por tema y es determinista', () => {
    const a = pickDynamic(pool, 6, 's1');
    expect(a).toHaveLength(6);
    for (const t of ['Cardio', 'Neuro', 'Renal']) expect(topics(a).filter((x) => x === t)).toHaveLength(2);
    expect(pickDynamic(pool, 6, 's1').map((p) => p.q.id)).toEqual(a.map((p) => p.q.id));
    expect(pickDynamic(pool, 6, 's2').map((p) => p.q.id)).not.toEqual(a.map((p) => p.q.id));
    expect(pickDynamic(pool, 99, 's')).toHaveLength(15);
  });
  it('dificultad: sin historial = 0.5; fallar sube, acertar baja', () => {
    const [p, q, r] = pool;
    const st = qStats([att(1, [[q!.q, 'B'], [r!.q, 'A']]), att(2, [[q!.q, 'B'], [r!.q, 'A']])]);
    expect(difficulty(p!.q, st)).toBe(0.5);
    expect(difficulty(q!.q, st)).toBeGreaterThan(0.5);
    expect(difficulty(r!.q, st)).toBeLessThan(0.5);
  });
  it('progresivo: de fácil a difícil', () => {
    const hist = pool.slice(0, 5).map((p, i) => att(i, [[p.q, i % 2 ? 'B' : 'A']]));
    const st = qStats([...hist, ...hist]);
    const out = pickProgressive(pool, 9, st, 'x');
    const d = out.map((p) => difficulty(p.q, st));
    expect(d).toEqual([...d].sort((a, b) => a - b));
  });
  it('adaptativo: pesa más el tema fallado, con tope, y es determinista', () => {
    const hist = pool.filter((p) => p.q.topic === 'Renal').map((p, i) => att(i, [[p.q, 'B']]));
    const st = qStats(hist);
    const w = topicWeights(pool, st);
    expect(w.get('Renal')).toBeLessThanOrEqual(MAX_WEIGHT);
    expect(w.get('Renal')).toBeGreaterThan(1);
    let renal = 0, base = 0;
    for (let i = 0; i < 200; i++) { renal += topics(pickAdaptive(pool, 5, st, 'r' + i)).filter((t) => t === 'Renal').length; base += topics(pickAdaptive(pool, 5, new Map(), 'r' + i)).filter((t) => t === 'Renal').length; }
    expect(renal).toBeGreaterThan(base * 1.3);
    expect(pickAdaptive(pool, 5, st, 'z').map((p) => p.q.id)).toEqual(pickAdaptive(pool, 5, st, 'z').map((p) => p.q.id));
    expect(pickExam('adaptive', pool, 5, hist, 'z').map((p) => p.q.id)).toEqual(pickAdaptive(pool, 5, st, 'z').map((p) => p.q.id));
  });
  it('falladas: espaciadas, más espera tras más fallos, acertar las saca', () => {
    const [a, b] = pool.map((p) => p.q);
    const D = 86_400_000;
    const h1 = [att(10 * D, [[a!, 'B'], [b!, 'B']])];
    expect(dueFailed(pool, h1, 10 * D + D / 2)).toHaveLength(0);
    expect(dueFailed(pool, h1, 11 * D).map((p) => p.q.id).sort()).toEqual([a!.id, b!.id].sort());
    const h2 = [...h1, att(11 * D, [[a!, 'B'], [b!, 'A']])];
    expect(dueFailed(pool, h2, 12 * D)).toHaveLength(0); // a: 2 fallos → 3 días
    expect(dueFailed(pool, h2, 14 * D).map((p) => p.q.id)).toEqual([a!.id]); // b acertó: fuera
  });
  it('casa por id antiguo (legacyQid)', async () => {
    const { legacyQid } = await import('../src/sim/parse');
    const q = pool[0]!.q;
    const old = { ...q, id: legacyQid(q) };
    const st = qStats([att(1, [[old, 'B']])]);
    expect(difficulty(q, st)).toBeGreaterThan(0.5);
  });
});
