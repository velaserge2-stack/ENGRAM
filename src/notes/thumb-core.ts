/**
 * Miniatura JPEG (lado mayor `long`, calidad 0.7) a partir de una imagen. Sirve en un Worker
 * (OffscreenCanvas) y en la ventana. Intenta decodificar ya reducida
 * (`createImageBitmap` con `resizeWidth`); si el navegador no lo admite, decodifica entera y
 * reduce en canvas por pasos de la mitad (mejor calidad y tope de memoria por paso).
 */
export const THUMB_LONG = 1200;

type Canvas = OffscreenCanvas | HTMLCanvasElement;
function canvas(w: number, h: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return Object.assign(document.createElement('canvas'), { width: w, height: h });
}
const toJpeg = (c: Canvas, q: number): Promise<Blob> =>
  'convertToBlob' in c ? c.convertToBlob({ type: 'image/jpeg', quality: q }) : new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('jpeg'))), 'image/jpeg', q));

/** `dims`: ancho y alto ya orientados si se conocen (de `imageSize`); sin ellos, se decodifica entera. */
export async function makeThumb(blob: Blob, dims: { w: number; h: number } | null, long = THUMB_LONG): Promise<{ blob: Blob; w: number; h: number }> {
  let bmp: ImageBitmap | null = null;
  if (dims) {
    const s = Math.min(1, long / Math.max(dims.w, dims.h));
    try { bmp = await createImageBitmap(blob, { resizeWidth: Math.max(1, Math.round(dims.w * s)), resizeQuality: 'medium' }); } catch { bmp = null; }
  }
  bmp ??= await createImageBitmap(blob); // lanza si el formato no se puede decodificar (HEIC en Chrome…)
  let src: CanvasImageSource = bmp;
  let w = bmp.width, h = bmp.height;
  const s = Math.min(1, long / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * s)), th = Math.max(1, Math.round(h * s));
  // por pasos: nunca más de la mitad por vez (calidad) y nunca un lienzo mayor que el anterior
  while (w / 2 > tw) {
    const c = canvas(Math.round(w / 2), Math.round(h / 2));
    const x = c.getContext('2d') as CanvasRenderingContext2D;
    x.drawImage(src, 0, 0, c.width, c.height);
    if (src !== bmp && 'width' in src) (src as Canvas).width = 0; // liberar el paso anterior
    (src = c), (w = c.width), (h = c.height);
  }
  const out = canvas(tw, th);
  const x = out.getContext('2d') as CanvasRenderingContext2D;
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, tw, th);
  bmp.close();
  return { blob: await toJpeg(out, 0.7), w: tw, h: th };
}
