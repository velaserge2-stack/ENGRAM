/// <reference lib="webworker" />
/**
 * Worker dedicado de OPFS (SPEC §3). Todo acceso a disco ocurre aquí.
 * Escritura: `createSyncAccessHandle` (Safari ≥ 15.2, solo en Worker);
 * si no existe, `createWritable` (Safari 26, Chrome).
 * En Safari 15.x los métodos del sync handle devolvían promesas: por eso se usa `await` en todos.
 */
import { asciiCodec, HandleFS, type WriteStrategy, writeWithWritable } from './handle-fs';
import type { FileStat } from './types';

interface SyncHandle {
  truncate(size: number): unknown;
  write(buf: Uint8Array, opts: { at: number }): unknown;
  flush(): unknown;
  close(): unknown;
}

const writeWithSyncHandle: WriteStrategy = async (fh, data) => {
  const h = await (fh as unknown as { createSyncAccessHandle(): Promise<SyncHandle> }).createSyncAccessHandle();
  try {
    await h.truncate(0);
    let at = 0;
    while (at < data.length) {
      const n = Number(await h.write(data.subarray(at), { at }));
      if (!(n > 0)) throw new Error('Escritura incompleta');
      at += n;
    }
    await h.flush();
  } finally {
    await h.close();
  }
};

export type WorkerRequest =
  | { id: number; op: 'init' }
  | { id: number; op: 'list' | 'read' | 'remove' | 'exists' | 'stat'; path: string }
  | { id: number; op: 'readMany'; paths: string[] }
  | { id: number; op: 'write'; path: string; data: Uint8Array }
  | { id: number; op: 'appendAt'; path: string; data: Uint8Array; at: number; sep: boolean }
  | { id: number; op: 'move'; from: string; to: string }
  // Prompt 11: archivos grandes por trozos (el Blob llega sin copiar sus bytes)
  | { id: number; op: 'writeBlob'; path: string; blob: Blob }
  | { id: number; op: 'hash' | 'file'; path: string }
  | { id: number; op: 'cancel'; target: number };

export type WorkerResponse =
  | { id: number; progress: number }
  /** señal de vida de una operación larga que avanza (copia, suma, listado): reinicia el vigilante del cliente */
  | { id: number; alive: true }
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string; code?: string };

let fsPromise: Promise<{ fs: HandleFS; strategy: string }> | null = null;

function getFS() {
  fsPromise ??= (async () => {
    const root = await navigator.storage.getDirectory();
    const proto = (self as unknown as { FileSystemFileHandle?: { prototype: object } }).FileSystemFileHandle?.prototype;
    const hasSync = !!proto && 'createSyncAccessHandle' in proto;
    const strategy = hasSync ? 'sync-access-handle' : 'writable';
    return { fs: new HandleFS(root, hasSync ? writeWithSyncHandle : writeWithWritable, asciiCodec, { cacheDirs: true }), strategy }; // OPFS es privado: caché de carpetas
  })();
  return fsPromise;
}

// Las operaciones se ejecutan en serie: un sync handle abierto bloquea el archivo.
let chain: Promise<unknown> = Promise.resolve();

const cancelled = new Set<number>();

/** Avisa que la operación `id` avanza (como mucho una vez por segundo). Solo se llama desde el trabajo real: un await colgado no la emite. */
function aliveFor(id: number) {
  let t = 0;
  return () => {
    const now = Date.now();
    if (now - t >= 1000) ((t = now), (self as unknown as Worker).postMessage({ id, alive: true } satisfies WorkerResponse));
  };
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  // cancelar no espera en la cola: marca la escritura en curso para que se detenga
  if (req.op === 'cancel') return void cancelled.add(req.target);
  chain = chain.then(async () => {
    try {
      const { fs, strategy } = await getFS();
      let value: unknown;
      const transfer: Transferable[] = [];
      switch (req.op) {
        case 'init':
          value = { strategy };
          break;
        case 'list':
          value = await fs.list(req.path, aliveFor(req.id));
          break;
        case 'read': {
          const bytes = await fs.read(req.path);
          transfer.push(bytes.buffer);
          value = bytes;
          break;
        }
        case 'readMany': {
          const out: Uint8Array[] = [];
          for (const p of req.paths) out.push(await fs.read(p));
          for (const b of out) transfer.push(b.buffer);
          value = out;
          break;
        }
        case 'write':
          await fs.write(req.path, req.data);
          break;
        case 'remove':
          await fs.remove(req.path);
          break;
        case 'appendAt':
          value = await fs.appendAt(req.path, req.data, req.at, req.sep);
          break;
        case 'move':
          await fs.move(req.from, req.to, aliveFor(req.id));
          break;
        case 'writeBlob': {
          let last = 0;
          try {
            value = await fs.writeBlob(req.path, req.blob, (n) => {
              if (n - last >= 1 << 20 || n === req.blob.size) ((last = n), (self as unknown as Worker).postMessage({ id: req.id, progress: n } satisfies WorkerResponse));
            }, () => cancelled.has(req.id));
          } catch (e) {
            await fs.remove(req.path).catch(() => {}); // no dejar el temporal a medias
            throw e;
          } finally {
            cancelled.delete(req.id);
          }
          break;
        }
        case 'hash':
          value = await fs.hash(req.path, aliveFor(req.id));
          break;
        case 'file':
          value = await fs.file(req.path);
          break;
        case 'exists':
          value = (await fs.stat(req.path)) !== null;
          break;
        case 'stat':
          value = (await fs.stat(req.path)) as FileStat | null;
          break;
      }
      (self as unknown as Worker).postMessage({ id: req.id, ok: true, value } satisfies WorkerResponse, transfer);
    } catch (e) {
      const err = e as { message?: string; code?: unknown; name?: string };
      (self as unknown as Worker).postMessage({
        id: req.id,
        ok: false,
        error: `${req.op} ${'path' in req ? req.path : 'paths' in req ? `${req.paths.length} archivos` : 'from' in req ? `${req.from} → ${req.to}` : ''}: ${err?.message ?? String(e)}`,
        // VaultError trae `code` de texto; DOMException.code es numérico (22): entonces vale el nombre
        code: typeof err?.code === 'string' ? err.code : err?.name,
      } satisfies WorkerResponse);
    }
  });
};
