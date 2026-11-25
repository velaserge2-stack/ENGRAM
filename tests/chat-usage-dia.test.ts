import { describe, expect, it } from 'vitest';
import { bar, dayOf, emptyUsage, record } from '../src/chat/usage';

const LIM = { rpm: 1000, rpd: 10, tpm: 1e9 };
describe('día de cuota por proveedor', () => {
  // 2026-11-25 07:30 UTC = 24 nov 23:30 en Los Ángeles (PST, UTC−8)
  const antes = Date.UTC(2026, 10, 25, 7, 30), despues = Date.UTC(2026, 10, 25, 8, 30);
  it('Gemini cambia de día a medianoche del Pacífico; Groq, en UTC', () => {
    expect(dayOf(antes, 'gemini')).toBe('2026-11-24');
    expect(dayOf(despues, 'gemini')).toBe('2026-11-25');
    expect(dayOf(antes, 'groq')).toBe('2026-11-25');
  });
  it('la barra de Gemini se reinicia a medianoche del Pacífico, no a medianoche UTC', () => {
    let u = emptyUsage();
    for (let i = 0; i < 5; i++) u = record(u, 'k', 0, Date.UTC(2026, 10, 25, 1, 0), 'gemini'); // 24 nov 17:00 PST
    expect(bar(u, 'k', LIM, antes, 0.8, 'gemini').pct).toBe(0.5); // ya pasó la medianoche UTC: sigue contando
    expect(bar(u, 'k', LIM, despues, 0.8, 'gemini').pct).toBe(0); // pasó la del Pacífico: reiniciada
  });
});
