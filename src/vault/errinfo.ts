import { t } from '../i18n';

/** Línea técnica `Nombre: mensaje` (≤ 160): sin prefijo «op ruta:» ni rutas del usuario. */
export function techLine(e: unknown): string {
  const x = e as { name?: string; message?: string; code?: string } | null;
  const name = x?.name === 'VaultError' && x.code ? `VaultError/${x.code}` : x?.name || 'Error';
  const body = String(x?.message ?? e).replace(/^[a-zA-Z]+ [^:]*: /, '').replace(/\S*\/\S*/g, '…').replace(/\s+/g, ' ');
  return `${name}: ${body}`.slice(0, 160);
}

/** Texto de un fallo de almacenamiento: causa clara si es un bloqueo + línea técnica. */
export function storageErrorText(e: unknown): string {
  const locked = (e as { code?: string } | null)?.code === 'locked';
  return `${locked ? `${t('vault.locked')} ` : ''}${t('vault.tech', { line: techLine(e) })}`;
}

/** Guardados que fallaron (también al ocultar la página): se avisa en el siguiente arranque. */
const KEY = 'engrama.pendingSave';
const read = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};
const write = (a: string[]) => {
  try {
    if (a.length) localStorage.setItem(KEY, JSON.stringify(a.slice(-20)));
    else localStorage.removeItem(KEY);
  } catch { /* sin almacenamiento local: solo se pierde la marca */ }
};
export const markPendingSave = (path: string) => write([...read().filter((p) => p !== path), path]);
export const clearPendingSave = (path: string) => { const a = read(); if (a.includes(path)) write(a.filter((p) => p !== path)); };
/** Rutas que quedaron sin guardar en la sesión anterior (y borra la marca). */
export function takePendingSaves(): string[] {
  const a = read();
  write([]);
  return a;
}
