import { afterEach, describe, expect, it } from 'vitest';
import { clearMeasureCache, measureDoc, measureNode, setMeasurer } from '../src/diagrams/measure';
import { layoutLayered, layoutTree } from '../src/diagrams/layout';
import type { DiagramDoc } from '../src/diagrams/types';

// Medidor simulado: 8 px por carácter (negrita 10).
const mock = (t: string, f: string) => [...t].length * (f.includes('700') ? 10 : 8);
const base = { shape: 'rect' as const, fontSize: 15, maxW: 240 };
afterEach(() => setMeasurer(null));

describe('medición', () => {
  it('1000 caracteres se parten en varias líneas y ninguna excede el área', () => {
    const text = Array.from({ length: 200 }, () => 'hola').join(' ');
    const r = measureNode({ ...base, text }, mock);
    expect(r.lines.length).toBeGreaterThan(5);
    for (const l of r.lines) expect(mock(l, '') ).toBeLessThanOrEqual(240 - 24);
    expect(r.w).toBeLessThanOrEqual(240);
  });
  it('palabra sin espacios se corta por caracteres', () => {
    const r = measureNode({ ...base, text: 'x'.repeat(100) }, mock);
    expect(r.lines.length).toBeGreaterThan(3);
    expect(r.lines.join('')).toBe('x'.repeat(100));
  });
  it('CJK y emoji cuentan como caracteres', () => {
    const r = measureNode({ ...base, text: '日本語のテキスト😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀' }, mock);
    expect(r.lines.length).toBeGreaterThan(1);
    expect(r.lines.join('')).toContain('😀');
  });
  it('negrita mide con la fuente en negrita y las marcas no cuentan', () => {
    const plain = measureNode({ ...base, text: 'abcdef' }, mock);
    const bold = measureNode({ ...base, text: '**abcdef**' }, mock);
    expect(bold.lines).toEqual(['abcdef']);
    expect(bold.w).toBeGreaterThan(plain.w);
    expect(measureNode({ ...base, text: '*abcdef* [[x]]' }, mock).lines).toEqual(['abcdef x']);
  });
  it('rombo es ≈ √2 mayor e io/píldora añaden relleno lateral', () => {
    const r = measureNode({ ...base, text: 'hola' }, mock), d = measureNode({ ...base, shape: 'diamond', text: 'hola' }, mock);
    expect(d.w).toBeGreaterThanOrEqual(Math.floor(r.w * Math.SQRT2) - 1);
    expect(d.h).toBeGreaterThanOrEqual(r.h);
    expect(measureNode({ ...base, shape: 'io', text: 'hola' }, mock).w).toBe(r.w + 16);
    expect(measureNode({ ...base, shape: 'round', text: 'hola' }, mock).w).toBeGreaterThan(r.w);
  });
  it('el tamaño manual nunca baja del mínimo medido', () => {
    const m = measureNode({ ...base, text: 'hola mundo' }, mock);
    const small = measureNode({ ...base, text: 'hola mundo', manualW: 24, manualH: 24 }, mock);
    expect(small.w).toBe(m.w); expect(small.h).toBe(m.h);
    expect(measureNode({ ...base, text: 'hola', manualW: 500, manualH: 300 }, mock)).toMatchObject({ w: 500, h: 300 });
  });
  it('tope de 5000 caracteres, memo y medidor inyectable', () => {
    const r = measureNode({ ...base, text: 'a '.repeat(6000) }, mock);
    expect(r.lines.join(' ').replace(/\s/g, '').length).toBeLessThanOrEqual(5000);
    let calls = 0;
    setMeasurer((t) => (calls++, t.length * 7));
    const i = { ...base, text: 'uno dos' };
    measureNode(i); const c = calls; measureNode(i);
    expect(calls).toBe(c);
    clearMeasureCache(); measureNode(i); expect(calls).toBeGreaterThan(c);
  });
  it('sin canvas usa estimación determinista y measureDoc aplica fs/maxw', () => {
    const doc = { kind: 'flujo', eol: '\n', lines: [], edges: [], nodes: [
      { id: 'a', shape: 'rect', text: 'palabra '.repeat(20), depth: 0, line: 0 },
      { id: 'b', shape: 'rect', text: 'palabra '.repeat(20), depth: 0, line: 1, maxw: 120, fs: 'l' },
    ] } as unknown as DiagramDoc;
    const m = measureDoc(doc);
    expect(m.get('b')!.lines.length).toBeGreaterThan(m.get('a')!.lines.length);
    expect(measureDoc(doc).get('a')).toEqual(m.get('a'));
    // sizes en layout
    const sizes = new Map([...m].map(([k, v]) => [k, { w: v.w, h: v.h }]));
    expect(layoutLayered(doc, 'TB', sizes).pos.get('b')!.w).toBe(m.get('b')!.w);
    expect(layoutTree({ ...doc, kind: 'mapa' }, 'horizontal', sizes).pos.get('a')!.h).toBe(m.get('a')!.h);
  });
});
