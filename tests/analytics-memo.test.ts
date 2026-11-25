import { describe, expect, it } from 'vitest';
import { cached, confusions, forecastRetention, masteryTree, relapses, smartNewGoals, weaknesses } from '../src/lib/analytics';
import { DEFAULT_PARAMS } from '../src/srs/engine';
import { synth } from './helpers/synth';

const P = { ...DEFAULT_PARAMS, fuzz: false };
const NOW = Date.parse('2026-11-25T12:00:00Z');
const GP = { newPerDay: 20, reviewLimit: 200, tz: 'UTC', dayStartHour: 0 };

describe('analítica memoizada = directa', () => {
  const col = synth('S', NOW);
  it('mismo resultado y determinista', () => {
    expect(cached.weaknesses(col, NOW)).toEqual(weaknesses(col, NOW));
    expect(cached.masteryTree(col, NOW, P)).toEqual(masteryTree(col, NOW, P));
    expect(cached.forecastRetention(col, NOW, [7, 30], P)).toEqual(forecastRetention(col, NOW, [7, 30], P));
    expect(cached.relapses(col)).toEqual(relapses(col));
    expect(cached.confusions(col, [])).toEqual(confusions(col, []));
    expect(cached.smartNewGoals(col, [], NOW, GP)).toEqual(smartNewGoals(col, [], NOW, GP));
    expect(weaknesses(col, NOW)).toEqual(weaknesses(col, NOW));
  });
  it('acierta con la misma firma y se invalida al cambiar ahora o el historial', () => {
    const a = cached.weaknesses(col, NOW);
    expect(cached.weaknesses(col, NOW)).toBe(a);
    expect(cached.weaknesses(col, NOW + 60_000)).not.toBe(a);
    const rel = cached.relapses(col);
    const cid = col.decks[0]!.cards[0]!.cid;
    for (let k = 0; k < 3; k++) col.log.push({ id: cid, ts: NOW + 1000 + k, rating: 1, ms: 1, state: 2 });
    const after = cached.relapses(col);
    expect(after).not.toBe(rel);
    expect(after).toEqual(relapses(col));
    expect(after.some((r) => r.cid === cid)).toBe(true);
  });
});
