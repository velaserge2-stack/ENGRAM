/**
 * Miniaturas de fotos (Notas-Pro · A1). Única función y única ubicación: `.app/thumbs/`.
 * Es una caché: si falta se regenera al ver la imagen; borrar la carpeta no pierde nada.
 * - Original ≤ 1 MB (las fotos guardadas antes ya venían comprimidas): se muestra tal cual.
 * - Mayor: miniatura JPEG de lado ≤ 1200 px, generada de una en una (Worker si puede).
 * - Formato que el navegador no decodifica (HEIC fuera de Safari…): `{ missing }` → marcador.
 * Las URL se cuentan por uso (`acquire`/`release`) y se revocan cuando nadie las usa.
 */
import type { VaultAdapter } from '../vault/types';
import { imageSize } from './imgsize';
import { makeThumb } from './thumb-core';
import { perf } from '../lib/perf';

export const THUMBS_DIR = '.app/thumbs';
const SMALL = 1_000_000;
const HUGE = 25_000_000;

export type Shown = { url: string; w: number; h: number; heavy?: boolean; missing?: undefined } | { missing: true; name: string; url: string };

const key = (path: string) => `${THUMBS_DIR}/${path.replace(/^media\//, '').replace(/\//g, '__')}.jpg`;
const TYPE: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp' };
const typeOf = (path: string) => TYPE[path.split('.').pop()!.toLowerCase()] ?? '';

/** Proporción conocida (para reservar el alto antes de cargar y que no salte el desplazamiento). */
export const dimsOf = new Map<string, { w: number; h: number }>();
// también en la caché (`dims.json`), para que al reabrir la nota las fotos aún no cargadas ya ocupen su alto
const DIMS = `${THUMBS_DIR}/dims.json`;
let dimsLoad: Promise<void> | null = null;
let dimsT: ReturnType<typeof setTimeout> | undefined;
export function loadDims(vault: VaultAdapter): Promise<void> {
  return (dimsLoad ??= vault.read(DIMS).then((b) => {
    for (const [k, v] of Object.entries(JSON.parse(new TextDecoder().decode(b)) as Record<string, [number, number]>)) if (!dimsOf.has(k)) dimsOf.set(k, { w: v[0], h: v[1] });
  }).catch(() => {}));
}
export function remember(vault: VaultAdapter, path: string, d: { w: number; h: number }) {
  const old = dimsOf.get(path);
  dimsOf.set(path, d);
  if (old && old.w * d.h === old.h * d.w) return; // misma proporción: nada que guardar
  clearTimeout(dimsT);
  dimsT = setTimeout(() => void vault.write(DIMS, JSON.stringify(Object.fromEntries([...dimsOf].map(([k, v]) => [k, [v.w, v.h]])))).catch(() => {}), 1500);
}

const live = new Map<string, { p: Promise<Shown | null>; n: number; t?: ReturnType<typeof setTimeout> }>();

let worker: Worker | null | undefined;
let seq = 0;
const waiting = new Map<number, (r: { blob: Blob; w: number; h: number } | null) => void>();
function viaWorker(blob: Blob, dims: { w: number; h: number } | null): Promise<{ blob: Blob; w: number; h: number } | null> {
  if (worker === undefined) {
    try {
      worker = new Worker(new URL('./thumb.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; res?: { blob: Blob; w: number; h: number } }>) => { waiting.get(e.data.id)?.(e.data.ok ? e.data.res! : null); waiting.delete(e.data.id); };
    } catch { worker = null; }
  }
  if (!worker) return Promise.resolve(null);
  const id = ++seq;
  return new Promise((res) => { waiting.set(id, res); worker!.postMessage({ id, blob, dims }); });
}

// de una en una (lectura y reducción): una foto de 12 MP decodificada ocupa ~48 MB; dos a la vez ya pesan en el iPad
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(f: () => Promise<T>): Promise<T> => { const r = queue.then(f, f); queue = r.catch(() => {}); return r; };

async function build(vault: VaultAdapter, path: string): Promise<Shown | null> {
  const k = key(path);
  if (await vault.exists(k).catch(() => false)) {
    const t = await vault.read(k);
    const d = dimsOf.get(path) ?? imageSize(t);
    if (d) remember(vault, path, d);
    return { url: URL.createObjectURL(new Blob([t as BlobPart], { type: 'image/jpeg' })), w: d?.w ?? 0, h: d?.h ?? 0 };
  }
  return serial(() => fromOriginal(vault, path, k));
}

async function fromOriginal(vault: VaultAdapter, path: string, k: string): Promise<Shown | null> {
  let bytes: Uint8Array;
  try { bytes = await vault.read(path); } catch { return null; }
  const type = typeOf(path);
  const d = imageSize(bytes);
  if (d) remember(vault, path, d);
  const original = (): Shown => ({ url: URL.createObjectURL(new Blob([bytes as BlobPart], { type })), w: d?.w ?? 0, h: d?.h ?? 0, heavy: bytes.length > HUGE });
  if (bytes.length <= SMALL || type === 'image/svg+xml' || type === 'image/gif') return original(); // GIF: conservar la animación
  const blob = new Blob([bytes as BlobPart], { type });
  const thumb = (await viaWorker(blob, d)) ?? (await makeThumb(blob, d).catch(() => null));
  if (!thumb) {
    // no se pudo reducir: si el navegador sabe mostrarla, el original; si no, marcador
    const can = await createImageBitmap(new Blob([bytes as BlobPart], { type })).then((b) => (b.close(), true), () => false);
    return can ? original() : { missing: true, name: path.split('/').pop()!, url: URL.createObjectURL(blob) }; // el original, para abrirlo o descargarlo
  }
  remember(vault, path, { w: thumb.w, h: thumb.h });
  perf.inc('thumb:gen');
  await vault.write(k, new Uint8Array(await thumb.blob.arrayBuffer())).catch(() => {}); // caché: si falla, se regenera otra vez
  return { url: URL.createObjectURL(thumb.blob), w: thumb.w, h: thumb.h };
}

/** URL para mostrar una imagen de la bóveda (miniatura o el original pequeño). Llamar a `releaseThumb` al dejar de usarla. */
export function mediaThumbUrl(vault: VaultAdapter, path: string): Promise<Shown | null> {
  let e = live.get(path);
  if (!e) live.set(path, (e = { p: build(vault, path), n: 0 }));
  perf.c['thumb:live'] = live.size; // URL de imágenes vivas (memoria)
  clearTimeout(e.t);
  e.n++;
  return e.p;
}

export function releaseThumb(path: string) {
  const e = live.get(path);
  if (!e || --e.n > 0) return;
  // margen: al reescribir una nota el mismo bloque vuelve a pedirla enseguida
  e.t = setTimeout(() => { live.delete(path); perf.c['thumb:live'] = live.size; void e.p.then((r) => r && URL.revokeObjectURL(r.url)); }, 20_000);
}

/** Vaciar la caché (Ajustes → Almacenamiento): solo miniaturas; los originales no se tocan. */
export async function clearThumbs(vault: VaultAdapter) {
  clearTimeout(dimsT);
  await vault.remove(THUMBS_DIR).catch(() => {});
  dimsOf.clear();
  dimsLoad = null;
}

/** Para Word/PDF (A2): HEIC, WebP, AVIF o SVG → JPEG (fotos) o PNG (con transparencia). Solo al exportar. */
export async function convertForExport(bytes: Uint8Array, name: string): Promise<{ data: Uint8Array; type: 'jpg' | 'png' } | null> {
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: typeOf(name) }));
    const png = /\.(webp|svg|avif)$/i.test(name);
    const c = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, png ? 'image/png' : 'image/jpeg', 0.92));
    c.width = 0;
    return blob ? { data: new Uint8Array(await blob.arrayBuffer()), type: png ? 'png' : 'jpg' } : null;
  } catch {
    return null;
  }
}

/**
 * Imprimir/PDF con los originales (A2): cambia cada miniatura de `root` por su original (o su
 * conversión si el navegador no lo muestra), de una en una y esperando a que cargue. Devuelve
 * la función que deja todo como estaba (y libera la memoria) tras imprimir.
 */
export async function swapToOriginals(vault: VaultAdapter, root: ParentNode, resolve: (name: string) => Promise<string | null>): Promise<() => void> {
  const undo: (() => void)[] = [];
  for (const img of root.querySelectorAll<HTMLImageElement>('img[data-media]')) {
    const path = await resolve(img.dataset.media!);
    if (!path) continue;
    let bytes: Uint8Array;
    try { bytes = await vault.read(path); } catch { continue; }
    const ok = await createImageBitmap(new Blob([bytes as BlobPart], { type: typeOf(path) })).then((b) => (b.close(), true), () => false);
    const conv = ok ? null : await convertForExport(bytes, path);
    if (!ok && !conv) continue;
    const url = URL.createObjectURL(new Blob([(conv?.data ?? bytes) as BlobPart], { type: conv ? (conv.type === 'png' ? 'image/png' : 'image/jpeg') : typeOf(path) }));
    const prev = img.getAttribute('src');
    img.src = url;
    await img.decode().catch(() => {});
    undo.push(() => { if (prev) img.src = prev; else img.removeAttribute('src'); URL.revokeObjectURL(url); });
  }
  let done = false;
  return () => { if (!done) (done = true), undo.forEach((f) => f()); };
}
