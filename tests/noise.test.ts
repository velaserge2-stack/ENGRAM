import { describe, expect, it } from 'vitest';
import { fadeGain, generate, mix, sleepAt, SOUNDS, wav } from '../src/lib/noise';

describe('sonido ambiente', () => {
  it('cada generador: sin NaN, volumen acotado y con señal', () => {
    for (const id of SOUNDS) {
      const x = generate(id, 2, 8000);
      expect(x.length).toBeGreaterThan(8000);
      let peak = 0, energy = 0;
      for (const v of x) { expect(Number.isFinite(v)).toBe(true); peak = Math.max(peak, Math.abs(v)); energy += v * v; }
      expect(peak).toBeLessThanOrEqual(0.9 + 1e-6);
      expect(energy / x.length).toBeGreaterThan(1e-4);
    }
  });
  it('reproducible y el bucle empalma sin salto brusco', () => {
    const a = generate('rain', 1, 8000), b = generate('rain', 1, 8000);
    expect(a).toEqual(b);
    const w = generate('brown', 2, 8000);
    expect(Math.abs(w[w.length - 1]! - w[0]!)).toBeLessThan(0.2);
  });
  it('mezcla lluvia + ruido marrón dentro de [-1, 1]', () => {
    const m = mix({ rain: 1, brown: 1 }, 1, 8000);
    expect(m.every((v) => v >= -1 && v <= 1 && Number.isFinite(v))).toBe(true);
    expect(mix({}, 1, 8000).every((v) => v === 0)).toBe(true);
  });
  it('apagado programado: desvanecimiento de 5 s y hora de apagado', () => {
    expect(fadeGain(0, null)).toBe(1);
    expect(fadeGain(1000, 10_000)).toBe(1);
    expect(fadeGain(7500, 10_000)).toBeCloseTo(0.5);
    expect(fadeGain(10_000, 10_000)).toBe(0);
    expect(sleepAt(1000, 15, { running: false, phase: 'work', endAt: null })).toBe(1000 + 15 * 60_000);
    expect(sleepAt(1000, 'pomodoro', { running: true, phase: 'work', endAt: 5000 })).toBe(5000);
    expect(sleepAt(1000, 'pomodoro', { running: true, phase: 'short', endAt: 5000 })).toBeNull();
    expect(sleepAt(1000, 0, { running: false, phase: 'work', endAt: null })).toBeNull();
  });
  it('WAV válido', () => {
    const w = wav(new Float32Array([0, 1, -1]), 8000);
    expect(String.fromCharCode(...w.slice(0, 4))).toBe('RIFF');
    expect(w.length).toBe(44 + 6);
  });
});
