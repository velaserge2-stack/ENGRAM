import { describe, expect, it } from 'vitest';
import { fbarPlace } from '../src/diagrams/gestures';

describe('fbarPlace (barra flotante con zoom de página)', () => {
  it('sin zoom de página manda el CSS', () => {
    expect(fbarPlace({ scale: 1, offsetLeft: 0, offsetTop: 0, width: 1024, height: 768 })).toBeNull();
  });
  it('con zoom 2: abajo-centro de la ventana visual y a escala 1/2', () => {
    const p = fbarPlace({ scale: 2, offsetLeft: 100, offsetTop: 50, width: 512, height: 384 })!;
    expect(p.scale).toBe(0.5);
    expect(p.left).toBe(100 + 256);
    expect(p.top).toBe(50 + 384 - 6);
  });
});
