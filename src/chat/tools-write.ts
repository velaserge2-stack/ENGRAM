// Herramientas de ESCRITURA del Asistente (Fase 3b). NUNCA escriben: solo validan con los parsers reales y devuelven una
// PROPUESTA que la interfaz muestra en una vista previa; se escribe únicamente cuando el usuario pulsa «Aceptar» (preview.tsx).
// Solo se ofrecen si el último mensaje del usuario pide crear/agregar/modificar (`wantsWrite`) y cada una lo vuelve a comprobar.
import { jsonSchema, tool, type ToolSet } from 'ai';
import { MAX_PROPOSALS, MAX_QUESTIONS, buildCards, buildEvent, buildEventEdit, buildExam, isBad, type CardIn, type EventFields, type Proposal, type QIn } from './proposal';
import { buildDeleteBank, buildDeleteDeck, buildDeleteEvent, buildDeleteNote, MAX_DELETES, named } from './delete';
import { buildDiagram, buildExamDate, buildNote, type DiagIn, type ExamIn, type NoteIn } from './make';
import type { ToolCtx } from './tools';

export interface WriteCtx extends ToolCtx {
  /** ¿el último mensaje del usuario pidió escribir? (se evalúa en cada llamada) */
  allowed: () => boolean;
  propose: (p: Proposal) => void;
  /** último mensaje del usuario (borrar: el objetivo debe aparecer ahí) */
  userText?: string;
}
const str = { type: 'string' } as const;
const NO = { error: 'El usuario no pidió crear ni modificar nada: no se propone nada.' };
const EV = { titulo: str, fecha: { ...str, description: 'AAAA-MM-DD' }, inicio: { ...str, description: 'HH:MM' }, fin: { ...str, description: 'HH:MM' }, materia: str, nota: str, tipo: { type: 'string', enum: ['clase', 'actividad', 'estudio', 'examen', 'otro'] } } as const;

export function makeWriteTools(ctx: WriteCtx): ToolSet {
  let n = 0; // propuestas de este turno
  const reserved = new Set<string>(); // rutas ya propuestas en este turno (dos notas con el mismo título no chocan)
  const free = async (p: string) => reserved.has(p) || ctx.vault.exists(p);
  const out = (p: Proposal | { error: string; detail?: string }) => {
    if (isBad(p)) return { error: `No válido (${p.error}${p.detail ? ': ' + p.detail : ''}). ${['exists', 'pasada', 'temas', 'fecha'].includes(p.error) ? 'No lo cambies por tu cuenta: díselo al usuario y pregúntale.' : 'Corrige y vuelve a intentar.'}` };
    if (n >= MAX_PROPOSALS) return { error: `Límite alcanzado: ya hay ${MAX_PROPOSALS} propuestas en este turno. No propongas más; dile al usuario que pida el resto después de revisar estas.` };
    n++;
    reserved.add(p.destino);
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
    crear_nota: tool({
      description: 'Propone una NOTA nueva (Markdown) en la sección Notas. Solo si el usuario pidió crear una nota; úsala tras leer sus fuentes. No guarda: el usuario revisa y acepta. Nunca sobrescribe (si el título existe, añade « (2)»). Máx. 20 000 caracteres.',
      inputSchema: jsonSchema<NoteIn>({ type: 'object', properties: { titulo: str, contenido: { ...str, description: 'Markdown; sin frontmatter' }, materia: { ...str, description: 'Opcional; sin materia queda en «Sin clasificar»' }, tema: { ...str, description: 'Opcional' }, tags: { type: 'array', items: str } }, required: ['titulo', 'contenido'], additionalProperties: false }),
      execute: async (a) => (ctx.allowed() ? out(await buildNote(free, a)) : NO),
    }),
    crear_diagrama: tool({
      description: 'Propone una nota de DIAGRAMA nueva: mapa mental (mapa), diagrama de flujo (flujo) o diagrama libre (diagrama). `fuente` es la gramática del tipo (sin ```); se valida con el analizador real y, si falla, devuelve la línea y el código para que corrijas. No guarda: el usuario revisa y acepta.',
      inputSchema: jsonSchema<DiagIn>({ type: 'object', properties: { tipo: { type: 'string', enum: ['mapa', 'flujo', 'diagrama'] }, titulo: str, fuente: { ...str, description: 'Gramática del diagrama' }, materia: str, tema: str }, required: ['tipo', 'titulo', 'fuente'], additionalProperties: false }),
      execute: async (a) => (ctx.allowed() ? out(await buildDiagram(free, a)) : NO),
    }),
    registrar_examen: tool({
      description: 'Propone REGISTRAR un examen con fecha en la sección Exámenes (para el ritmo de repaso), no un banco de preguntas. Fecha AAAA-MM-DD de hoy o futura; `temas` deben ser mazos, carpetas o `tag:x` que existan. Nunca sobrescribe. No guarda: el usuario revisa y acepta.',
      inputSchema: jsonSchema<ExamIn>({ type: 'object', properties: { nombre: str, fecha: { ...str, description: 'AAAA-MM-DD' }, temas: { type: 'array', items: str }, meta_retencion: { type: 'number', description: '0.5–0.99 (por omisión 0.9)' }, dias_repaso_final: { type: 'number', description: '0–60 (por omisión 7)' } }, required: ['nombre', 'fecha', 'temas'], additionalProperties: false }),
      execute: async (a) => (ctx.allowed() ? out(await buildExamDate(free, ctx.col, ctx.today, a)) : NO),
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

const NO_DEL = { error: 'El usuario no pidió borrar nada: no se propone nada.' };
/**
 * Herramientas de BORRADO: igual que las demás, solo PROPONEN. Borrar = mover a la papelera existente, con confirmación en la
 * interfaz; nunca definitivo ni vaciar la papelera. Solo se ofrecen si el último mensaje del USUARIO lo pide (`wantsDelete`).
 */
export function makeDeleteTools(ctx: WriteCtx): ToolSet {
  let n = 0; // propuestas de borrado de este turno
  const out = (p: Proposal | { error: string; detail?: string }) => {
    if (isBad(p)) return { error: `No válido (${p.error}${p.detail ? ': ' + p.detail : ''}). ${p.error === 'varios' ? 'Pide al usuario que precise cuál.' : 'Díselo al usuario; no inventes otro nombre.'}` };
    if (!named(ctx.userText ?? '', p)) return { error: 'El usuario no nombró ese objetivo en su mensaje: no se propone nada. Pregúntale cuál quiere borrar.' };
    if (n >= MAX_DELETES) return { error: `Límite alcanzado: ya hay ${MAX_DELETES} propuestas de borrado en este turno. No propongas más.` };
    n++;
    ctx.propose(p);
    return { estado: 'PROPUESTA de borrado mostrada al usuario; no se ha movido nada hasta que confirme. Irá a la papelera y podrá restaurarlo.', resumen: p.resumen };
  };
  const one = (description: string, extra: Record<string, unknown>, run: (q: any) => Promise<Proposal | { error: string; detail?: string }>) => tool({
    description: `${description} Solo si el usuario lo pidió con claridad; un solo objetivo por llamada. Solo propone: lo mueve a la papelera tras confirmar (nunca definitivo).`,
    inputSchema: jsonSchema<Record<string, string>>({ type: 'object', properties: { nombre: { ...str, description: 'Nombre o ruta exacta de lo que existe' }, ...extra }, required: ['nombre'], additionalProperties: false }),
    execute: async (q) => (ctx.allowed() ? out(await run(q)) : NO_DEL),
  });
  return {
    borrar_nota: one('Propone mover una nota a la papelera.', {}, (q) => buildDeleteNote(ctx.vault, q.nombre)),
    borrar_mazo: one('Propone mover un mazo a la papelera (los repasos del historial se conservan).', {}, (q) => buildDeleteDeck(ctx.col, ctx.vault, q.nombre)),
    borrar_banco: one('Propone mover un banco de preguntas (simulacro) a la papelera.', {}, (q) => buildDeleteBank(ctx.vault, q.nombre)),
    borrar_evento: tool({
      description: 'Propone quitar un evento PROPIO del calendario (una ocurrencia o la serie entera; los importados son de solo lectura). Solo si el usuario lo pidió con claridad. Solo propone; se puede deshacer.',
      inputSchema: jsonSchema<{ titulo?: string; fecha: string; alcance?: string }>({ type: 'object', properties: { titulo: str, fecha: { ...str, description: 'Fecha de la ocurrencia AAAA-MM-DD' }, alcance: { type: 'string', enum: ['ocurrencia', 'serie'] } }, required: ['fecha'], additionalProperties: false }),
      execute: async (q) => (ctx.allowed() ? out(await buildDeleteEvent(ctx.vault, q)) : NO_DEL),
    }),
  };
}
