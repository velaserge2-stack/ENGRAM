// Deriva todos los íconos y logos a partir de assets/brand/logo-original.png (que NO se modifica).
// Muestrea el color de fondo en las esquinas, encuentra la caja del logo y lo recentra.
//   PLAYWRIGHT_PATH=… node scripts/icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = new URL('../', import.meta.url).pathname;
const src = `data:image/png;base64,${readFileSync(root + 'assets/brand/logo-original.png').toString('base64')}`;

const b = await chromium.launch();
const page = await b.newPage();
await page.setContent('<html><body></body></html>');
const result = await page.evaluate(async (src) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  const W = img.width, H = img.height;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, W, H).data;
  // color de fondo: promedio de 4 parches de 8×8 en las esquinas
  let r = 0, g = 0, bl = 0, n = 0;
  for (const [x0, y0] of [[0, 0], [W - 8, 0], [0, H - 8], [W - 8, H - 8]])
    for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) { const i = (y * W + x) * 4; r += d[i]; g += d[i + 1]; bl += d[i + 2]; n++; }
  const bg = [r / n, g / n, bl / n].map(Math.round);
  // caja del logo: píxeles claramente más claros que el fondo
  let minX = W, minY = H, maxX = 0, maxY = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (d[i] + d[i + 1] + d[i + 2] - (bg[0] + bg[1] + bg[2]) > 60) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  const box = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  const hex = '#' + bg.map((v) => v.toString(16).padStart(2, '0')).join('');
  const make = (size, frac, maskable = false) => {
    const o = Object.assign(document.createElement('canvas'), { width: size, height: size });
    const x = o.getContext('2d');
    x.fillStyle = hex;
    x.fillRect(0, 0, size, size);
    let s = (size * frac) / box.w;
    // maskable: la caja entera dentro del círculo seguro (radio 40 %)
    if (maskable) s = Math.min(s, (size * 0.39 * 2) / Math.hypot(box.w, box.h));
    const dw = box.w * s, dh = box.h * s;
    x.imageSmoothingQuality = 'high';
    // recentrado óptico: la caja del logo queda en el centro exacto del lienzo
    x.drawImage(img, box.x, box.y, box.w, box.h, (size - dw) / 2, (size - dh) / 2, dw, dh);
    return o.toDataURL('image/png');
  };
  // Prompt 19: marca sin recuadro (solo para la imagen de «Compartir estadísticas»). El original es RGB
  // opaco: el alfa sale de la diferencia de luminancia con el fondo muestreado (clave suave), y el color
  // se des-premultiplica (C = (P − fondo·(1 − α)) / α) para que el borde no arrastre un halo oscuro.
  const mark = () => {
    const lum = (i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const lb = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
    const ls = [];
    for (let y = box.y; y < box.y + box.h; y += 2) for (let x = box.x; x < box.x + box.w; x += 2) { const v = lum((y * W + x) * 4); if (v - lb > 60) ls.push(v); }
    ls.sort((a, b) => a - b);
    const lf = ls[Math.floor(ls.length * 0.9)]; // tono del símbolo (percentil 90: sin brillos sueltos)
    const pad = Math.round(Math.max(box.w, box.h) * 0.04);
    const cx = Math.max(0, box.x - pad), cy = Math.max(0, box.y - pad);
    const cw = Math.min(W - cx, box.w + 2 * pad), ch = Math.min(H - cy, box.h + 2 * pad);
    const k = 512 / Math.max(cw, ch);
    const ow = Math.round(cw * k), oh = Math.round(ch * k);
    // primero al tamaño final (suaviza), luego la clave: así no hay franjas a media escala
    const s1 = Object.assign(document.createElement('canvas'), { width: ow, height: oh });
    const x1 = s1.getContext('2d', { willReadFrequently: true });
    x1.imageSmoothingQuality = 'high';
    x1.drawImage(img, cx, cy, cw, ch, 0, 0, ow, oh);
    const px = x1.getImageData(0, 0, ow, oh);
    const q = px.data;
    for (let i = 0; i < q.length; i += 4) {
      const v = 0.2126 * q[i] + 0.7152 * q[i + 1] + 0.0722 * q[i + 2];
      const a = Math.min(1, Math.max(0, (v - lb - 6) / (lf - lb - 6)));
      for (let c = 0; c < 3; c++) q[i + c] = a ? Math.min(255, Math.max(0, Math.round((q[i + c] - bg[c] * (1 - a)) / a))) : 0;
      q[i + 3] = Math.round(a * 255);
    }
    x1.putImageData(px, 0, 0);
    return s1.toDataURL('image/png');
  };
  return {
    bg: hex, box,
    files: {
      'public/icons/apple-touch-icon.png': make(180, 0.6),
      'public/icons/icon-192.png': make(192, 0.6),
      'public/icons/icon-512.png': make(512, 0.6),
      'public/icons/icon-maskable-512.png': make(512, 0.6, true),
      'public/icons/favicon-32.png': make(32, 0.82),
      'public/icons/favicon-16.png': make(16, 0.86),
      'public/brand/logo-256.png': make(256, 0.62),
      'public/brand/logo-64.png': make(64, 0.7),
      'public/brand/logo-mark.png': mark(),
    },
  };
}, src);
for (const [path, url] of Object.entries(result.files)) writeFileSync(root + path, Buffer.from(url.split(',')[1], 'base64'));
writeFileSync(root + 'assets/brand/brand.json', JSON.stringify({ background: result.bg, logoBox: result.box }, null, 2) + '\n');
await b.close();
console.log('fondo muestreado', result.bg, 'caja del logo', result.box);
