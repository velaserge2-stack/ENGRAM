/**
 * Sesión adaptativa: reutiliza `buildQueue` (sin modificarlo) y le añade, con tope de tamaño, las tarjetas
 * débiles, las que se olvidan una y otra vez y las de temas flojos. Determinista: mismo log → misma cola.
 */
import type { Collection } from '../data/collection';
import { dayKey } from '../lib/days';
import { decksForTopic } from '../lib/exams';
import { cached } from '../lib/analytics';
import { retrievability, scheduler, State, type SrsParams } from './engine';
import { buildQueue, type Queue, type StudyLimits } from './queue';

/** Filtro de `Study` que arranca la sesión adaptativa. */
export const ADAPTIVE = '@adaptativa';

export function buildAdaptiveQueue(col: Collection, failedTopics: string[], now: number, lim: StudyLimits, params: SrsParams, size = 30): Queue {
  const base = buildQueue(col, null, now, lim, params);
  const f = scheduler(params);
  const today = dayKey(now, lim.tz, lim.dayStartHour);
  const w = cached.weaknesses(col, now);
  const weak = new Set(w.cards.map((c) => c.cid));
  const rel = new Set(cached.relapses(col).map((r) => r.cid));
  const flojo = new Set<string>();
  const topics = [...failedTopics, ...w.topics.slice(0, 3).map((g) => g.key)];
  for (const t of topics) for (const d of decksForTopic(col, t)) for (const c of d.cards) flojo.add(c.cid);
  const due = new Set(base.review);
  const score = new Map<string, number>();
  const cand = new Set([...base.review, ...weak, ...rel, ...flojo]);
  for (const cid of cand) {
    const st = col.states.get(cid);
    if (!st || !col.byCid.has(cid) || st.suspended || st.card.state === State.New) continue;
    if (st.buried && st.buried >= today) continue;
    if (st.card.state !== State.Review) continue; // el aprendizaje ya va en `learning`
    const r = retrievability(f, st.card, now);
    const dueNow = due.has(cid);
    const extra = (weak.has(cid) ? 0.5 : 0) + (rel.has(cid) ? 0.7 : 0) + (flojo.has(cid) ? 0.3 : 0);
    // las no vencidas solo entran por ser débiles/olvidadas/de un tema flojo; las vencidas, por su R
    if (!dueNow && !extra) continue;
    score.set(cid, (dueNow ? 1 - r : (1 - r) * 0.5) + extra);
  }
  const room = Math.max(0, size - base.learning.length);
  const review = [...score].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, room).map(([c]) => c);
  const fresh = base.fresh.slice(0, Math.max(0, Math.floor((size - base.learning.length - review.length) / 5)));
  return { ...base, review, fresh };
}
