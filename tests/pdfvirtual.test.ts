import { describe, expect, it } from 'vitest';
import { fitPixels, Heights, RenderQueue, visibleRange } from '../src/pdf/virtual';

describe('visor de PDF virtualizado (Prompt 11)', () => {
  it('tabla de alturas: posiciones, página en una posición y corrección al medir', () => {
    const h = new Heights(800, 1.5, { 3: 0.5 });
    expect(h.slot(1, 400)).toBe(610);
    expect(h.top(1, 400)).toBe(0);
    expect(h.top(3, 400)).toBe(1220);
    expect(h.top(4, 400)).toBe(1220 + 210);
    expect(h.total(400)).toBe(799 * 610 + 210);
    expect(h.pageAt(0, 400)).toBe(1);
    expect(h.pageAt(609, 400)).toBe(1);
    expect(h.pageAt(610, 400)).toBe(2);
    expect(h.pageAt(1e9, 400)).toBe(800);
    expect(h.set(2, 1.0, 400)).toBe(-200);
    expect(h.top(3, 400)).toBe(1020);
    expect(h.exceptions(1.5)).toEqual({ 2: 1, 3: 0.5 });
    expect(h.set(2, 1.0, 400)).toBe(0);
  });
  it('ventana visible: visibles ± margen, acotada; cero páginas lejanas', () => {
    const h = new Heights(800, 1.414);
    const r = visibleRange(h, 600, 0, 800);
    expect(r.from).toBe(1);
    expect(r.to - r.from + 1).toBeLessThanOrEqual(7);
    const mid = visibleRange(h, 600, h.top(400, 600), 800);
    expect(mid.from).toBe(398);
    expect(mid.to).toBeLessThanOrEqual(404);
    expect(mid.center).toBe(400);
    const end = visibleRange(h, 600, h.total(600) - 800, 800);
    expect(end.to).toBe(800);
  });
  it('cola de render: 2 a la vez, prioridad, cancelar', async () => {
    const q = new RenderQueue(2);
    const order: string[] = [];
    let max = 0;
    const gate: Record<string, () => void> = {};
    const job = (id: string) => (signal: AbortSignal) => new Promise<void>((res, rej) => {
      order.push(id);
      max = Math.max(max, q.running);
      gate[id] = res;
      signal.addEventListener('abort', () => rej(new Error('cancelado')));
    });
    q.add('p5', 5, job('p5'));
    q.add('p9', 9, job('p9'));
    q.add('p1', 1, job('p1'));
    q.add('p3', 3, job('p3'));
    expect(order).toEqual(['p5', 'p9']);
    expect(q.pending).toBe(2);
    q.cancel('p3');
    gate.p5!();
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['p5', 'p9', 'p1']);
    q.cancel('p9');
    await new Promise((r) => setTimeout(r, 0));
    expect(q.running).toBe(1);
    expect(max).toBeLessThanOrEqual(2);
  });
  it('presupuesto de píxeles: la enfocada recibe su tope; las demás bajan', () => {
    const MP = 1e6;
    expect(fitPixels(20 * MP, 0, 40 * MP, 16 * MP, true)).toBe(16 * MP);
    expect(fitPixels(8 * MP, 10 * MP, 40 * MP, 16 * MP, false)).toBe(8 * MP);
    expect(fitPixels(8 * MP, 36 * MP, 40 * MP, 16 * MP, false)).toBe(4 * MP);
    expect(fitPixels(8 * MP, 45 * MP, 40 * MP, 16 * MP, false)).toBe(1.6 * MP);
  });
});
