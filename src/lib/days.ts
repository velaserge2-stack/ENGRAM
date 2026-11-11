/**
 * Días de estudio con corte configurable (las 4:00 por defecto) y zona horaria.
 * Un repaso a las 2:30 cuenta para el día anterior.
 */
const fmtCache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
    fmtCache.set(tz, f);
  }
  return f;
}

/** "AAAA-MM-DD" del día de estudio al que pertenece `ts`. */
export function dayKey(ts: number, tz: string, dayStartHour = 4): string {
  const parts = fmt(tz).formatToParts(new Date(ts));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  let y = get('year');
  let m = get('month');
  let d = get('day');
  if (get('hour') < dayStartHour) {
    const prev = new Date(Date.UTC(y, m - 1, d - 1));
    y = prev.getUTCFullYear();
    m = prev.getUTCMonth() + 1;
    d = prev.getUTCDate();
  }
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = lunes … 6 = domingo */
export function weekdayMon(key: string): number {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export interface Streaks {
  current: number;
  longest: number;
  todayCounts: boolean;
  daysStudied: number;
}

/** `counts`: tarjetas por día. Si hoy aún no cuenta, la racha actual sigue viva desde ayer. */
export function streaks(counts: Map<string, number>, today: string, min = 1): Streaks {
  const days = [...counts.entries()].filter(([, n]) => n >= min).map(([k]) => k).sort();
  const set = new Set(days);
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of days) {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = k;
  }
  const todayCounts = set.has(today);
  let current = 0;
  let cur = todayCounts ? today : addDays(today, -1);
  while (set.has(cur)) {
    current++;
    cur = addDays(cur, -1);
  }
  return { current, longest, todayCounts, daysStudied: days.length };
}

/** Nivel 0–4 para el mapa de calor, por cuartiles de los días con actividad. */
export function heatLevels(counts: Map<string, number>): (n: number) => number {
  const vals = [...counts.values()].filter((n) => n > 0).sort((a, b) => a - b);
  if (!vals.length) return () => 0;
  const q = (p: number) => vals[Math.floor(p * (vals.length - 1))]!;
  const [a, b, c] = [q(0.25), q(0.5), q(0.75)];
  return (n) => (n <= 0 ? 0 : n <= a ? 1 : n <= b ? 2 : n <= c ? 3 : 4);
}

/** Columnas (semanas, lunes primero) que terminan en la semana de `today`. */
export function heatGrid(today: string, weeks = 53): string[][] {
  const lastMonday = addDays(today, -weekdayMon(today));
  const start = addDays(lastMonday, -(weeks - 1) * 7);
  return Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);
}
