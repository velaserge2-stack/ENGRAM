import { describe, expect, it } from 'vitest';
import { type CharBox, emptyAnnots, fingerprint, fromLegacy, marksToMarkdown, parseAnnots, samePdf, snapToText } from '../src/pdf/annots';

/** Dos líneas de texto: «La fibrilación auricular» y «no tiene ondas P». */
function chars(): CharBox[] {
  const line = (s: string, y: number) => [...s].map((ch, i) => ({ ch, x: 0.1 + i * 0.02, y, w: 0.018, h: 0.02 }));
  return [...line('La fibrilación auricular', 0.2), ...line('no tiene ondas P', 0.23)];
}

describe('anotaciones de PDF', () => {
  it('resaltador inteligente: ajusta a las líneas reales y a palabras completas', () => {
    // trazo que empieza a media palabra «fibrilación» y termina a media «auricular», solo en la 1.ª línea
    const r = snapToText(chars(), { x0: 0.1 + 6 * 0.02, x1: 0.1 + 17 * 0.02, y0: 0.195, y1: 0.225 });
    expect(r.text).toBe('fibrilación auricular');
    expect(r.rects).toHaveLength(1);
    expect(r.rects[0]![0]).toBeCloseTo(0.1 + 3 * 0.02); // empieza en la «f»
    // dos líneas
    const two = snapToText(chars(), { x0: 0.1, x1: 0.5, y0: 0.19, y1: 0.255 });
    expect(two.rects).toHaveLength(2);
    expect(two.text).toBe('La fibrilación auricular no tiene ondas P');
    expect(snapToText(chars(), { x0: 0.1, x1: 0.5, y0: 0.5, y1: 0.6 }).rects).toEqual([]);
  });
  it('coordenadas normalizadas: el mismo resaltado a cualquier zoom', () => {
    const r = snapToText(chars(), { x0: 0.1, x1: 0.15, y0: 0.19, y1: 0.215 }).rects[0]!;
    for (const W of [400, 800, 1600]) {
      const px = r.map((v, i) => v * (i % 2 ? W * 1.4 : W));
      expect(px[0]! / W).toBeCloseTo(r[0]);
    }
  });
  it('archivo auxiliar: ida y vuelta, dañado y migración del formato antiguo', () => {
    const a = emptyAnnots();
    a.pages['3'] = { rot: 90, ink: { v: 1, strokes: [] }, marks: [{ id: 'm', kind: 'underline', color: '#ffd60a', rects: [[0.1, 0.2, 0.3, 0.02]], text: 'texto', ts: 1 }], notes: [] };
    expect(parseAnnots(JSON.stringify(a))).toEqual(a);
    expect(parseAnnots('no')).toEqual(emptyAnnots());
    const old = fromLegacy(JSON.stringify({ pages: { 2: { strokes: [{ pts: [[50, 50, 0.5]], w: 2 }], highlights: [{ rects: [[10, 20, 30, 2]], text: 'viejo' }] } } }), () => 1.5);
    expect(old.pages['2']!.ink.strokes[0]!.pts[0]).toEqual([0.5, 0.75, 0.5]); // y en «anchos»: 50 % × 1.5
    expect(old.pages['2']!.marks[0]!.rects[0]).toEqual([0.1, 0.2, 0.3, 0.02]);
  });
  it('huella: detectar que el PDF se reemplazó', () => {
    const f = fingerprint(new Uint8Array([1, 2, 3]));
    expect(samePdf(null, f)).toBe(true);
    expect(samePdf(f, fingerprint(new Uint8Array([1, 2, 3])))).toBe(true);
    expect(samePdf(f, fingerprint(new Uint8Array([1, 2, 4])))).toBe(false);
  });
  it('resumen de resaltados en Markdown por página', () => {
    const a = emptyAnnots();
    a.pages['12'] = { rot: 0, ink: { v: 1, strokes: [] }, marks: [{ id: 'a', kind: 'highlight', color: '#ff0', rects: [], text: 'Elevación del ST', ts: 0 }], notes: [{ id: 'n', x: 0, y: 0, text: 'revisar', ts: 0 }] };
    const md = marksToMarkdown('Guía ECG', 'docs/guia.pdf', a, (p) => `#/pdfs/ver/docs/guia.pdf?p=${p}`);
    expect(md).toContain('## [Página 12](#/pdfs/ver/docs/guia.pdf?p=12)');
    expect(md).toContain('> Elevación del ST');
    expect(md).toContain('- 📝 revisar');
  });
});

import { pdfLink, progress, readMeta, updatePdfMeta } from '../src/pdf/library';
import { MemoryBackend } from '../src/vault/memory';
import { SafeVault } from '../src/vault/safe';
describe('biblioteca de PDF', () => {
  it('progreso y última página, sin pisar escrituras simultáneas', async () => {
    const v = new SafeVault(new MemoryBackend());
    await Promise.all([updatePdfMeta(v, 'docs/a.pdf', { pages: 200 }), updatePdfMeta(v, 'docs/a.pdf', { last: 50 }), updatePdfMeta(v, 'docs/b.pdf', { tags: ['ecg'] })]);
    const m = await readMeta(v);
    expect(m['docs/a.pdf']).toEqual({ pages: 200, last: 50 });
    expect(m['docs/b.pdf']).toEqual({ tags: ['ecg'] });
    expect(progress(m['docs/a.pdf']!)).toBe(0.25);
    expect(pdfLink('docs/Guía ECG.pdf', 12)).toBe('#/pdfs/ver/docs/Gu%C3%ADa%20ECG.pdf?p=12');
  });
});
