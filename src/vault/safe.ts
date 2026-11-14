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
import { perf } from '../lib/perf';
import { Batch } from './batch';
import { normalizePath } from './paths';
import { type BlobWriteOptions, type FileStat, type VaultAdapter, VaultError } from './types';
import { checksum, decodeText, toBytes, walk } from './util';

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

/**
 * Diario de un lote (v2, Prompt 21 · 3a). Se escribe cuando TODOS los temporales ya están en disco.
 * Aplicar: `writes` (temporal → destino, renombrando), `moves` (renombrar; `via` = paso por un
 * temporal cuando solo cambian mayúsculas), `removes` y, al final, `dirs` que hayan quedado vacías.
 * Cada paso es idempotente: el origen de un renombrado nunca es destino de otro paso del lote.
 */
interface BatchJournal {
  v: 2 | 4;
  ts: number;
  writes: { path: string; tmp: string; size: number; hash: string }[];
  moves: { from: string; to: string; via?: string }[];
  removes: string[];
  dirs: string[];
  /**
   * Solo v4 (Prompt 21-B): destinos que NO existían al planear; se escriben directo (sin temporal ni
   * renombrado) DESPUÉS de este diario y ANTES de aplicar lo demás. `freshDirs`: carpetas que tampoco
   * existían. Revertir = borrar esos destinos (si son los nuestros) y esas carpetas (si quedaron vacías).
   */
  fresh?: Fresh[];
  freshDirs?: string[];
}
type Fresh = { path: string; size: number; hash: string };

export interface RecoveryReport {
  recovered: string[];
  discarded: string[];
  journalCorrupt: boolean;
}

let txSeq = 0;
const newTmp = () => `${TMP_DIR}/${Date.now().toString(36)}-${(++txSeq).toString(36)}`;
const TMP_RE = /^\.app\/tmp\/[A-Za-z0-9-]+$/;

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
  if (typeof e.tmp !== 'string' || !TMP_RE.test(e.tmp)) return false;
  if (typeof e.size !== 'number' || typeof e.hash !== 'string' || !safeTarget(e.path)) return false;
  if (e.op === 'move' && (!safeTarget(e.from) || e.stream)) return false;
  return e.op === 'move' || e.from === undefined;
}

/**
 * Diario de un añadido (v3, Prompt 21 · 4): el archivo debe quedar con sus primeros `at` bytes y `data`
 * detrás (con «\n» si hacía falta). Lleva los datos (pocos: líneas de `.jsonl`) y su suma: no hay temporal.
 */
interface AppendJournal { v: 3; ts: number; append: { path: string; at: number; size: number; hash: string; data: string } }

/** Un diario de lote solo se ejecuta si tiene la forma que escribe `commitBatch`. */
function validBatch(j: Partial<BatchJournal>): j is BatchJournal {
  const isTmp = (t: unknown) => typeof t === 'string' && TMP_RE.test(t);
  if (j.v === 4 && !(Array.isArray(j.fresh) && j.fresh.every((f) => f && typeof f.size === 'number' && typeof f.hash === 'string' && safeTarget(f.path)) &&
    Array.isArray(j.freshDirs) && j.freshDirs.every((d) => safeTarget(d)))) return false;
  return Array.isArray(j.writes) && Array.isArray(j.moves) && Array.isArray(j.removes) && Array.isArray(j.dirs) &&
    j.writes.every((w) => w && isTmp(w.tmp) && typeof w.size === 'number' && typeof w.hash === 'string' && safeTarget(w.path)) &&
    j.moves.every((m) => m && safeTarget(m.from) && safeTarget(m.to) && (m.via === undefined || isTmp(m.via))) &&
    j.removes.every((p) => safeTarget(p)) && j.dirs.every((p) => safeTarget(p));
}

/**
 * Progreso y cancelación de un lote (Prompt 21 · 3b). `onProgress(hecho, total)` cuenta los archivos
 * confirmados. `signal` cancela mientras se escriben los temporales (se borran y no cambia nada); una vez
 * escrito el diario el lote ya no se cancela: aplicarlo son solo renombrados y es lo seguro.
 */
export interface BatchOptions { onProgress?: (done: number, total: number) => void; signal?: AbortSignal }
const aborted = () => new DOMException('Cancelado', 'AbortError');
const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
/** Clave de comparación de nombres: un disco puede no distinguir mayúsculas ni formas Unicode. */
const fold = (p: string) => p.normalize('NFC').toLowerCase();
/** Los destinos nuevos de un diario (un v2 no tiene). */
const freshOf = (j: BatchJournal) => (j.v === 4 ? { fresh: j.fresh!, dirs: j.freshDirs! } : { fresh: [], dirs: [] });

/** Ejecuta `fn` en un lote de SafeVault (un diario para todo); dentro de otro lote, en ese mismo; sin SafeVault, directo. */
export function batch<T>(vault: VaultAdapter, fn: (tx: VaultAdapter) => Promise<T>, opts?: BatchOptions): Promise<T> {
  return vault instanceof SafeVault ? vault.batch(fn, opts) : fn(vault);
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
    const tmp = newTmp();
    await this.raw.write(tmp, bytes);
    const j: JournalEntry = { ...entry, tmp, size: bytes.length, hash: checksum(bytes), ts: Date.now() };
    await this.raw.write(JOURNAL_PATH, JSON.stringify({ v: 1, entries: [j] }));
    if (perf.on) perf.inc('journal'); // solo con ?perf (Prompt 21)
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
      const tmp = newTmp();
      let r: { size: number; hash: string };
      try {
        r = await this.raw.writeBlob!(tmp, blob, opts);
      } catch (e) {
        await this.raw.remove(tmp).catch(() => {});
        throw e;
      }
      const j: JournalEntry = { op: 'write', stream: true, path: p, tmp, size: r.size, hash: r.hash, ts: Date.now() };
      await this.raw.write(JOURNAL_PATH, JSON.stringify({ v: 1, entries: [j] }));
      if (perf.on) perf.inc('journal');
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
  queued() {
    return this.raw.queued?.() ?? 0;
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

  /**
   * Lote (Prompt 21 · 3a): `fn` recibe una vista que acumula escrituras, movimientos y borrados (sus
   * lecturas ya ven el resultado) y al terminar se confirma TODO con un solo diario: temporales →
   * diario → renombrar temporales a su destino → renombrar movidos → borrar → quitar el diario.
   * Destinos que no existían (Prompt 21-B, diario v4): sin temporal; se escriben directo DESPUÉS del diario
   * y ANTES de renombrar nada, con `create` (si algo apareció ahí, se revierte el lote sin pisarlo).
   * Si `fn` lanza no se escribe nada. Recuperación: ver `replayBatch`.
   */
  async batch<T>(fn: (tx: Batch) => Promise<T>, opts: BatchOptions = {}): Promise<T> {
    const tx = new Batch(this.raw);
    const r = await fn(tx);
    if (opts.signal?.aborted) throw aborted();
    if (tx.size) await this.serial(() => this.commitBatch(tx, opts));
    return r;
  }

  private async commitBatch(tx: Batch, opts: BatchOptions = {}) {
    const writes: BatchJournal['writes'] = [];
    const moves: BatchJournal['moves'] = [];
    const removes: string[] = [];
    const from = new Set<string>();
    for (const [p, s] of tx.st) {
      if (s.k !== 'moved') continue;
      from.add(s.src);
      // solo cambian mayúsculas: en un disco sin distinción, renombrar directo borraría el origen
      moves.push(s.src.toLowerCase() === p.toLowerCase() ? { from: s.src, to: p, via: newTmp() } : { from: s.src, to: p });
    }
    for (const [p, s] of tx.st) if (s.k === 'gone' && !from.has(p)) removes.push(p);
    const plan = await this.planFresh(tx);
    let n = 0;
    const total = [...tx.st.values()].filter((s) => s.k === 'data').length + moves.length;
    try {
      for (const [p, s] of tx.st) {
        if (s.k !== 'data' || plan.paths.has(p)) continue;
        if (opts.signal?.aborted) throw aborted(); // aún sin diario: se borran los temporales y no cambia nada
        opts.onProgress?.(n++, total);
        const w = { path: p, tmp: newTmp(), size: 0, hash: '' };
        writes.push(w);
        if (s.data instanceof Uint8Array) {
          await this.raw.write(w.tmp, s.data);
          Object.assign(w, { size: s.data.length, hash: checksum(s.data) });
        } else if (this.raw.writeBlob) Object.assign(w, await this.raw.writeBlob(w.tmp, s.data));
        else {
          const b = new Uint8Array(await s.data.arrayBuffer());
          await this.raw.write(w.tmp, b);
          Object.assign(w, { size: b.length, hash: checksum(b) });
        }
      }
    } catch (e) {
      for (const w of writes) await this.raw.remove(w.tmp).catch(() => {}); // sin diario: el destino no se tocó
      throw e;
    }
    const fresh = [...plan.paths].map((path) => {
      const data = (tx.st.get(path) as { data: Uint8Array }).data;
      return { path, size: data.length, hash: checksum(data), data };
    });
    const j: BatchJournal = { v: 2, ts: Date.now(), writes, moves, removes, dirs: [...tx.dirsGone] };
    if (fresh.length) Object.assign(j, { v: 4, fresh: fresh.map(({ data: _, ...f }) => f), freshDirs: plan.dirs });
    await this.raw.write(JOURNAL_PATH, JSON.stringify(j));
    if (perf.on) perf.inc('journal');
    // destinos nuevos: directo, sin temporal. Un fallo, Cancelar o un destino que apareció → se revierte todo
    if (fresh.length) {
      try {
        for (const f of fresh) {
          if (opts.signal?.aborted) throw aborted();
          opts.onProgress?.(n++, total);
          if (!(await this.createNew(f.path, f.data))) throw new VaultError(`Apareció un archivo mientras se escribía: ${f.path}. No se cambió nada.`, 'io', f.path);
        }
      } catch (e) {
        try {
          await this.undoFresh(j);
          await this.raw.remove(JOURNAL_PATH);
          for (const w of writes) await this.raw.remove(w.tmp).catch(() => {});
        } catch {
          this.stuck = true; // el diario sigue: la recuperación termina de revertir
        }
        throw e;
      }
    }
    let again = false;
    await this.apply(async () => {
      const check = again; // el reintento comprueba qué quedó hecho (cada paso es idempotente)
      again = true;
      await this.applyBatch(j, check);
    });
    await this.raw.remove(JOURNAL_PATH);
    opts.onProgress?.(total, total);
  }

  /** Escribe solo si no hay nada en `p` (con `create` del backend; si no, comprobando antes). */
  private async createNew(p: string, data: Uint8Array): Promise<boolean> {
    if (this.raw.create) return this.raw.create(p, data);
    if (await this.raw.exists(p)) return false;
    await this.raw.write(p, data);
    return true;
  }

  /**
   * Qué escrituras del lote van directo a su destino: datos en memoria (un Blob grande sigue por temporal),
   * sin otra ruta del lote que solo difiera en mayúsculas, y cuyo nombre no está en su carpeta (comparando
   * sin mayúsculas ni forma Unicode) o cuya carpeta no existe. Una consulta por carpeta, no por archivo.
   * `dirs`: carpetas que no existen (se quitan al revertir si quedan vacías).
   */
  private async planFresh(tx: Batch): Promise<{ paths: Set<string>; dirs: string[] }> {
    const paths = new Set<string>();
    const count = new Map<string, number>();
    for (const p of tx.st.keys()) count.set(fold(p), (count.get(fold(p)) ?? 0) + 1);
    const byDir = new Map<string, string[]>();
    for (const [p, s] of tx.st) {
      if (s.k !== 'data' || !(s.data instanceof Uint8Array) || count.get(fold(p)) !== 1) continue;
      const d = parentOf(p);
      byDir.set(d, [...(byDir.get(d) ?? []), p]);
    }
    const known = new Map<string, 'dir' | 'none' | 'file'>([['', 'dir']]);
    const kind = async (d: string): Promise<'dir' | 'none' | 'file'> => {
      let k = known.get(d);
      if (k) return k;
      const up = await kind(parentOf(d));
      if (up !== 'dir') k = up;
      else {
        const st = await this.raw.stat(d);
        k = !st ? 'none' : st.kind === 'dir' ? 'dir' : 'file';
      }
      known.set(d, k);
      return k;
    };
    for (const [d, ps] of byDir) {
      const k = await kind(d);
      if (k === 'file') continue; // escribir ahí fallará igual que antes, por temporal
      const names = k === 'dir' ? new Set((await this.raw.list(d)).map((e) => fold(e.name))) : null;
      for (const p of ps) if (!names?.has(fold(p.slice(d ? d.length + 1 : 0)))) paths.add(p);
    }
    return { paths, dirs: [...known].filter(([, k]) => k === 'none').map(([d]) => d) };
  }

  /**
   * Revertir los destinos nuevos de un lote no confirmado. Se borra un destino listado solo si es el
   * nuestro (misma suma) o quedó vacío (se creó y no llegó a escribirse); cualquier otro contenido llegó
   * de fuera y se conserva. Las carpetas nuevas se quitan solo si quedaron sin archivos.
   */
  private async undoFresh(j: BatchJournal) {
    const { fresh, dirs } = freshOf(j);
    for (const f of fresh) {
      const st = await this.raw.stat(f.path);
      if (st?.kind !== 'file') continue;
      if (st.size === 0 || (st.size === f.size && (await this.sum(f.path)).hash === f.hash)) await this.raw.remove(f.path);
    }
    for (const d of [...dirs].sort((a, b) => b.split('/').length - a.split('/').length)) if (!(await walk(this.raw, d)).length) await this.raw.remove(d);
  }

  /** Aplica un lote. Con `check`, salta lo que ya está hecho (reintento o recuperación). */
  private async applyBatch(j: BatchJournal, check: boolean, skip?: Set<string>) {
    const has = (p: string) => (check ? this.raw.exists(p) : Promise.resolve(true));
    for (const w of j.writes) if (!skip?.has(w.tmp) && (await has(w.tmp))) await this.raw.move(w.tmp, w.path);
    for (const m of j.moves) {
      if (m.via) {
        if (await has(m.from)) await this.raw.move(m.from, m.via);
        if (await has(m.via)) await this.raw.move(m.via, m.to);
      } else if (await has(m.from)) await this.raw.move(m.from, m.to);
    }
    for (const p of j.removes) await this.raw.remove(p);
    // una carpeta solo se quita si quedó sin archivos (nunca se borra un archivo por estar dentro)
    for (const d of j.dirs) if (!(await walk(this.raw, d)).length) await this.raw.remove(d);
  }

  /**
   * Recuperación de un lote. El diario solo existe si TODOS los temporales se escribieron, así que:
   *   - cada escritura tiene su temporal íntegro o ya está en su destino (misma suma) → se COMPLETA el lote;
   *   - si alguna no se puede completar y nada se aplicó aún → se REVIERTE (se descarta: ningún destino
   *     se tocó, los temporales se borran);
   *   - si ya se aplicó algo (solo con el disco dañado) → se completa lo posible y se reporta lo perdido.
   * v4: los destinos nuevos se escriben antes de aplicar nada; si a alguno le falta su contenido y nada se
   * aplicó → se REVIERTE y se borran (`undoFresh`: solo los nuestros o vacíos; nunca existieron).
   * Si se aplicó algo, ya estaban todos → se completa.
   * Nunca queda a medias por la recuperación misma: cada paso es idempotente y el diario no se borra
   * hasta terminar (un fallo de E/S lo conserva para reintentar).
   */
  private async replayBatch(j: Partial<BatchJournal>, report: RecoveryReport) {
    const all = (b: BatchJournal) => [...freshOf(b).fresh.map((f) => f.path), ...b.writes.map((w) => w.path), ...b.moves.map((m) => m.to)];
    if (!validBatch(j)) return void report.discarded.push('?');
    for (const m of j.moves) if ((await this.raw.stat(m.from))?.kind === 'dir') return void report.discarded.push(...all(j)); // nunca mover carpetas desde el diario
    const bad = new Set<string>();
    let touched = false;
    for (const w of j.writes) {
      const at = (await this.raw.exists(w.tmp)) ? w.tmp : null;
      if (!at) touched = true;
      const p = at ?? ((await this.raw.exists(w.path)) ? w.path : null);
      const s = p ? await this.sum(p) : null;
      if (!s || s.size !== w.size || s.hash !== w.hash) bad.add(w.tmp);
    }
    for (const m of j.moves) if (!(await this.raw.exists(m.from)) && !(m.via && (await this.raw.exists(m.via)))) touched = true;
    // v4: los destinos nuevos se escriben antes de aplicar nada, así que si se aplicó algo ya estaban todos
    const missing = new Set<string>();
    for (const f of freshOf(j).fresh) {
      const s = (await this.raw.exists(f.path)) ? await this.sum(f.path) : null;
      if (!s || s.size !== f.size || s.hash !== f.hash) missing.add(f.path);
    }
    if ((bad.size || missing.size) && !touched) {
      await this.undoFresh(j);
      return void report.discarded.push(...all(j));
    }
    await this.applyBatch(j, true, bad);
    for (const f of freshOf(j).fresh) (missing.has(f.path) ? report.discarded : report.recovered).push(f.path);
    for (const w of j.writes) (bad.has(w.tmp) ? report.discarded : report.recovered).push(w.path);
    report.recovered.push(...j.moves.map((m) => m.to));
  }

  /**
   * Añade bytes al final de un archivo sin leerlo ni reescribirlo (Prompt 21 · 4, cuello #6: cada respuesta
   * de estudio reescribía `reviews.jsonl` entero, 16.5 MB al Worker). Diario v3 con los datos → `appendAt`
   * (trunca en `at` y escribe: repetirlo da lo mismo) → quitar el diario. Si el backend no sabe añadir,
   * se lee y se reescribe entero con `commit`, como antes. Devuelve dónde empezó y los bytes que quedaron
   * escritos (con el «\n» separador si se añadió): así quien lleva una suma del archivo la continúa.
   */
  append(path: string, data: Uint8Array): Promise<{ at: number; written: Uint8Array }> {
    const p = normalizePath(path);
    const withSep = (add: boolean) => (add ? Uint8Array.of(10, ...data) : data);
    return this.serial(async () => {
      const st = await this.raw.stat(p);
      if (st?.kind === 'dir') throw new VaultError(`Es una carpeta: ${path}`, 'io', path);
      const at = st?.size ?? 0;
      if (!this.raw.appendAt) {
        const prev = st ? await this.raw.read(p) : new Uint8Array();
        const add = prev.length > 0 && prev[prev.length - 1] !== 10;
        const out = new Uint8Array(prev.length + (add ? 1 : 0) + data.length);
        out.set(prev);
        out.set(withSep(add), prev.length);
        await this.commit({ op: 'write', path: p }, out, () => this.raw.write(p, out));
        return { at, written: withSep(add) };
      }
      const j: AppendJournal = { v: 3, ts: Date.now(), append: { path: p, at, size: data.length, hash: checksum(data), data: decodeText(data) } };
      await this.raw.write(JOURNAL_PATH, JSON.stringify(j));
      if (perf.on) perf.inc('journal');
      let add = false;
      await this.apply(async () => void (add = await this.raw.appendAt!(p, data, at, true)));
      await this.raw.remove(JOURNAL_PATH);
      return { at, written: withSep(add) };
    });
  }

  /** Recuperar un añadido: si el diario es íntegro y el archivo llega al menos a `at`, se repite (idempotente). */
  private async replayAppend(j: Partial<AppendJournal>, report: RecoveryReport) {
    const a = j.append;
    const path = safeTarget(a?.path);
    if (!a || !path || !Number.isInteger(a.at) || a.at < 0 || typeof a.data !== 'string') return void report.discarded.push('?');
    const bytes = toBytes(a.data);
    const size = (await this.raw.stat(path))?.size ?? 0;
    // datos que no casan con su suma, o un archivo más corto que donde empezaba el añadido: no se toca
    if (bytes.length !== a.size || checksum(bytes) !== a.hash || size < a.at || !this.raw.appendAt) return void report.discarded.push(path);
    await this.raw.appendAt(path, bytes, a.at, true);
    report.recovered.push(path);
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
  /** Lectura en lote (solo lectura: sin diario); si el backend no la tiene, una por una. */
  readMany(paths: string[]): Promise<Uint8Array[]> {
    return this.raw.readMany ? this.raw.readMany(paths) : Promise.all(paths.map((p) => this.raw.read(p)));
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
      const j = JSON.parse(decodeText(await this.raw.read(JOURNAL_PATH))) as { v?: number; entries?: JournalEntry[] };
      if (j?.v === 2 || j?.v === 3 || j?.v === 4) {
        try {
          if (j.v !== 3) await this.replayBatch(j as Partial<BatchJournal>, report);
          else await this.replayAppend(j as Partial<AppendJournal>, report);
        } catch {
          this.stuck = true; // E/S: el diario se conserva y se reintenta
        }
      } else entries = Array.isArray(j.entries) ? j.entries : []; // v1: una entrada por escritura
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
