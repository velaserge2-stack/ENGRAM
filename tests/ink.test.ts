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

import { drawingHeight, PAGE_H, parseDrawing } from '../src/ink/DrawingBlock';
describe('notas manuscritas', () => {
  it('el bloque crece hacia abajo con lo escrito; el cuaderno va por páginas', () => {
    const d = parseDrawing(JSON.stringify({ v: 1, h: 0.4, strokes: [line('a', 0.1, 0.9, 0.5, 0.9)] }));
    expect(drawingHeight(d)).toBeCloseTo(0.9 + 0.12);
    const nb = parseDrawing(JSON.stringify({ v: 1, h: 1, paper: 'rayado', pages: 3, strokes: [] }));
    expect(nb.paper).toBe('rayado');
    expect(drawingHeight(nb)).toBeCloseTo(3 * PAGE_H);
    expect(parseDrawing('roto')).toMatchObject({ strokes: [], h: 0.4 });
    expect(parseDrawing('{"paper":"neón","strokes":[]}').paper).toBeUndefined();
  });
});

import { isFreeMarker, liveSegments, markerExport, newStroke, strokeAlpha, wideWidth } from '../src/ink/model';
describe('marcador', () => {
  const pts = (n: number) => Array.from({ length: n }, (_, i) => [0.1 + (i / n) * 0.8, 0.3 + Math.sin(i / 20) * 0.01, 0.2 + (i % 5) / 10] as [number, number, number]);
  const mk = (n = 40) => newStroke('marker', 'm', '#ffd60a', 4, pts(n), false, 0.4)!;
  it('se guarda como resaltador libre (una build vieja lo ve como tinta y no lo pierde)', () => {
    const s = mk();
    expect(s).toMatchObject({ tool: 'highlighter', free: true, alpha: 0.4 });
    expect(isFreeMarker(s)).toBe(true);
    expect(isFreeMarker({ tool: 'highlighter' })).toBe(false); // el inteligente sigue igual
    expect(newStroke('highlighter', 'h', '#fff', 4, pts(3), false, 0.4)).not.toHaveProperty('free');
    expect(newStroke('eraser', 'x', '#fff', 4, [], false, 1)).toBeNull();
  });
  it('ida y vuelta sin pérdida; un `marker` suelto se normaliza; herramienta desconocida se descarta', () => {
    const doc = { v: 1 as const, strokes: [mk(), line('p', 0, 0.1, 1, 0.1)] };
    expect(parseInk(JSON.stringify(doc))).toEqual(doc);
    const loose = parseInk(JSON.stringify({ strokes: [{ id: 'q', tool: 'marker', color: '#000', size: 4, pts: [[0, 0, 1], [1, 1, 1]] }, { id: 'z', tool: 'laser', color: '#000', size: 4, pts: [] }] }));
    expect(loose.strokes).toHaveLength(1);
    expect(loose.strokes[0]).toMatchObject({ tool: 'highlighter', free: true });
  });
  it('un archivo anterior (sin `free` ni `alpha`) sale igual y se pinta como siempre', () => {
    const old = JSON.stringify({ v: 1, strokes: [{ id: 'a', tool: 'highlighter', color: '#ffd60a', size: 4, pts: [[0.1, 0.1, 0.5], [0.5, 0.1, 0.5]] }, { id: 'b', tool: 'pen', color: '#000', size: 2, pts: [[0.1, 0.2, 0.5], [0.5, 0.2, 0.5]] }] });
    const d = parseInk(old);
    expect(JSON.stringify(d)).toBe(JSON.stringify({ v: 1, strokes: JSON.parse(old).strokes }));
    expect(isFreeMarker(d.strokes[0]!)).toBe(false);
    expect(strokeAlpha(d.strokes[0]!)).toBe(0.35);
    expect(strokeAlpha(d.strokes[1]!)).toBe(1);
  });
  it('geometría: ancho ×4 constante (sin presión) y puntas planas; el inteligente no cambia de forma', () => {
    const straight = pts(40).map(([a, , q]) => [a, 0.3, q] as [number, number, number]);
    const m0 = { ...mk(), pts: straight };
    const flat = outline(m0, 600);
    const hs = { ...m0, free: undefined, alpha: undefined } as Stroke;
    const round = outline(hs, 600);
    const thick = (o: [number, number][]) => { const ys = o.filter(([x]) => x > 200 && x < 400).map((q) => q[1]); return Math.max(...ys) - Math.min(...ys); };
    expect(thick(flat)).toBeCloseTo(wideWidth(4, 600), 0); // 16 px
    expect(thick(round)).toBeCloseTo(thick(flat), 0);
    const x = (o: [number, number][]) => Math.min(...o.map((q) => q[0]));
    expect(x(flat)).toBeGreaterThan(x(round) - 1e-6); // sin punta redonda sobresaliendo
    const hard = { ...m0, pts: straight.map(([a, b], i) => [a, b, i % 2 ? 1 : 0.05] as [number, number, number]) };
    expect(thick(outline(hard, 600))).toBeCloseTo(thick(flat), 0); // la presión no cambia el ancho
  });
  it('exportación: multiplicar con su opacidad; el bolígrafo, normal', () => {
    expect(markerExport(mk())).toEqual({ opacity: 0.4, blendMode: 'Multiply' });
    expect(markerExport(line('p', 0, 0, 1, 1))).toBeNull();
  });
  it('incremental == completo y barato con 2 000 puntos', () => {
    const P = pts(2000);
    const all = liveSegments(P, 0);
    // cada llamada pinta desde donde quedó la anterior
    let drawn = 0; const chunks: ReturnType<typeof liveSegments> = [];
    for (const end of [1, 8, 134, 701, 2000]) { chunks.push(...liveSegments(P.slice(0, end), drawn)); drawn = end; }
    expect(chunks).toEqual(all);
    expect(all).toHaveLength(1999);
    expect(all[0]!.join).toBe(false);
    expect(all[1]!.join).toBe(true);
    // tiempo por fotograma: añadir 10 puntos al final de un trazo de 2 000 vs recalcular el contorno entero
    const t = (f: () => void) => { const t0 = performance.now(); for (let i = 0; i < 50; i++) f(); return (performance.now() - t0) / 50; };
    const incMs = t(() => liveSegments(P, 1990));
    const fullMs = t(() => outline({ ...mk(), pts: P }, 600));
    expect(incMs).toBeLessThan(fullMs / 5);
    expect(incMs).toBeLessThan(2);
  });
});
