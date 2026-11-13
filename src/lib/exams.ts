import { locale, t } from '../i18n';
/**
 * Exámenes reales y ritmo (SPEC §9b D). Cada examen es `exams/<nombre>.md`:
 *   ---
 *   examen: Cardiología parcial
 *   fecha: 2026-12-03
 *   temas: [Cardiología, Neurología/EVC, tag:ecg]
 *   meta_retencion: 0.9
 *   dias_repaso_final: 7
 *   tarjetas_minimas_por_dia: 10
 *   creado: 2026-10-01
 *   ---
 */
import { fsrs, State } from 'ts-fsrs';
import type { Collection, Deck } from '../data/collection';
import { type SrsParams, scheduler } from '../srs/engine';
import { addDays, dayKey, daysBetween } from './days';
import { headOf, parseFrontmatter, rewriteDoc, stringifyFrontmatter } from './frontmatter';

export interface Exam {
  path: string;
  name: string;
  date: string;
  topics: string[];
  goal: number;
  finalDays: number;
  minPerDay: number | null;
  created: string;
  notes: string;
}

export function parseExam(path: string, text: string): Exam {
  const { data, body } = parseFrontmatter(text);
  const str = (v: unknown, d = '') => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : d);
  const goal = typeof data.meta_retencion === 'number' ? (data.meta_retencion > 1 ? data.meta_retencion / 100 : data.meta_retencion) : 0.9;
  return {
    path,
    name: str(data.examen) || path.split('/').pop()!.replace(/\.md$/, ''),
    date: str(data.fecha),
    topics: Array.isArray(data.temas) ? data.temas.map(String) : [],
    goal,
    finalDays: typeof data.dias_repaso_final === 'number' ? data.dias_repaso_final : 7,
    minPerDay: typeof data.tarjetas_minimas_por_dia === 'number' ? data.tarjetas_minimas_por_dia : null,
    created: str(data.creado),
    notes: body,
  };
}

/** `prev`: el archivo actual; sus líneas ajenas del frontmatter se conservan. */
export function serializeExam(e: Exam, prev = ''): string {
  const data = { examen: e.name, fecha: e.date, temas: e.topics, meta_retencion: e.goal, dias_repaso_final: e.finalDays, ...(e.minPerDay ? { tarjetas_minimas_por_dia: e.minPerDay } : {}), creado: e.created };
  if (headOf(prev) !== null) return rewriteDoc(prev, e.notes || '', { ...data, tarjetas_minimas_por_dia: e.minPerDay || undefined });
  return stringifyFrontmatter(data, e.notes || '');
}

export function decksForTopic(col: Collection, topic: string): Deck[] {
  if (topic.startsWith('tag:')) {
    const t = topic.slice(4);
    return col.decks.filter((d) => d.tags.some((x) => x === t || x.startsWith(t + '/')));
  }
  return col.decks.filter((d) => d.full === topic || d.name === topic || d.full.startsWith(topic + '/') || d.folder === topic);
}

export interface TopicStat {
  topic: string;
  total: number;
  newLeft: number;
  coverage: number;
  mastery: number;
  meanR: number;
  complete: boolean;
}

export function topicStats(col: Collection, topic: string, goal: number, now: number, params: SrsParams): TopicStat {
  const f = scheduler(params);
  const decks = decksForTopic(col, topic);
  let total = 0, newLeft = 0, seen = 0, mastered = 0, rSum = 0;
  for (const d of decks)
    for (const c of d.cards) {
      const st = col.states.get(c.cid);
      if (st?.suspended) continue;
      total++;
      if (!st || st.card.state === State.New) {
        newLeft++;
        continue;
      }
      seen++;
      const r = f.get_retrievability(st.card, new Date(now), false);
      rSum += r;
      if (r >= goal) mastered++;
    }
  const meanR = seen ? rSum / seen : 0;
  return { topic, total, newLeft, coverage: total ? seen / total : 0, mastery: total ? mastered / total : 0, meanR, complete: total > 0 && newLeft === 0 && meanR >= goal };
}

export type PaceStatus = 'en-ritmo' | 'ajustado' | 'atrasado' | 'calculando' | 'terminado' | 'pasado';

export interface Pace {
  daysLeft: number;
  studyDays: number;
  newLeft: number;
  needed: number;
  actual: number;
  dataDays: number;
  status: PaceStatus;
  message: string;
  finishDate: string | null;
  elapsed: number;
}

/**
 * Ritmo: necesario/día = nuevas restantes ÷ (días hasta el examen − días de repaso final);
 * real/día = nuevas introducidas, promedio de 7 días (14 si hay pocos datos).
 */
export function pace(input: { today: string; examDate: string; created: string; finalDays: number; newLeft: number; newPerDay: Map<string, number>; firstActivity: string | null; minPerDay?: number | null }): Pace {
  const { today, examDate, finalDays, newLeft } = input;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(examDate) || Number.isNaN(Date.parse(examDate + 'T00:00:00Z'))) {
    return { daysLeft: 0, studyDays: 0, newLeft, needed: 0, actual: 0, dataDays: 0, status: 'calculando', message: t('exams.aun_calculando'), finishDate: null, elapsed: 0 };
  }
  const daysLeft = daysBetween(today, examDate);
  const created = input.created || today;
  const span = Math.max(1, daysBetween(created, examDate));
  const elapsed = Math.min(1, Math.max(0, daysBetween(created, today) / span));
  const base = { daysLeft, newLeft, elapsed, finishDate: null as string | null };
  if (daysLeft < 0) return { ...base, studyDays: 0, needed: 0, actual: 0, dataDays: 0, status: 'pasado', message: t('exams.el_examen_ya_paso') };
  if (newLeft === 0) return { ...base, studyDays: Math.max(0, daysLeft - finalDays), needed: 0, actual: 0, dataDays: 0, status: 'terminado', message: t('exams.ya_no_quedan_tarjetas_nuevas_toca') };
  const studyDays = Math.max(1, daysLeft - finalDays);
  let needed = Math.ceil(newLeft / studyDays);
  if (input.minPerDay) needed = Math.max(needed, input.minPerDay);
  const dataDays = input.firstActivity ? Math.max(0, daysBetween(input.firstActivity, today)) : 0;
  const win = dataDays < 7 ? 14 : 7;
  let sum = 0;
  for (let i = 1; i <= win; i++) sum += input.newPerDay.get(addDays(today, -i)) ?? 0;
  const actual = Math.round((sum / Math.min(win, Math.max(1, dataDays))) * 10) / 10;
  if (dataDays < 3) return { ...base, studyDays, needed, actual, dataDays, status: 'calculando', message: t('exams.aun_calculando_necesitas_needed_nuevas_dia', { needed: needed }) };
  const ratio = actual / needed;
  const status: PaceStatus = ratio >= 1 ? 'en-ritmo' : ratio >= 0.8 ? 'ajustado' : 'atrasado';
  let finishDate: string | null = null;
  let message: string;
  if (actual > 0) {
    finishDate = addDays(today, Math.ceil(newLeft / actual));
    const diff = daysBetween(addDays(examDate, -finalDays), finishDate);
    message = status === 'en-ritmo'
      ? t('exams.necesitas_needed_nuevas_dia_y_llevas', { needed: needed, actual: actual, p: fmtDate(finishDate) })
      : t('exams.necesitas_needed_nuevas_dia_y_llevas_2', { needed: needed, actual: actual, p: Math.ceil(needed - actual), p2: fmtDate(finishDate), p3: diff > 0 ? t('exams.dias_tarde', { n: diff }) : t('exams.a_tiempo') });
  } else message = t('exams.necesitas_needed_nuevas_dia_y_esta', { needed: needed });
  return { ...base, studyDays, needed, actual, dataDays, status, message, finishDate };
}

export function fmtDate(key: string): string {
  if (Number.isNaN(Date.parse(key + 'T12:00:00Z'))) return key;
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(key + 'T12:00:00Z'));
}

export function newPerDayMap(col: Collection, cids: Set<string>, tz: string, h: number): { map: Map<string, number>; first: string | null } {
  const map = new Map<string, number>();
  let first: string | null = null;
  for (const e of col.log) {
    if (!e.rating) continue;
    const k = dayKey(e.ts, tz, h);
    if (!first || k < first) first = k;
    if (e.state === State.New && cids.has(e.id)) map.set(k, (map.get(k) ?? 0) + 1);
  }
  return { map, first };
}

/** Retención proyectada el día del examen: simulación FSRS suponiendo "Bien" en cada vencimiento. */
export function projectedRetention(col: Collection, cids: Set<string>, examTs: number, now: number, params: SrsParams): number | null {
  const f = fsrs({ request_retention: params.retention, maximum_interval: params.maxInterval, enable_fuzz: false, enable_short_term: true, ...(params.w ? { w: params.w } : {}) });
  let sum = 0, n = 0;
  for (const cid of cids) {
    const st = col.states.get(cid);
    if (!st || st.card.state === State.New || st.suspended) continue;
    let c = st.card;
    let guard = 0;
    while (c.due.getTime() < examTs && guard++ < 50) c = f.next(c, new Date(Math.max(now, c.due.getTime())), 3).card;
    sum += f.get_retrievability(c, new Date(examTs), false);
    n++;
  }
  return n ? sum / n : null;
}

export function examCids(col: Collection, e: Exam): Set<string> {
  const s = new Set<string>();
  for (const t of e.topics) for (const d of decksForTopic(col, t)) for (const c of d.cards) s.add(c.cid);
  return s;
}
