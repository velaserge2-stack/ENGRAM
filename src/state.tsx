import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { Settings } from './lib/settings';
import type { IntegrityReport } from './vault/integrity';
import type { RecoveryReport, SafeVault } from './vault/safe';

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
  /** Sube cada vez que cambian los archivos; las pantallas recargan con él. */
  version: number;
  changed(): void;
  toast(msg: string): void;
  sheet: 'import' | 'backup' | null;
  openSheet(s: 'import' | 'backup' | null): void;
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
      (error) => alive && set({ data: undefined, error, loading: false }),
    );
    return () => {
      alive = false;
    };
  }, deps);
  return state;
}

export function useRoute(): string[] {
  const parse = () => (location.hash.replace(/^#\/?/, '') || 'hoy').split('/').map(decodeURIComponent);
  const [r, setR] = useState(parse);
  useEffect(() => {
    const on = () => setR(parse());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return r;
}

export const go = (...parts: string[]) => {
  location.hash = '#/' + parts.map(encodeURIComponent).join('/');
};
