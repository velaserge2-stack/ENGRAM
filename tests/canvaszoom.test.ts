import { describe, expect, it } from 'vitest';
import { clampZoom, resist, zoomAt, ZOOM_MAX, ZOOM_MIN } from '../src/lib/canvaszoom';

describe('zoom del lienzo (Prompt 7 · 1)', () => {
  it('clamp a los límites', () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(9)).toBe(ZOOM_MAX);
    expect(clampZoom(1)).toBe(1);
  });
  it('ancla en el punto medio: ese punto del contenido no se mueve', () => {
    const v = { x: 40, y: -20, k: 1 };
    const n = zoomAt(v, 0.5, 300, 200);
    // punto del plano bajo (300, 200) antes y después
    expect((300 - v.x) / v.k).toBeCloseTo((300 - n.x) / n.k);
    expect((200 - v.y) / v.k).toBeCloseTo((200 - n.y) / n.k);
  });
  it('en el tope el gesto se consume sin mover ni deslizar el contenido', () => {
    let v = { x: 0, y: 0, k: 1 };
    for (let i = 0; i < 200; i++) v = zoomAt(v, 0.8, 500, 400);
    expect(v.k).toBeGreaterThanOrEqual(ZOOM_MIN);
    expect(v.k).toBeLessThan(ZOOM_MIN + 0.01);
    const again = zoomAt(v, 0.5, 100, 100);
    expect(again).toBe(v); // nada cambia: ni zoom ni posición
    let w = { x: 0, y: 0, k: 1 };
    for (let i = 0; i < 200; i++) w = zoomAt(w, 1.3, 10, 10);
    expect(w.k).toBeLessThanOrEqual(ZOOM_MAX);
    expect(zoomAt(w, 2, 0, 0).k).toBeLessThanOrEqual(ZOOM_MAX);
  });
  it('resistencia: cerca del mínimo el mismo gesto aleja menos', () => {
    expect(resist(1, 0.8)).toBe(0.8);
    expect(resist(0.15, 0.8)).toBeGreaterThan(0.8);
    expect(resist(0.15, 1.2)).toBe(1.2); // acercar no tiene resistencia
    expect(resist(2.8, 1.2)).toBeLessThan(1.2);
  });
  it('factores inválidos no cambian nada', () => {
    const v = { x: 1, y: 2, k: 1 };
    expect(zoomAt(v, NaN, 0, 0)).toBe(v);
    expect(zoomAt(v, 0, 0, 0)).toBe(v);
  });
});

import { awakePanels, onScreen } from '../src/lib/canvaszoom';
describe('culling del lienzo (Prompt 11 · 5)', () => {
  const v = { x: 0, y: 0, k: 1 };
  it('en pantalla con margen', () => {
    expect(onScreen({ id: 'a', x: 100, y: 100, w: 200, h: 200 }, v, 1000, 700)).toBe(true);
    expect(onScreen({ id: 'b', x: 1150, y: 0, w: 200, h: 200 }, v, 1000, 700)).toBe(true); // dentro del margen
    expect(onScreen({ id: 'c', x: 1300, y: 0, w: 200, h: 200 }, v, 1000, 700)).toBe(false);
    expect(onScreen({ id: 'd', x: -900, y: 0, w: 200, h: 200 }, v, 1000, 700, 0)).toBe(false);
    // al alejar (k = 0.5) el mismo panel entra
    expect(onScreen({ id: 'c', x: 1300, y: 0, w: 200, h: 200 }, { x: 0, y: 0, k: 0.5 }, 1000, 700)).toBe(true);
  });
  it('solo despiertan los visibles, con tope y prioridad del foco', () => {
    const ps = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, x: (i % 6) * 700, y: Math.floor(i / 6) * 600, w: 640, h: 560 }));
    const a = awakePanels(ps, v, 1000, 700, null, 4);
    expect([...a].every((id) => ['p0', 'p1', 'p6', 'p7'].includes(id))).toBe(true);
    const b = awakePanels(ps, { x: 0, y: 0, k: 0.2 }, 1000, 700, 'p0', 4);
    expect(b.size).toBe(4);
    expect(b.has('p0')).toBe(true);
    // el foco fuera de pantalla no despierta
    expect(awakePanels(ps, v, 1000, 700, 'p29', 4).has('p29')).toBe(false);
  });
});
