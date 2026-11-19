/**
 * Fase 3 · FSRS → Anki (puro). Aproximación (Anki v2 no tiene FSRS; no se pretende reproducir su planificador):
 * - Estado: New → sin entrada (write.ts la deja nueva) salvo suspendida/enterrada; Learning → type 1 queue 1;
 *   Review → type 2 queue 2; Relearning → type 3 queue 1. Suspendida queue −1, enterrada −2 (Anki la desentierra al cambiar de día).
 * - due: aprendizaje/reaprendizaje = `card.due` en s de epoch; repaso = floor((due_s − crt) / 86400) (puede ser < 0 si vencida).
 * - ivl (días) = max(1, round(scheduled_days || stability)); 0 en aprendizaje.
 * - factor (‰) = round(1300 + (10 − D) / 9 · 1700), D = dificultad FSRS 1–10 acotada → 3000 (fácil) … 1300 (difícil).
 * - revlog: solo entradas con rating no deshechas (`undo`), de tarjetas en `cardIdMap`, en orden (ts, índice).
 *   id = max(ts, id anterior + 1) ms; ease = rating; type según `state` previo (0/1→0, 2→1, 3→2; 2 con ts > 1 día antes
 *   de `due_before` → 3 anticipado; sin `state`: 0 la primera, 1 las demás). ivl = (due_before del siguiente repaso,
 *   o `card.due` si es el último) − ts: días si ≥ 1 día, si no −segundos. lastIvl = ivl de la fila anterior (0 la 1.ª).
 *   factor = factor actual de la tarjeta (0 en aprendizaje); time = ms acotado a 1..3 600 000.
 */
import { State } from 'ts-fsrs';
import type { CardState, LogEntry } from '../../srs/engine';
import type { MapResult } from './map';
import type { AnkiRevlog, AnkiSched } from './write';

const DAY = 86_400_000;

export const factorOf = (d: number) => Math.round(1300 + ((10 - Math.min(10, Math.max(1, d || 5))) / 9) * 1700);

/** `cid` de Engrama → id de tarjeta de Anki, con la misma regla que write.ts (`src`, `src:r`, `src:c<ord+1>`). */
export function cardIdMapOf(decks: MapResult[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of decks) for (const n of d.notes) for (const c of n.cards)
    out.set(n.model === 'cloze' ? `${n.src}:c${c.ord + 1}` : n.model === 'reversed' && c.ord === 1 ? `${n.src}:r` : n.src, c.id);
  return out;
}

const ivlMs = (ms: number) => (ms >= DAY ? Math.round(ms / DAY) : -Math.max(1, Math.round(ms / 1000)));

export function buildSched(col: { states: Map<string, CardState>; log: LogEntry[] }, cardIdMap: Map<string, number>, crt: number): { sched: Map<number, AnkiSched>; revlog: AnkiRevlog[] } {
  const sched = new Map<number, AnkiSched>();
  const factors = new Map<string, number>();
  for (const [cid, st] of [...col.states].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const id = cardIdMap.get(cid);
    if (id === undefined) continue;
    const c = st.card;
    const hold = st.suspended ? -1 : st.buried ? -2 : null;
    const factor = factorOf(c.difficulty);
    factors.set(cid, c.state === State.Learning || c.state === State.New ? 0 : factor);
    if (c.state === State.New) {
      if (hold !== null) sched.set(id, { type: 0, queue: hold, due: 0, ivl: 0, factor: 0, reps: c.reps, lapses: c.lapses });
      continue;
    }
    const review = c.state === State.Review;
    const dueS = Math.floor(c.due.getTime() / 1000);
    sched.set(id, {
      type: review ? 2 : c.state === State.Learning ? 1 : 3,
      queue: hold ?? (review ? 2 : 1),
      due: review ? Math.floor((dueS - crt) / 86_400) : dueS,
      ivl: c.state === State.Learning ? 0 : Math.max(1, Math.round(c.scheduled_days || c.stability)),
      factor, reps: c.reps, lapses: c.lapses,
    });
  }

  const undone = new Set(col.log.filter((e) => e.op === 'undo').map((e) => `${e.id}@${e.ref}`));
  const real = col.log
    .map((e, i) => [e, i] as const)
    .filter(([e]) => e.rating && !e.op && cardIdMap.has(e.id) && !undone.has(`${e.id}@${e.ts}`))
    .sort((a, b) => a[0].ts - b[0].ts || a[1] - b[1])
    .map(([e]) => e);
  const next = new Map<LogEntry, LogEntry>();
  const lastOf = new Map<string, LogEntry>();
  for (const e of real) {
    const p = lastOf.get(e.id);
    if (p) next.set(p, e);
    lastOf.set(e.id, e);
  }
  const revlog: AnkiRevlog[] = [];
  const prevIvl = new Map<string, number>();
  let lastId = -Infinity;
  for (const e of real) {
    const n = next.get(e);
    const until = n?.due_before ?? (n ? undefined : col.states.get(e.id)?.card.due.getTime());
    const ivl = until === undefined ? 0 : ivlMs(until - e.ts);
    const s = e.state;
    const type = s === undefined ? (prevIvl.has(e.id) ? 1 : 0)
      : s === 2 ? (e.due_before !== undefined && e.ts < e.due_before - DAY ? 3 : 1) : s === 3 ? 2 : 0;
    lastId = Math.max(e.ts, lastId + 1);
    revlog.push({
      id: lastId, cid: cardIdMap.get(e.id)!, ease: e.rating!, ivl, lastIvl: prevIvl.get(e.id) ?? 0,
      factor: type === 0 ? 0 : (factors.get(e.id) ?? 0), time: Math.min(3_600_000, Math.max(1, Math.round(e.ms ?? 0))), type,
    });
    prevIvl.set(e.id, ivl);
  }
  return { sched, revlog };
}
