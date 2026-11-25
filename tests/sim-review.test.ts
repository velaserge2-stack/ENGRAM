import { describe, expect, it } from 'vitest';
import { acceptInto, editPending, equivalents, equivalentPrompt, examples, loadPending, savePending, toPending, validateGenerated } from '../src/sim/review';
import { finalize, parseBankMarkdown, type Question } from '../src/sim/parse';
import { MemoryBackend } from '../src/vault/memory';

const mk = (i: number, topic: string, extra: Partial<Question> = {}): Question => finalize({ n: i, case: '', text: `Pregunta ${i}`, options: [{ key: 'A', text: 'a' + i }, { key: 'B', text: 'b' + i }], answer: ['A'], explanation: 'e', topic, ...extra });
const BANK = `---\nexamen: Mi banco\nminutos: 30\n---\n1. ¿Dos más dos?\n   A) 4\n   B) 5\n   Respuesta: A\n   Explicación: Suma.\n   Tema: Mate\n`;
const GEN = `1. ¿Tres más tres?\n   A) 6\n   B) 7\n   Respuesta: A\n   Explicación: Suma.\n   Tema: Mate\n\n2. ¿Cuatro más cuatro?\n   A) 8\n   B) 8\n   Respuesta: A\n   Tema: Mate\n\n3. ¿Dos más dos?\n   A) 4\n   B) 5\n   Respuesta: A\n   Explicación: x\n`;

describe('revisión IA', () => {
  const bank = parseBankMarkdown(BANK, 'b').questions;
  it('valida: opciones duplicadas, sin explicación, repetida', () => {
    const p = toPending(GEN, bank);
    expect(p[0]!.errors).toEqual([]);
    expect(p[1]!.errors).toEqual(expect.arrayContaining(['duplicadas', 'explicacion']));
    expect(p[2]!.errors).toContain('repetida');
    expect(validateGenerated({ ...mk(1, 't'), answer: ['A', 'B'] }, [])).toContain('correcta');
    expect(validateGenerated({ ...mk(1, 't'), options: [{ key: 'A', text: 'x' }] }, [])).toContain('opciones');
  });
  it('editar revalida', () => {
    const p = toPending(GEN, bank)[1]!;
    const e = editPending(p, { options: [{ key: 'A', text: '8' }, { key: 'B', text: '9' }], explanation: 'ok' }, bank);
    expect(e.errors).toEqual([]);
  });
  it('pendientes: no tocan el banco hasta aceptar; aceptar añade con origen: ia', async () => {
    const v = new MemoryBackend();
    await v.write('exams-bank/b.md', BANK);
    const p = toPending(GEN, bank).slice(0, 1);
    await savePending(v, 'exams-bank/b.md', p);
    expect(await v.read('exams-bank/b.md').then((x) => new TextDecoder().decode(x as Uint8Array).includes('Tres'))).toBe(false);
    expect((await loadPending(v, 'exams-bank/b.md'))[0]!.q.text).toBe('¿Tres más tres?');
    const out = acceptInto(BANK, 'b', p[0]!.q);
    expect(out).toContain('origen: ia');
    expect(parseBankMarkdown(out, 'b').questions.map((q) => q.text)).toEqual(['¿Dos más dos?', '¿Tres más tres?']);
    await savePending(v, 'exams-bank/b.md', []);
    expect(await loadPending(v, 'exams-bank/b.md')).toEqual([]);
  });
  it('equivalentes: mismo tema y dificultad; plantilla con ejemplos', () => {
    const pool = [mk(1, 'A'), mk(2, 'A'), mk(3, 'B')];
    expect(equivalents(pool[0]!, pool, new Map()).map((q) => q.text)).toEqual(['Pregunta 2']);
    const t = equivalentPrompt(examples(pool, 2, 's'), 4);
    expect(t).toContain('Respuesta:');
    expect(t).toContain('Pregunta');
  });
});

describe('pendientes dañadas', () => {
  it('loadPending descarta lo que no tiene forma de pregunta y revalida', async () => {
    const v = new MemoryBackend();
    const good = mk(1, 'Mate');
    await v.write('.app/exam-pending/b.json', JSON.stringify([{ q: null }, { q: { text: 5 } }, { q: { text: 'x', options: [null] } }, { q: good }, 7]));
    const r = await loadPending(v, 'b');
    expect(r).toHaveLength(1);
    expect(r[0]!.q.text).toBe('Pregunta 1');
    await v.write('.app/exam-pending/c.json', '{no es json');
    expect(await loadPending(v, 'c')).toEqual([]);
  });
});
