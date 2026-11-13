// Prompt 17: barra del editor de notas. Funciones puras de edición (texto → acción → texto).
import { describe, expect, it } from 'vitest';
import { activeMarks, alignOf, clearFormat, COLORS, duplicateBlock, indent, makeTable, mergeWithPrev, moveBlock, moveListItem, onParagraph, paragraphAt, removeBlock, setAlign, setSpanClass, setStyle, SIZES, styleOf, tableAt, tableOp, toggleList, toggleMark, type Sel } from '../src/notes/format';

const S = (text: string, s = 0, e = s): Sel => ({ text, s, e });
/** Selecciona `[`…`]` marcados en el texto (las marcas no quedan). */
const pick = (t: string): Sel => { const s = t.indexOf('['), e = t.indexOf(']') - 1; return { text: t.replace('[', '').replace(']', ''), s, e }; };

describe('marcas de texto (alternar)', () => {
  it('negrita, cursiva, subrayado, tachado, resaltado y código: poner y quitar', () => {
    for (const m of ['**', '*', '++', '~~', '==', '`'] as const) {
      const on = toggleMark(pick('hola [mundo] feliz'), m);
      expect(on.text).toBe(`hola ${m}mundo${m} feliz`);
      expect(on.text.slice(on.s, on.e)).toBe('mundo');
      const off = toggleMark(on, m);
      expect(off.text).toBe('hola mundo feliz');
      expect(toggleMark(off, m).text).toBe(on.text); // idempotente al repetir
    }
  });
  it('sin selección: la palabra bajo el cursor (Unicode y emoji)', () => {
    expect(toggleMark(S('el corazón late', 6), '**').text).toBe('el **corazón** late');
    expect(toggleMark(S('ñandú 🫀 aquí', 2), '==').text).toBe('==ñandú== 🫀 aquí');
    const empty = toggleMark(S('a  b', 2), '**');
    expect(empty.text).toBe('a **** b');
    expect(empty.s).toBe(4);
  });
  it('quitar con el cursor dentro de un tramo marcado', () => {
    expect(toggleMark(S('x **negrita fuerte** y', 7), '**').text).toBe('x negrita fuerte y');
    expect(toggleMark(S('**a** *b*', 7), '*').text).toBe('**a** b');
  });
  it('no corta [[enlaces]], ![[imágenes]] ni código; no envuelve espacios', () => {
    const t = 'ver [[Nota larga]] ahora';
    expect(toggleMark({ text: t, s: 6, e: 14 }, '**').text).toBe('ver **[[Nota larga]]** ahora');
    expect(toggleMark({ text: 'a `x+y` b', s: 3, e: 5 }, '==').text).toBe('a ==`x+y`== b');
    expect(toggleMark(pick('a[ b ]c'), '**').text).toBe('a **b** c');
  });
  it('selección de varias líneas: marca línea por línea', () => {
    expect(toggleMark({ text: '- uno\n- dos', s: 2, e: 11 }, '**').text).toBe('- **uno**\n- **dos**');
  });
  it('marcas activas en el cursor', () => {
    const a = activeMarks('**negrita** y ==res== y ++sub++', 3);
    expect([...a]).toEqual(['**']);
    expect(activeMarks('**negrita** y ==res== y ++sub++', 17).has('==')).toBe(true);
    expect(activeMarks('c++ y d++', 2).has('++')).toBe(false);
  });
});

describe('color y tamaño en [texto]{.clase}', () => {
  it('poner, cambiar, combinar y quitar', () => {
    const c = setSpanClass(pick('ver [rojo] ya'), COLORS, 'rojo');
    expect(c.text).toBe('ver [rojo]{.rojo} ya');
    const both = setSpanClass(c, SIZES, 'grande');
    expect(both.text).toBe('ver [rojo]{.rojo .grande} ya');
    const swap = setSpanClass(both, COLORS, 'azul');
    expect(swap.text).toBe('ver [rojo]{.grande .azul} ya');
    const noColor = setSpanClass(swap, COLORS, null);
    expect(noColor.text).toBe('ver [rojo]{.grande} ya');
    expect(setSpanClass(noColor, SIZES, null).text).toBe('ver rojo ya');
  });
  it('alternar el mismo valor lo quita; no envuelve enlaces ni corchetes sueltos', () => {
    const c = setSpanClass(pick('[hola]'), SIZES, 'grande');
    expect(setSpanClass(c, SIZES, 'grande').text).toBe('hola');
    expect(setSpanClass({ text: 'a [b c', s: 2, e: 6 }, COLORS, 'rojo').text).toBe('a [b c');
  });
  it('quitar formato', () => {
    const a = '**hola** ==mundo== [x]{.rojo}';
    expect(clearFormat({ text: a, s: 0, e: a.length }).text).toBe('hola mundo x');
    const b = '**ver** [[Nota*rara]] `a*b`';
    expect(clearFormat({ text: b, s: 0, e: b.length }).text).toBe('ver [[Nota*rara]] `a*b`');
    expect(clearFormat(S('a **negrita** b', 6)).text).toBe('a negrita b');
  });
});

describe('estilo y alineación de párrafo', () => {
  it('títulos, cita, código y callout (ida y vuelta)', () => {
    const p = 'Texto del párrafo';
    for (const st of ['h1', 'h2', 'h3', 'quote', 'code', 'callout', 'p'] as const) {
      const x = setStyle(p, st);
      expect(styleOf(x)).toBe(st);
      expect(setStyle(x, 'p')).toBe(p);
    }
    expect(setStyle('# Viejo', 'h2')).toBe('## Viejo');
    expect(setStyle('> a\n> b', 'p')).toBe('a\nb');
  });
  it('alineación con marca final, solo en párrafos y títulos', () => {
    expect(setAlign('Hola', 'centro')).toBe('Hola {.centro}');
    expect(alignOf('Hola {.centro}')).toBe('centro');
    expect(setAlign('Hola {.centro}', 'centro')).toBe('Hola'); // alternar
    expect(setAlign('Hola {.centro}', 'der')).toBe('Hola {.der}');
    expect(setAlign('- lista', 'centro')).toBe('- lista');
    expect(setStyle('Hola {.der}', 'h1')).toBe('# Hola {.der}'); // el estilo conserva la alineación
  });
  it('párrafo bajo el cursor (sin partir un bloque de código)', () => {
    const t = 'uno\n\ndos\ntres\n\n```\na\n\nb\n```';
    expect(t.slice(...paragraphAt(t, 6))).toBe('dos\ntres');
    expect(t.slice(...paragraphAt(t, t.length - 2))).toBe('```\na\n\nb\n```');
    expect(onParagraph({ text: t, s: 6, e: 6 }, (p) => setStyle(p, 'h2')).text).toBe('uno\n\n## dos tres\n\n```\na\n\nb\n```');
  });
});

describe('listas', () => {
  it('viñetas, numerada y tareas; alternar y cambiar de tipo', () => {
    const t = { text: 'uno\ndos', s: 0, e: 7 };
    const ul = toggleList(t, 'ul');
    expect(ul.text).toBe('- uno\n- dos');
    expect(toggleList(ul, 'ol').text).toBe('1. uno\n2. dos');
    expect(toggleList(ul, 'task').text).toBe('- [ ] uno\n- [ ] dos');
    expect(toggleList(ul, 'ul').text).toBe('uno\ndos');
    expect(toggleList({ ...toggleList(ul, 'task'), s: 0, e: 100 }, 'task').text).toBe('uno\ndos');
  });
  it('sangría ± y mover un elemento con sus hijos', () => {
    expect(indent({ text: '- a\n- b', s: 4, e: 4 }, 1).text).toBe('- a\n  - b');
    expect(indent({ text: '- a\n  - b', s: 6, e: 6 }, -1).text).toBe('- a\n- b');
    const t = '- a\n  - a1\n- b';
    const m = moveListItem({ text: t, s: 0, e: 0 }, 1)!;
    expect(m.text).toBe('- b\n- a\n  - a1');
    expect(moveListItem({ text: m.text, s: m.s, e: m.e }, -1)!.text).toBe(t);
    expect(moveListItem({ text: 'no es lista', s: 0, e: 0 }, 1)).toBeNull();
  });
});

describe('tablas', () => {
  it('insertar 3×3 y operar', () => {
    const t = makeTable(3, 3, (i) => `C${i}`);
    expect(t).toBe('| C1 | C2 | C3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |');
    const tb = tableAt(t, 2)!;
    expect(tb.rows.length).toBe(3);
    const r = tableOp({ text: t, s: 2, e: 2 }, 'addRow')!;
    expect(r.text.split('\n').length).toBe(5);
    const c = tableOp({ text: t, s: 7, e: 7 }, 'addCol')!;
    expect(c.text.split('\n')[0]).toBe('| C1 | C2 |  | C3 |');
    const al = tableOp({ text: t, s: 2, e: 2 }, 'c')!;
    expect(al.text.split('\n')[1]).toBe('| :-: | --- | --- |');
    const fit = tableOp({ text: '| a | bbbbb |\n|---|---|\n| cc | d |', s: 2, e: 2 }, 'fit')!;
    expect(fit.text).toBe('| a   | bbbbb |\n| --- | ----- |\n| cc  | d     |');
    expect(tableOp({ text: 'sin tabla', s: 0, e: 0 }, 'addRow')).toBeNull();
  });
  it('borrar fila/columna; la cabecera y la última columna no se pierden', () => {
    const t = '| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |';
    const pos = t.indexOf('3');
    expect(tableOp({ text: t, s: pos, e: pos }, 'delRow')!.text).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(tableOp({ text: t, s: 2, e: 2 }, 'delRow')).toBeNull();
    expect(tableOp({ text: '| a |\n|---|\n| 1 |', s: 2, e: 2 }, 'delCol')).toBeNull();
  });
});

describe('bloques: mover, duplicar, eliminar, combinar', () => {
  const B = ['# A', 'a1 ^c1', '## A2', 'a2', '# B', 'b1'];
  it('mover arriba/abajo sin tocar el texto (los ^id de tarjetas viajan con su párrafo)', () => {
    const m = moveBlock(B, 1, 1)!;
    expect(m.blocks).toEqual(['# A', '## A2', 'a1 ^c1', 'a2', '# B', 'b1']);
    expect(moveBlock(m.blocks, m.i, -1)!.blocks).toEqual(B);
    expect(moveBlock(B, 0, -1)).toBeNull();
    expect(moveBlock(B, 5, 1)).toBeNull();
  });
  it('mover una sección completa', () => {
    const down = moveBlock(B, 0, 1, true)!;
    expect(down.blocks).toEqual(['# B', 'b1', '# A', 'a1 ^c1', '## A2', 'a2']);
    expect(moveBlock(down.blocks, down.i, -1, true)!.blocks).toEqual(B);
  });
  it('duplicar, eliminar y combinar', () => {
    expect(duplicateBlock(['a', 'b'], 0)).toEqual(['a', 'a', 'b']);
    expect(removeBlock(['a', 'b'], 0)).toEqual(['b']);
    expect(mergeWithPrev(['a', 'b'], 1)).toEqual(['a\nb']);
    expect(mergeWithPrev(['a'], 0)).toBeNull();
  });
});

describe('historial de la nota', async () => {
  const { createHistory } = await import('../src/notes/history');
  it('una acción = un paso; el tecleo seguido se agrupa; rehacer se borra al cambiar', () => {
    let t = 0;
    const h = createHistory(100, () => t);
    h.record('a', 'action'); // a → b
    h.record('b', 'type'); t += 300; // b → bc
    h.record('bc', 'type'); t += 300; // bc → bcd (mismo paso)
    t += 2000;
    h.record('bcd', 'type'); // bcd → bcde (paso nuevo)
    expect(h.undo('bcde')).toBe('bcd');
    expect(h.undo('bcd')).toBe('b');
    expect(h.undo('b')).toBe('a');
    expect(h.undo('a')).toBeNull();
    expect(h.redo('a')).toBe('b');
    h.record('b', 'action');
    expect(h.canRedo).toBe(false);
  });
});

describe('tarjetas con origen #pN al mover bloques', async () => {
  const { paraMap } = await import('../src/notes/format');
  const { remapSources } = await import('../src/notes/sources');
  const { MemoryBackend } = await import('../src/vault/memory');
  it('mover dos párrafos actualiza el número en el mazo', async () => {
    const before = 'Título\n\nPrimer párrafo largo\n\nSegundo párrafo largo';
    const after = 'Título\n\nSegundo párrafo largo\n\nPrimer párrafo largo';
    expect([...paraMap(before, after)]).toEqual([[0, 0], [1, 2], [2, 1]]);
    const v = new MemoryBackend();
    await v.write('decks/a.md', 'Q:: uno\nA:: x <!-- src: notes/N.md#p1 -->\n\nQ:: dos\nA:: y <!-- src: notes/N.md#p2 -->\n\nQ:: otra\nA:: z <!-- src: notes/Otra.md#p1 -->');
    expect(await remapSources(v, ['decks/a.md'], 'notes/N.md', before, after)).toBe(2);
    const t = new TextDecoder().decode(await v.read('decks/a.md'));
    expect(t).toContain('notes/N.md#p2 -->\n\nQ:: dos');
    expect(t).toContain('dos\nA:: y <!-- src: notes/N.md#p1 -->');
    expect(t).toContain('notes/Otra.md#p1'); // otra nota: intacta
    // deshacer: el mapa inverso deja todo como estaba
    await remapSources(v, ['decks/a.md'], 'notes/N.md', after, before);
    expect(new TextDecoder().decode(await v.read('decks/a.md'))).toContain('uno\nA:: x <!-- src: notes/N.md#p1 -->');
  });
});
