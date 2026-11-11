/**
 * Elige el backend al arrancar (SPEC §3):
 *   1. carpeta real (File System Access) si el usuario la conectó y hay permiso
 *   2. OPFS en Worker (por defecto; Safari)
 *   3. memoria ("modo temporal") si OPFS no responde (p. ej. navegación privada)
 * Siempre envuelto en SafeVault y recuperado antes de usarlo.
 */
import { FSAccessBackend } from './fsaccess';
import { MemoryBackend } from './memory';
import { OPFSBackend } from './opfs';
import { type RecoveryReport, SafeVault } from './safe';
import type { VaultAdapter } from './types';

const DB = 'engrama-handles';
const STORE = 'h';
const KEY = 'vault-dir';

function idb(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => open.result.close();
    };
  });
}

type PermHandle = FileSystemDirectoryHandle & {
  queryPermission?(o: object): Promise<PermissionState>;
  requestPermission?(o: object): Promise<PermissionState>;
};

export async function storedFolder(): Promise<PermHandle | null> {
  if (!FSAccessBackend.isSupported() || typeof indexedDB === 'undefined') return null;
  try {
    return ((await idb('readonly', (s) => s.get(KEY))) as PermHandle | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function rememberFolder(h: FileSystemDirectoryHandle | null): Promise<void> {
  await idb('readwrite', (s) => (h ? s.put(h, KEY) : s.delete(KEY)));
}

/** Debe llamarse desde un gesto (pide permiso de nuevo). */
export async function reconnectFolder(): Promise<boolean> {
  const h = await storedFolder();
  if (!h?.requestPermission) return false;
  return (await h.requestPermission({ mode: 'readwrite' })) === 'granted';
}

export interface OpenedVault {
  vault: SafeVault;
  recovery: RecoveryReport;
  /** Detalle técnico para Ajustes. */
  detail: string;
  folderNeedsPermission: boolean;
}

export async function openVault(): Promise<OpenedVault> {
  let raw: VaultAdapter | null = null;
  let detail = '';
  let folderNeedsPermission = false;

  const folder = await storedFolder();
  if (folder) {
    const perm = folder.queryPermission ? await folder.queryPermission({ mode: 'readwrite' }) : 'granted';
    if (perm === 'granted') {
      raw = new FSAccessBackend(folder);
      detail = `Carpeta del equipo: ${folder.name}`;
    } else folderNeedsPermission = true;
  }
  if (!raw && OPFSBackend.isSupported()) {
    try {
      const o = await OPFSBackend.open();
      raw = o;
      detail = `Almacenamiento privado del navegador (OPFS, ${o.strategy === 'sync-access-handle' ? 'createSyncAccessHandle' : 'createWritable'} en Worker)`;
    } catch (e) {
      console.warn('OPFS no disponible', e);
    }
  }
  if (!raw) {
    raw = new MemoryBackend();
    detail = 'Modo temporal en memoria: nada se guarda al cerrar';
  }
  const vault = new SafeVault(raw);
  const recovery = await vault.recover();
  return { vault, recovery, detail, folderNeedsPermission };
}
