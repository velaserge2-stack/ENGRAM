import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosave } from '../src/lib/autosave';
import { addDays, dayKey, heatGrid, heatLevels, heatWeeks, streaks, weekdayMon } from '../src/lib/days';
import { backupDue, defaultSettings, mergeSettings } from '../src/lib/settings';

const TZ = 'America/Monterrey'; // UTC−6, sin horario de verano

describe('días con corte a las 4:00', () => {
  it('antes de las 4:00 cuenta para el día anterior', () => {
    expect(dayKey(Date.parse('2026-03-10T03:59:00-06:00'), TZ, 4)).toBe('2026-03-09');
    expect(dayKey(Date.parse('2026-03-10T04:00:00-06:00'), TZ, 4)).toBe('2026-03-10');
    expect(dayKey(Date.parse('2026-03-01T01:00:00-06:00'), TZ, 4)).toBe('2026-02-28');
    expect(dayKey(Date.parse('2026-03-10T01:00:00-06:00'), TZ, 0)).toBe('2026-03-10');
  });
  it('aritmética de fechas', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(weekdayMon('2026-11-09')).toBe(0); // lunes
  });
  it('rachas', () => {
    const c = new Map([['2026-11-01', 5], ['2026-11-02', 1], ['2026-11-03', 3], ['2026-11-07', 2], ['2026-11-08', 9], ['2026-11-09', 1]]);
    expect(streaks(c, '2026-11-10')).toEqual({ current: 3, longest: 3, todayCounts: false, daysStudied: 6 });
    expect(streaks(c, '2026-11-09').todayCounts).toBe(true);
    expect(streaks(c, '2026-11-12').current).toBe(0);
    expect(streaks(c, '2026-11-10', 2)).toEqual({ current: 0, longest: 2, todayCounts: false, daysStudied: 4 });
    expect(streaks(new Map(), '2026-11-10')).toEqual({ current: 0, longest: 0, todayCounts: false, daysStudied: 0 });
  });
  it('mapa de calor: 53 semanas que empiezan en lunes y niveles', () => {
    const g = heatGrid('2026-11-11');
    expect(g.length).toBe(53);
    expect(g[52]![0]).toBe('2026-11-09');
    expect(g.every((w) => weekdayMon(w[0]!) === 0)).toBe(true);
    const lv = heatLevels(new Map([['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 100]]));
    expect([0, 1, 3, 4, 100].map(lv)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('ajustes', () => {
  it('mezcla con valores por defecto y descarta tipos erróneos', () => {
    const s = mergeSettings({ glass: 500, textScale: 'grande', glassMode: 'dark', lastExportAt: 5, extra: 1, pomo: { work: 50 } });
    expect(s.glass).toBe(100);
    expect(s.textScale).toBe(1);
    expect(s.glassMode).toBe('dark');
    expect(s.pomo).toEqual({ work: 50, short: 5, long: 15, every: 4, sound: true });
    expect(s.lastExportAt).toBe(5);
    expect('extra' in s).toBe(false);
  });
  it('aviso de respaldo', () => {
    const DAY = 86_400_000;
    const s = { ...defaultSettings(), weeklyBackupReminder: false, backupReminderDays: 10 };
    expect(backupDue(s, 0, false)).toBe(false);
    expect(backupDue(s, 0)).toBe(true);
    expect(backupDue({ ...s, lastExportAt: 0 }, 9 * DAY)).toBe(false);
    expect(backupDue({ ...s, lastExportAt: 0 }, 11 * DAY)).toBe(true);
    expect(backupDue({ ...s, lastExportAt: 0, weeklyBackupReminder: true }, 8 * DAY)).toBe(true);
    expect(backupDue({ ...s, lastExportAt: 0, backupReminderSnoozedUntil: 12 * DAY }, 11 * DAY)).toBe(false);
  });
});

describe('autoguardado', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounce de 500 ms y guarda solo el último valor', async () => {
    const saved: number[] = [];
    const a = createAutosave(async (v: number) => void saved.push(v), 500, null);
    a.schedule(1);
    a.schedule(2);
    await vi.advanceTimersByTimeAsync(499);
    expect(saved).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(saved).toEqual([2]);
  });

  it('guarda de inmediato al ocultarse la página', async () => {
    const saved: string[] = [];
    const listeners: Record<string, () => void> = {};
    const doc = { visibilityState: 'visible' as DocumentVisibilityState, addEventListener: (t: string, f: () => void) => (listeners[t] = f), removeEventListener: () => {} };
    const a = createAutosave(async (v: string) => void saved.push(v), 500, doc as never);
    a.schedule('x');
    doc.visibilityState = 'hidden';
    listeners.visibilitychange!();
    await vi.advanceTimersByTimeAsync(0);
    expect(saved).toEqual(['x']);
    expect(a.pending).toBe(false);
  });
});

import { contrast, readableOn, resolveColor } from '../src/lib/palette';
describe('paleta y contraste', () => {
  it('contraste conocido', () => {
    expect(contrast('#FFFFFF', '#000000')).toBeCloseTo(21, 0);
    expect(readableOn('#5856D6')).toBe('#FFFFFF');
    expect(readableOn('#FFCC00')).toBe('#000000');
  });
  it('resuelve nombres y hex', () => {
    expect(resolveColor('naranja', false)).toBe('#FF9500');
    expect(resolveColor('naranja', true)).toBe('#FF9F0A');
    expect(resolveColor('#123456', true)).toBe('#123456');
    expect(resolveColor('nada', false)).toBe('#007AFF');
  });
});

import { accentVariant, WORST_GLASS } from '../src/lib/palette';
describe('acento', () => {
  it('ajustes antiguos o inválidos = sin acento', () => {
    expect(mergeSettings({ accent: 'azul' }).accent).toEqual({ color: null, usos: [] });
    expect(mergeSettings({ accent: { color: '#3a7bd5', usos: ['calor', 'otra'] } }).accent).toEqual({ color: '#3a7bd5', usos: ['calor'] });
    expect(defaultSettings().accent.color).toBeNull();
  });
  it('variantes legibles en claro y oscuro', () => {
    for (const hex of ['#007AFF', '#FFCC00', '#34C759', '#5856D6', '#000080']) {
      const d = accentVariant(hex, 'dark');
      const l = accentVariant(hex, 'light');
      expect(contrast(d.color, WORST_GLASS.dark)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(l.color, WORST_GLASS.light)).toBeGreaterThanOrEqual(4.5);
    }
    expect(accentVariant('#FFCC00', 'light').adjusted).toBe(true);
  });
});

describe('mapa de adherencia proporcional', () => {
  it('desde la primera actividad, mínimo 8 semanas y máximo un año', () => {
    expect(heatWeeks(undefined, '2026-11-11')).toBe(8);
    expect(heatWeeks('2026-11-02', '2026-11-11')).toBe(8); // 10 días de actividad → panel pequeño
    expect(heatWeeks('2026-06-01', '2026-11-11')).toBe(24);
    expect(heatWeeks('2024-01-01', '2026-11-11')).toBe(53); // más de un año → año completo
    expect(heatWeeks('2026-11-02', '2026-11-11', true)).toBe(53); // «Ver año completo»
  });
});

describe('Ajustes plegables (Prompt 6 · B4)', () => {
  it('por defecto todo plegado; lo desplegado se recuerda', async () => {
    const { mergeSettings, defaultSettings } = await import('../src/lib/settings');
    expect(defaultSettings().settingsOpen).toEqual([]);
    expect(mergeSettings({ settingsOpen: ['idioma', 'addons'] }).settingsOpen).toEqual(['idioma', 'addons']);
    expect(mergeSettings({ settingsOpen: 'x' }).settingsOpen).toEqual([]);
  });
});
