import { describe, expect, it } from 'vitest';
import { cleanAction, MAX_ACTIONS, MAX_ACTION_LEN, normActions } from '../src/lib/settings';

describe('acciones rápidas del Asistente', () => {
  it('sin lista guardada = las de fábrica (null)', () => {
    expect(normActions(undefined)).toBeNull();
    expect(normActions('x')).toBeNull();
  });
  it('una sola línea, recortada a 120 y sin vacías', () => {
    expect(cleanAction('  hola\n  mundo\t[x] ')).toBe('hola mundo [x]');
    expect(cleanAction('x'.repeat(300)).length).toBe(MAX_ACTION_LEN);
    expect(normActions(['a', '', '   ', 5, 'b'])).toEqual(['a', 'b']);
  });
  it('máximo 8', () => {
    expect(normActions(Array.from({ length: 20 }, (_, i) => `a${i}`))).toHaveLength(MAX_ACTIONS);
  });
});
