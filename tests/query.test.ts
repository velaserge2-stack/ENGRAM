import { describe, expect, it } from 'vitest';
import { compile, type Row } from '../src/lib/query';

const NOW = 1_000_000_000_000;
const D = 86_400_000;
const r = (p: Partial<Row>): Row => ({ cid: 'a', front: 'Fibrilación auricular', deck: 'Cardiología/ECG', type: 'basic', state: 2, due: NOW + 2 * D, lapses: 0, reps: 3, stability: 5, difficulty: 5, suspended: false, tags: ['ecg', 'urgencias'], ...p });

describe('consultas del navegador', () => {
  it('filtros básicos', () => {
    expect(compile('tag:ecg due:<3 deck:Cardio')(r({}), NOW)).toBe(true);
    expect(compile('due:<1')(r({}), NOW)).toBe(false);
    expect(compile('is:leech')(r({ lapses: 8 }), NOW)).toBe(true);
    expect(compile('is:new')(r({ state: 0 }), NOW)).toBe(true);
    expect(compile('is:suspended')(r({}), NOW)).toBe(false);
    expect(compile('lapses:>2')(r({ lapses: 3 }), NOW)).toBe(true);
  });
  it('texto sin acentos, frases y negación', () => {
    expect(compile('fibrilacion')(r({}), NOW)).toBe(true);
    expect(compile('"auricular"')(r({}), NOW)).toBe(true);
    expect(compile('-tag:urgencias')(r({}), NOW)).toBe(false);
    expect(compile('-is:new')(r({}), NOW)).toBe(true);
    expect(compile('ventricular')(r({}), NOW)).toBe(false);
  });
});
