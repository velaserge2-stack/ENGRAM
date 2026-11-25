// Herramientas de EDICIÓN del Asistente: cambian lo que ya existe, pero SOLO PROPONEN (vista previa con diff, Aceptar, deshacer).
// Resuelven por nombre/ruta contra lo que existe (varios → `varios` con lista; ninguno → `noexiste`); nunca eligen solas entre parecidos.
import { jsonSchema, tool, type ToolSet } from 'ai';
import { parseDeck, replaceBlock } from '../cards/parse';
import { headOf, parseFrontmatter, setKeys } from '../lib/frontmatter';
import { parseExam } from '../lib/exams';
import { listNotes } from '../notes/model';
import { noteStore } from '../notes/store';
import { clampMinutes, parseBankMarkdown, serializeBank } from '../sim/parse';
import type { VaultAdapter } from '../vault/types';
import { readTextOr, walk } from '../vault/util';
import { fingerprint, pick, type Cand } from './delete';
import { diffLines } from './diff';
import { checkExamFile, one, topicOptions } from './make';
import { budget } from './providers';
import { MAX_PROPOSALS, MAX_QUESTIONS, buildExam, isBad, type Bad, type Proposal, type QIn } from './proposal';
import type { WriteCtx } from './tools-write';

export const EDIT_TOOLS = ['anadir_a_nota', 'editar_nota', 'etiquetar_nota', 'editar_tarjeta', 'anadir_preguntas_a_banco', 'modificar_examen'] as const;
const str = { type: 'string' } as const;
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
// eslint-disable-next-line no-control-regex
const clean = (s: unknown) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/<!--|-->/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const eolOf = (t: string) => (t.includes('\r\n') ? '\r\n' : '\n');
const cleanTag = (x: unknown) => String(x ?? '').trim().replace(/^#+/, '').replace(/[\s,[\]]+/g, '-').slice(0, 40);

/** Propuesta de edición: texto completo nuevo + huella del anterior + diff. */
export function editProposal(destino: string, antes: string, despues: string, resumen: string): Proposal | Bad {
  if (antes === despues) return { error: 'igual', detail: 'El cambio no modifica nada.' };
  if (despues.length > antes.length + budget().writeChars) return { error: 'largo', detail: `${budget().writeChars}` };
  return { tipo: 'edicion', destino, contenido: despues, antes, huella: fingerprint(antes), items: diffLines(antes, despues), resumen, reversible: true };
}

// ───────── texto de una nota ─────────
/** Añade `texto` al final o al final de la sección `bajo` (encabezado exacto, sin importar mayúsculas ni acentos). */
export function appendToNote(text: string, add: string, bajo?: string): string | Bad {
  const eol = eolOf(text), ins = clean(add).trim().split('\n');
  if (!ins.join('').trim()) return { error: 'vacio' };
  if (!bajo?.trim()) return text.replace(/\s*$/, '') + eol + eol + ins.join(eol) + eol;
  const lines = text.split('\n'), want = norm(bajo.replace(/^#+\s*/, ''));
  const hs = lines.flatMap((l, i) => { const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l.replace(/\r$/, '')); return m && norm(m[2]!) === want ? [{ i, lv: m[1]!.length }] : []; });
  if (!hs.length) return { error: 'encabezado', detail: 'No hay un encabezado con ese nombre.' };
  if (hs.length > 1) return { error: 'varios', detail: `${hs.length} encabezados iguales` };
  const { i, lv } = hs[0]!;
  let e = lines.findIndex((l, k) => k > i && /^#{1,6}\s/.test(l) && /^#+/.exec(l)![0].length <= lv);
  if (e < 0) e = lines.length;
  while (e > i + 1 && lines[e - 1]!.trim() === '') e--;
  lines.splice(e, 0, eol === '\r\n' ? '\r' : '', ...ins.map((l) => l + (eol === '\r\n' ? '\r' : '')));
  return lines.join('\n').replace(/\s*$/, '') + eol;
}
/** Reemplaza UN fragmento exacto del cuerpo (no del frontmatter). */
export function replaceInNote(text: string, buscar: string, nuevo: string): string | Bad {
  const find = clean(buscar), head = (headOf(text) ?? '').length, body = text.slice(head);
  if (find.trim().length < 3) return { error: 'fragmento', detail: 'El fragmento a buscar es demasiado corto.' };
  const f = eolOf(text) === '\r\n' ? find.replace(/\n/g, '\r\n') : find;
  const n = body.split(f).length - 1;
  if (n === 0) return { error: 'nofragmento', detail: 'Ese texto exacto no está en la nota; léela de nuevo y copia el fragmento tal cual.' };
  if (n > 1) return { error: 'ambiguo', detail: `El fragmento aparece ${n} veces; incluye más contexto para que sea único.` };
  const r = eolOf(text) === '\r\n' ? clean(nuevo).replace(/\n/g, '\r\n') : clean(nuevo);
  return text.slice(0, head) + body.replace(f, () => r);
}
export function retag(text: string, add: unknown, drop: unknown): string | Bad {
  const cur = parseFrontmatter(text).data.tags;
  const have = (Array.isArray(cur) ? cur : typeof cur === 'string' && cur ? [cur] : []).map(String);
  const rm = new Set((Array.isArray(drop) ? drop : []).map(cleanTag).map(norm)), ad = (Array.isArray(add) ? add : []).slice(0, 10).map(cleanTag).filter(Boolean);
  const next = [...new Set([...have.filter((t) => !rm.has(norm(t))), ...ad])];
  return setKeys(text, { tags: next.length ? next : undefined });
}

// ───────── resolver contra lo que existe ─────────
async function noteOf(vault: VaultAdapter, q: string): Promise<{ path: string; text: string; title: string } | Bad> {
  const c = pick((await listNotes(vault)).map((m) => ({ key: m.path, names: [m.title, m.path, m.path.replace(/^notes\//, ''), m.path.replace(/^notes\/|\.md$/g, '')], label: m.path })), String(q ?? ''));
  if ('error' in c) return c;
  return { path: c.key, text: noteStore.peek(c.key) ?? await readTextOr(vault, c.key, ''), title: c.label.replace(/^notes\/|\.md$/g, '') };
}
async function fileOf(vault: VaultAdapter, dir: string, q: string): Promise<{ path: string; text: string } | Bad> {
  const files = (await walk(vault, dir)).filter((f) => f.path.endsWith('.md') && f.path.split('/').length === 2);
  const c = pick(files.map((f) => ({ key: f.path, names: [f.name.replace(/\.md$/, ''), f.path], label: f.path })), String(q ?? ''));
  return 'error' in c ? c : { path: c.key, text: await readTextOr(vault, c.key, '') };
}

export function makeEditTools(ctx: WriteCtx): ToolSet {
  let n = 0;
  const NO = { error: 'El usuario no pidió crear ni modificar nada: no se propone nada.' };
  const out = (p: Proposal | Bad) => {
    if (isBad(p)) return { error: `No válido (${p.error}${p.detail ? ': ' + p.detail : ''}). ${p.error === 'varios' ? 'Pide al usuario que precise cuál.' : p.error === 'noexiste' ? 'Díselo al usuario; no inventes otro nombre.' : 'Corrige y vuelve a intentar.'}` };
    if (n >= MAX_PROPOSALS) return { error: `Límite alcanzado: ya hay ${MAX_PROPOSALS} propuestas en este turno. No propongas más.` };
    n++; ctx.propose(p);
    return { estado: 'PROPUESTA mostrada al usuario con el cambio exacto; no se ha guardado nada hasta que pulse Aceptar.', resumen: p.resumen };
  };
  const run = <I,>(f: (i: I) => Promise<Proposal | Bad>) => async (i: I) => (ctx.allowed() ? out(await f(i)) : NO);
  const noteEdit = async (q: string, change: (t: string) => string | Bad): Promise<Proposal | Bad> => {
    const nt = await noteOf(ctx.vault, q);
    if ('error' in nt) return nt;
    const r = change(nt.text);
    return typeof r === 'string' ? editProposal(nt.path, nt.text, r, nt.title) : r;
  };
  return {
    anadir_a_nota: tool({
      description: 'Propone AÑADIR texto (Markdown) a una nota que ya existe: al final, o al final de la sección con ese encabezado. No guarda: el usuario revisa el cambio y acepta.',
      inputSchema: jsonSchema<{ nota: string; texto: string; bajo_encabezado?: string }>({ type: 'object', properties: { nota: { ...str, description: 'Título o ruta exacta' }, texto: str, bajo_encabezado: { ...str, description: 'Opcional: encabezado de la sección' } }, required: ['nota', 'texto'], additionalProperties: false }),
      execute: run(({ nota, texto, bajo_encabezado }) => noteEdit(nota, (t) => appendToNote(t, texto, bajo_encabezado))),
    }),
    editar_nota: tool({
      description: 'Propone REEMPLAZAR un fragmento exacto del cuerpo de una nota (copiado tal cual de lo que leíste). Falla si no existe o aparece varias veces. Muestra el cambio; el usuario acepta.',
      inputSchema: jsonSchema<{ nota: string; buscar: string; reemplazar: string }>({ type: 'object', properties: { nota: str, buscar: { ...str, description: 'Fragmento exacto actual' }, reemplazar: { ...str, description: 'Texto nuevo (vacío = quitar el fragmento)' } }, required: ['nota', 'buscar', 'reemplazar'], additionalProperties: false }),
      execute: run(({ nota, buscar, reemplazar }) => noteEdit(nota, (t) => replaceInNote(t, buscar, reemplazar))),
    }),
    etiquetar_nota: tool({
      description: 'Propone añadir o quitar etiquetas (tags) en el frontmatter de una nota existente.',
      inputSchema: jsonSchema<{ nota: string; anadir?: string[]; quitar?: string[] }>({ type: 'object', properties: { nota: str, anadir: { type: 'array', items: str }, quitar: { type: 'array', items: str } }, required: ['nota'], additionalProperties: false }),
      execute: run(({ nota, anadir, quitar }) => noteEdit(nota, (t) => retag(t, anadir, quitar))),
    }),
    editar_tarjeta: tool({
      description: 'Propone cambiar la pregunta/respuesta (o el cloze) de UNA tarjeta existente, conservando su ID y su historial de repaso. Se identifica por mazo + texto de la pregunta (o su ID).',
      inputSchema: jsonSchema<{ mazo: string; tarjeta: string; pregunta?: string; respuesta?: string; cloze?: string }>({ type: 'object', properties: { mazo: str, tarjeta: { ...str, description: 'Texto de la pregunta actual (o su ID)' }, pregunta: str, respuesta: str, cloze: str }, required: ['mazo', 'tarjeta'], additionalProperties: false }),
      execute: run(async ({ mazo, tarjeta, pregunta, respuesta, cloze }) => {
        const d = ctx.col ? pick(ctx.col.decks.map((x) => ({ key: x.path, names: [x.full, x.name, x.path], label: x.full })), mazo) : ({ error: 'noexiste' } as Bad);
        if ('error' in d) return d;
        const text = await readTextOr(ctx.vault, d.key, ''), notes = parseDeck(text).notes, q = norm(String(tarjeta ?? '')).replace(/^\^/, '');
        const hits = notes.filter((x) => x.id && norm(x.id) === q), by = hits.length ? hits : notes.filter((x) => norm(x.front) === q);
        const m = by.length ? by : notes.filter((x) => q.length >= 3 && norm(x.front).includes(q));
        if (!m.length) return { error: 'noexiste' } as Bad;
        if (m.length > 1) return { error: 'varios', detail: m.slice(0, 8).map((x) => x.front.slice(0, 60)).join(' | ') } as Bad;
        const c = m[0]!;
        if (!c.id) return { error: 'sinid', detail: 'La tarjeta aún no tiene ID (se asigna al guardar o repasar); no se puede editar sin perder su historial.' } as Bad;
        let block: string;
        if (c.type === 'cloze') { const cl = one(cloze); if (!cl) return { error: 'tipo', detail: 'Es una tarjeta cloze: pasa `cloze`.' } as Bad; block = `Cloze: ${cl}`; }
        else if (c.type === 'basic') { const a = one(respuesta) || c.back, p = one(pregunta) || c.front; if (!p || !a) return { error: 'vacio' } as Bad; block = `Q:: ${p}\nA:: ${a}`; }
        else return { error: 'tipo', detail: `Solo se editan tarjetas básicas y cloze (esta es «${c.type}»).` } as Bad;
        const next = replaceBlock(text, c.id, `${block} <!-- origen: ia -->`);
        const chk = parseDeck(next).notes.find((x) => x.id === c.id);
        if (!chk || chk.errors.length) return { error: 'formato', detail: chk?.errors[0] } as Bad;
        return editProposal(d.key, text, next, `${c.front.slice(0, 60)} → ${d.label}`);
      }),
    }),
    anadir_preguntas_a_banco: tool({
      description: 'Propone AÑADIR preguntas de opción múltiple (máx. 15) a un banco de simulacro que ya existe. No guarda: el usuario revisa y acepta.',
      inputSchema: jsonSchema<{ banco: string; preguntas: QIn[] }>({ type: 'object', properties: { banco: str, preguntas: { type: 'array', items: { type: 'object', properties: { texto: str, opciones: { type: 'array', items: str }, correcta: str, explicacion: str, tema: str }, required: ['texto', 'opciones', 'correcta'], additionalProperties: false } } }, required: ['banco', 'preguntas'], additionalProperties: false }),
      execute: run(async ({ banco, preguntas }) => {
        const f = await fileOf(ctx.vault, 'exams-bank', banco);
        if ('error' in f) return f;
        // las preguntas nuevas se validan con el mismo constructor que «crear_examen» y se reanudan tras las existentes
        const built = buildExam('x', undefined, (preguntas ?? []).slice(0, MAX_QUESTIONS));
        if (isBad(built)) return built;
        const old = parseBankMarkdown(f.text, ''), add = parseBankMarkdown(built.contenido, '').questions;
        // el serializador numera por posición: se serializa banco+nuevas y se toma solo la cola que las nuevas añaden
        const ser = (qs: typeof add) => parseFrontmatter(serializeBank({ ...old, minutes: clampMinutes(old.minutes ?? 60), questions: qs.map((q, i) => ({ ...q, n: i + 1 })) })).body;
        const head = ser(old.questions), full = ser([...old.questions, ...add]);
        if (!full.startsWith(head)) return { error: 'formato', detail: 'No se pudo numerar las preguntas nuevas.' } as Bad;
        const body = full.slice(head.length).trim();
        const next = setKeys(f.text.replace(/\s*$/, '') + '\n\n' + body + '\n', { origen: 'ia' });
        const chk = parseBankMarkdown(next, '');
        if (chk.questions.length !== old.questions.length + add.length || chk.questions.some((q) => q.problems.length)) return { error: 'formato', detail: 'El banco no queda válido con esas preguntas.' } as Bad;
        // gancho carril B: si existe src/sim/review.ts, aquí pasaría cada pregunta por su revisión una a una
        return editProposal(f.path, f.text, next, `+${add.length} → ${f.path.replace(/^exams-bank\/|\.md$/g, '')}`);
      }),
    }),
    modificar_examen: tool({
      description: 'Propone cambiar un examen con fecha ya registrado (fecha, temas, meta de retención, días de repaso final). Solo los campos que pases cambian.',
      inputSchema: jsonSchema<{ nombre: string; fecha?: string; temas?: string[]; meta_retencion?: number; dias_repaso_final?: number }>({ type: 'object', properties: { nombre: str, fecha: { ...str, description: 'AAAA-MM-DD' }, temas: { type: 'array', items: str }, meta_retencion: { type: 'number' }, dias_repaso_final: { type: 'integer' } }, required: ['nombre'], additionalProperties: false }),
      execute: run(async ({ nombre, fecha, temas, meta_retencion, dias_repaso_final }) => {
        const f = await fileOf(ctx.vault, 'exams', nombre);
        if ('error' in f) return f;
        const opts = topicOptions(ctx.col), patch: Record<string, string | number | string[] | undefined> = {};
        if (fecha !== undefined) patch.fecha = String(fecha).trim();
        if (temas !== undefined) patch.temas = [...new Set(temas.slice(0, 10).map((x) => one(x, 120)).filter(Boolean).map((x) => opts.find((o) => norm(o) === norm(x)) ?? x))];
        if (meta_retencion !== undefined) patch.meta_retencion = Number(meta_retencion);
        if (dias_repaso_final !== undefined) patch.dias_repaso_final = Number(dias_repaso_final);
        const next = setKeys(f.text, patch);
        const e = checkExamFile(next, ctx.col, ctx.today);
        if (e) return e;
        return editProposal(f.path, f.text, next, parseExam(f.path, next).name);
      }),
    }),
  };
}
