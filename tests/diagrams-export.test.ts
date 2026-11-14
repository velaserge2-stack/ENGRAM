import { describe, expect, it } from 'vitest';
import { parseDiagram } from '../src/diagrams/parse';
import { layoutLayered, layoutTree } from '../src/diagrams/layout';
import { diagramToSvg, pngSize, svgSize } from '../src/diagrams/export';

const flow = (src: string) => { const d = parseDiagram(src, 'flujo').doc; const l = layoutLayered(d, 'TB'); return { d, l, svg: diagramToSvg(d, l) }; };

describe('exportar diagrama a SVG', () => {
  const src = '[A <b>&amp; "x"</b>] --> [B]\n[B] -- <img src=x onerror=alert(1)> --> [C]';
  it('escapa el texto y no deja HTML', () => {
    const { svg } = flow(src);
    expect(svg).toContain('&lt;b&gt;&amp;amp;');
    expect(svg).not.toContain('<b>');
    expect(svg).not.toContain('<img');
  });
  it('sin script, javascript: ni manejadores on…=', () => {
    const { svg } = flow(src + '\n[<script>alert(1)</script>] --> [A]');
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/javascript:/i);
    expect(svg).not.toMatch(/<[^>]*\son\w+\s*=/i);
    expect(svg).not.toMatch(/href=/i);
  });
  it('dimensiones y colores fijos claros', () => {
    const { d, l, svg } = flow('[A] --> [B]');
    const s = svgSize(l);
    expect(svg).toContain(`width="${s.width}" height="${s.height}"`);
    expect(s.width).toBeGreaterThan(48);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).not.toMatch(/var\(|currentColor/);
    expect((svg.match(/<g>/g) ?? []).length).toBe(d.nodes.length);
  });
  it('mapa mental', () => {
    const d = parseDiagram('Raíz\n- Hijo <i>\n  - Nieto', 'mapa').doc;
    const svg = diagramToSvg(d, layoutTree(d));
    expect(svg).toContain('Hijo &lt;i&gt;');
    expect(svg.startsWith('<svg')).toBe(true);
  });
  it('tamaño del PNG acotado', () => {
    const p = pngSize(5000, 1000, 2048);
    expect(Math.max(p.width, p.height)).toBeLessThanOrEqual(2048);
    expect(pngSize(100, 50, 2048).scale).toBe(2);
  });
});
