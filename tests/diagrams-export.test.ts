import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseDiagram } from '../src/diagrams/parse';
import { buildScene, diagramToSvg, exportLayout, pngSize, svgSize } from '../src/diagrams/export';
import { setMeasurer } from '../src/diagrams/measure';
import { PALETTE_LIGHT, inkOn } from '../src/diagrams/palette';

beforeEach(() => setMeasurer((t, f) => t.length * parseFloat(/(\d+)px/.exec(f)![1]!) * 0.55));
afterEach(() => setMeasurer(null));

const flow = (src: string) => { const d = parseDiagram(src, 'flujo').doc; const { layout: l, measured: m } = exportLayout(d); return { d, l, m, svg: diagramToSvg(d, l, m) }; };
const text = (svg: string) => [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((x) => x[1]).join(' ');

describe('exportar diagrama a SVG', () => {
  const src = '[A <b>&amp; "x"</b>] --> [B]\n[B] -- <img src=x onerror=alert(1)> --> [C]';
  it('escapa el texto y no deja HTML', () => {
    const { svg } = flow(src);
    expect(svg).toContain('&lt;b&gt;&amp;amp;');
    expect(svg).not.toContain('<b>');
    expect(svg).not.toContain('<img');
  });
  it('sin script, javascript: ni manejadores on…=; <script> sale como texto', () => {
    const { svg } = flow(src + '\n[<script>alert(1)</script>] --> [A]');
    expect(svg).not.toMatch(/<script/i);
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).not.toMatch(/javascript:/i);
    expect(svg).not.toMatch(/<[^>]*\son\w+\s*=/i);
    expect(svg).not.toMatch(/href=/i);
  });
  it('[[nota]] como texto, sin enlace', () => {
    const { svg } = flow('[Ver [[Mi nota]]] --> [B]');
    expect(svg).toContain('Ver Mi nota');
    expect(svg).not.toMatch(/href|<a\b/);
  });
  it('dimensiones y colores fijos claros', () => {
    const { d, l, svg } = flow('[A] --> [B]');
    const s = svgSize(l);
    expect(svg).toContain(`width="${s.width}" height="${s.height}"`);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).not.toMatch(/var\(|currentColor/);
    expect((svg.match(/<g>/g) ?? []).length).toBe(d.nodes.length);
    expect(svg).toContain('fill="#1a1a1a"'); // punta de flecha rellena, tinta #1a1a1a
    expect(svg).not.toContain('marker');
  });
  it('nodo con color: hex claro de la paleta y texto inkOn', () => {
    const { svg } = flow('[A] {color=6}\n[A] --> [B]');
    expect(svg).toContain(`fill="${PALETTE_LIGHT[5]}"`);
    expect(svg).toContain(`fill="${inkOn(PALETTE_LIGHT[5]!)}"`);
  });
  it('nodo de 1 000 caracteres: todo el texto, sin «…», tamaños medidos', () => {
    const long = Array.from({ length: 101 }, (_, i) => `pal${String(i).padStart(6, '0')}`).join(' ');
    expect(long.length).toBeGreaterThanOrEqual(999);
    const { d, l, m, svg } = flow(`[${long}] --> [B]`);
    expect(svg).not.toContain('…');
    expect(text(svg).replace(/\s+/g, ' ')).toContain(long);
    const id = d.nodes[0]!.id;
    expect(l.pos.get(id)!.h).toBe(m.get(id)!.h);
    expect(m.get(id)!.lines.length).toBeGreaterThan(5);
  });
  it('mapa mental y fondo cuadrícula / oscuro', () => {
    const d = parseDiagram('Raíz\n- Hijo <i>\n  - Nieto', 'mapa').doc;
    const svg = diagramToSvg(d);
    expect(svg).toContain('Hijo &lt;i&gt;');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(diagramToSvg(d, undefined, undefined, { backdrop: 'cuadricula' })).toContain('stroke="#e4e4e7"');
    const { layout, measured } = exportLayout(d);
    expect(buildScene(d, layout, measured, 'oscuro').bg).toBe('#1c1c1e');
  });
  it('tamaño del PNG acotado (lado y 16 M px)', () => {
    const p = pngSize(5000, 1000, 2048);
    expect(Math.max(p.width, p.height)).toBeLessThanOrEqual(2048);
    expect(pngSize(100, 50, 2048).scale).toBe(2);
    const q = pngSize(8000, 8000, 99999);
    expect(q.width * q.height).toBeLessThanOrEqual(16_000_000);
  });
});
