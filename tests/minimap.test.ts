import { describe, expect, it } from 'vitest';
import { centerOn, MAP_H, MAP_W, mapBox, mapFit, toMap, toWorld, viewBox } from '../src/lib/minimap';

const inside = (b: { x: number; y: number; w: number; h: number }) => b.x >= -1e-9 && b.y >= -1e-9 && b.x + b.w <= MAP_W + 1e-9 && b.y + b.h <= MAP_H + 1e-9;

describe('minimapa del lienzo (Prompt 15)', () => {
  const panels = [{ x: 0, y: 0, w: 640, h: 560 }, { x: 700, y: 0, w: 640, h: 560 }, { x: -800, y: 900, w: 300, h: 200 }];
  it('el rectángulo de vista siempre está dentro: 0, 1 y N paneles, lejos y con cualquier zoom', () => {
    for (const ps of [[], [panels[0]!], panels, [{ x: -50000, y: -30000, w: 90000, h: 70000 }]])
      for (const k of [0.1, 0.2, 0.5, 1, 2, 3])
        for (const [x, y] of [[0, 0], [-90000, 40000], [120000, -80000]] as [number, number][]) {
          const v = { x, y, k };
          const f = mapFit(ps, v, 1000, 700);
          expect(inside(mapBox(f, viewBox(v, 1000, 700)))).toBe(true);
          for (const p of ps) expect(inside(mapBox(f, p))).toBe(true);
        }
  });
  it('coordenadas negativas y panel enorme: escala finita y positiva', () => {
    const f = mapFit([{ x: -1e6, y: -1e6, w: 2e6, h: 1e6 }], { x: 0, y: 0, k: 1 }, 1000, 700);
    expect(f.mk).toBeGreaterThan(0);
    expect(Number.isFinite(f.mk)).toBe(true);
  });
  it('minimapa ↔ mundo es reversible con zoom de 0.2 a 3', () => {
    for (const k of [0.2, 0.7, 1, 3]) {
      const f = mapFit(panels, { x: -300, y: 120, k }, 1000, 700);
      for (const [wx, wy] of [[0, 0], [-800, 900], [1340, 560]] as [number, number][]) {
        const m = toMap(f, wx, wy), w = toWorld(f, m.x, m.y);
        expect(w.x).toBeCloseTo(wx, 6);
        expect(w.y).toBeCloseTo(wy, 6);
      }
    }
  });
  it('centrar en un punto deja ese punto en el centro de la pantalla, sin cambiar el zoom', () => {
    for (const k of [0.2, 1, 3]) {
      const v = centerOn({ x: 10, y: 20, k }, 400, -250, 1000, 700);
      expect(v.k).toBe(k);
      const b = viewBox(v, 1000, 700);
      expect(b.x + b.w / 2).toBeCloseTo(400, 6);
      expect(b.y + b.h / 2).toBeCloseTo(-250, 6);
    }
  });
});
