import { t as tr } from '../i18n';
/**
 * Analizador de simulacros (SPEC §9c). Formato nativo:
 *   Caso:: …            (aplica a las preguntas siguientes hasta el próximo caso)
 *   1. ¿Pregunta?       (o "1)")
 *      A) opción        (o "A." / "a)"; "*" al final = correcta)
 *      Respuesta: B     (o "B, D")
 *      Explicación: …
 *      Tema: Cardiología/IAM
 *   Clave: 1-B, 2-A     (alternativa al final del archivo)
 * Nunca adivina la respuesta: sin respuesta marcada → borrador.
 */
import { parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter';
import { parseCSV } from '../io/csv';

export interface Question {
  id: string;
  n: number;
  case: string;
  text: string;
  options: { key: string; text: string }[];
  answer: string[];
  explanation: string;
  topic: string;
  problems: string[];
}

export interface Bank {
  name: string;
  minutes: number;
  shuffle: boolean;
  questions: Question[];
}

export function qid(text: string, opts: { text: string }[]): string {
  let h = 0x811c9dc5;
  for (const ch of text + '|' + opts.map((o) => o.text).join('|')) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193);
  return (h >>> 0).toString(36);
}

/** Id anterior a la auditoría (`charCodeAt`: de un emoji solo contaba la primera mitad; sin sufijo «-2» en repetidas). Solo para casar intentos guardados. */
export function legacyQid(q: Pick<Question, 'case' | 'text' | 'options'>): string {
  let h = 0x811c9dc5;
  for (const ch of q.case + q.text + '|' + q.options.map((o) => o.text).join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return (h >>> 0).toString(36);
}

/** Por id de pregunta: true si alguna vez se falló, false si siempre se acertó (solo respondidas). */
export function pastResults(attempts: { qs: { q: Question }[]; answers: Record<string, string[]> }[]): Map<string, boolean> {
  const seen = new Map<string, boolean>();
  for (const a of attempts) for (const x of a.qs) if (a.answers[x.q.id]?.length) seen.set(x.q.id, (seen.get(x.q.id) ?? false) || !isCorrect(x.q, a.answers[x.q.id]));
  return seen;
}

/** Resultado previo de `q`: por su id y, si no, por el id antiguo (intentos guardados antes del cambio de `qid`). */
export function pastResult(seen: Map<string, boolean>, q: Question): boolean | undefined {
  return seen.get(q.id) ?? seen.get(legacyQid(q));
}

const Q_RE = /^\s{0,3}(\d{1,3})[.)]\s+(.*)$/;
const OPT_RE = /^\s*(?:[-*]\s+)?([A-Fa-f])[.)]\s+(.*)$/;
const ANS_RE = /^\s*(?:Respuesta|Resp\.?|Correcta|Answer)\s*:\s*(.+)$/i;
const EXP_RE = /^\s*(?:Explicaci[oó]n|Justificaci[oó]n)\s*:\s*(.*)$/i;
const TOPIC_RE = /^\s*Tema\s*:\s*(.*)$/i;
const CASE_RE = /^\s*Caso\s*::?\s*(.*)$/i;
const KEY_RE = /^\s*Clave\s*:\s*(.+)$/i;

function letters(s: string): string[] {
  return [...new Set((s.toUpperCase().match(/\b[A-F]\b/g) ?? []))];
}

export function finalize(q: Omit<Question, 'id' | 'problems'> & { problems?: string[] }): Question {
  const problems: string[] = [];
  if (!q.text.trim()) problems.push(tr('parse.pregunta_vacia'));
  if (q.options.length === 0) problems.push(tr('parse.sin_opciones'));
  else if (q.options.length === 1) problems.push(tr('parse.una_sola_opcion'));
  if (!q.answer.length) problems.push(tr('parse.sin_respuesta_marcada'));
  else if (q.answer.some((a) => !q.options.some((o) => o.key === a))) problems.push(tr('parse.la_respuesta_no_coincide_con_ninguna'));
  return { ...q, problems, id: qid(q.case + q.text, q.options) };
}

/** Dos preguntas idénticas no pueden compartir id (score/byTopic indexan por id): la primera conserva el suyo, las siguientes llevan «-2», «-3»… */
function uniqueIds(qs: Question[]): Question[] {
  const seen = new Map<string, number>();
  return qs.map((q) => {
    const n = (seen.get(q.id) ?? 0) + 1;
    seen.set(q.id, n);
    return n > 1 ? { ...q, id: `${q.id}-${n}` } : q;
  });
}

export function parseText(text: string): Question[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: (Omit<Question, 'id' | 'problems'>)[] = [];
  let caseText = '';
  let inCase = false;
  let cur: (typeof out)[number] | null = null;
  let mode: 'text' | 'exp' | 'opt' = 'text';
  const key = new Map<number, string[]>();
  // dentro de una explicación, «N. …» abre pregunta solo si después vienen opciones (si no, es una lista numerada)
  const opensQuestion = (from: number) => {
    for (let j = from + 1; j < lines.length; j++) {
      if (Q_RE.test(lines[j]!) || CASE_RE.test(lines[j]!)) return false;
      if (OPT_RE.test(lines[j]!)) return true;
    }
    return false;
  };
  for (const [li, raw] of lines.entries()) {
    const line = raw.trimEnd();
    if (/^\s*<!--.*-->\s*$/.test(line)) continue;
    let m: RegExpExecArray | null;
    if ((m = KEY_RE.exec(line))) {
      for (const p of m[1]!.split(/[,;]\s*/)) {
        const k = /(\d+)\s*[-–:=.)]\s*([A-Fa-f](?:\s*[y&+/]\s*[A-Fa-f])*)/.exec(p);
        if (k) key.set(Number(k[1]), letters(k[2]!));
      }
      continue;
    }
    if ((m = CASE_RE.exec(line))) {
      caseText = m[1]!;
      inCase = true;
      cur = null;
      continue;
    }
    if ((m = Q_RE.exec(line)) && (mode !== 'exp' || !cur || opensQuestion(li))) {
      inCase = false;
      cur = { n: Number(m[1]), case: caseText, text: m[2]!, options: [], answer: [], explanation: '', topic: '' };
      out.push(cur);
      mode = 'text';
      continue;
    }
    if (inCase && !cur) {
      if (line.trim()) caseText += '\n' + line.trim();
      continue;
    }
    if (!cur) continue;
    if ((m = OPT_RE.exec(line)) && mode !== 'exp') {
      let t = m[2]!.trim();
      const k = m[1]!.toUpperCase();
      if (/(?<!\*)\s*\*$/.test(t)) {
        t = t.replace(/(?<!\*)\s*\*$/, '');
        if (!cur.answer.includes(k)) cur.answer.push(k);
      }
      cur.options.push({ key: k, text: t });
      mode = 'opt';
    } else if ((m = ANS_RE.exec(line))) {
      cur.answer = letters(m[1]!);
      mode = 'opt';
    } else if ((m = EXP_RE.exec(line))) {
      cur.explanation = m[1]!;
      mode = 'exp';
    } else if ((m = TOPIC_RE.exec(line))) {
      cur.topic = m[1]!.trim();
    } else if (line.trim()) {
      if (mode === 'exp') cur.explanation += '\n' + line.trim();
      else if (mode === 'opt' && cur.options.length) cur.options[cur.options.length - 1]!.text += ' ' + line.trim();
      else cur.text += '\n' + line.trim();
    }
  }
  for (const q of out) if (!q.answer.length && key.has(q.n)) q.answer = key.get(q.n)!;
  return uniqueIds(out.map(finalize));
}

export function parseBankMarkdown(text: string, fallbackName: string): Bank {
  const { data, body } = parseFrontmatter(text);
  return {
    name: typeof data.examen === 'string' ? data.examen : fallbackName,
    minutes: typeof data.minutos === 'number' ? data.minutos : 60,
    shuffle: data.aleatorio !== false,
    questions: parseText(body),
  };
}

/** CSV: pregunta, a, b, c, d, e, correcta, explicación, tema */
export function parseBankCSV(text: string): Question[] {
  const rows = parseCSV(text);
  const h = (rows[0] ?? []).map((x) => x.trim().toLowerCase());
  const hasHeader = h.includes('pregunta') || h.includes('question');
  const idx = (names: string[], d: number) => {
    const i = h.findIndex((x) => names.includes(x));
    return hasHeader ? i : d;
  };
  const qi = idx(['pregunta', 'question'], 0);
  const oi = ['a', 'b', 'c', 'd', 'e'].map((k, n) => idx([k, `opcion ${k}`, `opción ${k}`], n + 1));
  const ci = idx(['correcta', 'respuesta', 'answer'], 6);
  const ei = idx(['explicación', 'explicacion', 'explanation'], 7);
  const ti = idx(['tema', 'topic'], 8);
  return uniqueIds(rows.slice(hasHeader ? 1 : 0).map((r, n) => {
    const options = oi.map((i, k) => ({ key: 'ABCDE'[k]!, text: (i >= 0 ? r[i] ?? '' : '').trim() })).filter((o) => o.text);
    return finalize({ n: n + 1, case: '', text: (r[qi] ?? '').trim(), options, answer: letters(ci >= 0 ? r[ci] ?? '' : ''), explanation: (ei >= 0 ? r[ei] ?? '' : '').trim(), topic: (ti >= 0 ? r[ti] ?? '' : '').trim() });
  }));
}

/** JSON: [{pregunta, opciones: [..] | {A: ..}, correcta, explicacion, tema, caso}] */
export function parseBankJSON(text: string): Question[] {
  const data = JSON.parse(text) as unknown;
  const arr = (Array.isArray(data) ? data : (data as { preguntas?: unknown[]; questions?: unknown[] }).preguntas ?? (data as { questions?: unknown[] }).questions ?? []) as Record<string, unknown>[];
  return uniqueIds(arr.map((o, n) => {
    const raw = o.opciones ?? o.options ?? [];
    const options = Array.isArray(raw)
      ? raw.map((t, k) => ({ key: String.fromCharCode(65 + k), text: String(t) }))
      : Object.entries(raw as Record<string, unknown>).map(([k, t]) => ({ key: k.toUpperCase(), text: String(t) }));
    const ans = o.correcta ?? o.respuesta ?? o.answer ?? '';
    return finalize({ n: n + 1, case: String(o.caso ?? o.case ?? ''), text: String(o.pregunta ?? o.question ?? ''), options, answer: Array.isArray(ans) ? ans.map((x) => String(x).toUpperCase()) : letters(String(ans)), explanation: String(o.explicacion ?? o.explicación ?? o.explanation ?? ''), topic: String(o.tema ?? o.topic ?? '') });
  }));
}

export function summarize(qs: Question[]): string {
  // los problemas se guardan ya traducidos (finalize): comparar con el mismo texto traducido
  const noAns = qs.filter((q) => q.problems.includes(tr('parse.sin_respuesta_marcada'))).length;
  const one = qs.filter((q) => q.problems.includes(tr('parse.una_sola_opcion')) || q.problems.includes(tr('parse.sin_opciones'))).length;
  const parts = [tr('parse.n_preguntas_detectadas', { n: qs.length })];
  if (noAns) parts.push(tr('parse.noans_sin_respuesta_marcada', { noAns: noAns }));
  if (one) parts.push(tr('parse.one_con_una_sola_opcion_o', { one: one }));
  return parts.join('; ');
}

/** Serializa al formato nativo (las dudosas quedan como borrador con un comentario). */
export function serializeBank(b: Bank): string {
  let lastCase = '';
  const body = b.questions.map((q, i) => {
    const parts: string[] = [];
    // sin caso tras una con caso: «Caso::» vacío corta la herencia al releer
    if (q.case !== lastCase) parts.push(q.case ? `Caso:: ${q.case}\n` : 'Caso::\n');
    lastCase = q.case;
    if (q.problems.length) parts.push(`<!-- borrador: ${q.problems.join(', ')} -->`);
    parts.push(`${i + 1}. ${q.text}`);
    for (const o of q.options) parts.push(`   ${o.key}) ${o.text}`);
    if (q.answer.length) parts.push(`   Respuesta: ${q.answer.join(', ')}`);
    if (q.explanation) parts.push(`   Explicación: ${q.explanation.replace(/\n/g, ' ')}`);
    if (q.topic) parts.push(`   Tema: ${q.topic}`);
    return parts.join('\n');
  });
  return stringifyFrontmatter({ examen: b.name, minutos: b.minutes, aleatorio: b.shuffle }, body.join('\n\n') + '\n');
}

export function isCorrect(q: Question, given: string[] | undefined): boolean {
  if (!given?.length) return false;
  const g = new Set(given);
  return g.size === q.answer.length && [...g].every((x) => q.answer.includes(x));
}

export interface Score {
  correct: number;
  wrong: number;
  blank: number;
  points: number;
  pct: number;
  passed: boolean;
}

export function score(qs: Question[], answers: Record<string, string[]>, penalty = 0, pass = 0.6): Score {
  let correct = 0, wrong = 0, blank = 0;
  for (const q of qs) {
    const a = answers[q.id];
    if (!a?.length) blank++;
    else if (isCorrect(q, a)) correct++;
    else wrong++;
  }
  const points = Math.max(0, correct - wrong * penalty);
  const pct = qs.length ? points / qs.length : 0;
  return { correct, wrong, blank, points, pct, passed: pct >= pass };
}

export function byTopic(qs: Question[], answers: Record<string, string[]>): { topic: string; n: number; ok: number }[] {
  const m = new Map<string, { n: number; ok: number }>();
  for (const q of qs) {
    const t = q.topic || tr('simulacros.sin_tema');
    const x = m.get(t) ?? { n: 0, ok: 0 };
    x.n++;
    if (isCorrect(q, answers[q.id])) x.ok++;
    m.set(t, x);
  }
  return [...m].map(([topic, v]) => ({ topic, ...v })).sort((a, b) => a.topic.localeCompare(b.topic));
}

/** Tiempo restante con marcas de tiempo (no con un contador). */
export function timeLeft(endAt: number | null, now: number): number | null {
  return endAt === null ? null : Math.max(0, endAt - now);
}
