/**
 * Lote de escrituras (Prompt 21 · 3a). Vista de la bóveda que ACUMULA escrituras, movimientos y
 * borrados en memoria y responde las lecturas como si ya se hubieran hecho (read/list/stat/exists
 * ven el estado final). `SafeVault.batch` lo confirma después con UN diario para todo el lote.
 *
 * Se guarda solo el estado final por ruta: datos nuevos, «el contenido de `src` en disco»
 * (movimiento por renombrado, sin copiar) o borrado. Invariante: el `src` de un movimiento queda
 * borrado al final del lote; si algo vuelve a escribir en `src`, antes se copia su contenido a
 * memoria (así ningún origen de un renombrado es también destino y la recuperación no es ambigua).
 */
import { basename, normalizePath } from './paths';
import { type FileStat, type VaultAdapter, VaultError } from './types';
import { checksum, toBytes, walk } from './util';

export type Staged =
  | { k: 'data'; data: Uint8Array | Blob }
  | { k: 'moved'; src: string; size: number; mtime: number }
  | { k: 'gone' };

const notFound = (p: string) => new VaultError(`No existe: ${p}`, 'not-found', p);
const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

export class Batch implements VaultAdapter {
  readonly kind: VaultAdapter['kind'];
  readonly st = new Map<string, Staged>();
  /** Carpetas borradas: se quitan al final solo si quedan sin archivos. */
  readonly dirsGone = new Set<string>();
  private movedCount = 0;

  constructor(readonly raw: VaultAdapter) {
    this.kind = raw.kind;
  }

  get size() {
    return this.st.size + this.dirsGone.size;
  }

  /** ¿La ruta queda dentro de una carpeta borrada en el lote? (lo que hay en disco no cuenta) */
  private hidden(p: string): boolean {
    if (!this.dirsGone.size) return false;
    for (let q = p; q; q = parentOf(q)) if (this.dirsGone.has(q)) return true;
    return false;
  }
  private live(s: Staged | undefined): boolean {
    return !!s && s.k !== 'gone';
  }
  /** ¿Hay algún archivo vivo del lote bajo `dir`? */
  private liveUnder(dir: string): boolean {
    const pre = dir ? dir + '/' : '';
    for (const [p, s] of this.st) if (s.k !== 'gone' && p.startsWith(pre)) return true;
    return false;
  }

  private async put(p: string, s: Staged) {
    // quien renombraba desde `p` se queda con una copia en memoria (ver invariante)
    if (this.movedCount && s.k !== 'gone') {
      for (const [q, e] of this.st) {
        if (e.k === 'moved' && e.src === p && q !== p) (this.st.set(q, { k: 'data', data: await this.raw.read(e.src) }), this.movedCount--);
      }
    }
    const prev = this.st.get(p);
    if (prev?.k === 'moved') this.movedCount--;
    if (s.k === 'moved') this.movedCount++;
    this.st.set(p, s);
    if (s.k !== 'gone') this.unhide(p);
  }
  private unhide(p: string) {
    if (this.dirsGone.size) for (let q = parentOf(p); q; q = parentOf(q)) this.dirsGone.delete(q);
  }

  async read(path: string): Promise<Uint8Array> {
    const p = normalizePath(path);
    const s = this.st.get(p);
    if (s?.k === 'data') return s.data instanceof Uint8Array ? s.data.slice() : new Uint8Array(await s.data.arrayBuffer());
    if (s?.k === 'moved') return this.raw.read(s.src);
    if (s?.k === 'gone' || this.hidden(p)) throw notFound(p);
    return this.raw.read(p);
  }

  async stat(path: string): Promise<FileStat | null> {
    const p = normalizePath(path);
    const s = this.st.get(p);
    const file = (size: number, mtime: number): FileStat => ({ path: p, name: basename(p), kind: 'file', size, mtime });
    const dir = (): FileStat => ({ path: p, name: p ? basename(p) : '', kind: 'dir', size: 0, mtime: 0 });
    if (s?.k === 'data') return file(s.data instanceof Uint8Array ? s.data.length : s.data.size, Date.now());
    if (s?.k === 'moved') return file(s.size, s.mtime);
    if (s?.k !== 'gone' && !this.hidden(p)) {
      const r = await this.raw.stat(p);
      if (r) return r.kind === 'dir' ? dir() : r;
    }
    return this.liveUnder(p) ? dir() : null;
  }

  async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) !== null;
  }

  async list(path: string): Promise<FileStat[]> {
    const d = normalizePath(path);
    const pre = d ? d + '/' : '';
    const out = new Map<string, FileStat>();
    if (!this.hidden(d)) {
      for (const e of await this.raw.list(d)) {
        if (e.kind === 'dir') {
          if (!this.hidden(e.path)) out.set(e.path, e);
        } else if (!this.st.has(e.path)) out.set(e.path, e);
      }
    }
    for (const [p, s] of this.st) {
      if (s.k === 'gone' || !p.startsWith(pre)) continue;
      const rest = p.slice(pre.length);
      const i = rest.indexOf('/');
      if (i < 0) out.set(p, (await this.stat(p))!);
      else {
        const c = pre + rest.slice(0, i);
        if (!out.has(c)) out.set(c, { path: c, name: rest.slice(0, i), kind: 'dir', size: 0, mtime: 0 });
      }
    }
    return [...out.values()];
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    const p = normalizePath(path);
    if (!p) throw new VaultError('Ruta vacía', 'invalid-path');
    await this.put(p, { k: 'data', data: toBytes(data) });
  }

  /** Archivo grande: el Blob se escribe por trozos al confirmar (como `SafeVault.writeStream`). */
  async writeStream(path: string, blob: Blob): Promise<void> {
    const p = normalizePath(path);
    if (!p) throw new VaultError('Ruta vacía', 'invalid-path');
    await this.put(p, { k: 'data', data: blob });
  }

  async move(from: string, to: string): Promise<void> {
    const a = normalizePath(from);
    const b = normalizePath(to);
    if (a === b) return; // como SafeVault.move
    const s = this.st.get(a);
    if (s?.k === 'gone') throw notFound(a);
    if (s?.k === 'data') {
      await this.put(b, s);
    } else if (s?.k === 'moved') {
      if (s.src === b) {
        // vuelve a su sitio en disco: ya no hay nada que hacer con `b`
        this.st.delete(b);
        this.unhide(b);
        this.movedCount--;
        this.st.delete(a);
        await this.put(a, { k: 'gone' });
        return;
      }
      this.movedCount--;
      this.st.delete(a);
      await this.put(b, s);
    } else {
      const r = await this.stat(a);
      if (!r) throw notFound(a);
      if (r.kind === 'dir') {
        if (b.startsWith(a + '/')) throw new VaultError(`No se puede mover dentro de sí misma: ${a}`, 'io', a);
        for (const f of await walk(this, a)) await this.move(f.path, b + f.path.slice(a.length));
        this.dirsGone.add(a);
        return;
      }
      await this.put(b, { k: 'moved', src: a, size: r.size, mtime: r.mtime });
    }
    await this.put(a, { k: 'gone' });
  }

  async remove(path: string): Promise<void> {
    const p = normalizePath(path);
    const r = await this.stat(p);
    if (!r) return;
    if (r.kind === 'file') return this.put(p, { k: 'gone' });
    for (const f of await walk(this, p)) await this.put(f.path, { k: 'gone' });
    if (p) this.dirsGone.add(p);
  }

  async hash(path: string): Promise<{ size: number; hash: string }> {
    const p = normalizePath(path);
    const s = this.st.get(p);
    if (s?.k === 'moved' && this.raw.hash) return this.raw.hash(s.src);
    if (!s && !this.hidden(p) && this.raw.hash) return this.raw.hash(p);
    const b = await this.read(p);
    return { size: b.length, hash: checksum(b) };
  }

  async file(path: string): Promise<File> {
    const p = normalizePath(path);
    const s = this.st.get(p);
    if (!s && !this.hidden(p) && this.raw.file) return this.raw.file(p);
    return new File([(await this.read(p)) as BlobPart], basename(p));
  }

  queued() {
    return this.raw.queued?.() ?? 0;
  }
}
