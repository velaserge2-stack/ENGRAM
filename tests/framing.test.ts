import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAMING, framedRect, normFraming, parseFramings } from '../src/lib/framing';

describe('encuadre de fondos', () => {
  it('por defecto equivale a object-fit: cover centrado', () => {
    expect(framedRect(2000, 1000, 1000, 1000)).toEqual({ x: -500, y: 0, w: 2000, h: 1000 });
  });
  it('posición: 0 % muestra el borde izquierdo, 100 % el derecho', () => {
    expect(framedRect(2000, 1000, 1000, 1000, { x: 0, y: 50, zoom: 1 }).x).toBe(0);
    expect(framedRect(2000, 1000, 1000, 1000, { x: 100, y: 50, zoom: 1 }).x).toBe(-1000);
  });
  it('el zoom escala desde el punto de la posición y siempre cubre la caja', () => {
    for (const x of [0, 30, 50, 100]) for (const zoom of [1, 1.5, 3]) {
      const r = framedRect(1600, 1200, 800, 1000, { x, y: 20, zoom });
      expect(r.x).toBeLessThanOrEqual(0.0001);
      expect(r.y).toBeLessThanOrEqual(0.0001);
      expect(r.x + r.w).toBeGreaterThanOrEqual(800 - 0.0001);
      expect(r.y + r.h).toBeGreaterThanOrEqual(1000 - 0.0001);
    }
  });
  it('archivos dañados o valores fuera de rango no rompen nada', () => {
    expect(parseFramings('no es json')).toEqual({});
    expect(parseFramings('[1,2]')).toEqual({});
    expect(parseFramings('{"a.jpg":{"x":140,"y":-3,"zoom":9}}')).toEqual({ 'a.jpg': { x: 100, y: 0, zoom: 3 } });
    expect(normFraming(null)).toEqual(DEFAULT_FRAMING);
  });
});
