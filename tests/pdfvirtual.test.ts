import { describe, expect, it } from 'vitest';
import { fitPixels, Heights, PAGE_GAP, RenderQueue, visibleRange } from '../src/pdf/virtual';

describe('visor de PDF virtualizado (Prompt 11)', () => {
  it('tabla de alturas: posiciones, página en una posición y corrección al medir', () => {
    const h = new Heights(800, 1.5, { 3: 0.5 });
    const G = PAGE_GAP;
    expect(h.slot(1, 400)).toBe(600 + G);
    expect(h.top(1, 400)).toBe(0);
    expect(h.top(3, 400)).toBe(2 * (600 + G));
    expect(h.top(4, 400)).toBe(2 * (600 + G) + 200 + G);
    expect(h.total(400)).toBe(799 * (600 + G) + 200 + G);
    expect(h.pageAt(0, 400)).toBe(1);
    expect(h.pageAt(600 + G - 1, 400)).toBe(1);
    expect(h.pageAt(600 + G, 400)).toBe(2);
    expect(h.pageAt(1e9, 400)).toBe(800);
    expect(h.set(2, 1.0, 400)).toBe(-200);
    expect(h.top(3, 400)).toBe(2 * (600 + G) - 200);
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
  it('el hueco deja sitio al número de página (18 px bajo la hoja)', () => {
    expect(PAGE_GAP).toBeGreaterThanOrEqual(24);
  });
  it('ventana con página extra en el sentido del desplazamiento', () => {
    const h = new Heights(800, 1.414);
    const base = visibleRange(h, 600, h.top(400, 600), 800, 1);
    expect(visibleRange(h, 600, h.top(400, 600), 800, 1, 1).to).toBe(base.to + 1);
    expect(visibleRange(h, 600, h.top(400, 600), 800, 1, -1).from).toBe(base.from - 1);
  });
  it('cola de render: cancelar y volver a encolar el mismo id (zoom/rotar) sí vuelve a renderizar', async () => {
    const q = new RenderQueue(2);
    const ran: string[] = [];
    const gates: (() => void)[] = [];
    const job = (tag: string) => (signal: AbortSignal) => new Promise<void>((res, rej) => {
      ran.push(tag);
      gates.push(res);
      signal.addEventListener('abort', () => rej(new Error('cancelado')));
    });
    q.add('p1', 0, job('a'));
    q.cancel('p1'); // el efecto de Page: cleanup (cancel) + add seguidos
    q.add('p1', 0, job('b'));
    await new Promise((r) => setTimeout(r, 0));
    expect(ran).toEqual(['a', 'b']); // antes: el segundo se descartaba y la página quedaba en blanco
    expect(q.running).toBe(1); // el cancelado ya terminó (abort lo rechaza); queda el nuevo
    q.add('p1', 0, job('c')); // el vigente no se duplica
    expect(ran).toEqual(['a', 'b']);
    gates[1]!();
  });
  it('cola de render: la cancelada sigue ocupando su hueco hasta terminar', async () => {
    const q = new RenderQueue(1);
    const ran: string[] = [];
    let finishA!: () => void;
    q.add('p1', 0, () => new Promise<void>((res) => { ran.push('a'); finishA = res; })); // ignora el abort (render que tarda)
    q.cancel('p1');
    q.add('p1', 0, async () => { ran.push('b'); });
    expect(ran).toEqual(['a']);
    finishA();
    await new Promise((r) => setTimeout(r, 0));
    expect(ran).toEqual(['a', 'b']);
  });
  it('cola de render: prioridad por distancia a la página actual', async () => {
    const q = new RenderQueue(1);
    const ran: string[] = [];
    let first!: () => void;
    q.add('p0', 0, () => new Promise<void>((res) => { ran.push('p0'); first = res; }));
    const cur = 10;
    for (const n of [14, 11, 9, 12]) q.add(`p${n}`, Math.abs(n - cur), async () => { ran.push(`p${n}`); });
    first();
    await new Promise((r) => setTimeout(r, 0));
    expect(ran).toEqual(['p0', 'p11', 'p9', 'p12', 'p14']);
    // al cambiar la página actual, los que esperan se reordenan
    const q2 = new RenderQueue(1);
    const r2: string[] = [];
    let f2!: () => void;
    q2.add('p0', 0, () => new Promise<void>((res) => { r2.push('p0'); f2 = res; }));
    for (const n of [5, 6, 20, 21]) q2.add(`p${n}`, Math.abs(n - 5), async () => { r2.push(`p${n}`); });
    q2.reprioritize((id) => Math.abs(Number(id.slice(1)) - 20));
    f2();
    await new Promise((r) => setTimeout(r, 0));
    expect(r2.slice(0, 3)).toEqual(['p0', 'p20', 'p21']);
  });
  it('presupuesto de píxeles: la enfocada recibe su tope; las demás bajan', () => {
    const MP = 1e6;
    expect(fitPixels(20 * MP, 0, 40 * MP, 16 * MP, true)).toBe(16 * MP);
    expect(fitPixels(8 * MP, 10 * MP, 40 * MP, 16 * MP, false)).toBe(8 * MP);
    expect(fitPixels(8 * MP, 36 * MP, 40 * MP, 16 * MP, false)).toBe(4 * MP);
    expect(fitPixels(8 * MP, 45 * MP, 40 * MP, 16 * MP, false)).toBe(1.6 * MP);
  });
});
