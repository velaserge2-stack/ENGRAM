import { describe, expect, it } from 'vitest';
import { step, view, type ChatEvent, type ChatState } from '../src/chat/state';

const s = (open: boolean, rest: 'barra' | 'mascota'): ChatState => ({ open, rest });

describe('estado único del Asistente', () => {
  it('muestra un solo elemento', () => {
    expect(view(s(false, 'barra'))).toBe('barra');
    expect(view(s(false, 'mascota'))).toBe('mascota');
    expect(view(s(true, 'barra'))).toBe('chat');
    expect(view(s(true, 'mascota'))).toBe('chat');
  });
  it('teléfono: sin pastilla; reposo = mascota', () => {
    expect(view(s(false, 'barra'), true)).toBe('mascota');
    expect(view(s(true, 'barra'), true)).toBe('chat');
  });
  it('mascota → barra → chat → vuelve al reposo', () => {
    let x = s(false, 'mascota');
    x = step(x, 'restaurar'); expect(view(x)).toBe('barra');
    x = step(x, 'abrir'); expect(view(x)).toBe('chat');
    x = step(x, 'cerrar'); expect(view(x)).toBe('barra');
    x = step(x, 'minimizar'); expect(view(x)).toBe('mascota');
  });
  it('abrir el chat es transitorio: no cambia el reposo; el atajo alterna', () => {
    const m = s(false, 'mascota');
    expect(step(m, 'abrir').rest).toBe('mascota');
    expect(view(step(step(m, 'alternar'), 'alternar'))).toBe('mascota');
    expect(view(step(s(true, 'barra'), 'minimizar'))).toBe('mascota');
  });
  it('toda secuencia deja exactamente un estado válido', () => {
    const evs: ChatEvent[] = ['abrir', 'cerrar', 'alternar', 'minimizar', 'restaurar'];
    for (const a of evs) for (const b of evs) for (const c of evs) {
      const v = view(step(step(step(s(false, 'barra'), a), b), c));
      expect(['mascota', 'barra', 'chat']).toContain(v);
    }
  });
});
