/**
 * iCalendar mínimo (RFC 5545) para bloques de estudio: VEVENT con UID, DTSTART,
 * DTEND, SUMMARY, DESCRIPTION, CATEGORIES, RRULE (DAILY/WEEKLY), VALARM y
 * X-ENGRAMA-DONE. Se escribió a mano en lugar de ical.js: solo hace falta esto.
 */
export interface StudyBlock {
  uid: string;
  start: number;
  end: number;
  title: string;
  subject: string;
  note: string;
  rrule: '' | 'DAILY' | 'WEEKLY';
  until: string;
  /** fechas (AAAA-MM-DD) en que se marcó como hecho */
  done: string[];
  alarmMin: number | null;
  readonly?: boolean;
  source?: string;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const unesc = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function utc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function fold(line: string): string {
  const out: string[] = [];
  let s = line;
  while (s.length > 74) {
    out.push(s.slice(0, 74));
    s = ' ' + s.slice(74);
  }
  out.push(s);
  return out.join('\r\n');
}

export function toICS(blocks: StudyBlock[], name = 'Engrama · estudio'): string {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Engrama//ES', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(name)}`];
  const now = utc(Date.now());
  for (const b of blocks) {
    L.push('BEGIN:VEVENT', `UID:${b.uid}`, `DTSTAMP:${now}`, `DTSTART:${utc(b.start)}`, `DTEND:${utc(b.end)}`, `SUMMARY:${esc(b.title)}`);
    if (b.note) L.push(`DESCRIPTION:${esc(b.note)}`);
    if (b.subject) L.push(`CATEGORIES:${esc(b.subject)}`);
    if (b.rrule) L.push(`RRULE:FREQ=${b.rrule}${b.until ? `;UNTIL=${b.until.replace(/-/g, '')}T235959Z` : ''}`);
    if (b.done.length) L.push(`X-ENGRAMA-DONE:${b.done.join(',')}`);
    if (b.alarmMin !== null) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(b.title)}`, `TRIGGER:-PT${b.alarmMin}M`, 'END:VALARM');
    L.push('END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}

function parseDate(v: string, params: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v.trim());
  if (!m) return NaN;
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = m;
  if (z) return Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +s);
  // hora local (o con TZID: se aproxima a la hora local del dispositivo)
  void params;
  return new Date(+y!, +mo! - 1, +d!, +h, +mi, +s).getTime();
}

export function fromICS(text: string, source = ''): StudyBlock[] {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out: StudyBlock[] = [];
  let cur: Partial<StudyBlock> | null = null;
  let inAlarm = false;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = { done: [], rrule: '', until: '', note: '', subject: '', alarmMin: null };
    else if (line === 'END:VEVENT' && cur) {
      if (Number.isFinite(cur.start)) {
        out.push({
          uid: cur.uid || `${source}-${out.length}`, start: cur.start!, end: Number.isFinite(cur.end) ? cur.end! : cur.start! + 3600_000,
          title: cur.title || '(sin título)', subject: cur.subject ?? '', note: cur.note ?? '', rrule: cur.rrule ?? '', until: cur.until ?? '',
          done: cur.done ?? [], alarmMin: cur.alarmMin ?? null, ...(source ? { readonly: true, source } : {}),
        });
      }
      cur = null;
    } else if (line === 'BEGIN:VALARM') inAlarm = true;
    else if (line === 'END:VALARM') inAlarm = false;
    else if (cur) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const [name, ...params] = line.slice(0, i).split(';');
      const v = line.slice(i + 1);
      if (inAlarm) {
        const t = /-P(?:T)?(?:(\d+)H)?(?:(\d+)M)?/.exec(v);
        if (name === 'TRIGGER' && t) cur.alarmMin = (Number(t[1] ?? 0) * 60) + Number(t[2] ?? 0);
        continue;
      }
      switch (name) {
        case 'UID': cur.uid = v; break;
        case 'DTSTART': cur.start = parseDate(v, params.join(';')); break;
        case 'DTEND': cur.end = parseDate(v, params.join(';')); break;
        case 'SUMMARY': cur.title = unesc(v); break;
        case 'DESCRIPTION': cur.note = unesc(v); break;
        case 'CATEGORIES': cur.subject = unesc(v); break;
        case 'X-ENGRAMA-DONE': cur.done = v.split(',').filter(Boolean); break;
        case 'RRULE': {
          const f = /FREQ=(DAILY|WEEKLY)/.exec(v);
          cur.rrule = (f?.[1] as StudyBlock['rrule']) ?? '';
          const u = /UNTIL=(\d{4})(\d{2})(\d{2})/.exec(v);
          if (u) cur.until = `${u[1]}-${u[2]}-${u[3]}`;
        }
      }
    }
  }
  return out;
}

/** Ocurrencias de un bloque entre dos días (AAAA-MM-DD, inclusivo), en hora local. */
export function occurrences(b: StudyBlock, from: string, to: string, dayOf: (ms: number) => string): { date: string; start: number; end: number }[] {
  const dur = b.end - b.start;
  const first = dayOf(b.start);
  if (!b.rrule) return first >= from && first <= to ? [{ date: first, start: b.start, end: b.end }] : [];
  const out = [];
  const step = b.rrule === 'DAILY' ? 1 : 7;
  const d0 = new Date(b.start);
  for (let i = 0; i < 800; i++) {
    const t = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i * step, d0.getHours(), d0.getMinutes()).getTime();
    const day = dayOf(t);
    if (day > to || (b.until && day > b.until)) break;
    if (day >= from) out.push({ date: day, start: t, end: t + dur });
  }
  return out;
}
