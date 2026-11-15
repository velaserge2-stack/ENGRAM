/**
 * Lector del directorio central de un .zip sobre un Blob/File: no lee el archivo entero, solo el final
 * (EOCD, ZIP64 si hace falta) y la lista de entradas; el contenido de cada entrada se pide con `slice`.
 * Sirve para paquetes de Anki de cientos de MB: en memoria solo queda lo que se pide.
 */
import { inflateSync } from 'fflate';

export type ZipIndexCode = 'invalid' | 'corrupt' | 'too-many';
export class ZipIndexError extends Error {
  constructor(public code: ZipIndexCode, message: string) { super(message); }
}

export interface ZipRef {
  /** Posición de la cabecera local (el contenido empieza después de ella). */
  offset: number;
  csize: number;
  usize: number;
  /** 0 = sin comprimir, 8 = deflate. */
  method: number;
}
export interface ZipEntry extends ZipRef { name: string; flags: number }

const MAX_ENTRIES = 1_000_000;
const MAX_DIR_BYTES = 256 * 1024 * 1024;
const u8 = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const u64 = (v: DataView, o: number) => v.getUint32(o, true) + v.getUint32(o + 4, true) * 2 ** 32;

export async function readZipIndex(blob: Blob, maxEntries = MAX_ENTRIES): Promise<ZipEntry[]> {
  const size = blob.size;
  const head = await u8(blob.slice(0, 4));
  if (size < 22 || head[0] !== 0x50 || head[1] !== 0x4b) throw new ZipIndexError('invalid', 'no zip');
  const tailAt = Math.max(0, size - 65557);
  const tail = await u8(blob.slice(tailAt));
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let e = tail.length - 22;
  while (e >= 0 && tv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new ZipIndexError('corrupt', 'sin EOCD');
  let count = tv.getUint16(e + 10, true), dirSize = tv.getUint32(e + 12, true), dirAt = tv.getUint32(e + 16, true);
  if (count === 0xffff || dirSize === 0xffffffff || dirAt === 0xffffffff) {
    // ZIP64: el localizador está justo antes del EOCD
    if (e < 20 || tv.getUint32(e - 20, true) !== 0x07064b50) throw new ZipIndexError('corrupt', 'sin localizador ZIP64');
    const at = u64(tv, e - 20 + 8);
    if (at + 56 > size) throw new ZipIndexError('corrupt', 'ZIP64 fuera de rango');
    const z = await u8(blob.slice(at, at + 56));
    const zv = new DataView(z.buffer, z.byteOffset, z.byteLength);
    if (zv.getUint32(0, true) !== 0x06064b50) throw new ZipIndexError('corrupt', 'ZIP64 ilegible');
    count = u64(zv, 32); dirSize = u64(zv, 40); dirAt = u64(zv, 48);
  }
  if (count > maxEntries) throw new ZipIndexError('too-many', `${count} entradas`);
  if (dirAt + dirSize > size || dirSize > MAX_DIR_BYTES) throw new ZipIndexError('corrupt', 'directorio fuera de rango');
  const d = await u8(blob.slice(dirAt, dirAt + dirSize));
  const v = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > d.length || v.getUint32(p, true) !== 0x02014b50) throw new ZipIndexError('corrupt', 'entrada ilegible');
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true);
    let csize = v.getUint32(p + 20, true), usize = v.getUint32(p + 24, true), offset = v.getUint32(p + 42, true);
    const n = v.getUint16(p + 28, true), x = v.getUint16(p + 30, true), c = v.getUint16(p + 32, true);
    if (p + 46 + n + x + c > d.length) throw new ZipIndexError('corrupt', 'entrada truncada');
    const name = dec.decode(d.subarray(p + 46, p + 46 + n));
    if (usize === 0xffffffff || csize === 0xffffffff || offset === 0xffffffff) {
      let q = p + 46 + n; const end = q + x;
      while (q + 4 <= end) {
        const id = v.getUint16(q, true), len = v.getUint16(q + 2, true);
        if (id === 1) {
          let r = q + 4;
          if (usize === 0xffffffff) { usize = u64(v, r); r += 8; }
          if (csize === 0xffffffff) { csize = u64(v, r); r += 8; }
          if (offset === 0xffffffff) offset = u64(v, r);
          break;
        }
        q += 4 + len;
      }
    }
    if (offset + csize > size) throw new ZipIndexError('corrupt', `${name}: fuera de rango`);
    out.push({ name, method, csize, usize, offset, flags });
    p += 46 + n + x + c;
  }
  return out;
}

/** Donde empieza el contenido de la entrada (lee su cabecera local). */
export async function dataStart(blob: Blob, r: ZipRef): Promise<number> {
  const h = await u8(blob.slice(r.offset, r.offset + 30));
  const v = new DataView(h.buffer, h.byteOffset, h.byteLength);
  if (h.length < 30 || v.getUint32(0, true) !== 0x04034b50) throw new ZipIndexError('corrupt', 'cabecera local ilegible');
  const at = r.offset + 30 + v.getUint16(26, true) + v.getUint16(28, true);
  if (at + r.csize > blob.size) throw new ZipIndexError('corrupt', 'contenido fuera de rango');
  return at;
}

/** Entrada pequeña (colección, meta, media) en memoria. El tamaño declarado debe estar ya acotado. */
export async function readEntry(blob: Blob, e: ZipEntry): Promise<Uint8Array> {
  if (e.flags & 1) throw new ZipIndexError('corrupt', 'cifrado');
  const at = await dataStart(blob, e);
  const raw = await u8(blob.slice(at, at + e.csize));
  if (e.method === 0) return raw;
  if (e.method !== 8) throw new ZipIndexError('corrupt', `método ${e.method}`);
  try { return inflateSync(raw, { out: new Uint8Array(e.usize) }); } catch { throw new ZipIndexError('corrupt', `${e.name}: datos dañados`); }
}
