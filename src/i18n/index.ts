/**
 * Idiomas de la interfaz (es · en · fr). Tablas JSON por idioma; el contenido del
 * usuario no se traduce. `t('clave', { n })` interpola {n}; `tn()` usa Intl.PluralRules
 * con claves `.one` / `.other`. `xx` es un pseudo-idioma (+40 %) para probar desbordes.
 */
import es from './es.json';
import en from './en.json';
import fr from './fr.json';

export type Lang = 'es' | 'en' | 'fr' | 'xx';
export const LANGS: { id: Exclude<Lang, 'xx'>; name: string }[] = [
  { id: 'es', name: 'Español' },
  { id: 'en', name: 'English' },
  { id: 'fr', name: 'Français' },
];

const TABLES: Record<Exclude<Lang, 'xx'>, Record<string, string>> = { es, en, fr };
const LOCALE: Record<Lang, string> = { es: 'es-MX', en: 'en-US', fr: 'fr-FR', xx: 'es-MX' };

let lang: Lang = 'es';
const listeners = new Set<() => void>();

/** Idioma del dispositivo si es uno de los tres; si no, español. */
export function deviceLang(): Exclude<Lang, 'xx'> {
  const l = (typeof navigator !== 'undefined' ? navigator.languages?.[0] ?? navigator.language : 'es') ?? 'es';
  const base = l.slice(0, 2).toLowerCase();
  return base === 'en' || base === 'fr' ? base : 'es';
}

export function setLang(l: Lang) {
  if (l === lang) return;
  lang = l;
  if (typeof document !== 'undefined') document.documentElement.lang = l === 'xx' ? 'es' : l;
  pluralCache = null;
  for (const f of listeners) f();
}

export function getLang(): Lang {
  return lang;
}

export function onLang(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Locale para Intl (fechas, horas, números). */
export function locale(): string {
  return LOCALE[lang];
}

function pseudo(s: string): string {
  const map: Record<string, string> = { a: 'á', e: 'ë', i: 'ï', o: 'ô', u: 'ü', A: 'Å', E: 'É', O: 'Ö' };
  let out = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    out += depth ? ch : map[ch] ?? ch;
  }
  const n = Math.ceil(s.length * 0.4); // +40 %, en «palabras» cortas: así se parte como un idioma real
  const pad = n > 3 ? ' ' + '···· '.repeat(Math.ceil(n / 5)).trim() : '·'.repeat(n);
  return `⟦${out}${pad}⟧`;
}

export function raw(key: string): string | undefined {
  const table = lang === 'xx' ? TABLES.es : TABLES[lang];
  const s = table[key] ?? TABLES.es[key];
  return s === undefined ? undefined : lang === 'xx' ? pseudo(s) : s;
}

export function t(key: string, params?: Record<string, unknown>): string {
  const s = raw(key) ?? key;
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? fmtParam(params[k]) : m));
}

function fmtParam(v: unknown): string {
  if (typeof v === 'number') return new Intl.NumberFormat(locale(), { maximumFractionDigits: 2, useGrouping: 'min2' } as Intl.NumberFormatOptions).format(v);
  return String(v ?? '');
}

let pluralCache: Intl.PluralRules | null = null;
/** Plural: busca `clave.one`, `clave.other` (y `clave.zero` si existe para 0). */
export function tn(key: string, n: number, params: Record<string, unknown> = {}): string {
  pluralCache ??= new Intl.PluralRules(locale());
  const cat = n === 0 && raw(`${key}.zero`) !== undefined ? 'zero' : pluralCache.select(n);
  const k = raw(`${key}.${cat}`) !== undefined ? `${key}.${cat}` : `${key}.other`;
  return t(k, { n, ...params });
}

/** Lunes (1) o domingo (0) como primer día según el idioma. */
export function firstDayOfWeek(): 0 | 1 {
  try {
    const info = (new Intl.Locale(locale()) as Intl.Locale & { weekInfo?: { firstDay: number }; getWeekInfo?: () => { firstDay: number } });
    const fd = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    if (fd) return fd === 7 ? 0 : 1;
  } catch {
    /* sin weekInfo */
  }
  return lang === 'en' ? 0 : 1;
}

export function allKeys(l: Exclude<Lang, 'xx'>): string[] {
  return Object.keys(TABLES[l]);
}
