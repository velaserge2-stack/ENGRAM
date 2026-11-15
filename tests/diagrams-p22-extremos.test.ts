import { describe, expect, it } from 'vitest';
import { applyEdit, parseOutline } from '../src/diagrams/edit';
import { parseDiagram, readBackdrop } from '../src/diagrams/parse';
import { serializeDiagram } from '../src/diagrams/serialize';
import { layoutLayered, layoutTree } from '../src/diagrams/layout';
import { measureDoc, measureNode, setMeasurer, clearMeasureCache } from '../src/diagrams/measure';
import { diagramToSvg } from '../src/diagrams/export';
import { exportPdf, PdfExportError } from '../src/diagrams/export-pdf';
import { diagramFence, setFenceAlto } from '../src/notes/diagramtype';
import type { DiagramDoc, DiagramKind, Layout } from '../src/diagrams/types';

// Pruebas de casos extremos (Prompt 22 · Probador de extremos). Datos del peor caso (skill break-ui).
// Regla: no lanza, ida y vuelta idéntica del texto, y el resultado tiene sentido.

const rt = (t: string, k: DiagramKind) => serializeDiagram(parseDiagram(t, k).doc);
const finite = (l: Layout) => [...l.pos.values()].every((p) => [p.x, p.y, p.w, p.h].every(Number.isFinite));
const mapa = (n: number) => 'Raíz\n' + Array.from({ length: n - 1 }, (_, i) => `- n${i}\n`).join('');
const emptyDoc = (kind: DiagramKind): DiagramDoc => parseDiagram('', kind).doc;

// Medidor determinista (sin canvas): 0,6 em por carácter.
const fake = (t: string, f: string) => t.length * parseFloat(/(\d+(?:\.\d+)?)px/.exec(f)?.[1] ?? '15') * 0.6;

describe('P22 extremos · tamaño de documento', () => {
  it('300 nodos: completo y con layout finito; 301: tooBig, texto intacto', () => {
    const a = parseDiagram(mapa(300), 'mapa');
    expect(a.tooBig).toBe(false);
    expect(a.doc.nodes.length).toBe(300);
    expect(finite(layoutTree(a.doc))).toBe(true);
    expect(serializeDiagram(a.doc)).toBe(mapa(300));
    const b = parseDiagram(mapa(301), 'mapa');
    expect(b.tooBig).toBe(true);
    expect(serializeDiagram(b.doc)).toBe(mapa(301));
  });
  it('mapa vacío, solo saltos de línea y un solo nodo', () => {
    for (const t of ['', '\n', '\n\n\n']) {
      const r = parseDiagram(t, 'mapa');
      expect(r.doc.nodes.length).toBe(0);
      expect(serializeDiagram(r.doc)).toBe(t);
      expect(finite(layoutTree(r.doc))).toBe(true);
      expect(finite(layoutTree(emptyDoc('mapa')))).toBe(true);
    }
    const one = parseDiagram('Solo\n', 'mapa');
    expect(one.doc.nodes.length).toBe(1);
    expect(layoutTree(one.doc).pos.size).toBe(1);
    expect(serializeDiagram(one.doc)).toBe('Solo\n');
  });
  it('flujo vacío y un solo nodo sin aristas', () => {
    expect(finite(layoutLayered(emptyDoc('flujo'), 'TB'))).toBe(true);
    const r = parseDiagram('[Solo]\n', 'flujo');
    expect(r.doc.nodes.length).toBe(1);
    expect(finite(layoutLayered(r.doc, 'LR'))).toBe(true);
    expect(serializeDiagram(r.doc)).toBe('[Solo]\n');
  });
  it('ciclos en flujo: layout finito, ida y vuelta', () => {
    const t = '[A] --> [B]\n[B] --> [C]\n[C] --> [A]\n[A] --> [A]\n[B] <--> [A]\n';
    const r = parseDiagram(t, 'flujo');
    expect(r.doc.nodes.length).toBe(3);
    expect(finite(layoutLayered(r.doc, 'TB'))).toBe(true);
    expect(finite(layoutLayered(r.doc, 'LR'))).toBe(true);
    expect(serializeDiagram(r.doc)).toBe(t);
  });
});

describe('P22 extremos · texto', () => {
  it('texto de 5 000 caracteres: se mide completo', () => {
    const t = 'a'.repeat(5000);
    const m = measureNode({ text: t, shape: 'rect', fontSize: 15, maxW: 220 }, fake);
    expect(m.lines.join('').length).toBe(5000);
    expect(Number.isFinite(m.h)).toBe(true);
  });
  it('texto de 5 001 caracteres: el parser lo marca (tope) y la medida se trunca a 5 000', () => {
    const t = 'b'.repeat(5001);
    const r = parseDiagram(`Raíz\n- ${t}\n`, 'mapa');
    expect(r.errors.some((e) => e.code === 'tope')).toBe(true);
    expect(serializeDiagram(r.doc)).toBe(`Raíz\n- ${t}\n`);
    const m = measureNode({ text: t, shape: 'rect', fontSize: 15, maxW: 220 }, fake);
    expect(m.lines.join('').length).toBe(5000);
  });
  it('palabra de 2 000 letras sin espacios: corte por caracteres, sin desbordar', () => {
    const w = 'W'.repeat(2000);
    const m = measureNode({ text: w, shape: 'rect', fontSize: 15, maxW: 220 }, fake);
    expect(m.lines.length).toBeGreaterThan(10);
    expect(m.lines.join('')).toBe(w);
    expect(Math.max(...m.lines.map((l) => l.length * 15 * 0.6))).toBeLessThanOrEqual(220);
  });
  it('solo emoji y CJK: ida y vuelta y medida finita', () => {
    const e = '🙂🙂🙂🚀🚀🚀';
    expect(rt(`Raíz\n- ${e}\n`, 'mapa')).toBe(`Raíz\n- ${e}\n`);
    const cjk = '日本語のテキストは折り返されるべきです漢字かな';
    expect(rt(`Raíz\n- ${cjk}\n`, 'mapa')).toBe(`Raíz\n- ${cjk}\n`);
    const mc = measureNode({ text: cjk, shape: 'rect', fontSize: 15, maxW: 120 });
    expect(mc.lines.join('')).toBe(cjk);
    expect(Number.isFinite(mc.w) && Number.isFinite(mc.h)).toBe(true);
    const me = measureNode({ text: e, shape: 'round', fontSize: 15, maxW: 80 });
    expect(me.lines.join('')).toBe(e);
  });
  it('RTL (árabe): ida y vuelta sin invertir ni perder caracteres', () => {
    const ar = 'مرحبا بالعالم هذا نص عربي طويل جدا للتفاف';
    const t = `[${ar}] --> [B]\n`;
    expect(rt(t, 'flujo')).toBe(t);
    const m = measureNode({ text: ar, shape: 'rect', fontSize: 15, maxW: 120 }, fake);
    expect(m.lines.join(' ').replace(/\s+/g, ' ').trim()).toBe(ar);
  });
  it('** sin cerrar y * suelto: no lanza, las marcas no salen en la medida', () => {
    const t = 'Raíz\n- **negrita sin cerrar\n- *cursiva suelta\n- [[enlace\n';
    expect(rt(t, 'mapa')).toBe(t);
    const m = measureNode({ text: '**sin cerrar y *otra', shape: 'rect', fontSize: 15, maxW: 220 }, fake);
    expect(m.lines.join('')).not.toMatch(/\*/);
    expect(m.lines.join('')).toBe('sin cerrar y otra');
  });
});

describe('P22 extremos · pegar 200 líneas con sangrías raras', () => {
  const lines: string[] = [];
  for (let i = 0; i < 200; i++) {
    const depth = (i * 7) % 4; // saltos de hasta 3 niveles entre líneas consecutivas
    const pad = i % 3 === 0 ? '\t'.repeat(depth) : i % 3 === 1 ? ' '.repeat(depth * 3) : ' '.repeat(depth * 2 + 1);
    const bullet = ['- ', '* ', '• ', `${(i % 9) + 1}. `, `${(i % 9) + 1}) `][i % 5]!;
    lines.push(`${pad}${bullet}item ${i} con \t tabulador`);
  }
  const pasted = lines.join('\n');

  it('parseOutline: profundidad sube como mucho +1 y no pierde ítems', () => {
    const items = parseOutline(pasted);
    expect(items.length).toBe(200);
    let prev = -1;
    for (const it of items) {
      expect(it.depth).toBeLessThanOrEqual(prev + 1);
      expect(it.depth).toBeGreaterThanOrEqual(0);
      prev = it.depth;
    }
  });
  it('addTree en un paso y deshacer exacto', () => {
    const base = parseDiagram('Raíz\n- A\n', 'mapa').doc;
    const parent = base.nodes.find((n) => n.text === 'Raíz')!.id;
    const before = serializeDiagram(base);
    const r = applyEdit(base, { op: 'addTree', parent, items: parseOutline(pasted) });
    expect(r.doc.nodes.length).toBe(2 + 200);
    const after = serializeDiagram(r.doc);
    expect(after).not.toBe(before);
    expect(serializeDiagram(parseDiagram(after, 'mapa').doc)).toBe(after);
    let back = r.doc;
    for (const inv of r.inverse) back = applyEdit(back, inv).doc;
    expect(serializeDiagram(back)).toBe(before);
    expect(finite(layoutTree(r.doc))).toBe(true);
  });
});

describe('P22 extremos · tamaños manuales absurdos', () => {
  it('valores fuera de rango en el texto: literales, sin aplicar, y ida y vuelta', () => {
    // Nota: un sufijo entre dos nodos de la misma línea (`[A] {…} --> [B]`) no es gramática: la línea da error «forma» y queda literal.
    const f = '[A] {w=0,h=abc,color=9,fs=xl}\n[A] --> [B] {w=-5}\n[C] {w=999999,h=-1,color=0}\n';
    const r = parseDiagram(f, 'flujo');
    expect(serializeDiagram(r.doc)).toBe(f);
    for (const n of r.doc.nodes) {
      expect(n.w).toBeUndefined();
      expect(n.h).toBeUndefined();
      expect(n.color).toBeUndefined();
    }
    expect(r.doc.nodes.find((n) => n.text === 'A')!.fs).toBeUndefined();
    expect(r.doc.edges[0]!.w).toBeUndefined();
    expect(r.doc.edges[0]!.extra).toEqual(['w=-5']);
    expect(finite(layoutLayered(r.doc, 'TB'))).toBe(true);
  });
  it('mapa con los mismos valores: nodo íntegro y medida finita', () => {
    const t = 'Raíz\n- Uno {w=0,h=abc,color=9,fs=xl,maxw=-3}\n- Dos {w=-5,h=99999}\n';
    const r = parseDiagram(t, 'mapa');
    expect(r.doc.nodes.map((n) => n.text)).toEqual(['Raíz', 'Uno', 'Dos']);
    expect(serializeDiagram(r.doc)).toBe(t);
    const ms = measureDoc(r.doc, fake);
    for (const m of ms.values()) expect(Number.isFinite(m.w) && Number.isFinite(m.h)).toBe(true);
    expect(finite(layoutTree(r.doc, 'horizontal', new Map([...ms].map(([k, m]) => [k, { w: m.w, h: m.h }]))))).toBe(true);
  });
  it('set con valores absurdos vía applyEdit: el texto escrito se reparsea sin romper', () => {
    const d = parseDiagram('Raíz\n- Uno\n', 'mapa').doc;
    const id = d.nodes.find((n) => n.text === 'Uno')!.id;
    for (const set of [{ w: 0 }, { w: -5 }, { w: 999999 }, { h: 0 }, { color: 9 as never }]) {
      const r = applyEdit(d, { op: 'attrs', ids: [id], set });
      const text = serializeDiagram(r.doc);
      expect(serializeDiagram(parseDiagram(text, 'mapa').doc)).toBe(text);
    }
  });
  it('applyEdit con valor fuera de rango: no se escribe (texto y memoria iguales); control con valor válido sí', () => {
    const d = parseDiagram('Raíz\n- Uno\n', 'mapa').doc;
    const id = d.nodes.find((n) => n.text === 'Uno')!.id;
    for (const set of [{ w: 0 }, { w: -5 }, { w: 999999 }, { h: 99999 }, { maxw: 5 }, { fs: 'xl' as never }, { color: 9 as never }]) {
      const r = applyEdit(d, { op: 'attrs', ids: [id], set });
      expect(serializeDiagram(r.doc)).toBe(serializeDiagram(d));
      expect(r.doc.nodes.find((n) => n.id === id)).toEqual(d.nodes.find((n) => n.id === id));
    }
    const ok = applyEdit(d, { op: 'attrs', ids: [id], set: { w: 300 } });
    expect(serializeDiagram(ok.doc)).toBe('Raíz\n- Uno {w=300}\n');
    expect(parseDiagram(serializeDiagram(ok.doc), 'mapa').doc.nodes.find((n) => n.text === 'Uno')!.w).toBe(300);
  });
  it('clave repetida {color=1,color=2}: no lanza, ida y vuelta', () => {
    const t = 'Raíz\n- Uno {color=1,color=2}\n';
    const r = parseDiagram(t, 'mapa');
    expect(serializeDiagram(r.doc)).toBe(t);
    expect([1, 2, undefined]).toContain(r.doc.nodes[1]!.color);
  });
  it('grupos vacíos {} no son sufijo: quedan en el texto', () => {
    const t = 'Raíz\n- Uno {}\n- Dos {} {}\n';
    const r = parseDiagram(t, 'mapa');
    expect(r.doc.nodes.map((n) => n.text)).toEqual(['Raíz', 'Uno {}', 'Dos {} {}']);
    expect(serializeDiagram(r.doc)).toBe(t);
  });
  it('fondo inventado: cristal y la línea queda literal', () => {
    const t = '# fondo: inventado\n[A] --> [B]\n';
    expect(readBackdrop(t)).toBe('cristal');
    const r = parseDiagram(t, 'flujo');
    expect(r.doc.nodes.length).toBe(2);
    expect(serializeDiagram(r.doc)).toBe(t);
  });
});

describe('P22 extremos · alto en la info del fence', () => {
  it('alto=-1 y alto=99999 se ignoran y el bloque no cambia', () => {
    for (const info of ['alto=-1', 'alto=99999']) {
      const block = '```mapa ' + info + '\nRaíz\n- A\n```';
      expect(diagramFence(block)?.alto).toBeUndefined();
      expect(setFenceAlto(block, 99999)).toBe(block); // h fuera de rango: sin cambio
      expect(setFenceAlto(block, -1)).toBe(block);
    }
    expect(diagramFence('```mapa alto=-1\nRaíz\n```')?.src).toBe('Raíz');
  });
  it('alto válido sí se lee y se reescribe solo la línea de apertura', () => {
    const block = '```mapa alto=420\nRaíz\n- A {color=2}\n```';
    expect(diagramFence(block)?.alto).toBe(420);
    expect(setFenceAlto(block, 99999)).toBe(block);
  });
});

describe('P22 extremos · salida (SVG y PDF)', () => {
  it('SVG de un doc con texto de 5 000 caracteres es finito y no vacío', () => {
    const t = `Raíz\n- ${'z'.repeat(5000)}\n`;
    const d = parseDiagram(t, 'mapa').doc;
    const svg = diagramToSvg(d);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toMatch(/NaN|Infinity/);
  });
  it('PDF: vectorial o error tipado; nunca un fallo sin código', async () => {
    const d = parseDiagram(mapa(120), 'mapa').doc;
    const measured = measureDoc(d, fake);
    const layout = layoutTree(d, 'horizontal', new Map([...measured].map(([k, m]) => [k, { w: m.w, h: m.h }])));
    try {
      const r = await exportPdf(d, layout, measured, { page: 'a4', fit: 'varias', margin: 24, title: 'Prueba' });
      expect(['vector', 'raster']).toContain(r.mode);
      expect(r.blob.size).toBeGreaterThan(0);
    } catch (e) {
      expect(e).toBeInstanceOf(PdfExportError);
      expect(['paginas', 'tamano', 'fallo']).toContain((e as PdfExportError).code);
    }
  });
});

describe('P22 extremos · medidor inyectado', () => {
  // FALLO REAL (menor, hipotético): un medidor que devuelve NaN contamina w/h. El canvas real no lo devuelve, así que no es un fallo de uso.
  it.fails('setMeasurer con medidor que devuelve NaN no rompe la medida (queda finita)', () => {
    setMeasurer(() => NaN);
    try {
      clearMeasureCache();
      const m = measureNode({ text: 'hola mundo', shape: 'rect', fontSize: 15, maxW: 220 });
      expect(Number.isFinite(m.w) && Number.isFinite(m.h)).toBe(true);
    } finally {
      setMeasurer(null);
      clearMeasureCache();
    }
  });
});
