/** Análisis de intentos (puro): distractores atractivos y comparación entre intentos. Casa por id y por `legacyQid`. */
import { byTopic, isCorrect, legacyQid, type Question, score } from './parse';

/** Lo mínimo de un `Attempt` que se necesita aquí. */
export interface AttemptLike {
  id?: string;
  qs: { q: Question }[];
  answers: Record<string, string[]>;
  penalty?: number;
  pass?: number;
  elapsedMs?: number;
  finishedAt?: number;
}

/** Los ids con los que pudo guardarse una pregunta. */
export const qids = (q: Question): string[] => [q.id, legacyQid(q)];
/** Valor de un mapa por id de pregunta: por su id y, si no, por el antiguo. */
export const byQ = <T>(m: Map<string, T>, q: Question): T | undefined => m.get(q.id) ?? m.get(legacyQid(q));

export interface DistractorRow {
  q: Question;
  /** veces que se respondió la pregunta */
  total: number;
  /** elecciones incorrectas en total */
  wrongPicks: number;
  options: { key: string; text: string; correct: boolean; count: number; attractive: boolean }[];
}

/** Por pregunta de `only`: qué opciones incorrectas se eligieron y cuántas veces. «Atractivo»: ≥ 2 veces y ≥ la mitad de las elecciones incorrectas. Solo filas con alguna elección incorrecta, de más a menos. */
export function distractors(attempts: AttemptLike[], only: Question[]): DistractorRow[] {
  const rows: DistractorRow[] = [];
  for (const q of only) {
    const mine = new Set(qids(q));
    const counts = new Map<string, number>();
    let total = 0, wrongPicks = 0;
    for (const a of attempts) for (const x of a.qs) {
      if (!mine.has(x.q.id) && !mine.has(legacyQid(x.q))) continue;
      const given = a.answers[x.q.id];
      if (!given?.length) continue;
      total++;
      for (const k of new Set(given)) if (!q.answer.includes(k)) (counts.set(k, (counts.get(k) ?? 0) + 1), wrongPicks++);
    }
    if (!wrongPicks) continue;
    rows.push({ q, total, wrongPicks, options: q.options.map((o) => {
      const count = counts.get(o.key) ?? 0;
      const correct = q.answer.includes(o.key);
      return { key: o.key, text: o.text, correct, count, attractive: !correct && count >= 2 && count / wrongPicks >= 0.5 };
    }) });
  }
  return rows.sort((a, b) => b.wrongPicks - a.wrongPicks);
}

export interface Comparison {
  pctA: number;
  pctB: number;
  /** B − A, en puntos de 0 a 1 */
  delta: number;
  minA: number;
  minB: number;
  topics: { topic: string; pctA: number; pctB: number; delta: number }[];
  /** preguntas comunes: mal en A y bien en B / bien en A y mal en B */
  fixed: Question[];
  broke: Question[];
}

/** Compara `a` (antes) con `b` (después). Los temas son los que están en ambos. */
export function compare(a: AttemptLike, b: AttemptLike): Comparison {
  const sa = score(a.qs.map((x) => x.q), a.answers, a.penalty, a.pass);
  const sb = score(b.qs.map((x) => x.q), b.answers, b.penalty, b.pass);
  const ta = new Map(byTopic(a.qs.map((x) => x.q), a.answers).map((t) => [t.topic, t.ok / t.n]));
  const topics = byTopic(b.qs.map((x) => x.q), b.answers).filter((t) => ta.has(t.topic)).map((t) => ({ topic: t.topic, pctA: ta.get(t.topic)!, pctB: t.ok / t.n, delta: t.ok / t.n - ta.get(t.topic)! }));
  const idsA = new Map<string, Question>();
  for (const x of a.qs) (idsA.set(x.q.id, x.q), idsA.set(legacyQid(x.q), x.q));
  const fixed: Question[] = [], broke: Question[] = [];
  for (const x of b.qs) {
    const qa = idsA.get(x.q.id) ?? idsA.get(legacyQid(x.q));
    if (!qa) continue;
    const before = isCorrect(qa, a.answers[qa.id]), after = isCorrect(x.q, b.answers[x.q.id]);
    if (!before && after) fixed.push(x.q);
    else if (before && !after) broke.push(x.q);
  }
  return { pctA: sa.pct, pctB: sb.pct, delta: sb.pct - sa.pct, minA: (a.elapsedMs ?? 0) / 60000, minB: (b.elapsedMs ?? 0) / 60000, topics, fixed, broke };
}
