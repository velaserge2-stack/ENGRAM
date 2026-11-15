import { describe, expect, it } from 'vitest';
import { parseDiagram } from '../src/diagrams/parse';
import { serializeDiagram } from '../src/diagrams/serialize';
import type { DiagramKind } from '../src/diagrams/types';

const rt = (t: string, k: DiagramKind) => serializeDiagram(parseDiagram(t, k).doc);

const MAPA = 'Cardiología\n- Anatomía {plegado}\n  - Cámaras\n- Fisiología {x=120,y=-40}\n';
const FLUJO = '(Inicio) --> [Triaje] --> {¿Inestable?}\n{¿Inestable?} -- sí --> [Reanimación]\n[Triaje]{x=40,y=0}\n';
const DIAG = 'A: x\n[A] --- [B]\n[B] <--> [C] {recta}\n[C] -- rel --- [D]\n<<Nota>>\n[/Dato/] --> (Fin)\n';

describe('ida y vuelta', () => {
  it('mapa', () => expect(rt(MAPA, 'mapa')).toBe(MAPA));
  it('flujo', () => expect(rt(FLUJO, 'flujo')).toBe(FLUJO));
  it('diagrama', () => expect(rt(DIAG, 'diagrama')).toBe(DIAG));
  it('vacío y CRLF', () => {
    expect(rt('', 'mapa')).toBe('');
    const t = 'Raíz\r\n- a\r\n  - b\r\n';
    expect(parseDiagram(t, 'mapa').doc.eol).toBe('\r\n');
    expect(rt(t, 'mapa')).toBe(t);
    const mixed = 'Raíz\r\n- a\n';
    expect(rt(mixed, 'mapa')).toBe(mixed);
  });
  it('corpus con ruido (semilla fija)', () => {
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const pieces = ['[a]', '(b)', '{c}', '<<n>>', '[/io/]', ' --> ', ' --- ', ' <--> ', ' -- x --> ', '{plegado}', '{x=1,y=2}', '{recta}', '- ', '  ', '\t', '\n', '#', '\\]', '[[nota]]', '**b**', '{c=3}'];
    for (const k of ['mapa', 'flujo', 'diagrama'] as const) {
      for (let i = 0; i < 300; i++) {
        let t = '';
        for (let j = 0, n = 1 + Math.floor(rnd() * 20); j < n; j++) t += pieces[Math.floor(rnd() * pieces.length)];
        expect(rt(t, k)).toBe(t);
      }
    }
  });
});

describe('mapa', () => {
  it('sangría de 2 espacios, padres y sufijos', () => {
    const { doc, errors } = parseDiagram(MAPA, 'mapa');
    expect(errors).toEqual([]);
    expect(doc.nodes.map((n) => [n.text, n.depth, n.parent])).toEqual([
      ['Cardiología', 0, undefined], ['Anatomía', 1, 'n0'], ['Cámaras', 2, 'n1'], ['Fisiología', 1, 'n0'],
    ]);
    expect(doc.nodes[1]!.folded).toBe(true);
    expect(doc.nodes[3]).toMatchObject({ x: 120, y: -40 });
  });
  it('tabuladores valen 2 espacios', () => {
    const { doc, errors } = parseDiagram('R\n- a\n\t- b\n', 'mapa');
    expect(errors).toEqual([]);
    expect(doc.nodes[2]).toMatchObject({ text: 'b', depth: 2, parent: 'n1' });
  });
  it('sangrías mixtas: salto de nivel e impar se conservan como desconocidas', () => {
    const t = 'R\n- a\n      - salto\n - impar\n  - ok\n';
    const { doc, errors } = parseDiagram(t, 'mapa');
    expect(errors.map((e) => e.code)).toEqual(['sangria', 'sangria']);
    expect(doc.nodes.map((n) => n.text)).toEqual(['R', 'a', 'ok']);
    expect(serializeDiagram(doc)).toBe(t);
  });
  it('líneas inválidas conservadas en su lugar', () => {
    const t = '# nota\nR\n\n- a\nbasura\n-\n- b\n';
    const { doc, errors } = parseDiagram(t, 'mapa');
    expect(doc.nodes.map((n) => n.text)).toEqual(['R', 'a', 'b']);
    expect(errors.length).toBe(2);
    expect(doc.lines.map((l) => l.t)).toEqual(['raw', 'node', 'raw', 'node', 'raw', 'raw', 'node', 'raw']);
    expect(serializeDiagram(doc)).toBe(t);
  });
});

describe('flujo y diagrama', () => {
  it('identidad por forma y texto; cadenas', () => {
    const { doc, errors } = parseDiagram(FLUJO, 'flujo');
    expect(errors).toEqual([]);
    expect(doc.nodes.map((n) => [n.shape, n.text])).toEqual([
      ['round', 'Inicio'], ['rect', 'Triaje'], ['diamond', '¿Inestable?'], ['rect', 'Reanimación'],
    ]);
    expect(doc.edges.map((e) => [e.from, e.to, e.label])).toEqual([
      ['n0', 'n1', undefined], ['n1', 'n2', undefined], ['n2', 'n3', 'sí'],
    ]);
    expect(doc.nodes[1]).toMatchObject({ x: 40, y: 0 });
  });
  it('--- y <--> solo en diagrama; en flujo son líneas desconocidas', () => {
    const t = '[A] --- [B]\n[A] <--> [B]\n[A] --> [B]\n';
    const f = parseDiagram(t, 'flujo');
    expect(f.errors.length).toBe(2);
    expect(f.doc.edges.length).toBe(1);
    expect(serializeDiagram(f.doc)).toBe(t);
    const d = parseDiagram(t, 'diagrama');
    expect(d.doc.edges.map((e) => e.arrow)).toEqual(['none', 'both', 'to']);
  });
  it('ruta de la arista y {c=n} desconocido', () => {
    const { doc, errors } = parseDiagram('[A] --> [B] {orto}\n[A] --> [B]{c=2}\n', 'flujo');
    expect(doc.edges[0]!.route).toBe('orto');
    // P22: la clave desconocida queda en `extra` y la línea se dibuja (antes se descartaba)
    expect(errors.length).toBe(0);
    expect(doc.edges[1]!.extra).toEqual(['c=2']);
    expect(doc.lines[1]!.t).toBe('edge');
  });
  it('decisión {plegado} sin sufijo sigue siendo nodo', () => {
    const { doc } = parseDiagram('(A) --> {plegado}\n', 'flujo');
    expect(doc.nodes[1]).toMatchObject({ shape: 'diamond', text: 'plegado' });
    expect(doc.nodes[1]!.folded).toBeUndefined();
  });
  it('ciclo: no se cuelga', () => {
    const t = '[A] --> [B]\n[B] --> [C]\n[C] --> [A]\n[A] --> [A]\n';
    const { doc, errors } = parseDiagram(t, 'flujo');
    expect(errors).toEqual([]);
    expect(doc.nodes.length).toBe(3);
    expect(doc.edges.length).toBe(4);
    expect(serializeDiagram(doc)).toBe(t);
  });
  it('nodos huérfanos', () => {
    const { doc } = parseDiagram('[Solo]\n(Otro) {plegado}\n[A] --> [B]\n', 'flujo');
    expect(doc.nodes.length).toBe(4);
    expect(doc.lines.map((l) => l.t)).toEqual(['node', 'node', 'edge', 'raw']);
    expect(doc.nodes[1]!.folded).toBe(true);
  });
  it('escapes y enlaces [[nota]]', () => {
    const { doc } = parseDiagram('[a \\] b] --> [Ver [[Nota]]]\n', 'flujo');
    expect(doc.nodes[0]!.text).toBe('a ] b');
    expect(doc.nodes[1]!.text).toBe('Ver [[Nota]]');
  });
});

describe('límites y seguridad', () => {
  it('tope de 300 nodos: documento completo y tooBig', () => {
    const t = ['R', ...Array.from({ length: 300 }, (_, i) => `- n${i}`)].join('\n');
    const r = parseDiagram(t, 'mapa');
    expect(r.doc.nodes.length).toBe(301);
    expect(r.tooBig).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.errors.at(-1)!.code).toBe('tope');
    expect(serializeDiagram(r.doc)).toBe(t);
    const ok = parseDiagram(['R', ...Array.from({ length: 299 }, (_, i) => `- n${i}`)].join('\n'), 'mapa');
    expect(ok.tooBig).toBe(false);
  });
  it('<script> y javascript: se guardan como texto', () => {
    const t = 'R\n- <script>alert(1)</script>\n- [x](javascript:alert(1))\n';
    const { doc } = parseDiagram(t, 'mapa');
    expect(doc.nodes[1]!.text).toBe('<script>alert(1)</script>');
    expect(doc.nodes[2]!.text).toBe('[x](javascript:alert(1))');
    const f = parseDiagram('[<script>alert(1)</script>] --> [javascript:alert(1)]\n', 'flujo');
    expect(f.doc.nodes.map((n) => n.text)).toEqual(['<script>alert(1)</script>', 'javascript:alert(1)']);
    expect(serializeDiagram(f.doc)).toBe('[<script>alert(1)</script>] --> [javascript:alert(1)]\n');
  });
  it('texto de nodo de más de 5000 caracteres: conservado, no dibujado', () => {
    const t = `R\n- ${'x'.repeat(5001)}\n`;
    const { doc, errors } = parseDiagram(t, 'mapa');
    expect(doc.nodes.length).toBe(1);
    expect(errors.length).toBe(1);
    expect(serializeDiagram(doc)).toBe(t);
  });
});
