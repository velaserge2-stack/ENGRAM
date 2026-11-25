/**
 * Equivalentes y preguntas generadas por IA. Una pregunta generada NUNCA entra al banco directo:
 * queda «pendiente» (`.app/exam-pending/`) hasta que el usuario la revisa y acepta una por una.
 */
import { t as tr } from '../i18n';
import { parseFrontmatter } from '../lib/frontmatter';
import type { VaultAdapter } from '../vault/types';
import { readTextOr } from '../vault/util';
import { difficulty, pickDynamic, type Pick, type QStat } from './pick';
import { finalize, parseBankMarkdown, parseText, type Question, serializeBank } from './parse';

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Preguntas del mismo tema y de dificultad parecida (±0.25) a `target`, las más cercanas primero. */
export function equivalents(target: Question, pool: Question[], stats: Map<string, QStat>, k = 5): Question[] {
  const d = difficulty(target, stats);
  return pool
    .filter((q) => q.id !== target.id && q.topic === target.topic && !q.problems.length && Math.abs(difficulty(q, stats) - d) <= 0.25)
    .sort((a, b) => Math.abs(difficulty(a, stats) - d) - Math.abs(difficulty(b, stats) - d))
    .slice(0, k);
}

/** Ejemplos del banco (repartidos por tema) para la plantilla; determinista con la semilla. */
export function examples(qs: Question[], n: number, seed: string): Question[] {
  return pickDynamic(qs.filter((q) => !q.problems.length).map((q): Pick => ({ bank: '', q })), n, seed).map((p) => p.q);
}

/** Plantilla para pegar en el Asistente o en otra IA. El formato del banco (`Respuesta:`, `Explicación:`, `Tema:`) no se traduce. */
export function equivalentPrompt(ex: Question[], n: number): string {
  const body = parseFrontmatter(serializeBank({ name: '', minutes: 60, shuffle: true, questions: ex })).body.trim();
  return tr('examen2.prompt', { n, examples: body });
}

export type ReviewError = 'texto' | 'opciones' | 'correcta' | 'duplicadas' | 'explicacion' | 'repetida';
/** Validación previa a la revisión: ≥ 2 opciones, 1 correcta, sin duplicados (ni entre opciones ni con el banco), explicación no vacía. */
export function validateGenerated(q: Question, bank: Question[], batch: Question[] = []): ReviewError[] {
  const e: ReviewError[] = [];
  if (!q.text.trim()) e.push('texto');
  if (q.options.length < 2 || q.options.some((o) => !o.text.trim())) e.push('opciones');
  if (q.answer.length !== 1 || !q.options.some((o) => o.key === q.answer[0])) e.push('correcta');
  if (new Set(q.options.map((o) => norm(o.text))).size < q.options.length) e.push('duplicadas');
  if (!q.explanation.trim()) e.push('explicacion');
  const t = norm(q.text);
  if ([...bank, ...batch].some((x) => x.id === q.id || norm(x.text) === t)) e.push('repetida');
  return e;
}

export interface Pending { q: Question; errors: ReviewError[] }
/** Texto pegado (formato nativo) → pendientes con sus errores de validación. */
export function toPending(text: string, bank: Question[]): Pending[] {
  const out: Question[] = [];
  return parseText(text).map((q) => { const p = { q, errors: validateGenerated(q, bank, out) }; out.push(q); return p; });
}
/** Reedita una pendiente (texto, opciones, respuesta, explicación o tema) y la vuelve a validar. */
export function editPending(p: Pending, patch: Partial<Question>, bank: Question[]): Pending {
  const q = finalize({ ...p.q, ...patch });
  return { q, errors: validateGenerated(q, bank) };
}

// ───────── almacenamiento (por SafeVault: `vault.write`) ─────────
const DIR = '.app/exam-pending';
export const pendingPath = (bank: string) => `${DIR}/${bank.replace(/[\\/]/g, '__')}.json`;
export async function loadPending(vault: VaultAdapter, bank: string): Promise<Pending[]> {
  try {
    const raw = JSON.parse(await readTextOr(vault, pendingPath(bank), '[]')) as { q: Question }[];
    return Array.isArray(raw) ? raw.map((x) => ({ q: x.q, errors: [] })) : [];
  } catch { return []; }
}
export async function savePending(vault: VaultAdapter, bank: string, items: Pending[]): Promise<void> {
  if (items.length) await vault.write(pendingPath(bank), JSON.stringify(items.map((x) => ({ q: x.q, origen: 'ia' }))));
  else if (await vault.exists(pendingPath(bank))) await vault.remove(pendingPath(bank));
}

/** Banco con la pregunta añadida; `origen: ia` en el frontmatter marca que contiene preguntas generadas. Solo se llama tras «Aceptar» de esa pregunta. */
export function acceptInto(bankText: string, fallbackName: string, q: Question): string {
  const b = parseBankMarkdown(bankText, fallbackName);
  return serializeBank({ ...b, questions: [...b.questions, q] }).replace('\n---\n', '\norigen: ia\n---\n');
}
