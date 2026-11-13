/**
 * Escritura segura con diario (SPEC §3, regla no negociable).
 *
 * write(path, data):
 *   1. escribe `data` en `.app/tmp/<id>`
 *   2. registra la intención en `.app/journal.json` (ruta, tamaño, suma de verificación)
 *   3. escribe el destino
 *   4. borra el diario y el temporal
 *
 * Si la app muere entre 2 y 4, `recover()` al arrancar rehace la escritura desde
 * el temporal (si su suma coincide) o la descarta. Si muere antes de 2, el
 * destino nunca se tocó y el temporal huérfano se limpia.
 * Las operaciones se serializan para que el diario tenga a lo más una transacción.
 * Si el paso 3 falla con la app viva (cuota, Worker), se reintenta una vez; si vuelve a fallar,
 * el diario y el temporal se conservan y la siguiente operación los recupera ANTES de escribir
 * (si tampoco puede, se niega con un error claro en vez de pisar el diario).
 */
import { normalizePath } from './paths';
import { type BlobWriteOptions, type FileStat, type VaultAdapter, VaultError } from './types';
import { checksum, decodeText, toBytes } from './util';

export const JOURNAL_PATH = '.app/journal.json';
export const TMP_DIR = '.app/tmp';

interface JournalEntry {
  op: 'write' | 'move';
  /** Escritura por trozos (Prompt 11): el temporal se MUEVE al destino en vez de reescribirse. */
  stream?: boolean;
  path: string;
  from?: string;
  tmp: string;
  size: number;
  hash: string;
  ts: number;
}

export interface RecoveryReport {
  recovered: string[];
  discarded: string[];
  journalCorrupt: boolean;
}

let txSeq = 0;

/**
 * Un solo escritor por bóveda: el diario es uno para toda la bóveda. La cola se comparte por backend
 * (varias SafeVault sobre el mismo `raw`) y, si existe `navigator.locks`, cada operación toma además
 * el cerrojo entre pestañas (dos pestañas no se pisan el diario ni el temporal en curso).
 */
const queues = new WeakMap<VaultAdapter, Promise<unknown>>();
const LOCK = 'engrama-vault';
type Locks = { request<T>(name: string, cb: () => Promise<T>): Promise<T> };
function locks(): Locks | null {
  const n = typeof navigator === 'undefined' ? null : (navigator as Navigator & { locks?: Locks });
  return n && 'locks' in n && n.locks ? n.locks : null;
}

/** Ruta normalizada fuera de `.app/tmp` y distinta del diario (o null si no vale). */
function safeTarget(p: unknown): string | null {
  if (typeof p !== 'string') return null;
  try {
    const n = normalizePath(p);
    return n && n !== JOURNAL_PATH && n !== TMP_DIR && !n.startsWith(`${TMP_DIR}/`) ? n : null;
  } catch {
    return null;
  }
}

/** Un diario solo se ejecuta si tiene la forma que escribe `commit`/`writeStream` (uno ajeno o plantado se descarta). */
function validEntry(e: Partial<JournalEntry> | null): e is JournalEntry {
  if (!e || typeof e !== 'object' || (e.op !== 'write' && e.op !== 'move')) return false;
  if (typeof e.tmp !== 'string' || !/^\.app\/tmp\/[A-Za-z0-9-]+$/.test(e.tmp)) return false;
  if (typeof e.size !== 'number' || typeof e.hash !== 'string' || !safeTarget(e.path)) return false;
  if (e.op === 'move' && (!safeTarget(e.from) || e.stream)) return false;
  return e.op === 'move' || e.from === undefined;
}

export class SafeVault implements VaultAdapter {
  /** Hay un diario sin aplicar (apply fallido con la app viva): recuperarlo antes de la siguiente operación. */
  private stuck = false;
  constructor(readonly raw: VaultAdapter) {}

  get kind() {
    return this.raw.kind;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const go = () => this.settle().then(fn);
    const locked = () => locks()?.request(LOCK, go) ?? go();
    const run = (queues.get(this.raw) ?? Promise.resolve()).then(locked, locked);
    queues.set(this.raw, run.catch(() => undefined));
    return run;
  }

  private async settle() {
    if (!this.stuck) return;
    await this.replay();
    if (this.stuck) throw new VaultError('Una escritura anterior quedó a medias y no se pudo completar; no se escribe nada más hasta recuperarla', 'io', JOURNAL_PATH);
  }

  /** Paso 3 con un reintento; si vuelve a fallar, el diario queda para `settle`. */
  private async apply(fn: () => Promise<void>) {
    try {
      await fn();
    } catch {
      try {
        await fn();
      } catch (e) {
        this.stuck = true;
        throw e;
      }
    }
  }

  private async commit(entry: Omit<JournalEntry, 'tmp' | 'size' | 'hash' | 'ts'>, bytes: Uint8Array, apply: () => Promise<void>) {
    const tmp = `${TMP_DIR}/${Date.now().toString(36)}-${(++txSeq).toString(36)}`;
    await this.raw.write(tmp, bytes);
    const j: JournalEntry = { ...entry, tmp, size: bytes.length, hash: checksum(bytes), ts: Date.now() };
    await this.raw.write(JOURNAL_PATH, JSON.stringify({ v: 1, entries: [j] }));
    await this.apply(apply);
    await this.raw.remove(JOURNAL_PATH);
    await this.raw.remove(tmp);
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    const p = normalizePath(path);
    const bytes = toBytes(data);
    return this.serial(() => this.commit({ op: 'write', path: p }, bytes, () => this.raw.write(p, bytes)));
  }

  /**
   * Escritura de archivos grandes (Prompt 11) con la misma garantía:
   *   1. el Blob se escribe por trozos en `.app/tmp/<id>` (suma incremental; solo un trozo en memoria)
   *   2. se registra la intención en el diario (ruta, tamaño, suma, `stream`)
   *   3. el temporal se MUEVE al destino (una sola escritura de los datos)
   *   4. se borra el diario
   * Cancelar (o un error) borra el temporal; el destino no se toca. Sin `writeBlob` en el
   * backend, se lee el Blob y se usa `write` (mismo resultado, más memoria).
   */
  async writeStream(path: string, blob: Blob, opts: BlobWriteOptions = {}): Promise<void> {
    const p = normalizePath(path);
    if (!this.raw.writeBlob) return blob.arrayBuffer().then((b) => this.write(p, new Uint8Array(b)));
    return this.serial(async () => {
      const tmp = `${TMP_DIR}/${Date.now().toString(36)}-${(++txSeq).toString(36)}`;
      let r: { size: number; hash: string };
      try {
        r = await this.raw.writeBlob!(tmp, blob, opts);
      } catch (e) {
        await this.raw.remove(tmp).catch(() => {});
        throw e;
      }
      const j: JournalEntry = { op: 'write', stream: true, path: p, tmp, size: r.size, hash: r.hash, ts: Date.now() };
      await this.raw.write(JOURNAL_PATH, JSON.stringify({ v: 1, entries: [j] }));
      // si el movimiento falla, el temporal sigue completo: el reintento o `settle` lo vuelven a mover
      await this.apply(async () => (await this.raw.exists(tmp) ? this.raw.move(tmp, p) : undefined));
      await this.raw.remove(JOURNAL_PATH);
    });
  }

  /** Suma de un archivo por trozos si el backend sabe; si no, leyéndolo. */
  private async sum(path: string): Promise<{ size: number; hash: string }> {
    if (this.raw.hash) return this.raw.hash(path);
    const b = await this.raw.read(path);
    return { size: b.length, hash: checksum(b) };
  }

  async file(path: string) {
    return this.raw.file ? this.raw.file(normalizePath(path)) : this.raw.read(path).then((b) => new File([b as BlobPart], normalizePath(path).split('/').pop()!));
  }
  async hash(path: string) {
    return this.sum(normalizePath(path));
  }

  async move(from: string, to: string): Promise<void> {
    const a = normalizePath(from);
    const b = normalizePath(to);
    return this.serial(async () => {
      if (a === b) return; // mover sobre sí mismo: escribir y borrar `a` lo perdería
      const st = await this.raw.stat(a);
      if (st?.kind !== 'file') return this.raw.move(a, b); // directorios: el backend copia y luego borra
      const bytes = await this.raw.read(a);
      await this.commit({ op: 'move', path: b, from: a }, bytes, async () => {
        await this.raw.write(b, bytes);
        await this.raw.remove(a);
      });
    });
  }

  remove(path: string) {
    return this.serial(() => this.raw.remove(path));
  }
  list(path: string): Promise<FileStat[]> {
    return this.raw.list(path);
  }
  read(path: string) {
    return this.raw.read(path);
  }
  exists(path: string) {
    return this.raw.exists(path);
  }
  stat(path: string) {
    return this.raw.stat(path);
  }

  /** Llamar una vez al arrancar, antes de cualquier otra operación. */
  recover(): Promise<RecoveryReport> {
    return this.serial(async () => {
      const report = await this.replay();
      if (!this.stuck) await this.raw.remove(TMP_DIR); // con un diario pendiente, su temporal se conserva
      return report;
    });
  }

  /**
   * Aplica el diario. Temporal ausente o con otra suma → se descarta (el destino no se tocó).
   * Un fallo de E/S al aplicarlo → el diario y el temporal se conservan (`stuck`) para reintentar.
   */
  private async replay(): Promise<RecoveryReport> {
    const report: RecoveryReport = { recovered: [], discarded: [], journalCorrupt: false };
    this.stuck = false;
    if (!(await this.raw.exists(JOURNAL_PATH))) return report;
    let entries: JournalEntry[] = [];
    try {
      const j = JSON.parse(decodeText(await this.raw.read(JOURNAL_PATH))) as { entries?: JournalEntry[] };
      entries = Array.isArray(j.entries) ? j.entries : [];
    } catch {
      report.journalCorrupt = true; // el diario se escribió a medias: el destino no se tocó
    }
    for (const e of entries) {
      let ok = false;
      if (!validEntry(e)) {
        report.discarded.push(String((e as Partial<JournalEntry> | null)?.path ?? '?'));
        continue;
      }
      try {
        if (e.op === 'move' && (await this.raw.stat(normalizePath(e.from!)))?.kind === 'dir') {
          report.discarded.push(e.path); // `from` debe ser un archivo: nunca borrar una carpeta desde el diario
          continue;
        }
        if (e.stream) {
          // escritura por trozos: el temporal verificado se mueve; si ya se movió, se comprueba el destino
          const dest = normalizePath(e.path);
          if (await this.raw.exists(e.tmp)) {
            const s = await this.sum(e.tmp);
            if (s.size === e.size && s.hash === e.hash) (await this.raw.move(e.tmp, dest), (ok = true));
          } else if (await this.raw.exists(dest)) {
            const s = await this.sum(dest);
            ok = s.size === e.size && s.hash === e.hash;
          }
        } else if (await this.raw.exists(e.tmp)) {
          const bytes = await this.raw.read(e.tmp);
          if (bytes.length === e.size && checksum(bytes) === e.hash) {
            await this.raw.write(normalizePath(e.path), bytes);
            if (e.op === 'move' && e.from) await this.raw.remove(normalizePath(e.from));
            ok = true;
          }
        }
      } catch {
        this.stuck = true; // E/S: no se descarta, se reintenta en la siguiente operación
        continue;
      }
      (ok ? report.recovered : report.discarded).push(e.path);
    }
    if (!this.stuck) await this.raw.remove(JOURNAL_PATH);
    return report;
  }
}
