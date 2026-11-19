import { describe, expect, it } from 'vitest';
import { applyReview, type CardState, DEFAULT_PARAMS, type LogEntry, newState, type Rating, replay, scheduler } from '../src/srs/engine';
import { buildSched, cardIdMapOf, factorOf } from '../src/io/apkgexport/sched';
import { crtOf, buildApkg } from '../src/io/apkgexport/write';
import { mapDeck } from '../src/io/apkgexport/map';
import { parseDeck } from '../src/cards/parse';
import { convertApkg, type SqlJs } from '../src/io/apkg';

const P = { ...DEFAULT_PARAMS, fuzz: false };
const T0 = 1_750_000_000_000;
const MIN = 60_000, DAY = 86_400_000;

/** Registro real: aplica los repasos con el motor y devuelve las entradas (con due_before, state, ivl). */
function logOf(plan: [string, Rating, number][]): LogEntry[] {
  const f = scheduler(P);
  const st = new Map<string, CardState>();
  const out: LogEntry[] = [];
  for (const [id, r, at] of plan) {
    if (!st.has(id)) st.set(id, newState(at));
    out.push(applyReview(f, st.get(id)!, id, r, at, 4000));
  }
  return out;
}
const ids = new Map([['nue', 11], ['apr', 12], ['rep', 13], ['lap', 14], ['sus', 15], ['ent', 16]]);
const crt = crtOf(T0 + 30 * DAY);

function fixture() {
  const log = [
    ...logOf([['apr', 1, T0]]),
    ...logOf([['rep', 3, T0], ['rep', 3, T0 + 10 * MIN], ['rep', 3, T0 + 2 * DAY]]),
    ...logOf([['lap', 3, T0], ['lap', 3, T0 + 10 * MIN], ['lap', 1, T0 + 3 * DAY]]),
    ...logOf([['sus', 4, T0]]),
    { id: 'sus', ts: T0 + 1, op: 'suspend' } as LogEntry,
    { id: 'ent', ts: T0, op: 'bury', ref: '2025-06-15' } as LogEntry,
  ];
  return { log, states: replay(log, P) };
}

describe('apkgexport/sched', () => {
  it('nueva, aprendizaje, repaso, lapsos, suspendida y enterrada', () => {
    const { sched } = buildSched(fixture(), ids, crt);
    expect(sched.has(11)).toBe(false);
    const apr = sched.get(12)!;
    expect(apr).toMatchObject({ type: 1, queue: 1, ivl: 0, reps: 1, lapses: 0 });
    expect(apr.due).toBeGreaterThan(T0 / 1000);
    const rep = sched.get(13)!;
    expect(rep).toMatchObject({ type: 2, queue: 2, reps: 3, lapses: 0 });
    expect(Number.isInteger(rep.due) && rep.due < 0).toBe(true); // vencida respecto a crt
    expect(rep.ivl).toBeGreaterThanOrEqual(1);
    expect(rep.factor).toBeGreaterThanOrEqual(1300);
    expect(rep.factor).toBeLessThanOrEqual(3000);
    expect(sched.get(14)).toMatchObject({ type: 3, queue: 1, lapses: 1, reps: 3 });
    expect(sched.get(15)!.queue).toBe(-1);
    expect(sched.get(16)).toMatchObject({ type: 0, queue: -2 });
    expect([factorOf(1), factorOf(10)]).toEqual([3000, 1300]);
  });

  it('revlog: solo repasos reales, ids únicos, ivl y tipos', () => {
    const f = fixture();
    const extra: LogEntry[] = [
      { id: 'apr', ts: T0, rating: 3, ms: 0 }, // colisión exacta de ts
      { id: 'rep', ts: T0 + 5, rating: 2, ms: 9e9 },
      { id: 'rep', ts: T0 + 6, op: 'undo', ref: T0 + 5 }, // deshecho: no cuenta
      { id: 'otra', ts: T0, rating: 3 }, // fuera del mapa
    ];
    const { revlog } = buildSched({ ...f, log: [...f.log, ...extra] }, ids, crt);
    expect(revlog).toHaveLength(9);
    const idsR = revlog.map((r) => r.id);
    expect(new Set(idsR).size).toBe(idsR.length);
    expect(idsR).toEqual([...idsR].sort((a, b) => a - b));
    expect(revlog.filter((r) => r.id <= T0 + 4).length).toBeGreaterThanOrEqual(5); // T0, T0+1, …
    const col = revlog.find((r) => r.cid === 12 && r.time === 1)!; // ms 0 → 1
    expect(col.id).toBeGreaterThan(T0);
    const rep = revlog.filter((r) => r.cid === 13);
    expect(rep.map((r) => r.type)).toEqual([0, 0, 1]);
    expect(rep[0]!.ivl).toBeLessThan(0); // aprendizaje: −segundos
    expect(rep[2]!.ivl).toBeGreaterThan(0);
    expect(rep[2]!.lastIvl).toBe(rep[1]!.ivl);
    expect(rep[2]!.factor).toBeGreaterThan(0);
    expect(revlog.filter((r) => r.cid === 14).map((r) => [r.type, r.ease])).toEqual([[0, 3], [0, 3], [1, 1]]);
    expect(revlog.every((r) => r.time >= 1 && r.time <= 3_600_000)).toBe(true);
  });

  it('determinista', () => {
    const a = buildSched(fixture(), ids, crt), b = buildSched(fixture(), ids, crt);
    expect(JSON.stringify([[...a.sched], a.revlog])).toBe(JSON.stringify([[...b.sched], b.revlog]));
  });

  it('integración: buildSched → buildApkg → convertApkg conserva el historial', async () => {
    const SQL = await ((await import('sql.js')).default as unknown as () => Promise<SqlJs>)();
    const decks = [mapDeck('Bio', parseDeck('Q:: uno\nA:: 1 ^ccc01\n\nQR:: dos\nA:: 2 ^ccc02\n'), { used: new Set() })];
    const map = cardIdMapOf(decks);
    expect([...map.keys()].sort()).toEqual(['ccc01', 'ccc02', 'ccc02:r']);
    const log = logOf([['ccc01', 3, T0], ['ccc01', 3, T0 + 10 * MIN], ['ccc02:r', 1, T0 + MIN]]);
    const now = T0 + DAY;
    const { sched, revlog } = buildSched({ log, states: replay(log, P) }, map, crtOf(now));
    const { bytes, stats } = await buildApkg({ SQL, decks, readMedia: () => undefined, sched, revlog, now });
    expect(stats.revlog).toBe(3);
    const back = convertApkg(bytes, SQL, true, 'x.apkg').log;
    expect(back.map((e) => [e.id.endsWith(':r'), e.rating, e.ts])).toEqual([[false, 3, T0], [true, 1, T0 + MIN], [false, 3, T0 + 10 * MIN]]); // el importador da ids nuevos
    expect(back[0]!.id).toBe(back[2]!.id);
  });
});
