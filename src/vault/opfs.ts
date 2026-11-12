import { normalizePath } from './paths';
import { type BlobWriteOptions, type FileStat, type VaultAdapter, VaultError } from './types';
import { toBytes } from './util';
import type { WorkerRequest, WorkerResponse } from './opfs.worker';

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** Cliente de UI: habla con el Worker de OPFS por mensajes. */
export class OPFSBackend implements VaultAdapter {
  readonly kind = 'opfs' as const;
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (n: number) => void }>();
  strategy = '';

  private constructor() {
    this.worker = new Worker(new URL('./opfs.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const r = ev.data;
      const p = this.pending.get(r.id);
      if (!p) return;
      if ('progress' in r) return p.progress?.(r.progress);
      this.pending.delete(r.id);
      if (r.ok) p.resolve(r.value);
      else if (r.code === 'AbortError') p.reject(new DOMException(r.error, 'AbortError'));
      else p.reject(new VaultError(r.error, r.code === 'not-found' || r.code === 'NotFoundError' ? 'not-found' : r.code === 'QuotaExceededError' ? 'quota' : 'io'));
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

  private call(req: DistributiveOmit<WorkerRequest, 'id'>, transfer: Transferable[] = [], progress?: (n: number) => void, onId?: (id: number) => void): Promise<unknown> {
    const id = ++this.seq;
    onId?.(id);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress });
      this.worker.postMessage({ ...req, id }, transfer);
    });
  }

  /** El File viaja al Worker como referencia (no se copian sus bytes); se escribe allí por trozos. */
  async writeBlob(path: string, blob: Blob, opts: BlobWriteOptions = {}) {
    if (opts.signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    let id = 0;
    const abort = () => void this.worker.postMessage({ op: 'cancel', target: id, id: ++this.seq });
    opts.signal?.addEventListener('abort', abort, { once: true });
    try {
      return (await this.call({ op: 'writeBlob', path: normalizePath(path), blob }, [], (n) => opts.onProgress?.(n, blob.size), (x) => (id = x))) as { size: number; hash: string };
    } finally {
      opts.signal?.removeEventListener('abort', abort);
    }
  }
  hash(path: string) {
    return this.call({ op: 'hash', path: normalizePath(path) }) as Promise<{ size: number; hash: string }>;
  }
  file(path: string) {
    return this.call({ op: 'file', path: normalizePath(path) }) as Promise<File>;
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
