// Herramientas de EXAMEN del Asistente (carril Exámenes). Solo proponen (vista previa + Aceptar); no escriben.
// El cableado en turn.ts lo hace el integrador: `makeExamTools(ctx)` se mezcla con `makeWriteTools(ctx)` (mismo `WriteCtx`).
import { jsonSchema, tool, type ToolSet } from 'ai';
import { ATTEMPTS } from '../data/extra';
import { examples, equivalentPrompt } from '../sim/review';
import { parseBankMarkdown, type Question } from '../sim/parse';
import { qStats, difficulty } from '../sim/pick';
import { readTextOr, walk } from '../vault/util';
import { MAX_PROPOSALS, MAX_QUESTIONS, buildExam, isBad, type QIn } from './proposal';
import type { WriteCtx } from './tools-write';

const str = { type: 'string' } as const;
const NO = { error: 'El usuario no pidió crear nada: no se propone nada.' };

export function makeExamTools(ctx: WriteCtx): ToolSet {
  let n = 0;
  const banks = async () => {
    const out: { path: string; name: string; qs: Question[] }[] = [];
    for (const f of await walk(ctx.vault, 'exams-bank')) if (f.path.endsWith('.md')) {
      const b = parseBankMarkdown(await readTextOr(ctx.vault, f.path, ''), f.name.replace(/\.md$/, ''));
      if (b.questions.length) out.push({ path: f.path, name: b.name, qs: b.questions });
    }
    return out;
  };
  return {
    ejemplos_equivalentes: tool({
      description: 'LEE ejemplos de un banco (repartidos por tema, con su dificultad por historial) y la plantilla para generar preguntas EQUIVALENTES (mismo tema y dificultad). Después llama a `proponer_equivalentes`. No escribe.',
      inputSchema: jsonSchema<{ banco: string; cantidad?: number }>({ type: 'object', properties: { banco: { ...str, description: 'Nombre del banco' }, cantidad: { type: 'number', description: 'Cuántas preguntas nuevas (≤ 15)' } }, required: ['banco'], additionalProperties: false }),
      execute: async ({ banco, cantidad }) => {
        const b = (await banks()).find((x) => x.name === banco || x.path === banco);
        if (!b) return { error: 'No existe ese banco.' };
        const stats = qStats(await attempts());
        const ex = examples(b.qs, 6, b.path);
        const k = Math.min(MAX_QUESTIONS, Math.max(1, Math.round(cantidad ?? 5)));
        return { banco: b.name, dificultad: ex.map((q) => ({ tema: q.topic, dificultad: Number(difficulty(q, stats).toFixed(2)) })), plantilla: equivalentPrompt(ex, k) };
      },
    }),
    proponer_equivalentes: tool({
      description: 'Propone un banco NUEVO con preguntas equivalentes generadas por ti (con explicación). No guarda: el usuario revisa y acepta. Máx. 15.',
      inputSchema: jsonSchema<{ banco: string; preguntas: QIn[] }>({ type: 'object', properties: { banco: str, preguntas: { type: 'array', items: { type: 'object', properties: { texto: str, opciones: { type: 'array', items: str }, correcta: str, explicacion: str, tema: str }, required: ['texto', 'opciones', 'correcta', 'explicacion'], additionalProperties: false } } }, required: ['banco', 'preguntas'], additionalProperties: false }),
      execute: async ({ banco, preguntas }) => {
        if (!ctx.allowed()) return NO;
        if (n >= MAX_PROPOSALS) return { error: `Límite alcanzado: ${MAX_PROPOSALS} propuestas en este turno.` };
        const p = buildExam(`${banco} · equivalentes`, undefined, preguntas.filter((q) => q?.explicacion?.trim()));
        if (isBad(p)) return { error: `No válido (${p.error}${p.detail ? ': ' + p.detail : ''}). Corrige y vuelve a intentar.` };
        n++;
        ctx.propose(p);
        return { estado: 'PROPUESTA mostrada al usuario; no se ha guardado nada hasta que pulse Aceptar.', resumen: p.resumen };
      },
    }),
  };
  async function attempts() {
    const out = [];
    for (const l of (await readTextOr(ctx.vault, ATTEMPTS, '')).split('\n')) { try { if (l.trim()) out.push(JSON.parse(l)); } catch { /* dañada */ } }
    return out;
  }
}
