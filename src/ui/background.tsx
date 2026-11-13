import { t } from '../i18n';
/**
 * Fondos personalizables (Cristal §5) y guardián de legibilidad (§6).
 * Los fondos integrados son originales y se dibujan en código (degradados de
 * malla, ruido, patrones). El fondo vive en una capa fija propia.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Background, Settings } from '../lib/settings';
import { DEFAULT_FRAMING, framedRect, framingStyle, isDefault, type Framing } from '../lib/framing';
import type { VaultAdapter } from '../vault/types';
import { contrast } from '../lib/palette';

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

function mesh(base: string, blobs: [number, number, number, string][]): Draw {
  return (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const m = Math.max(w, h);
    for (const [x, y, r, c] of blobs) {
      const g = ctx.createRadialGradient(x * w, y * h, 0, x * w, y * h, r * m);
      g.addColorStop(0, c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  };
}

function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export const BUILTINS: { id: string; name: string; draw: Draw }[] = [
  { id: 'bruma', name: 'Bruma', draw: mesh('#1d2430', [[0.15, 0.1, 0.7, 'rgba(92,108,140,.9)'], [0.9, 0.3, 0.6, 'rgba(60,86,110,.8)'], [0.5, 1, 0.7, 'rgba(120,104,130,.6)']]) },
  { id: 'aurora', name: 'Aurora', draw: mesh('#0c1022', [[0.1, 0.2, 0.6, 'rgba(0,170,160,.85)'], [0.8, 0.1, 0.55, 'rgba(120,70,220,.85)'], [0.6, 0.9, 0.7, 'rgba(230,60,140,.7)']]) },
  { id: 'duna', name: 'Duna', draw: mesh('#e9d8c4', [[0.2, 0.2, 0.7, 'rgba(244,190,140,.9)'], [0.85, 0.75, 0.6, 'rgba(200,150,120,.8)'], [0.5, 0.5, 0.4, 'rgba(255,240,220,.6)']]) },
  { id: 'bosque', name: 'Bosque', draw: mesh('#13261d', [[0.2, 0.8, 0.7, 'rgba(40,120,80,.9)'], [0.9, 0.2, 0.6, 'rgba(110,150,90,.7)'], [0.5, 0.4, 0.4, 'rgba(20,60,50,.6)']]) },
  { id: 'neon', name: 'Neón', draw: mesh('#ff3d7f', [[0.15, 0.15, 0.6, 'rgba(255,170,0,.95)'], [0.85, 0.8, 0.6, 'rgba(255,0,140,.9)'], [0.8, 0.1, 0.5, 'rgba(255,90,200,.8)']]) },
  { id: 'niebla', name: 'Niebla', draw: mesh('#e8eaee', [[0.2, 0.1, 0.7, 'rgba(255,255,255,.9)'], [0.8, 0.9, 0.7, 'rgba(196,204,214,.8)']]) },
  {
    id: 'rayas', name: 'Rayas', draw: (ctx, w, h) => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#000';
      const s = Math.max(4, w / 24);
      for (let x = -h; x < w; x += s * 2) {
        ctx.beginPath();
        ctx.moveTo(x, 0); ctx.lineTo(x + s, 0); ctx.lineTo(x + s + h, h); ctx.lineTo(x + h, h);
        ctx.fill();
      }
    },
  },
  {
    id: 'cuadricula', name: 'Cuadrícula', draw: (ctx, w, h) => {
      ctx.fillStyle = '#20232a';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,.08)';
      const s = Math.max(6, w / 30);
      for (let x = 0; x < w; x += s) (ctx.beginPath(), ctx.moveTo(x, 0), ctx.lineTo(x, h), ctx.stroke());
      for (let y = 0; y < h; y += s) (ctx.beginPath(), ctx.moveTo(0, y), ctx.lineTo(w, y), ctx.stroke());
      mesh('rgba(0,0,0,0)', [[0.3, 0.3, 0.6, 'rgba(70,90,140,.5)']])(ctx, w, h);
    },
  },
  {
    id: 'ruido', name: 'Grano', draw: (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      const r = rng(7);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 70 + r() * 50;
        img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v + 6; img.data[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    },
  },
];

// "Foto" de prueba original, generada en código (cielo, sol, colinas y grano)
BUILTINS.push({
  id: 'paisaje', name: 'Paisaje', draw: (ctx, w, h) => {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#2b6cb0'); sky.addColorStop(0.55, '#f6ad55'); sky.addColorStop(1, '#c05621');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    const sun = ctx.createRadialGradient(w * 0.7, h * 0.45, 0, w * 0.7, h * 0.45, h * 0.25);
    sun.addColorStop(0, 'rgba(255,250,220,1)'); sun.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, w, h);
    const hill = (y: number, amp: number, c: string) => {
      ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += w / 40) ctx.lineTo(x, y + Math.sin(x / (w / 6)) * amp + Math.cos(x / (w / 2.3)) * amp * 0.6);
      ctx.lineTo(w, h); ctx.fill();
    };
    hill(h * 0.62, h * 0.05, '#4a5568'); hill(h * 0.72, h * 0.06, '#2d3748'); hill(h * 0.84, h * 0.04, '#1a202c');
    const img = ctx.getImageData(0, 0, w, h); const r = rng(3);
    for (let i = 0; i < img.data.length; i += 4) { const n = (r() - 0.5) * 18; img.data[i]! += n; img.data[i + 1]! += n; img.data[i + 2]! += n; }
    ctx.putImageData(img, 0, 0);
  },
});

export const SOLIDS = ['#000000', '#1c1c1e', '#3a3a3c', '#8e8e93', '#d1d1d6', '#ffffff', '#1f2a44', '#3b2f2f', '#2e3b2e'];

/** URL de objeto de un fondo de imagen (caché por ruta). */
const urlCache = new Map<string, string>();
/** Olvida la URL en caché (el archivo cambió o se borró). */
export function forgetMediaUrl(path: string) {
  const u = urlCache.get(path);
  if (u) (URL.revokeObjectURL(u), urlCache.delete(path));
}
/**
 * Prompt 14: préstamos. Quien pide con `acquireMediaUrl` la devuelve con `releaseMediaUrl`; cuando
 * nadie la tiene prestada se revoca (nota cerrada, panel cerrado o dormido). `mediaUrl` sin préstamo
 * (fondos, miniaturas…) la deja fija para siempre, como antes.
 */
const loans = new Map<string, number>();
const pinned = new Set<string>();
const loading = new Map<string, Promise<string | null>>();
function load(vault: VaultAdapter, path: string, type: string): Promise<string | null> {
  if (urlCache.has(path)) return Promise.resolve(urlCache.get(path)!);
  let p = loading.get(path);
  if (!p) {
    p = vault.read(path).then((bytes) => {
      // devuelta antes de terminar de leer: no se crea (sin fuga)
      if (!pinned.has(path) && !loans.get(path)) return null;
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], type ? { type } : {}));
      urlCache.set(path, url);
      return url;
    }, () => null).finally(() => loading.delete(path));
    loading.set(path, p);
  }
  return p;
}
export function mediaUrl(vault: VaultAdapter, path: string, type = ''): Promise<string | null> {
  pinned.add(path);
  return load(vault, path, type);
}
export function acquireMediaUrl(vault: VaultAdapter, path: string, type = ''): Promise<string | null> {
  loans.set(path, (loans.get(path) ?? 0) + 1);
  return load(vault, path, type);
}
export function releaseMediaUrl(path: string) {
  const n = (loans.get(path) ?? 1) - 1;
  if (n > 0) return void loans.set(path, n);
  loans.delete(path);
  if (!pinned.has(path)) forgetMediaUrl(path);
}

function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource & { width: number; height: number }, w: number, h: number) {
  const s = Math.max(w / src.width, h / src.height);
  const dw = src.width * s;
  const dh = src.height * s;
  ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
}

/** ¿El canvas sabe aplicar `filter` (Safari antiguo no)? */
let filterOk: boolean | null = null;
function canFilter(ctx: CanvasRenderingContext2D): boolean {
  if (filterOk === null) {
    filterOk = 'filter' in ctx;
    if (filterOk) {
      const prev = ctx.filter;
      ctx.filter = 'blur(2px)';
      filterOk = ctx.filter === 'blur(2px)';
      ctx.filter = prev;
    }
  }
  return filterOk;
}

/**
 * Desenfoque de `src` dibujado sobre `ctx` en (x, y, w, h). Con `ctx.filter` si existe; si no, reducir
 * y volver a ampliar con suavizado (aproximación barata, igual en cualquier navegador).
 */
export function blurInto(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, px: number, x = 0, y = 0, w = src.width, h = src.height, scale = 1) {
  const dx = x - (w * (scale - 1)) / 2, dy = y - (h * (scale - 1)) / 2, dw = w * scale, dh = h * scale;
  if (px <= 0.5) return void ctx.drawImage(src, dx, dy, dw, dh);
  if (canFilter(ctx)) {
    ctx.save();
    ctx.filter = `blur(${px}px)`;
    ctx.drawImage(src, dx, dy, dw, dh);
    ctx.restore();
    return;
  }
  const k = Math.max(1, px / 2);
  const t = document.createElement('canvas');
  t.width = Math.max(1, Math.round(src.width / k));
  t.height = Math.max(1, Math.round(src.height / k));
  const c = t.getContext('2d')!;
  c.imageSmoothingQuality = 'high';
  c.drawImage(src, 0, 0, t.width, t.height);
  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(t, dx, dy, dw, dh);
  ctx.restore();
  t.width = t.height = 0;
}

/**
 * Pinta el fondo activo en un canvas de `w×h`, con la misma cuenta que la capa de fondo: integrados
 * dibujados a la resolución reducida de la capa (`builtinW`, los patrones dependen del tamaño), fotos
 * con su encuadre (cover + posición + zoom), desenfoque (con el 1.08 de la capa) y velo de atenuación.
 * Lo usan el guardián de legibilidad (muestra 64 px) y la imagen de «Compartir estadísticas».
 */
export function paintBackground(ctx: CanvasRenderingContext2D, bg: Background, img: (CanvasImageSource & { width: number; height: number }) | null, w: number, h: number, o: { framing?: Framing; dim: number; blur?: number; builtinW?: number }) {
  const blur = o.blur ?? 0;
  const layer = blur ? Object.assign(document.createElement('canvas'), { width: w, height: h }) : null;
  const c = layer ? layer.getContext('2d')! : ctx;
  if (bg.kind === 'solid') (c.fillStyle = bg.value), c.fillRect(0, 0, w, h);
  else if (bg.kind === 'builtin') {
    const big = document.createElement('canvas');
    big.width = Math.round(o.builtinW ?? w / 2);
    big.height = Math.round((big.width * h) / Math.max(1, w));
    (BUILTINS.find((b) => b.id === bg.value) ?? BUILTINS[0]!).draw(big.getContext('2d')!, big.width, big.height);
    c.drawImage(big, 0, 0, w, h);
    big.width = big.height = 0;
  } else if (img) {
    const r = framedRect(img.width, img.height, w, h, o.framing);
    c.drawImage(img, r.x, r.y, r.w, r.h);
  }
  if (layer) (blurInto(ctx, layer, blur, 0, 0, w, h, 1.08), (layer.width = layer.height = 0));
  if (o.dim) {
    ctx.fillStyle = o.dim < 0 ? `rgba(0,0,0,${-o.dim / 100})` : `rgba(255,255,255,${o.dim / 100})`;
    ctx.fillRect(0, 0, w, h);
  }
}

/** Imagen decodificada de un fondo propio (null si no es foto o no se pudo leer). */
export async function backgroundImage(bg: Background, vault: VaultAdapter): Promise<HTMLImageElement | null> {
  if (bg.kind !== 'image') return null;
  const url = await mediaUrl(vault, bg.value);
  return url ? loadImage(url).catch(() => null) : null;
}

/** Muestra 64×64 de lo que se ve detrás de la interfaz (con proporción de la ventana). */
export async function sampleBackground(bg: Background, vault: VaultAdapter, dim: number, vw: number, vh: number, framing: Framing = DEFAULT_FRAMING): Promise<ImageData> {
  const W = 64;
  const H = Math.max(16, Math.round((64 * vh) / Math.max(1, vw)));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  paintBackground(ctx, bg, await backgroundImage(bg, vault), W, H, { framing, dim, builtinW: 480 });
  return ctx.getImageData(0, 0, W, H);
}

/** Redimensiona una imagen elegida (máx. 2400 px) y crea miniatura de 256 px. */
export async function importBackground(vault: VaultAdapter, file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const enc = async (max: number, cover: boolean) => {
      const s = cover ? max / Math.min(img.width, img.height) : Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = cover ? max : Math.round(img.width * s);
      c.height = cover ? max : Math.round(img.height * s);
      const ctx = c.getContext('2d')!;
      if (cover) drawCover(ctx, img, max, max);
      else ctx.drawImage(img, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error(t('background.no_se_pudo_codificar')))), 'image/jpeg', 0.86));
      return new Uint8Array(await blob.arrayBuffer());
    };
    const id = Date.now().toString(36);
    const path = `media/.app/fondos/${id}.jpg`;
    await vault.write(path, await enc(2400, false));
    await vault.write(`media/.app/fondos/${id}-thumb.jpg`, await enc(256, true));
    return path;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Miniatura cuadrada de 256 px con el encuadre elegido (se regenera al reencuadrar). */
export async function regenThumb(vault: VaultAdapter, path: string, f: Framing): Promise<void> {
  const url = await mediaUrl(vault, path);
  if (!url) return;
  const img = await loadImage(url);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const r = framedRect(img.width, img.height, 256, 256, f);
  c.getContext('2d')!.drawImage(img, r.x, r.y, r.w, r.h);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('jpeg'))), 'image/jpeg', 0.86));
  const thumb = path.replace(/\.jpg$/, '-thumb.jpg');
  await vault.write(thumb, new Uint8Array(await blob.arrayBuffer()));
  forgetMediaUrl(thumb);
}

/** Borra un fondo subido (imagen y miniatura). */
export async function deleteBackground(vault: VaultAdapter, path: string): Promise<void> {
  for (const p of [path, path.replace(/\.jpg$/, '-thumb.jpg')]) if (await vault.exists(p)) (await vault.remove(p), forgetMediaUrl(p));
}

export function BuiltinThumb(props: { id: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    (BUILTINS.find((b) => b.id === props.id) ?? BUILTINS[0]!).draw(c.getContext('2d')!, c.width, c.height);
  }, [props.id]);
  return <canvas ref={ref} width={128} height={128} aria-hidden="true" />;
}

/** Capa de fondo: canvas (integrado), <img> (propio) o color sólido. */
export function BackgroundLayer(props: { bg: Background; blur: number; dim: number; vault: VaultAdapter; framing?: Framing }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const { bg } = props;
  useEffect(() => {
    if (bg.kind === 'image') void mediaUrl(props.vault, bg.value).then(setUrl);
    if (bg.kind !== 'builtin') return;
    const draw = () => {
      const c = ref.current;
      if (!c) return;
      // media resolución basta: son degradados suaves; ahorra memoria en iPad
      c.width = Math.round(innerWidth / 2);
      c.height = Math.round(innerHeight / 2);
      (BUILTINS.find((b) => b.id === bg.value) ?? BUILTINS[0]!).draw(c.getContext('2d')!, c.width, c.height);
    };
    draw();
    addEventListener('resize', draw);
    return () => removeEventListener('resize', draw);
  }, [bg.kind, bg.value]);
  const style = { '--bg-blur': `${props.blur}px`, '--bg-scale': props.blur ? '1.08' : '1' };
  const veil = props.dim < 0 ? `rgba(0,0,0,${-props.dim / 100})` : props.dim > 0 ? `rgba(255,255,255,${props.dim / 100})` : 'transparent';
  return (
    <>
      <div class="bg-layer" style={style} aria-hidden="true" data-bg>
        {bg.kind === 'builtin' && <canvas ref={ref} />}
        {bg.kind === 'image' && url && <img src={url} alt="" style={props.framing && !isDefault(props.framing) ? framingStyle(props.framing) : undefined} />}
        {bg.kind === 'solid' && <div class="solid" style={{ background: bg.value }} />}
      </div>
      <div class="bg-veil" style={{ background: veil }} aria-hidden="true" data-bg />
    </>
  );
}

// ───────── guardián de legibilidad ─────────

type RGB = [number, number, number];
const GLASS: Record<'dark' | 'light', { rgb: RGB; a: number; t1: [RGB, number]; t2: [RGB, number] }> = {
  dark: { rgb: [24, 24, 27], a: 0.58, t1: [[255, 255, 255], 0.94], t2: [[255, 255, 255], 0.64] },
  light: { rgb: [255, 255, 255], a: 0.52, t1: [[0, 0, 0], 0.9], t2: [[0, 0, 0], 0.6] },
};

const hex = (c: RGB) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const over = (top: RGB, a: number, under: RGB): RGB => [0, 1, 2].map((i) => top[i]! * a + under[i]! * (1 - a)) as RGB;

/** Colores del vidrio y del texto de un modo (los mismos que usa el CSS): para dibujar fuera del DOM. */
export function glassInk(mode: 'dark' | 'light') {
  const g = GLASS[mode];
  return { rgb: g.rgb, t1: g.t1, t2: g.t2 };
}

/** Alfa efectivo del velo según la intensidad del vidrio (igual que en el CSS). */
export function glassAlpha(mode: 'dark' | 'light', k: number): number {
  return GLASS[mode].a * ((mode === 'dark' ? 1.25 : 1.3) - 0.5 * k);
}

/** Contraste mínimo (percentil 5) del texto secundario sobre un panel dado. */
export function panelContrast(cells: RGB[], mode: 'dark' | 'light', alpha: number): { t1: number; t2: number } {
  const g = GLASS[mode];
  const c1: number[] = [];
  const c2: number[] = [];
  for (const b of cells) {
    const comp = over(g.rgb, alpha, b);
    c1.push(contrast(hex(over(g.t1[0], g.t1[1], comp)), hex(comp)));
    c2.push(contrast(hex(over(g.t2[0], g.t2[1], comp)), hex(comp)));
  }
  const p5 = (a: number[]) => (a.sort((x, y) => x - y), a[Math.floor(a.length * 0.05)] ?? 21);
  return { t1: p5(c1), t2: p5(c2) };
}

export interface GuardResult {
  panels: number;
  adjusted: number;
  minContrast: number;
}

/** Revisa cada panel de vidrio y corrige: (1) más opacidad, (2) cambiar modo, (3) atenuar fondo. */
export function guard(sample: ImageData, rootMode: 'dark' | 'light', k: number, root: ParentNode = document): GuardResult {
  const W = sample.width;
  const H = sample.height;
  const vw = innerWidth;
  const vh = innerHeight;
  let adjusted = 0;
  let minContrast = 21;
  const panels = [...root.querySelectorAll<HTMLElement>('.glass')].filter((el) => !el.parentElement?.closest('.glass'));
  for (const el of panels) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > vh) continue;
    const x0 = Math.max(0, Math.floor((r.left / vw) * W));
    const x1 = Math.min(W - 1, Math.ceil((r.right / vw) * W));
    const y0 = Math.max(0, Math.floor((r.top / vh) * H));
    const y1 = Math.min(H - 1, Math.ceil((Math.min(r.bottom, vh) / vh) * H));
    const cells: RGB[] = [];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = (y * W + x) * 4;
        cells.push([sample.data[i]!, sample.data[i + 1]!, sample.data[i + 2]!]);
      }
    if (!cells.length) continue;
    const strong = el.classList.contains('strong');
    let mode = rootMode;
    let a = strong ? (el.classList.contains('sheet') ? 0.88 : 0.82) : glassAlpha(mode, k);
    let c = panelContrast(cells, mode, a);
    el.style.removeProperty('--glass');
    delete el.dataset.glass;
    delete el.dataset.guard;
    if (c.t2 < 4.5) {
      // (1) subir opacidad del velo
      while (c.t2 < 4.5 && a < 0.9) c = panelContrast(cells, mode, (a = Math.min(0.9, a + 0.06)));
      // (2) cambiar el modo del panel
      if (c.t2 < 4.5) {
        const other = mode === 'dark' ? 'light' : 'dark';
        let a2 = glassAlpha(other, k);
        let c2 = panelContrast(cells, other, a2);
        while (c2.t2 < 4.5 && a2 < 0.9) c2 = panelContrast(cells, other, (a2 = Math.min(0.9, a2 + 0.06)));
        if (c2.t2 > c.t2) ((mode = other), (a = a2), (c = c2), (el.dataset.glass = other));
      }
      // (3) último recurso: velo casi opaco
      if (c.t2 < 4.5) c = panelContrast(cells, mode, (a = 0.96));
      el.style.setProperty('--glass', `rgba(${GLASS[mode].rgb.join(',')}, ${a.toFixed(2)})`);
      el.dataset.guard = c.t2.toFixed(2);
      adjusted++;
    }
    minContrast = Math.min(minContrast, c.t2);
  }
  return { panels: panels.length, adjusted, minContrast };
}

/**
 * Firma del desarrollador (Prompt 7 · 3): texto plano sobre el fondo, sin vidrio. El guardián
 * elige su tono (claro u oscuro) según el fondo que tiene debajo y estima el contraste con el
 * halo neutro del tono opuesto (tres sombras apiladas: alfa efectivo junto a las letras ≈ 0,85). Claro: opacidad 0,38; oscuro: 0,45 (con
 * 0,38 el negro sobre blanco queda en ≈ 2,7:1). Devuelve el contraste estimado (percentil 5).
 */
export const SIGN_ALPHA = { light: 0.38, dark: 0.45 } as const;
export function signContrast(cells: RGB[], tone: 'light' | 'dark'): number {
  const fg: RGB = tone === 'light' ? [255, 255, 255] : [0, 0, 0];
  const halo: RGB = tone === 'light' ? [0, 0, 0] : [255, 255, 255];
  const cs = cells.map((c) => { const local = over(halo, 0.85, c); return contrast(hex(over(fg, SIGN_ALPHA[tone], local)), hex(local)); });
  cs.sort((a, b) => a - b);
  return cs[Math.floor(cs.length * 0.05)] ?? 21;
}
export function toneSign(sample: ImageData, root: ParentNode = document): number | null {
  const el = root.querySelector<HTMLElement>('.dev-sign');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  const W = sample.width, H = sample.height;
  const cells: RGB[] = [];
  for (let y = Math.max(0, Math.floor((r.top / innerHeight) * H)); y <= Math.min(H - 1, Math.ceil((r.bottom / innerHeight) * H)); y++)
    for (let x = Math.max(0, Math.floor((r.left / innerWidth) * W)); x <= Math.min(W - 1, Math.ceil((r.right / innerWidth) * W)); x++) {
      const i = (y * W + x) * 4;
      cells.push([sample.data[i]!, sample.data[i + 1]!, sample.data[i + 2]!]);
    }
  if (!cells.length) return null;
  const light = signContrast(cells, 'light'), dark = signContrast(cells, 'dark');
  el.dataset.tone = light >= dark ? 'light' : 'dark';
  return Math.max(light, dark);
}
