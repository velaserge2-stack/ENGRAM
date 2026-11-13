/**
 * Editor visual de exámenes (Mejoras 2 · E15). Un borrador marca la(s) correcta(s) por opción
 * (no por letra): así se pueden añadir, quitar y reordenar opciones sin perder la respuesta.
 * Se guarda en el formato nativo (`serializeBank`), así que editar el .md a mano y usar el
 * editor son equivalentes.
 */
import { type Bank, finalize, type Question } from './parse';

export interface DraftQ { case: string; text: string; options: { text: string; correct: boolean }[]; explanation: string; topic: string }
export interface Draft { name: string; minutes: number; shuffle: boolean; qs: DraftQ[] }

export const MAX_OPTIONS = 6; // A–F, como el analizador
const KEYS = 'ABCDEF';

export const emptyQ = (prevCase = ''): DraftQ => ({ case: prevCase, text: '', options: [{ text: '', correct: false }, { text: '', correct: false }, { text: '', correct: false }, { text: '', correct: false }], explanation: '', topic: '' });

export function bankToDraft(b: Bank): Draft {
  return {
    name: b.name, minutes: b.minutes, shuffle: b.shuffle,
    qs: b.questions.map((q) => ({ case: q.case, text: q.text, explanation: q.explanation, topic: q.topic, options: q.options.map((o) => ({ text: o.text, correct: q.answer.includes(o.key) })) })),
  };
}

function draftQuestion(q: DraftQ, n: number): Question {
  const options = q.options.filter((o) => o.text.trim());
  return finalize({
    n, case: q.case.trim(), text: q.text.trim(), explanation: q.explanation.trim(), topic: q.topic.trim(),
    options: options.map((o, i) => ({ key: KEYS[i]!, text: o.text.trim() })),
    answer: options.map((o, i) => (o.correct ? KEYS[i]! : '')).filter(Boolean),
  });
}

export function draftToBank(d: Draft): Bank {
  return { name: d.name.trim(), minutes: Math.max(1, Math.round(d.minutes) || 60), shuffle: d.shuffle, questions: d.qs.map((q, i) => draftQuestion(q, i + 1)) };
}

/** Problemas por pregunta (mismas reglas que el analizador) más los del examen. */
export function validate(d: Draft): { exam: string[]; perQ: string[][] } {
  const exam: string[] = [];
  if (!d.name.trim()) exam.push('name');
  if (!d.qs.length) exam.push('empty');
  return { exam, perQ: d.qs.map((q, i) => draftQuestion(q, i + 1).problems) };
}

export const move = <T,>(a: T[], i: number, d: number): T[] => {
  const j = i + d;
  if (j < 0 || j >= a.length) return a;
  const b = [...a];
  [b[i], b[j]] = [b[j]!, b[i]!];
  return b;
};
