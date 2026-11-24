import type { Detail } from './errors';
// Historial del Asistente: solo en memoria (nunca en disco ni en el respaldo). «Nueva conversación» lo vacía.
import type { ModelMessage } from 'ai';
import type { Proposal } from './proposal';
import type { Source } from './tools';

export type Role = 'user' | 'assistant' | 'error' | 'notice' | 'proposal';
export type PState = 'pending' | 'saving' | 'saved' | 'canceled' | 'undone';
/** `code` y `alias` los traduce la interfaz al pintar (así el idioma puede cambiar sin perder nada). */
export interface Msg { id: number; role: Role; text: string; code?: string; alias?: string; /** fuentes devueltas por las herramientas en ese turno (se llena durante el turno) */ sources?: Source[]; /** vista previa de escritura (role 'proposal') */ proposal?: Proposal; pstate?: PState; perr?: string; /** línea técnica (redactada) del último fallo al guardar */ pdet?: string; detail?: Detail }
export interface Status { busy: boolean; /** herramienta en curso */ tool?: string; /** apodo de la última clave usada */ alias?: string; /** espera por límite por minuto, en s */ waitS?: number }

let msgs: Msg[] = [];
let status: Status = { busy: false };
let seq = 0, epoch = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const messages = (): readonly Msg[] => msgs;
export const getStatus = (): Status => status;
/** Cambia con cada «Nueva conversación»: un turno viejo que termina tarde no escribe en la nueva. */
export const generation = (): number => epoch;
export function subscribe(f: () => void): () => void { subs.add(f); return () => void subs.delete(f); }

export function add(role: Role, text: string, extra?: { code?: string; detail?: Detail; alias?: string; sources?: Source[]; proposal?: Proposal; pstate?: PState }): Msg {
  const m: Msg = { id: ++seq, role, text, ...extra };
  msgs = [...msgs, m];
  emit();
  return m;
}
export function append(id: number, delta: string): void {
  msgs = msgs.map((m) => (m.id === id ? { ...m, text: m.text + delta } : m));
  emit();
}
export function patch(id: number, p: Partial<Msg>): void {
  msgs = msgs.map((m) => (m.id === id ? { ...m, ...p } : m));
  emit();
}
export function remove(id: number): void {
  msgs = msgs.filter((m) => m.id !== id);
  emit();
}
export function setStatus(p: Partial<Status>): void {
  status = { ...status, ...p };
  emit();
}
export function clear(): void {
  msgs = [];
  epoch++;
  status = { busy: false };
  emit();
}

/** Lo que ve el modelo: solo turnos de usuario y asistente con texto, alternados (se funden los seguidos del mismo rol). Sin recorte: lo hace `trimMessages` con el presupuesto del proveedor. */
export function toModel(list: readonly Msg[] = msgs): ModelMessage[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of list.filter((x) => (x.role === 'user' || x.role === 'assistant') && x.text.trim())) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += '\n\n' + m.text;
    else out.push({ role: m.role as 'user' | 'assistant', content: m.text });
  }
  while (out.length && out[0]!.role !== 'user') out.shift();
  return out;
}

const tok = (s: string) => Math.ceil(s.length / 4);
const OLD_REPLY = 800;
/**
 * Recorta por presupuesto de tokens (≈ caracteres/4). Primero se acortan las respuestas ANTIGUAS del asistente (donde viven los
 * resultados de herramientas ya resumidos); después se descartan los mensajes más viejos. Siempre se conserva el último mensaje del
 * usuario y los recientes que quepan; el modelo recibe «(Se omitieron N mensajes antiguos.)». La instrucción de sistema va aparte y nunca se recorta.
 */
export function trimMessages(msgs: readonly ModelMessage[], budgetTokens: number): ModelMessage[] {
  if (msgs.some((m) => typeof m.content !== 'string')) return msgs.slice();
  let list = msgs.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content as string }));
  const size = () => list.reduce((a, m) => a + tok(m.content) + 4, 0);
  if (size() <= budgetTokens) return msgs.slice();
  const lastUser = list.map((m) => m.role).lastIndexOf('user');
  list = list.map((m, i) => (m.role === 'assistant' && i < list.length - 2 && m.content.length > OLD_REPLY ? { ...m, content: m.content.slice(0, OLD_REPLY).replace(/\s+\S*$/, '') + ' […]' } : m));
  let from = 0;
  while (from < lastUser && size() - list.slice(0, from).reduce((a, m) => a + tok(m.content) + 4, 0) > budgetTokens) from++;
  while (from < lastUser && list[from]!.role !== 'user') from++; // empieza por usuario
  let out = list.slice(from);
  if (from > 0) out = out.map((m, i) => (i === 0 ? { ...m, content: `(Se omitieron ${from} mensajes antiguos de esta conversación.)\n\n${m.content}` } : m));
  return out;
}
