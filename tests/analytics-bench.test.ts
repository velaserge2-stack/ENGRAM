/** Medición (no corre sin BENCH=1): `BENCH=1 npx vitest run tests/analytics-bench.test.ts`. */
import { describe, it } from 'vitest';
import { confusions, forecastRetention, masteryTree, relapses, smartNewGoals, weaknesses } from '../src/lib/analytics';
import { accuracy, activity, forecast, histogram, newLearned, trueRetention } from '../src/lib/stats';
import { atRisk } from '../src/srs/queue';
import { State, workloadEstimate } from '../src/srs/engine';
import { buildAdaptiveQueue } from '../src/srs/adaptive';
import { DEFAULT_PARAMS } from '../src/srs/engine';
import { SIZES, synth } from './helpers/synth';

const P = { ...DEFAULT_PARAMS, fuzz: false };
const NOW = Date.parse('2026-11-25T12:00:00Z');
const LIM = { newPerDay: 20, reviewLimit: 200, recoveryThreshold: 500, leechThreshold: 8, tz: 'UTC', dayStartHour: 0 };
const ms = (f: () => unknown) => { f(); const t = performance.now(); for (let i = 0; i < 3; i++) f(); return +((performance.now() - t) / 3).toFixed(1); };

describe.runIf(process.env.BENCH)('bench analítica', () => {
  for (const s of Object.keys(SIZES) as (keyof typeof SIZES)[])
    it(s, () => {
      const col = synth(s, NOW);
      const row = {
        size: s, log: col.log.length,
        weaknesses: ms(() => weaknesses(col, NOW)), masteryTree: ms(() => masteryTree(col, NOW, P)),
        forecast: ms(() => forecastRetention(col, NOW, [7, 30, 90], P)), relapses: ms(() => relapses(col)),
        confusions: ms(() => confusions(col, [])), goals: ms(() => smartNewGoals(col, [], NOW, { newPerDay: 20, reviewLimit: 200, tz: 'UTC', dayStartHour: 0 })),
        statsActivity: ms(() => activity(col.log, { pomodoro: [], exams: [] }, 'UTC', 0)), statsRet: ms(() => trueRetention(col.log, NOW) && accuracy(col.log, NOW)),
        statsNewFc: ms(() => newLearned(col, NOW) && forecast(col, NOW, 'UTC', 0)),
        statsHist: ms(() => { const live = [...col.states].filter(([k, st]) => col.byCid.has(k) && st.card.state !== State.New); histogram(live.map(([, st]) => st.card.stability), [0, 1, 3]); workloadEstimate(live.map(([, st]) => st), [0.85, 0.9, 0.95]); }),
        atRisk: ms(() => atRisk(col, NOW, P)),
        adaptive: ms(() => buildAdaptiveQueue(col, [], NOW, LIM, P)),
      };
      console.log('BENCH ' + JSON.stringify(row));
    }, 120_000);
});
