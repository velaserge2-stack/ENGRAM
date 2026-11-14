import { describe, expect, it } from 'vitest';
import { parseDiagram } from '../src/diagrams/parse';
import { serializeDiagram } from '../src/diagrams/serialize';
import { layoutLayered, layoutTree } from '../src/diagrams/layout';
import type { DiagramKind, Layout } from '../src/diagrams/types';

const rt = (t: string, k: DiagramKind) => serializeDiagram(parseDiagram(t, k).doc);
const finite = (l: Layout) => [...l.pos.values()].every((p) => [p.x, p.y, p.w, p.h].every(Number.isFinite));
const dump = (l: Layout) => JSON.stringify([...l.pos.entries()]);

describe('1. etiqueta de 2 000 caracteres', () => {
  const big = 'x'.repeat(2000);
  it('línea > 1000: se conserva literal, sin lanzar (§1.4)', () => {
    for (const [t, k] of [[`Raíz\n- ${big}\n`, 'mapa'], [`[${big}] --> [B]\n`, 'flujo']] as const) {
      const r = parseDiagram(t, k);
      expect(r.errors.length).toBeGreaterThan(0);
      expect(serializeDiagram(r.doc)).toBe(t);
      expect(finite(layoutLayered(r.doc, 'TB'))).toBe(true);
      expect(finite(layoutTree(r.doc))).toBe(true);
    }
  });
  it('etiqueta larga que cabe en la línea (900): nodo íntegro y layout finito', () => {
    const t = 'y'.repeat(900);
    const m = parseDiagram(`Raíz\n- ${t}\n`, 'mapa');
    expect(m.doc.nodes[1]!.text).toBe(t);
    expect(serializeDiagram(m.doc)).toBe(`Raíz\n- ${t}\n`);
    expect(finite(layoutTree(m.doc))).toBe(true);
    const f = parseDiagram(`[${t}] --> [B]\n`, 'flujo');
    expect(f.doc.nodes[0]!.text).toBe(t);
    expect(finite(layoutLayered(f.doc, 'LR'))).toBe(true);
  });
});

describe('2. tope de 300 nodos', () => {
  const mapa = (n: number) => 'Raíz\n' + Array.from({ length: n - 1 }, (_, i) => `- n${i}\n`).join('');
  it('300 no es tooBig; 301 sí; el documento se conserva completo', () => {
    const a = parseDiagram(mapa(300), 'mapa');
    expect(a.doc.nodes.length).toBe(300);
    expect(a.tooBig).toBe(false);
    const b = parseDiagram(mapa(301), 'mapa');
    expect(b.doc.nodes.length).toBe(301);
    expect(b.tooBig).toBe(true);
    expect(serializeDiagram(b.doc)).toBe(mapa(301));
  });
  it('layout de 300 nodos < 100 ms', () => {
    const doc = parseDiagram(mapa(300), 'mapa').doc;
    layoutTree(doc); // calentamiento
    let t0 = performance.now();
    const l = layoutTree(doc);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(l.pos.size).toBe(300);
    const fl = Array.from({ length: 299 }, (_, i) => `[a${i}] --> [a${i + 1}]\n`).join('');
    const fd = parseDiagram(fl, 'flujo').doc;
    expect(fd.nodes.length).toBe(300);
    layoutLayered(fd, 'TB');
    t0 = performance.now();
    layoutLayered(fd, 'TB');
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe('3. vacío y un solo nodo', () => {
  it.each(['mapa', 'flujo', 'diagrama'] as const)('%s vacío', (k) => {
    const { doc } = parseDiagram('', k);
    expect(serializeDiagram(doc)).toBe('');
    expect(() => layoutTree(doc)).not.toThrow();
    expect(() => layoutLayered(doc, 'TB')).not.toThrow();
  });
  it('un solo nodo: una posición', () => {
    expect(layoutTree(parseDiagram('Sola', 'mapa').doc).pos.size).toBe(1);
    expect(layoutTree(parseDiagram('Sola', 'mapa').doc, 'radial').pos.size).toBe(1);
    expect(layoutLayered(parseDiagram('[Sola]', 'flujo').doc, 'LR').pos.size).toBe(1);
  });
});

describe('4. ciclo en flujo de 3 nodos', () => {
  it('termina y es finito', () => {
    const t = '[A] --> [B]\n[B] --> [C]\n[C] --> [A]\n';
    const doc = parseDiagram(t, 'flujo').doc;
    for (const d of ['TB', 'LR'] as const) {
      const l = layoutLayered(doc, d);
      expect(l.pos.size).toBe(3);
      expect(finite(l)).toBe(true);
      expect(l.paths.size).toBe(3); // las aristas de retroceso se siguen dibujando
    }
    const auto = parseDiagram('[A] --> [A]\n', 'flujo').doc;
    expect(finite(layoutLayered(auto, 'TB'))).toBe(true);
  });
});

describe('5. +40 % de texto, 2 bytes y combinaciones', () => {
  it('ida y vuelta exacta', () => {
    const s = 'ñáéíóúüçßøǼéä ǅ 😀👨‍👩‍👧‍👦🇲🇽 ​ ';
    const m = `Raíz ${s}\n- ${s}${s}\n  - ${s}\n`;
    expect(rt(m, 'mapa')).toBe(m);
    const f = `[${s}] -- ${s} --> {${s}}\n(${s}) --> <<${s}>>\n`;
    expect(rt(f, 'flujo')).toBe(f);
    expect(rt(f.replace('-->', '---'), 'diagrama')).toBe(f.replace('-->', '---'));
    expect(parseDiagram(m, 'mapa').doc.nodes[1]!.text).toBe((s + s).trim()); // el texto del nodo se recorta (nbsp final incluido); la línea cruda no
  });
});

describe('6. idiomas', () => {
  const textos = ['Éléments à côté, où ça ? « oui »', 'مرحبا بالعالم ‏(1) و2', 'עברית', '日本語のテキスト、心臓', '🫀🩺💉'];
  it('ida y vuelta exacta; RTL no altera la serialización', () => {
    for (const x of textos) {
      const m = `${x}\n- ${x}\n  - ${x}\n`;
      expect(rt(m, 'mapa')).toBe(m);
      expect(parseDiagram(m, 'mapa').doc.nodes.map((n) => n.text)).toEqual([x, x, x]);
      const f = `[${x}] -- ${x} --> {${x}}\n`;
      expect(rt(f, 'flujo')).toBe(f);
      const d = parseDiagram(f, 'flujo').doc;
      expect(d.nodes[0]!.text).toBe(x);
      expect(finite(layoutLayered(d, 'LR'))).toBe(true);
    }
    const marks = `[‮abc‬] --> [⁧x⁩]\n`;
    expect(rt(marks, 'flujo')).toBe(marks);
  });
});

describe('7. texto hostil', () => {
  it('se guarda literal, sin interpretarse', () => {
    const hostiles = ['<img src=x onerror=alert(1)>', 'javascript:alert(1)', '[[nota [[anidada]] fin]]', '<script>alert(1)</script>'];
    for (const h of hostiles) {
      const m = parseDiagram(`Raíz\n- ${h}\n`, 'mapa');
      expect(m.doc.nodes[1]!.text).toBe(h);
      expect(serializeDiagram(m.doc)).toBe(`Raíz\n- ${h}\n`);
      const g = parseDiagram(`[${h.replace(/\]/g, '\\]')}] --> [B]\n`, 'flujo');
      expect(typeof g.doc.nodes[0]!.text).toBe('string');
      expect(g.doc.nodes[0]!.text).toContain(h.slice(0, 5));
    }
    const enl = parseDiagram('[ver [[nota]] ya] --> [B]\n', 'flujo');
    expect(enl.doc.nodes[0]!.text).toBe('ver [[nota]] ya');
    const nested = parseDiagram('[a [[n [[m]] k]] b] --> [B]\n', 'flujo');
    expect(serializeDiagram(nested.doc)).toBe('[a [[n [[m]] k]] b] --> [B]\n');
  });
});

describe('8. líneas mal formadas', () => {
  const casos: [string, DiagramKind][] = [
    ['Raíz\n\t- a\n\t\t- b\n  \t- c\n', 'mapa'],
    ['Raíz\n- a {x=}\n- b {x=1}\n- c {x=1,y=}\n', 'mapa'],
    ['[A] -->\n--> [B]\n-->\n[A] --> --> [B]\n[A] -- x -->\n', 'flujo'],
    ['[A] ---\n[A] <--> \n<--> [B]\n--- \n', 'diagrama'],
    ['[A --> [B]\n(x] --> [y)\n{}\n[]\n<<>>\n\\\n', 'flujo'],
    ['Raíz\n      - saltó\n - impar\n-\n- \n--\n', 'mapa'],
    ['\r\n\r\n\n \t \n', 'flujo'],
  ];
  it('nunca lanzan y se conservan literales', () => {
    for (const [t, k] of casos) {
      let r!: ReturnType<typeof parseDiagram>;
      expect(() => { r = parseDiagram(t, k); }).not.toThrow();
      expect(serializeDiagram(r.doc)).toBe(t);
      expect(() => layoutTree(r.doc)).not.toThrow();
      expect(() => layoutLayered(r.doc, 'TB')).not.toThrow();
      expect(finite(layoutLayered(r.doc, 'LR'))).toBe(true);
    }
  });
  it('flecha sin destino y flecha huérfana se marcan, no crean aristas', () => {
    const r = parseDiagram('[A] -->\n-->\n', 'flujo');
    expect(r.doc.edges.length).toBe(0);
    expect(r.errors.length).toBe(2);
  });
  it('ruido aleatorio con semilla fija: sin excepciones', () => {
    let s = 99;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const p = ['[', ']', '(', ')', '{', '}', '<<', '>>', '-->', '---', '<-->', '--', ' ', '\t', '\n', '\r\n', '{x=', 'y=', '[[', ']]', '\\', '#', '- ', 'a', 'é', '😀', '{plegado}'];
    for (const k of ['mapa', 'flujo', 'diagrama'] as const) {
      for (let i = 0; i < 400; i++) {
        let t = '';
        for (let j = 0, n = 1 + Math.floor(rnd() * 30); j < n; j++) t += p[Math.floor(rnd() * p.length)];
        const r = parseDiagram(t, k);
        expect(serializeDiagram(r.doc)).toBe(t);
        layoutTree(r.doc);
        layoutLayered(r.doc, 'TB');
      }
    }
  });
});

describe('9. determinismo', () => {
  it('mismas posiciones y trazos en dos llamadas', () => {
    const f = parseDiagram('(Inicio) --> [A] --> {¿B?}\n{¿B?} -- sí --> [C]\n[C] --> [A]\n[Suelto]\n[X] --> [Y]\n', 'flujo').doc;
    for (const d of ['TB', 'LR'] as const) {
      const a = layoutLayered(f, d), b = layoutLayered(f, d);
      expect(dump(a)).toBe(dump(b));
      expect(JSON.stringify([...a.paths])).toBe(JSON.stringify([...b.paths]));
    }
    const m = parseDiagram('Raíz\n- a\n  - b\n  - c\n- d {x=10,y=-5}\n', 'mapa').doc;
    for (const mode of ['horizontal', 'radial'] as const) {
      expect(dump(layoutTree(m, mode))).toBe(dump(layoutTree(m, mode)));
    }
  });
});
