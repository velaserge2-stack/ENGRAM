// Roles del Asistente: system + lista blanca de herramientas + escritura. Lógica pura (sin `ai`); turn.ts la aplica.
import { SYSTEM, SYSTEM_CONVERT, SYSTEM_APP, SYSTEM_EDIT, SYSTEM_DELETE, SYSTEM_LEVEL, SYSTEM_SOCRATIC, SYSTEM_WRITE, SYSTEM_CTX } from './system';

export type RoleId = 'tutor' | 'examinador' | 'investigador' | 'creador' | 'analista';
export type Level = '' | keyof typeof SYSTEM_LEVEL;
export const ROLE_IDS: readonly RoleId[] = ['tutor', 'examinador', 'investigador', 'creador', 'analista'];
export const LEVELS: readonly Level[] = ['', 'basica', 'intermedia', 'avanzada', 'clinica'];

import { SYSTEM_ANALISTA, SYSTEM_EXAMINADOR } from './roles-analyst';

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
  examinador: { system: SYSTEM_EXAMINADOR, tools: READ_TOOLS, writes: 'off', deletes: false, exam: false },
  investigador: { system: 'Role RESEARCHER: read-only. Every factual statement MUST carry a citation from this turn\'s tools; a statement you cannot source is not written (say what is missing instead). Compare sources when they differ. You never create or change anything.', tools: READ_TOOLS, writes: 'off', deletes: false, exam: false },
  creador: { system: 'Role CREATOR: the user wants study material built from their sources (cards, questions, notes, diagrams). Read first, then propose it with the creation tools; every proposal needs the user\'s approval.', tools: null, writes: 'force', deletes: false, exam: true },
  analista: { system: SYSTEM_ANALISTA, tools: [...READ_TOOLS, 'agregar_evento', 'modificar_evento', 'crear_nota', 'registrar_examen'], writes: 'auto', deletes: false, exam: false },
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
export function composeSystem(prefs: Prefs, o: { writes: boolean; dels: boolean; convert: boolean; ctx?: { label: string; body: string } | null; app?: boolean }): string {
  return [SYSTEM, ROLES[prefs.role].system, prefs.socratic && SYSTEM_SOCRATIC, prefs.level && SYSTEM_LEVEL[prefs.level], o.writes && SYSTEM_WRITE, o.writes && SYSTEM_EDIT, o.app && SYSTEM_APP, o.convert && SYSTEM_CONVERT, o.dels && SYSTEM_DELETE, o.ctx && SYSTEM_CTX].filter(Boolean).join(' ');
}

/** Escritura «pegajosa»: SOLO un «sí / hazlo / dale» exacto (≤ 3 palabras) cuando el último mensaje del asistente es una pregunta que ofrece crear o editar. */
const YES = /^(si|si claro|dale|hazlo|hazla|ok|okay|adelante|va|yes|do it|go ahead|oui)[.!\s]*$/;
const OFFER = /\b(crear|creo|cre[ae]r?|proponer|propongo|editar|edito|agregar|anadir|anado|etiquetar|etiquete|modificar|modifico|create|propose|edit|tag|proposer|creer|modifier|ajouter)\b/;
export function stickyWrite(q: string, prev: { assistant?: string; proposed?: boolean }): boolean {
  const n = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  const u = n(q), a = n(prev.assistant ?? '');
  return u.split(/\s+/).length <= 3 && YES.test(u) && a.endsWith('?') && OFFER.test(a);
}

type Group = 'nota' | 'tarjeta' | 'examen' | 'evento' | 'ajuste';
export const TOOL_GROUP: Record<string, Group> = { crear_nota: 'nota', crear_diagrama: 'nota', anadir_a_nota: 'nota', editar_nota: 'nota', etiquetar_nota: 'nota', crear_tarjetas: 'tarjeta', listar_ajustes: 'ajuste', cambiar_ajuste: 'ajuste', editar_tarjeta: 'tarjeta', crear_examen: 'examen', anadir_preguntas_a_banco: 'examen', registrar_examen: 'examen', modificar_examen: 'examen', agregar_evento: 'evento', modificar_evento: 'evento' };
/** Qué objetos nombra el mensaje (sirve para ofrecer solo ese subconjunto de esquemas cuando el presupuesto es pequeño, p. ej. Groq). */
export function groupsOf(q: string): Set<Group> {
  const u = q.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase(), g = new Set<Group>();
  if (/\b(notas?|apuntes?|notes?|tags?|etiquetas?|encabezados?|diagramas?|mapas?|resumen\w*)\b/.test(u)) g.add('nota');
  if (/\b(tarjetas?|cards?|flashcards?|cartes?|mazos?|decks?|cloze)\b/.test(u)) g.add('tarjeta');
  if (/\b(examen(es)?|exams?|bancos?|simulacros?|preguntas?|questions?|quiz)\b/.test(u)) g.add('examen');
  if (/\b(ajustes?|settings?|pomodoro|pomo|tema|oscuro|claro|idioma|language|langue|acento|fondo|color|volumen|sonido|musica|vidrio|add-?ons?|extensi\w+|nuevas|configur\w+|preferencias?|volumen|desenfoque)\b/.test(u)) g.add('ajuste');
  if (/\b(eventos?|events?|calendario|calendar|citas?|clases?|horario)\b/.test(u)) g.add('evento');
  return g;
}
/** Herramientas de escritura que se ofrecen: solo las de los objetos mencionados (sin mención, todas menos las de ajustes). `_small` ya no se usa (siempre filtra). */
export function writeSubset<T extends Record<string, unknown>>(tools: T, q: string, _small = true): Partial<T> {
  const g = groupsOf(q);
  // ajustes de la app: solo si el mensaje los nombra; el resto: los objetos mencionados (sin mención, todos)
  return Object.fromEntries(Object.entries(tools).filter(([k]) => { const grp = TOOL_GROUP[k]; return !grp || (grp === 'ajuste' ? g.has('ajuste') : !g.size || g.has(grp)); })) as Partial<T>;
}
