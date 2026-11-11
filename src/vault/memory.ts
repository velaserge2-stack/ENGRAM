import { basename, normalizePath } from './paths';
import { type FileStat, type VaultAdapter, VaultError } from './types';
import { toBytes } from './util';

/** Backend en memoria: pruebas y "modo temporal" cuando OPFS no está disponible. */
export class MemoryBackend implements VaultAdapter {
  readonly kind = 'memory' as const;
  private files = new Map<string, { data: Uint8Array; mtime: number }>();
  private dirs = new Set<string>();

  async list(path: string): Promise<FileStat[]> {
    const dir = normalizePath(path);
    const prefix = dir ? dir + '/' : '';
    const seen = new Map<string, FileStat>();
    for (const [p, f] of this.files) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      const i = rest.indexOf('/');
      const name = i < 0 ? rest : rest.slice(0, i);
      const child = prefix + name;
      if (seen.has(child)) continue;
      seen.set(
        child,
        i < 0
          ? { path: child, name, kind: 'file', size: f.data.length, mtime: f.mtime }
          : { path: child, name, kind: 'dir', size: 0, mtime: 0 },
      );
    }
    for (const d of this.dirs) {
      if (d.startsWith(prefix) && d !== dir && !d.slice(prefix.length).includes('/') && !seen.has(d)) {
        seen.set(d, { path: d, name: basename(d), kind: 'dir', size: 0, mtime: 0 });
      }
    }
    return [...seen.values()];
  }

  async read(path: string): Promise<Uint8Array> {
    const f = this.files.get(normalizePath(path));
    if (!f) throw new VaultError(`No existe: ${path}`, 'not-found', path);
    return f.data.slice();
  }

  async write(path: string, data: Uint8Array | string): Promise<void> {
    const p = normalizePath(path);
    if (!p) throw new VaultError('Ruta vacía', 'invalid-path');
    this.files.set(p, { data: toBytes(data).slice(), mtime: Date.now() });
  }

  async remove(path: string): Promise<void> {
    const p = normalizePath(path);
    this.files.delete(p);
    for (const k of [...this.files.keys()]) if (k.startsWith(p + '/') || p === '') this.files.delete(k);
    for (const d of [...this.dirs]) if (d === p || d.startsWith(p + '/') || p === '') this.dirs.delete(d);
  }

  async move(from: string, to: string): Promise<void> {
    const a = normalizePath(from);
    const b = normalizePath(to);
    const f = this.files.get(a);
    if (f) {
      this.files.set(b, f);
      this.files.delete(a);
      return;
    }
    let moved = false;
    for (const [k, v] of [...this.files]) {
      if (k.startsWith(a + '/')) {
        this.files.set(b + k.slice(a.length), v);
        this.files.delete(k);
        moved = true;
      }
    }
    if (!moved) throw new VaultError(`No existe: ${from}`, 'not-found', from);
  }

  async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) !== null;
  }

  async stat(path: string): Promise<FileStat | null> {
    const p = normalizePath(path);
    if (p === '') return { path: '', name: '', kind: 'dir', size: 0, mtime: 0 };
    const f = this.files.get(p);
    if (f) return { path: p, name: basename(p), kind: 'file', size: f.data.length, mtime: f.mtime };
    if (this.dirs.has(p)) return { path: p, name: basename(p), kind: 'dir', size: 0, mtime: 0 };
    for (const k of this.files.keys()) if (k.startsWith(p + '/')) return { path: p, name: basename(p), kind: 'dir', size: 0, mtime: 0 };
    return null;
  }
}
