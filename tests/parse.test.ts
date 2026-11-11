import { describe, expect, it } from 'vitest';
import { autoGrade, cardsOf, checkTyped, ensureIds, parseDeck, replaceBlock } from '../src/cards/parse';

const DECK = `---
deck: Cardiología
tags: [ecg, urgencias]
---
# Título libre

Q:: ¿Qué derivaciones ven la pared inferior?
A:: [II, III y aVF]{.azul} ^c01a
Cloze: La {{c1::fibrilación auricular}} no tiene {{c2::ondas P::onda}}. ^c02b
IO: ![[ecg-bloqueo.png]] <!-- io: 10,20,30,12; 55,40,20,10 --> ^c03c

QR:: Ida
A:: Vuelta ^c04d

T:: Capital de Francia
A:: París ^c05e

L:: Capas de la piel
- Epidermis
- Dermis
- Hipodermis ^c06f

MC:: ¿Cuál es par craneal?
- [x] Óptico
- [ ] Radial
- [x] Vago ^c07g

MATCH:: Une
- II => inferior
- V1 => septal ^c08h

ORD:: Ciclo
- Sístole
- Diástole ^c09i

Q:: Sin ID
A:: luego
`;

describe('parser de mazos', () => {
  const d = parseDeck(DECK);
  it('reconoce todos los tipos', () => {
    expect(d.notes.map((n) => n.type)).toEqual(['basic', 'cloze', 'io', 'reverse', 'type', 'list', 'mc', 'match', 'order', 'basic']);
    expect(d.missingIds).toBe(1);
    expect(d.data.deck).toBe('Cardiología');
  });
  it('campos', () => {
    const [b, c, io, , , l, mc, m, o] = d.notes;
    expect(b!.front).toBe('¿Qué derivaciones ven la pared inferior?');
    expect(b!.back).toBe('[II, III y aVF]{.azul}');
    expect(c!.clozes).toEqual([1, 2]);
    expect(io!.image).toBe('ecg-bloqueo.png');
    expect(io!.rects).toEqual([{ x: 10, y: 20, w: 30, h: 12 }, { x: 55, y: 40, w: 20, h: 10 }]);
    expect(l!.items).toEqual(['Epidermis', 'Dermis', 'Hipodermis']);
    expect(mc!.options.filter((x) => x.correct).map((x) => x.text)).toEqual(['Óptico', 'Vago']);
    expect(m!.pairs).toEqual([['II', 'inferior'], ['V1', 'septal']]);
    expect(o!.items).toEqual(['Sístole', 'Diástole']);
    expect(d.notes.every((n) => n.errors.length === 0)).toBe(true);
  });
  it('genera tarjetas por nota', () => {
    const ids = d.notes.flatMap(cardsOf).map((c) => c.cid);
    expect(ids).toEqual(['c01a', 'c02b:c1', 'c02b:c2', 'c03c:o1', 'c03c:o2', 'c04d', 'c04d:r', 'c05e', 'c06f', 'c07g', 'c08h', 'c09i']);
  });
  it('reporta errores sin romper', () => {
    const e = parseDeck('Q:: sin respuesta ^x1\n\nCloze: nada ^x2\n\nMC:: q\n- [ ] a\n- [ ] b ^x3\n\nQ:: a\nA:: b ^x1');
    expect(e.notes.map((n) => n.errors.length > 0)).toEqual([true, true, true, true]);
    expect(e.errors.some((x) => x.includes('repetido'))).toBe(true);
  });
  it('ensureIds añade IDs solo donde faltan y conserva el resto', () => {
    let i = 0;
    const r = ensureIds(DECK, new Set(), () => [0.5, 0.25][i++ % 2]!);
    expect(r.added.length).toBe(1);
    expect(r.text.startsWith('---\ndeck: Cardiología')).toBe(true);
    expect(r.text).toContain(`A:: luego ^${r.added[0]}`);
    expect(parseDeck(r.text).missingIds).toBe(0);
    expect(ensureIds(r.text).added).toEqual([]);
  });
  it('replaceBlock edita una nota conservando su ID', () => {
    const t = replaceBlock(DECK, 'c05e', 'T:: Capital de Italia\nA:: Roma');
    const n = parseDeck(t).notes.find((x) => x.id === 'c05e')!;
    expect(n.front).toBe('Capital de Italia');
    expect(n.back).toBe('Roma');
    expect(parseDeck(t).notes.length).toBe(d.notes.length);
  });
  it('respuestas escritas', () => {
    expect(checkTyped('paris', 'París')).toBe('correct');
    expect(checkTyped('pariss', 'París')).toBe('almost');
    expect(checkTyped('Roma', 'París')).toBe('wrong');
    expect(checkTyped('fibrilacion auricular', 'Fibrilación  auricular.')).toBe('correct');
  });
  it('calificación automática', () => {
    expect(autoGrade(0, 3000, 3)).toBe(4);
    expect(autoGrade(0, 30000, 3)).toBe(3);
    expect(autoGrade(2, 0, 3)).toBe(2);
    expect(autoGrade(3, 0, 3)).toBe(1);
  });
});
