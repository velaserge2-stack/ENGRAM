/**
 * Estadísticas (SPEC §9b B–E): todo se calcula desde reviews.jsonl, el estado
 * FSRS y los registros de pomodoro/simulacros. Nada se guarda duplicado.
 */
import type { Collection } from '../data/collection';
import { State, type LogEntry } from '../srs/engine';
import { dayEnd, deckCounts, newIntroducedToday, type StudyLimits } from '../srs/queue';
import { addDays, dayKey } from './days';

const DAY = 86_400_000;
export const MATURE = 21;

export interface DayAct {
  cards: number;
  ms: number;
  focusMs: number;
  examMs: number;
}

export interface Extra {
  pomodoro: { ts: number; minutes: number }[];
  exams: { ts: number; ms: number }[];
}

export function activity(log: LogEntry[], extra: Extra, tz: string, h: number): Map<string, DayAct> {
  const m = new Map<string, DayAct>();
  const get = (k: string) => m.get(k) ?? (m.set(k, { cards: 0, ms: 0, focusMs: 0, examMs: 0 }), m.get(k)!);
  for (const e of log) if (e.rating) {
    const a = get(dayKey(e.ts, tz, h));
    a.cards++;
    a.ms += Math.min(60_000, e.ms ?? 0);
  }
  for (const p of extra.pomodoro) get(dayKey(p.ts, tz, h)).focusMs += p.minutes * 60_000;
  for (const x of extra.exams) get(dayKey(x.ts, tz, h)).examMs += x.ms;
  return m;
}

/** Minutos de estudio del día: repasos + simulacros; el enfoque cuenta si fue mayor (no se suma dos veces). */
export function studyMs(a: DayAct | undefined): number {
  if (!a) return 0;
  return Math.max(a.ms + a.examMs, a.focusMs);
}

export function todayProgress(log: LogEntry[], today: string, tz: string, h: number) {
  const t = log.filter((e) => e.rating && dayKey(e.ts, tz, h) === today);
  const ms = t.reduce((n, e) => n + Math.min(60_000, e.ms ?? 0), 0);
  const ok = t.filter((e) => e.rating! > 1).length;
  return {
    studied: t.length,
    minutes: Math.round(ms / 60_000),
    secPerCard: t.length ? Math.round(ms / 1000 / t.length) : 0,
    perMin: ms ? Math.round((t.length / (ms / 60_000)) * 10) / 10 : 0,
    correct: t.length ? Math.round((ok / t.length) * 100) : 0,
  };
}

export function doneToday(col: Collection, today: string, tz: string, h: number) {
  const t = col.log.filter((e) => e.rating && dayKey(e.ts, tz, h) === today);
  const matured = new Set<string>();
  for (const e of t) if (e.state === State.Review && (e.ivl ?? 0) < MATURE && (col.states.get(e.id)?.card.scheduled_days ?? 0) >= MATURE) matured.add(e.id);
  return {
    newLearned: t.filter((e) => e.state === State.New).length,
    learningReps: t.filter((e) => e.state === State.Learning || e.state === State.Relearning).length,
    reviews: t.filter((e) => e.state === State.Review).length,
    matured: matured.size,
    again: t.filter((e) => e.rating === 1).length,
  };
}

export function pending(col: Collection, now: number, lim: StudyLimits, log: LogEntry[]) {
  const intro = newIntroducedToday(col, now, lim);
  let n = 0, l = 0, d = 0;
  for (const deck of col.decks) {
    const c = deckCounts(col, deck, now, lim, intro);
    n += c.new;
    l += c.learning;
    d += c.due;
  }
  const end = dayEnd(now, lim.tz, lim.dayStartHour);
  let tomorrow = 0;
  for (const [cid, st] of col.states) {
    if (!col.byCid.has(cid) || st.suspended || st.card.state === State.New) continue;
    const due = st.card.due.getTime();
    if (due >= end && due < end + DAY) tomorrow++;
  }
  const recent = log.filter((e) => e.rating && e.ts > now - 30 * DAY);
  const avgMs = recent.length ? recent.reduce((s, e) => s + Math.min(60_000, e.ms ?? 0), 0) / recent.length : 10_000;
  return { new: n, learning: l, due: d, total: n + l + d, tomorrow, estMin: Math.round(((n + l + d) * avgMs) / 60_000) };
}

/** Retención real: Bien/Fácil sobre repasos de tarjetas maduras (ivl ≥ 21 d), últimos 30 días. */
export function trueRetention(log: LogEntry[], now: number): { value: number | null; n: number } {
  const m = log.filter((e) => e.rating && e.state === State.Review && (e.ivl ?? 0) >= MATURE && e.ts > now - 30 * DAY);
  return { value: m.length ? m.filter((e) => e.rating! > 1).length / m.length : null, n: m.length };
}

export function accuracy(log: LogEntry[], now: number): { value: number | null; n: number } {
  const m = log.filter((e) => e.rating && e.ts > now - 30 * DAY);
  return { value: m.length ? m.filter((e) => e.rating! > 1).length / m.length : null, n: m.length };
}

function median(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i]! : (s[i - 1]! + s[i]!) / 2;
}

/** Eficiencia: s/tarjeta de hoy frente a tu mediana de 30 días (más rápido = barra llena). */
export function efficiency(act: Map<string, DayAct>, today: string): { value: number | null; secToday: number; median: number } {
  const per: number[] = [];
  for (let i = 1; i <= 30; i++) {
    const a = act.get(addDays(today, -i));
    if (a?.cards) per.push(a.ms / 1000 / a.cards);
  }
  const t = act.get(today);
  const secToday = t?.cards ? t.ms / 1000 / t.cards : 0;
  const med = median(per);
  if (!secToday || !med) return { value: null, secToday, median: med };
  return { value: Math.min(1, med / secToday), secToday, median: med };
}

/** % de las nuevas introducidas en 30 días que ya están en repaso. */
export function newLearned(col: Collection, now: number): { value: number | null; n: number } {
  const ids = new Set(col.log.filter((e) => e.rating && e.state === State.New && e.ts > now - 30 * DAY).map((e) => e.id));
  if (!ids.size) return { value: null, n: 0 };
  let ok = 0;
  for (const id of ids) if (col.states.get(id)?.card.state === State.Review) ok++;
  return { value: ok / ids.size, n: ids.size };
}

/** Pronóstico de repasos para los próximos `days` días (incluye vencidas hoy). */
export function forecast(col: Collection, now: number, tz: string, h: number, days = 30): { day: string; n: number }[] {
  const today = dayKey(now, tz, h);
  const out = Array.from({ length: days }, (_, i) => ({ day: addDays(today, i), n: 0 }));
  const idx = new Map(out.map((o, i) => [o.day, i]));
  for (const [cid, st] of col.states) {
    if (!col.byCid.has(cid) || st.suspended || st.card.state === State.New) continue;
    const k = dayKey(Math.max(now, st.card.due.getTime()), tz, h);
    const i = idx.get(k);
    if (i !== undefined) out[i]!.n++;
  }
  return out;
}

export function consistency(act: Map<string, DayAct>, today: string, days = 30): { day: string; n: number; avg7: number }[] {
  const arr = Array.from({ length: days }, (_, i) => {
    const day = addDays(today, i - days + 1);
    return { day, n: act.get(day)?.cards ?? 0, avg7: 0 };
  });
  arr.forEach((x, i) => {
    const w = arr.slice(Math.max(0, i - 6), i + 1);
    x.avg7 = Math.round((w.reduce((s, y) => s + y.n, 0) / w.length) * 10) / 10;
  });
  return arr;
}

export function histogram(values: number[], edges: number[]): number[] {
  const out = new Array(edges.length).fill(0) as number[];
  for (const v of values) {
    let i = edges.findIndex((e, j) => v >= e && (j === edges.length - 1 || v < edges[j + 1]!));
    if (i < 0) i = 0;
    out[i]!++;
  }
  return out;
}

/** Promedio de repasos diarios de los últimos 30 días (para alertas de sobrecarga). */
export function avgDaily(act: Map<string, DayAct>, today: string): number {
  let s = 0;
  for (let i = 1; i <= 30; i++) s += act.get(addDays(today, -i))?.cards ?? 0;
  return s / 30;
}
