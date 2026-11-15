// Arreglos de almacenamiento: temporales huérfanos con diario atascado, move() nativo poco fiable,
// plan de importación por tamaño y desglose por carpeta.
import { describe, expect, it, vi } from 'vitest';
import { HandleFS } from '../src/vault/handle-fs';
import { MemoryBackend } from '../src/vault/memory';
import { JOURNAL_PATH, SafeVault, TMP_DIR } from '../src/vault/safe';
import { buildPlan } from '../src/io/import';
import { folderBreakdown } from '../src/lib/usage';
import { checksum, decodeText } from '../src/vault/util';

const enc = (s: string) => new TextEncoder().encode(s);

describe('recover con diario atascado', () => {
  it('conserva solo el temporal que cita el diario y borra los huérfanos', async () => {
    const m = new MemoryBackend();
    const data = enc('hola');
    await m.write(`${TMP_DIR}/ok-1`, data);
    for (const n of ['a-1', 'b-2', 'c-3']) await m.write(`${TMP_DIR}/${n}`, enc('basura'));
    const entry = { op: 'write', path: 'notes/x.md', tmp: `${TMP_DIR}/ok-1`, size: data.length, hash: checksum(data), ts: 1 };
    await m.write(JOURNAL_PATH, enc(JSON.stringify({ v: 1, entries: [entry] })));
    const w = m.write.bind(m);
    vi.spyOn(m, 'write').mockImplementation(async (p: string, d: string | Uint8Array) => { if (p === 'notes/x.md') throw new Error('E/S'); return w(p, d); });
    await new SafeVault(m).recover();
    const left = (await m.list(TMP_DIR)).map((e) => e.name);
    expect(left).toEqual(['ok-1']);
    expect(await m.exists(JOURNAL_PATH)).toBe(true);
  });
});

let nWritable = 0;
// doble de FileSystemFileHandle con `move` configurable
type Mode = 'ok' | 'noop' | 'copy' | 'copy-short';
class FFile {
  readonly kind = 'file';
  data: Uint8Array<ArrayBuffer> = new Uint8Array();
  constructor(public name: string, public parent: FDir, public mode: () => Mode) {}
  async getFile() { return new File([this.data as BlobPart], this.name); }
  async createWritable() {
    nWritable++;
    const parts: Uint8Array[] = [];
    return { write: async (b: Blob | Uint8Array) => { parts.push(b instanceof Blob ? new Uint8Array(await b.arrayBuffer()) : b); }, close: async () => { this.data = new Uint8Array(parts.flatMap((x) => [...x])); }, abort: async () => {} };
  }
  async move(dir: FDir, name: string) {
    const m = this.mode();
    if (m === 'noop') return;
    if (m === 'ok') { this.parent.children.delete(this.name); dir.children.set(name, this); Object.assign(this, { parent: dir, name }); return; }
    const c = new FFile(name, dir, this.mode); // copia sin quitar el origen
    c.data = m === "copy" ? this.data : this.data.slice(0, 1);
    dir.children.set(name, c);
  }
}
class FDir {
  readonly kind = 'directory';
  children = new Map<string, FDir | FFile>();
  constructor(public name = '', public mode: () => Mode = () => 'ok') {}
  async getDirectoryHandle(name: string, o: { create?: boolean } = {}) {
    let c = this.children.get(name);
    if (!c) { if (!o.create) throw new DOMException('x', 'NotFoundError'); c = new FDir(name, this.mode); this.children.set(name, c); }
    if (c.kind !== 'directory') throw new DOMException('t', 'TypeMismatchError');
    return c;
  }
  async getFileHandle(name: string, o: { create?: boolean } = {}) {
    let c = this.children.get(name);
    if (!c) { if (!o.create) throw new DOMException('x', 'NotFoundError'); c = new FFile(name, this, this.mode); this.children.set(name, c); }
    if (c.kind !== 'file') throw new DOMException('t', 'TypeMismatchError');
    return c;
  }
  async removeEntry(name: string) { if (!this.children.delete(name)) throw new DOMException('x', 'NotFoundError'); }
  async *entries() { yield* this.children.entries(); }
}
const mk = (mode: Mode) => {
  const root = new FDir('', () => mode);
  const writes: string[] = [];
  const f = new HandleFS(root as unknown as FileSystemDirectoryHandle, async (fh, d) => { (fh as unknown as FFile).data = d as Uint8Array<ArrayBuffer>; writes.push((fh as unknown as FFile).name); }, undefined, { cacheDirs: true });
  return { f, writes };
};

describe('HandleFS.move con move() nativo', () => {
  it('no movió (sin error): copia desde el origen y lo borra', async () => {
    const { f } = mk('noop');
    await f.write('a/x.bin', enc('datos'));
    await f.move('a/x.bin', 'b/x.bin');
    expect(decodeText(await f.read('b/x.bin'))).toBe('datos');
    expect(await f.stat('a/x.bin')).toBeNull();
  });
  it('copió sin borrar el origen y el tamaño coincide: solo borra el origen, sin reescribir', async () => {
    const { f } = mk('copy');
    await f.write('a/x.bin', enc('datos'));
    nWritable = 0;
    await f.move('a/x.bin', 'b/x.bin');
    expect(nWritable).toBe(0);
    expect(decodeText(await f.read('b/x.bin'))).toBe('datos');
    expect(await f.stat('a/x.bin')).toBeNull();
  });
  it('origen y destino con distinto tamaño: error claro y no se borra nada', async () => {
    const { f } = mk('copy-short');
    await f.write('a/x.bin', enc('datos'));
    await expect(f.move('a/x.bin', 'b/x.bin')).rejects.toThrow(/distintos/);
    expect(await f.stat('a/x.bin')).not.toBeNull();
  });
});

describe('buildPlan: medio perezoso existente', () => {
  it('con otro tamaño no produce el blob; con el mismo, lo compara', async () => {
    const m = new MemoryBackend();
    await m.write('media/a.png', enc('11111'));
    const mkLazy = (n: number) => { const lazy = vi.fn(async () => new Blob([enc('1'.repeat(n))])); return { lazy, f: { path: 'media/a.png', data: new Uint8Array(0), size: n, lazy, exactSize: async () => n } }; };
    const dif = mkLazy(9);
    expect((await buildPlan(m, [dif.f]))[0]!.status).toBe('conflict');
    expect(dif.lazy).not.toHaveBeenCalled();
    const same = mkLazy(5);
    expect((await buildPlan(m, [same.f]))[0]!.status).toBe('same');
    expect(same.lazy).toHaveBeenCalledTimes(1);
  });
});

describe('folderBreakdown', () => {
  it('agrupa por carpeta de primer nivel y .app por subcarpeta, por tamaño', () => {
    const r = folderBreakdown([
      { path: 'media/a.png', size: 100 }, { path: 'media/b.png', size: 50 }, { path: 'notes/n.md', size: 10 }, { path: 'raiz.md', size: 1 },
      { path: '.app/tmp/x', size: 500 }, { path: '.app/history/h', size: 7 }, { path: '.app/state.json', size: 3 }, { path: '.app/foo/z', size: 2 },
    ]);
    expect(r).toEqual([
      { key: '.app/tmp', size: 500 }, { key: 'media', size: 150 }, { key: 'notes', size: 10 }, { key: '.app/history', size: 7 },
      { key: '.app/otras', size: 5 }, { key: 'raiz', size: 1 },
    ]);
  });
});

import { SafeVault as SV2 } from '../src/vault/safe';
import { MemoryBackend as MB2 } from '../src/vault/memory';
describe('freeTmp', () => {
  it('borra .app/tmp sin diario y no lo toca con diario pendiente', async () => {
    const raw = new MB2(); const v = new SV2(raw);
    await raw.write('.app/tmp/a', new Uint8Array(10));
    expect(await v.freeTmp()).toBe(true);
    expect(await raw.exists('.app/tmp/a')).toBe(false);
    await raw.write('.app/tmp/b', new Uint8Array(10));
    await raw.write('.app/journal.json', new TextEncoder().encode('{}'));
    expect(await v.freeTmp()).toBe(false);
    expect(await raw.exists('.app/tmp/b')).toBe(true);
  });
});
