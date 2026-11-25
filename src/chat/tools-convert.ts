// «Clase completa → notas + tarjetas + preguntas + diagrama». Una herramienta que solo PROPONE: parte el material en
// propuestas separadas (≤ 30 tarjetas, ≤ 15 preguntas cada una) con los constructores existentes; la UI guarda tras «Aceptar».
import { jsonSchema, tool, type ToolSet } from 'ai';
import { buildDiagram, buildNote, type DiagIn } from './make';
import { MAX_CARDS, MAX_QUESTIONS, buildCards, buildExam, isBad, type CardIn, type Proposal, type QIn } from './proposal';
import type { WriteCtx } from './tools-write';

export const MAX_TANDAS = 2, MAX_CONVERT = 6; // tandas por tipo y por llamada · propuestas por turno
export const chunk = <T,>(a: readonly T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));
const str = { type: 'string' } as const;

export interface ConvertIn { titulo: string; materia?: string; tema?: string; nota?: string; mazo?: string; tarjetas?: CardIn[]; preguntas?: QIn[]; diagrama?: { tipo: string; fuente: string }; fuente?: string }

/** Pura: arma las propuestas (o errores) y cuenta lo que quedó pendiente. */
export async function convert(ctx: Pick<WriteCtx, 'col' | 'vault' | 'sources'>, a: ConvertIn, reserved = new Set<string>()) {
  const free = async (p: string) => reserved.has(p) || ctx.vault.exists(p);
  const ok: Proposal[] = [], errores: string[] = [];
  const take = (r: Proposal | { error: string; detail?: string }, what: string) => {
    if (isBad(r)) errores.push(`${what}: ${r.error}${r.detail ? ' (' + r.detail + ')' : ''}`);
    else { reserved.add(r.destino); ok.push(r); }
  };
  const titulo = String(a.titulo ?? '').trim();
  if (a.nota?.trim()) take(await buildNote(free, { titulo, contenido: a.nota, materia: a.materia, tema: a.tema }), 'nota');
  if (a.diagrama?.fuente) take(await buildDiagram(free, { tipo: a.diagrama.tipo, titulo: `${titulo} · diagrama`, fuente: a.diagrama.fuente, materia: a.materia, tema: a.tema } as DiagIn), 'diagrama');
  const fuente = a.fuente && ctx.sources.some((s) => s.ruta === a.fuente) ? a.fuente : undefined;
  const cards = chunk(a.tarjetas ?? [], MAX_CARDS), qs = chunk(a.preguntas ?? [], MAX_QUESTIONS);
  cards.slice(0, MAX_TANDAS).forEach((c) => take(buildCards(ctx.col, a.mazo || titulo, c, fuente), 'tarjetas'));
  qs.slice(0, MAX_TANDAS).forEach((q, i) => take(buildExam(qs.length > 1 ? `${titulo} · Parte ${i + 1}` : titulo, undefined, q), 'preguntas'));
  return { ok, errores, pendientes: { tarjetas: cards.slice(MAX_TANDAS).flat().length, preguntas: qs.slice(MAX_TANDAS).flat().length } };
}

export function makeConvertTools(ctx: WriteCtx): ToolSet {
  let n = 0;
  const reserved = new Set<string>();
  return {
    convertir_clase: tool({
      description: 'Convierte el material de UNA clase (que ya leíste o pegó el usuario) en propuestas separadas: nota estructurada, diagrama, tarjetas (30 por propuesta) y preguntas de simulacro (15 por propuesta). Ninguna se guarda: el usuario revisa y acepta cada una. Llámala UNA vez con todo.',
      inputSchema: jsonSchema<ConvertIn>({ type: 'object', properties: { titulo: { ...str, description: 'Nombre de la clase' }, materia: str, tema: str, nota: { ...str, description: 'Markdown estructurado de la clase (opcional)' }, mazo: { ...str, description: 'Mazo de destino de las tarjetas (por defecto, el título)' }, tarjetas: { type: 'array', items: { type: 'object', properties: { pregunta: str, respuesta: str, cloze: str }, additionalProperties: false } }, preguntas: { type: 'array', items: { type: 'object', properties: { texto: str, opciones: { type: 'array', items: str }, correcta: str, explicacion: str, tema: str }, required: ['texto', 'opciones', 'correcta'], additionalProperties: false } }, diagrama: { type: 'object', properties: { tipo: { type: 'string', enum: ['mapa', 'flujo', 'diagrama'] }, fuente: str }, required: ['tipo', 'fuente'], additionalProperties: false }, fuente: { ...str, description: 'Ruta de la nota de origen devuelta por una herramienta (opcional)' } }, required: ['titulo'], additionalProperties: false }),
      execute: async (a) => {
        if (!ctx.allowed()) return { error: 'El usuario no pidió crear ni modificar nada: no se propone nada.' };
        const r = await convert(ctx, a, reserved), room = MAX_CONVERT - n, shown = r.ok.slice(0, Math.max(0, room));
        shown.forEach((p) => { n++; ctx.propose(p); });
        return { estado: 'PROPUESTAS mostradas al usuario; no se ha guardado nada hasta que pulse Aceptar en cada una.', propuestas: shown.map((p) => p.resumen), errores: r.errores, pendientes: r.pendientes, ...(r.ok.length > shown.length ? { aviso: 'Límite de propuestas del turno: el resto se propone después.' } : {}) };
      },
    }),
  };
}
