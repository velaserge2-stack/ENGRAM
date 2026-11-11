import { describe, expect, it } from 'vitest';
import { pace } from '../src/lib/exams';
import { addDays } from '../src/lib/days';
import { activity, consistency, todayProgress, trueRetention, studyMs } from '../src/lib/stats';
import type { LogEntry } from '../src/srs/engine';

const TZ = 'America/Monterrey';
const T = (s: string) => Date.parse(s + '-06:00');

describe('ritmo de examen', () => {
  const today = '2026-11-11';
  const per = (vals: number[]) => new Map(vals.map((v, i) => [addDays(today, -(i + 1)), v]));
  const base = { today, created: '2026-10-01', finalDays: 7, minPerDay: null };
  it('sin datos', () => {
    const p = pace({ ...base, examDate: '2026-12-21', newLeft: 330, newPerDay: new Map(), firstActivity: null });
    expect(p.status).toBe('calculando');
    expect(p.needed).toBe(10); // 330 / (40 − 7)
  });
  it('al día', () => {
    const p = pace({ ...base, examDate: '2026-12-21', newLeft: 330, newPerDay: per([12, 12, 12, 12, 12, 12, 12]), firstActivity: '2026-10-01' });
    expect(p.status).toBe('en-ritmo');
    expect(p.actual).toBe(12);
  });
  it('atrasado, con mensaje accionable', () => {
    const p = pace({ ...base, examDate: '2026-12-21', newLeft: 330, newPerDay: per([5, 5, 5, 5, 5, 5, 5]), firstActivity: '2026-10-01' });
    expect(p.status).toBe('atrasado');
    expect(p.message).toContain('te faltan 5/día');
    expect(p.finishDate).toBe(addDays(today, 66));
  });
  it('ajustado', () => {
    expect(pace({ ...base, examDate: '2026-12-21', newLeft: 330, newPerDay: per([9, 9, 9, 9, 9, 9, 9]), firstActivity: '2026-10-01' }).status).toBe('ajustado');
  });
  it('examen mañana: todo en un día', () => {
    const p = pace({ ...base, examDate: '2026-11-12', newLeft: 50, newPerDay: per([5]), firstActivity: '2026-10-01' });
    expect(p.studyDays).toBe(1);
    expect(p.needed).toBe(50);
    expect(p.status).toBe('atrasado');
  });
  it('examen ya pasado', () => {
    expect(pace({ ...base, examDate: '2026-11-01', newLeft: 50, newPerDay: new Map(), firstActivity: null }).status).toBe('pasado');
  });
  it('cambiar la fecha del examen cambia el estado', () => {
    const args = { ...base, newLeft: 300, newPerDay: per([10, 10, 10, 10, 10, 10, 10]), firstActivity: '2026-10-01' };
    expect(pace({ ...args, examDate: '2027-02-01' }).status).toBe('en-ritmo');
    expect(pace({ ...args, examDate: '2026-12-01' }).status).toBe('atrasado');
  });
});

describe('estadísticas con historial de prueba', () => {
  // 90 días: 20 tarjetas/día los días pares, 10 s cada una, 1 de cada 5 con "Otra vez"
  const log: LogEntry[] = [];
  const start = T('2026-08-13T10:00:00');
  for (let d = 0; d < 90; d++) if (d % 2 === 0) for (let i = 0; i < 20; i++) log.push({ id: `c${i}`, ts: start + d * 86_400_000 + i * 10_000, rating: i % 5 === 0 ? 1 : 3, ms: 10_000, state: 2, ivl: d > 30 ? 25 : 5 });
  const act = activity(log, { pomodoro: [{ ts: start, minutes: 25 }], exams: [] }, TZ, 4);
  it('días y tiempo a mano', () => {
    expect(act.size).toBe(45);
    expect(act.get('2026-08-13')).toEqual({ cards: 20, ms: 200_000, focusMs: 1_500_000, examMs: 0 });
    expect(studyMs(act.get('2026-08-13'))).toBe(1_500_000);
    const tp = todayProgress(log, '2026-08-13', TZ, 4);
    expect(tp).toEqual({ studied: 20, minutes: 3, secPerCard: 10, perMin: 6, correct: 80 });
  });
  it('retención real solo con maduras', () => {
    const now = start + 89 * 86_400_000;
    const r = trueRetention(log, now);
    expect(r.n).toBe(15 * 20);
    expect(r.value).toBeCloseTo(0.8, 5);
  });
  it('consistencia con promedio móvil', () => {
    const c = consistency(act, '2026-11-10', 7);
    expect(c.map((x) => x.n)).toEqual([0, 20, 0, 20, 0, 20, 0]);
    expect(c.map((x) => x.avg7)).toEqual([0, 10, 6.7, 10, 8, 10, 8.6]);
  });
});
