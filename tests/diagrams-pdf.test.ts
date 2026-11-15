import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { parseDiagram } from '../src/diagrams/parse';
import { exportLayout } from '../src/diagrams/export';
import { exportPdf, fitLineSize, MAX_PAGES, MAX_SIDE, PdfExportError, planPages, planTiles, type PdfOpts } from '../src/diagrams/export-pdf';
import { setMeasurer } from '../src/diagrams/measure';

beforeEach(() => setMeasurer((t, f) => [...t].length * parseFloat(/(\d+)px/.exec(f)![1]!) * 0.55));
afterEach(() => setMeasurer(null));

// PNG 1×1 válido para la fábrica de canvas simulada.
const PNG1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const pdfOf = async (src: string, opts: Partial<PdfOpts>, kind: 'flujo' | 'mapa' = 'flujo') => {
  const d = parseDiagram(src, kind).doc;
  const { layout, measured } = exportLayout(d);
  const calls: [number, number][] = [];
  const r = await exportPdf(d, layout, measured, { page: 'ajustar', fit: 'una', margin: 24, render: async (_s, w, h) => { calls.push([w, h]); return PNG1; }, ...opts });
  const pdf = await PDFDocument.load(await r.blob.arrayBuffer());
  return { r, pdf, calls };
};
const chain = (n: number) => Array.from({ length: n }, (_, i) => `[N${i}] --> [N${i + 1}]`).join('\n');

describe('PDF de diagramas', () => {
  it('vectorial, ajustar: una página que abre con pdf-lib', async () => {
    const { r, pdf } = await pdfOf('[Inicio] --> [¿Sí?]\n[¿Sí?] -- etiqueta --> [Fin]', { title: 'Título ñ', date: '15 nov 2026' });
    expect(r.mode).toBe('vector');
    expect(r.pages).toBe(1);
    expect(pdf.getPageCount()).toBe(1);
    expect(r.blob.type).toBe('application/pdf');
  });
  it('ajustar: lado ≤ 14 400 pt aunque el diagrama sea enorme', async () => {
    const { pdf } = await pdfOf(chain(200), { page: 'ajustar' });
    const { width, height } = pdf.getPage(0).getSize();
    expect(Math.max(width, height)).toBeLessThanOrEqual(MAX_SIDE + 0.01);
  });
  it('A4 una página y A4 varias páginas (con número esperado)', async () => {
    const una = await pdfOf(chain(40), { page: 'a4', fit: 'una' });
    expect(una.pdf.getPageCount()).toBe(1);
    const [w, h] = [una.pdf.getPage(0).getWidth(), una.pdf.getPage(0).getHeight()].map(Math.round);
    expect([w, h].sort()).toEqual([595, 842]);
    const d = parseDiagram(chain(40), 'flujo').doc;
    const { layout, measured } = exportLayout(d);
    const plan = planPages({ x: 0, y: 0, w: layout.bounds.w + 48, h: layout.bounds.h + 48 }, { page: 'a4', fit: 'varias', margin: 24 });
    const varias = await pdfOf(chain(40), { page: 'a4', fit: 'varias' });
    expect(varias.r.pages).toBeGreaterThan(1);
    expect(varias.pdf.getPageCount()).toBe(plan.pages.length);
    void measured;
  });
  it('carta: orientación automática (horizontal si es más ancho)', () => {
    const p = planPages({ x: 0, y: 0, w: 900, h: 300 }, { page: 'carta', fit: 'una', margin: 36 });
    expect(p.pages[0]!.w).toBe(792);
  });
  it('tope de páginas: error claro', () => {
    expect(() => planPages({ x: 0, y: 0, w: 20000, h: 20000 }, { page: 'a4', fit: 'varias', margin: 24 })).toThrow(PdfExportError);
    try { planPages({ x: 0, y: 0, w: 20000, h: 20000 }, { page: 'a4', fit: 'varias', margin: 24 }); } catch (e) { expect((e as PdfExportError).code).toBe('paginas'); }
    expect(MAX_PAGES).toBe(50);
  });
  it('texto con emoji → raster', async () => {
    const { r, pdf, calls } = await pdfOf('[Hola 🎉] --> [B]', { title: 'Con 🎉' });
    expect(r.mode).toBe('raster');
    expect(pdf.getPageCount()).toBe(1);
    expect(calls.length).toBeGreaterThan(0);
  });
  it('mosaicos cuando el canvas pasaría de 16 M px', async () => {
    const { r, calls } = await pdfOf(chain(120) + '\n[✓]', { page: 'ajustar' });
    expect(r.mode).toBe('raster');
    expect(calls.length).toBeGreaterThan(1);
    for (const [w, h] of calls) { expect(w * h).toBeLessThanOrEqual(16_000_000); expect(Math.max(w, h)).toBeLessThanOrEqual(8192); }
    const t = planTiles(10000, 5000);
    expect(t.reduce((a, x) => a + x.w * x.h, 0)).toBe(50_000_000);
    expect(t.every((x) => x.w * x.h <= 16_000_000)).toBe(true);
  });
  it('regla de ajuste: reduce solo la línea que se sale', () => {
    expect(fitLineSize(80, 15, 100)).toBe(15);
    expect(fitLineSize(200, 15, 100)).toBeCloseTo(7.5);
  });
  it('mapa mental en vectorial', async () => {
    const { r } = await pdfOf('Raíz\n- Hijo\n  - Nieto', { page: 'carta', fit: 'una' }, 'mapa');
    expect(r.mode).toBe('vector');
  });
});
