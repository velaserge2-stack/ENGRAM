export interface StorageInfo {
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

/** Pedir almacenamiento persistente (reduce el riesgo de que Safari expulse la bóveda). */
export async function requestPersist(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function storageInfo(): Promise<StorageInfo> {
  const info: StorageInfo = { persisted: null, usage: null, quota: null };
  try {
    if (navigator.storage?.persisted) info.persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      info.usage = e.usage ?? null;
      info.quota = e.quota ?? null;
    }
  } catch {
    /* sin datos */
  }
  return info;
}

export function isStandalone(): boolean {
  return (
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches)
  );
}

export function formatBytes(n: number | null): string {
  if (n === null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString('es-MX', { maximumFractionDigits: i ? 1 : 0 })} ${u[i]}`;
}
