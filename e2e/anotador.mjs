// Anotador: el marcador libre raya sobre un PDF ESCANEADO (una imagen, sin capa de texto).
//   npm run build && node e2e/anotador.mjs      (sugerido: "e2e:anotador": "node e2e/anotador.mjs")
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4192;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
const check = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✓', m); };
const errors = [];

// PNG RGB 240×160 con degradado horizontal en R (para ver que la imagen no desaparece) y B alto
function png(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 60 + Math.round((x / (w - 1)) * 190); raw[o + 1] = 200; raw[o + 2] = 230; }
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let r = 0xffffffff; for (const v of b) r = t[(r ^ v) & 255] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const chunk = (n, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(n, 4); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

try {
  const { PDFDocument } = require('pdf-lib');
  const pdf = await PDFDocument.create();
  const pg = pdf.addPage([400, 300]);
  const img = await pdf.embedPng(png(240, 160));
  pg.drawImage(img, { x: 20, y: 40, width: 360, height: 220 }); // «escaneado»: una imagen y nada de texto
  const bytes = Buffer.from(await pdf.save());

  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, locale: 'es-MX' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL_ + '?app');
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.goto(URL_ + '?app#/pdfs');
  await page.locator('input[type=file][accept*="pdf"]').setInputFiles({ name: 'Escaneado.pdf', mimeType: 'application/pdf', buffer: bytes });
  await page.locator('.pdf-card a.pdf-cover').first().waitFor({ timeout: 15000 });
  await page.locator('.pdf-card a.pdf-cover').first().click();
  const pg1 = page.locator('.pdf-page[data-page="1"]');
  await pg1.locator('canvas.page').waitFor({ timeout: 20000 });
  check(await pg1.locator('.textLayer span').count() === 0, 'el PDF de prueba es un escaneado: no hay capa de texto');
  await page.waitForTimeout(800);

  const shot = async () => {
    const b = await pg1.screenshot();
    return page.evaluate(async (b64) => {
      const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode();
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const x = c.getContext('2d'); x.drawImage(im, 0, 0);
      return { w: im.width, h: im.height, data: Array.from(x.getImageData(0, 0, im.width, im.height).data) };
    }, b.toString('base64'));
  };
  const px = (s, x, y) => { const o = (Math.round(y) * s.w + Math.round(x)) * 4; return [s.data[o], s.data[o + 1], s.data[o + 2]]; };
  const before = await shot();

  await page.getByRole('button', { name: 'Anotar', exact: true }).click();
  const mark = page.getByRole('button', { name: /^Marcador/ });
  await mark.waitFor();
  check(await page.getByRole('button', { name: /^Resaltador inteligente/ }).count() === 1, 'el resaltador inteligente sigue en la barra');
  // objetivos táctiles de la barra ≥ 44 px
  const small = await page.locator('.ink-toolbar button').evaluateAll((bs) => bs.filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && (r.width < 43.5 || r.height < 43.5); }).length);
  check(small === 0, `todos los botones de la barra de tinta miden ≥ 44 px (${small} menores)`);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 50))));
  await page.keyboard.press('m');
  check(await mark.evaluate((b) => new Promise((ok) => { const t = Date.now(); (function w() { if (b.getAttribute('aria-pressed') === 'true') ok(true); else if (Date.now() - t > 3000) ok(false); else requestAnimationFrame(w); })(); })), 'atajo M: marcador activo');
  await page.getByRole('radio', { name: 'Grosor 8' }).click();
  await page.waitForFunction(() => document.querySelector('.pdf-page[data-page="1"] .ink-live'));

  // trazo en dos tiempos: a medias se mide la vista previa; al soltar, el trazo final
  const extent = (sel, fx = 0.3) => pg1.locator(sel).evaluate((c, fx) => { // alto con tinta en una columna
    const x = Math.round(c.width * fx), d = c.getContext('2d').getImageData(x, 0, 1, c.height).data;
    let lo = -1, hi = -1; for (let y = 0; y < c.height; y++) if (d[y * 4 + 3] > 0) { if (lo < 0) lo = y; hi = y; }
    return lo < 0 ? 0 : (hi - lo + 1) / (c.width / c.clientWidth);
  }, fx);
  const inkpx = () => pg1.locator('canvas.ink-mk').evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
  const drawPart = (phase, Y = 0.5) => pg1.locator('.ink-live').evaluate((el, [phase, Y]) => {
    const r = el.getBoundingClientRect();
    const ev = (name, fx, fy) => el.dispatchEvent(new PointerEvent(name, { pointerType: 'pen', pointerId: 77, pressure: 0.7, clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, buttons: name === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
    if (phase === 'half') { ev('pointerdown', 0.15, Y); for (let i = 1; i <= 30; i++) ev('pointermove', 0.15 + i * 0.01, Y); }
    else { for (let i = 31; i <= 70; i++) ev('pointermove', 0.15 + i * 0.01, Y); ev('pointerup', 0.85, Y); }
  }, [phase, Y]);
  await drawPart('half');
  await page.waitForTimeout(100);
  const live = await pg1.locator('.ink-live').evaluate((c) => ({ mk: c.classList.contains('mk'), op: c.style.opacity }));
  check(live.mk && live.op === '0.4', `vista previa con la mezcla del marcador y su opacidad (${live.op})`);
  const liveH = await extent('.ink-live');
  await drawPart('rest');
  await page.waitForTimeout(500);
  const mkH = await extent('canvas.ink-mk');
  check(liveH > 14 && Math.abs(liveH - mkH) <= 3, `la vista previa tiene el mismo grosor que el trazo final (${liveH.toFixed(1)} px → ${mkH.toFixed(1)} px, sin saltar a 4×)`);
  check(await pg1.locator('.ink-live').evaluate((c) => !c.classList.contains('mk') && c.style.opacity === ''), 'al soltar, la vista previa se limpia');
  check(await pg1.locator('canvas.ink-base').evaluate((c) => !c.getContext('2d').getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 === 3 && v > 0)), 'el marcador no usa la capa del bolígrafo');
  check(await pg1.locator('.pdf-mark').count() === 0, 'sin texto no hay marca ajustada: es tinta libre');

  // el píxel bajo el marcador se oscurece (multiply) y la imagen sigue ahí
  const after = await shot();
  const y = after.h * 0.5, xa = after.w * 0.3, xb = after.w * 0.7;
  const [b0, b1, a0, a1] = [px(before, xa, y), px(before, xb, y), px(after, xa, y), px(after, xb, y)];
  console.log('   antes', b0, b1, 'después', a0, a1);
  check(a0[2] < b0[2] * 0.8 && a1[2] < b1[2] * 0.8 && a0[2] > 20, 'el píxel bajo el marcador se oscurece (azul amarillo×imagen), sin taparse del todo');
  check(Math.abs(a1[0] - a0[0]) > 0.6 * Math.abs(b1[0] - b0[0]), 'la imagen sigue viéndose a través del marcador (el degradado se conserva)');
  const outside = px(after, xa, after.h * 0.5 + 60), outside0 = px(before, xa, after.h * 0.5 + 60);
  check(outside.every((v, i) => Math.abs(v - outside0[i]) <= 2), 'fuera del trazo la página no cambia');
  await pg1.screenshot({ path: OUT + 'anotador-marcador.png' });

  // persiste: reabrir la app y el trazo sigue
  await page.waitForTimeout(800);
  await page.reload();
  await page.locator('.pdf-page[data-page="1"] canvas.ink-mk').waitFor({ timeout: 20000 });
  await page.waitForTimeout(500);
  check(await extent('canvas.ink-mk') > 14, 'tras reabrir, el marcador sigue ahí');

  // deshacer y borrador
  await page.getByRole('button', { name: 'Anotar', exact: true }).click().catch(() => {});
  await mark.waitFor();
  await mark.click();
  const n1 = await inkpx();
  await drawPart('half', 0.75); await drawPart('rest', 0.75); // otro trazo en esta sesión (el historial no sobrevive al reabrir)
  await page.waitForTimeout(500);
  const n2 = await inkpx();
  check(n2 > n1 * 1.3, 'un segundo trazo suma tinta');
  await page.getByRole('button', { name: /^Deshacer/ }).first().waitFor();
  await page.getByRole('button', { name: /^Deshacer/ }).first().click();
  await page.waitForTimeout(300);
  { const n = await inkpx(); check(n > 0 && n < n2 * 0.8, 'deshacer quita solo el último trazo'); }
  await page.getByRole('button', { name: /^Rehacer/ }).first().click();
  await page.waitForTimeout(300);
  check(await inkpx() === n2, 'rehacer lo devuelve');
  await page.getByRole('button', { name: /^Borrador/ }).click();
  await pg1.locator('.ink-live').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const ev = (n, fx, fy) => el.dispatchEvent(new PointerEvent(n, { pointerType: 'pen', pointerId: 78, pressure: 0.5, clientX: r.left + r.width * fx, clientY: r.top + r.height * fy, buttons: n === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
    ev('pointerdown', 0.5, 0.5); ev('pointerup', 0.5, 0.5);
  });
  await page.waitForTimeout(300);
  { const n = await inkpx(); check(n > 0 && n < n2 * 0.8, 'el borrador quita el trazo tocado y deja el otro'); }

  check(errors.length === 0, 'sin errores de consola: ' + errors.slice(0, 3).join(' | '));
  console.log('OK anotador');
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
