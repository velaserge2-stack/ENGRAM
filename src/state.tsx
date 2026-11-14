import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { Collection } from './data/collection';
import type { Settings } from './lib/settings';
import type { PomoState } from './lib/pomodoro';
import type { IntegrityReport } from './vault/integrity';
import type { RecoveryReport, SafeVault } from './vault/safe';

type SheetId = 'import' | 'backup' | 'add' | 'exam' | 'palette' | 'ambient' | null;

export interface PomoCtl {
  state: PomoState;
  now: number;
  start(label?: string): void;
  pause(): void;
  reset(): void;
  skip(): void;
  setLabel(l: string): void;
  today: number;
}

export interface AppCtx {
  vault: SafeVault;
  detail: string;
  temporary: boolean;
  folderNeedsPermission: boolean;
  recovery: RecoveryReport;
  integrity: IntegrityReport | null;
  recheckIntegrity(): Promise<void>;
  settings: Settings;
  update(patch: Partial<Settings>, immediate?: boolean): void;
  replaceSettings(s: Settings): void;
  /** Sube cuando cambian los archivos: la colección se recarga. */
  version: number;
  /** Sube con `changed('notes')` (y no con los demás): las vistas lo escuchan junto a `version`. */
  notesVersion: number;
  /**
   * Algo cambió en los archivos. Sin ámbito, se recarga todo (colección, integridad y vistas). Con
   * `'notes'` (Prompt 21 · 6): la operación solo tocó `notes/` o `.app/bookmarks.json` (ni mazos ni
   * historial): se recargan las vistas, no la colección ni la comprobación de integridad.
   */
  changed(scope?: 'notes'): void;
  /** Re-render sin recargar (cambios en memoria). */
  tick: number;
  refresh(): void;
  col: Collection | null;
  /** Aviso breve; con `action`, un botón (p. ej. «Deshacer») y el aviso dura más. */
  toast(msg: string, action?: { label: string; run: () => void }): void;
  sheet: SheetId;
  sheetArg: string | null;
  openSheet(s: SheetId, arg?: string | null): void;
  pomo: PomoCtl;
  inboxCount: number;
  focus(on: boolean): void;
  /** fondo temporal (página /design, vista previa); null = el de Ajustes */
  previewBg(bg: import('./lib/settings').Background | null, mode?: 'dark' | 'light' | null): void;
}

export const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);

/** Carga asíncrona que se repite cuando cambian `deps`. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: unknown; loading: boolean } {
  const [state, set] = useState<{ data: T | undefined; error: unknown; loading: boolean }>({ data: undefined, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    set((s) => ({ ...s, loading: true }));
    fn().then(
      (data) => alive && set({ data, error: null, loading: false }),
      (error) => {
        console.error(error);
        if (alive) set({ data: undefined, error, loading: false });
      },
    );
    return () => {
      alive = false;
    };
  }, deps);
  return state;
}

/** Ruta de archivo de `#/espacios/abrir/<ruta>`: `parseHash` ya decodificó cada segmento (no se decodifica otra vez). */
export const routeFilePath = (route: string[]): string => route.slice(1).join('/');

export function parseHash(): string[] {
  return (location.hash.replace(/^#\/?/, '').split('?')[0] || 'hoy').split('/').map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
}

export function useRoute(): string[] {
  const [r, setR] = useState(parseHash);
  useEffect(() => {
    const on = () => setR(parseHash());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return r;
}

export const href = (...parts: string[]) => '#/' + parts.map(encodeURIComponent).join('/');
export const go = (...parts: string[]) => {
  location.hash = href(...parts);
};
