// Prompt 22 · revisión de seguridad de diagramas (rama fix-diagramas). Los `it` normales demuestran los PASA;
// los antiguos HALLAZGOS están arreglados (ver «Correcciones» en estado-p22-seguridad.md).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { applyEdit, parseOutline } from '../src/diagrams/edit';
import { buildScene, diagramToSvg, exportLayout, gridPath } from '../src/diagrams/export';
import { planPages, planTiles, PdfExportError } from '../src/diagrams/export-pdf';
import { pasteEdits } from '../src/diagrams/inline';
import { setMeasurer } from '../src/diagrams/measure';
import { PALETTE_DARK, PALETTE_LIGHT } from '../src/diagrams/palette';
import { parseDiagram, readBackdrop, readHeight } from '../src/diagrams/parse';
import { MAX_NODES, MAX_TEXT } from '../src/diagrams/types';
import { EdgeG, nodeClass } from '../src/diagrams/view';
import { diagramFence, fenceAlto, replaceBlockAt, setFenceAlto } from '../src/notes/diagramtype';

beforeEach(() => setMeasurer((t, f) => t.length * parseFloat(/(\d+)px/.exec(f)![1]!) * 0.55));
afterEach(() => setMeasurer(null));

const EVIL = `<script>alert(1)</script><img src=x onerror=alert(1)>"quote" 'apos' & &amp; javascript:`;
const svgOf = (src: string, kind: 'flujo' | 'diagrama' | 'mapa' = 'diagrama', backdrop?: 'claro' | 'oscuro' | 'cuadricula' | 'puntos') => {
  const d = parseDiagram(src, kind).doc;
  const { layout, measured } = exportLayout(d);
  return diagramToSvg(d, layout, measured, { backdrop });
};
const time = <T>(f: () => T) => { const a = performance.now(); const r = f(); return { r, ms: performance.now() - a }; };

describe('P22 · (1) inyección en SVG/PDF/PNG/print', () => {
  it('PASA: <script>, comillas y & del texto de nodo y de etiqueta salen escapados', () => {
    const svg = svgOf(`[${EVIL}] -- ${EVIL} --> {${EVIL}}`);
    expect(svg).not.toMatch(/<script|<img|<foreignObject/i);
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&quot;quote&quot;');
    expect(svg).toContain('&#39;apos&#39;');
    expect(svg).toContain('&amp;amp;'); // `&amp;` literal del usuario no se interpreta
    // ninguna comilla sin escapar rompe un atributo: todo lo que sigue a `>` hasta `<` es texto escapado
    for (const [, body] of svg.matchAll(/>([^<]*)</g)) expect(body).not.toMatch(/[<>"]/);
  });
  it('PASA: solo etiquetas y atributos de una lista fija; sin href, xlink, style, on*, javascript:', () => {
    const svg = svgOf(`[${EVIL}] --> [${EVIL}2]\n[a] {color=3} {color=1}`, 'diagrama', 'cuadricula');
    for (const [, name, attrs] of svg.matchAll(/<([a-zA-Z]+)([^>]*)>/g)) {
      expect(['svg', 'rect', 'path', 'g', 'text', 'tspan']).toContain(name);
      expect(attrs).not.toMatch(/\son\w+=|href|style=|javascript:|url\(/i);
    }
  });
  it('PASA: todo color pintado es un hex de la paleta o del tema; ninguno viene del texto', () => {
    const doc = parseDiagram('[A] {color=9}\n[B] -- x --> [C] {color=2,w=3}\n[D] --> [E] {color=3);fill:url(x)}', 'diagrama').doc;
    const { layout, measured } = exportLayout(doc);
    for (const bd of ['claro', 'gris', 'oscuro', 'cuadricula', 'puntos'] as const) {
      const sc = buildScene(doc, layout, measured, bd);
      const colors = [sc.bg, sc.gridColor, sc.labelInk, ...sc.nodes.flatMap((n) => [n.stroke, n.ink, ...(n.fill ? [n.fill] : [])]), ...sc.edges.map((e) => e.color)];
      for (const c of colors) expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
    const sc = buildScene(doc, layout, measured, 'claro');
    expect(sc.edges.some((e) => PALETTE_LIGHT.includes(e.color))).toBe(true);
    expect(PALETTE_LIGHT.length).toBe(8);
    expect(PALETTE_DARK.length).toBe(8);
  });
  it('PASA: print.ts / export-ui / export-pdf no usan innerHTML, eval ni red; el SVG impreso va como data: en un <img>', () => {
    const dir = join(__dirname, '../src/diagrams');
    const src = readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const);
    for (const [f, s] of src) {
      const code = s.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code, f).not.toMatch(/innerHTML|outerHTML|dangerouslySetInnerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|importScripts/);
      expect(code, f).not.toMatch(/import\(\s*['"`](https?:|\/\/)/);
      expect(code, f).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/);
    }
    const print = readFileSync(join(dir, 'print.ts'), 'utf8');
    expect(print).toContain("'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)");
  });
});

describe('P22 · (2) edición en el sitio y pegado de listas', () => {
  it('PASA: pegar texto con HTML solo produce ediciones de texto (el HTML queda como texto de nodo)', () => {
    const r = pasteEdits('Raíz', 'mapa', { parent: 'n0' }, `- <img src=x onerror=alert(1)>\n  - <script>x</script>`);
    expect(r?.edits[0]).toMatchObject({ op: 'addTree' });
    expect(JSON.stringify(r)).not.toContain('innerHTML');
    const a = applyEdit(parseDiagram('Raíz', 'mapa').doc, r!.edits[0]!);
    expect(a.doc.nodes.map((n) => n.text)).toContain('<script>x</script>');
    expect(diagramToSvg(a.doc)).not.toMatch(/<script|<img/i);
  });
  it('PASA: el <textarea> es un nodo de Preact (value), sin innerHTML en canvas.tsx/inline.ts/editor.tsx', () => {
    for (const f of ['canvas.tsx', 'inline.ts', 'editor.tsx', 'toolbar.tsx', 'handles.tsx', 'view.tsx']) {
      expect(readFileSync(join(__dirname, '../src/diagrams', f), 'utf8'), f).not.toMatch(/innerHTML|dangerouslySetInnerHTML/);
    }
  });
});

describe('P22 · (3) claves nuevas del formato: rango y CSS', () => {
  const bad = ['0', '9', '-1', '3.5', '1e3', '٣', '03x', '', '3);background:url(//x)', 'NaN', '99999999999999999999'];
  it('PASA: color fuera de 1–8 no se aplica a nodo ni a flecha (va a extra, nunca a CSS)', () => {
    for (const v of bad) {
      const d = parseDiagram(`[A] --> [B] {color=${v}}\n[C] {color=${v}}`, 'diagrama').doc;
      expect(d.edges[0]!.color, v).toBeUndefined();
      expect(d.nodes.find((n) => n.text === 'C')!.color, v).toBeUndefined();
      const m = parseDiagram(`Raíz {color=${v}}\n- a {color=${v}}`, 'mapa').doc;
      expect(m.nodes.every((n) => n.color === undefined), v).toBe(true);
    }
  });
  it('PASA: el CSS de la vista solo ve var(--diag-c1…8); nodeClass sin clases ajenas', () => {
    for (const v of bad) {
      const d = parseDiagram(`[A] --> [B] {color=${v}}`, 'diagrama').doc;
      expect(JSON.stringify(EdgeG({ e: d.edges[0]!, geo: { d: 'M 0 0', labelAt: { x: 0, y: 0 } } as never }))).not.toMatch(/var\(--diag-c\d/);
      expect(nodeClass(d.nodes[0]!, false, false)).not.toMatch(/diag-c\d/);
    }
    const ok = parseDiagram('[A] --> [B] {color=8}', 'diagrama').doc;
    expect(JSON.stringify(EdgeG({ e: ok.edges[0]!, geo: { d: 'M 0 0', labelAt: { x: 0, y: 0 } } as never }))).toContain('var(--diag-c8)');
  });
  it('PASA: w, h, maxw, fs, fin, x, y y la arista w fuera de rango no se aplican', () => {
    const d = parseDiagram('[A] {w=23,h=2001,maxw=79,fs=xl,x=100001,y=0}\n[B] --> [C] {w=0,fin=url(x)}\n[D] --> [E] {w=9,fin=calc(1px)}', 'diagrama').doc;
    const a = d.nodes[0]!;
    expect([a.w, a.h, a.maxw, a.fs, a.x, a.y]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(d.edges.every((e) => e.w === undefined && e.fin === undefined)).toBe(true);
    const ok = parseDiagram('[A] {w=24,h=2000,maxw=600,fs=l,x=-100000,y=100000}', 'diagrama').doc.nodes[0]!;
    expect([ok.w, ok.h, ok.maxw, ok.fs, ok.x, ok.y]).toEqual([24, 2000, 600, 'l', -100000, 100000]);
  });
  it('PASA: applyEdit rechaza atributos inválidos (color 9, 3.5, cadena) sin escribir nada', () => {
    const doc = parseDiagram('[A] --> [B]', 'diagrama').doc;
    for (const color of [9, 0, 3.5, '3);x' as unknown as number, NaN]) {
      expect(applyEdit(doc, { op: 'attrs', ids: ['n0'], set: { color: color as never } }).inverse).toEqual([]);
      expect(applyEdit(doc, { op: 'edgeAttrs', ids: ['e0'], set: { color: color as never } }).inverse).toEqual([]);
    }
  });
  it('PASA: fondo/alto: valor desconocido = por omisión; el nombre de clase solo sale de la lista', () => {
    for (const v of ['url(javascript:1)', 'oscuro;x', '"><script>', 'CLARO']) expect(readBackdrop('[a]', v)).toBe('cristal');
    expect(readBackdrop('# fondo: url(x)\n[a]')).toBe('cristal');
    expect(readBackdrop('# fondo: puntos\n[a]')).toBe('puntos');
    for (const v of ['159', '2001', '1e3', '-5', 'calc(1px)', '300px', '0x200']) { expect(readHeight(undefined, v), v).toBeUndefined(); expect(readHeight(`alto=${v}`), v).toBeUndefined(); }
    expect(readHeight('alto=160')).toBe(160);
    expect(readHeight(undefined, '2000')).toBe(2000);
  });
});

describe('P22 · (4) límites de recursos', () => {
  it('PASA: texto > 5 000 caracteres = línea literal con error `tope`; > 300 nodos = tooBig', () => {
    const r = parseDiagram(`[${'a'.repeat(MAX_TEXT + 1)}] --> [b]`, 'flujo');
    expect(r.doc.nodes).toHaveLength(0);
    expect(r.errors[0]?.code).toBe('tope');
    const big = parseDiagram(Array.from({ length: MAX_NODES + 1 }, (_, i) => `[n${i}]`).join('\n'), 'flujo');
    expect(big.tooBig).toBe(true);
  });
  it('PASA: addTree con 10 000 líneas se rechaza al instante; parseOutline lineal', () => {
    const doc = parseDiagram('Raíz', 'mapa').doc;
    const items = parseOutline(Array(10000).fill('- x').join('\n'));
    const { r, ms } = time(() => applyEdit(doc, { op: 'addTree', parent: 'n0', items }));
    expect(r.inverse).toEqual([]);
    expect(ms).toBeLessThan(500);
    expect(pasteEdits('Raíz', 'mapa', { parent: 'n0' }, Array(10000).fill('- x').join('\n'))).toBeNull();
  });
  it('PASA: PDF — más de 50 páginas lanza `paginas`; los mosaicos del raster respetan 16 M px y 8192 px de lado', () => {
    expect(() => planPages({ x: 0, y: 0, w: 200000, h: 200000 }, { page: 'a4', fit: 'varias', margin: 36 })).toThrow(PdfExportError);
    const p = planPages({ x: 0, y: 0, w: 200000, h: 200000 }, { page: 'ajustar', fit: 'una', margin: 36 });
    expect(p.pages[0]!.w).toBeLessThanOrEqual(14400);
    for (const [w, h] of [[40000, 40000], [8192, 100000], [3, 3]] as const) {
      for (const t of planTiles(w, h)) { expect(t.w * t.h).toBeLessThanOrEqual(16_000_000); expect(Math.max(t.w, t.h)).toBeLessThanOrEqual(8192); }
    }
  });
  it('alcance: x/y de ±100 000 llegan al acomodo y a los límites de exportación', () => {
    const d = parseDiagram('[A] {x=-100000,y=-100000}\n[B] {x=100000,y=100000}', 'diagrama').doc;
    const b = exportLayout(d).layout.bounds;
    expect(b.w).toBeGreaterThanOrEqual(200000);
    expect(b.h).toBeGreaterThanOrEqual(200000);
  });

  // HALLAZGO (medio): `readArrow` usa /^--\s+(.*?)\s*(-->|---)/ (parse.ts:69): `.*?` y `\s*` compiten por los mismos
  // espacios → coste cúbico. MAX_LINE subió de 1 000 a 5 500 en esta rama: `[a] --` + 4 000 espacios + `x` tarda ~7 s,
  // 5 000 espacios ~14 s, y se repite en cada render/pulsación (parseDiagram, walk de edit.ts) y al abrir la nota.
  it('ARREGLADO 4a: `[a] --` + 5 000 espacios + x se analiza en < 50 ms', () => {
    const { ms } = time(() => parseDiagram('[a] --' + ' '.repeat(5000) + 'x', 'flujo'));
    expect(ms).toBeLessThan(50);
  }, 60000);

  // HALLAZGO (leve): pegar una lista de N líneas en flujo/diagrama aplica N `addChild`, cada uno reanaliza todo el
  // documento (inline.ts:106-116) y no hay tope de elementos (en mapa `addTree` sí lo tiene). 3 000 líneas ≈ 5 s con el
  // hilo principal bloqueado; con 10 000, ≈ 1 min. Con textos repetidos los nodos se fusionan y no se llega a MAX_NODES.
  it('ARREGLADO 4c: pegar 2 000 líneas en flujo se rechaza o termina en < 1 s', () => {
    const { r, ms } = time(() => pasteEdits('[a]', 'flujo', { parent: 'n0' }, Array(2000).fill('- x').join('\n')));
    expect(r === null || ms < 1000).toBe(true);
    expect(ms).toBeLessThan(1000);
  }, 60000);

  // HALLAZGO (medio): `gridPath('puntos')` (export.ts, usado por sceneToSvg/print/PDF con `view = bounds`) genera una
  // cadena por punto cada 24 px sin tope. Con x/y = ±100 000 (válidos) y `# fondo: puntos`, el SVG tendría ~69 M puntos
  // (varios GB): cuelga o tumba la pestaña al exportar o imprimir (print.ts lo llama síncrono en `beforeprint`).
  it('ARREGLADO 4b: la rejilla de puntos de un área de 20 000 × 20 000 px no pasa de 5 MB', () => {
    expect(gridPath('puntos', { x: 0, y: 0, w: 20000, h: 20000 }).length).toBeLessThan(5_000_000);
  });

  // HALLAZGO (leve): `addChild`/`rename`/`looseLine` en flujo no comprueban MAX_TEXT (solo `mapaText` lo hace): un texto
  // de 5 200 caracteres cabe en MAX_LINE (5 500), la edición se «aplica» pero el parser lo descarta como `tope`
  // y el nodo desaparece de la vista (el texto queda en el archivo, sin pérdida de datos).
  it('ARREGLADO 4d: addChild en flujo con texto de 5 200 caracteres se rechaza o produce un nodo', () => {
    const doc = parseDiagram('[a]', 'flujo').doc;
    const r = applyEdit(doc, { op: 'addChild', parent: 'n0', text: 'x'.repeat(5200) });
    expect(r.inverse.length).toBe(0);
    expect(r.doc).toBe(doc);
  });
});

describe('P22 · (5) alto= del fence y setFenceAlto', () => {
  const block = (info: string, body = '[a] --> [b]') => '```flujo' + info + '\n' + body + '\n```';
  const lines = (s: string) => s.split('\n');
  it('PASA: solo cambia la línea de apertura; el cuerpo queda byte a byte', () => {
    const bodies = ['[a] --> [b]', '[x] -- alto=999 --> [y]', '```mapa alto=500\nfalso', '\n\n  [a]\t\r\n', '# alto=300\n\n[a]'];
    for (const body of bodies) for (const info of ['', ' alto=300', ' foo alto=300 bar', '\talto=5000', ' alto=', ' xalto=2']) {
      const b = block(info, body);
      const n = setFenceAlto(b, 420);
      expect(lines(n).slice(1)).toEqual(lines(b).slice(1));
      expect(lines(n)[0]).toMatch(/^```flujo( .*)? alto=420$|^```flujo\talto=420$|^```flujo\t.*alto=420$/);
      expect(diagramFence(n)?.alto).toBe(420);
      expect(diagramFence(n)?.src).toBe(diagramFence(b)?.src);
    }
  });
  it('PASA: h inválida o igual = mismo texto; no es fence de diagrama = mismo texto; CRLF conserva el resto', () => {
    const b = block(' alto=300');
    for (const h of [159, 2001, 300, 3.5, NaN, Infinity]) expect(setFenceAlto(b, h)).toBe(b);
    expect(setFenceAlto('```js alto=300\nx\n```', 400)).toBe('```js alto=300\nx\n```');
    expect(setFenceAlto('parrafo\n```mapa\nRaíz\n```', 400)).toBe('parrafo\n```mapa\nRaíz\n```');
    const crlf = '```mapa foo\r\nRaíz\r\n- a\r\n```';
    expect(setFenceAlto(crlf, 500)).toBe('```mapa foo alto=500\r\nRaíz\r\n- a\r\n```');
  });
  it('PASA: la info con basura no se interpreta; fenceAlto/readHeight coinciden en el rango', () => {
    for (const v of ['159', '160', '2000', '2001', '1e3', '0300', ' 300']) expect(fenceAlto(`alto=${v}`)).toBe(readHeight(`alto=${v}`));
    expect(diagramFence('```mapa <script>alert(1)</script> alto=400\nRaíz\n```')).toEqual({ kind: 'mapa', src: 'Raíz', alto: 400 });
  });

  // HALLAZGO (leve): notes.tsx:785 guarda el alto con `blocks.map(...).join('\n\n')` donde `blocks = splitBlocks(doc.body)`
  // descarta líneas en blanco repetidas/finales/solo-espacios y deja de proteger los bloques `~~~`: arrastrar el asa de UN diagrama
  // normaliza el espaciado de TODA la nota (el comentario de `setFenceAlto` promete «solo la línea de apertura»).
  it('ARREGLADO 5a: cambiar el alto no reescribe otras líneas de la nota', () => {
    const body = 'Uno\n\n\n\nDos\n   \nTres\n\n```mapa\nRaíz\n- a\n```\n\n~~~\nx\n\n\ny\n~~~\n';
    const blk = '```mapa\nRaíz\n- a\n```';
    const after = replaceBlockAt(body, blk, 0, setFenceAlto(blk, 420));
    expect(after).toBe(body.replace('```mapa', '```mapa alto=420'));
    const crlf = 'a\r\n\r\n\r\n```flujo\r\n[a]\r\n```\r\n';
    expect(replaceBlockAt(crlf, '```flujo\r\n[a]\r\n```', 0, '```flujo alto=300\r\n[a]\r\n```')).toBe(crlf.replace('```flujo', '```flujo alto=300'));
  });
});

describe('P22 · (6) compartir y URLs blob', () => {
  const ui = readFileSync(join(__dirname, '../src/diagrams/export-ui.tsx'), 'utf8');
  it('PASA: `deliver` llama a navigator.share síncrono con el File ya construido, sin await previo', () => {
    const body = /const deliver = \(file: File \| null\) => \{([\s\S]*?)\n  \};/.exec(ui)![1]!;
    expect(body).not.toMatch(/\bawait\b|\basync\b|setTimeout|\.then\(/);
    expect(body).toContain("navigator.canShare({ files: [file] })");
    expect(body).toContain('navigator.share({ files: [file] })');
    expect(ui).toMatch(/new File\(\[svg\], 'diagrama\.svg'/); // preparar → entregar
  });
  it('PASA: cada createObjectURL tiene su revokeObjectURL (descarga a 4 s; vista previa al desmontar)', () => {
    expect((ui.match(/createObjectURL/g) ?? []).length).toBe((ui.match(/revokeObjectURL/g) ?? []).length);
    expect(ui).toContain('setTimeout(() => URL.revokeObjectURL(url), 4000)');
    expect(ui).toMatch(/useEffect\(\(\) => \(\) => \{ if \(previewUrl\) URL\.revokeObjectURL\(previewUrl\); \}, \[previewUrl\]\)/);
  });
});
