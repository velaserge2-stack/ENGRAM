/**
 * Operaciones de archivos sobre un FileSystemDirectoryHandle. Las comparten
 * OPFS (dentro del Worker) y File System Access (carpeta real en Chrome/Edge).
 * Solo cambia cómo se escribe un archivo (`writeFile`).
 */
import { basename, splitPath } from './paths';
import { type FileStat, VaultError } from './types';

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

export const identityCodec: NameCodec = { enc: (n) => n, dec: (n) => n };

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

  /** Copiar y borrar: `FileSystemHandle.move()` no es fiable en todos los Safari. */
  async move(from: string, to: string): Promise<void> {
    const h = await this.resolve(from);
    if (!h) throw new VaultError(`No existe: ${from}`, 'not-found', from);
    if (h.kind === 'file') {
      await this.write(to, await this.read(from));
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
