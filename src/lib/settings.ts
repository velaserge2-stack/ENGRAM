import type { VaultAdapter } from '../vault/types';
import { readText } from '../vault/util';

export const SETTINGS_PATH = '.app/settings.json';

export interface Settings {
  v: 1;
  theme: 'auto' | 'light' | 'dark';
  /** Multiplicador de tamaño de texto (equivalente a Dynamic Type). */
  textScale: number;
  /** 0–100: desenfoque y transparencia del vidrio. */
  glass: number;
  accent: string;
  /** Hora a la que empieza el día de estudio (0–23). */
  dayStartHour: number;
  timeZone: string;
  /** Mínimo de tarjetas para que un día cuente en la racha. */
  streakMin: number;
  backupReminderDays: number;
  weeklyBackupReminder: boolean;
  lastExportAt: number | null;
  backupReminderSnoozedUntil: number | null;
  welcomeDone: boolean;
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
    theme: 'auto',
    textScale: 1,
    glass: 70,
    accent: 'azul',
    dayStartHour: 4,
    timeZone: deviceTimeZone(),
    streakMin: 1,
    backupReminderDays: 7,
    weeklyBackupReminder: true,
    lastExportAt: null,
    backupReminderSnoozedUntil: null,
    welcomeDone: false,
  };
}

/** Une lo guardado con los valores por defecto; ignora claves desconocidas o de tipo erróneo. */
export function mergeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const out = { ...d } as Record<string, unknown>;
  for (const k of Object.keys(d) as (keyof Settings)[]) {
    const v = r[k];
    if (v === undefined) continue;
    const dv = d[k];
    if (dv === null ? v === null || typeof v === 'number' : typeof v === typeof dv) out[k] = v;
  }
  const s = out as unknown as Settings;
  s.textScale = Math.min(1.6, Math.max(0.8, s.textScale));
  s.glass = Math.min(100, Math.max(0, s.glass));
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
