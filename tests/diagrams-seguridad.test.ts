// Revisión de seguridad de diagramas: texto como texto, SVG sin HTML, embed solo por notas del listado y DoS acotado.
import { describe, expect, it } from 'vitest';
import { parseDiagram } from '../src/diagrams/parse';
import { layoutLayered, layoutTree } from '../src/diagrams/layout';
import { diagramToSvg } from '../src/diagrams/export';
import { resolveDiagramEmbed, embedName } from '../src/diagrams/embed';
import { inline } from '../src/diagrams/view';

const run = (text: string, kind: 'mapa' | 'flujo' | 'diagrama') => {
  const t0 = performance.now();
  const r = parseDiagram(text, kind);
  if (!r.tooBig) kind === 'mapa' ? layoutTree(r.doc) : layoutLayered(r.doc, 'TB');
  return performance.now() - t0;
};
const EVIL = '<img src=x onerror=alert(1)><script>alert(1)</script>"\'&javascript:';

describe('diagramas · seguridad', () => {
  it('SVG: texto de nodo y etiqueta escapados, sin script ni on…=', () => {
    const r = parseDiagram(`[${EVIL}] -- ${EVIL} --> {${EVIL}}\n`, 'diagrama');
    const svg = diagramToSvg(r.doc, layoutLayered(r.doc, 'TB'));
    const tags = [...svg.matchAll(/<([a-zA-Z]+)([^>]*)>/g)];
    for (const [, name, attrs] of tags) {
      expect(['svg', 'defs', 'marker', 'path', 'rect', 'g', 'polygon', 'text', 'tspan']).toContain(name);
      expect(attrs).not.toMatch(/\son\w+=|href|javascript:/i);
    }
    expect(svg).toContain('&lt;script&gt;');
  });
  it('inline(): nunca produce HTML crudo', () => {
    const out = JSON.stringify(inline(`**<b>x</b>** [[<img onerror=1>]]`));
    expect(out).not.toContain('dangerouslySetInnerHTML');
  });
  it('embed: solo resuelve notas del listado (..\\0 y rutas absolutas no existen)', () => {
    const notes = [{ path: 'notes/Mapa.md', title: 'Mapa' }];
    const texts = new Map([['notes/Mapa.md', '---\ntipo: mapa\n---\nR\n']]);
    for (const n of ['../../.app/state', '/etc/passwd', 'a\0b', '..\\x', 'notes/../x']) expect(resolveDiagramEmbed(n, notes, texts)).toEqual({ state: 'missing', name: n });
    expect(embedName('![[../../x]]')).toBe('../../x'); // solo es un nombre: nunca se usa como ruta
  });
  it('DoS: 10 000 niveles de sangría, línea de 1 MB, 5 000 flechas y aristas repetidas', () => {
    const casos: [string, 'mapa' | 'flujo' | 'diagrama'][] = [
      ['R\n' + ' '.repeat(20000) + '- x\n', 'mapa'],
      ['R\n' + Array.from({ length: 10000 }, (_, i) => ' '.repeat(i * 2) + '- n').join('\n'), 'mapa'],
      ['[' + 'a'.repeat(1_000_000) + ']', 'flujo'],
      ['[' + '[['.repeat(500) + ']', 'flujo'],
      ['[a]' + ' --> [a]'.repeat(120), 'flujo'],
      ['--' + ' '.repeat(900) + 'x', 'flujo'],
      [Array.from({ length: 50000 }, () => '[a] --> [b]').join('\n'), 'flujo'],
      [Array.from({ length: 50000 }, (_, i) => `[a] -- ${i} --> [b]`).join('\n'), 'diagrama'],
      [Array.from({ length: 299 }, (_, i) => `[n${i}] --> [n${i + 1}]`).join('\n') + '\n[n299] --> [n0]', 'flujo'],
    ];
    for (const [t, k] of casos) expect(run(t, k)).toBeLessThan(2000);
  });
});
