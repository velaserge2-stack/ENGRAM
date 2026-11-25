// Propuestas del Asistente: construir y validar (con los parsers reales), aplicar (solo tras «Aceptar») y deshacer.
// Nada aquí lo llama un modelo: las herramientas (tools-write.ts) solo construyen la propuesta; `applyProposal` lo llama la interfaz.
import { ensureIds, noteIdOf, parseDeck } from '../cards/parse';
import type { Collection } from '../data/collection';
import { addEvent, atMinutes, blankEvent, CAL, editOccurrence } from '../lib/calendar-edit';
import { stringifyFrontmatter } from '../lib/frontmatter';
import { fromICS, KINDS, occurrences, type EventKind, type StudyBlock, toICS } from '../lib/ics';
import type { DiagramKind } from '../diagrams/types';
import { safeSegment, trash } from '../notes/model';
import { noteStore } from '../notes/store';
import { clampMinutes, finalize, parseBankMarkdown, serializeBank, type Question } from '../sim/parse';
import type { VaultAdapter } from '../vault/types';
import { readTextOr } from '../vault/util';
import { type Act, stickyPathOk, writeAct, writes } from './actions';
import { applyDelete, safeDeleteDest } from './delete';
import { checkExamEdit, checkNoteFile, one } from './make';
import { tracked, undo, type Entry } from './undo';

export type Kind = 'tarjetas' | 'examen' | 'evento' | 'borrar' | 'nota' | 'diagrama' | 'fecha' | 'accion';
export interface EventFields { titulo: string; fecha: string; inicio: string; fin: string; materia: string; nota: string; tipo: EventKind }
export interface Proposal {
  tipo: Kind;
  /** archivo que se escribe (deck, banco o calendar/estudio.ics) */
  destino: string;
  /** tarjetas: bloques con `origen: ia` · examen: archivo completo · evento: texto legible */
  contenido: string;
  resumen: string;
  /** lo que ve el usuario, una línea por elemento (se pinta como texto, nunca como HTML) */
  items: string[];
  mazo?: string;
  /** diagrama: tipo del diagrama */
  diag?: DiagramKind;
  evento?: EventFields;
  /** modificar: la entrada y la fecha de la ocurrencia que cambia */
  op?: { uid: string; fecha: string; scope: 'one' | 'series' };
  /** borrar: qué se mueve a la papelera (siempre reversible; nunca definitivo) */
  objetivo?: 'nota' | 'mazo' | 'banco' | 'evento';
  /** borrar: huella del objetivo al proponer; si cambia antes de confirmar, `changed` */
  huella?: string;
  reversible?: true;
  /** accion: lo que hará al pulsar «Aceptar» (tareas/stickies escriben `destino`; el resto solo actúa en la interfaz) */
  accion?: Act;
  /** borrar: cifras para la tarjeta de confirmación (se traducen en la interfaz) */
  datos?: Record<string, number>;
}
export type Bad = { error: string; detail?: string };
export const isBad = (x: unknown): x is Bad => typeof x === 'object' && x !== null && 'error' in x;

// ───────── ¿pidió el usuario escribir? ─────────
// Verbo de crear/modificar Y un objeto del Asistente: «hazme un resumen» o «el programa de la materia» no abren las herramientas.
const WRITE_VERB = /\b(cre[ae]\w*|crea|genera\w*|agrega\w*|anade\w*|anota\w*|agenda(me|r)?|programa(me|r|rme)|programa\s+(un|una|el|la|mi|unos|unas)|modifica\w*|cambia\w*|mueve\w*|mover|edita\w*|reprograma\w*|haz\w*|elabora\w*|prepara\w*|create\w*|add|adds|make|generate\w*|schedule\w*|modify|change|move|reschedule|edit|write|build|cree\w*|creer|ajoute\w*|genere\w*|modifie\w*|planifie\w*|deplace\w*|fais|ecris\w*|registr\w*|register\w*|enregistre\w*)\b/;
const WRITE_OBJ = /\b(tarjetas?|flashcards?|cards?|cartes?|fiches?|examen(es)?|exams?|quiz(zes)?|banco|bancos|simulacros?|preguntas?|questions?|eventos?|events?|evenements?|citas?|recordatorios?|reminders?|rappels?|calendario|calendar|calendrier|mazos?|decks?|paquets?|repasos?|reviews?|clases?|rendez-vous|mapas? (mental|mentales|conceptual|conceptuales)|mind ?maps?|cartes? mentales?|diagramas?|diagrammes?|flowcharts?|organigramas?|schemas?|flujogramas?)\b/;
// notas y resúmenes: solo con un verbo de CREAR («hazme un resumen» es responder, no crear una nota)
const NOTE_VERB = /\b(cre[ae]\w*|genera\w*|agrega\w*|anade\w*|redacta\w*|escribe\w*|elabora\w*|prepara\w*|haz\w*|create\w*|write|add|make|generate\w*|cree\w*|ajoute\w*|ecris\w*|genere\w*|fais)\b/;
const NOTE_OBJ = /\b(notas?|apuntes?|notes?)\b/;
const SUMM_VERB = /\b(cre[ae]\w*|genera\w*|agrega\w*|anade\w*|create\w*|generate\w*|add|cree\w*|genere\w*|ajoute\w*)\b/;
const SUMM_OBJ = /\b(resumenes|resumen|summary|summaries|resume)\b/;
/** El último mensaje del usuario pide crear/modificar algo concreto (verbo + objeto, es/en/fr). Sin ella no hay herramientas de escritura. */
export function wantsWrite(text: string): boolean {
  const q = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return (WRITE_VERB.test(q) && WRITE_OBJ.test(q)) || (NOTE_VERB.test(q) && NOTE_OBJ.test(q)) || (SUMM_VERB.test(q) && SUMM_OBJ.test(q));
}

// ───────── utilidades ─────────
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const ID_END = /\s\^[A-Za-z0-9_-]{2,40}\s*$/;
export { wantsDelete, MAX_DELETES } from './delete';
export const MAX_CARDS = 30, MAX_QUESTIONS = 15, MAX_PROPOSALS = 3;

// ───────── tarjetas ─────────
/** Valida el texto de tarjetas con el parser real; cada bloque queda con `origen: ia` y sin ID (los IDs se asignan al guardar). */
export function validateCards(text: string): { contenido: string; items: string[] } | Bad {
  const d = parseDeck(text.trim());
  if (!d.notes.length) return { error: 'vacio' };
  const bad = d.notes.find((n) => n.errors.length || n.type === 'io');
  if (bad) return { error: bad.type === 'io' ? 'io' : 'formato', detail: bad.errors[0] };
  const blocks = d.notes.map((n) => n.raw.replace(ID_END, '').replace(/<!--\s*origen:[^>]*-->\s*/g, '').trimEnd() + ' <!-- origen: ia -->');
  const items = d.notes.map((n) => [n.front, n.back || n.items.join('; ') || n.pairs.map((p) => p.join(' = ')).join('; ')].filter(Boolean).join(' → '));
  return { contenido: blocks.join('\n\n'), items };
}

export function resolveDeck(col: Collection | null, name: string): { path: string; mazo: string } | Bad {
  const n = norm(name);
  const d = col?.decks.find((x) => norm(x.full) === n);
  if (d) return { path: d.path, mazo: d.full };
  const seg = safeSegment(name);
  return seg ? { path: `decks/${seg}.md`, mazo: seg } : { error: 'nombre' };
}

export interface CardIn { pregunta?: string; respuesta?: string; cloze?: string }
export function buildCards(col: Collection | null, mazo: string, cards: CardIn[], fuente?: string): Proposal | Bad {
  const dest = resolveDeck(col, String(mazo ?? ''));
  if (isBad(dest)) return dest;
  const src = fuente ? one(fuente, 300) : '';
  const blocks = (Array.isArray(cards) ? cards : []).slice(0, MAX_CARDS).flatMap((c) => {
    const q = one(c?.pregunta), a = one(c?.respuesta), cl = one(c?.cloze);
    const b = cl ? `Cloze: ${cl}` : q && a ? `Q:: ${q}\nA:: ${a}` : '';
    return b ? [b + (src ? ` <!-- src: ${src} -->` : '')] : [];
  });
  // lo que no parsea no se muestra: cada bloque se valida solo y se descartan los malos
  const good = blocks.filter((b) => { const r = validateCards(b); return !isBad(r); });
  if (!good.length) return { error: 'vacio' };
  const v = validateCards(good.join('\n\n'));
  if (isBad(v)) return v;
  return { tipo: 'tarjetas', destino: dest.path, mazo: dest.mazo, contenido: v.contenido, items: v.items, resumen: `${v.items.length} → ${dest.mazo}` };
}

// ───────── examen (banco de simulacro) ─────────
export function validateBank(text: string): { name: string; items: string[] } | Bad {
  const b = parseBankMarkdown(text, '');
  if (!b.questions.length) return { error: 'vacio' };
  const bad = b.questions.find((q) => q.problems.length);
  if (bad) return { error: 'formato', detail: `${bad.n}. ${bad.problems[0]}` };
  return { name: b.name, items: b.questions.map((q) => `${q.n}. ${q.text} → ${q.answer.join(', ')}`) };
}

export interface QIn { texto?: string; opciones?: string[]; correcta?: string | string[]; explicacion?: string; tema?: string; caso?: string }
const KEYS = ['A', 'B', 'C', 'D', 'E', 'F'];
export function buildExam(nombre: string, minutos: number | undefined, qs: QIn[]): Proposal | Bad {
  const name = one(nombre, 120), seg = safeSegment(name);
  if (!seg) return { error: 'nombre' };
  const questions: Question[] = [];
  for (const q of (Array.isArray(qs) ? qs : []).slice(0, MAX_QUESTIONS)) {
    const options = (Array.isArray(q?.opciones) ? q.opciones : []).slice(0, 6).map((o, i) => ({ key: KEYS[i]!, text: one(o, 300) }));
    const ans = (Array.isArray(q?.correcta) ? q.correcta : [q?.correcta]).map((c) => (/^\d$/.test(String(c)) ? KEYS[Number(c) - 1] : String(c ?? '').trim().toUpperCase())).filter((k): k is string => !!k);
    const f = finalize({ n: questions.length + 1, case: one(q?.caso), text: one(q?.texto), options, answer: [...new Set(ans)], explanation: one(q?.explicacion), topic: one(q?.tema, 120) });
    if (!f.problems.length && options.every((o) => o.text)) questions.push(f);
  }
  // `origen: ia` en el frontmatter: el parser ignora claves desconocidas (el editor de bancos la pierde al regrabar; ver CONTRATO)
  const contenido = serializeBank({ name, minutes: clampMinutes(minutos ?? 60), shuffle: true, questions }).replace('\n---\n', '\norigen: ia\n---\n');
  const v = validateBank(contenido); // ida y vuelta por el parser real
  if (isBad(v) || !questions.length) return isBad(v) ? v : { error: 'vacio' };
  return { tipo: 'examen', destino: `exams-bank/${seg}.md`, contenido, items: v.items, resumen: `${v.items.length} → ${name}` };
}

// ───────── calendario ─────────
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const mins = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export function validateEvent(f: Partial<EventFields>): EventFields | Bad {
  const titulo = one(f.titulo, 120), fecha = String(f.fecha ?? '').trim(), inicio = String(f.inicio ?? '').trim(), fin = String(f.fin ?? '').trim();
  if (!titulo) return { error: 'titulo' };
  if (!isDate(fecha)) return { error: 'fecha' };
  if (!HM.test(inicio) || !HM.test(fin) || mins(fin) <= mins(inicio)) return { error: 'hora' };
  const tipo = KINDS.includes(f.tipo as EventKind) ? (f.tipo as EventKind) : 'estudio';
  return { titulo, fecha, inicio, fin, materia: one(f.materia, 120), nota: one(f.nota, 500), tipo };
}
const evItems = (f: EventFields) => [`${f.titulo}`, `${f.fecha} ${f.inicio}–${f.fin}`, ...(f.materia ? [f.materia] : []), ...(f.nota ? [f.nota] : [])];
function evProposal(f: EventFields, op?: Proposal['op']): Proposal {
  const items = evItems(f);
  return { tipo: 'evento', destino: CAL, contenido: items.join('\n'), items, resumen: `${f.titulo} · ${f.fecha}`, evento: f, ...(op ? { op } : {}) };
}
export function buildEvent(f: Partial<EventFields>): Proposal | Bad {
  const v = validateEvent(f);
  return isBad(v) ? v : evProposal(v);
}
const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** Cambios a una entrada PROPIA (calendar/estudio.ics); las importadas son de solo lectura. */
export async function buildEventEdit(vault: VaultAdapter, q: { titulo?: string; fecha: string; cambios: Partial<EventFields> }): Promise<Proposal | Bad> {
  const own = fromICS(await readTextOr(vault, CAL, ''));
  const t = norm(String(q.titulo ?? '')), date = String(q.fecha ?? '');
  const hits = own.filter((b) => !b.allDay && (!t || norm(b.title).includes(t)) && (b.rrule ? true : dayOf(b.start) === date));
  const found = hits.filter((b) => occurrences(b, date, date, dayOf).length > 0);
  if (found.length !== 1) return { error: found.length ? 'varios' : 'noevento' };
  const b = found[0]!;
  const d = new Date(b.start), len = Math.round((b.end - b.start) / 60000);
  const cur: EventFields = { titulo: b.title, fecha: date, inicio: `${pad(d.getHours())}:${pad(d.getMinutes())}`, fin: '', materia: b.subject, nota: b.note, tipo: b.kind ?? 'estudio' };
  cur.fin = `${pad(Math.floor((mins(cur.inicio) + len) / 60) % 24)}:${pad((mins(cur.inicio) + len) % 60)}`;
  const c = q.cambios ?? {};
  const v = validateEvent({ ...cur, ...Object.fromEntries(Object.entries(c).filter(([, x]) => x !== undefined && x !== '')) });
  if (isBad(v)) return v;
  return evProposal(v, { uid: b.uid, fecha: date, scope: b.rrule ? 'one' : 'series' });
}

// ───────── revalidar tras «Editar» ─────────
export function revalidate(p: Proposal, edit: { contenido?: string; evento?: Partial<EventFields> }, env?: { col: Collection | null; today: string }): Proposal | Bad {
  if (p.tipo === 'accion') return p; // sin «Editar»
  if (p.tipo === 'nota' || p.tipo === 'diagrama') {
    const v = checkNoteFile(edit.contenido ?? p.contenido, p.tipo, p.diag);
    return isBad(v) ? v : { ...p, contenido: v.contenido };
  }
  if (p.tipo === 'fecha') {
    const v = checkExamEdit(edit.contenido ?? p.contenido, env?.col ?? null, env?.today ?? '0000-00-00');
    return isBad(v) ? v : { ...p, ...v, resumen: `${v.items[0]} · ${v.items[1]}` };
  }
  if (p.tipo === 'tarjetas') {
    const v = validateCards(edit.contenido ?? p.contenido);
    return isBad(v) ? v : { ...p, contenido: v.contenido, items: v.items, resumen: `${v.items.length} → ${p.mazo}` };
  }
  if (p.tipo === 'examen') {
    const text = edit.contenido ?? p.contenido, v = validateBank(text);
    return isBad(v) ? v : { ...p, contenido: text, items: v.items, resumen: `${v.items.length} → ${v.name}` };
  }
  const v = validateEvent({ ...p.evento, ...edit.evento });
  return isBad(v) ? v : { ...evProposal(v, p.op) };
}

// ───────── aplicar y deshacer (solo la interfaz, tras «Aceptar») ─────────
const OKPATH: Record<Exclude<Kind, 'borrar'>, [string, RegExp]> = { tarjetas: ['decks', /\.md$/], examen: ['exams-bank', /\.md$/], evento: ['calendar', /\.ics$/], nota: ['notes', /\.md$/], diagrama: ['notes', /\.md$/], fecha: ['exams', /\.md$/], accion: ['notes', /\.md$/] };
const safeDest = (p: Proposal) => { if (p.tipo === 'borrar') return safeDeleteDest(p); if (p.tipo === 'accion') return !!p.accion && (!writes(p.accion) ? !p.destino : p.accion.k === 'tarea' ? p.destino === 'notes/Tareas.md' : stickyPathOk(p.destino)); const [pre, re] = OKPATH[p.tipo]; return p.destino.startsWith(pre + '/') && re.test(p.destino) && p.destino.split('/').every((s) => s !== '' && s !== '.' && s !== '..') && !/[\\\u0000-\u001f]/.test(p.destino) && (p.tipo !== 'evento' || p.destino === CAL) && (p.tipo !== 'fecha' || p.destino.split('/').length === 2) && p.destino.length <= 400; };
const inflight = new Map<number, Promise<Entry[]>>();
const groups = new Map<number, Entry[]>();
const restorers = new Map<number, () => Promise<void>>(); // borrar: restaurar desde la papelera

async function write(vault: VaultAdapter, col: Collection | null, p: Proposal, w: (path: string, text: string) => Promise<void>): Promise<void> {
  if (p.tipo === 'tarjetas') {
    const cur = (await vault.exists(p.destino)) ? await readTextOr(vault, p.destino, '') : '';
    if (cur && noteStore.peek(p.destino) !== null) throw new Error('open'); // abierto en el editor: no se pisa
    const base = cur.trim() ? cur : stringifyFrontmatter({ deck: p.mazo ?? '', tags: [] }, '\n'); // vacío (lo dejó «Deshacer») = nuevo
    const taken = new Set<string>(col ? [...col.byCid.keys(), ...col.log.map((e) => e.id)].map(noteIdOf) : []);
    for (const n of parseDeck(base).notes) if (n.id) taken.add(n.id);
    await w(p.destino, `${base.replace(/\s*$/, '')}\n\n${ensureIds(p.contenido.trim(), taken).text}\n`);
  } else if (p.tipo === 'nota' || p.tipo === 'diagrama' || p.tipo === 'fecha') {
    if (await vault.exists(p.destino)) throw new Error('exists'); // nunca se sobrescribe
    await w(p.destino, p.contenido);
  } else if (p.tipo === 'accion') {
    await writeAct(vault, p.destino, p.accion!, p.contenido, w);
  } else if (p.tipo === 'examen') {
    if ((await readTextOr(vault, p.destino, '')).trim()) throw new Error('exists'); // nunca se sobrescribe un banco (uno vacío, dejado por «Deshacer», cuenta como libre)
    await w(p.destino, p.contenido);
  } else {
    const own = fromICS(await readTextOr(vault, CAL, ''));
    const f = p.evento!;
    let list: StudyBlock[];
    if (p.op) {
      const b = own.find((x) => x.uid === p.op!.uid);
      if (!b) throw new Error('gone');
      const next = { ...b, title: f.titulo, subject: f.materia, note: f.nota, kind: f.tipo, start: atMinutes(f.fecha, mins(f.inicio)), end: atMinutes(f.fecha, mins(f.fin)) };
      list = editOccurrence(own, b.uid, p.op.fecha, next, p.op.scope);
    } else {
      list = addEvent(own, { ...blankEvent(f.fecha, mins(f.inicio), mins(f.fin)), title: f.titulo, subject: f.materia, note: f.nota, kind: f.tipo });
    }
    await w(CAL, toICS(list));
  }
}

/** Deshacer de un archivo NUEVO (nota, diagrama, examen con fecha): si sigue tal cual se escribió, las notas van a la papelera de notas
 *  (se pueden restaurar) y el examen se quita (un examen vacío estorbaría en Exámenes). Si cambió, `changed`. */
async function removeNew(vault: VaultAdapter, p: Proposal): Promise<void> {
  if (!(await vault.exists(p.destino))) throw new Error('gone');
  if ((await readTextOr(vault, p.destino, '')) !== p.contenido) throw new Error('changed');
  if (p.tipo === 'fecha') { await vault.remove(p.destino); return; }
  if (noteStore.listening(p.destino)) throw new Error('open'); // abierta en un panel: no se mueve
  await trash(vault, p.destino);
  await noteStore.forget(p.destino);
}

// Una sola cola para aplicar y deshacer: dos propuestas sobre el mismo mazo o el .ics no se pisan, y deshacer espera a aceptar.
let chain: Promise<unknown> = Promise.resolve();
const serial = <T,>(fn: () => Promise<T>): Promise<T> => { const r = chain.then(fn); chain = r.catch(() => undefined); return r; };

/** Escribe la propuesta por el vault (SafeVault en la app). Idempotente por `id`: un segundo llamado no escribe otra vez. Si falla, no queda nada escrito. */
export function applyProposal(vault: VaultAdapter, col: Collection | null, p: Proposal, id: number): Promise<Entry[]> {
  const prev = inflight.get(id);
  if (prev) return prev;
  if (!safeDest(p)) return Promise.reject(new Error('path'));
  const run = serial(() => tracked(vault, async (w) => { if (p.tipo === 'borrar') { const a = await applyDelete(vault, col, p, w); if (p.objetivo !== 'evento') restorers.set(id, a.restore); } else { await write(vault, col, p, w); if (p.tipo === 'nota' || p.tipo === 'diagrama' || p.tipo === 'fecha') restorers.set(id, () => removeNew(vault, p)); else if (p.tipo === 'accion' && p.accion?.k === 'sticky' && p.accion.op.op === 'new') restorers.set(id, () => removeNew(vault, p)); } })).then((g) => (groups.set(id, g), g), (e) => (inflight.delete(id), Promise.reject(e)));
  inflight.set(id, run);
  return run;
}

/** Restaura el «antes» de lo que escribió `id`. Un archivo que era nuevo queda vacío (no se borra). Si el archivo cambió después, lanza `changed`. */
export function undoProposal(vault: VaultAdapter, id: number): Promise<{ emptied: string[] }> {
  return serial(async () => {
    const g = groups.get(id), rs = restorers.get(id);
    if (!g) return { emptied: [] };
    if (rs) { await rs(); restorers.delete(id); groups.delete(id); return { emptied: [] }; }
    const r = await undo(vault, g);
    groups.delete(id);
    return r;
  });
}
export const forgetProposals = (): void => { inflight.clear(); groups.clear(); restorers.clear(); };
