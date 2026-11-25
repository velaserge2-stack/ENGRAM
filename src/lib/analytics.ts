/**
 * Analítica de estudio (puro, sin DOM): todo se deriva de `col.log` (reviews.jsonl) y `CardState`;
 * no se guarda ningún contador. Tema = ruta de mazo (`A/B/C`) o `tag:` (como `decksForTopic`).
 */
import { State } from 'ts-fsrs';
import type { Collection, Deck } from '../data/collection';
import { isCorrect } from '../sim/parse';
import { type LogEntry, scheduler, type SrsParams } from '../srs/engine';
import { dayKey } from './days';
import { type Exam, examCids, newPerDayMap, pace } from './exams';

const DAY = 86_400_000;
/** Ventana de «débil»: ≥ WEAK_AGAIN respuestas «Otra vez» entre sus últimos WEAK_N repasos (y de los últimos 60 días). */
export const WEAK_N = 5;
export const WEAK_AGAIN = 2;
const RECENT_MS = 60 * DAY;
const SESSION_MS = 10 * 60_000;
/** Estabilidad (días) a partir de la cual una tarjeta cuenta como madura al 100 %. */
const MATURE_S = 21;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const live = (col: Collection, cid: string) => {
  const st = col.states.get(cid);
  return st && col.byCid.has(cid) && !st.suspended && st.card.state !== State.New ? st : null;
};
/** Firma barata del historial: reviews.jsonl solo se añade (undo/suspender también son líneas), así que longitud + último ts basta. */
const logSig = (col: Collection) => `${col.log.length}:${col.log[col.log.length - 1]?.ts ?? 0}`;
const reviewCache = new WeakMap<Collection, { sig: string; v: LogEntry[] }>();
/** Repasos reales (sin los deshechos), en orden cronológico estable. Un solo recorrido por firma, compartido entre funciones. */
function reviewLog(col: Collection): LogEntry[] {
  const sig = logSig(col);
  const hit = reviewCache.get(col);
  if (hit?.sig === sig) return hit.v;
  const undone = new Set<string>();
  for (const e of col.log) if (e.op === 'undo') undone.add(`${e.id}@${e.ref}`);
  const v = col.log
    .map((e, i) => [e, i] as const)
    .filter(([e]) => e.rating && !undone.has(`${e.id}@${e.ts}`))
    .sort((a, b) => a[0].ts - b[0].ts || a[1] - b[1])
    .map(([e]) => e);
  reviewCache.set(col, { sig, v });
  return v;
}
/** Prefijos de la ruta: «A/B/C» → A, A/B, A/B/C. */
const prefixes = (full: string) => full.split('/').map((_, i, a) => a.slice(0, i + 1).join('/'));

/* 1 · Debilidades */
export interface WeakCard { cid: string; deck: string; againRecent: number; lapses: number }
export interface WeakGroup { key: string; cards: number; weak: number; againRecent: number; lapses: number; score: number }

export function weaknesses(col: Collection, now: number): { cards: WeakCard[]; topics: WeakGroup[]; tags: WeakGroup[] } {
  const cards: WeakCard[] = [];
  const topics = new Map<string, WeakGroup>();
  const tags = new Map<string, WeakGroup>();
  const grp = (m: Map<string, WeakGroup>, key: string) => {
    let g = m.get(key);
    if (!g) m.set(key, (g = { key, cards: 0, weak: 0, againRecent: 0, lapses: 0, score: 0 }));
    return g;
  };
  for (const d of col.decks) {
    const keys: [Map<string, WeakGroup>, string][] = [...prefixes(d.full).map((k) => [topics, k] as [Map<string, WeakGroup>, string]), ...d.tags.map((k) => [tags, k] as [Map<string, WeakGroup>, string])];
    for (const ref of d.cards) {
      const st = live(col, ref.cid);
      if (!st) continue;
      const again = st.history.slice(-WEAK_N).filter((h) => h.rating === 1 && h.ts >= now - RECENT_MS).length;
      const isWeak = again >= WEAK_AGAIN;
      for (const [m, k] of keys) {
        const g = grp(m, k);
        g.cards++;
        g.againRecent += again;
        g.lapses += st.card.lapses;
        if (isWeak) g.weak++;
      }
      if (isWeak) cards.push({ cid: ref.cid, deck: d.full, againRecent: again, lapses: st.card.lapses });
    }
  }
  const fin = (m: Map<string, WeakGroup>) =>
    [...m.values()].filter((g) => g.weak > 0).map((g) => ({ ...g, score: g.weak * 3 + g.againRecent + g.lapses / 2 })).sort((a, b) => b.score - a.score || cmp(a.key, b.key));
  cards.sort((a, b) => b.againRecent - a.againRecent || b.lapses - a.lapses || cmp(a.cid, b.cid));
  return { cards, topics: fin(topics), tags: fin(tags) };
}

/* 2 · Árbol de dominio */
export interface MasteryNode {
  name: string;
  path: string;
  cards: number;
  seen: number;
  due: number;
  mature: number;
  /** 0–1: media de (R + madurez)/2 sobre todas las tarjetas (las nuevas valen 0) */
  mastery: number;
  meanR: number;
  children: MasteryNode[];
}

export function masteryTree(col: Collection, now: number, params: SrsParams): MasteryNode[] {
  const f = scheduler(params);
  type Acc = MasteryNode & { m: number; r: number };
  const roots = new Map<string, Acc>();
  const node = (siblings: Map<string, Acc>, name: string, path: string) => {
    let n = siblings.get(name);
    if (!n) siblings.set(name, (n = { name, path, cards: 0, seen: 0, due: 0, mature: 0, mastery: 0, meanR: 0, children: [], m: 0, r: 0 }));
    return n;
  };
  const kids = new Map<Acc, Map<string, Acc>>();
  for (const d of col.decks) {
    const chain: Acc[] = [];
    let sib = roots;
    d.full.split('/').forEach((seg, i, a) => {
      const n = node(sib, seg, a.slice(0, i + 1).join('/'));
      chain.push(n);
      if (!kids.has(n)) kids.set(n, new Map());
      sib = kids.get(n)!;
    });
    for (const ref of d.cards) {
      const raw = col.states.get(ref.cid);
      if (raw?.suspended) continue;
      let m = 0, r = 0, seen = 0, due = 0, mature = 0;
      if (raw && raw.card.state !== State.New) {
        r = f.get_retrievability(raw.card, new Date(now), false);
        const mat = Math.min(1, raw.card.stability / MATURE_S);
        m = (r + mat) / 2;
        seen = 1;
        due = raw.card.due.getTime() <= now ? 1 : 0;
        mature = raw.card.stability >= MATURE_S ? 1 : 0;
      }
      for (const n of chain) (n.cards++, n.seen += seen, n.due += due, n.mature += mature, n.m += m, n.r += r);
    }
  }
  const fin = (m: Map<string, Acc>): MasteryNode[] =>
    [...m.values()].sort((a, b) => cmp(a.name, b.name)).map((n) => {
      const { m: ms, r, ...rest } = n;
      return { ...rest, mastery: n.cards ? ms / n.cards : 0, meanR: n.seen ? r / n.seen : 0, children: fin(kids.get(n) ?? new Map()) };
    });
  return fin(roots);
}

/* 3 · Predicción de retención */
export interface ForecastRow { key: string; n: number; r: Record<number, number | null> }

/** Retención media estimada a `horizons` días si no se repasa más (`get_retrievability` en fecha futura). */
export function forecastRetention(col: Collection, now: number, horizons: number[], params: SrsParams): { overall: ForecastRow; decks: ForecastRow[]; tags: ForecastRow[] } {
  const f = scheduler(params);
  type Acc = { n: number; sum: number[] };
  const mk = (): Acc => ({ n: 0, sum: horizons.map(() => 0) });
  const all = mk();
  const decks = new Map<string, Acc>();
  const tags = new Map<string, Acc>();
  const get = (m: Map<string, Acc>, k: string) => m.get(k) ?? (m.set(k, mk()), m.get(k)!);
  for (const d of col.decks)
    for (const ref of d.cards) {
      const st = live(col, ref.cid);
      if (!st) continue;
      const rs = horizons.map((h) => f.get_retrievability(st.card, new Date(now + h * DAY), false));
      for (const a of [all, get(decks, d.full), ...d.tags.map((k) => get(tags, k))]) (a.n++, rs.forEach((r, i) => (a.sum[i]! += r)));
    }
  const row = (key: string, a: Acc): ForecastRow => ({ key, n: a.n, r: Object.fromEntries(horizons.map((h, i) => [h, a.n ? a.sum[i]! / a.n : null])) });
  const rows = (m: Map<string, Acc>) => [...m].sort((a, b) => cmp(a[0], b[0])).map(([k, a]) => row(k, a));
  return { overall: row('', all), decks: rows(decks), tags: rows(tags) };
}

/* 4 · Olvidos (recaídas) */
export interface Relapse { cid: string; count: number; last: number }

/** Tarjetas ya aprendidas (estado Repaso) que se vuelven a fallar ≥ 2 veces. */
export function relapses(col: Collection): Relapse[] {
  const m = new Map<string, Relapse>();
  for (const e of reviewLog(col)) {
    if (e.state !== State.Review || e.rating !== 1 || !col.byCid.has(e.id)) continue;
    const r = m.get(e.id) ?? { cid: e.id, count: 0, last: 0 };
    r.count++;
    r.last = e.ts;
    m.set(e.id, r);
  }
  return [...m.values()].filter((r) => r.count >= 2).sort((a, b) => b.count - a.count || b.last - a.last || cmp(a.cid, b.cid));
}

/* 5 · Confusiones */
export interface Confusion {
  kind: 'cards' | 'distractor';
  /** tarjetas: cid A · distractor: id de la pregunta */
  a: string;
  /** tarjetas: cid B · distractor: clave de la opción elegida */
  b: string;
  count: number;
  score: number;
}
/** Lo mínimo de un intento de simulacro que se necesita (compatible con `Attempt`). */
export interface AttemptLike {
  finishedAt?: number;
  qs: { q: { id: string; options: { key: string; text: string }[]; answer: string[]; topic?: string } }[];
  answers: Record<string, string[]>;
}

export function confusions(col: Collection, attempts: AttemptLike[] = []): Confusion[] {
  const out: Confusion[] = [];
  // (a) lapsos de mazos distintos en una sesión corta, repetidos: un recuento por episodio
  const fails = reviewLog(col).filter((e) => e.rating === 1 && col.byCid.has(e.id));
  const deckOf = fails.map((e) => col.byCid.get(e.id)!.deck.path);
  type Pair = { count: number; lastTs: number; a: string; b: string };
  const pairs = new Map<string, Map<string, Pair>>(); // anidado: evita crear una cadena por par
  fails.forEach((e, i) => {
    for (let j = i + 1; j < fails.length && fails[j]!.ts - e.ts <= SESSION_MS; j++) {
      const o = fails[j]!;
      if (o.id === e.id || deckOf[j] === deckOf[i]) continue;
      const [a, b] = cmp(e.id, o.id) < 0 ? [e.id, o.id] : [o.id, e.id];
      let row = pairs.get(a);
      if (!row) pairs.set(a, (row = new Map()));
      let p = row.get(b);
      if (!p) row.set(b, (p = { count: 0, lastTs: -Infinity, a, b }));
      if (o.ts - p.lastTs > SESSION_MS) p.count++;
      p.lastTs = o.ts;
    }
  });
  for (const row of pairs.values()) for (const p of row.values()) if (p.count >= 2) out.push({ kind: 'cards', a: p.a, b: p.b, count: p.count, score: p.count });
  // (b) distractor elegido repetidamente en simulacros (cuenta intentos terminados)
  const dist = new Map<string, number>();
  for (const at of attempts) {
    if (!at.finishedAt) continue;
    for (const { q } of at.qs) {
      const given = at.answers[q.id];
      if (!given?.length || isCorrect(q as never, given)) continue;
      for (const k of given) if (!q.answer.includes(k)) dist.set(`${q.id}\u0000${k}`, (dist.get(`${q.id}\u0000${k}`) ?? 0) + 1);
    }
  }
  for (const [k, count] of dist) if (count >= 2) { const [a, b] = k.split('\u0000'); out.push({ kind: 'distractor', a: a!, b: b!, count, score: count }); }
  return out.sort((x, y) => y.score - x.score || cmp(x.kind, y.kind) || cmp(x.a, y.a) || cmp(x.b, y.b));
}

/** Temas de las preguntas falladas en los intentos terminados (entrada de la sesión adaptativa). */
export function failedTopics(attempts: AttemptLike[]): string[] {
  const s = new Set<string>();
  for (const at of attempts) if (at.finishedAt) for (const { q } of at.qs) if (q.topic && at.answers[q.id]?.length && !isCorrect(q as never, at.answers[q.id])) s.add(q.topic);
  return [...s].sort(cmp);
}

/* 6 · Objetivos inteligentes de nuevas/día */
export interface GoalParams { newPerDay: number; reviewLimit: number; tz: string; dayStartHour: number }
export type GoalWhy = { kind: 'exam'; exam: string; needed: number } | { kind: 'base' } | { kind: 'load' } | { kind: 'none' };
export interface Goal { deck: string; path: string; goal: number; cap: number; newLeft: number; why: GoalWhy[] }

/**
 * Reparte nuevas/día: los mazos de exámenes próximos reciben su parte del ritmo necesario (`pace`);
 * el resto, un mínimo. Si hay mucha carga pendiente se reduce todo. Nunca pasa del tope del mazo
 * (`newPerDay` del mazo o el del usuario) ni de las nuevas que quedan.
 */
export function smartNewGoals(col: Collection, exams: Exam[], now: number, p: GoalParams): Goal[] {
  const today = dayKey(now, p.tz, p.dayStartHour);
  const newLeftOf = (d: Deck) => d.cards.filter((c) => { const st = col.states.get(c.cid); return !st?.suspended && (!st || st.card.state === State.New); }).length;
  const dueOf = (d: Deck) => d.cards.filter((c) => { const st = live(col, c.cid); return st && st.card.due.getTime() <= now; }).length;
  const need = new Map<string, { exam: string; needed: number }[]>();
  for (const e of exams) {
    if (!e.date || e.date < today) continue;
    const cids = examCids(col, e);
    const decks = col.decks.filter((d) => d.cards.some((c) => cids.has(c.cid)));
    const left = decks.reduce((n, d) => n + d.cards.filter((c) => cids.has(c.cid) && newLeftOf({ ...d, cards: [c] }) > 0).length, 0);
    if (!left) continue;
    const { map, first } = newPerDayMap(col, cids, p.tz, p.dayStartHour);
    const pc = pace({ today, examDate: e.date, created: e.created, finalDays: e.finalDays, newLeft: left, newPerDay: map, firstActivity: first, minPerDay: e.minPerDay });
    for (const d of decks) {
      const mine = d.cards.filter((c) => cids.has(c.cid) && newLeftOf({ ...d, cards: [c] }) > 0).length;
      if (mine) need.set(d.path, [...(need.get(d.path) ?? []), { exam: e.name, needed: (pc.needed * mine) / left }]);
    }
  }
  const totalDue = col.decks.reduce((n, d) => n + dueOf(d), 0);
  const half = p.reviewLimit / 2;
  const load = totalDue > half ? Math.max(0.25, 1 - (totalDue - half) / Math.max(1, p.reviewLimit)) : 1;
  return col.decks.map((d) => {
    const newLeft = newLeftOf(d);
    const cap = d.newPerDay ?? p.newPerDay;
    const ex = need.get(d.path) ?? [];
    const raw = ex.length ? ex.reduce((n, x) => n + x.needed, 0) : Math.min(2, cap);
    const goal = newLeft ? Math.min(cap, newLeft, Math.max(raw > 0 ? 1 : 0, Math.ceil(raw * load))) : 0;
    const why: GoalWhy[] = !newLeft ? [{ kind: 'none' }] : [...ex.map((x) => ({ kind: 'exam' as const, exam: x.exam, needed: Math.ceil(x.needed) })), ...(ex.length ? [] : [{ kind: 'base' as const }]), ...(load < 1 ? [{ kind: 'load' as const }] : [])];
    return { deck: d.full, path: d.path, goal, cap, newLeft, why };
  }).sort((a, b) => b.goal - a.goal || cmp(a.path, b.path));
}

/* Memoización por firma: el mismo (col, historial, ahora, parámetros) no se recalcula con cada `app.tick`.
   Una sola entrada por función y colección (memoria acotada); el resultado es idéntico al directo. */
const memos = new WeakMap<Collection, Map<string, { key: string; v: unknown }>>();
function memo<T>(col: Collection, name: string, extra: string, f: () => T): T {
  const key = `${logSig(col)}|${col.states.size}|${col.decks.length}|${extra}`;
  let m = memos.get(col);
  if (!m) memos.set(col, (m = new Map()));
  const hit = m.get(name);
  if (hit?.key === key) return hit.v as T;
  const v = f();
  m.set(name, { key, v });
  return v;
}
const pk = (p: SrsParams) => JSON.stringify([p.retention, p.learningSteps, p.relearningSteps, p.maxInterval, p.w, p.fuzz]);
const attKey = (a: AttemptLike[]) => `${a.length}:${a.reduce((n, x) => n + (x.finishedAt ?? 0), 0)}`;
export const cached = {
  weaknesses: (col: Collection, now: number) => memo(col, 'weak', `${now}`, () => weaknesses(col, now)),
  masteryTree: (col: Collection, now: number, p: SrsParams) => memo(col, 'tree', `${now}|${pk(p)}`, () => masteryTree(col, now, p)),
  forecastRetention: (col: Collection, now: number, hz: number[], p: SrsParams) => memo(col, 'fc', `${now}|${hz}|${pk(p)}`, () => forecastRetention(col, now, hz, p)),
  relapses: (col: Collection) => memo(col, 'rel', '', () => relapses(col)),
  confusions: (col: Collection, at: AttemptLike[] = []) => memo(col, 'conf', attKey(at), () => confusions(col, at)),
  smartNewGoals: (col: Collection, exams: Exam[], now: number, p: GoalParams) => memo(col, 'goals', `${now}|${JSON.stringify(exams)}|${JSON.stringify(p)}`, () => smartNewGoals(col, exams, now, p)),
};
