import { describe, expect, it } from 'vitest';
import { fmt, initial, pause, remaining, skip, start, tick } from '../src/lib/pomodoro';

const C = { work: 25, short: 5, long: 15, every: 4 };
const M = 60_000;

describe('pomodoro con endAt', () => {
  it('el tiempo es correcto tras "bloquear la pantalla" (sin ticks intermedios)', () => {
    let s = start(initial(C), 0);
    expect(remaining(s, 10 * M)).toBe(15 * M); // 10 min en segundo plano, ningún timer corrió
    s = pause(s, 10 * M);
    expect(remaining(s, 99 * M)).toBe(15 * M);
    s = start(s, 100 * M);
    expect(s.endAt).toBe(115 * M);
  });
  it('termina la fase en su endAt exacto y registra la sesión', () => {
    const s = start(initial(C), 0);
    const r = tick(s, C, 40 * M); // volvió 15 min tarde
    expect(r.finished).toBe('work');
    expect(r.session).toMatchObject({ ts: 0, end: 25 * M, minutes: 25, completed: true });
    expect(r.state).toMatchObject({ phase: 'short', running: false, cycle: 1, remaining: 5 * M });
  });
  it('descanso largo cada 4 ciclos y saltar registra parcial', () => {
    let s = initial(C);
    for (let i = 0; i < 3; i++) s = skip(skip(s, C, 0).state, C, 0).state;
    s = start(s, 0);
    const r = skip(s, C, 10 * M);
    expect(r.session?.minutes).toBe(10);
    expect(r.state.phase).toBe('long');
    expect(fmt(25 * M)).toBe('25:00');
  });
});
