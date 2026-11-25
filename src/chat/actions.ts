// Acciones del Asistente sobre la app (carril Acciones). Aquí: el tipo `Act`, las operaciones PURAS sobre Tareas/Stickies,
// la escritura (solo tras «Aceptar», por el `w` de `tracked`) y la ejecución de las acciones sin datos (navegar, temporizador, sonido).
// Nada borra datos. Las que escriben se re-calculan sobre el texto ACTUAL al aplicar (no pisan cambios hechos entre la propuesta y «Aceptar»).
import { ambient } from '../lib/ambient';
import type { SoundId } from '../lib/noise';
import { parseFrontmatter } from '../lib/frontmatter';
import { go, type AppCtx } from '../state';
import { parseSticky, serializeSticky, STICKY_DIR } from '../stickies/model';
import { addTask, moveTask, parseTasks, TASKS_PATH, toggleTask } from '../tasks/parse';
import type { VaultAdapter } from '../vault/types';
import { readTextOr } from '../vault/util';

export type TaskOp = { op: 'add'; text: string; due: string | null } | { op: 'done'; text: string } | { op: 'move'; text: string; before: string };
export type StickyOp =
  | { op: 'new'; body: string; color: string | null; pinned: boolean }
  | { op: 'edit'; body?: string; append?: string; color?: string | null; pinned?: boolean; archived?: boolean };
export type Act =
  | { k: 'pomo'; op: 'iniciar' | 'pausar' | 'detener'; min?: number; label?: string }
  | { k: 'sonido'; op: 'encender' | 'apagar'; levels?: Partial<Record<SoundId, number>>; vol?: number }
  | { k: 'ir'; ruta: string[] }
  | { k: 'tarea'; op: TaskOp }
  | { k: 'sticky'; op: StickyOp };

/** ¿Escribe archivos? (si no, solo se ejecuta en la interfaz y no hay «Deshacer») */
export const writes = (a: Act): boolean => a.k === 'tarea' || a.k === 'sticky';

/** Texto nuevo de Tareas.md tras la operación, o null si no se puede (tarea inexistente o ya hecha, orden imposible). */
export function applyTask(text: string, o: TaskOp): string | null {
  if (o.op === 'add') return addTask(text, o.text, o.due);
  const ts = parseTasks(text);
  const from = ts.find((t) => t.text === o.text && (o.op === 'move' || !t.done));
  if (!from) return null;
  if (o.op === 'done') return toggleTask(text, from.i);
  const to = ts.find((t) => t.text === o.before);
  if (!to) return null;
  const r = moveTask(text, from.i, to.i);
  return r === text ? null : r;
}

/** Texto nuevo de un sticky tras `edit` (conserva lo ajeno del frontmatter). */
export function applySticky(path: string, text: string, o: Extract<StickyOp, { op: 'edit' }>): string {
  const s = parseSticky(path, text);
  const body = o.body !== undefined ? o.body : o.append ? s.body.replace(/\s*$/, '') + '\n' + o.append : s.body;
  return serializeSticky({ ...s, body, ...(o.color !== undefined ? { color: o.color as typeof s.color } : {}), ...(o.pinned !== undefined ? { pinned: o.pinned } : {}), ...(o.archived !== undefined ? { archived: o.archived } : {}) });
}
export const newStickyText = (o: Extract<StickyOp, { op: 'new' }>, order: number): string =>
  serializeSticky({ path: '', body: o.body, order, color: o.color as never, pinned: o.pinned, archived: false, rest: {} });

/** Escribe (solo desde `applyProposal`, tras «Aceptar»). `dest` ya viene validado por `safeDest`. */
export async function writeAct(vault: VaultAdapter, dest: string, a: Act, content: string, w: (p: string, t: string) => Promise<void>): Promise<void> {
  if (a.k === 'tarea') {
    const next = applyTask(await readTextOr(vault, TASKS_PATH, ''), a.op);
    if (next === null) throw new Error('gone');
    await w(TASKS_PATH, next);
  } else if (a.k === 'sticky' && a.op.op === 'new') {
    if (await vault.exists(dest)) throw new Error('exists'); // nunca se sobrescribe
    await w(dest, content);
  } else if (a.k === 'sticky' && a.op.op === 'edit') {
    if (!(await vault.exists(dest))) throw new Error('gone');
    await w(dest, applySticky(dest, await readTextOr(vault, dest, ''), a.op));
  }
}
export const stickyPathOk = (p: string): boolean => p.startsWith(STICKY_DIR + '/') && /\.md$/.test(p) && p.split('/').length === 3 && !/[\\\u0000-\u001f]/.test(p) && !p.includes('..');
export const bodyOf = (text: string): string => parseFrontmatter(text).body;

/** Ejecuta una acción sin datos, DENTRO del gesto de «Aceptar» (el audio de Safari lo exige). Feature detection incluida. */
export function runAct(a: Act, app: AppCtx): void {
  if (a.k === 'ir') { go(...a.ruta); return; }
  if (a.k === 'pomo') {
    if (a.op === 'iniciar') app.pomo.start(a.label, a.min);
    else if (a.op === 'pausar') app.pomo.pause();
    else app.pomo.reset();
    return;
  }
  if (a.k === 'sonido') {
    if (!ambient.supported()) throw new Error('nosupport');
    const s = app.settings.ambient;
    if (a.vol !== undefined) ambient.setVolume(a.vol);
    if (a.op === 'apagar') { ambient.stop(); return; }
    const levels = a.levels ?? (Object.values(s.levels).some((v) => v > 0) ? s.levels : { rain: 0.6 });
    app.update({ ambient: { ...s, levels: levels as Record<string, number> } });
    ambient.play(levels, s.background);
  }
}
