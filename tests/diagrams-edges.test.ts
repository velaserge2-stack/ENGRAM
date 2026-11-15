import { describe, expect, it } from 'vitest';
import { edgeGeometry } from '../src/diagrams/edges';

const nums = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
const A = { x: 0, y: 0, w: 100, h: 40 }, B = { x: 0, y: 200, w: 100, h: 40 }, C = { x: 300, y: 150, w: 100, h: 40 };
const lineEnd = (d: string) => { const n = nums(d); return { x: n[n.length - 2]!, y: n[n.length - 1]! }; };
const headPts = (d: string) => { const n = nums(d); return [0, 2, 4].map(i => ({ x: n[i]!, y: n[i + 1]! })); };
const o = (w = 2) => ({ width: w, ends: 'flecha' as const });

describe('edgeGeometry', () => {
  it('la línea termina en la base de la punta y la punta apunta al destino', () => {
    for (const route of ['recta', 'curva', 'orto'] as const) {
      const g = edgeGeometry(A, B, route, o());
      const [tip, b1, b2] = headPts(g.head!.d);
      const base = { x: (b1!.x + b2!.x) / 2, y: (b1!.y + b2!.y) / 2 };
      const e = lineEnd(g.d);
      expect(Math.hypot(e.x - base.x, e.y - base.y)).toBeLessThan(0.3);
      expect(tip!.y).toBeCloseTo(200 - 20 - 4, 0); // borde superior del destino con hueco de 4
      expect(Math.hypot(tip!.x - base.x, tip!.y - base.y)).toBeGreaterThanOrEqual(10);
    }
  });
  it('ángulo: la tangente final coincide con la dirección de la punta (recta, curva, orto)', () => {
    for (const route of ['recta', 'curva', 'orto'] as const) {
      const g = edgeGeometry(A, C, route, o(3));
      const [tip, b1, b2] = headPts(g.head!.d);
      const base = { x: (b1!.x + b2!.x) / 2, y: (b1!.y + b2!.y) / 2 };
      const n = nums(g.d), len = n.length;
      const prev = { x: n[len - 4]!, y: n[len - 3]! }; // punto de control 2 / punto anterior
      const t = { x: base.x - prev.x, y: base.y - prev.y }, h = { x: tip!.x - base.x, y: tip!.y - base.y };
      const cross = (t.x * h.y - t.y * h.x) / (Math.hypot(t.x, t.y) * Math.hypot(h.x, h.y));
      expect(Math.abs(cross)).toBeLessThan(0.03);
      expect(t.x * h.x + t.y * h.y).toBeGreaterThan(0);
    }
  });
  it('ancla en el borde real: rombo y píldora', () => {
    const dia = { x: 0, y: 200, w: 100, h: 100, shape: 'diamond' as const };
    const g = edgeGeometry(A, dia, 'recta', o());
    const tip = headPts(g.head!.d)[0]!;
    expect(Math.abs(tip.x) / 50 + Math.abs(tip.y - 200) / 50).toBeCloseTo(1 + 4 / 50, 0);
    const pill = { x: 300, y: 0, w: 100, h: 40, shape: 'round' as const };
    const g2 = edgeGeometry(A, pill, 'recta', o());
    expect(headPts(g2.head!.d)[0]!.x).toBeCloseTo(250 - 4, 0);
  });
  it('extremos: sin, ambos, circulo, rombo; grosor escala la punta; labelAt entre nodos', () => {
    expect(edgeGeometry(A, B, 'curva', { width: 2, ends: 'sin' }).head).toBeUndefined();
    const both = edgeGeometry(A, B, 'orto', { width: 2, ends: 'ambos' });
    expect(both.head && both.tail).toBeTruthy();
    expect(edgeGeometry(A, B, 'recta', { width: 2, ends: 'circulo' }).head!.d.match(/L/g)!.length).toBeGreaterThan(8);
    expect(edgeGeometry(A, B, 'recta', { width: 2, ends: 'rombo' }).head!.d.match(/L/g)!.length).toBe(3);
    const big = headPts(edgeGeometry(A, { ...B, y: 600 }, 'recta', o(8)).head!.d);
    expect(Math.hypot(big[0]!.x - big[1]!.x, big[0]!.y - big[1]!.y)).toBeGreaterThan(30);
    const l = edgeGeometry(A, B, 'curva', o()).labelAt;
    expect(l.y).toBeGreaterThan(20); expect(l.y).toBeLessThan(180);
    expect(edgeGeometry(A, A, 'orto', o()).d).not.toContain('NaN');
  });
});
