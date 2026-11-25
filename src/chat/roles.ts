// Roles del Asistente: system + lista blanca de herramientas + escritura. Lógica pura (sin `ai`); turn.ts la aplica.
import { SYSTEM, SYSTEM_CONVERT, SYSTEM_EDIT, SYSTEM_DELETE, SYSTEM_LEVEL, SYSTEM_SOCRATIC, SYSTEM_WRITE, ctxSystem } from './system';

export type RoleId = 'tutor' | 'examinador' | 'investigador' | 'creador' | 'analista';
export type Level = '' | keyof typeof SYSTEM_LEVEL;
export const ROLE_IDS: readonly RoleId[] = ['tutor', 'examinador', 'investigador', 'creador', 'analista'];
export const LEVELS: readonly Level[] = ['', 'basica', 'intermedia', 'avanzada', 'clinica'];

export const READ_TOOLS = ['buscar_notas', 'leer_nota', 'leer_pdf', 'listar_mazos', 'leer_mazo', 'listar_examenes', 'ver_calendario'] as const;
export interface Role {
  system: string;
  /** herramientas permitidas (lectura y escritura); `null` = todas */
  tools: readonly string[] | null;
  /** auto: solo si el mensaje lo pide (`wantsWrite`); force: siempre; off: nunca */
  writes: 'auto' | 'force' | 'off';
  deletes: boolean;
  /** ¿recibe las herramientas del carril de exámenes (tools-exam.ts) si existen? */
  exam: boolean;
}
export const ROLES: Record<RoleId, Role> = {
  tutor: { system: '', tools: null, writes: 'auto', deletes: true, exam: true },
  examinador: { system: 'Role EXAMINER: quiz the user. Ask ONE question at a time (based on their notes/decks), wait for the answer, then evaluate it (correct / partial / wrong, with a one-line why) before asking the next. Never reveal the solution before the user answers or gives up. You never create or change anything.', tools: READ_TOOLS, writes: 'off', deletes: false, exam: false },
  investigador: { system: 'Role RESEARCHER: read-only. Every factual statement MUST carry a citation from this turn\'s tools; a statement you cannot source is not written (say what is missing instead). Compare sources when they differ. You never create or change anything.', tools: READ_TOOLS, writes: 'off', deletes: false, exam: false },
  creador: { system: 'Role CREATOR: the user wants study material built from their sources (cards, questions, notes, diagrams). Read first, then propose it with the creation tools; every proposal needs the user\'s approval.', tools: null, writes: 'force', deletes: false, exam: true },
  analista: { system: 'Role ANALYST: read decks, exams and the calendar, find weak spots and propose what to review and when. Propose reviews as calendar events or a note; never invent numbers: use only what tools returned.', tools: [...READ_TOOLS, 'agregar_evento', 'modificar_evento', 'crear_nota', 'registrar_examen'], writes: 'auto', deletes: false, exam: false },
};

export interface Prefs { role: RoleId; socratic: boolean; level: Level }
export const DEFAULT_PREFS: Prefs = { role: 'tutor', socratic: false, level: '' };
export function normPrefs(raw: unknown): Prefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Prefs, unknown>>;
  return { role: ROLE_IDS.includes(r.role as RoleId) ? (r.role as RoleId) : 'tutor', socratic: r.socratic === true, level: LEVELS.includes(r.level as Level) ? (r.level as Level) : '' };
}
const KEY = 'engrama.chat.prefs'; // por dispositivo; no toca settings.json
export function loadPrefs(): Prefs {
  try { return normPrefs(JSON.parse(('localStorage' in globalThis && localStorage.getItem(KEY)) || 'null')); } catch { return DEFAULT_PREFS; }
}
export function savePrefs(p: Prefs): void { try { if ('localStorage' in globalThis) localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* sin almacenamiento */ } }

/** ¿Pide convertir una clase/fuente completa en material? (activa convertir_clase fuera del rol Creador.) */
export const wantsConvert = (text: string): boolean => /\b(clase|lecture|class|cours|temario|syllabus)\b/i.test(text.normalize('NFD').replace(/\p{M}/gu, ''));

/** Qué se habilita en este turno según rol, mensaje y botones internos (`force`). */
export function plan(id: RoleId, o: { wantsWrite: boolean; wantsDelete: boolean; wantsConvert: boolean; force?: boolean }) {
  const role = ROLES[id];
  const writes = role.writes === 'off' ? false : role.writes === 'force' || o.wantsWrite || !!o.force;
  return { writes, dels: role.deletes && o.wantsDelete, convert: writes && role.tools === null && (id === 'creador' || o.wantsConvert || !!o.force) };
}

/** Lista blanca del rol sobre un juego de herramientas ya construido. */
export function filterTools<T extends Record<string, unknown>>(tools: T, id: RoleId): Partial<T> {
  const allow = ROLES[id].tools;
  return allow ? (Object.fromEntries(Object.entries(tools).filter(([k]) => allow.includes(k))) as Partial<T>) : tools;
}

/** Prompt de sistema del turno. Con prefs por defecto y sin contexto da exactamente el de siempre. */
export function composeSystem(prefs: Prefs, o: { writes: boolean; dels: boolean; convert: boolean; ctx?: { label: string; body: string } | null }): string {
  return [SYSTEM, ROLES[prefs.role].system, prefs.socratic && SYSTEM_SOCRATIC, prefs.level && SYSTEM_LEVEL[prefs.level], o.writes && SYSTEM_WRITE, o.writes && SYSTEM_EDIT, o.convert && SYSTEM_CONVERT, o.dels && SYSTEM_DELETE, o.ctx && ctxSystem(o.ctx.label, o.ctx.body)].filter(Boolean).join(' ');
}

/** Escritura «pegajosa»: un «sí / hazlo / dale» corto tras una oferta de crear o editar (o tras una propuesta) mantiene las herramientas. */
const YES = /^\s*(si|yes|yep|ok|okay|dale|hazlo|hazla|adelante|claro|va|venga|vale|perfecto|por favor|tambien|ademas|also|go ahead|do it|sure|oui|d'accord|vas-y|fais-le)\b/;
const OFFER = /\b(crear|creo|creare|hacer|hago|hacerlo|proponer|propongo|editar|edito|agregar|anadir|anado|etiquetar|modificar|modifico|cambiar|create|propose|edit|add|tag|change|modify|proposer|creer|modifier|ajouter)\b/;
export function stickyWrite(q: string, prev: { assistant?: string; proposed: boolean }): boolean {
  const n = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const u = n(q);
  if (u.trim().split(/\s+/).length > 6 || !YES.test(u)) return false;
  return prev.proposed || (!!prev.assistant && OFFER.test(n(prev.assistant)));
}

type Group = 'nota' | 'tarjeta' | 'examen' | 'evento';
export const TOOL_GROUP: Record<string, Group> = { crear_nota: 'nota', crear_diagrama: 'nota', anadir_a_nota: 'nota', editar_nota: 'nota', etiquetar_nota: 'nota', crear_tarjetas: 'tarjeta', editar_tarjeta: 'tarjeta', crear_examen: 'examen', anadir_preguntas_a_banco: 'examen', registrar_examen: 'examen', modificar_examen: 'examen', agregar_evento: 'evento', modificar_evento: 'evento' };
/** Qué objetos nombra el mensaje (sirve para ofrecer solo ese subconjunto de esquemas cuando el presupuesto es pequeño, p. ej. Groq). */
export function groupsOf(q: string): Set<Group> {
  const u = q.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase(), g = new Set<Group>();
  if (/\b(notas?|apuntes?|notes?|tags?|etiquetas?|encabezados?|diagramas?|mapas?|resumen\w*)\b/.test(u)) g.add('nota');
  if (/\b(tarjetas?|cards?|flashcards?|cartes?|mazos?|decks?|cloze)\b/.test(u)) g.add('tarjeta');
  if (/\b(examen(es)?|exams?|bancos?|simulacros?|preguntas?|questions?|quiz)\b/.test(u)) g.add('examen');
  if (/\b(eventos?|events?|calendario|calendar|citas?|clases?|horario)\b/.test(u)) g.add('evento');
  return g;
}
/** Herramientas de escritura que se ofrecen: todas, o con presupuesto pequeño (`small`) solo las de los objetos mencionados (sin mención, todas). */
export function writeSubset<T extends Record<string, unknown>>(tools: T, q: string, small: boolean): Partial<T> {
  const g = groupsOf(q);
  if (!small || !g.size) return tools;
  return Object.fromEntries(Object.entries(tools).filter(([k]) => !TOOL_GROUP[k] || g.has(TOOL_GROUP[k]!))) as Partial<T>;
}
