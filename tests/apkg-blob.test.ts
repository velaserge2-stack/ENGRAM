import { strToU8, unzipSync, zipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { zstdCompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ApkgError, convertApkg, convertApkgBlob, type SqlJs } from '../src/io/apkg';
import { applyPlan, buildPlan, gather } from '../src/io/import';
import { mediaBlob } from '../src/io/zipblob';
import { readEntry, readZipIndex, ZipIndexError } from '../src/io/zipindex';
import { MemoryBackend } from '../src/vault/memory';
import { SafeVault } from '../src/vault/safe';

const sql = async () => ((await import('sql.js')).default as unknown as () => Promise<SqlJs>)();
const FIX = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/apkg/${n}`, import.meta.url)));
const blobOf = (b: Uint8Array) => new Blob([b as BlobPart]);
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

/** Blob que cuenta los bytes que se leen de él (y de sus trozos). */
class Counting extends Blob {
  constructor(parts: BlobPart[], public stat: { read: number }) { super(parts); }
  override slice(a?: number, b?: number, c?: string) { const s = super.slice(a, b, c); return new Counting([s], this.stat); }
  override async arrayBuffer() { const r = await super.arrayBuffer(); this.stat.read += r.byteLength; return r; }
}

describe('directorio central', () => {
  it('zip normal: entradas, métodos y contenido', async () => {
    const z = zipSync({ a: [strToU8('hola'), { level: 0 }], b: strToU8('x'.repeat(5000)), 'c/d.txt': strToU8('dd') });
    const ix = await readZipIndex(blobOf(z));
    expect(ix.map((e) => e.name).sort()).toEqual(['a', 'b', 'c/d.txt']);
    expect(ix.find((e) => e.name === 'a')!.method).toBe(0);
    expect(ix.find((e) => e.name === 'b')!.method).toBe(8);
    expect(new TextDecoder().decode(await readEntry(blobOf(z), ix.find((e) => e.name === 'b')!))).toBe('x'.repeat(5000));
  });

  it('ZIP64 sintético (tamaños y posición en el campo extra)', async () => {
    const name = strToU8('m'), data = strToU8('contenido');
    const u16 = (n: number) => [n & 255, (n >> 8) & 255];
    const u32 = (n: number) => [...u16(n & 0xffff), ...u16((n >>> 16) & 0xffff)];
    const u64 = (n: number) => [...u32(n % 2 ** 32), ...u32(Math.floor(n / 2 ** 32))];
    const local = [...u32(0x04034b50), ...u16(45), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(1), ...u16(0), ...name, ...data];
    const extra = [...u16(1), ...u16(24), ...u64(data.length), ...u64(data.length), ...u64(0)];
    const cen = [...u32(0x02014b50), ...u16(45), ...u16(45), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0xffffffff), ...u32(0xffffffff), ...u16(1), ...u16(extra.length), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(0xffffffff), ...name, ...extra];
    const z64At = local.length + cen.length;
    const z64 = [...u32(0x06064b50), ...u64(44), ...u16(45), ...u16(45), ...u32(0), ...u32(0), ...u64(1), ...u64(1), ...u64(cen.length), ...u64(local.length)];
    const loc = [...u32(0x07064b50), ...u32(0), ...u64(z64At), ...u32(1)];
    const eocd = [...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(0xffff), ...u16(0xffff), ...u32(0xffffffff), ...u32(0xffffffff), ...u16(0)];
    const zip = new Uint8Array([...local, ...cen, ...z64, ...loc, ...eocd]);
    const ix = await readZipIndex(blobOf(zip));
    expect(ix).toHaveLength(1);
    expect(ix[0]).toMatchObject({ name: 'm', csize: data.length, usize: data.length, offset: 0, method: 0 });
    expect(new TextDecoder().decode(await readEntry(blobOf(zip), ix[0]!))).toBe('contenido');
  });

  it('truncado o no zip → error con código', async () => {
    const z = zipSync({ a: strToU8('hola'.repeat(100)) });
    await expect(readZipIndex(blobOf(z.subarray(0, z.length - 30)))).rejects.toMatchObject({ code: 'corrupt' });
    await expect(readZipIndex(blobOf(strToU8('no soy un zip, de verdad que no')))).rejects.toBeInstanceOf(ZipIndexError);
    const code = async (b: Uint8Array) => { try { await convertApkgBlob(blobOf(b), await sql()); } catch (e) { return (e as ApkgError).code; } return 'ok'; };
    expect(await code(FIX('nuevo.apkg').subarray(0, 4000))).toBe('corrupt');
    expect(await code(strToU8('basura'.repeat(10)))).toBe('invalid');
  });
});

describe('.apkg por trozos', () => {
  for (const f of ['legado.apkg', 'compat.apkg', 'nuevo.apkg']) {
    it(`${f}: mismos mazos y medios que la lectura entera`, async () => {
      const SQL = await sql();
      const whole = convertApkg(FIX(f), SQL, true, f);
      const file = blobOf(FIX(f));
      const part = await convertApkgBlob(file, SQL, true, f);
      expect(part.decks).toEqual(whole.decks);
      expect(part.log).toEqual(whole.log);
      expect(part.info).toEqual(whole.info);
      expect(part.media.map((m) => m.name)).toEqual(whole.media.map((m) => m.name));
      expect(part.media.every((m) => m.ref && m.data.length === 0)).toBe(true);
      for (let i = 0; i < whole.media.length; i++) expect(await bytesOf(await mediaBlob(file, part.media[i]!.ref!, part.media[i]!.name))).toEqual(whole.media[i]!.data);
    });
  }

  it('con medios grandes solo se lee la colección (no el paquete entero)', async () => {
    const z = unzipSync(FIX('legado.apkg'));
    const big = new Uint8Array(randomBytes(8 * 1024 * 1024));
    const pkg = zipSync({ ...z, media: strToU8(JSON.stringify({ 0: 'ecg.png', 1: 'grande.bin' })), 0: new Uint8Array([1, 2, 3]), 1: [big, { level: 0 }] });
    const stat = { read: 0 };
    const r = await convertApkgBlob(new Counting([pkg as BlobPart], stat), await sql());
    expect(r.media.map((m) => m.name)).toEqual(['ecg.png', 'grande.bin']);
    expect(stat.read).toBeLessThan(2 * 1024 * 1024);
    // el medio grande sin comprimir es un trozo del archivo: tampoco se copia
    const file = blobOf(pkg);
    const b = await mediaBlob(file, r.media[1]!.ref!, 'grande.bin');
    expect(b.size).toBe(big.length);
    expect(await bytesOf(b)).toEqual(big);
  });

  it('medios deflate y zstd por trozos; bomba y dañado → error', async () => {
    const z = unzipSync(FIX('legado.apkg'));
    const text = strToU8('abc'.repeat(100_000));
    const zs = new Uint8Array(zstdCompressSync(text));
    const pkg = blobOf(zipSync({ ...z, media: strToU8(JSON.stringify({ 0: 'a.txt', 1: 'b.txt' })), 0: text, 1: [zs, { level: 0 }] }));
    const r = await convertApkgBlob(pkg, await sql());
    expect(r.media.find((m) => m.name === 'a.txt')!.ref!.method).toBe(8);
    expect(await bytesOf(await mediaBlob(pkg, r.media[0]!.ref!, 'a.txt'))).toEqual(text);
    expect(await bytesOf(await mediaBlob(pkg, r.media[1]!.ref!, 'b.txt'))).toEqual(text);
    await expect(mediaBlob(pkg, r.media[0]!.ref!, 'a.txt', 1000)).rejects.toMatchObject({ code: 'too-big' });
    await expect(mediaBlob(pkg, r.media[1]!.ref!, 'b.txt', 1000)).rejects.toMatchObject({ code: 'too-big' });
    // razón de compresión sospechosa (> 200 y > 1 MB): se omite con aviso
    const bomb = blobOf(zipSync({ ...z, media: strToU8(JSON.stringify({ 0: 'bomba.bin' })), 0: new Uint8Array(4 * 1024 * 1024) }));
    const rb = await convertApkgBlob(bomb, await sql());
    expect(rb.media).toEqual([]);
    expect(rb.warnings.join(' ')).toMatch(/1 medios no se pudieron descomprimir/);
    const dmg = blobOf(zipSync({ ...z, media: strToU8(JSON.stringify({ 1: 'c.txt' })), 1: [new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 9, 9]), { level: 0 }] }));
    const rd = await convertApkgBlob(dmg, await sql());
    await expect(mediaBlob(dmg, rd.media[0]!.ref!, 'c.txt')).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('gather + plan + aplicar: los medios se producen al aplicar, de uno en uno, y quedan en media/', async () => {
    const SQL = await sql();
    const pkg = FIX('nuevo.apkg');
    const file = new File([pkg as BlobPart], 'TRAUMA.apkg');
    const g = await gather([{ name: file.name, bytes: async () => { throw new Error('no debe leerse entero'); }, file }], { apkgFile: (f, n) => convertApkgBlob(f, SQL, true, n) });
    expect(g.failures).toEqual([]);
    const media = g.files.filter((f) => f.path.startsWith('media/'));
    expect(media.length).toBeGreaterThan(0);
    expect(media.every((m) => m.lazy && m.data.length === 0)).toBe(true);
    let calls = 0;
    for (const m of media) { const l = m.lazy!; m.lazy = () => (calls++, l()); }
    const vault = new SafeVault(new MemoryBackend());
    const plan = await buildPlan(vault, g.files);
    expect(calls).toBe(0); // nada nuevo que comparar: no se produce ningún medio al planear
    const progress: number[] = [];
    await applyPlan(vault, plan, () => 'omit', { onProgress: (d) => progress.push(d) });
    expect(calls).toBe(media.length);
    const whole = convertApkg(pkg, SQL, true, 'TRAUMA.apkg');
    for (const m of whole.media) expect(await vault.read(`media/${m.name}`)).toEqual(m.data);
    expect((await vault.list('decks')).length).toBeGreaterThan(0);
    expect(progress.length).toBeGreaterThan(0);
    // reimportar: mismos medios → «igual», sin duplicar
    const again = await buildPlan(vault, g.files);
    expect(again.filter((p) => p.path.startsWith('media/')).every((p) => p.status === 'same')).toBe(true);
  });

  it('Cancelar durante la aplicación no escribe nada', async () => {
    const SQL = await sql();
    const file = new File([FIX('nuevo.apkg') as BlobPart], 'x.apkg');
    const g = await gather([{ name: file.name, bytes: async () => new Uint8Array(), file }], { apkgFile: (f, n) => convertApkgBlob(f, SQL, true, n) });
    const vault = new SafeVault(new MemoryBackend());
    const ac = new AbortController();
    ac.abort();
    await expect(applyPlan(vault, await buildPlan(vault, g.files), () => 'omit', { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await vault.exists('media')).toBe(false);
  });
});
