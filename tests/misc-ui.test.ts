import { expect, it } from 'vitest';
import { localDay } from '../src/lib/days';

it('localDay usa el día local, no el UTC', () => {
  const t = new Date(2026, 4, 10, 19, 0).getTime(); // 19:00 locales: en UTC-6 ya es el 11 en UTC
  expect(localDay(t)).toBe('2026-05-10');
});
