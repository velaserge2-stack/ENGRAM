import { t } from '../i18n';
/**
 * iCalendar mínimo (RFC 5545) para bloques de estudio: VEVENT con UID, DTSTART,
 * DTEND, SUMMARY, DESCRIPTION, CATEGORIES, LOCATION, RRULE (DAILY/WEEKLY con BYDAY/
 * MONTHLY), EXDATE, VALARM y X-ENGRAMA-DONE/-KIND. Se escribió a mano en lugar de ical.js.
 *
 * Mejoras 2 · F16: las entradas nuevas usan HORA LOCAL FLOTANTE (sin zona, sin «Z»): una
 * clase a las 8:00 sigue a las 8:00 aunque cambie la zona. Los eventos antiguos (UTC con «Z»)
 * se leen y se vuelven a escribir igual que antes. Todo campo nuevo es opcional.
 */
export type EventKind = 'clase' | 'actividad' | 'estudio' | 'examen' | 'otro';
export const KINDS: EventKind[] = ['clase', 'actividad', 'estudio', 'examen', 'otro'];
export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export interface StudyBlock {
  uid: string;
  start: number;
  end: number;
  title: string;
  subject: string;
  note: string;
  rrule: '' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  until: string;
  /** semanal: días elegidos (MO…SU); vacío = el día de inicio */
  byday?: string[];
  /** días (AAAA-MM-DD) excluidos de la serie («solo este día») */
  exdate?: string[];
  kind?: EventKind;
  allDay?: boolean;
  /** hora local flotante (sin zona); los eventos antiguos guardaban UTC */
  floating?: boolean;
  location?: string;
  /** fechas (AAAA-MM-DD) en que se marcó como hecho */
  done: string[];
  alarmMin: number | null;
  readonly?: boolean;
  source?: string;
  /** vínculos `engrama://deck/<id>`, `engrama://note/<id>`, `engrama://topic/<carpeta>`, `engrama://tag/<etiqueta>` */
  links?: string[];
  /** propiedades desconocidas del VEVENT, conservadas tal cual al reexportar */
  extra?: string[];
}

/** Marca que separa la nota del usuario de los nombres legibles de los vínculos en DESCRIPTION. */
const LINKS_MARK = '\n\nVínculos: ';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const unesc = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

function utc(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
const p2 = (n: number) => String(n).padStart(2, '0');
/** Hora local flotante: AAAAMMDDTHHMMSS sin «Z». */
function local(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}T${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}
const dateOnly = (ms: number) => local(ms).slice(0, 8);
const when = (b: StudyBlock, ms: number) => (b.allDay ? `;VALUE=DATE:${dateOnly(ms)}` : `:${b.floating ? local(ms) : utc(ms)}`);

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

export function toICS(blocks: StudyBlock[], name = 'Engrama · estudio', labelOf: (uri: string) => string = (u) => u.replace(/^engrama:\/\/\w+\//, '')): string {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Engrama//ES', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(name)}`];
  const now = utc(Date.now());
  for (const b of blocks) {
    L.push('BEGIN:VEVENT', `UID:${b.uid}`, `DTSTAMP:${now}`, `DTSTART${when(b, b.start)}`, `DTEND${when(b, b.end)}`, `SUMMARY:${esc(b.title)}`);
    const desc = b.note + (b.links?.length ? `${LINKS_MARK}${b.links.map(labelOf).join(', ')}` : '');
    if (desc) L.push(`DESCRIPTION:${esc(desc)}`);
    if (b.subject) L.push(`CATEGORIES:${esc(b.subject)}`);
    if (b.location) L.push(`LOCATION:${esc(b.location)}`);
    if (b.rrule) L.push(`RRULE:FREQ=${b.rrule}${b.rrule === 'WEEKLY' && b.byday?.length ? `;BYDAY=${b.byday.join(',')}` : ''}${b.until ? `;UNTIL=${b.until.replace(/-/g, '')}${b.allDay ? '' : b.floating ? 'T235959' : 'T235959Z'}` : ''}`);
    for (const x of b.exdate ?? []) L.push(b.allDay ? `EXDATE;VALUE=DATE:${x.replace(/-/g, '')}` : `EXDATE:${b.floating ? `${x.replace(/-/g, '')}T${local(b.start).slice(9)}` : utc(new Date(`${x}T${new Date(b.start).toTimeString().slice(0, 8)}`).getTime())}`);
    if (b.kind) L.push(`X-ENGRAMA-KIND:${b.kind}`);
    if (b.done.length) L.push(`X-ENGRAMA-DONE:${b.done.join(',')}`);
    for (const l of b.links ?? []) L.push(`X-ENGRAMA-LINK:${l}`);
    for (const x of b.extra ?? []) L.push(x);
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
    if (line === 'BEGIN:VEVENT') cur = { done: [], rrule: '', until: '', note: '', subject: '', alarmMin: null, links: [], extra: [], exdate: [] };
    else if (line === 'END:VEVENT' && cur) {
      if (Number.isFinite(cur.start)) {
        out.push({
          uid: cur.uid || `${source}-${out.length}`, start: cur.start!, end: Number.isFinite(cur.end) ? cur.end! : cur.start! + 3600_000,
          title: cur.title || t('ics.sin_titulo'), subject: cur.subject ?? '', note: cur.note ?? '', rrule: cur.rrule ?? '', until: cur.until ?? '',
          done: cur.done ?? [], alarmMin: cur.alarmMin ?? null, ...(source ? { readonly: true, source } : {}),
          ...(cur.links?.length ? { links: cur.links } : {}), ...(cur.extra?.length ? { extra: cur.extra } : {}),
          ...(cur.byday?.length ? { byday: cur.byday } : {}), ...(cur.exdate?.length ? { exdate: cur.exdate } : {}),
          ...(cur.kind ? { kind: cur.kind } : {}), ...(cur.allDay ? { allDay: true } : {}), ...(cur.floating ? { floating: true } : {}), ...(cur.location ? { location: cur.location } : {}),
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
        case 'DTSTART':
          cur.start = parseDate(v, params.join(';'));
          if (/^\d{8}$/.test(v.trim())) cur.allDay = true;
          else if (!/Z$/.test(v.trim()) && !params.some((p) => p.startsWith('TZID'))) cur.floating = true;
          break;
        case 'DTEND': cur.end = parseDate(v, params.join(';')); break;
        case 'SUMMARY': cur.title = unesc(v); break;
        case 'DESCRIPTION': {
          // los nombres legibles de los vínculos se regeneran al exportar
          const d = unesc(v);
          const i = d.indexOf(LINKS_MARK);
          cur.note = i >= 0 ? d.slice(0, i) : d;
          break;
        }
        case 'X-ENGRAMA-LINK': cur.links!.push(v.trim()); break;
        case 'DTSTAMP': break;
        case 'CATEGORIES': cur.subject = unesc(v); break;
        case 'X-ENGRAMA-DONE': cur.done = v.split(',').filter(Boolean); break;
        case 'LOCATION': cur.location = unesc(v); break;
        case 'X-ENGRAMA-KIND': if ((KINDS as string[]).includes(v.trim())) cur.kind = v.trim() as EventKind; break;
        case 'EXDATE': for (const x of v.split(',')) { const m = /^(\d{4})(\d{2})(\d{2})/.exec(x.trim()); if (m) cur.exdate!.push(/Z$/.test(x.trim()) ? localKey(parseDate(x, '')) : `${m[1]}-${m[2]}-${m[3]}`); } break;
        case 'RRULE': {
          const f = /FREQ=(DAILY|WEEKLY|MONTHLY)/.exec(v);
          cur.rrule = (f?.[1] as StudyBlock['rrule']) ?? '';
          const by = /BYDAY=([A-Z,]+)/.exec(v);
          if (by) cur.byday = by[1]!.split(',').filter((d) => (WEEKDAYS as readonly string[]).includes(d));
          const u = /UNTIL=(\d{4})(\d{2})(\d{2})/.exec(v);
          if (u) cur.until = `${u[1]}-${u[2]}-${u[3]}`;
          break;
        }
        default:
          // propiedades desconocidas (LOCATION, URL, X-…): se conservan
          if (!['UID', 'DTSTART', 'DTEND', 'SUMMARY', 'CATEGORIES', 'X-ENGRAMA-DONE', 'RRULE', 'LOCATION', 'EXDATE', 'X-ENGRAMA-KIND'].includes(name!)) cur.extra!.push(line);
      }
    }
  }
  return out;
}

const localKey = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };

/**
 * Ocurrencias de un bloque entre dos días (AAAA-MM-DD, inclusivo), en hora local:
 * DAILY, WEEKLY (con BYDAY), MONTHLY (mismo día del mes; los meses sin ese día se saltan),
 * UNTIL y EXDATE. La hora se conserva en hora local (cambios de horario incluidos).
 */
export function occurrences(b: StudyBlock, from: string, to: string, dayOf: (ms: number) => string): { date: string; start: number; end: number }[] {
  const dur = b.end - b.start;
  const first = dayOf(b.start);
  const ex = new Set(b.exdate ?? []);
  if (!b.rrule) return first >= from && first <= to && !ex.has(first) ? [{ date: first, start: b.start, end: b.end }] : [];
  const out: { date: string; start: number; end: number }[] = [];
  const d0 = new Date(b.start);
  const at = (y: number, m: number, d: number) => new Date(y, m, d, d0.getHours(), d0.getMinutes(), d0.getSeconds()).getTime();
  const push = (t: number) => {
    const day = dayOf(t);
    if (day >= from && !ex.has(day)) out.push({ date: day, start: t, end: t + dur });
  };
  const stop = (day: string) => day > to || (!!b.until && day > b.until);
  if (b.rrule === 'MONTHLY') {
    for (let i = 0; i < 1200; i++) {
      const t = at(d0.getFullYear(), d0.getMonth() + i, d0.getDate());
      if (new Date(t).getDate() !== d0.getDate()) continue; // p. ej. 31 en un mes de 30
      if (stop(dayOf(t))) break;
      push(t);
    }
    return out;
  }
  const days = b.rrule === 'WEEKLY' && b.byday?.length ? new Set(b.byday.map((x) => WEEKDAYS.indexOf(x as (typeof WEEKDAYS)[number]))) : null;
  const step = b.rrule === 'DAILY' || days ? 1 : 7;
  for (let i = 0; i < 6000; i++) {
    const t = at(d0.getFullYear(), d0.getMonth(), d0.getDate() + i * step);
    if (stop(dayOf(t))) break;
    if (days && !days.has((new Date(t).getDay() + 6) % 7)) continue;
    push(t);
  }
  return out;
}
