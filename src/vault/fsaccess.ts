import { HandleFS, writeWithWritable } from './handle-fs';
import { normalizePath } from './paths';
import type { VaultAdapter } from './types';
import { toBytes } from './util';

/**
 * Carpeta real elegida por el usuario. Solo existe donde hay `showDirectoryPicker`
 * (Chrome/Edge de escritorio). En Safari iPad NO está disponible.
 */
export class FSAccessBackend implements VaultAdapter {
  readonly kind = 'fsaccess' as const;
  private fs: HandleFS;
  constructor(readonly root: FileSystemDirectoryHandle) {
    this.fs = new HandleFS(root, writeWithWritable);
  }
  static isSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }
  /** Debe llamarse desde un gesto del usuario. */
  static async pick(): Promise<FSAccessBackend> {
    const picker = (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    return new FSAccessBackend(await picker({ mode: 'readwrite' }));
  }
  async list(p: string) { return this.fs.list(normalizePath(p)); }
  async read(p: string) { return this.fs.read(normalizePath(p)); }
  async write(p: string, d: Uint8Array | string) { return this.fs.write(normalizePath(p), toBytes(d)); }
  async remove(p: string) { return this.fs.remove(normalizePath(p)); }
  async move(a: string, b: string) { return this.fs.move(normalizePath(a), normalizePath(b)); }
  async exists(p: string) { return (await this.fs.stat(normalizePath(p))) !== null; }
  async stat(p: string) { return this.fs.stat(normalizePath(p)); }
  // Prompt 11: por trozos (hilo principal: cada trozo cede el hilo al esperar la lectura)
  async writeBlob(p: string, blob: Blob, o: import('./types').BlobWriteOptions = {}) { return this.fs.writeBlob(normalizePath(p), blob, (n) => o.onProgress?.(n, blob.size), () => !!o.signal?.aborted); }
  async hash(p: string) { return this.fs.hash(normalizePath(p)); }
  async file(p: string) { return this.fs.file(normalizePath(p)); }
  async appendAt(p: string, d: Uint8Array, at: number, sep?: boolean) { return this.fs.appendAt(normalizePath(p), d, at, sep); }
}
