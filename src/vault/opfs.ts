import { normalizePath } from './paths';
import { type FileStat, type VaultAdapter, VaultError } from './types';
import { toBytes } from './util';
import type { WorkerRequest, WorkerResponse } from './opfs.worker';

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** Cliente de UI: habla con el Worker de OPFS por mensajes. */
export class OPFSBackend implements VaultAdapter {
  readonly kind = 'opfs' as const;
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  strategy = '';

  private constructor() {
    this.worker = new Worker(new URL('./opfs.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const r = ev.data;
      const p = this.pending.get(r.id);
      if (!p) return;
      this.pending.delete(r.id);
      if (r.ok) p.resolve(r.value);
      else p.reject(new VaultError(r.error, r.code === 'not-found' || r.code === 'NotFoundError' ? 'not-found' : 'io'));
    };
    this.worker.onerror = (ev) => {
      for (const p of this.pending.values()) p.reject(new VaultError(ev.message || 'Error del Worker', 'io'));
      this.pending.clear();
    };
  }

  static isSupported(): boolean {
    return typeof Worker !== 'undefined' && 'storage' in navigator && 'getDirectory' in navigator.storage;
  }

  /** Crea el backend y comprueba que OPFS responde (p. ej. falla en navegación privada). */
  static async open(): Promise<OPFSBackend> {
    const b = new OPFSBackend();
    const info = (await b.call({ op: 'init' })) as { strategy: string };
    b.strategy = info.strategy;
    return b;
  }

  private call(req: DistributiveOmit<WorkerRequest, 'id'>, transfer: Transferable[] = []): Promise<unknown> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...req, id }, transfer);
    });
  }

  list(path: string) {
    return this.call({ op: 'list', path: normalizePath(path) }) as Promise<FileStat[]>;
  }
  read(path: string) {
    return this.call({ op: 'read', path: normalizePath(path) }) as Promise<Uint8Array>;
  }
  async write(path: string, data: Uint8Array | string) {
    const bytes = toBytes(data).slice(); // copia propia para poder transferirla
    await this.call({ op: 'write', path: normalizePath(path), data: bytes }, [bytes.buffer]);
  }
  async remove(path: string) {
    await this.call({ op: 'remove', path: normalizePath(path) });
  }
  async move(from: string, to: string) {
    await this.call({ op: 'move', from: normalizePath(from), to: normalizePath(to) });
  }
  exists(path: string) {
    return this.call({ op: 'exists', path: normalizePath(path) }) as Promise<boolean>;
  }
  stat(path: string) {
    return this.call({ op: 'stat', path: normalizePath(path) }) as Promise<FileStat | null>;
  }
}
