import type { VaultAdapter } from '../vault/types';
import { readText } from '../vault/util';

export const SETTINGS_PATH = '.app/settings.json';

export type GlassMode = 'auto' | 'dark' | 'light';

export interface Background {
  kind: 'builtin' | 'image' | 'solid';
  /** id integrado, ruta en media/.app/fondos/ o color hex */
  value: string;
}

export interface Settings {
  v: 1;
  theme: 'cristal';
  glassMode: GlassMode;
  textScale: number;
  /** 0–100: transparencia y desenfoque de los paneles */
  glass: number;
  /** sin desenfoque (rendimiento) */
  lightMode: boolean;
  bg: Background;
  bgBlur: number;
  /** −50 (oscurecer) … +50 (aclarar) */
  bgDim: number;
  /** excepción opcional: color solo en errores y acciones destructivas */
  semanticColor: boolean;
  dayStartHour: number;
  timeZone: string;
  weekStartsMonday: boolean;
  streakMin: number;
  backupReminderDays: number;
  weeklyBackupReminder: boolean;
  lastExportAt: number | null;
  backupReminderSnoozedUntil: number | null;
  welcomeDone: boolean;
  // estudio (FSRS)
  retention: number;
  learningSteps: string[];
  relearningSteps: string[];
  maxInterval: number;
  fsrsW: number[] | null;
  newPerDay: number;
  reviewLimit: number;
  recoveryThreshold: number;
  leechThreshold: number;
  suggestByTime: boolean;
  // pomodoro
  pomo: { work: number; short: number; long: number; every: number; sound: boolean };
  addons: Record<string, boolean>;
  /** etiquetas controladas (se crean aquí, no al vuelo) */
  tagList: string[];
  /** glosario personal para corregir transcripciones */
  glossary: string[];
  showGraph: boolean;
  showBacklinks: boolean;
  ttsLang: string;
  /** emoji por mazo (ruta → emoji); también puede ir en el frontmatter `emoji:` */
  deckEmoji: Record<string, string>;
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Monterrey';
  } catch {
    return 'America/Monterrey';
  }
}

export function defaultSettings(): Settings {
  return {
    v: 1,
    theme: 'cristal',
    glassMode: 'auto',
    textScale: 1,
    glass: 70,
    lightMode: false,
    bg: { kind: 'builtin', value: 'bruma' },
    bgBlur: 0,
    bgDim: 0,
    semanticColor: false,
    dayStartHour: 4,
    timeZone: deviceTimeZone(),
    weekStartsMonday: true,
    streakMin: 1,
    backupReminderDays: 7,
    weeklyBackupReminder: true,
    lastExportAt: null,
    backupReminderSnoozedUntil: null,
    welcomeDone: false,
    retention: 0.9,
    learningSteps: ['1m', '10m'],
    relearningSteps: ['10m'],
    maxInterval: 36500,
    fsrsW: null,
    newPerDay: 20,
    reviewLimit: 200,
    recoveryThreshold: 200,
    leechThreshold: 8,
    suggestByTime: false,
    pomo: { work: 25, short: 5, long: 15, every: 4, sound: true },
    addons: {},
    tagList: [],
    glossary: [],
    showGraph: false,
    showBacklinks: false,
    ttsLang: 'es-MX',
    deckEmoji: {},
  };
}

const NULLABLE = new Set(['lastExportAt', 'backupReminderSnoozedUntil', 'fsrsW']);

/** Une lo guardado con los valores por defecto; ignora claves desconocidas o de tipo erróneo. */
export function mergeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const out = { ...d } as Record<string, unknown>;
  for (const k of Object.keys(d) as (keyof Settings)[]) {
    const v = r[k];
    if (v === undefined) continue;
    const dv = d[k] as unknown;
    if (NULLABLE.has(k)) {
      if (v === null || typeof v === 'number' || Array.isArray(v)) out[k] = v;
    } else if (Array.isArray(dv)) {
      if (Array.isArray(v)) out[k] = v;
    } else if (dv && typeof dv === 'object') {
      if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = { ...(dv as object), ...(v as object) };
    } else if (typeof v === typeof dv) out[k] = v;
  }
  const s = out as unknown as Settings;
  if (!['auto', 'dark', 'light'].includes(s.glassMode)) s.glassMode = 'auto';
  s.theme = 'cristal';
  s.textScale = Math.min(1.6, Math.max(0.8, s.textScale));
  s.glass = Math.min(100, Math.max(0, s.glass));
  s.bgBlur = Math.min(40, Math.max(0, s.bgBlur));
  s.bgDim = Math.min(50, Math.max(-50, s.bgDim));
  s.retention = Math.min(0.99, Math.max(0.7, s.retention));
  s.dayStartHour = Math.min(23, Math.max(0, Math.round(s.dayStartHour)));
  return s;
}

export async function loadSettings(vault: VaultAdapter): Promise<Settings> {
  if (!(await vault.exists(SETTINGS_PATH))) return defaultSettings();
  try {
    return mergeSettings(JSON.parse(await readText(vault, SETTINGS_PATH)));
  } catch {
    return defaultSettings(); // el archivo dañado se conserva; integridad lo reporta
  }
}

export function serializeSettings(s: Settings): string {
  return JSON.stringify(s, null, 2) + '\n';
}

const DAY = 86_400_000;

/** ¿Mostrar el aviso discreto de respaldo? */
export function backupDue(s: Settings, now = Date.now(), hasData = true): boolean {
  if (!hasData) return false;
  if (s.backupReminderSnoozedUntil && now < s.backupReminderSnoozedUntil) return false;
  const days = s.weeklyBackupReminder ? Math.min(7, s.backupReminderDays) : s.backupReminderDays;
  if (s.lastExportAt === null) return true;
  return now - s.lastExportAt > days * DAY;
}

export function srsParams(s: Settings) {
  return { retention: s.retention, learningSteps: s.learningSteps, relearningSteps: s.relearningSteps, maxInterval: s.maxInterval, w: s.fsrsW, fuzz: true };
}

export function studyLimits(s: Settings) {
  return { newPerDay: s.newPerDay, reviewLimit: s.reviewLimit, recoveryThreshold: s.recoveryThreshold, leechThreshold: s.leechThreshold, tz: s.timeZone, dayStartHour: s.dayStartHour };
}
