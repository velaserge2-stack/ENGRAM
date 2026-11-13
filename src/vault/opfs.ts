import { normalizePath } from './paths';
import { type BlobWriteOptions, type FileStat, type VaultAdapter, VaultError } from './types';
import { toBytes } from './util';
import type { WorkerRequest, WorkerResponse } from './opfs.worker';

/** Nombre del error del Worker → código de VaultError (NotFound se distingue de un fallo real). */
const codeOf = (c?: string): VaultError['code'] =>
  c === 'not-found' || c === 'NotFoundError' || c === 'TypeMismatchError' ? 'not-found' : c === 'quota' || c === 'QuotaExceededError' ? 'quota' : c === 'invalid-path' ? 'invalid-path' : 'io';

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** Cliente de UI: habla con el Worker de OPFS por mensajes. */
export class OPFSBackend implements VaultAdapter {
  readonly kind = 'opfs' as const;
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: (n: number) => void }>();
  strategy = '';

  /** Sin respuesta del Worker durante este tiempo con operaciones pendientes → se reinicia. */
  static TIMEOUT = 20_000;
  private last = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    this.worker = this.spawn();
  }

  private spawn(): Worker {
    const w = new Worker(new URL('./opfs.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      this.last = Date.now(); // cualquier mensaje (también el progreso) cuenta como vida
      const r = ev.data;
      const p = this.pending.get(r.id);
      if (!p) return;
      if ('alive' in r) return; // solo reinicia el vigilante
      if ('progress' in r) return p.progress?.(r.progress);
      this.pending.delete(r.id);
      if (r.ok) p.resolve(r.value);
      else if (r.code === 'AbortError') p.reject(new DOMException(r.error, 'AbortError'));
      else p.reject(new VaultError(r.error, codeOf(r.code)));
    };
    w.onerror = (ev) => this.fail(ev.message || 'Error del Worker');
    return w;
  }

  /** Rechaza todo lo pendiente (el llamador ve un error, no una espera eterna). */
  private fail(msg: string) {
    for (const p of this.pending.values()) p.reject(new VaultError(msg, 'io'));
    this.pending.clear();
  }

  /**
   * Safari puede dejar el Worker colgado (segundo plano con un sync handle abierto, `getFile` tras
   * volver): sin esto la cola del Worker y la de SafeVault quedarían bloqueadas para siempre. Si
   * hay operaciones pendientes y el Worker no dice nada en TIMEOUT, se rechazan con `io` (la
   * escritura en curso no se dio por buena: SafeVault conserva su diario) y el Worker se recrea.
   */
  private arm() {
    if (this.watchdog) return;
    this.watchdog = setInterval(() => {
      if (!this.pending.size) {
        clearInterval(this.watchdog!);
        this.watchdog = null;
        return;
      }
      if (Date.now() - this.last < OPFSBackend.TIMEOUT) return;
      this.fail('El almacenamiento no responde; se reinició');
      this.worker.terminate();
      this.worker = this.spawn();
    }, Math.max(50, Math.min(5000, OPFSBackend.TIMEOUT / 4)));
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
      if (!this.pending.size) this.last = Date.now(); // el reloj empieza con la primera pendiente
      this.pending.set(id, { resolve, reject, progress });
      this.worker.postMessage({ ...req, id }, transfer);
      this.arm();
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
  queued() {
    return this.pending.size;
  }
  async hash(path: string) {
    return this.call({ op: 'hash', path: normalizePath(path) }) as Promise<{ size: number; hash: string }>;
  }
  async file(path: string) {
    return this.call({ op: 'file', path: normalizePath(path) }) as Promise<File>;
  }

  async list(path: string) {
    return this.call({ op: 'list', path: normalizePath(path) }) as Promise<FileStat[]>;
  }
  async read(path: string) {
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
  async exists(path: string) {
    return this.call({ op: 'exists', path: normalizePath(path) }) as Promise<boolean>;
  }
  async stat(path: string) {
    return this.call({ op: 'stat', path: normalizePath(path) }) as Promise<FileStat | null>;
  }
}
