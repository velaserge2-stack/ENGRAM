/**
 * Editar o borrar una ocurrencia de una serie (F16): «solo este día» excluye la fecha de la
 * serie (EXDATE) y, al editar, crea una entrada suelta con los cambios; «toda la serie»
 * cambia la entrada base (la hora se aplica a todas las ocurrencias, en hora local).
 */
import type { StudyBlock } from './ics';

export type Scope = 'one' | 'series';

const ymd = (date: string) => date.split('-').map(Number) as [number, number, number];
/** Mismo reloj (hora local) en otra fecha. */
export function onDate(ms: number, date: string): number {
  const d = new Date(ms);
  const [y, m, dd] = ymd(date);
  return new Date(y, m - 1, dd, d.getHours(), d.getMinutes(), d.getSeconds()).getTime();
}

export function deleteOccurrence(blocks: StudyBlock[], uid: string, date: string, scope: Scope): StudyBlock[] {
  const b = blocks.find((x) => x.uid === uid);
  if (!b) return blocks;
  if (scope === 'series' || !b.rrule) return blocks.filter((x) => x.uid !== uid);
  return blocks.map((x) => (x.uid === uid ? { ...x, exdate: [...new Set([...(x.exdate ?? []), date])].sort() } : x));
}

/**
 * `next` es la entrada editada tal como se ve en la fecha `date` (start/end ya en ese día o en
 * otro, si se movió). Devuelve la lista nueva.
 */
export function editOccurrence(blocks: StudyBlock[], uid: string, date: string, next: StudyBlock, scope: Scope, newUid = () => `${Date.now().toString(36)}@engrama`): StudyBlock[] {
  const b = blocks.find((x) => x.uid === uid);
  if (!b) return [...blocks, next];
  if (!b.rrule) return blocks.map((x) => (x.uid === uid ? next : x));
  if (scope === 'one') {
    const single: StudyBlock = { ...next, uid: newUid(), rrule: '', until: '', byday: undefined, exdate: undefined, done: next.done.filter((d) => d === date) };
    return [...deleteOccurrence(blocks, uid, date, 'one'), single];
  }
  // toda la serie: conserva la fecha de inicio de la serie y aplica la hora y duración nuevas
  const baseDay = (() => { const d = new Date(b.start); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const start = onDate(next.start, baseDay);
  return blocks.map((x) => (x.uid === uid ? { ...next, uid, start, end: start + (next.end - next.start), exdate: next.rrule ? next.exdate : undefined } : x));
}
