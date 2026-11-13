/**
 * «Compartir estadísticas» (Prompt 19 · 1): cuentas puras (periodo, cifras, formatos, recortes).
 * Todo sale de `reviews.jsonl` (vía `activity`) con el corte de día y la zona horaria de Ajustes.
 */
import { State, type LogEntry } from '../srs/engine';
import { addDays, dayKey, streaks } from '../lib/days';
import { MATURE, studyMs, type DayAct } from '../lib/stats';

export type Period = 'hoy' | '7' | '30' | 'anio' | 'todo';
export type Format = 'historia' | 'vertical' | 'cuadrada';
export const PERIODS: Period[] = ['hoy', '7', '30', 'anio', 'todo'];
export const FORMATS: Format[] = ['historia', 'vertical', 'cuadrada'];

/** Píxeles reales (1×) y franjas que tapa la interfaz de la red social (Historia: ~250 px arriba y abajo). */
export const SIZE: Record<Format, { w: number; h: number; top: number; bottom: number }> = {
  historia: { w: 1080, h: 1920, top: 250, bottom: 250 },
  vertical: { w: 1080, h: 1350, top: 56, bottom: 56 },
  cuadrada: { w: 1080, h: 1080, top: 48, bottom: 48 },
};

/** Zona donde va el contenido clave (fuera de las franjas inseguras). */
export function safeZone(f: Format): { x: number; y: number; w: number; h: number } {
  const s = SIZE[f];
  const side = 56;
  return { x: side, y: s.top, w: s.w - 2 * side, h: s.h - s.top - s.bottom };
}

/** Días (claves AAAA-MM-DD, inclusivos) del periodo. «Todo» empieza en la primera actividad. */
export function periodRange(p: Period, today: string, first?: string): { from: string; to: string } {
  const from = p === 'hoy' ? today : p === '7' ? addDays(today, -6) : p === '30' ? addDays(today, -29) : p === 'anio' ? `${today.slice(0, 4)}-01-01` : first && first < today ? first : today;
  return { from, to: today };
}

export interface Summary {
  from: string;
  to: string;
  ms: number;
  cards: number;
  days: number;
  streak: number;
  /** Bien/Fácil sobre repasos de tarjetas maduras del periodo; null sin datos */
  retention: number | null;
  /** tarjetas por día del periodo (para el mini mapa) */
  counts: Map<string, number>;
}

export function summarize(act: Map<string, DayAct>, log: LogEntry[], p: Period, today: string, tz: string, h: number, streakMin = 1): Summary {
  const first = [...act.keys()].sort()[0];
  const { from, to } = periodRange(p, today, first);
  let ms = 0, cards = 0, days = 0;
  const counts = new Map<string, number>();
  for (const [k, a] of act) {
    if (k < from || k > to) continue;
    const m = studyMs(a);
    ms += m;
    cards += a.cards;
    if (a.cards || m) days++;
    counts.set(k, a.cards);
  }
  let ok = 0, n = 0;
  for (const e of log) {
    if (!e.rating || e.state !== State.Review || (e.ivl ?? 0) < MATURE) continue;
    const k = dayKey(e.ts, tz, h);
    if (k < from || k > to) continue;
    n++;
    if (e.rating > 1) ok++;
  }
  const st = streaks(new Map([...act].map(([k, v]) => [k, v.cards])), today, streakMin);
  return { from, to, ms, cards, days, streak: st.current, retention: n ? ok / n : null, counts };
}

/** «42 h 15 min», «5 h», «15 min», «0 min» (sin ceros inútiles; miles con el formato del idioma). */
export function fmtDuration(ms: number, loc: string): string {
  const total = Math.round(ms / 60_000);
  const hh = Math.floor(total / 60), mm = total % 60;
  const nf = new Intl.NumberFormat(loc);
  if (!hh) return `${nf.format(mm)} min`;
  return mm ? `${nf.format(hh)} h ${nf.format(mm)} min` : `${nf.format(hh)} h`;
}

/** Recorta con «…» por grafemas hasta que `measure` quepa en `max` (emoji y acentos no se parten). */
export function ellipsize(text: string, max: number, measure: (s: string) => number): string {
  if (measure(text) <= max) return text;
  const seg = 'Segmenter' in Intl ? [...new Intl.Segmenter().segment(text)].map((s) => s.segment) : [...text];
  let lo = 0, hi = seg.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(seg.slice(0, mid).join('').trimEnd() + '…') <= max) lo = mid;
    else hi = mid - 1;
  }
  return seg.slice(0, lo).join('').trimEnd() + '…';
}

/** Qué se muestra (interruptores recordados en Ajustes; lo que falta toma su valor por defecto). */
export const SHOW_KEYS = ['name', 'user', 'photo', 'line', 'hours', 'cards', 'streak', 'retention', 'days', 'heat', 'brand'] as const;
export type ShowKey = (typeof SHOW_KEYS)[number];
/** Privacidad prudente: nombre, @usuario y foto solo si existen en el perfil; carrera/lema apagado. */
export function defaultShow(profile: { name: string; username?: string; photo: string; emoji: string }): Record<ShowKey, boolean> {
  return { name: !!profile.name.trim(), user: !!profile.username?.trim(), photo: !!(profile.photo || profile.emoji), line: false, hours: true, cards: true, streak: true, retention: true, days: true, heat: true, brand: true };
}

/** Nombre de archivo con la fecha local del día de estudio. */
export const fileName = (today: string, ext: 'png' | 'jpg') => `engrama-estadisticas-${today}.${ext}`;
