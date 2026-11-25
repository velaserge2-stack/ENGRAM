import { describe, expect, it } from 'vitest';
import { compare, distractors } from '../src/sim/analysis';
import { finalize, type Question } from '../src/sim/parse';

const mk = (i: number, topic: string): Question => finalize({ n: i, case: '', text: `P${i}`, options: [{ key: 'A', text: 'a' + i }, { key: 'B', text: 'b' + i }, { key: 'C', text: 'c' + i }], answer: ['A'], explanation: '', topic });
const q1 = mk(1, 'T1'), q2 = mk(2, 'T2');
const at = (ans: Record<string, string>, extra = {}) => ({ qs: [{ q: q1 }, { q: q2 }], answers: Object.fromEntries(Object.entries(ans).map(([k, v]) => [k, [v]])), ...extra });

describe('distractores', () => {
  it('cuenta elecciones incorrectas y marca la atractiva', () => {
    const r = distractors([at({ [q1.id]: 'B' }), at({ [q1.id]: 'B' }), at({ [q1.id]: 'C' }), at({ [q1.id]: 'A' })], [q1, q2]);
    expect(r).toHaveLength(1); // q2 sin respuestas
    const o = Object.fromEntries(r[0]!.options.map((x) => [x.key, x]));
    expect([o.A!.count, o.B!.count, o.C!.count]).toEqual([0, 2, 1]);
    expect(o.B!.attractive).toBe(true);
    expect(o.C!.attractive).toBe(false);
    expect(o.A!.attractive).toBe(false);
    expect(r[0]!.total).toBe(4);
  });
  it('casa por id antiguo', async () => {
    const { legacyQid } = await import('../src/sim/parse');
    const old = { ...q1, id: legacyQid(q1) };
    const r = distractors([{ qs: [{ q: old }], answers: { [old.id]: ['C'] } }], [q1]);
    expect(r[0]!.options.find((x) => x.key === 'C')!.count).toBe(1);
  });
});

describe('comparar', () => {
  it('puntaje, tiempo, temas y vuelcos', () => {
    const a = at({ [q1.id]: 'B', [q2.id]: 'A' }, { elapsedMs: 600000 });
    const b = at({ [q1.id]: 'A', [q2.id]: 'C' }, { elapsedMs: 300000 });
    const c = compare(a, b);
    expect(c.pctA).toBe(0.5);
    expect(c.pctB).toBe(0.5);
    expect(c.minA).toBe(10);
    expect(c.fixed.map((q) => q.id)).toEqual([q1.id]);
    expect(c.broke.map((q) => q.id)).toEqual([q2.id]);
    expect(c.topics.find((t) => t.topic === 'T1')!.delta).toBe(1);
    expect(c.topics.find((t) => t.topic === 'T2')!.delta).toBe(-1);
  });
});
