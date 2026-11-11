import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { setLang } from '../src/i18n';
import { byTopic, isCorrect, parseBankCSV, parseBankJSON, parseBankMarkdown, parseText, score, serializeBank, summarize, timeLeft } from '../src/sim/parse';

const NATIVE = readFileSync(new URL('../examples/simulacros/cardio-parcial.md', import.meta.url), 'utf8');

describe('analizador de simulacros', () => {
  const b = parseBankMarkdown(NATIVE, 'x');
  it('formato nativo bien formado', () => {
    expect(b.name).toBe('Cardiología, parcial 1');
    expect(b.minutes).toBe(30);
    expect(b.questions.length).toBe(5);
    const [q1, q2, q3, q4, q5] = b.questions;
    expect(q1!.case).toContain('58 años');
    expect(q2!.case).toBe(q1!.case);
    expect(q1!.answer).toEqual(['B']);
    expect(q2!.answer).toEqual(['C']); // asterisco
    expect(q3!.answer).toEqual(['A']); // clave al final
    expect(q3!.options.map((o) => o.key)).toEqual(['A', 'B', 'C']);
    expect(q4!.problems).toEqual([]);
    expect(q5!.problems).toEqual(['Sin respuesta marcada']); // nunca adivina
    expect(q1!.explanation).toContain('coronaria derecha');
    expect(q1!.topic).toBe('Cardiología/IAM');
  });
  it('mal formado: avisa sin romper', () => {
    const qs = parseText('1) Sin opciones\nRespuesta: A\n\n2. Una sola\nA. única\nRespuesta: A\n\n3. Respuesta inexistente\nA) x\nB) y\nRespuesta: D\n\nTexto suelto que no es pregunta');
    expect(qs.map((q) => q.problems)).toEqual([['Sin opciones', 'La respuesta no coincide con ninguna opción'], ['Una sola opción'], ['La respuesta no coincide con ninguna opción']]);
    expect(summarize(qs)).toBe('3 preguntas detectadas; 2 con una sola opción o ninguna');
  });
  it('el resumen cuenta los problemas también en inglés y francés', () => {
    const txt = '1) Sin opciones\nRespuesta: A\n\n2. Una sola\nA. única\nRespuesta: A\n\n3. Sin marcar\nA) x\nB) y';
    try {
      setLang('en');
      expect(summarize(parseText(txt))).toBe('3 questions detected; 1 with no answer marked; 2 with a single option or none');
      setLang('fr');
      expect(summarize(parseText(txt))).toMatch(/^3 .*; 1 .*; 2 /);
    } finally {
      setLang('es');
    }
  });
  it('varias correctas', () => {
    const [q] = parseText('1. Elige dos\nA) a\nB) b\nC) c\nRespuesta: A, C');
    expect(q!.answer).toEqual(['A', 'C']);
    expect(isCorrect(q!, ['C', 'A'])).toBe(true);
    expect(isCorrect(q!, ['A'])).toBe(false);
  });
  it('CSV y JSON', () => {
    const c = parseBankCSV('pregunta,a,b,c,d,e,correcta,explicación,tema\n¿2+2?,3,4,5,,,B,suma,Mate\n');
    expect(c[0]).toMatchObject({ text: '¿2+2?', answer: ['B'], topic: 'Mate', problems: [] });
    expect(c[0]!.options.length).toBe(3);
    const j = parseBankJSON('[{"pregunta":"¿x?","opciones":{"a":"1","b":"2"},"correcta":"a"}]');
    expect(j[0]).toMatchObject({ answer: ['A'], problems: [] });
  });
  it('ida y vuelta al formato nativo', () => {
    const again = parseBankMarkdown(serializeBank(b), 'x');
    expect(again.questions.map((q) => q.id)).toEqual(b.questions.map((q) => q.id));
    expect(again.questions.map((q) => q.answer)).toEqual(b.questions.map((q) => q.answer));
  });
  it('puntaje con penalización, temas y tiempo', () => {
    const qs = b.questions.slice(0, 4);
    const ans = { [qs[0]!.id]: ['B'], [qs[1]!.id]: ['A'], [qs[2]!.id]: ['A'] };
    expect(score(qs, ans)).toMatchObject({ correct: 2, wrong: 1, blank: 1, pct: 0.5, passed: false });
    expect(score(qs, ans, 0.25).points).toBe(1.75);
    expect(byTopic(qs, ans).find((t) => t.topic === 'Cardiología/IAM')).toEqual({ topic: 'Cardiología/IAM', n: 2, ok: 1 });
    expect(timeLeft(10_000, 4_000)).toBe(6_000);
    expect(timeLeft(10_000, 99_000)).toBe(0);
  });
});
