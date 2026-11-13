/**
 * Imágenes grandes en paneles (Prompt 14 · 3). Se muestra una versión reducida al tamaño del
 * panel × densidad de pantalla, guardada en una caché regenerable (`.app/cache/img/`), nunca en
 * `media/` ni sobre el original. El original se carga solo al acercar mucho o con «Ver original».
 */
import type { VaultAdapter } from '../vault/types';
import { checksum } from '../vault/util';

/** Escalones de lado mayor: pocas versiones por imagen, y nunca más de 2 560 px. */
export const STEPS = [640, 1280, 2560] as const;
/**
 * Límite práctico de Safari en iOS/iPadOS para lienzos (y para decodificar sin degradar): ~16.7 MP
 * (4096 × 4096). Por encima, solo se muestra la versión reducida.
 */
export const SAFARI_MAX_PX = 16_777_216;
const DIR = '.app/cache/img';

/**
 * Lado mayor que hace falta para mostrarla a lo ancho de `boxW` px CSS a densidad `dpr` (≤ 2): el
 * panel la ajusta al ancho, como siempre (las altas se desplazan).
 */
export function neededSide(natW: number, natH: number, boxW: number, dpr = 1): number {
  const d = Math.min(2, Math.max(1, dpr || 1));
  return Math.ceil(Math.max(natW, natH) * Math.min(1, (boxW * d) / natW));
}
/** Escalón para un lado mayor necesario; `null` si el original ya es pequeño (se usa tal cual). */
export function stepFor(natW: number, natH: number, need: number): number | null {
  const big = Math.max(natW, natH);
  const step = STEPS.find((s) => s >= need) ?? STEPS[STEPS.length - 1]!;
  return step >= big ? null : step;
}
export const tooBig = (natW: number, natH: number) => natW * natH > SAFARI_MAX_PX;
/** Tamaño de la versión reducida con lado mayor `side`. */
export function scaled(natW: number, natH: number, side: number): [number, number] {
  const s = Math.min(1, side / Math.max(natW, natH));
  return [Math.max(1, Math.round(natW * s)), Math.max(1, Math.round(natH * s))];
}
/** Ruta en caché: huella de (ruta, tamaño, fecha) + escalón. Si el original cambia, cambia la huella. */
async function cachePath(vault: VaultAdapter, path: string, side: number): Promise<string | null> {
  const st = await vault.stat(path);
  if (!st) return null;
  const ext = /\.jpe?g$/i.test(path) ? 'jpg' : 'png';
  return `${DIR}/${checksum(new TextEncoder().encode(`${path}|${st.size}|${st.mtime}`))}-${side}.${ext}`;
}

/** Medidas del original sin decodificarlo entero (cabecera PNG/JPEG); `null` si no se reconoce. */
export function imageSize(b: Uint8Array): [number, number] | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b.length > 24) return [(b[16]! << 24 | b[17]! << 16 | b[18]! << 8 | b[19]!) >>> 0, (b[20]! << 24 | b[21]! << 16 | b[22]! << 8 | b[23]!) >>> 0];
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1]!, len = (b[i + 2]! << 8) | b[i + 3]!;
      // SOF0…SOF15 salvo DHT (C4), JPG (C8) y DAC (CC)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [(b[i + 7]! << 8) | b[i + 8]!, (b[i + 5]! << 8) | b[i + 6]!];
      i += 2 + len;
    }
  }
  return null;
}

/**
 * Versión reducida (lado mayor `side`) del original, generada si falta. Decodifica con
 * `createImageBitmap` (fuera del hilo principal donde el navegador puede) pidiendo ya el tamaño
 * final; si el navegador ignora `resizeWidth`, se reduce dibujando en un lienzo.
 */
export async function reducedImage(vault: VaultAdapter, path: string, side: number): Promise<string | null> {
  const dst = await cachePath(vault, path, side);
  if (!dst) return null;
  if (await vault.exists(dst)) return dst;
  const bytes = await vault.read(path);
  const dims = imageSize(bytes);
  if (!dims) return null;
  const [w, h] = scaled(dims[0], dims[1], side);
  const blob = new Blob([bytes as BlobPart], { type: /\.png$/i.test(path) ? 'image/png' : /\.jpe?g$/i.test(path) ? 'image/jpeg' : '' });
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' }); } catch { return null; }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const type = dst.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
  const out = await new Promise<Blob | null>((res) => c.toBlob(res, type, 0.86));
  c.width = c.height = 0;
  if (!out) return null;
  await vault.write(dst, new Uint8Array(await out.arrayBuffer()));
  return dst;
}
