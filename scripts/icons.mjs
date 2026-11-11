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
    },
  };
}, src);
for (const [path, url] of Object.entries(result.files)) writeFileSync(root + path, Buffer.from(url.split(',')[1], 'base64'));
writeFileSync(root + 'assets/brand/brand.json', JSON.stringify({ background: result.bg, logoBox: result.box }, null, 2) + '\n');
await b.close();
console.log('fondo muestreado', result.bg, 'caja del logo', result.box);
