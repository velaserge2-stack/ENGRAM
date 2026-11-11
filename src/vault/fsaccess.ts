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
  list(p: string) { return this.fs.list(normalizePath(p)); }
  read(p: string) { return this.fs.read(normalizePath(p)); }
  write(p: string, d: Uint8Array | string) { return this.fs.write(normalizePath(p), toBytes(d)); }
  remove(p: string) { return this.fs.remove(normalizePath(p)); }
  move(a: string, b: string) { return this.fs.move(normalizePath(a), normalizePath(b)); }
  async exists(p: string) { return (await this.fs.stat(normalizePath(p))) !== null; }
  stat(p: string) { return this.fs.stat(normalizePath(p)); }
}
