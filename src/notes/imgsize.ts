/**
 * Ancho y alto de una imagen leyendo solo su encabezado (sin decodificarla): PNG (IHDR),
 * JPEG (SOFn, con la orientación EXIF aplicada), GIF y WebP (VP8/VP8L/VP8X). Formato
 * desconocido o archivo corrupto → null (nunca lanza).
 */
export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  try {
    const u16 = (i: number, le = false) => (le ? b[i]! | (b[i + 1]! << 8) : (b[i]! << 8) | b[i + 1]!);
    const u32 = (i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
    const ok = (s: { w: number; h: number }) => (s.w > 0 && s.h > 0 && s.w < 1e6 && s.h < 1e6 ? s : null);
    if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return ok({ w: u32(16), h: u32(20) });
    if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return ok({ w: u16(6, true), h: u16(8, true) });
    if (b.length >= 30 && u32(0) === 0x52494646 && u32(8) === 0x57454250) {
      const kind = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
      if (kind === 'VP8X') return ok({ w: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), h: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)) });
      if (kind === 'VP8L') {
        const v = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24);
        return ok({ w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 });
      }
      if (kind === 'VP8 ') return ok({ w: u16(26, true) & 0x3fff, h: u16(28, true) & 0x3fff });
      return null;
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let rot = 1;
      for (let i = 2; i + 9 < b.length; ) {
        if (b[i] !== 0xff) return null;
        const m = b[i + 1]!;
        if (m === 0xd9 || m === 0xda) return null;
        const len = u16(i + 2);
        if (m === 0xe1 && u32(i + 4) === 0x45786966) rot = exifOrientation(b, i + 10) || 1; // «Exif»
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          const s = { w: u16(i + 7), h: u16(i + 5) };
          return ok(rot >= 5 ? { w: s.h, h: s.w } : s); // 5–8: girada 90°
        }
        i += 2 + len;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Etiqueta 0x0112 (orientación) del primer IFD de un bloque TIFF/EXIF. */
function exifOrientation(b: Uint8Array, t: number): number {
  const le = b[t] === 0x49;
  const r16 = (i: number) => (le ? b[i]! | (b[i + 1]! << 8) : (b[i]! << 8) | b[i + 1]!);
  const r32 = (i: number) => (le ? (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0 : ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0);
  const ifd = t + r32(t + 4);
  const n = r16(ifd);
  for (let k = 0; k < n && ifd + 2 + k * 12 + 10 < b.length; k++) {
    const e = ifd + 2 + k * 12;
    if (r16(e) === 0x0112) return r16(e + 8);
  }
  return 0;
}
