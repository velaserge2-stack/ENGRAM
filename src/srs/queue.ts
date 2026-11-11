/**
 * Cola de estudio y conteos por mazo (SPEC §8): límites diarios de nuevas y
 * repasos, enterrar hermanas, suspendidas, modo recuperación tras ausencias.
 */
import { type Collection, type Deck } from '../data/collection';
import { dayKey } from '../lib/days';
import { type CardState, newState, retrievability, scheduler, type SrsParams, State } from './engine';
import { noteIdOf } from '../cards/parse';

export interface StudyLimits {
  newPerDay: number;
  reviewLimit: number;
  recoveryThreshold: number;
  leechThreshold: number;
  tz: string;
  dayStartHour: number;
}

export interface Counts {
  new: number;
  learning: number;
  due: number;
}

export function dayEnd(now: number, tz: string, dayStartHour: number): number {
  const today = dayKey(now, tz, dayStartHour);
  // buscar el primer instante (en pasos de 15 min) que pertenece a otro día de estudio
  let t = now;
  while (dayKey(t, tz, dayStartHour) === today) t += 15 * 60_000;
  // refinar al minuto
  let lo = t - 15 * 60_000;
  while (t - lo > 60_000) {
    const mid = Math.floor((lo + t) / 2);
    if (dayKey(mid, tz, dayStartHour) === today) lo = mid;
    else t = mid;
  }
  return t;
}

export function stateOf(col: Collection, cid: string): CardState {
  return col.states.get(cid) ?? newState();
}

export function inDeck(deck: Deck, filter: string | null): boolean {
  if (!filter) return true;
  // varios filtros separados por "|" (vínculos del calendario): basta con uno
  if (filter.includes('|')) return filter.split('|').some((f) => inDeck(deck, f));
  if (filter.startsWith('tag:')) return deck.tags.some((t) => t === filter.slice(4) || t.startsWith(filter.slice(4) + '/'));
  if (filter.endsWith('/')) return deck.path.startsWith(filter);
  return deck.path === filter;
}

/** Nuevas introducidas hoy por mazo. */
export function newIntroducedToday(col: Collection, now: number, lim: StudyLimits): Map<string, number> {
  const today = dayKey(now, lim.tz, lim.dayStartHour);
  const m = new Map<string, number>();
  for (const e of col.log) {
    if (e.rating && e.state === 0 && dayKey(e.ts, lim.tz, lim.dayStartHour) === today) {
      const d = col.byCid.get(e.id)?.deck.path;
      if (d) m.set(d, (m.get(d) ?? 0) + 1);
    }
  }
  return m;
}

export function reviewsToday(col: Collection, now: number, lim: StudyLimits): number {
  const today = dayKey(now, lim.tz, lim.dayStartHour);
  return col.log.filter((e) => e.rating && e.state === 2 && dayKey(e.ts, lim.tz, lim.dayStartHour) === today).length;
}

function available(st: CardState, today: string): boolean {
  return !st.suspended && !(st.buried && st.buried >= today);
}

export function deckCounts(col: Collection, deck: Deck, now: number, lim: StudyLimits, introduced = newIntroducedToday(col, now, lim)): Counts {
  const today = dayKey(now, lim.tz, lim.dayStartHour);
  const end = dayEnd(now, lim.tz, lim.dayStartHour);
  let n = 0;
  let l = 0;
  let d = 0;
  for (const ref of deck.cards) {
    const st = stateOf(col, ref.cid);
    if (!available(st, today)) continue;
    const s = st.card.state;
    if (s === State.New) n++;
    else if (s === State.Learning || s === State.Relearning) {
      if (st.card.due.getTime() < end) l++;
    } else if (st.card.due.getTime() < end) d++;
  }
  const cap = Math.max(0, (deck.newPerDay ?? lim.newPerDay) - (introduced.get(deck.path) ?? 0));
  return { new: Math.min(n, cap), learning: l, due: d };
}

export interface Queue {
  learning: string[];
  review: string[];
  fresh: string[];
  /** vencidas totales (antes del tope) */
  dueTotal: number;
  recovery: { active: boolean; daysToCatchUp: number; cap: number };
  /** próximo vencimiento de aprendizaje si no hay nada ahora */
  nextLearningAt: number | null;
}

export function buildQueue(col: Collection, filter: string | null, now: number, lim: StudyLimits, params: SrsParams, extraNew = 0): Queue {
  const f = scheduler(params);
  const today = dayKey(now, lim.tz, lim.dayStartHour);
  const end = dayEnd(now, lim.tz, lim.dayStartHour);
  const introduced = newIntroducedToday(col, now, lim);
  const learning: { cid: string; due: number }[] = [];
  const review: { cid: string; r: number; due: number }[] = [];
  const fresh: string[] = [];
  for (const d of col.decks) {
    if (!inDeck(d, filter)) continue;
    let cap = Math.max(0, (d.newPerDay ?? lim.newPerDay) - (introduced.get(d.path) ?? 0)) + extraNew;
    for (const ref of d.cards) {
      const st = stateOf(col, ref.cid);
      if (!available(st, today)) continue;
      const due = st.card.due.getTime();
      const s = st.card.state;
      if (s === State.New) {
        if (cap > 0) (fresh.push(ref.cid), cap--);
      } else if (s === State.Learning || s === State.Relearning) {
        if (due < end) learning.push({ cid: ref.cid, due });
      } else if (due < end) review.push({ cid: ref.cid, r: retrievability(f, st.card, now), due });
    }
  }
  learning.sort((a, b) => a.due - b.due);
  const dueTotal = review.length;
  const left = Math.max(0, lim.reviewLimit - reviewsToday(col, now, lim));
  const active = dueTotal > lim.recoveryThreshold;
  // Menor R primero: lo más olvidado se rescata antes
  review.sort((a, b) => a.r - b.r || a.due - b.due);
  const cap = Math.min(left, active ? lim.reviewLimit : Infinity);
  const nowLearning = learning.filter((x) => x.due <= now).map((x) => x.cid);
  const later = learning.filter((x) => x.due > now);
  return {
    learning: [...nowLearning, ...later.map((x) => x.cid)],
    review: review.slice(0, cap).map((x) => x.cid),
    fresh,
    dueTotal,
    recovery: { active, daysToCatchUp: active ? Math.ceil(dueTotal / Math.max(1, lim.reviewLimit)) : 0, cap: lim.reviewLimit },
    nextLearningAt: later[0]?.due ?? null,
  };
}

/**
 * Siguiente tarjeta: aprendizaje vencido → repaso/nueva intercaladas (1 nueva cada 4
 * repasos) → aprendizaje que vence pronto (≤ 20 min, como Anki "learn ahead").
 * Omite hermanas de notas ya vistas en la sesión.
 */
export function nextCard(col: Collection, q: Queue, seenNotes: Set<string>, done: Set<string>, now: number, reviewedCount: number): string | null {
  const ok = (cid: string) => !done.has(cid);
  const sib = (cid: string) => !seenNotes.has(noteIdOf(cid));
  const learnNow = q.learning.find((c) => ok(c) && stateOf(col, c).card.due.getTime() <= now);
  if (learnNow) return learnNow;
  const rev = q.review.find((c) => ok(c) && sib(c));
  const neu = q.fresh.find((c) => ok(c) && sib(c));
  if (neu && (!rev || reviewedCount % 5 === 4)) return neu;
  if (rev) return rev;
  const ahead = q.learning.find((c) => ok(c) && stateOf(col, c).card.due.getTime() <= now + 20 * 60_000);
  return ahead ?? q.learning.find(ok) ?? null;
}

export function isLeech(st: CardState, threshold: number): boolean {
  return st.card.lapses >= threshold;
}

/** Tarjetas en riesgo: R baja hoy o fallos recientes. */
export function atRisk(col: Collection, now: number, params: SrsParams): { cid: string; r: number; reason: string }[] {
  const f = scheduler(params);
  const out: { cid: string; r: number; reason: string }[] = [];
  for (const [cid, st] of col.states) {
    if (!col.byCid.has(cid) || st.suspended || st.card.state === State.New) continue;
    const r = retrievability(f, st.card, now);
    const recentFails = st.history.slice(-5).filter((h) => h.rating === 1).length;
    if (r < params.retention - 0.1) out.push({ cid, r, reason: `R ${Math.round(r * 100)} %` });
    else if (recentFails >= 2) out.push({ cid, r, reason: `${recentFails} fallos recientes` });
  }
  return out.sort((a, b) => a.r - b.r);
}
