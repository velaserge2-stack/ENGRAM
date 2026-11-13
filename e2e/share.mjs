// Prompt 19 · 1: «Compartir estadísticas». Tamaño exacto de cada formato, fondo de la imagen = fondo
// activo (5 fondos × 2 modos), contraste ≥ 4.5:1, interruptores de nombre/foto, periodo vacío,
// compartir con File (simulado) y descarga sin soporte, carga perezosa y ninguna petición de red.
//   npm run build && npm run e2e:share
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { zipSync, strToU8 } = require('fflate');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4191;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };

// historial: 60 días hasta AYER (hoy queda vacío a propósito), repasos maduros con algunos «Otra vez»
const now = Date.now();
const rev = [];
for (let d = 1; d < 61; d++) if (d % 5 !== 3) for (let i = 0; i < 10 + ((d * 7) % 23); i++) rev.push(JSON.stringify({ id: 'x' + (i % 40), ts: now - d * 86_400_000 - i * 60_000, rating: i % 6 ? 3 : 1, ms: 25_000, state: 2, ivl: 30 }));
const VAULT = zipSync({ '.app/reviews.jsonl': strToU8(rev.join('\n') + '\n'), 'notes/historial.md': strToU8('# historial\n') }, { level: 0 });

const external = [];
async function fresh(init) {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'es-MX', acceptDownloads: true });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(URL_) && !u.startsWith('blob:') && !u.startsWith('data:')) external.push(u); });
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.goto(URL_ + '#/mazos');
  await page.getByRole('button', { name: 'Importar archivo' }).click();
  await page.locator('.sheet input[type=file]').first().setInputFiles({ name: 'h.zip', mimeType: 'application/zip', buffer: Buffer.from(VAULT) });
  await page.locator('.sheet').getByRole('button', { name: 'Importar', exact: true }).click();
  await page.waitForTimeout(1200);
  for (let i = 0; i < 3 && (await page.locator('.scrim').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  return { ctx, page };
}
const openSheet = async (page) => {
  await page.goto(URL_ + '#/hoy');
  await page.getByRole('button', { name: 'Compartir estadísticas' }).click();
  await page.locator('.sheet[aria-label="Compartir estadísticas"]').waitFor();
};
/** Espera a que la vista previa esté al día y devuelve lo que midió el compositor. */
const ready = async (page) => {
  await page.waitForTimeout(350);
  await page.waitForFunction(() => document.querySelector('.share-prev[aria-busy=false] img'), null, { timeout: 15000 });
  return page.evaluate(() => {
    const i = document.querySelector('.share-prev img');
    return { ...window.__share, nw: i.naturalWidth, nh: i.naturalHeight, alt: i.alt };
  });
};
const seg = (page, group, name) => page.locator('.sheet').getByRole('group', { name: group }).getByRole('button', { name, exact: true }).click();
/** Color medio de la franja superior de la imagen (fuera del panel de vidrio). */
const imgTop = (page, rows) => page.evaluate((rows) => {
  const i = document.querySelector('.share-prev img');
  const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = rows;
  const x = c.getContext('2d'); x.drawImage(i, 0, 0);
  const d = x.getImageData(0, 0, c.width, rows).data; const s = [0, 0, 0];
  for (let k = 0; k < d.length; k += 4) for (let j = 0; j < 3; j++) s[j] += d[k + j];
  return s.map((v) => Math.round(v / (d.length / 4)));
}, rows);
/** Color medio de la franja superior del fondo de la app (con la interfaz oculta), en la captura. */
async function appTop(page) {
  const tag = await page.addStyleTag({ content: '#app > *:not([data-bg]), body > *:not(#app) { visibility: hidden !important; }' });
  await page.waitForTimeout(150);
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 1180, height: 48 } });
  await tag.evaluate((e) => e.remove());
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data; const s = [0, 0, 0];
    for (let k = 0; k < d.length; k += 4) for (let j = 0; j < 3; j++) s[j] += d[k + j];
    return s.map((v) => Math.round(v / (d.length / 4)));
  }, png.toString('base64'));
}
const dist = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));

try {
  // ── carga perezosa, formatos, periodo, interruptores
  {
    const { ctx, page } = await fresh(() => {
      // simulación de la hoja del sistema: guarda lo que se le entregó
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d) => !!d?.files?.length });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async (d) => { window.__shared = d.files.map((f) => ({ name: f.name, type: f.type, size: f.size })); } });
    });
    console.log('Carga perezosa');
    await page.goto(URL_ + '#/hoy');
    await page.getByRole('button', { name: 'Compartir estadísticas' }).waitFor();
    const before = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.endsWith('.js')));
    await openSheet(page);
    const after = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.endsWith('.js')));
    const fresh_ = after.filter((n) => !before.includes(n));
    check(fresh_.length >= 1, `la hoja y el compositor llegan en un fragmento propio al pulsar (${fresh_.map((n) => n.split('/').pop()).join(', ')})`);
    console.log('Formatos');
    await seg(page, 'Periodo', 'Todo');
    for (const [f, w, h] of [['Historia 9:16', 1080, 1920], ['Vertical 4:5', 1080, 1350], ['Cuadrada 1:1', 1080, 1080]]) {
      await seg(page, 'Formato', f);
      const r = await ready(page);
      check(r.w === w && r.h === h && r.nw === w && r.nh === h, `${f}: ${r.nw}×${r.nh} (esperado ${w}×${h})`);
      check(r.contrast.t1 >= 4.5 && r.contrast.t2 >= 4.5, `${f}: contraste ${r.contrast.t1.toFixed(2)} / ${r.contrast.t2.toFixed(2)} (≥ 4.5)`);
      await page.locator('.share-prev img').screenshot({ path: `${OUT}share-${w}x${h}.png` });
    }
    console.log('Periodo vacío');
    await seg(page, 'Periodo', 'Hoy');
    let r = await ready(page);
    check(r.empty && /Aún no hay estudio/.test(r.alt), `hoy sin estudio: estado vacío honesto («${r.alt}»)`);
    check(await page.locator('.sheet').getByRole('button', { name: 'Compartir', exact: true }).isDisabled(), '«Compartir» desactivado sin datos');
    await seg(page, 'Periodo', '30 días');
    r = await ready(page);
    check(!r.empty && /Flashcards estudiadas: [\d,]+/.test(r.alt) && /Horas estudiadas: /.test(r.alt), `30 días con cifras («${r.alt.slice(0, 80)}…»)`);
    check(!r.head, 'sin perfil: sin encabezado (ni nombre ni foto)');
    console.log('Compartir (hoja del sistema simulada)');
    await page.locator('.sheet').getByRole('button', { name: 'Compartir', exact: true }).click();
    await page.waitForFunction(() => window.__shared, null, { timeout: 5000 }).catch(() => {});
    const shared = await page.evaluate(() => window.__shared);
    check(shared?.length === 1 && shared[0].type === 'image/png' && /^engrama-estadisticas-\d{4}-\d{2}-\d{2}\.png$/.test(shared[0].name) && shared[0].size > 10_000, `navigator.share recibe un File PNG (${JSON.stringify(shared)})`);
    // perfil: nombre y emoji → aparecen; apagarlos los quita
    await page.keyboard.press('Escape');
    await page.goto(URL_ + '#/perfil');
    await page.getByLabel('Nombre', { exact: true }).fill('Ana Prueba Con Un Nombre Larguísimo Que No Cabe En La Tarjeta');
    await page.getByLabel('Emoji de avatar').fill('🧠');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await page.waitForTimeout(400);
    console.log('Interruptores');
    await openSheet(page);
    r = await ready(page);
    check(r.head && r.alt.startsWith('Ana Prueba'), `con perfil: nombre y emoji activados por defecto («${r.alt.slice(0, 40)}…»)`);
    await page.locator('.share-prev img').screenshot({ path: `${OUT}share-perfil.png` });
    await page.locator('.sheet').getByRole('switch', { name: 'Nombre' }).click({ force: true });
    await page.locator('.sheet').getByRole('switch', { name: 'Foto o emoji' }).click({ force: true });
    r = await ready(page);
    check(!r.head && !r.alt.includes('Ana'), 'nombre y foto apagados: no aparecen');
    await page.keyboard.press('Escape');
    await openSheet(page);
    r = await ready(page);
    check(!r.head, 'los interruptores se recuerdan');
    await ctx.close();
  }

  // ── sin Web Share de archivos: descarga; AbortError no descarga
  {
    const { ctx, page } = await fresh(() => { delete Navigator.prototype.share; delete Navigator.prototype.canShare; });
    await openSheet(page);
    await seg(page, 'Periodo', '30 días');
    await ready(page);
    const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await page.locator('.sheet').getByRole('button', { name: 'Compartir', exact: true }).click();
    const d = await dl;
    check(!!d && /^engrama-estadisticas-.*\.png$/.test(d.suggestedFilename()), `sin soporte: «Compartir» descarga (${d?.suggestedFilename()})`);
    check(await page.locator('.toast').filter({ hasText: 'Se descargó la imagen' }).count() > 0, 'y lo avisa');
    const dl2 = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await page.locator('.sheet').getByRole('button', { name: 'Guardar imagen' }).click();
    check(!!(await dl2), '«Guardar imagen» descarga');
    await ctx.close();
  }
  {
    const { ctx, page } = await fresh(() => {
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('cancelado', 'AbortError'); } });
    });
    await openSheet(page);
    await seg(page, 'Periodo', '30 días');
    await ready(page);
    const dl = page.waitForEvent('download', { timeout: 1500 }).catch(() => null);
    await page.locator('.sheet').getByRole('button', { name: 'Compartir', exact: true }).click();
    check(!(await dl), 'cancelar la hoja del sistema no es un error (sin descarga ni aviso)');
    await ctx.close();
  }

  // ── fondo de la imagen = fondo activo, 5 fondos × 2 modos, contraste ≥ 4.5
  {
    const { ctx, page } = await fresh();
    const FONDOS = [['blanco', 'Color sólido #ffffff'], ['negro', 'Color sólido #000000'], ['rayas', 'Rayas'], ['degradado', 'Neón'], ['foto', 'Paisaje']];
    const seen = {};
    for (const [bg, name] of FONDOS) for (const [modo, label] of [['dark', 'Oscuro'], ['light', 'Claro']]) {
      await page.goto(URL_ + '#/ajustes');
      await page.locator('.settings').waitFor();
      if (await page.getByRole('button', { name: 'Desplegar todo' }).count()) await page.getByRole('button', { name: 'Desplegar todo' }).click();
      await page.getByRole('radiogroup', { name: 'Fondos' }).getByRole('radio', { name, exact: true }).click();
      await page.getByRole('group', { name: 'Modo del vidrio' }).getByRole('button', { name: label, exact: true }).click();
      await page.waitForTimeout(300);
      await openSheet(page);
      await seg(page, 'Formato', 'Vertical 4:5');
      await seg(page, 'Periodo', '30 días');
      const r = await ready(page);
      const top = await imgTop(page, 40);
      check(r.contrast.t2 >= 4.5, `${bg}/${modo}: texto secundario ${r.contrast.t2.toFixed(2)}:1 (vidrio ${r.alpha.toFixed(2)})`);
      if (bg === 'foto' || bg === 'rayas') await page.locator('.share-prev img').screenshot({ path: `${OUT}share-${bg}-${modo}.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const app = await appTop(page);
      // sólidos: idéntico; integrados: mismo color medio (la proporción de la imagen no es la de la pantalla)
      const tol = bg === 'blanco' || bg === 'negro' ? 2 : bg === 'rayas' ? 40 : 48;
      check(dist(top, app) <= tol, `${bg}/${modo}: el fondo de la imagen es el de la app (imagen ${top} · app ${app}, Δ ${dist(top, app)} ≤ ${tol})`);
      seen[bg] = top;
    }
    check(dist(seen.blanco, seen.negro) > 200 && dist(seen.degradado, seen.foto) > 20, 'fondos distintos dan imágenes distintas');
    // fondo neutro
    await openSheet(page);
    await page.locator('.sheet').getByRole('group', { name: 'Fondo' }).getByRole('button', { name: 'Neutro' }).click();
    await ready(page);
    const n = await imgTop(page, 20);
    check(dist(n, [255, 255, 255]) <= 1, `«Neutro» en modo claro: blanco (${n})`);
    await ctx.close();
  }

  // ── teléfono: botón solo icono y hoja en una columna, sin desbordar
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-MX', hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(URL_);
    await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
    await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
    const b = await page.getByRole('button', { name: 'Compartir estadísticas' }).boundingBox();
    check(b && b.width <= 46 && b.height >= 44, `teléfono: botón compacto de 44 px (${b && Math.round(b.width)}×${b && Math.round(b.height)})`);
    await page.getByRole('button', { name: 'Compartir estadísticas' }).click();
    await page.locator('.sheet').waitFor();
    await page.waitForTimeout(800);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(over <= 0, `teléfono: sin desbordamiento horizontal (${over})`);
    await page.screenshot({ path: `${OUT}share-telefono.png` });
    await ctx.close();
  }

  check(!external.length, `ninguna petición de red fuera de la app (${external.slice(0, 3).join(', ')})`);
} catch (e) {
  failed++;
  console.error(e);
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} FALLO(S)` : '\nOK');
process.exit(failed ? 1 : 0);
