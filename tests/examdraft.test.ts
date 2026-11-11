import { describe, expect, it } from 'vitest';
import { bankToDraft, draftToBank, emptyQ, move, validate } from '../src/sim/draft';
import { parseBankMarkdown, serializeBank } from '../src/sim/parse';

describe('editor visual de exámenes', () => {
  it('borrador → .md nativo → borrador es idéntico (editar a mano = editor visual)', () => {
    const d = {
      name: 'Cardio parcial', minutes: 45, shuffle: false,
      qs: [
        { case: 'Hombre de 58 años con dolor torácico', text: '¿Diagnóstico?', options: [{ text: 'Pericarditis', correct: false }, { text: 'IAM con elevación del ST', correct: true }, { text: 'Disección', correct: false }], explanation: 'Elevación del ST en II, III, aVF.', topic: 'Cardio/IAM' },
        { case: 'Hombre de 58 años con dolor torácico', text: '¿Qué arteria? ![[ecg.png]]', options: [{ text: 'CD', correct: true }, { text: 'DA', correct: false }, { text: 'Cx', correct: true }], explanation: '', topic: '' },
      ],
    };
    const md = serializeBank(draftToBank(d));
    expect(md.match(/Caso::/g)).toHaveLength(1); // el caso compartido se escribe una vez
    expect(md).toContain('Respuesta: A, C');
    const back = bankToDraft(parseBankMarkdown(md, 'x'));
    expect(back).toEqual(d);
  });
  it('quitar opciones vacías y reordenar no pierde la respuesta', () => {
    const q = { ...emptyQ(), text: 'P', options: [{ text: 'a', correct: false }, { text: '', correct: false }, { text: 'c', correct: true }] };
    const b = draftToBank({ name: 'X', minutes: 10, shuffle: true, qs: [{ ...q, options: move(q.options, 2, -2) }] });
    expect(b.questions[0]!.options.map((o) => o.text)).toEqual(['c', 'a']);
    expect(b.questions[0]!.answer).toEqual(['A']);
  });
  it('valida antes de guardar', () => {
    const v = validate({ name: '', minutes: 10, shuffle: true, qs: [{ ...emptyQ(), text: 'Sin correcta', options: [{ text: 'a', correct: false }, { text: 'b', correct: false }] }] });
    expect(v.exam).toEqual(['name']);
    expect(v.perQ[0]).toHaveLength(1); // sin respuesta marcada
  });
});
