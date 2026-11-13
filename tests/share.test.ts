import { describe, expect, it } from 'vitest';
import { activity } from '../src/lib/stats';
import { addPlace, clipPlace, defaultShow, ellipsize, fileName, fmtDuration, periodRange, safeZone, SIZE, summarize } from '../src/share/period';
import { mergeSettings } from '../src/lib/settings';
import type { LogEntry } from '../src/srs/engine';

const TZ = 'America/Mexico_City';
const at = (iso: string) => Date.parse(iso);

describe('Compartir estadísticas · cuentas (Prompt 19)', () => {
  it('horas y minutos sin ceros inútiles, con miles del idioma', () => {
    expect(fmtDuration(0, 'es-MX')).toBe('0 min');
    expect(fmtDuration(15 * 60_000, 'es-MX')).toBe('15 min');
    expect(fmtDuration(5 * 3_600_000, 'es-MX')).toBe('5 h');
    expect(fmtDuration(42 * 3_600_000 + 15 * 60_000, 'es-MX')).toBe('42 h 15 min');
    expect(fmtDuration(1234 * 3_600_000, 'en')).toBe('1,234 h');
    expect(fmtDuration(1234 * 3_600_000, 'fr').replace(/\s/g, ' ')).toBe('1 234 h');
  });

  it('rangos de periodo (inclusivos; «todo» desde la primera actividad)', () => {
    expect(periodRange('hoy', '2026-11-13')).toEqual({ from: '2026-11-13', to: '2026-11-13' });
    expect(periodRange('7', '2026-11-13')).toEqual({ from: '2026-11-07', to: '2026-11-13' });
    expect(periodRange('30', '2026-11-13').from).toBe('2026-10-15');
    expect(periodRange('anio', '2026-11-13').from).toBe('2026-01-01');
    expect(periodRange('todo', '2026-11-13', '2025-02-01').from).toBe('2025-02-01');
    expect(periodRange('todo', '2026-11-13').from).toBe('2026-11-13');
  });

  it('cuenta tarjetas y horas por periodo con el corte de las 4:00 y la zona horaria', () => {
    const log: LogEntry[] = [
      // 13 nov 03:30 en CDMX = aún 12 nov (corte a las 4:00)
      { id: 'a', ts: at('2026-11-13T09:30:00Z'), rating: 3, ms: 30_000, state: 2, ivl: 30 },
      { id: 'b', ts: at('2026-11-13T15:00:00Z'), rating: 1, ms: 120_000, state: 2, ivl: 30 }, // ms se acota a 60 s
      { id: 'c', ts: at('2026-11-01T15:00:00Z'), rating: 4, ms: 10_000, state: 2, ivl: 3 },
      { id: 'd', ts: at('2026-11-13T15:30:00Z') }, // sin calificación (operación): no cuenta
    ];
    const act = activity(log, { pomodoro: [], exams: [] }, TZ, 4);
    const hoy = summarize(act, log, 'hoy', '2026-11-13', TZ, 4);
    expect(hoy.cards).toBe(1);
    expect(hoy.ms).toBe(60_000);
    expect(hoy.retention).toBe(0);
    const sem = summarize(act, log, '7', '2026-11-13', TZ, 4);
    expect(sem.cards).toBe(2);
    expect(sem.days).toBe(2);
    expect(sem.retention).toBe(0.5);
    const todo = summarize(act, log, 'todo', '2026-11-13', TZ, 4);
    expect(todo.cards).toBe(3);
    expect(todo.from).toBe('2026-11-01');
    // vacío honesto
    expect(summarize(new Map(), [], '30', '2026-11-13', TZ, 4)).toMatchObject({ cards: 0, ms: 0, retention: null });
  });

  it('recorta nombres largos por grafemas, sin partir emoji', () => {
    const m = (s: string) => [...s].length * 10;
    expect(ellipsize('Ana', 100, m)).toBe('Ana');
    const r = ellipsize('María Fernanda de los Ángeles 👩🏽‍⚕️', 120, m);
    expect(r.endsWith('…')).toBe(true);
    expect(m(r)).toBeLessThanOrEqual(120);
    expect(ellipsize('👩🏽‍⚕️👩🏽‍⚕️👩🏽‍⚕️👩🏽‍⚕️', 30, (s) => [...new Intl.Segmenter().segment(s)].length * 10)).toBe('👩🏽‍⚕️👩🏽‍⚕️…');
  });

  it('zonas seguras por formato (Historia deja libres ~250 px arriba y abajo)', () => {
    expect(SIZE.historia).toMatchObject({ w: 1080, h: 1920 });
    expect(SIZE.vertical).toMatchObject({ w: 1080, h: 1350 });
    expect(SIZE.cuadrada).toMatchObject({ w: 1080, h: 1080 });
    const z = safeZone('historia');
    expect(z.y).toBeGreaterThanOrEqual(250);
    expect(1920 - (z.y + z.h)).toBeGreaterThanOrEqual(250);
  });

  it('privacidad por defecto: nombre y foto solo si están en el perfil', () => {
    expect(defaultShow({ name: '', photo: '', emoji: '' })).toMatchObject({ name: false, photo: false, line: false, hours: true, cards: true, brand: true });
    expect(defaultShow({ name: 'Ana', photo: '', emoji: '🧠' })).toMatchObject({ name: true, photo: true });
  });

  it('nombre de archivo y ajustes retrocompatibles', () => {
    expect(fileName('2026-11-13', 'png')).toBe('engrama-estadisticas-2026-11-13.png');
    expect(mergeSettings({}).share).toEqual({ format: 'vertical', period: '7', show: {}, neutral: false, places: [], rememberPlace: false, lastPlace: '' });
    expect(mergeSettings({ share: { format: 'otro', period: 'x', show: [], neutral: 'si', places: 'x', rememberPlace: 'si', lastPlace: 'Casa' } }).share).toEqual({ format: 'vertical', period: '7', show: {}, neutral: false, places: [], rememberPlace: false, lastPlace: '' });
    const s = mergeSettings({ share: { format: 'historia', period: 'todo', show: { name: false }, neutral: true } });
    expect(mergeSettings(JSON.parse(JSON.stringify(s))).share).toEqual(s.share); // idempotente
  });
  it('lugar: recorte a 40 grafemas con «…», espacios colapsados, vacío = nada', () => {
    expect(clipPlace('  Café   Punta del Cielo ')).toBe('Café Punta del Cielo');
    expect(clipPlace('')).toBe('');
    expect(clipPlace('   ')).toBe('');
    const largo = 'Biblioteca central de la Facultad de Medicina, piso 3';
    expect([...clipPlace(largo)].length).toBe(40);
    expect(clipPlace(largo).endsWith('…')).toBe(true);
    expect(clipPlace('x'.repeat(40))).toBe('x'.repeat(40));
    expect(clipPlace('☕'.repeat(45)).endsWith('☕…')).toBe(true);
  });
  it('lugares recientes: al frente, sin repetidos, máximo 5', () => {
    let l: string[] = [];
    for (const p of ['A', 'B', 'C', 'D', 'E', 'F']) l = addPlace(l, p);
    expect(l).toEqual(['F', 'E', 'D', 'C', 'B']);
    expect(addPlace(l, ' c ')).toEqual(['c', 'F', 'E', 'D', 'B']);
    expect(addPlace(l, '  ')).toBe(l);
    const s = mergeSettings({ share: { places: ['a', 'b', 'c', 'd', 'e', 'f', 3, ''], rememberPlace: true, lastPlace: 'Casa' } }).share;
    expect(s.places).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(s.lastPlace).toBe('Casa');
  });
  it('@usuario: activado por defecto solo si existe en el perfil', () => {
    expect(defaultShow({ name: 'Ana', username: 'SergeV', photo: '', emoji: '' }).user).toBe(true);
    expect(defaultShow({ name: 'Ana', username: '', photo: '', emoji: '' }).user).toBe(false);
  });
});
