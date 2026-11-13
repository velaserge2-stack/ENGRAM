/**
 * Add-on «Tareas» (Prompt 19 · 2): Markdown estándar, legible en cualquier editor.
 *   - [ ] texto 📅 2026-11-20
 *   - [x] hecha
 *     - [ ] subtarea (un nivel de sangría)
 * Solo se tocan las líneas de tareas; lo demás (títulos, notas, frontmatter) queda igual. La fecha usa
 * la misma sintaxis que el plan de Notas Pro (`📅 AAAA-MM-DD`) para que interoperen.
 */
export const TASKS_PATH = 'notes/Tareas.md';

export interface Task {
  /** índice entre las tareas (0…n−1) */
  i: number;
  /** línea del archivo */
  line: number;
  /** 0 = tarea, 1 = subtarea */
  level: 0 | 1;
  done: boolean;
  text: string;
  due: string | null;
}

const RE = /^(\t| {2,4})?([-*+]) \[([ xX])\](?: (.*))?$/;
const DUE = /\s*📅\s*(\d{4}-\d{2}-\d{2})\s*$/;

export function parseTasks(text: string): Task[] {
  const out: Task[] = [];
  text.split('\n').forEach((l, line) => {
    const m = RE.exec(l);
    if (!m) return;
    const body = m[4] ?? '';
    const d = DUE.exec(body);
    out.push({ i: out.length, line, level: m[1] ? 1 : 0, done: m[3] !== ' ', text: d ? body.slice(0, d.index) : body, due: d ? d[1]! : null });
  });
  return out;
}

const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
export function taskLine(t: Pick<Task, 'level' | 'done' | 'text' | 'due'>): string {
  return `${t.level ? '  ' : ''}- [${t.done ? 'x' : ' '}] ${clean(t.text)}${t.due ? ` 📅 ${t.due}` : ''}`;
}

const lines = (text: string) => text.split('\n');
/** La tarea y sus subtareas (las líneas de tarea de nivel 1 que la siguen). */
function group(ts: Task[], i: number): Task[] {
  const g = [ts[i]!];
  if (ts[i]!.level === 0) for (let j = i + 1; j < ts.length && ts[j]!.level === 1 && ts[j]!.line === g[g.length - 1]!.line + 1; j++) g.push(ts[j]!);
  return g;
}

/** Agrega al final de la lista (o del archivo, separada por una línea en blanco). */
export function addTask(text: string, body: string, due: string | null = null): string {
  const line = taskLine({ level: 0, done: false, text: body, due });
  const ts = parseTasks(text);
  const ls = lines(text);
  if (!ts.length) {
    const base = text.replace(/\s+$/, '');
    return (base ? `${base}\n\n` : '') + line + '\n';
  }
  ls.splice(ts[ts.length - 1]!.line + 1, 0, line);
  return ls.join('\n');
}

function setLine(text: string, i: number, f: (t: Task) => Task): string {
  const ts = parseTasks(text);
  const t = ts[i];
  if (!t) return text;
  const ls = lines(text);
  ls[t.line] = taskLine(f(t));
  return ls.join('\n');
}
export const toggleTask = (text: string, i: number) => setLine(text, i, (t) => ({ ...t, done: !t.done }));
export const editTask = (text: string, i: number, body: string, due: string | null) => setLine(text, i, (t) => ({ ...t, text: body, due }));
/** Sangría de un nivel (solo si hay una tarea antes en la lista contigua). */
export function setLevel(text: string, i: number, level: 0 | 1): string {
  const ts = parseTasks(text);
  if (level === 1 && (!i || ts[i - 1]!.line !== ts[i]!.line - 1)) return text;
  return setLine(text, i, (t) => ({ ...t, level }));
}

/** Borra la tarea (y sus subtareas). */
export function removeTask(text: string, i: number): string {
  const ts = parseTasks(text);
  if (!ts[i]) return text;
  const g = group(ts, i);
  const ls = lines(text);
  ls.splice(g[0]!.line, g.length);
  return ls.join('\n');
}

/** Borra las hechas (una hecha se lleva sus subtareas; una subtarea hecha se va sola). */
export function clearDone(text: string): string {
  const ts = parseTasks(text);
  const drop = new Set<number>();
  for (const t of ts) if (t.done && !drop.has(t.line)) for (const g of group(ts, t.i)) drop.add(g.line);
  return lines(text).filter((_, n) => !drop.has(n)).join('\n');
}

/**
 * Mueve la tarea `from` (con sus subtareas) a la posición de la tarea `to` entre las del mismo nivel
 * del mismo bloque contiguo. Devuelve el texto sin cambios si no se puede.
 */
export function moveTask(text: string, from: number, to: number): string {
  const ts = parseTasks(text);
  const a = ts[from], b = ts[to];
  if (!a || !b || from === to || a.level !== b.level) return text;
  // hermanas: mismo nivel y, si son subtareas, el mismo padre
  const parent = (t: Task) => { if (!t.level) return -1; let j = t.i; while (j > 0 && ts[j]!.level) j--; return j; };
  if (parent(a) !== parent(b)) return text;
  const ls = lines(text);
  const ga = group(ts, from), gb = group(ts, to);
  // el bloque contiguo: entre a y b solo puede haber líneas de tarea
  const lo = Math.min(ga[0]!.line, gb[0]!.line), hi = Math.max(ga[ga.length - 1]!.line, gb[gb.length - 1]!.line);
  for (let n = lo; n <= hi; n++) if (!RE.test(ls[n]!)) return text;
  const moving = ls.splice(ga[0]!.line, ga.length);
  // posición de destino tras quitar el grupo
  const target = from < to ? gb[gb.length - 1]!.line - ga.length + 1 : gb[0]!.line;
  ls.splice(target, 0, ...moving);
  return ls.join('\n');
}

export const pendingCount = (text: string) => parseTasks(text).filter((t) => !t.done).length;
export const isOverdue = (t: Task, today: string) => !t.done && !!t.due && t.due < today;
