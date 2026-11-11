import { describe, expect, it } from 'vitest';
import { fsrs, createEmptyCard, Rating as R } from 'ts-fsrs';
import { applyReview, DEFAULT_PARAMS, explain, formatInterval, intervalFor, newState, parseLog, previews, replay, scheduler, serializeEntry, type LogEntry, type Rating } from '../src/srs/engine';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5, 15);

function simulate(seq: [number, Rating][]): { log: LogEntry[]; live: ReturnType<typeof newState> } {
  const f = scheduler(DEFAULT_PARAMS);
  const live = newState(T0);
  const log: LogEntry[] = [];
  for (const [t, r] of seq) log.push(applyReview(f, live, 'x', r, T0 + t, 5000));
  return { log, live };
}

describe('FSRS determinista', () => {
  const seq: [number, Rating][] = [[0, 3], [10 * 60_000, 3], [2 * DAY, 3], [9 * DAY, 1], [9 * DAY + 600_000, 3], [12 * DAY, 4], [40 * DAY, 2]];

  it('reproducir reviews.jsonl da exactamente el mismo estado', () => {
    const { log, live } = simulate(seq);
    const text = log.map(serializeEntry).join('\n');
    const rebuilt = replay(parseLog(text).entries, DEFAULT_PARAMS).get('x')!;
    expect(JSON.stringify(rebuilt.card)).toBe(JSON.stringify(live.card));
  });

  it('coincide con ts-fsrs usado directamente (referencia)', () => {
    const f = fsrs({ request_retention: 0.9, maximum_interval: 36500, enable_fuzz: true, enable_short_term: true, learning_steps: ['1m', '10m'], relearning_steps: ['10m'] });
    let c = createEmptyCard(new Date(T0));
    for (const [t, r] of seq) c = f.next(c, new Date(T0 + t), r as unknown as R.Good).card;
    expect(JSON.stringify(simulate(seq).live.card)).toBe(JSON.stringify(c));
  });

  it('el orden del archivo no importa (se ordena por ts) y "undo" deshace', () => {
    const { log } = simulate(seq);
    const shuffled = [...log].reverse();
    expect(JSON.stringify(replay(shuffled, DEFAULT_PARAMS).get('x')!.card)).toBe(JSON.stringify(replay(log, DEFAULT_PARAMS).get('x')!.card));
    const withUndo = [...log, { id: 'x', ts: T0 + 41 * DAY, op: 'undo', ref: log[log.length - 1]!.ts } as LogEntry];
    const short = simulate(seq.slice(0, -1)).live.card;
    expect(JSON.stringify(replay(withUndo, DEFAULT_PARAMS).get('x')!.card)).toBe(JSON.stringify(short));
  });

  it('Otra vez = lapso; suspender, enterrar y olvidar', () => {
    const { log } = simulate(seq);
    const st = replay([...log, { id: 'x', ts: T0 + 50 * DAY, op: 'suspend' }], DEFAULT_PARAMS).get('x')!;
    expect(st.card.lapses).toBe(1);
    expect(st.suspended).toBe(true);
    expect(st.history.map((h) => h.rating)).toEqual([3, 3, 3, 1, 3, 4, 2]);
    const forgot = replay([...log, { id: 'x', ts: T0 + 50 * DAY, op: 'forget' }], DEFAULT_PARAMS).get('x')!;
    expect(forgot.card.state).toBe(0);
  });

  it('los botones muestran intervalos crecientes', () => {
    const f = scheduler(DEFAULT_PARAMS);
    const { live } = simulate(seq.slice(0, 3));
    const p = previews(f, live.card, T0 + 5 * DAY);
    expect(p[1].due < p[2].due && p[2].due < p[3].due && p[3].due <= p[4].due).toBe(true);
    expect(formatInterval(0, 10 * 60_000)).toBe('10 min');
    expect(formatInterval(0, 3 * DAY)).toBe('3 d');
    const ex = explain(live, T0 + 3 * DAY, 0.9, f);
    expect(ex.phrase).toContain('estabilidad');
  });

  it('intervalo a 90 % ≈ estabilidad', () => {
    expect(intervalFor(10, 0.9)).toBeCloseTo(10, 0);
    expect(intervalFor(10, 0.95)).toBeLessThan(intervalFor(10, 0.85));
  });

  it('ignora líneas dañadas', () => {
    expect(parseLog('{"id":"a","ts":1,"rating":3}\nbasura\n{"id":"b","ts":2,"rating":9}').entries.length).toBe(1);
  });
});
