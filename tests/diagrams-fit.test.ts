import { describe, expect, it } from 'vitest';
import { FIT_MAX, FILL_MIN, clampHeight, fillHeight, fitView, toScreen } from '../src/diagrams/gestures';

const fill = (b: { x: number; y: number; w: number; h: number }, w: number, h: number) => {
  const v = fitView(b, w, h, 24);
  return { v, fx: (b.w * v.k) / w, fy: (b.h * v.k) / h };
};

describe('fitView (P22)', () => {
  it('contenido que cabe justo llena ≥ 85 % de la dimensión limitante', () => {
    for (const [bw, bh, w, h] of [[400, 300, 1100, 700], [900, 200, 1000, 800], [200, 1200, 1000, 700], [600, 350, 1180, 700]] as const) {
      const { fx, fy } = fill({ x: 10, y: -20, w: bw, h: bh }, w, h);
      expect(Math.max(fx, fy)).toBeGreaterThanOrEqual(0.85);
    }
    const { fx, fy } = fill({ x: 0, y: 0, w: 400, h: 300 }, 1100, 700);
    expect(Math.max(fx, fy)).toBeGreaterThanOrEqual(0.85);
  });
  it('tope de ampliación 300 %', () => {
    expect(fitView({ x: 0, y: 0, w: 10, h: 10 }, 1000, 800).k).toBe(FIT_MAX);
    expect(FIT_MAX).toBe(3);
  });
  it('contenido muy chico: arriba-izquierda con margen, no centrado', () => {
    const b = { x: -50, y: -20, w: 100, h: 40 };
    const v = fitView(b, 1180, 800, 24);
    expect(toScreen(v, { x: b.x, y: b.y })).toEqual({ x: 24, y: 24 });
  });
  it('contenido grande sigue cabiendo en el lienzo', () => {
    const b = { x: 5, y: 7, w: 3000, h: 2000 };
    const v = fitView(b, 800, 600, 24);
    const a = toScreen(v, { x: b.x, y: b.y }), z = toScreen(v, { x: b.x + b.w, y: b.y + b.h });
    expect(a.x).toBeGreaterThanOrEqual(0); expect(a.y).toBeGreaterThanOrEqual(0);
    expect(z.x).toBeLessThanOrEqual(800); expect(z.y).toBeLessThanOrEqual(600);
  });
});

describe('alto', () => {
  it('alto de nota completa: ventana menos el borde superior, mínimo 360', () => {
    expect(fillHeight(820, 180)).toBe(624);
    expect(fillHeight(500, 400)).toBe(FILL_MIN);
  });
  it('alto de bloque 160–2000', () => {
    expect(clampHeight(50)).toBe(160);
    expect(clampHeight(5000)).toBe(2000);
    expect(clampHeight(420.4)).toBe(420);
  });
});
