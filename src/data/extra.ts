/** Datos auxiliares para estadísticas: sesiones de pomodoro, intentos de simulacro y exámenes. */
import { type Exam, parseExam } from '../lib/exams';
import { parseSessions } from '../lib/pomodoro';
import type { Extra } from '../lib/stats';
import { useApp, useAsync } from '../state';
import type { VaultAdapter } from '../vault/types';
import { readTextOr, serialFile, walk } from '../vault/util';

export const ATTEMPTS = '.app/exam-attempts.jsonl';

/** Línea quitada de un `.jsonl` y su posición: con ella, deshacer deja el archivo idéntico. */
export interface RemovedLine { raw: string; index: number; lines: number }

/**
 * Quita del `.jsonl` solo la línea cuyo `id` es `id`. Las demás (también las dañadas, que los
 * lectores ignoran) quedan intactas, byte a byte. `null` si no está.
 */
export function removeLine(text: string, id: string): { text: string; removed: RemovedLine } | null {
  const lines = text.split('\n');
  const index = lines.findIndex((l) => { try { return (JSON.parse(l) as { id?: unknown }).id === id; } catch { return false; } });
  if (index < 0) return null;
  const [raw] = lines.splice(index, 1);
  return { text: lines.join('\n'), removed: { raw: raw!, index, lines: lines.length + 1 } };
}
/** Devuelve la línea a su sitio (inverso exacto de `removeLine`). */
export function insertLine(text: string, r: RemovedLine): string {
  // un archivo de una sola línea sin salto queda vacío: '' es entonces cero líneas, no una vacía
  const lines = text === '' && r.lines === 1 ? [] : text.split('\n');
  lines.splice(Math.min(r.index, lines.length), 0, r.raw);
  return lines.join('\n');
}

/** Borra un intento terminado de `.app/exam-attempts.jsonl` (por SafeVault). Si no existe, no escribe. */
export function deleteAttempt(vault: VaultAdapter, id: string): Promise<RemovedLine | null> {
  return serialFile(vault, ATTEMPTS, async () => {
    const r = removeLine(await readTextOr(vault, ATTEMPTS, ''), id);
    if (!r) return null;
    await vault.write(ATTEMPTS, r.text);
    return r.removed;
  });
}
/** Deshacer: vuelve a poner la línea en su posición original. */
export function restoreAttempt(vault: VaultAdapter, r: RemovedLine): Promise<void> {
  return serialFile(vault, ATTEMPTS, async () => vault.write(ATTEMPTS, insertLine(await readTextOr(vault, ATTEMPTS, ''), r)));
}

export async function loadExtra(vault: VaultAdapter): Promise<Extra> {
  const pomodoro = parseSessions(await readTextOr(vault, '.app/pomodoro.jsonl', ''));
  const exams: Extra['exams'] = [];
  for (const l of (await readTextOr(vault, ATTEMPTS, '')).split('\n')) {
    try {
      const a = JSON.parse(l) as { finishedAt?: number; startedAt?: number; elapsedMs?: number };
      if (a.finishedAt) exams.push({ ts: a.finishedAt, ms: typeof a.elapsedMs === 'number' && a.elapsedMs > 0 ? Math.min(a.elapsedMs, 6 * 3600_000) : 0 });
    } catch {
      /* línea vacía */
    }
  }
  return { pomodoro, exams };
}

async function loadExams(vault: VaultAdapter): Promise<Exam[]> {
  const out: Exam[] = [];
  for (const f of await walk(vault, 'exams')) if (f.path.endsWith('.md')) out.push(parseExam(f.path, await readTextOr(vault, f.path, '')));
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function useExtra() {
  const app = useApp();
  return useAsync(async () => ({ extra: await loadExtra(app.vault), exams: await loadExams(app.vault) }), [app.version, app.notesVersion, app.pomo.today]);
}
