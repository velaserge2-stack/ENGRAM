import { t } from '../i18n';
/**
 * iCalendar mínimo (RFC 5545) para bloques de estudio: VEVENT con UID, DTSTART,
 * DTEND, SUMMARY, DESCRIPTION, CATEGORIES, LOCATION, RRULE (DAILY/WEEKLY con BYDAY/
 * MONTHLY/YEARLY, INTERVAL, COUNT), EXDATE, RECURRENCE-ID, TZID (con Intl), VALARM y X-ENGRAMA-DONE/-KIND. Se escribió a mano en lugar de ical.js.
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
  rrule: '' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  until: string;
  /** RRULE INTERVAL (cada n periodos; ausente = 1) */
  interval?: number;
  /** RRULE COUNT (número total de repeticiones) */
  count?: number;
  /** días (AAAA-MM-DD) sustituidos por una excepción RECURRENCE-ID: no se pintan ni se exportan como EXDATE */
  overridden?: string[];
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
  /** valor de RRULE tal como se leyó (BYMONTHDAY, BYSETPOS…): se reescribe igual si la repetición no se editó */
  rruleRaw?: string;
}

type RRuleFields = Pick<StudyBlock, 'rrule' | 'until' | 'interval' | 'count' | 'byday'>;

/** Lo que Engrama entiende de un RRULE (el resto se conserva en `rruleRaw`). */
function readRRule(v: string): RRuleFields {
  const r: RRuleFields = { rrule: ((/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/.exec(v)?.[1]) as StudyBlock['rrule']) ?? '', until: '' };
  const iv = /INTERVAL=(\d+)/.exec(v), cn = /COUNT=(\d+)/.exec(v);
  if (iv && +iv[1]! > 1) r.interval = Math.min(+iv[1]!, 1000);
  if (cn && +cn[1]! > 0) r.count = +cn[1]!;
  const by = /BYDAY=([A-Z,]+)/.exec(v);
  if (by) r.byday = by[1]!.split(',').filter((d) => (WEEKDAYS as readonly string[]).includes(d));
  const u = /UNTIL=(\d{4})(\d{2})(\d{2})/.exec(v);
  if (u) r.until = `${u[1]}-${u[2]}-${u[3]}`;
  return r;
}

/** RRULE que escribe Engrama a partir de lo que entiende. */
function genRRule(r: RRuleFields, b: Pick<StudyBlock, 'allDay' | 'floating'>): string {
  return `FREQ=${r.rrule}${r.interval && r.interval > 1 ? `;INTERVAL=${r.interval}` : ''}${r.count ? `;COUNT=${r.count}` : ''}${r.rrule === 'WEEKLY' && r.byday?.length ? `;BYDAY=${r.byday.join(',')}` : ''}${r.until ? `;UNTIL=${r.until.replace(/-/g, '')}${b.allDay ? '' : b.floating ? 'T235959' : 'T235959Z'}` : ''}`;
}

/** Si el bloque trae un RRULE leído y la repetición no se editó, ese mismo (completo); si no, el de Engrama. */
function rruleOf(b: StudyBlock): string {
  const mine = genRRule(b, b);
  return b.rruleRaw && genRRule(readRRule(b.rruleRaw), b) === mine ? b.rruleRaw : mine;
}

/**
 * EXDATE de un evento en UTC: RFC 5545 repite una serie en UTC conservando la hora UTC de DTSTART,
 * así que la ocurrencia del día local `x` es DTSTART + k días (no la hora de pared, que cambia con el horario de verano).
 */
function exdateUtc(b: StudyBlock, x: string): string {
  const [y, m, d] = x.split('-').map(Number);
  const s = new Date(b.start);
  let at = b.start + Math.round((Date.UTC(y!, m! - 1, d!) - Date.UTC(s.getFullYear(), s.getMonth(), s.getDate())) / 864e5) * 864e5;
  if (localKey(at) < x) at += 864e5;
  else if (localKey(at) > x) at -= 864e5;
  return utc(at);
}

/** Marca que separa la nota del usuario de los nombres legibles de los vínculos en DESCRIPTION. */
const LINKS_MARK = '\n\nVínculos: ';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\r\n?/g, '\n').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
// una sola pasada: «\\n» (barra literal + n) no se confunde con un salto
const unesc = (s: string) => s.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

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
    // una excepción importada (RECURRENCE-ID) lleva en memoria «uid#fecha»; al exportar, el UID de su serie
    const uid = b.extra?.some((x) => x.startsWith('RECURRENCE-ID')) ? b.uid.replace(/#[^#]*$/, '') : b.uid;
    L.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${now}`, `DTSTART${when(b, b.start)}`, `DTEND${when(b, b.end)}`, `SUMMARY:${esc(b.title)}`);
    const desc = b.note + (b.links?.length ? `${LINKS_MARK}${b.links.map(labelOf).join(', ')}` : '');
    if (desc) L.push(`DESCRIPTION:${esc(desc)}`);
    if (b.subject) L.push(`CATEGORIES:${esc(b.subject)}`);
    if (b.location) L.push(`LOCATION:${esc(b.location)}`);
    if (b.rrule) L.push(`RRULE:${rruleOf(b)}`);
    for (const x of b.exdate ?? []) L.push(b.allDay ? `EXDATE;VALUE=DATE:${x.replace(/-/g, '')}` : `EXDATE:${b.floating ? `${x.replace(/-/g, '')}T${local(b.start).slice(9)}` : exdateUtc(b, x)}`);
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

/** Diferencia (ms) entre la hora de pared de `tz` y UTC en el instante `ms`; null si la zona no existe. */
function tzOffset(ms: number, tz: string): number | null {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    const n: Record<string, number> = {};
    for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') n[p.type] = Number(p.value);
    return Date.UTC(n.year!, n.month! - 1, n.day!, n.hour! % 24, n.minute!, n.second!) - Math.floor(ms / 1000) * 1000;
  } catch {
    return null;
  }
}

function parseDate(v: string, params: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v.trim());
  if (!m) return NaN;
  const [, y, mo, d, h = '00', mi = '00', s = '00', z] = m;
  if (z) return Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +s);
  // TZID: hora de pared de esa zona → UTC (con Intl); si la zona no existe, hora local del dispositivo
  const tz = /(?:^|;)TZID=("?)([^";]+)\1/.exec(params)?.[2];
  if (tz && m[4]) {
    const wall = Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +s);
    const o1 = tzOffset(wall, tz);
    if (o1 !== null) {
      const o2 = tzOffset(wall - o1, tz) ?? o1; // segunda pasada: el cambio de horario entre medias
      return wall - o2;
    }
  }
  return new Date(+y!, +mo! - 1, +d!, +h, +mi, +s).getTime();
}

export function fromICS(text: string, source = ''): StudyBlock[] {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out: StudyBlock[] = [];
  const rids: [StudyBlock, string][] = []; // excepciones RECURRENCE-ID y su día
  let cur: (Partial<StudyBlock> & { rid?: string }) | null = null;
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
          ...(cur.interval && cur.interval > 1 ? { interval: cur.interval } : {}), ...(cur.count ? { count: cur.count } : {}),
        });
        // solo si dice más de lo que Engrama escribiría (BYMONTHDAY, BYSETPOS, WKST, UNTIL con hora…)
        const nb = out[out.length - 1]!;
        if (nb.rrule && cur.rruleRaw && cur.rruleRaw !== genRRule(nb, nb)) nb.rruleRaw = cur.rruleRaw;
        if (cur.rid) rids.push([out[out.length - 1]!, cur.rid]);
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
        // -P1W, -P1D, -PT1H30M… (solo avisos ANTES del inicio; RELATED=END y positivos se ignoran)
        const t = /^-P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$/.exec(v.trim());
        if (name === 'TRIGGER' && t && !params.includes('RELATED=END')) cur.alarmMin = Number(t[1] ?? 0) * 10080 + Number(t[2] ?? 0) * 1440 + Number(t[3] ?? 0) * 60 + Number(t[4] ?? 0);
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
        case 'RECURRENCE-ID': {
          // se conserva tal cual (extra) para reexportar; el día sustituye al de la serie
          cur.extra!.push(line);
          const at = parseDate(v, params.join(';'));
          if (Number.isFinite(at)) cur.rid = /^\d{8}$/.test(v.trim()) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : localKey(at);
          break;
        }
        case 'RRULE': {
          Object.assign(cur, readRRule(v), { rruleRaw: v.trim() });
          break;
        }
        default:
          // propiedades desconocidas (LOCATION, URL, X-…): se conservan
          if (!['UID', 'DTSTART', 'DTEND', 'SUMMARY', 'CATEGORIES', 'X-ENGRAMA-DONE', 'RRULE', 'LOCATION', 'EXDATE', 'X-ENGRAMA-KIND'].includes(name!)) cur.extra!.push(line);
      }
    }
  }
  // RECURRENCE-ID: la ocurrencia original de la serie (mismo UID) deja de pintarse y la excepción
  // recibe un UID propio («uid#día») para que editar o borrar no toque la serie
  for (const [b, day] of rids) {
    const master = out.find((x) => x !== b && x.uid === b.uid && x.rrule);
    if (master) master.overridden = [...new Set([...(master.overridden ?? []), day])];
    b.uid = `${b.uid}#${day}`;
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
  const ex = new Set([...(b.exdate ?? []), ...(b.overridden ?? [])]);
  if (!b.rrule) return first >= from && first <= to && !ex.has(first) ? [{ date: first, start: b.start, end: b.end }] : [];
  const out: { date: string; start: number; end: number }[] = [];
  const d0 = new Date(b.start);
  const at = (y: number, m: number, d: number) => new Date(y, m, d, d0.getHours(), d0.getMinutes(), d0.getSeconds()).getTime();
  const iv = Math.max(1, b.interval ?? 1);
  let n = 0; // COUNT cuenta todas las generadas (también las excluidas y las anteriores a `from`)
  const push = (t: number) => {
    n++;
    const day = dayOf(t);
    if (day >= from && !ex.has(day)) out.push({ date: day, start: t, end: t + dur });
  };
  const stop = (day: string) => day > to || (!!b.until && day > b.until) || (!!b.count && n >= b.count);
  // días entre el inicio y `from` (en días de calendario, sin horario de verano): se salta hasta ahí
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const gapDays = Math.floor((Date.UTC(fy, fm - 1, fd) - Date.UTC(d0.getFullYear(), d0.getMonth(), d0.getDate())) / 864e5);
  if (b.rrule === 'MONTHLY' || b.rrule === 'YEARLY') {
    const step = (b.rrule === 'YEARLY' ? 12 : 1) * iv;
    const gapMonths = (fy - d0.getFullYear()) * 12 + (fm - 1 - d0.getMonth());
    const i0 = b.count ? 0 : Math.max(0, Math.floor((gapMonths - 1) / step));
    for (let i = i0; i < i0 + 1200; i++) {
      const t = at(d0.getFullYear(), d0.getMonth() + i * step, d0.getDate());
      if (new Date(t).getDate() !== d0.getDate()) continue; // p. ej. 31 en un mes de 30, 29 de febrero
      if (stop(dayOf(t))) break;
      push(t);
    }
    return out;
  }
  const days = b.rrule === 'WEEKLY' && b.byday?.length ? new Set(b.byday.map((x) => WEEKDAYS.indexOf(x as (typeof WEEKDAYS)[number]))) : null;
  const step = days ? 1 : (b.rrule === 'DAILY' ? 1 : 7) * iv;
  const wd0 = (d0.getDay() + 6) % 7; // semana desde el lunes (WKST=MO)
  const i0 = b.count ? 0 : Math.max(0, Math.floor((gapDays - 7) / step));
  for (let i = i0; i < i0 + 6000; i++) {
    const t = at(d0.getFullYear(), d0.getMonth(), d0.getDate() + i * step);
    if (stop(dayOf(t))) break;
    if (days && (!days.has((new Date(t).getDay() + 6) % 7) || Math.floor((i + wd0) / 7) % iv !== 0)) continue;
    push(t);
  }
  return out;
}
