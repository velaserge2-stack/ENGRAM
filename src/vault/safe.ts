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
 */
import { normalizePath } from './paths';
import type { FileStat, VaultAdapter } from './types';
import { checksum, decodeText, toBytes } from './util';

export const JOURNAL_PATH = '.app/journal.json';
export const TMP_DIR = '.app/tmp';

interface JournalEntry {
  op: 'write' | 'move';
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

export class SafeVault implements VaultAdapter {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly raw: VaultAdapter) {}

  get kind() {
    return this.raw.kind;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async commit(entry: Omit<JournalEntry, 'tmp' | 'size' | 'hash' | 'ts'>, bytes: Uint8Array, apply: () => Promise<void>) {
    const tmp = `${TMP_DIR}/${Date.now().toString(36)}-${(++txSeq).toString(36)}`;
    await this.raw.write(tmp, bytes);
    const j: JournalEntry = { ...entry, tmp, size: bytes.length, hash: checksum(bytes), ts: Date.now() };
    await this.raw.write(JOURNAL_PATH, JSON.stringify({ v: 1, entries: [j] }));
    await apply();
    await this.raw.remove(JOURNAL_PATH);
    await this.raw.remove(tmp);
  }

  write(path: string, data: Uint8Array | string): Promise<void> {
    const p = normalizePath(path);
    const bytes = toBytes(data);
    return this.serial(() => this.commit({ op: 'write', path: p }, bytes, () => this.raw.write(p, bytes)));
  }

  move(from: string, to: string): Promise<void> {
    const a = normalizePath(from);
    const b = normalizePath(to);
    return this.serial(async () => {
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
      const report: RecoveryReport = { recovered: [], discarded: [], journalCorrupt: false };
      if (await this.raw.exists(JOURNAL_PATH)) {
        let entries: JournalEntry[] = [];
        try {
          const j = JSON.parse(decodeText(await this.raw.read(JOURNAL_PATH))) as { entries?: JournalEntry[] };
          entries = Array.isArray(j.entries) ? j.entries : [];
        } catch {
          report.journalCorrupt = true; // el diario se escribió a medias: el destino no se tocó
        }
        for (const e of entries) {
          let ok = false;
          try {
            if (await this.raw.exists(e.tmp)) {
              const bytes = await this.raw.read(e.tmp);
              if (bytes.length === e.size && checksum(bytes) === e.hash) {
                await this.raw.write(normalizePath(e.path), bytes);
                if (e.op === 'move' && e.from) await this.raw.remove(normalizePath(e.from));
                ok = true;
              }
            }
          } catch {
            ok = false;
          }
          (ok ? report.recovered : report.discarded).push(e.path);
        }
        await this.raw.remove(JOURNAL_PATH);
      }
      await this.raw.remove(TMP_DIR);
      return report;
    });
  }
}
