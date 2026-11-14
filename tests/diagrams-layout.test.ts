import { describe, expect, it } from 'vitest';
import { layoutLayered, layoutTree, nodeSize } from '../src/diagrams/layout';
import type { DiagramDoc, DiagramEdge, DiagramNode, Layout } from '../src/diagrams/types';

const node = (id: string, extra: Partial<DiagramNode> = {}): DiagramNode => ({ id, shape: 'rect', text: id, depth: 0, line: 0, ...extra });
function flow(ids: string[], pairs: [string, string][], extra: Record<string, Partial<DiagramNode>> = {}, edgeExtra: Partial<DiagramEdge> = {}): DiagramDoc {
  return {
    kind: 'flujo', eol: '\n', lines: [],
    nodes: ids.map(id => node(id, extra[id])),
    edges: pairs.map(([from, to], i) => ({ id: 'e' + i, from, to, arrow: 'to', line: i, ...edgeExtra })),
  };
}
const P = (l: Layout, id: string) => l.pos.get(id)!;
function overlaps(l: Layout): boolean {
  const bs = [...l.pos.values()];
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
    const a = bs[i]!, b = bs[j]!;
    if (Math.abs(a.x - b.x) * 2 < a.w + b.w - 1 && Math.abs(a.y - b.y) * 2 < a.h + b.h - 1) return true;
  }
  return false;
}
/** Generador con semilla (sin Math.random). */
function rng(seed: number) { return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
function bigFlow(n: number, extra: number, seed = 7): DiagramDoc {
  const rand = rng(seed);
  const ids = Array.from({ length: n }, (_, i) => 'n' + i);
  const pairs: [string, string][] = [];
  for (let i = 1; i < n; i++) pairs.push(['n' + Math.floor(rand() * i), 'n' + i]);
  for (let k = 0; k < extra; k++) pairs.push(['n' + Math.floor(rand() * n), 'n' + Math.floor(rand() * n)]);
  return flow(ids, pairs);
}

describe('layoutLayered', () => {
  it('cadena lineal: capas crecientes hacia abajo (tb) y a la derecha (lr)', () => {
    const d = flow(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
    const tb = layoutLayered(d, 'TB');
    expect(P(tb, 'a').y).toBeLessThan(P(tb, 'b').y);
    expect(P(tb, 'b').y).toBeLessThan(P(tb, 'c').y);
    expect(P(tb, 'a').x).toBe(P(tb, 'c').x);
    const lr = layoutLayered(d, 'lr');
    expect(P(lr, 'a').x).toBeLessThan(P(lr, 'b').x);
    expect(P(lr, 'b').x).toBeLessThan(P(lr, 'c').x);
    expect(P(lr, 'a').y).toBe(P(lr, 'c').y);
    expect(tb.paths.size).toBe(2);
    expect(tb.paths.get('e0')).toMatch(/^M [-\d]+ [-\d]+ C /);
  });

  it('rombo: decisión con dos ramas que se unen, sin solaparse', () => {
    const d = flow(['ini', 'dec', 'si', 'no', 'fin'], [['ini', 'dec'], ['dec', 'si'], ['dec', 'no'], ['si', 'fin'], ['no', 'fin']], { dec: { shape: 'diamond' } });
    const l = layoutLayered(d, 'tb');
    expect(P(l, 'si').y).toBe(P(l, 'no').y);
    expect(P(l, 'si').x).not.toBe(P(l, 'no').x);
    expect(P(l, 'fin').y).toBeGreaterThan(P(l, 'si').y);
    expect(P(l, 'dec').w).toBe(nodeSize({ shape: 'diamond', text: 'dec' }).w);
    expect(overlaps(l)).toBe(false);
    expect(l.paths.size).toBe(5);
  });

  it('ciclo: termina, capas finitas y la flecha de retroceso conserva su sentido', () => {
    const d = flow(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['c', 'a']]);
    const l = layoutLayered(d, 'TB');
    expect(P(l, 'a').y).toBeLessThan(P(l, 'b').y);
    expect(P(l, 'b').y).toBeLessThan(P(l, 'c').y);
    // c → a: arranca en c (abajo) y termina en a (arriba).
    const nums = l.paths.get('e2')!.match(/-?\d+/g)!.map(Number);
    expect(nums[1]).toBeGreaterThan(nums[nums.length - 1]!);
    expect(nums[1]).toBe(P(l, 'c').y - P(l, 'c').h / 2);
    expect(nums[nums.length - 1]).toBe(P(l, 'a').y + P(l, 'a').h / 2);
    // Ciclo puro sin fuente y lazo propio.
    const pure = layoutLayered(flow(['x', 'y'], [['x', 'y'], ['y', 'x'], ['x', 'x']]), 'TB');
    expect(pure.pos.size).toBe(2);
    expect(pure.paths.size).toBe(3);
    expect(overlaps(pure)).toBe(false);
  });

  it('sin aristas: todos en una franja, sin solaparse', () => {
    const l = layoutLayered(flow(['a', 'b', 'c', 'd'], []), 'TB');
    expect(l.pos.size).toBe(4);
    expect(new Set([...l.pos.values()].map(b => b.y)).size).toBe(1);
    expect(overlaps(l)).toBe(false);
    expect(l.paths.size).toBe(0);
  });

  it('doc vacío y aristas a nodos inexistentes no rompen', () => {
    const empty = layoutLayered(flow([], []), 'TB');
    expect(empty.pos.size).toBe(0);
    expect(empty.bounds).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    const bad = layoutLayered(flow(['a'], [['a', 'zz']]), 'TB');
    expect(bad.pos.size).toBe(1);
    expect(bad.paths.size).toBe(0);
  });

  it('desconectados: cada componente en su franja y los huérfanos aparte', () => {
    const d = flow(['a', 'b', 'c', 'd', 'solo'], [['a', 'b'], ['c', 'd']]);
    const l = layoutLayered(d, 'TB');
    const right = (id: string) => P(l, id).x + P(l, id).w / 2, left = (id: string) => P(l, id).x - P(l, id).w / 2;
    expect(Math.max(right('a'), right('b'))).toBeLessThan(Math.min(left('c'), left('d')));
    expect(P(l, 'solo').y).toBeGreaterThan(Math.max(P(l, 'b').y, P(l, 'd').y));
    expect(overlaps(l)).toBe(false);
    const lr = layoutLayered(d, 'LR');
    expect(P(lr, 'b').y + P(lr, 'b').h / 2).toBeLessThan(P(lr, 'c').y - P(lr, 'c').h / 2);
    expect(overlaps(lr)).toBe(false);
  });

  it('reduce cruces: un orden cruzado se desenreda', () => {
    // a→d, b→c con el texto en orden a,b / c,d: el baricentro pone d bajo a y c bajo b.
    const l = layoutLayered(flow(['a', 'b', 'c', 'd'], [['a', 'd'], ['b', 'c']]), 'TB');
    expect(P(l, 'a').x < P(l, 'b').x).toBe(P(l, 'd').x < P(l, 'c').x);
  });

  it('respeta x/y manuales y traza aristas largas por puntos de paso', () => {
    const d = flow(['a', 'b', 'c'], [['a', 'b'], ['b', 'c'], ['a', 'c']], { b: { x: 500, y: 40 } });
    const l = layoutLayered(d, 'TB');
    expect(P(l, 'b')).toMatchObject({ x: 500, y: 40 });
    expect(l.paths.get('e2')!.split('C').length).toBe(3); // a → punto de paso → c
    for (const route of ['recta', 'orto'] as const) {
      const lr = layoutLayered(flow(['a', 'b'], [['a', 'b']], {}, { route }), 'LR');
      expect(lr.paths.get('e0')).toMatch(/^M [-\d]+ [-\d]+ L /);
    }
  });

  it('determinista: dos llamadas dan lo mismo', () => {
    const d = bigFlow(120, 60);
    const a = layoutLayered(d, 'TB'), b = layoutLayered(structuredClone(d), 'TB');
    expect([...a.pos]).toEqual([...b.pos]);
    expect([...a.paths]).toEqual([...b.paths]);
    expect(a.bounds).toEqual(b.bounds);
  });

  it('300 nodos: completa, sin solaparse y dentro de los límites (avisa si > 50 ms)', () => {
    const d = bigFlow(300, 150);
    layoutLayered(d, 'TB'); // calentamiento
    const t0 = performance.now();
    const l = layoutLayered(d, 'TB');
    const ms = performance.now() - t0;
    if (ms > 50) console.warn(`layoutLayered con 300 nodos tardó ${ms.toFixed(1)} ms (objetivo < 50 ms)`);
    else console.info(`layoutLayered 300 nodos: ${ms.toFixed(1)} ms`);
    expect(l.pos.size).toBe(300);
    expect(l.paths.size).toBe(d.edges.length);
    expect(overlaps(l)).toBe(false);
    for (const b of l.pos.values()) {
      expect(b.x - b.w / 2).toBeGreaterThanOrEqual(l.bounds.x);
      expect(b.y + b.h / 2).toBeLessThanOrEqual(l.bounds.y + l.bounds.h);
    }
  });
});

describe('layoutTree', () => {
  const map = (rows: [string, string | undefined, Partial<DiagramNode>?][]): DiagramDoc => ({
    kind: 'mapa', eol: '\n', lines: [], edges: [],
    nodes: rows.map(([id, parent, extra], i) => node(id, { parent, line: i, ...extra })),
  });

  it('horizontal: raíz en 0,0, hijos a la derecha y sin solaparse', () => {
    const d = map([['r', undefined], ['a', 'r'], ['a1', 'a'], ['a2', 'a'], ['b', 'r']]);
    const l = layoutTree(d);
    expect(P(l, 'r')).toMatchObject({ x: 0, y: 0 });
    expect(P(l, 'a').x).toBeGreaterThan(0);
    expect(P(l, 'a1').x).toBeGreaterThan(P(l, 'a').x);
    expect(P(l, 'a').y).toBeLessThan(P(l, 'b').y);
    expect(overlaps(l)).toBe(false);
    expect([...l.paths.keys()]).toEqual(['a', 'a1', 'a2', 'b']);
  });

  it('ramas plegadas no tienen hijos; raíz sola = un nodo', () => {
    const l = layoutTree(map([['r', undefined], ['a', 'r', { folded: true }], ['a1', 'a']]));
    expect(l.pos.has('a')).toBe(true);
    expect(l.pos.has('a1')).toBe(false);
    expect(layoutTree(map([['r', undefined]])).pos.size).toBe(1);
    expect(layoutTree(map([])).pos.size).toBe(0);
  });

  it('x/y manual relativo a la raíz; los descendientes lo siguen', () => {
    const base = layoutTree(map([['r', undefined], ['a', 'r'], ['a1', 'a']]));
    const l = layoutTree(map([['r', undefined], ['a', 'r', { x: 300, y: -200 }], ['a1', 'a']]));
    expect(P(l, 'a')).toMatchObject({ x: 300, y: -200 });
    expect(P(l, 'a1').x - P(l, 'a').x).toBe(P(base, 'a1').x - P(base, 'a').x);
    expect(P(l, 'a1').y - P(l, 'a').y).toBe(P(base, 'a1').y - P(base, 'a').y);
  });

  it('radial: anillos por nivel alrededor de la raíz', () => {
    const rows: [string, string | undefined][] = [['r', undefined]];
    for (let i = 0; i < 6; i++) { rows.push(['c' + i, 'r']); rows.push(['g' + i, 'c' + i]); }
    const l = layoutTree(map(rows), 'radial');
    const dist = (id: string) => Math.hypot(P(l, id).x, P(l, id).y);
    expect(P(l, 'r')).toMatchObject({ x: 0, y: 0 });
    expect(dist('g0')).toBeGreaterThan(dist('c0'));
    expect(Math.abs(dist('c0') - dist('c3'))).toBeLessThan(2);
    expect(overlaps(l)).toBe(false);
  });

  it('padres en ciclo o inexistentes no cuelgan y es determinista', () => {
    const d = map([['r', undefined], ['x', 'y'], ['y', 'x'], ['z', 'nadie']]);
    const a = layoutTree(d), b = layoutTree(d);
    expect(a.pos.size).toBe(4);
    expect([...a.pos]).toEqual([...b.pos]);
    expect(overlaps(a)).toBe(false);
  });
});
