/** Selección de preguntas (pura y determinista con semilla): por temario, progresiva, adaptativa y cola de falladas. */
import { byQ, type AttemptLike } from './analysis';
import { isCorrect, type Question } from './parse';

export interface Pick { bank: string; q: Question }
export type ExamKind = 'normal' | 'dynamic' | 'progressive' | 'adaptive' | 'real';
export const EXAM_KINDS: ExamKind[] = ['normal', 'dynamic', 'progressive', 'adaptive', 'real'];
const rng = (seed: string) => {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 2 ** 32;
};
/** Mezcla determinista (Fisher–Yates con semilla). */
export function shuffle<T>(a: T[], seed: string): T[] {
  const r = rng(seed), out = [...a];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
}
/** Sin tema = un tema más. */
const topicOf = (q: Question) => q.topic || '';

export interface QStat { n: number; bad: number }
/** Por id de pregunta (el guardado en el intento): veces respondida y veces fallada. */
export function qStats(attempts: AttemptLike[]): Map<string, QStat> {
  const m = new Map<string, QStat>();
  for (const a of attempts) for (const x of a.qs) {
    const g = a.answers[x.q.id];
    if (!g?.length) continue;
    const s = m.get(x.q.id) ?? { n: 0, bad: 0 };
    s.n++;
    if (!isCorrect(x.q, g)) s.bad++;
    m.set(x.q.id, s);
  }
  return m;
}

/** 0 (fácil) a 1 (difícil): tasa de fallo suavizada (Laplace); sin historial = 0.5. */
export function difficulty(q: Question, stats: Map<string, QStat>): number {
  const s = byQ(stats, q);
  return s ? (s.bad + 1) / (s.n + 2) : 0.5;
}

/** N preguntas repartidas por tema (un tema tras otro, mezclado con la semilla). */
export function pickDynamic(pool: Pick[], n: number, seed: string): Pick[] {
  const groups = new Map<string, Pick[]>();
  for (const p of shuffle(pool, seed)) (groups.get(topicOf(p.q)) ?? groups.set(topicOf(p.q), []).get(topicOf(p.q))!).push(p);
  const lists = shuffle([...groups.keys()].sort(), seed + 't').map((k) => groups.get(k)!);
  const out: Pick[] = [];
  for (let i = 0; out.length < n && lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length && out.length < n) out.push(l[i]!);
  return out;
}

/** Dificultad progresiva: reparte por tema y ordena de fácil a difícil (tandas); el orden es estable. */
export function pickProgressive(pool: Pick[], n: number, stats: Map<string, QStat>, seed: string): Pick[] {
  const d = new Map<Pick, number>();
  for (const p of pickDynamic(pool, n, seed)) d.set(p, difficulty(p.q, stats));
  return [...d.keys()].sort((a, b) => d.get(a)! - d.get(b)!);
}

/** Tope del peso de un tema fallado. */
export const MAX_WEIGHT = 3;
/** Peso por tema: 1 + 4·tasa de fallo, con tope `MAX_WEIGHT`. */
export function topicWeights(pool: Pick[], stats: Map<string, QStat>): Map<string, number> {
  const t = new Map<string, QStat>();
  for (const p of pool) {
    const s = byQ(stats, p.q);
    if (!s) continue;
    const x = t.get(topicOf(p.q)) ?? { n: 0, bad: 0 };
    x.n += s.n;
    x.bad += s.bad;
    t.set(topicOf(p.q), x);
  }
  return new Map([...t].map(([k, s]) => [k, Math.min(MAX_WEIGHT, 1 + 4 * (s.bad / s.n))]));
}
/** Adaptativo: muestreo sin reemplazo con más peso en los temas fallados (Efraimidis–Spirakis, determinista). */
export function pickAdaptive(pool: Pick[], n: number, stats: Map<string, QStat>, seed: string): Pick[] {
  const w = topicWeights(pool, stats), r = rng(seed);
  return pool.map((p) => ({ p, k: Math.pow(r(), 1 / (w.get(topicOf(p.q)) ?? 1)) })).sort((a, b) => b.k - a.k).slice(0, n).map((x) => x.p);
}

export function pickExam(kind: ExamKind, pool: Pick[], n: number, attempts: AttemptLike[], seed: string): Pick[] {
  const stats = qStats(attempts);
  if (kind === 'progressive') return pickProgressive(pool, n, stats, seed);
  if (kind === 'adaptive') return pickAdaptive(pool, n, stats, seed);
  return pickDynamic(pool, n, seed); // dinámico y examen real
}

/** Días de espera tras 1, 2, 3+ fallos seguidos antes de que vuelva a la cola. */
export const SPACING_DAYS = [1, 3, 7];
const DAY = 86_400_000;
/** Cola de falladas: preguntas de `pool` cuyo último resultado fue fallo y ya pasó su espacio desde ese intento. Más fallos seguidos = más espera; acertar la saca. */
export function dueFailed(pool: Pick[], attempts: AttemptLike[], now: number): Pick[] {
  const st = new Map<string, { streak: number; at: number }>();
  for (const a of [...attempts].filter((x) => x.finishedAt).sort((x, y) => x.finishedAt! - y.finishedAt!)) for (const x of a.qs) {
    const g = a.answers[x.q.id];
    if (!g?.length) continue;
    const s = st.get(x.q.id) ?? { streak: 0, at: 0 };
    st.set(x.q.id, { streak: isCorrect(x.q, g) ? 0 : s.streak + 1, at: a.finishedAt! });
  }
  return pool.filter((p) => {
    const s = byQ(st, p.q);
    return !!s && s.streak > 0 && now - s.at >= SPACING_DAYS[Math.min(s.streak, SPACING_DAYS.length) - 1]! * DAY;
  });
}
