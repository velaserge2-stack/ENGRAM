/**
 * Operaciones de archivos sobre un FileSystemDirectoryHandle. Las comparten
 * OPFS (dentro del Worker) y File System Access (carpeta real en Chrome/Edge).
 * Solo cambia cómo se escribe un archivo (`writeFile`).
 */
import { basename, splitPath } from './paths';
import { type FileStat, VaultError } from './types';
import { CHUNK, FNV_INIT, fnvHex, fnvUpdate } from './util';

interface SyncAccess { truncate(size: number): unknown; write(buf: Uint8Array, opts: { at: number }): unknown; flush(): unknown; close(): unknown }

export type WriteStrategy = (fh: FileSystemFileHandle, data: Uint8Array) => Promise<void>;

/**
 * Codificación de nombres para OPFS. Chromium rechaza (TypeMismatchError) nombres
 * de ARCHIVO con caracteres no ASCII ("Cardiología.md"). OPFS es privado y el
 * usuario nunca ve estos nombres, así que se codifican de forma reversible:
 * ASCII seguro sin "%" se guarda tal cual; lo demás con encodeURIComponent.
 * Biyectiva: todo nombre guardado que contiene "%" es un nombre codificado.
 */
export interface NameCodec {
  enc(name: string): string;
  dec(stored: string): string;
}

const identityCodec: NameCodec = { enc: (n) => n, dec: (n) => n };

export const asciiCodec: NameCodec = {
  enc: (n) => (/^[A-Za-z0-9 ._()\-]+$/.test(n) ? n : encodeURIComponent(n)),
  dec: (n) => {
    if (!n.includes('%')) return n;
    try {
      return decodeURIComponent(n);
    } catch {
      return n;
    }
  },
};

type DirHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
};

function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');
}

export class HandleFS {
  constructor(
    private root: FileSystemDirectoryHandle,
    private writeFile: WriteStrategy,
    private codec: NameCodec = identityCodec,
  ) {}

  private async dir(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let d = this.root;
    for (const p of parts) d = await d.getDirectoryHandle(this.codec.enc(p), { create });
    return d;
  }

  private async resolve(path: string): Promise<FileSystemHandle | null> {
    const parts = splitPath(path);
    if (parts.length === 0) return this.root;
    try {
      const parent = await this.dir(parts.slice(0, -1), false);
      const name = this.codec.enc(parts[parts.length - 1]!);
      try {
        return await parent.getFileHandle(name);
      } catch (e) {
        if (!isNotFound(e)) throw e;
        return await parent.getDirectoryHandle(name);
      }
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async list(path: string): Promise<FileStat[]> {
    const h = await this.resolve(path);
    if (!h || h.kind !== 'directory') return [];
    const prefix = splitPath(path).join('/');
    const out: FileStat[] = [];
    for await (const [stored, child] of (h as DirHandle).entries()) {
      const name = this.codec.dec(stored);
      const p = prefix ? `${prefix}/${name}` : name;
      if (child.kind === 'file') {
        const f = await (child as FileSystemFileHandle).getFile();
        out.push({ path: p, name, kind: 'file', size: f.size, mtime: f.lastModified });
      } else {
        out.push({ path: p, name, kind: 'dir', size: 0, mtime: 0 });
      }
    }
    return out;
  }

  async read(path: string): Promise<Uint8Array> {
    const h = await this.resolve(path);
    if (!h || h.kind !== 'file') throw new VaultError(`No existe: ${path}`, 'not-found', path);
    const f = await (h as FileSystemFileHandle).getFile();
    return new Uint8Array(await f.arrayBuffer());
  }

  async write(path: string, data: Uint8Array): Promise<void> {
    const parts = splitPath(path);
    if (!parts.length) throw new VaultError('Ruta vacía', 'invalid-path');
    const parent = await this.dir(parts.slice(0, -1), true);
    const fh = await parent.getFileHandle(this.codec.enc(parts[parts.length - 1]!), { create: true });
    await this.writeFile(fh, data);
  }

  async remove(path: string): Promise<void> {
    const parts = splitPath(path);
    if (!parts.length) {
      for (const e of await this.list('')) await this.remove(e.path);
      return;
    }
    try {
      const parent = await this.dir(parts.slice(0, -1), false);
      await parent.removeEntry(this.codec.enc(parts[parts.length - 1]!), { recursive: true });
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }

  /** El archivo como File (las lecturas por rango usan `slice`). */
  async file(path: string): Promise<File> {
    const h = await this.resolve(path);
    if (!h || h.kind !== 'file') throw new VaultError(`No existe: ${path}`, 'not-found', path);
    return (h as FileSystemFileHandle).getFile();
  }

  /**
   * Escribe un Blob por trozos (Prompt 11): nunca hay más de un trozo en memoria; suma FNV-1a
   * incremental. Con sync access handle (Worker de OPFS) escribe por desplazamiento; si no,
   * con un writable. `cancelled()` se consulta entre trozos.
   */
  async writeBlob(path: string, blob: Blob, onChunk?: (written: number) => void, cancelled?: () => boolean): Promise<{ size: number; hash: string }> {
    const parts = splitPath(path);
    if (!parts.length) throw new VaultError('Ruta vacía', 'invalid-path');
    const parent = await this.dir(parts.slice(0, -1), true);
    const fh = await parent.getFileHandle(this.codec.enc(parts[parts.length - 1]!), { create: true });
    let h = FNV_INIT, at = 0;
    const next = async () => {
      if (cancelled?.()) throw new DOMException('Cancelado', 'AbortError');
      const b = new Uint8Array(await blob.slice(at, at + CHUNK).arrayBuffer());
      h = fnvUpdate(h, b);
      return b;
    };
    if ('createSyncAccessHandle' in fh) {
      const sh = await (fh as unknown as { createSyncAccessHandle(): Promise<SyncAccess> }).createSyncAccessHandle();
      try {
        await sh.truncate(0);
        while (at < blob.size) {
          const b = await next();
          for (let off = 0; off < b.length;) {
            const n = Number(await sh.write(b.subarray(off), { at: at + off }));
            if (!(n > 0)) throw new Error('Escritura incompleta');
            off += n;
          }
          at += b.length;
          onChunk?.(at);
        }
        await sh.flush();
      } finally {
        await sh.close();
      }
    } else {
      const w = await (fh as FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
      try {
        while (at < blob.size) {
          const b = await next();
          await w.write(b as unknown as BufferSource);
          at += b.length;
          onChunk?.(at);
        }
        await w.close();
      } catch (e) {
        await (w as unknown as { abort?: () => Promise<void> }).abort?.().catch(() => {});
        throw e;
      }
    }
    return { size: at, hash: fnvHex(h) };
  }

  /** Suma y tamaño leyendo por trozos (verificar un temporal sin cargarlo entero). */
  async hash(path: string): Promise<{ size: number; hash: string }> {
    const f = await this.file(path);
    let h = FNV_INIT;
    for (let at = 0; at < f.size; at += CHUNK) h = fnvUpdate(h, new Uint8Array(await f.slice(at, at + CHUNK).arrayBuffer()));
    return { size: f.size, hash: fnvHex(h) };
  }

  /**
   * Mover. Archivo: `move()` nativo si existe (renombrar sin copiar); si falla o no existe,
   * copia por trozos y borra. Nunca carga el archivo entero. Directorio: recursivo.
   */
  async move(from: string, to: string): Promise<void> {
    const h = await this.resolve(from);
    if (!h) throw new VaultError(`No existe: ${from}`, 'not-found', from);
    if (h.kind === 'file') {
      const parts = splitPath(to);
      const fh = h as FileSystemFileHandle & { move?: (dir: FileSystemDirectoryHandle, name: string) => Promise<void> };
      if (typeof fh.move === 'function') {
        try {
          await this.remove(to);
          await fh.move(await this.dir(parts.slice(0, -1), true), this.codec.enc(parts[parts.length - 1]!));
          if ((await this.resolve(to)) && !(await this.resolve(from))) return;
        } catch { /* sin move fiable: se copia */ }
      }
      await this.writeBlob(to, await (h as FileSystemFileHandle).getFile());
    } else {
      for (const e of await this.list(from)) await this.move(e.path, `${splitPath(to).join('/')}/${e.name}`);
    }
    await this.remove(from);
  }

  async stat(path: string): Promise<FileStat | null> {
    const h = await this.resolve(path);
    if (!h) return null;
    const p = splitPath(path).join('/');
    if (h.kind === 'file') {
      const f = await (h as FileSystemFileHandle).getFile();
      return { path: p, name: basename(p), kind: 'file', size: f.size, mtime: f.lastModified };
    }
    return { path: p, name: p ? basename(p) : '', kind: 'dir', size: 0, mtime: 0 };
  }
}

/** Escritura con FileSystemWritableFileStream (Chrome, y Safari 26 en hilo principal). */
export const writeWithWritable: WriteStrategy = async (fh, data) => {
  const w = await (fh as FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
  await w.write(data as unknown as BufferSource);
  await w.close();
};
