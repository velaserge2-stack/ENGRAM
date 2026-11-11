/**
 * Pomodoro (SPEC §9d). Safari suspende temporizadores en segundo plano: el
 * tiempo se lleva con `endAt` (marca de tiempo) y se recalcula al volver.
 * Nunca se cuenta con setInterval.
 */
export type Phase = 'work' | 'short' | 'long';

export interface PomoConfig {
  work: number;
  short: number;
  long: number;
  every: number;
}

export interface PomoState {
  phase: Phase;
  running: boolean;
  /** ms epoch en que termina la fase (si corre) */
  endAt: number | null;
  /** ms restantes (si está en pausa) */
  remaining: number;
  /** ciclos de trabajo completados en la serie */
  cycle: number;
  label: string;
  /** inicio de la fase de trabajo en curso (para registrar) */
  startedAt: number | null;
}

export interface PomoSession {
  ts: number;
  end: number;
  minutes: number;
  label: string;
  completed: boolean;
}

export const PHASE_LABEL: Record<Phase, string> = { work: 'Estudio', short: 'Descanso', long: 'Descanso largo' };

export function initial(cfg: PomoConfig): PomoState {
  return { phase: 'work', running: false, endAt: null, remaining: cfg.work * 60_000, cycle: 0, label: '', startedAt: null };
}

export function duration(cfg: PomoConfig, p: Phase): number {
  return (p === 'work' ? cfg.work : p === 'short' ? cfg.short : cfg.long) * 60_000;
}

export function remaining(s: PomoState, now: number): number {
  return s.running && s.endAt ? Math.max(0, s.endAt - now) : s.remaining;
}

export function start(s: PomoState, now: number): PomoState {
  if (s.running) return s;
  return { ...s, running: true, endAt: now + s.remaining, startedAt: s.phase === 'work' ? (s.startedAt ?? now) : s.startedAt };
}

export function pause(s: PomoState, now: number): PomoState {
  if (!s.running) return s;
  return { ...s, running: false, remaining: remaining(s, now), endAt: null };
}

export function reset(s: PomoState, cfg: PomoConfig): PomoState {
  return { ...s, running: false, endAt: null, remaining: duration(cfg, s.phase), startedAt: null };
}

function nextPhase(s: PomoState, cfg: PomoConfig): { phase: Phase; cycle: number } {
  if (s.phase !== 'work') return { phase: 'work', cycle: s.cycle };
  const cycle = s.cycle + 1;
  return { phase: cycle % cfg.every === 0 ? 'long' : 'short', cycle };
}

/** Saltar a la siguiente fase; registra el trabajo parcial si lo hubo. */
export function skip(s: PomoState, cfg: PomoConfig, now: number): { state: PomoState; session: PomoSession | null } {
  const session = s.phase === 'work' && s.startedAt != null ? mkSession(s, cfg, now, false) : null;
  const n = nextPhase(s, cfg);
  return { state: { ...s, ...n, running: false, endAt: null, remaining: duration(cfg, n.phase), startedAt: null }, session };
}

function mkSession(s: PomoState, cfg: PomoConfig, end: number, completed: boolean): PomoSession {
  const worked = completed ? cfg.work * 60_000 : duration(cfg, 'work') - remaining(s, end);
  return { ts: s.startedAt ?? end - worked, end, minutes: Math.round((worked / 60_000) * 10) / 10, label: s.label, completed };
}

/**
 * Avanza el reloj hasta `now` (p. ej. al volver de segundo plano). Si una fase
 * terminó mientras la app estaba oculta, se cierra en su `endAt` exacto y la
 * siguiente queda en pausa (no se encadenan fases sin el usuario).
 */
export function tick(s: PomoState, cfg: PomoConfig, now: number): { state: PomoState; session: PomoSession | null; finished: Phase | null } {
  if (!s.running || !s.endAt || now < s.endAt) return { state: s, session: null, finished: null };
  const session = s.phase === 'work' ? mkSession(s, cfg, s.endAt, true) : null;
  const n = nextPhase(s, cfg);
  return { state: { ...s, ...n, running: false, endAt: null, remaining: duration(cfg, n.phase), startedAt: null }, session, finished: s.phase };
}

export function fmt(ms: number): string {
  const t = Math.ceil(ms / 1000);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export function parseSessions(text: string): PomoSession[] {
  const out: PomoSession[] = [];
  for (const l of text.split('\n')) {
    try {
      const s = JSON.parse(l) as PomoSession;
      if (typeof s.ts === 'number' && typeof s.minutes === 'number') out.push(s);
    } catch {
      /* línea vacía o dañada */
    }
  }
  return out;
}
