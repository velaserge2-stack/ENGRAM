/** Datos auxiliares para estadísticas: sesiones de pomodoro, intentos de simulacro y exámenes. */
import { type Exam, parseExam } from '../lib/exams';
import { parseSessions } from '../lib/pomodoro';
import type { Extra } from '../lib/stats';
import { useApp, useAsync } from '../state';
import type { VaultAdapter } from '../vault/types';
import { readTextOr, walk } from '../vault/util';

export const ATTEMPTS = '.app/exam-attempts.jsonl';

export async function loadExtra(vault: VaultAdapter): Promise<Extra> {
  const pomodoro = parseSessions(await readTextOr(vault, '.app/pomodoro.jsonl', ''));
  const exams: Extra['exams'] = [];
  for (const l of (await readTextOr(vault, ATTEMPTS, '')).split('\n')) {
    try {
      const a = JSON.parse(l) as { finishedAt?: number; startedAt?: number; elapsedMs?: number };
      if (a.finishedAt) exams.push({ ts: a.finishedAt, ms: Math.min(a.elapsedMs ?? 0, 6 * 3600_000) });
    } catch {
      /* línea vacía */
    }
  }
  return { pomodoro, exams };
}

export async function loadExams(vault: VaultAdapter): Promise<Exam[]> {
  const out: Exam[] = [];
  for (const f of await walk(vault, 'exams')) if (f.path.endsWith('.md')) out.push(parseExam(f.path, await readTextOr(vault, f.path, '')));
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function useExtra() {
  const app = useApp();
  return useAsync(async () => ({ extra: await loadExtra(app.vault), exams: await loadExams(app.vault) }), [app.version, app.pomo.today]);
}
