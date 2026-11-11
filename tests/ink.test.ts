import { describe, expect, it } from 'vitest';
import { acceptPointer, eraseArea, eraseStrokes, History, inkHeight, lassoSelect, moveStrokes, outline, parseInk, type Stroke, straighten, svgPath } from '../src/ink/model';

const line = (id: string, x0: number, y0: number, x1: number, y1: number, n = 10): Stroke => ({ id, tool: 'pen', color: '#000', size: 4, pts: Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, 0.3 + (0.6 * i) / n]) });

describe('motor de tinta', () => {
  it('contorno suave con perfect-freehand; el grosor sigue a la presión y escala con el zoom', () => {
    const s = line('a', 0.1, 0.1, 0.5, 0.1);
    const p1 = outline(s, 600), p2 = outline(s, 1200);
    expect(p1.length).toBeGreaterThan(8);
    const h = (p: [number, number][]) => Math.max(...p.map((q) => q[1])) - Math.min(...p.map((q) => q[1]));
    expect(h(p2) / h(p1)).toBeCloseTo(2, 0); // el doble de ancho, el doble de grosor: coordenadas normalizadas
    expect(svgPath(p1)).toMatch(/^M [\d.]+ [\d.]+ Q/);
  });
  it('borrador por trazo y por área, lazo y mover', () => {
    const doc = { v: 1 as const, strokes: [line('a', 0, 0.1, 1, 0.1), line('b', 0, 0.5, 1, 0.5)] };
    expect(eraseStrokes(doc, [0.5, 0.1], 0.02).strokes.map((s) => s.id)).toEqual(['b']);
    const cut = eraseArea(doc, [0.5, 0.1], 0.05);
    expect(cut.strokes.filter((s) => s.pts[0]![1] === 0.1)).toHaveLength(2); // el trazo «a» se parte en dos
    const sel = lassoSelect(doc, [[-0.1, 0.4], [1.1, 0.4], [1.1, 0.6], [-0.1, 0.6]]);
    expect([...sel]).toEqual(['b']);
    const moved = moveStrokes(doc, sel, 0, 0.2);
    expect(moved.strokes[1]!.pts[0]![1]).toBeCloseTo(0.7);
    expect(inkHeight(moved)).toBeCloseTo(0.7);
  });
  it('regla, deshacer/rehacer ilimitado y archivos dañados', () => {
    const st = straighten([[0, 0, 0.5], [0.3, 0.2, 0.5], [0.5, 0, 0.5]]);
    expect(st.every((p) => Math.abs(p[1]) < 1e-9)).toBe(true);
    const h = new History({ v: 1, strokes: [] });
    for (let i = 0; i < 30; i++) h.push({ v: 1, strokes: [...h.doc.strokes, line(String(i), 0, i / 30, 1, i / 30)] });
    for (let i = 0; i < 30; i++) h.undo();
    expect(h.doc.strokes).toHaveLength(0);
    h.redo(); h.redo();
    expect(h.doc.strokes).toHaveLength(2);
    expect(parseInk('{"strokes":[{"pts":[[1,"x",0]]}]}').strokes).toEqual([]);
    expect(parseInk('basura').strokes).toEqual([]);
  });
  it('rechazo de palma', () => {
    expect(acceptPointer('pen', 'pencil', 0, 0, false)).toBe(true);
    expect(acceptPointer('touch', 'pencil', 0, 10_000, false)).toBe(false); // solo Pencil: el dedo desplaza
    expect(acceptPointer('touch', 'scroll', 0, 10_000, false)).toBe(false);
    expect(acceptPointer('touch', 'draw', 9_700, 10_000, false)).toBe(false); // palma justo tras el lápiz
    expect(acceptPointer('touch', 'draw', 0, 10_000, true)).toBe(false); // lápiz apoyado
    expect(acceptPointer('touch', 'draw', 0, 10_000, false)).toBe(true);
  });
});
