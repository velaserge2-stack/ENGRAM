// Prompt 21 · 3a: caché de manejadores de carpeta en HandleFS (solo OPFS). Mismo resultado que sin caché,
// nunca escribe en una carpeta borrada (aunque la borre otra instancia, p. ej. otra pestaña) y resuelve
// con muchos menos getDirectoryHandle.
import { describe, expect, it } from 'vitest';
import { HandleFS } from '../src/vault/handle-fs';
import { decodeText } from '../src/vault/util';

let dirCalls = 0;
const notFound = () => new DOMException('no existe', 'NotFoundError');
const mismatch = () => new DOMException('tipo', 'TypeMismatchError');

class FFile {
  readonly kind = 'file';
  data: Uint8Array = new Uint8Array();
  removed = false;
  constructor(public name: string, public parent: FDir) {}
  check() { if (this.removed) throw notFound(); }
  async getFile() { this.check(); return new File([this.data as BlobPart], this.name); }
  async move(dir: FDir, name: string) {
    this.check(); dir.check();
    this.parent.children.delete(this.name);
    dir.children.set(name, this);
    Object.assign(this, { parent: dir, name });
  }
}
class FDir {
  readonly kind = 'directory';
  children = new Map<string, FDir | FFile>();
  removed = false;
  constructor(public name = '') {}
  check() { if (this.removed) throw notFound(); }
  async getDirectoryHandle(name: string, o: { create?: boolean } = {}) {
    dirCalls++;
    this.check();
    let c = this.children.get(name);
    if (!c) { if (!o.create) throw notFound(); c = new FDir(name); this.children.set(name, c); }
    if (c.kind !== 'directory') throw mismatch();
    return c;
  }
  async getFileHandle(name: string, o: { create?: boolean } = {}) {
    this.check();
    let c = this.children.get(name);
    if (!c) { if (!o.create) throw notFound(); c = new FFile(name, this); this.children.set(name, c); }
    if (c.kind !== 'file') throw mismatch();
    return c;
  }
  async removeEntry(name: string) {
    this.check();
    const c = this.children.get(name);
    if (!c) throw notFound();
    const kill = (x: FDir | FFile) => { x.removed = true; if (x.kind === 'directory') x.children.forEach(kill); };
    kill(c);
    this.children.delete(name);
  }
  async *entries() { this.check(); yield* this.children.entries(); }
}

const writeFile = async (fh: FileSystemFileHandle, data: Uint8Array) => { (fh as unknown as FFile).check(); (fh as unknown as FFile).data = data; };
const fs = (root: FDir, cacheDirs: boolean) => new HandleFS(root as unknown as FileSystemDirectoryHandle, writeFile, undefined, { cacheDirs });
const enc = (s: string) => new TextEncoder().encode(s);

async function script(f: HandleFS): Promise<string[]> {
  const out: string[] = [];
  await f.write('notes/A/B/uno.md', enc('1'));
  await f.write('notes/A/B/dos.md', enc('2'));
  await f.write('notes/A/C/tres.md', enc('3'));
  await f.move('notes/A/B/uno.md', 'notes/A/C/uno.md');
  await f.move('notes/A/C', 'notes/Z');
  await f.remove('notes/A/B');
  await f.write('notes/A/B/nuevo.md', enc('n')); // carpeta recreada tras borrarla
  for (const p of ['notes/Z/uno.md', 'notes/Z/tres.md', 'notes/A/B/nuevo.md']) out.push(`${p}=${decodeText(await f.read(p))}`);
  out.push(...(await f.list('notes')).map((e) => `${e.kind}:${e.path}`).sort());
  out.push(String(await f.stat('notes/A/B/dos.md')));
  return out;
}

describe('HandleFS: caché de carpetas', () => {
  it('mismo resultado que sin caché, con muchos menos getDirectoryHandle', async () => {
    dirCalls = 0;
    const a = await script(fs(new FDir(), false));
    const sin = dirCalls;
    dirCalls = 0;
    const b = await script(fs(new FDir(), true));
    expect(b).toEqual(a);
    expect(dirCalls).toBeLessThan(sin);
  });

  it('leer y escribir 60 notas en carpetas anidadas: una fracción de los getDirectoryHandle', async () => {
    const run = async (cache: boolean) => {
      const f = fs(new FDir(), cache);
      dirCalls = 0;
      for (let i = 0; i < 60; i++) await f.write(`notes/Materia ${i % 3}/Tema ${i % 5}/n${i}.md`, enc(String(i)));
      for (let i = 0; i < 60; i++) expect(decodeText(await f.read(`notes/Materia ${i % 3}/Tema ${i % 5}/n${i}.md`))).toBe(String(i));
      return dirCalls;
    };
    const sin = await run(false), con = await run(true);
    expect(con).toBeLessThan(sin / 5);
  });

  it('otra instancia borra y recrea la carpeta: la caché nunca escribe en la borrada', async () => {
    const root = new FDir();
    const cached = fs(root, true), other = fs(root, false);
    await cached.write('notes/M/a.md', enc('a'));
    await other.remove('notes/M'); // p. ej. otra pestaña
    await other.write('notes/M/otro.md', enc('o'));
    await cached.write('notes/M/b.md', enc('b')); // el manejador viejo de notes/M está borrado
    expect(decodeText(await other.read('notes/M/b.md'))).toBe('b');
    expect((await other.list('notes/M')).map((e) => e.name).sort()).toEqual(['b.md', 'otro.md']);
    expect(await cached.stat('notes/M/a.md')).toBeNull();
    expect(decodeText(await cached.read('notes/M/otro.md'))).toBe('o'); // lee la carpeta nueva, no la vieja
  });
});
