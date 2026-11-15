import { describe, expect, it } from 'vitest';
import { applyEdit } from '../src/diagrams/edit';
import { parseDiagram } from '../src/diagrams/parse';
import { serializeDiagram } from '../src/diagrams/serialize';
import type { DiagramDoc, DiagramKind, Edit } from '../src/diagrams/types';

const MAPA = 'Cardiología\n- Anatomía {plegado}\n  - Cámaras\n  - Válvulas\n# nota\n- Fisiología {x=120,y=-40}\n  - Ciclo\n';
const FLUJO = '(Inicio) --> [Triaje] --> {¿Inestable?}\n# c\n{¿Inestable?} -- sí --> [Reanimación] {orto}\n{¿Inestable?} -- no --> [Alta] {x=3,y=4}\n[Solo]\n';
const DIAG = '[A] --- [B]\n[B] <--> [C]\n[C] -- x --- [A]\n';

const P = (t: string, k: DiagramKind) => parseDiagram(t, k).doc;
const T = (d: DiagramDoc) => serializeDiagram(d);
const id = (d: DiagramDoc, text: string) => d.nodes.find((n) => n.text === text)!.id;

// aplica, comprueba inmutabilidad y deshacer exacto; devuelve el texto nuevo
function check(d: DiagramDoc, e: Edit): string {
  const before = JSON.stringify(d);
  const text = T(d);
  const r = applyEdit(d, e);
  expect(JSON.stringify(d)).toBe(before);
  expect(r.inverse.length).toBeGreaterThan(0);
  expect(T(r.doc)).not.toBe(text);
  let back = r.doc;
  for (const inv of r.inverse) back = applyEdit(back, inv).doc;
  expect(T(back)).toBe(text);
  return T(r.doc);
}

describe('applyEdit · mapa', () => {
  const d = P(MAPA, 'mapa');
  it('addChild / addSibling', () => {
    expect(check(d, { op: 'addChild', parent: id(d, 'Anatomía'), text: 'Nueva' })).toContain('  - Válvulas\n  - Nueva\n# nota');
    expect(check(d, { op: 'addSibling', id: id(d, 'Cámaras'), text: 'Hermana' })).toContain('  - Cámaras\n  - Hermana\n  - Válvulas');
    expect(applyEdit(d, { op: 'addSibling', id: 'n0', text: 'x' }).inverse).toEqual([]);
  });
  it('rename, move, fold', () => {
    expect(check(d, { op: 'rename', id: id(d, 'Ciclo'), text: 'Latido' })).toContain('  - Latido');
    expect(check(d, { op: 'move', id: id(d, 'Cámaras'), x: 5.4, y: -2 })).toContain('  - Cámaras {x=5,y=-2}');
    expect(check(d, { op: 'move', id: id(d, 'Fisiología'), x: 1, y: 2 })).toContain('- Fisiología {x=1,y=2}');
    expect(check(d, { op: 'fold', id: id(d, 'Fisiología'), folded: true })).toContain('- Fisiología {x=120,y=-40,plegado}');
    expect(check(d, { op: 'fold', id: id(d, 'Anatomía'), folded: false })).toContain('- Anatomía\n');
  });
  it('remove borra la rama', () => {
    const t = check(d, { op: 'remove', id: id(d, 'Anatomía') });
    expect(t).not.toContain('Cámaras');
    expect(t).toContain('Fisiología');
  });
  it('reparent', () => {
    const t = check(d, { op: 'reparent', id: id(d, 'Anatomía'), parent: id(d, 'Fisiología') });
    expect(t).toContain('    - Cámaras');
    expect(t.indexOf('Ciclo')).toBeLessThan(t.indexOf('Anatomía'));
  });
  it('reparent a un descendiente se rechaza', () => {
    for (const parent of [id(d, 'Cámaras'), id(d, 'Anatomía')]) {
      const r = applyEdit(d, { op: 'reparent', id: id(d, 'Anatomía'), parent });
      expect(r.inverse).toEqual([]);
      expect(T(r.doc)).toBe(MAPA);
    }
    expect(applyEdit(d, { op: 'reparent', id: 'n0', parent: 'n1' }).inverse).toEqual([]);
  });
});

describe('applyEdit · flujo y diagrama', () => {
  const d = P(FLUJO, 'flujo');
  it('addChild / addSibling', () => {
    expect(check(d, { op: 'addChild', parent: id(d, 'Alta'), shape: 'round', text: 'Fin' })).toContain('[Alta] --> (Fin)');
    const t = check(d, { op: 'addSibling', id: id(d, 'Alta'), text: 'Obs' });
    expect(t).toContain('{¿Inestable?} --> [Obs]');
  });
  it('rename cambia todas las apariciones y escapa', () => {
    const t = check(d, { op: 'rename', id: id(d, '¿Inestable?'), text: '¿Grave}?' });
    expect(t.match(/\{¿Grave\\\}\?\}/g)).toHaveLength(3);
    const re = P(t, 'flujo');
    expect(re.nodes.some((n) => n.text === '¿Grave}?')).toBe(true);
  });
  it('remove conserva lo demás', () => {
    const t = check(d, { op: 'remove', id: id(d, 'Triaje') });
    expect(t).not.toContain('Triaje');
    expect(t).toContain('(Inicio)');
    expect(t).toContain('{¿Inestable?} -- sí --> [Reanimación] {orto}');
    expect(check(d, { op: 'remove', id: id(d, 'Solo') })).not.toContain('Solo');
  });
  it('connect / disconnect', () => {
    const t = check(d, { op: 'connect', from: id(d, 'Alta'), to: id(d, 'Solo'), route: 'recta' });
    expect(t).toContain('[Alta] --> [Solo] {recta}');
    expect(check(d, { op: 'disconnect', id: 'e1' })).toContain('(Inicio) --> [Triaje]');
    expect(check(d, { op: 'disconnect', id: 'e3' })).toContain('[Alta]');
    expect(applyEdit(d, { op: 'connect', from: 'n0', to: 'zz' }).inverse).toEqual([]);
  });
  it('style y label', () => {
    expect(check(d, { op: 'style', id: 'e3', route: 'recta' })).toContain('[Alta] {x=3,y=4,recta}');
    expect(check(d, { op: 'style', id: 'e1', route: 'curva' })).toContain('{curva}');
    expect(check(d, { op: 'style', id: 'e0', route: 'orto' })).toContain('(Inicio) --> [Triaje] {orto}\n[Triaje] --> {¿Inestable?}');
    expect(check(d, { op: 'label', id: 'e0', label: 'ingresa' })).toContain('(Inicio) -- ingresa --> [Triaje]');
    expect(check(d, { op: 'label', id: 'e2', label: '' })).toContain('{¿Inestable?} --> [Reanimación]');
    expect(applyEdit(d, { op: 'label', id: 'e0', label: 'a --> b' }).inverse).toEqual([]);
  });
  it('move y fold', () => {
    expect(check(d, { op: 'move', id: id(d, 'Alta'), x: 9, y: 9 })).toContain('{x=9,y=9}');
    expect(check(d, { op: 'move', id: id(d, 'Triaje'), x: 1, y: 2 })).toContain('[Triaje] {x=1,y=2}');
    expect(check(d, { op: 'move', id: id(d, 'Solo'), x: 1, y: 2 })).toContain('[Solo] {x=1,y=2}');
    expect(check(d, { op: 'fold', id: id(d, 'Alta'), folded: true })).toContain('{x=3,y=4,plegado}');
  });
  it('diagrama: flechas sin punta y con etiqueta', () => {
    const g = P(DIAG, 'diagrama');
    expect(check(g, { op: 'connect', from: 'n0', to: 'n2', arrow: 'both' })).toContain('[A] <--> [C]');
    expect(check(g, { op: 'label', id: 'e0', label: 'k' })).toContain('[A] -- k --- [B]');
    expect(check(g, { op: 'label', id: 'e2', label: '' })).toContain('[C] --- [A]');
    expect(applyEdit(g, { op: 'label', id: 'e1', label: 'x' }).inverse).toEqual([]);
    expect(check(g, { op: 'disconnect', id: 'e1' })).not.toContain('<-->');
  });
});

describe('applyEdit · reglas', () => {
  it('ids inexistentes y texto vacío son no-op', () => {
    const d = P(MAPA, 'mapa');
    for (const e of [
      { op: 'rename', id: 'zz', text: 'a' }, { op: 'remove', id: 'zz' }, { op: 'move', id: 'zz', x: 1, y: 1 },
      { op: 'fold', id: 'zz', folded: true }, { op: 'addChild', parent: 'zz', text: 'a' },
      { op: 'addChild', parent: 'n0', text: '  ' }, { op: 'move', id: 'n0', x: NaN, y: 0 },
    ] as Edit[]) {
      const r = applyEdit(d, e);
      expect(r.inverse).toEqual([]);
      expect(T(r.doc)).toBe(MAPA);
    }
  });
  it('no supera 300 nodos', () => {
    let t = 'Raíz';
    for (let i = 1; i < 300; i++) t += `\n- h${i}`;
    const d = P(t, 'mapa');
    expect(d.nodes).toHaveLength(300);
    const r = applyEdit(d, { op: 'addChild', parent: 'n0', text: 'uno más' });
    expect(r.inverse).toEqual([]);
    expect(r.doc.nodes).toHaveLength(300);
    const f = P('[a] --> [b]\n' + Array.from({ length: 298 }, (_, i) => `[a] --> [c${i}]`).join('\n'), 'flujo');
    expect(f.nodes).toHaveLength(300);
    expect(applyEdit(f, { op: 'addChild', parent: 'n0', text: 'nuevo' }).inverse).toEqual([]);
    expect(applyEdit(f, { op: 'addChild', parent: 'n0', text: 'c1' }).doc.nodes).toHaveLength(300); // nodo existente: no cuenta
  });
  it('conserva literales, CRLF y salto final', () => {
    const t = 'A\r\n-   x \r\n# k\r\n';
    const d = P(t, 'mapa');
    const r = applyEdit(d, { op: 'addChild', parent: 'n0', text: 'y' });
    expect(T(r.doc)).toBe('A\r\n-   x \r\n- y\r\n# k\r\n');
    expect(T(applyEdit(r.doc, r.inverse[0]!).doc)).toBe(t);
  });
  it('20 ediciones y 20 deshacer vuelven al original', () => {
    for (const [text, kind] of [[MAPA, 'mapa'], [FLUJO, 'flujo']] as const) {
      let d = P(text, kind);
      const invs: Edit[][] = [];
      let seed = 7;
      const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
      for (let i = 0; i < 20; i++) {
        const ns = d.nodes;
        const pick = () => ns[rnd(ns.length)]!.id;
        const ops: Edit[] = kind === 'mapa'
          ? [{ op: 'addChild', parent: pick(), text: `n${i}` }, { op: 'rename', id: pick(), text: `r${i}` }, { op: 'move', id: pick(), x: i, y: -i },
            { op: 'fold', id: pick(), folded: i % 2 === 0 }, { op: 'reparent', id: pick(), parent: pick() }, { op: 'remove', id: pick() }]
          : [{ op: 'addChild', parent: pick(), shape: 'round', text: `n${i}` }, { op: 'rename', id: pick(), text: `r${i}` }, { op: 'move', id: pick(), x: i, y: i },
            { op: 'connect', from: pick(), to: pick(), route: 'orto' }, { op: 'disconnect', id: d.edges.length ? d.edges[rnd(d.edges.length)]!.id : 'x' },
            { op: 'style', id: d.edges.length ? d.edges[rnd(d.edges.length)]!.id : 'x', route: 'recta' }, { op: 'remove', id: pick() }];
        const r = applyEdit(d, ops[rnd(ops.length)]!);
        invs.push(r.inverse);
        d = r.doc;
      }
      for (const inv of invs.reverse()) for (const e of inv) d = applyEdit(d, e).doc;
      expect(T(d)).toBe(text);
    }
  });
});
