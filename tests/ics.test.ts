import { describe, expect, it } from 'vitest';
import { fromICS, occurrences, toICS, type StudyBlock } from '../src/lib/ics';

const B: StudyBlock = { uid: 'b1@engrama', start: Date.UTC(2026, 10, 12, 0, 0), end: Date.UTC(2026, 10, 12, 1, 0), title: 'Cardio; repaso, ECG', subject: 'Cardiología', note: 'Línea 1\nLínea 2', rrule: 'WEEKLY', until: '2026-12-31', done: ['2026-11-12'], alarmMin: 15 };

describe('iCalendar', () => {
  it('ida y vuelta conserva todo', () => {
    const t = toICS([B]);
    expect(t).toContain('BEGIN:VALARM');
    expect(t).toContain('RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z');
    expect(t.split('\r\n').every((l) => l.length <= 75)).toBe(true);
    expect(fromICS(t)[0]).toEqual(B);
  });
  it('importa eventos de otros calendarios (plegado, hora local, sin fin)', () => {
    const ext = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:x\nDTSTART;TZID=America/Monterrey:20261113T080000\nSUMMARY:Clase de\n  anatomía\nEND:VEVENT\nEND:VCALENDAR';
    const [e] = fromICS(ext, 'horario');
    expect(e!.title).toBe('Clase de anatomía');
    expect(e!.end - e!.start).toBe(3600_000);
    expect(e!.readonly).toBe(true);
  });
  it('repeticiones', () => {
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const occ = occurrences({ ...B, until: '' }, '2026-11-01', '2026-11-30', day);
    expect(occ.map((o) => o.date)).toEqual(['2026-11-12', '2026-11-19', '2026-11-26']);
  });
});
