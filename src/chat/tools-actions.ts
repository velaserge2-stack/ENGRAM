// Herramientas de ACCIÓN del Asistente (carril Acciones): temporizador, sonido ambiente, navegar, estudiar, Tareas y Stickies.
// Igual que las de escritura, SOLO PROPONEN (vista previa + «Aceptar»); lo que cambia archivos (tareas, stickies) se puede deshacer
// y se recalcula sobre el texto actual al aceptar. Navegar y el temporizador no escriben nada. Nada borra. Sin red.
// El cableado en turn.ts lo hace el integrador: `makeActionTools(ctx)` con un `WriteCtx` + `addon` y `allowed: () => wantsAction(q)`.
import { jsonSchema, tool, type ToolSet } from 'ai';
import { t } from '../i18n';
import { SOUNDS, type SoundId } from '../lib/noise';
import { newStickyPath, parseSticky, STICKY_COLORS, STICKY_DIR, stickyTitle } from '../stickies/model';
import { parseTasks, TASKS_PATH } from '../tasks/parse';
import { readTextOr, walk } from '../vault/util';
import { applySticky, applyTask, newStickyText, type Act, type StickyOp, writes } from './actions';
import { one } from './make';
import { MAX_PROPOSALS, isBad, type Bad, type Proposal } from './proposal';
import type { WriteCtx } from './tools-write';

export interface ActionCtx extends WriteCtx {
  /** ¿el add-on está encendido? (`tasks`, `sticky-notes`, `ambient`) */
  addon: (id: string) => boolean;
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const str = { type: 'string' } as const;
const NO = { error: 'El usuario no pidió ninguna acción: no se propone nada.' };

export { wantsAction } from './actions';

// ───────── secciones ─────────
const SECTIONS: Record<string, { ruta: string[]; label: string; alias: string[] }> = {
  hoy: { ruta: [], label: 'acc2.s_hoy', alias: ['today', 'inicio', 'home', 'accueil', 'aujourd'] },
  mazos: { ruta: ['mazos'], label: 'acc2.s_mazos', alias: ['decks', 'paquets', 'tarjetas'] },
  estudiar: { ruta: ['estudiar'], label: 'acc2.s_estudiar', alias: ['study', 'repasar', 'repaso', 'etudier'] },
  notas: { ruta: ['notas'], label: 'acc2.s_notas', alias: ['notes', 'apuntes'] },
  simulacros: { ruta: ['simulacros'], label: 'acc2.s_simulacros', alias: ['examenes', 'exams', 'mock', 'simulations'] },
  calendario: { ruta: ['calendario'], label: 'acc2.s_calendario', alias: ['calendar', 'calendrier'] },
  estadisticas: { ruta: ['estadisticas'], label: 'acc2.s_estadisticas', alias: ['stats', 'statistics', 'statistiques'] },
  explorar: { ruta: ['explorar'], label: 'acc2.s_explorar', alias: ['buscar', 'search', 'explore'] },
  espacios: { ruta: ['espacios'], label: 'acc2.s_espacios', alias: ['spaces', 'lienzo', 'canvas'] },
  pdfs: { ruta: ['pdfs'], label: 'acc2.s_pdfs', alias: ['pdf', 'biblioteca', 'library'] },
  perfil: { ruta: ['perfil'], label: 'acc2.s_perfil', alias: ['profile', 'profil'] },
  ajustes: { ruta: ['ajustes'], label: 'acc2.s_ajustes', alias: ['settings', 'configuracion', 'reglages'] },
  bandeja: { ruta: ['bandeja'], label: 'acc2.s_bandeja', alias: ['inbox'] },
};
export const SECTION_IDS = Object.keys(SECTIONS);
export function sectionOf(name: string): string | null {
  const n = norm(name).replace(/^#?\//, '');
  return SECTION_IDS.find((k) => k === n || SECTIONS[k]!.alias.includes(n)) ?? null;
}

const ok = (a: Act, destino: string, contenido: string, resumen: string, items: string[]): Proposal => ({ tipo: 'accion', destino, contenido, resumen, items, accion: a });
const list = (xs: string[], n = 12) => xs.slice(0, n).join(' · ') + (xs.length > n ? ' …' : '');
const off = (name: string): Bad => ({ error: 'addon', detail: name });

// ───────── constructores (puros; los prueban tests/chat-acciones2*.test.ts) ─────────
export function buildPomo(a: { accion?: string; minutos?: number; etiqueta?: string }): Proposal | Bad {
  const op = a.accion as 'iniciar' | 'pausar' | 'detener';
  if (!['iniciar', 'pausar', 'detener'].includes(op)) return { error: 'accion', detail: 'iniciar | pausar | detener' };
  const min = a.minutos === undefined ? undefined : Math.round(Number(a.minutos));
  if (min !== undefined && (!(min >= 1) || min > 180)) return { error: 'minutos', detail: '1–180' };
  if (min !== undefined && op !== 'iniciar') return { error: 'minutos', detail: 'solo al iniciar' };
  const label = one(a.etiqueta, 80);
  const act: Act = { k: 'pomo', op, ...(min ? { min } : {}), ...(label ? { label } : {}) };
  const head = t(op === 'iniciar' ? (min ? 'acc2.pomo_iniciar_min' : 'acc2.pomo_iniciar') : op === 'pausar' ? 'acc2.pomo_pausar' : 'acc2.pomo_detener', { min: min ?? 0 });
  return ok(act, '', '', head, [head, ...(label ? [t('acc2.pomo_etq', { l: label })] : [])]);
}

const SOUND_ALIAS: Record<string, SoundId> = { lluvia: 'rain', viento: 'wind', olas: 'waves', mar: 'waves', ventilador: 'fan', blanco: 'white', 'ruido blanco': 'white', rosa: 'pink', 'ruido rosa': 'pink', cafe: 'brown', marron: 'brown', 'ruido marron': 'brown', pluie: 'rain', vent: 'wind', vagues: 'waves', ventilateur: 'fan' };
const soundOf = (s: string): SoundId | null => { const n = norm(s); return (SOUNDS as string[]).includes(n) ? (n as SoundId) : SOUND_ALIAS[n] ?? null; };
export function buildSound(on: boolean, a: { accion?: string; sonidos?: string[]; volumen?: number }): Proposal | Bad {
  if (!on) return off('ambient');
  const op = a.accion as 'encender' | 'apagar';
  if (!['encender', 'apagar'].includes(op)) return { error: 'accion', detail: 'encender | apagar' };
  const vol = a.volumen === undefined ? undefined : Number(a.volumen);
  if (vol !== undefined && !(vol >= 0 && vol <= 100)) return { error: 'volumen', detail: '0–100' };
  let levels: Partial<Record<SoundId, number>> | undefined;
  if (a.sonidos?.length) {
    if (op === 'apagar') return { error: 'sonidos', detail: 'solo al encender' };
    levels = {};
    for (const s of a.sonidos.slice(0, SOUNDS.length)) {
      const id = soundOf(String(s));
      if (!id) return { error: 'sonido', detail: `«${one(s, 40)}» no existe. Disponibles: ${[...SOUNDS, ...Object.keys(SOUND_ALIAS)].join(', ')}` };
      levels[id] = 0.6;
    }
  }
  const act: Act = { k: 'sonido', op, ...(levels ? { levels } : {}), ...(vol !== undefined ? { vol: vol / 100 } : {}) };
  const head = t(op === 'encender' ? 'acc2.son_enc' : 'acc2.son_apa');
  return ok(act, '', '', head, [head, ...(levels ? [t('acc2.son_lista', { l: Object.keys(levels).join(', ') })] : []), ...(vol !== undefined ? [t('acc2.son_vol', { v: Math.round(vol) })] : [])]);
}

export function buildGo(inboxOn: boolean, a: { seccion?: string }): Proposal | Bad {
  const id = sectionOf(String(a.seccion ?? ''));
  if (!id) return { error: 'seccion', detail: `No existe. Secciones: ${SECTION_IDS.join(', ')}` };
  if (id === 'bandeja' && !inboxOn) return off('inbox');
  const s = SECTIONS[id]!, head = t('acc2.ir', { s: t(s.label) });
  return ok({ k: 'ir', ruta: s.ruta }, '', '', head, [head]);
}

/** `mazo`: nombre de un mazo, de una carpeta o `tag:x`. Resuelve a lo que entiende la pantalla Estudiar. */
export function buildStudy(col: { decks: { full: string; path: string; folder: string; tags: string[] }[] } | null, mazo: string): Proposal | Bad {
  const n = norm(String(mazo ?? '')), decks = col?.decks ?? [];
  let f: string | null = null, name = '';
  if (!n) return { error: 'mazo', detail: 'Indica un mazo o carpeta.' };
  const d = decks.find((x) => norm(x.full) === n || norm(x.full.split('/').pop()!) === n);
  const folder = decks.find((x) => x.folder && norm(x.folder) === n);
  if (n.startsWith('tag:')) { if (decks.some((x) => x.tags.some((g) => norm(g) === n.slice(4) || norm(g).startsWith(n.slice(4) + '/')))) { f = `tag:${n.slice(4)}`; name = n; } }
  else if (d) { f = d.path; name = d.full; }
  else if (folder) { f = `decks/${folder.folder}/`; name = folder.folder; }
  if (!f) return { error: 'mazo', detail: `No existe «${one(mazo, 60)}». Mazos: ${list(decks.map((x) => x.full))}` };
  const head = t('acc2.est', { m: name });
  return ok({ k: 'ir', ruta: ['estudiar', f] }, '', '', head, [head]);
}

export function buildTask(on: boolean, cur: string, a: { accion?: string; texto?: string; fecha?: string; antes_de?: string }): Proposal | Bad {
  if (!on) return off('tasks');
  const op = a.accion, text = one(a.texto, 200);
  if (!['crear', 'completar', 'mover'].includes(String(op))) return { error: 'accion', detail: 'crear | completar | mover' };
  if (!text) return { error: 'texto' };
  const pending = parseTasks(cur).filter((x) => !x.done).map((x) => x.text);
  const find = (q: string, pool: string[]): string | Bad => {
    const hits = pool.filter((x) => norm(x) === norm(q));
    const part = hits.length ? hits : pool.filter((x) => norm(x).includes(norm(q)));
    return part.length === 1 ? part[0]! : { error: part.length ? 'varias' : 'tarea', detail: `«${one(q, 60)}»: ${part.length ? 'varias coinciden' : 'no existe'}. Tareas pendientes: ${list(pending) || '(ninguna)'}` };
  };
  let o: Parameters<typeof applyTask>[1];
  if (op === 'crear') {
    const due = a.fecha ? String(a.fecha).trim() : null;
    if (due !== null && !(/^\d{4}-\d{2}-\d{2}$/.test(due) && !Number.isNaN(Date.parse(due)))) return { error: 'fecha', detail: 'AAAA-MM-DD' };
    o = { op: 'add', text, due };
  } else {
    const x = find(text, pending);
    if (isBad(x)) return x;
    if (op === 'completar') o = { op: 'done', text: x };
    else {
      const y = find(one(a.antes_de, 200), parseTasks(cur).map((z) => z.text));
      if (isBad(y)) return y;
      o = { op: 'move', text: x, before: y };
    }
  }
  const next = applyTask(cur, o);
  if (next === null) return { error: 'orden', detail: 'No se puede mover ahí (solo entre tareas contiguas del mismo nivel).' };
  const head = t(o.op === 'add' ? 'acc2.tarea_add' : o.op === 'done' ? 'acc2.tarea_done' : 'acc2.tarea_move', { x: o.text, y: o.op === 'move' ? o.before : '' });
  return ok({ k: 'tarea', op: o }, TASKS_PATH, next, head, [head, ...(o.op === 'add' && o.due ? [t('acc2.tarea_due', { d: o.due })] : [])]);
}

// eslint-disable-next-line no-control-regex
const body = (s: unknown) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/<!--|-->/g, '').trim().slice(0, 2000);
export interface StickyIn { accion?: string; texto?: string; agregar?: string; nombre?: string; color?: string; fijada?: boolean; archivada?: boolean }
/** `files`: los stickies existentes (ruta + texto). */
export function buildSticky(on: boolean, files: { path: string; text: string }[], a: StickyIn, now = Date.now()): Proposal | Bad {
  if (!on) return off('sticky-notes');
  const color = a.color === undefined ? undefined : norm(a.color) === 'ninguno' || a.color === '' ? null : norm(a.color);
  if (color && !(STICKY_COLORS as readonly string[]).includes(color)) return { error: 'color', detail: `Colores: ${STICKY_COLORS.join(', ')}` };
  if (a.accion === 'crear') {
    const b = body(a.texto);
    if (!b) return { error: 'texto' };
    const taken = new Set(files.map((f) => f.path)), path = newStickyPath(now, (p) => taken.has(p));
    const order = Math.max(0, ...files.map((f) => parseSticky(f.path, f.text).order)) + 10;
    const o: StickyOp = { op: 'new', body: b, color: color ?? null, pinned: a.fijada === true };
    const head = t('acc2.st_new');
    return ok({ k: 'sticky', op: o }, path, newStickyText(o, order), head, [head, ...b.split('\n').slice(0, 6)]);
  }
  if (a.accion !== 'editar') return { error: 'accion', detail: 'crear | editar' };
  const stk = files.map((f) => ({ ...f, title: stickyTitle(parseSticky(f.path, f.text).body, f.path) }));
  const q = norm(String(a.nombre ?? ''));
  const hits = stk.filter((s) => q && (norm(s.title) === q || norm(s.path) === q));
  const part = hits.length ? hits : stk.filter((s) => q && norm(s.title).includes(q));
  if (part.length !== 1) return { error: part.length ? 'varios' : 'sticky', detail: `${part.length ? 'Varios coinciden' : 'No existe'}. Stickies: ${list(stk.map((s) => s.title)) || '(ninguno)'}` };
  const s = part[0]!;
  const o: Extract<StickyOp, { op: 'edit' }> = { op: 'edit', ...(a.texto !== undefined ? { body: body(a.texto) } : {}), ...(a.agregar ? { append: body(a.agregar) } : {}), ...(color !== undefined ? { color } : {}), ...(a.fijada !== undefined ? { pinned: a.fijada } : {}), ...(a.archivada !== undefined ? { archived: a.archivada } : {}) };
  if (Object.keys(o).length === 1) return { error: 'cambios', detail: 'Indica qué cambiar (texto, agregar, color, fijada, archivada).' };
  if (o.body === '') return { error: 'texto', detail: 'Un sticky vacío no se propone; no se borra nada.' };
  const next = applySticky(s.path, s.text, o), head = t('acc2.st_edit', { n: s.title });
  return ok({ k: 'sticky', op: o }, s.path, next, head, [head, ...(o.body ?? o.append ?? '').split('\n').slice(0, 6).filter(Boolean)]);
}

// ───────── herramientas ─────────
export function makeActionTools(ctx: ActionCtx): ToolSet {
  let n = 0;
  const out = (p: Proposal | Bad) => {
    if (isBad(p)) {
      if (p.error === 'addon') return { error: `El add-on «${p.detail}» está apagado: no se propone nada. Dile al usuario que lo encienda en Ajustes > Add-ons.` };
      return { error: `No válido (${p.error}${p.detail ? ': ' + p.detail : ''}). Corrige y vuelve a intentar, o díselo al usuario.` };
    }
    if (n >= MAX_PROPOSALS) return { error: `Límite alcanzado: ya hay ${MAX_PROPOSALS} propuestas en este turno. No propongas más.` };
    n++;
    ctx.propose(p);
    return { estado: writes(p.accion!) ? 'PROPUESTA mostrada al usuario; no se ha guardado nada hasta que pulse Aceptar (se puede deshacer).' : 'PROPUESTA mostrada al usuario; no se ha hecho nada hasta que pulse Aceptar.', resumen: p.resumen };
  };
  const gated = <T,>(f: (a: T) => Promise<Proposal | Bad> | Proposal | Bad) => async (a: T) => (ctx.allowed() ? out(await f(a)) : NO);
  const stickies = async () => {
    const o: { path: string; text: string }[] = [];
    if (await ctx.vault.exists(STICKY_DIR)) for (const f of await walk(ctx.vault, STICKY_DIR)) if (/\.md$/.test(f.path) && f.path.split('/').length === 3) o.push({ path: f.path, text: await readTextOr(ctx.vault, f.path, '') });
    return o;
  };
  return {
    pomodoro: tool({
      description: 'Propone iniciar, pausar o detener el temporizador de enfoque (pomodoro) de la app, con duración opcional en minutos al iniciar. No guarda nada: el usuario pulsa Aceptar.',
      inputSchema: jsonSchema<{ accion: string; minutos?: number; etiqueta?: string }>({ type: 'object', properties: { accion: { type: 'string', enum: ['iniciar', 'pausar', 'detener'] }, minutos: { type: 'number', description: '1–180; solo al iniciar' }, etiqueta: str }, required: ['accion'], additionalProperties: false }),
      execute: gated(buildPomo),
    }),
    sonido_ambiente: tool({
      description: 'Propone encender o apagar el sonido ambiente, elegir sonidos (lluvia, viento, olas, ventilador, blanco, rosa, marrón) y el volumen 0–100. Solo si el add-on está encendido. No guarda nada.',
      inputSchema: jsonSchema<{ accion: string; sonidos?: string[]; volumen?: number }>({ type: 'object', properties: { accion: { type: 'string', enum: ['encender', 'apagar'] }, sonidos: { type: 'array', items: str }, volumen: { type: 'number', description: '0–100' } }, required: ['accion'], additionalProperties: false }),
      execute: gated((a) => buildSound(ctx.addon('ambient'), a)),
    }),
    ir_a: tool({
      description: `Propone ir a una sección de la app: ${SECTION_IDS.join(', ')}. No cambia datos; el usuario pulsa Aceptar.`,
      inputSchema: jsonSchema<{ seccion: string }>({ type: 'object', properties: { seccion: { type: 'string', enum: SECTION_IDS } }, required: ['seccion'], additionalProperties: false }),
      execute: gated((a) => buildGo(ctx.addon('inbox'), a)),
    }),
    estudiar: tool({
      description: 'Propone abrir una sesión de estudio de un mazo, una carpeta de mazos o `tag:x`. Si no existe, devuelve los mazos disponibles. No cambia datos; el usuario pulsa Aceptar.',
      inputSchema: jsonSchema<{ mazo: string }>({ type: 'object', properties: { mazo: str }, required: ['mazo'], additionalProperties: false }),
      execute: gated((a) => buildStudy(ctx.col, a.mazo)),
    }),
    tareas: tool({
      description: 'Propone crear, completar o mover una tarea del add-on Tareas (archivo notes/Tareas.md, formato `- [ ]` con 📅 fecha). Solo si el add-on está encendido. No guarda: el usuario revisa y acepta; se puede deshacer. Nunca borra.',
      inputSchema: jsonSchema<{ accion: string; texto: string; fecha?: string; antes_de?: string }>({ type: 'object', properties: { accion: { type: 'string', enum: ['crear', 'completar', 'mover'] }, texto: { ...str, description: 'Crear: el texto nuevo. Completar/mover: el texto (o parte) de la tarea existente' }, fecha: { ...str, description: 'AAAA-MM-DD (solo al crear)' }, antes_de: { ...str, description: 'Mover: tarea ante la que se coloca' } }, required: ['accion', 'texto'], additionalProperties: false }),
      execute: gated(async (a) => buildTask(ctx.addon('tasks'), await readTextOr(ctx.vault, TASKS_PATH, ''), a)),
    }),
    stickies: tool({
      description: 'Propone crear o editar una nota adhesiva del add-on Sticky notes (notes/Stickies). Editar: cambiar texto, agregar texto al final, color, fijada o archivada. Solo si el add-on está encendido. No guarda: el usuario revisa y acepta; se puede deshacer. Nunca borra.',
      inputSchema: jsonSchema<StickyIn>({ type: 'object', properties: { accion: { type: 'string', enum: ['crear', 'editar'] }, texto: { ...str, description: 'Crear: el contenido. Editar: reemplaza todo el texto' }, agregar: str, nombre: { ...str, description: 'Editar: título (primera línea) del sticky existente' }, color: { ...str, description: `${STICKY_COLORS.join(', ')} o «ninguno»` }, fijada: { type: 'boolean' }, archivada: { type: 'boolean' } }, required: ['accion'], additionalProperties: false }),
      execute: gated(async (a) => buildSticky(ctx.addon('sticky-notes'), ctx.addon('sticky-notes') ? await stickies() : [], a)),
    }),
  };
}
