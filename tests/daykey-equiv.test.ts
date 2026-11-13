import { describe, expect, it } from 'vitest';
import { dayKey } from '../src/lib/days';

// referencia: el cálculo directo con Intl (el de antes de la memoización por hora)
const fm = new Map<string, Intl.DateTimeFormat>();
function ref(ts: number, tz: string, h0: number): string {
  const f = fm.get(tz) ?? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  fm.set(tz, f);
  const parts = f.formatToParts(new Date(ts));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  let y = get('year'), m = get('month'), d = get('day');
  if (get('hour') < h0) {
    const prev = new Date(Date.UTC(y, m - 1, d - 1));
    y = prev.getUTCFullYear(); m = prev.getUTCMonth() + 1; d = prev.getUTCDate();
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

describe('dayKey memoizado = cálculo directo', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (const tz of ['America/Mexico_City', 'America/Santiago', 'Europe/Madrid', 'Asia/Kolkata', 'Australia/Lord_Howe', 'UTC']) {
    it(tz, () => {
      for (const h0 of [0, 4]) {
        for (let i = 0; i < 4000; i++) {
          const ts = Math.floor(946_684_800_000 + rnd() * 1_000_000_000_000 * 0.4); // 2000 – ~2013…2026
          expect(dayKey(ts, tz, h0)).toBe(ref(ts, tz, h0));
        }
        // alrededor de los cambios de horario y de los cortes de día: cada 37 min durante dos años
        for (let ts = Date.UTC(2024, 0, 1); ts < Date.UTC(2026, 0, 1); ts += 37 * 60_000 + 13_000) expect(dayKey(ts, tz, h0)).toBe(ref(ts, tz, h0));
      }
    }, 60_000);
  }

  it('minuto a minuto alrededor de los cambios de horario', () => {
    const wins: [string, number][] = [['Australia/Lord_Howe', Date.UTC(2024, 3, 6, 12)], ['Australia/Lord_Howe', Date.UTC(2024, 9, 5, 12)], ['Europe/Madrid', Date.UTC(2024, 2, 30, 12)], ['Europe/Madrid', Date.UTC(2024, 9, 26, 12)], ['America/Santiago', Date.UTC(2024, 3, 5, 12)], ['America/Santiago', Date.UTC(2024, 8, 7, 12)], ['America/Mexico_City', Date.UTC(2022, 9, 29, 12)]];
    for (const [tz, from] of wins) for (const h0 of [0, 4]) for (let ts = from; ts < from + 48 * 3_600_000; ts += 60_000) expect(dayKey(ts, tz, h0)).toBe(ref(ts, tz, h0));
  }, 60_000);
});
