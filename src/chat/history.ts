// Historial del Asistente: solo en memoria (nunca en disco ni en el respaldo). «Nueva conversación» lo vacía.
import type { ModelMessage } from 'ai';

export type Role = 'user' | 'assistant' | 'error' | 'notice';
/** `code` y `alias` los traduce la interfaz al pintar (así el idioma puede cambiar sin perder nada). */
export interface Msg { id: number; role: Role; text: string; code?: string; alias?: string }
export interface Status { busy: boolean; /** apodo de la última clave usada */ alias?: string; /** espera por límite por minuto, en s */ waitS?: number }

/** Mensajes que se envían al modelo como máximo (los más recientes). */
export const MAX_SENT = 40;

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

export function add(role: Role, text: string, extra?: { code?: string; alias?: string }): Msg {
  const m: Msg = { id: ++seq, role, text, ...extra };
  msgs = [...msgs, m];
  emit();
  return m;
}
export function append(id: number, delta: string): void {
  msgs = msgs.map((m) => (m.id === id ? { ...m, text: m.text + delta } : m));
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

/** Lo que ve el modelo: solo turnos de usuario y asistente con texto, los últimos `max`, alternados (se funden los seguidos del mismo rol). */
export function toModel(list: readonly Msg[] = msgs, max = MAX_SENT): ModelMessage[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of list.filter((x) => (x.role === 'user' || x.role === 'assistant') && x.text.trim()).slice(-max)) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += '\n\n' + m.text;
    else out.push({ role: m.role as 'user' | 'assistant', content: m.text });
  }
  while (out.length && out[0]!.role !== 'user') out.shift();
  return out;
}
