/**
 * Operaciones de archivos sobre un FileSystemDirectoryHandle. Las comparten
 * OPFS (dentro del Worker) y File System Access (carpeta real en Chrome/Edge).
 * Solo cambia cómo se escribe un archivo (`writeFile`).
 */
import { basename, splitPath } from './paths';
import { type FileStat, VaultError } from './types';
import { CHUNK, FNV_INIT, fnvHex, fnvUpdate } from './util';

interface SyncAccess { truncate(size: number): unknown; write(buf: Uint8Array, opts: { at: number }): unknown; read(buf: Uint8Array, opts: { at: number }): unknown; getSize(): unknown; flush(): unknown; close(): unknown }

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
  /**
   * Prompt 21 · 3a: manejadores de carpeta ya resueltos (clave = ruta). Resolver una ruta cuesta un
   * `getDirectoryHandle` por nivel en CADA operación; con la caché, casi ninguno. Solo para OPFS (privado:
   * solo la app escribe); en una carpeta del usuario otra app podría borrarla por fuera.
   * Seguridad: borrar invalida la ruta y lo de dentro; y un manejador de una carpeta que ya no existe
   * lanza NotFoundError (nunca escribe en una carpeta «fantasma»), así que ante NotFound con la caché
   * se vacía y se reintenta sin ella (también cubre lo que haga otra pestaña).
   */
  private dirs: Map<string, FileSystemDirectoryHandle> | null;

  constructor(
    private root: FileSystemDirectoryHandle,
    private writeFile: WriteStrategy,
    private codec: NameCodec = identityCodec,
    opts: { cacheDirs?: boolean } = {},
  ) {
    this.dirs = opts.cacheDirs ? new Map() : null;
  }

  private async dir(parts: string[], create: boolean, useCache = true): Promise<FileSystemDirectoryHandle> {
    const c = useCache ? this.dirs : null;
    if (!c || !parts.length) {
      let d = this.root;
      for (const p of parts) d = await d.getDirectoryHandle(this.codec.enc(p), { create });
      return d;
    }
    // el prefijo más largo ya resuelto y, desde ahí, nivel por nivel (cada nivel queda en la caché)
    let i = parts.length;
    let d: FileSystemDirectoryHandle | undefined;
    for (; i > 0; i--) if ((d = c.get(parts.slice(0, i).join('/')))) break;
    d ??= this.root;
    for (; i < parts.length; i++) {
      d = await d.getDirectoryHandle(this.codec.enc(parts[i]!), { create });
      c.set(parts.slice(0, i + 1).join('/'), d);
    }
    return d;
  }

  /** Quita de la caché `path` y todo lo que hay debajo (al borrarla o moverla). */
  private forget(path: string) {
    const c = this.dirs;
    if (!c) return;
    if (!path) return c.clear();
    for (const k of c.keys()) if (k === path || k.startsWith(path + '/')) c.delete(k);
  }

  /** Con la caché: ante NotFound (carpeta borrada o recreada por fuera) se vacía y se reintenta una vez sin ella. */
  private async fresh<T>(op: () => Promise<T>): Promise<T> {
    if (!this.dirs?.size) return op();
    try {
      return await op();
    } catch (e) {
      if (!isNotFound(e)) throw e;
      this.dirs.clear();
      return op();
    }
  }

  private async resolve(path: string): Promise<FileSystemHandle | null> {
    const r = await this.resolveOnce(path, true);
    // con la caché, «no existe» puede venir de un manejador viejo (otra pestaña borró la carpeta): se
    // confirma sin ella; solo si así sí aparece, la caché estaba vieja y se vacía
    if (r || !this.dirs?.size) return r;
    const again = await this.resolveOnce(path, false);
    if (again) this.dirs.clear();
    return again;
  }

  private async resolveOnce(path: string, useCache: boolean): Promise<FileSystemHandle | null> {
    const parts = splitPath(path);
    if (parts.length === 0) return this.root;
    try {
      const parent = await this.dir(parts.slice(0, -1), false, useCache);
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

  async list(path: string, onEntry?: () => void): Promise<FileStat[]> {
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
      onEntry?.();
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
    const fh = await this.fresh(async () => (await this.dir(parts.slice(0, -1), true)).getFileHandle(this.codec.enc(parts[parts.length - 1]!), { create: true }));
    await this.writeFile(fh, data);
  }

  async remove(path: string): Promise<void> {
    const parts = splitPath(path);
    if (!parts.length) {
      for (const e of await this.list('')) await this.remove(e.path);
      return this.forget('');
    }
    this.forget(parts.join('/'));
    const name = this.codec.enc(parts[parts.length - 1]!);
    const rm = async (useCache: boolean) => (await this.dir(parts.slice(0, -1), false, useCache)).removeEntry(name, { recursive: true });
    try {
      await rm(true);
    } catch (e) {
      if (!isNotFound(e)) throw e;
      // «no existe» es lo normal al borrar algo que no está; solo si sin la caché sí se borra, estaba vieja
      if (!this.dirs?.size) return;
      try {
        await rm(false);
        this.dirs.clear();
      } catch (e2) {
        if (!isNotFound(e2)) throw e2;
      }
    }
  }

  /** Ver `VaultAdapter.appendAt`: sin leer ni reescribir lo que ya hay. */
  async appendAt(path: string, data: Uint8Array, at: number, sep = false): Promise<boolean> {
    const parts = splitPath(path);
    if (!parts.length) throw new VaultError('Ruta vacía', 'invalid-path');
    const fh = await this.fresh(async () => (await this.dir(parts.slice(0, -1), true)).getFileHandle(this.codec.enc(parts[parts.length - 1]!), { create: true }));
    const out = (add: boolean) => {
      if (!add) return data;
      const b = new Uint8Array(data.length + 1);
      b[0] = 10;
      b.set(data, 1);
      return b;
    };
    if ('createSyncAccessHandle' in fh) {
      const sh = await (fh as unknown as { createSyncAccessHandle(): Promise<SyncAccess> }).createSyncAccessHandle();
      try {
        if (at > Number(await sh.getSize())) throw new VaultError(`Desplazamiento fuera del archivo: ${path}`, 'io', path);
        let add = false;
        if (sep && at > 0) {
          const last = new Uint8Array(1);
          await sh.read(last, { at: at - 1 });
          add = last[0] !== 10;
        }
        await sh.truncate(at);
        const b = out(add);
        for (let off = 0; off < b.length;) {
          const n = Number(await sh.write(b.subarray(off), { at: at + off }));
          if (!(n > 0)) throw new Error('Escritura incompleta');
          off += n;
        }
        await sh.flush();
        return add;
      } finally {
        await sh.close();
      }
    }
    const f = await (fh as FileSystemFileHandle).getFile();
    if (at > f.size) throw new VaultError(`Desplazamiento fuera del archivo: ${path}`, 'io', path);
    const add = sep && at > 0 && new Uint8Array(await f.slice(at - 1, at).arrayBuffer())[0] !== 10;
    const w = await (fh as FileSystemFileHandle & { createWritable(o: { keepExistingData: boolean }): Promise<FileSystemWritableFileStream> }).createWritable({ keepExistingData: true });
    try {
      await w.truncate(at);
      await w.write({ type: 'write', position: at, data: out(add) as unknown as BufferSource });
      await w.close();
    } catch (e) {
      await (w as unknown as { abort?: () => Promise<void> }).abort?.().catch(() => {});
      throw e;
    }
    return add;
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
    const fh = await this.fresh(async () => (await this.dir(parts.slice(0, -1), true)).getFileHandle(this.codec.enc(parts[parts.length - 1]!), { create: true }));
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
  async hash(path: string, onChunk?: (read: number) => void): Promise<{ size: number; hash: string }> {
    const f = await this.file(path);
    let h = FNV_INIT;
    for (let at = 0; at < f.size; at += CHUNK) (h = fnvUpdate(h, new Uint8Array(await f.slice(at, at + CHUNK).arrayBuffer()))), onChunk?.(at);
    return { size: f.size, hash: fnvHex(h) };
  }

  /**
   * Mover. Archivo: `move()` nativo si existe (renombrar sin copiar); si falla o no existe,
   * copia por trozos y borra. Nunca carga el archivo entero. Directorio: recursivo.
   */
  /** `onChunk`: progreso de la copia por trozos (el Worker lo usa como señal de vida). */
  async move(from: string, to: string, onChunk?: () => void): Promise<void> {
    const h = await this.resolve(from);
    if (!h) throw new VaultError(`No existe: ${from}`, 'not-found', from);
    if (splitPath(from).join('/') === splitPath(to).join('/')) return; // mover sobre sí mismo: nada (si no, `remove(to)` lo borra)
    if (h.kind === 'file') {
      const parts = splitPath(to);
      // un destino que es carpeta nunca se borra para dejar sitio a un archivo
      const dest = await this.resolve(to);
      if (dest?.kind === 'directory') throw new VaultError(`El destino es una carpeta: ${to}`, 'io', to);
      const fh = h as FileSystemFileHandle & { move?: (dir: FileSystemDirectoryHandle, name: string) => Promise<void> };
      if (typeof fh.move === 'function') {
        try {
          if (dest) await this.remove(to); // un destino que no existe no se borra (un viaje menos)
          await fh.move(await this.fresh(() => this.dir(parts.slice(0, -1), true)), this.codec.enc(parts[parts.length - 1]!));
          // comprobar con la caché basta: el origen se acaba de resolver por ella
          if ((await this.resolve(to)) && !(await this.resolveOnce(from, true))) return;
        } catch { /* sin move fiable: se copia */ }
      }
      await this.writeBlob(to, await (h as FileSystemFileHandle).getFile(), onChunk);
    } else {
      for (const e of await this.list(from, onChunk)) await this.move(e.path, `${splitPath(to).join('/')}/${e.name}`, onChunk);
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
