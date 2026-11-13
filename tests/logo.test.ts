// Prompt 19: marca sin recuadro derivada por scripts/icons.mjs (el original no se toca)
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

/** Decodificador PNG mínimo (8 bits, RGBA, sin entrelazado): suficiente para revisar la marca. */
function decode(buf: Buffer) {
  let o = 8, w = 0, h = 0, type = 0;
  const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), kind = buf.toString('ascii', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') (w = data.readUInt32BE(0)), (h = data.readUInt32BE(4)), (type = data[9]!);
    if (kind === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= bpp ? px[y * stride + x - bpp]! : 0, b = y ? px[(y - 1) * stride + x]! : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp]! : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      px[y * stride + x] = (v + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]!) & 255;
    }
  }
  return { w, h, type, px };
}

describe('logo sin recuadro (Prompt 19)', () => {
  it('el original no cambia', () => {
    expect(createHash('sha256').update(readFileSync('assets/brand/logo-original.png')).digest('hex')).toBe('583599f0785e6a7a45c14e099cc39d5bba9f93cc0e9ca8e8dd521fa7b3e53fe8');
  });
  it('logo-mark.png: RGBA, 512 px de lado mayor, esquinas transparentes y sin negros opacos', () => {
    const { w, h, type, px } = decode(readFileSync('public/brand/logo-mark.png'));
    expect(type).toBe(6);
    expect(Math.max(w, h)).toBe(512);
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]]) expect(px[(y! * w + x!) * 4 + 3]).toBe(0);
    let dark = 0, edge = 0;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3]!;
      if (a > 40 && px[i]! + px[i + 1]! + px[i + 2]! < 150) dark++;
      if (a > 0 && a < 255) edge++;
    }
    expect(dark).toBe(0); // sin halo ni píxeles casi negros opacos
    expect(edge).toBeGreaterThan(0); // bordes suaves (no recorte duro)
  });
});
