import { describe, expect, it } from 'vitest';
import { medianFps } from '../src/theme';

describe('aviso de modo ligero (vidrio)', () => {
  it('mediana de fps: lenta al desplazar, rápida en reposo (sin falsos avisos)', () => {
    expect(medianFps(Array(180).fill(1000 / 60))).toBeCloseTo(60, 5);
    expect(medianFps(Array(90).fill(1000 / 28))).toBeLessThan(40); // 28 fps sostenidos: aviso
    // medio segundo lento y el resto en reposo a 60 fps: la mediana sigue alta
    expect(medianFps([...Array(15).fill(50), ...Array(150).fill(1000 / 60)])).toBeGreaterThan(55);
    expect(medianFps([])).toBe(60);
  });
});
