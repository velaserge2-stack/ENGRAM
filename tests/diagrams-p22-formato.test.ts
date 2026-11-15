import { describe, expect, it } from 'vitest';
import { applyEdit, parseOutline } from '../src/diagrams/edit';
import { parseDiagram, readBackdrop, readHeight } from '../src/diagrams/parse';
import { serializeDiagram } from '../src/diagrams/serialize';
import type { DiagramDoc, DiagramKind, Edit } from '../src/diagrams/types';

const P = (t: string, k: DiagramKind) => parseDiagram(t, k).doc;
const T = (d: DiagramDoc) => serializeDiagram(d);
const id = (d: DiagramDoc, text: string) => d.nodes.find((n) => n.text === text)!.id;

function check(d: DiagramDoc, e: Edit): string {
  const text = T(d);
  const r = applyEdit(d, e);
  expect(r.inverse.length).toBe(1);
  expect(T(r.doc)).not.toBe(text);
  let back = r.doc;
  for (const inv of r.inverse) back = applyEdit(back, inv).doc;
  expect(T(back)).toBe(text);
  return T(r.doc);
}

const MAPA = 'Raíz\n- Uno {x=1,y=2,color=3,w=100,fs=l}\n  - Dos {foo,color=9}\n- Tres {plegado} {maxw=200}\n';
const FLUJO = '[A] --> [B] {color=2,w=3,dash,fin=ambos}\n[A] -- sí --> [C] {recta}\n[B] {color=5,w=80,h=60}\n[D] {c=3}\n';

describe('P22 · formato (ida y vuelta y lectura)', () => {
  it('ida y vuelta exacta con claves nuevas, desconocidas y notas viejas', () => {
    const olds = ['Cardiología\n- A {plegado}\n  - B\n# n\n- C {x=1,y=-4}\n', '(I) --> [T] --> {¿Inestable?}\n{¿Inestable?} -- no --> [Alta] {x=3,y=4}\n[S] {c=3}\n', '[A] --- [B] {orto}\r\n[B] <--> [C]\r\n', ''];
    for (const t of olds) for (const k of ['mapa', 'flujo', 'diagrama'] as const) expect(T(P(t, k))).toBe(t);
    for (const [t, k] of [[MAPA, 'mapa'], [FLUJO, 'flujo']] as const) expect(T(P(t, k))).toBe(t);
  });
  it('mapa: atributos, extra y fuera de rango literales', () => {
    const d = P(MAPA, 'mapa');
    const uno = d.nodes.find((n) => n.text === 'Uno')!;
    expect(uno).toMatchObject({ x: 1, y: 2, color: 3, w: 100, fs: 'l' }); // w=100 es válido (24–2000)
    const dos = d.nodes.find((n) => n.text === 'Dos')!;
    expect(dos.color).toBeUndefined();
    expect(dos.extra).toEqual(['foo', 'color=9']);
    const tres = d.nodes.find((n) => n.text === 'Tres')!;
    expect(tres).toMatchObject({ folded: true, maxw: 200 });
  });
  it('flujo: atributos de flecha, de nodo y {c=3} ya no borra el nodo', () => {
    const r = parseDiagram(FLUJO, 'flujo');
    expect(r.errors).toEqual([]);
    expect(r.doc.edges[0]).toMatchObject({ color: 2, w: 3, dash: true, fin: 'ambos' });
    expect(r.doc.edges[1]).toMatchObject({ route: 'recta', label: 'sí' });
    expect(r.doc.nodes.find((n) => n.text === 'B')).toMatchObject({ color: 5, w: 80, h: 60 });
    const dd = r.doc.nodes.find((n) => n.text === 'D')!;
    expect(dd.extra).toEqual(['c=3']);
    expect(r.doc.lines[3]!.t).toBe('node');
  });
  it('valores fuera de rango no se aplican', () => {
    const d = P('[A] {color=0,w=5,maxw=9999,fs=xl,x=200000,y=1}\n[A] --> [B] {w=9,fin=zzz,color=8}\n', 'flujo');
    const a = d.nodes[0]!;
    expect([a.color, a.w, a.maxw, a.fs, a.x]).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(a.extra!.length).toBe(6);
    expect(d.edges[0]).toMatchObject({ color: 8 });
    expect(d.edges[0]!.w).toBeUndefined();
    expect(d.edges[0]!.extra).toEqual(['w=9', 'fin=zzz']);
  });
  it('texto de nodo > 5000: aviso tope y línea literal', () => {
    const t = `R\n- ${'x'.repeat(5001)}\n`;
    const r = parseDiagram(t, 'mapa');
    expect(r.errors[0]!.code).toBe('tope');
    expect(r.doc.nodes.length).toBe(1);
    expect(T(r.doc)).toBe(t);
  });
  it('readBackdrop y readHeight', () => {
    expect(readBackdrop('# fondo: puntos\nA --> B', undefined)).toBe('puntos');
    expect(readBackdrop('\n# fondo: puntos\n', 'gris')).toBe('gris');
    expect(readBackdrop('# fondo: raro\n')).toBe('cristal');
    expect(readBackdrop('A\n# fondo: puntos')).toBe('cristal');
    expect(readHeight('mapa alto=420')).toBe(420);
    expect(readHeight('mapa alto=50')).toBeUndefined();
    expect(readHeight('mapa alto=420', '300')).toBe(300);
    expect(readHeight(undefined, 'x')).toBeUndefined();
  });
});

describe('P22 · ediciones nuevas (deshacer exacto)', () => {
  it('attrs en mapa: reemplaza dentro del grupo, nuevas en el último grupo, quita grupo vacío', () => {
    const d = P(MAPA, 'mapa');
    expect(check(d, { op: 'attrs', ids: [id(d, 'Uno')], set: { color: 4 } })).toContain('- Uno {x=1,y=2,color=4,w=100,fs=l}\n');
    expect(check(d, { op: 'attrs', ids: [id(d, 'Tres')], set: { color: 2, fs: 's' } })).toContain('- Tres {plegado} {maxw=200,color=2,fs=s}');
    expect(check(d, { op: 'attrs', ids: [id(d, 'Tres')], unset: ['maxw'] })).toContain('- Tres {plegado}\n');
    expect(check(d, { op: 'attrs', ids: [id(d, 'Tres')], unset: ['maxw', 'folded'] })).toContain('- Tres\n');
    expect(check(d, { op: 'attrs', ids: [id(d, 'Dos')], set: { color: 6 } })).toContain('  - Dos {foo,color=6}'); // el ítem fuera de rango se reemplaza; `foo` se respeta
  });
  it('attrs con varios ids, un solo paso', () => {
    const d = P(MAPA, 'mapa');
    const out = check(d, { op: 'attrs', ids: [id(d, 'Uno'), id(d, 'Tres')], set: { color: 7 } });
    expect(out).toContain('color=7,w=100');
    expect(out).toContain('{maxw=200,color=7}');
  });
  it('attrs inválido = no-op', () => {
    const d = P(MAPA, 'mapa');
    for (const set of [{ color: 9 }, { w: 5 }, { maxw: 10 }, { x: 1 }, { fs: 'z' }] as never[]) expect(applyEdit(d, { op: 'attrs', ids: [id(d, 'Uno')], set }).inverse).toEqual([]);
    expect(applyEdit(d, { op: 'attrs', ids: ['zz'], set: { color: 1 } }).inverse).toEqual([]);
  });
  it('attrs en flujo: nodo suelto, última posición de flecha y línea nueva', () => {
    const d = P(FLUJO, 'flujo');
    expect(check(d, { op: 'attrs', ids: [id(d, 'B')], set: { color: 1 } })).toContain('[B] {color=1,w=80,h=60}');
    expect(check(d, { op: 'attrs', ids: [id(d, 'C')], set: { x: 1, y: 2 } })).toContain('[A] -- sí --> [C] {recta,x=1,y=2}');
    const out = check(d, { op: 'attrs', ids: [id(d, 'C')], set: { color: 3 } }); // color en línea con flechas sería de la flecha
    expect(out).toContain('[C] {color=3}');
    expect(parseDiagram(out, 'flujo').doc.nodes.find((n) => n.text === 'C')!.color).toBe(3);
  });
  it('edgeAttrs: último tramo, tramo intermedio separa la línea, unset', () => {
    const d = P(FLUJO, 'flujo');
    expect(check(d, { op: 'edgeAttrs', ids: ['e0'], set: { color: 4, fin: 'rombo' } })).toContain('[A] --> [B] {color=4,w=3,dash,fin=rombo}');
    expect(check(d, { op: 'edgeAttrs', ids: ['e0'], unset: ['dash', 'w'] })).toContain('{color=2,fin=ambos}');
    expect(check(d, { op: 'edgeAttrs', ids: ['e1'], set: { route: 'orto', w: 5, dash: true } })).toContain('[C] {orto,w=5,dash}');
    const c = P('[A] --> [B] --> [C]\n', 'flujo');
    const out = check(c, { op: 'edgeAttrs', ids: ['e0'], set: { color: 2 } });
    expect(out).toBe('[A] --> [B] {color=2}\n[B] --> [C]\n');
    expect(parseDiagram(out, 'flujo').doc.edges[0]!.color).toBe(2);
    expect(applyEdit(d, { op: 'edgeAttrs', ids: ['e0'], set: { w: 9 } }).inverse).toEqual([]);
  });
  it('style sigue como alias', () => {
    const d = P('[A] --> [B] {x=1,y=2}\n', 'flujo');
    expect(check(d, { op: 'style', id: 'e0', route: 'recta' })).toBe('[A] --> [B] {x=1,y=2,recta}\n');
  });
  it('rename/reparent de mapa conservan atributos nuevos', () => {
    const d = P(MAPA, 'mapa');
    expect(check(d, { op: 'rename', id: id(d, 'Uno'), text: 'Otro' })).toContain('- Otro {x=1,y=2,color=3,w=100,fs=l}');
    expect(check(d, { op: 'reparent', id: id(d, 'Dos'), parent: id(d, 'Tres') })).toContain('  - Dos {foo,color=9}');
  });
  it('addChild con attrs', () => {
    const d = P(MAPA, 'mapa');
    expect(check(d, { op: 'addChild', parent: id(d, 'Tres'), text: 'Nuevo', attrs: { color: 2, x: 5, y: 6 } })).toContain('  - Nuevo {x=5,y=6,color=2}');
    const f = P('[A]\n', 'flujo');
    expect(check(f, { op: 'addChild', parent: 'n0', text: 'B', attrs: { color: 2 } })).toBe('[A]\n[A] --> [B]\n[B] {color=2}\n');
  });
  it('backdrop: escribe, reemplaza y quita en la primera línea', () => {
    const d = P('[A] --> [B]\n', 'flujo');
    const w = check(d, { op: 'backdrop', value: 'puntos' });
    expect(w).toBe('# fondo: puntos\n[A] --> [B]\n');
    const d2 = P(w, 'flujo');
    expect(check(d2, { op: 'backdrop', value: 'oscuro' })).toBe('# fondo: oscuro\n[A] --> [B]\n');
    expect(check(d2, { op: 'backdrop' })).toBe('[A] --> [B]\n');
    expect(check(d2, { op: 'backdrop', value: 'cristal' })).toBe('[A] --> [B]\n');
    expect(applyEdit(d, { op: 'backdrop' }).inverse).toEqual([]);
    expect(applyEdit(d, { op: 'backdrop', value: 'x' as never }).inverse).toEqual([]);
    expect(T(applyEdit(P('', 'mapa'), { op: 'backdrop', value: 'gris' }).doc)).toBe('# fondo: gris');
  });
});

describe('P22 · parseOutline y addTree', () => {
  it('parseOutline', () => {
    expect(parseOutline('- a\n  - b\n    * c\n- d\n\n1. e\n2) f')).toEqual([
      { text: 'a', depth: 0 }, { text: 'b', depth: 1 }, { text: 'c', depth: 2 }, { text: 'd', depth: 0 }, { text: 'e', depth: 0 }, { text: 'f', depth: 0 },
    ]);
    expect(parseOutline('uno\n  dos\ntres')).toEqual([{ text: 'uno', depth: 0 }, { text: 'dos', depth: 0 }, { text: 'tres', depth: 0 }]);
    expect(parseOutline('• a\n\t• b')).toEqual([{ text: 'a', depth: 0 }, { text: 'b', depth: 1 }]);
    expect(parseOutline('  - a\n- b')).toEqual([{ text: 'a', depth: 0 }, { text: 'b', depth: 0 }]);
  });
  it('addTree: 200 líneas en un paso, deshacer exacto', () => {
    const d = P('R\n- X\n  - Y\n- Z\n', 'mapa');
    const items = parseOutline(Array.from({ length: 200 }, (_, i) => `${i % 3 ? '  ' : ''}- n${i}`).join('\n'));
    const r = applyEdit(d, { op: 'addTree', parent: id(d, 'X'), items });
    expect(r.inverse.length).toBe(1);
    expect(r.doc.nodes.length).toBe(204);
    expect(T(r.doc).startsWith('R\n- X\n  - Y\n    - n0\n')).toBe(false); // hijos de X, tras el subárbol de Y
    expect(r.doc.nodes.find((n) => n.text === 'n0')!.parent).toBe(id(d, 'X'));
    expect(T(applyEdit(r.doc, r.inverse[0]!).doc)).toBe(T(d));
  });
  it('addTree inválido = no-op', () => {
    const d = P('R\n- X\n', 'mapa');
    const bad = (e: Edit) => expect(applyEdit(d, e).inverse).toEqual([]);
    bad({ op: 'addTree', parent: 'zz', items: [{ text: 'a', depth: 0 }] });
    bad({ op: 'addTree', parent: 'n1', items: [{ text: 'a', depth: 1 }] });
    bad({ op: 'addTree', parent: 'n1', items: [{ text: 'a', depth: 0 }, { text: 'b', depth: 2 }] });
    bad({ op: 'addTree', parent: 'n1', items: [] });
    bad({ op: 'addTree', parent: 'n1', items: Array.from({ length: 300 }, () => ({ text: 'a', depth: 0 })) });
    const f = P('[A]\n', 'flujo');
    expect(applyEdit(f, { op: 'addTree', parent: 'n0', items: [{ text: 'a', depth: 0 }] }).inverse).toEqual([]);
  });
});
