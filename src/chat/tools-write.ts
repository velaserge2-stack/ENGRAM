// Herramientas de ESCRITURA del Asistente (Fase 3b). NUNCA escriben: solo validan con los parsers reales y devuelven una
// PROPUESTA que la interfaz muestra en una vista previa; se escribe únicamente cuando el usuario pulsa «Aceptar» (preview.tsx).
// Solo se ofrecen si el último mensaje del usuario pide crear/agregar/modificar (`wantsWrite`) y cada una lo vuelve a comprobar.
import { jsonSchema, tool, type ToolSet } from 'ai';
import { MAX_PROPOSALS, MAX_QUESTIONS, buildCards, buildEvent, buildEventEdit, buildExam, isBad, type CardIn, type EventFields, type Proposal, type QIn } from './proposal';
import type { ToolCtx } from './tools';

export interface WriteCtx extends ToolCtx {
  /** ¿el último mensaje del usuario pidió escribir? (se evalúa en cada llamada) */
  allowed: () => boolean;
  propose: (p: Proposal) => void;
}
const str = { type: 'string' } as const;
const NO = { error: 'El usuario no pidió crear ni modificar nada: no se propone nada.' };
const EV = { titulo: str, fecha: { ...str, description: 'AAAA-MM-DD' }, inicio: { ...str, description: 'HH:MM' }, fin: { ...str, description: 'HH:MM' }, materia: str, nota: str, tipo: { type: 'string', enum: ['clase', 'actividad', 'estudio', 'examen', 'otro'] } } as const;

export function makeWriteTools(ctx: WriteCtx): ToolSet {
  let n = 0; // propuestas de este turno
  const out = (p: Proposal | { error: string; detail?: string }) => {
    if (isBad(p)) return { error: `No válido (${p.error}${p.detail ? ': ' + p.detail : ''}). Corrige y vuelve a intentar.` };
    if (n >= MAX_PROPOSALS) return { error: `Límite alcanzado: ya hay ${MAX_PROPOSALS} propuestas en este turno. No propongas más; dile al usuario que pida el resto después de revisar estas.` };
    n++;
    ctx.propose(p);
    return { estado: 'PROPUESTA mostrada al usuario; no se ha guardado nada hasta que pulse Aceptar.', resumen: p.resumen };
  };
  return {
    crear_tarjetas: tool({
      description: 'Propone tarjetas nuevas para un mazo (existente o nuevo). Úsala tras leer notas o PDF. No guarda: el usuario revisa y acepta. Máx. 30.',
      inputSchema: jsonSchema<{ mazo: string; tarjetas: CardIn[]; fuente?: string }>({ type: 'object', properties: { mazo: str, tarjetas: { type: 'array', items: { type: 'object', properties: { pregunta: str, respuesta: str, cloze: { ...str, description: 'Alternativa: frase con huecos {{c1::texto}}' } }, additionalProperties: false } }, fuente: { ...str, description: 'Ruta de la nota de origen devuelta por una herramienta (opcional)' } }, required: ['mazo', 'tarjetas'], additionalProperties: false }),
      execute: async ({ mazo, tarjetas, fuente }) => {
        if (!ctx.allowed()) return NO;
        return out(buildCards(ctx.col, mazo, tarjetas, fuente && ctx.sources.some((s) => s.ruta === fuente) ? fuente : undefined));
      },
    }),
    crear_examen: tool({
      description: 'Propone un banco de preguntas de opción múltiple (simulacro) nuevo. No guarda: el usuario revisa y acepta. Máx. 15 preguntas por llamada: para más, propón varios bancos («… · Parte 1», «… · Parte 2»).',
      inputSchema: jsonSchema<{ nombre: string; minutos?: number; preguntas: QIn[] }>({ type: 'object', properties: { nombre: str, minutos: { type: 'number' }, preguntas: { type: 'array', items: { type: 'object', properties: { texto: str, opciones: { type: 'array', items: str }, correcta: { ...str, description: 'Letra A–F de la opción correcta' }, explicacion: str, tema: str }, required: ['texto', 'opciones', 'correcta'], additionalProperties: false } } }, required: ['nombre', 'preguntas'], additionalProperties: false }),
      execute: async ({ nombre, minutos, preguntas }) => {
        if (!ctx.allowed()) return NO;
        const r = out(buildExam(nombre, minutos, preguntas));
        return preguntas.length > MAX_QUESTIONS && !('error' in r) ? { ...r, aviso: `Solo se tomaron las primeras ${MAX_QUESTIONS} preguntas. Díselo al usuario y ofrece proponer el resto como otra parte.` } : r;
      },
    }),
    agregar_evento: tool({
      description: 'Propone un evento nuevo en el calendario del usuario. No guarda: el usuario revisa y acepta.',
      inputSchema: jsonSchema<Partial<EventFields>>({ type: 'object', properties: EV, required: ['titulo', 'fecha', 'inicio', 'fin'], additionalProperties: false }),
      execute: async (f) => (ctx.allowed() ? out(buildEvent(f)) : NO),
    }),
    modificar_evento: tool({
      description: 'Propone cambiar un evento propio ya existente (se identifica por título y la fecha en que ocurre). Nunca borra. No guarda: el usuario revisa y acepta.',
      inputSchema: jsonSchema<{ titulo?: string; fecha: string; cambios: Partial<EventFields> }>({ type: 'object', properties: { titulo: str, fecha: { ...str, description: 'Fecha actual del evento AAAA-MM-DD' }, cambios: { type: 'object', properties: EV, additionalProperties: false } }, required: ['fecha', 'cambios'], additionalProperties: false }),
      execute: async (q) => (ctx.allowed() ? out(await buildEventEdit(ctx.vault, q)) : NO),
    }),
  };
}
