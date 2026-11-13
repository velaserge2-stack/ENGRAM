import { t, tn } from '../i18n';
/**
 * Motor de repetición espaciada (SPEC §8) sobre ts-fsrs.
 * `reviews.jsonl` es la fuente de verdad: el estado de cada tarjeta se obtiene
 * REPRODUCIENDO el historial (`replay`). `state.json` es solo una caché.
 */
import { type Card, createEmptyCard, fsrs, type FSRS, type Grade, State, computeDecayFactor, default_w } from 'ts-fsrs';

export type Rating = 1 | 2 | 3 | 4;
export const RATING_LABEL: Record<Rating, string> = { get 1() { return t('design.otra_vez'); }, get 2() { return t('design.dificil'); }, get 3() { return t('design.bien'); }, get 4() { return t('design.facil'); } };

export interface LogEntry {
  id: string;
  ts: number;
  rating?: Rating;
  ms?: number;
  /** vencimiento previsto antes de este repaso (ms) */
  due_before?: number;
  /** estado FSRS antes del repaso (0 nueva, 1 aprendiendo, 2 repaso, 3 reaprendiendo) */
  state?: number;
  /** intervalo programado antes del repaso (días) */
  ivl?: number;
  op?: 'suspend' | 'unsuspend' | 'bury' | 'forget' | 'undo';
  /** para `undo`: ts del repaso que se deshace; para `bury`: día (AAAA-MM-DD) */
  ref?: number | string;
  /** origen del tiempo: 'study' (por defecto), 'exam', 'edit' */
  src?: string;
}

export interface SrsParams {
  retention: number;
  learningSteps: string[];
  relearningSteps: string[];
  maxInterval: number;
  w: number[] | null;
  fuzz: boolean;
}

export const DEFAULT_PARAMS: SrsParams = {
  retention: 0.9,
  learningSteps: ['1m', '10m'],
  relearningSteps: ['10m'],
  maxInterval: 36500,
  w: null,
  fuzz: true,
};

export function scheduler(p: SrsParams): FSRS {
  return fsrs({
    request_retention: p.retention,
    maximum_interval: p.maxInterval,
    enable_fuzz: p.fuzz,
    enable_short_term: true,
    learning_steps: p.learningSteps as `${number}m`[],
    relearning_steps: p.relearningSteps as `${number}m`[],
    ...(p.w ? { w: p.w } : {}),
  });
}

export interface CardState {
  card: Card;
  suspended: boolean;
  /** día de estudio hasta el que está enterrada (inclusive) */
  buried: string | null;
  /** últimas respuestas (más reciente al final) */
  history: { ts: number; rating: Rating; ms: number }[];
}

export function newState(now = 0): CardState {
  return { card: createEmptyCard(new Date(now)), suspended: false, buried: null, history: [] };
}

/** Aplica un repaso y devuelve la entrada de registro (no la escribe). */
export function applyReview(f: FSRS, st: CardState, id: string, rating: Rating, ts: number, ms: number): LogEntry {
  const before = st.card;
  const entry: LogEntry = {
    id, ts, rating, ms: Math.max(0, Math.round(ms)),
    due_before: before.due.getTime(), state: before.state, ivl: before.scheduled_days,
  };
  st.card = f.next(before, new Date(ts), rating as Grade).card;
  st.history.push({ ts, rating, ms: entry.ms! });
  if (st.history.length > 50) st.history.shift();
  return entry;
}

/** Reproduce el historial completo. Determinista: mismas entradas → mismo estado. */
export function replay(entries: LogEntry[], params: SrsParams): Map<string, CardState> {
  const f = scheduler(params);
  const undone = new Set(entries.filter((e) => e.op === 'undo').map((e) => `${e.id}@${e.ref}`));
  const sorted = entries.map((e, i) => [e, i] as const).sort((a, b) => a[0].ts - b[0].ts || a[1] - b[1]);
  const out = new Map<string, CardState>();
  for (const [e] of sorted) {
    if (e.op === 'undo') continue;
    let st = out.get(e.id);
    if (!st) {
      st = newState(e.ts);
      out.set(e.id, st);
    }
    if (e.rating) {
      if (undone.has(`${e.id}@${e.ts}`)) continue;
      applyReview(f, st, e.id, e.rating, e.ts, e.ms ?? 0);
    } else if (e.op === 'suspend') st.suspended = true;
    else if (e.op === 'unsuspend') st.suspended = false;
    else if (e.op === 'bury') st.buried = String(e.ref ?? '');
    else if (e.op === 'forget') {
      const keep = st.history;
      Object.assign(st, newState(e.ts), { history: keep });
    }
  }
  return out;
}

export function parseLog(text: string): { entries: LogEntry[]; bad: number } {
  const entries: LogEntry[] = [];
  let bad = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as LogEntry;
      if (typeof e.id === 'string' && typeof e.ts === 'number' && (e.rating === undefined || [1, 2, 3, 4].includes(e.rating))) entries.push(e);
      else bad++;
    } catch {
      bad++;
    }
  }
  return { entries, bad };
}

export function serializeEntry(e: LogEntry): string {
  return JSON.stringify(e);
}

/** Recuperabilidad actual (0–1). Nueva = 0. */
export function retrievability(f: FSRS, card: Card, now: number): number {
  if (card.state === State.New) return 0;
  return f.get_retrievability(card, new Date(now), false);
}

/** Intervalos previstos para los 4 botones. */
export function previews(f: FSRS, card: Card, now: number): Record<Rating, Card> {
  const p = f.repeat(card, new Date(now));
  return { 1: p[1].card, 2: p[2].card, 3: p[3].card, 4: p[4].card };
}

export function formatInterval(from: number, to: number): string {
  const min = Math.max(1, Math.round((to - from) / 60000));
  if (min < 60) return `${min} min`;
  const h = min / 60;
  if (h < 24) return `${Math.round(h)} h`;
  const d = h / 24;
  if (d < 31) return `${Math.round(d)} d`;
  if (d < 365) return `${(d / 30.4).toFixed(d < 304 ? 1 : 0).replace('.0', '')} m`;
  return `${(d / 365).toFixed(1).replace('.0', '')} a`;
}

/** Intervalo (días) para alcanzar una retención dada con estabilidad S. */
export function intervalFor(stability: number, retention: number, w: readonly number[] = default_w): number {
  const { decay, factor } = computeDecayFactor(w);
  return (stability / factor) * (Math.pow(retention, 1 / decay) - 1);
}

/** Estimación de carga: repasos/día en régimen estable para cada retención. */
export function workloadEstimate(states: Iterable<CardState>, retentions: number[], w: readonly number[] = default_w): Record<string, number> {
  const out: Record<string, number> = {};
  const S = [...states].filter((s) => s.card.state !== State.New && !s.suspended).map((s) => s.card.stability);
  for (const r of retentions) out[r] = S.reduce((n, s) => n + 1 / Math.max(1, intervalFor(s, r, w)), 0);
  return out;
}

export { State };

/** Explicación "¿Por qué esta fecha?" */
export function explain(st: CardState, now: number, retention: number, f: FSRS) {
  const c = st.card;
  const R = retrievability(f, c, now);
  const days = Math.max(0, Math.round((c.due.getTime() - now) / 86_400_000));
  let phrase: string;
  if (c.state === State.New) phrase = t('engine.es_una_tarjeta_nueva_aun_no');
  else if (c.state === State.Learning || c.state === State.Relearning)
    phrase = t('engine.esta_en_p_vuelve_en_pasos', { p: c.state === State.Learning ? 'aprendizaje' : 'reaprendizaje' });
  else
    phrase = t('engine.vuelve_en_days_p_porque_tu', { days: days, p: tn('plural.daysword', days), p2: c.stability.toFixed(1), p3: Math.round(retention * 100) });
  return { D: c.difficulty, S: c.stability, R, lapses: c.lapses, reps: c.reps, last: st.history.slice(-10), phrase, due: c.due.getTime(), state: c.state };
}
