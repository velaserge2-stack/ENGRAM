// Prompt 11: medición de rendimiento con PDF pesados y el Lienzo. Escribe e2e/out/perf-<PERF_LABEL>.json
// y, con PERF_BASE=<json>, compara contra la línea base. Requiere `node scripts/perf-fixtures.mjs`.
//   npm run build && PERF_LABEL=antes npm run e2e:perf
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4186;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
const ARGS = { args: ['--enable-precise-memory-info'] };
try { browser = await type.launch(type === pw.chromium ? ARGS : {}); } catch { type = pw.chromium; browser = await type.launch(ARGS); }
console.log('Navegador:', type.name());
const check = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✓', m); };


const FIX = new URL('../tests/fixtures/perf/', import.meta.url).pathname;
if (!existsSync(FIX + 'p800.pdf')) { console.error('Falta tests/fixtures/perf/p800.pdf: node scripts/perf-fixtures.mjs'); process.exit(1); }
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const run = (k) => !only || only.includes(k);
const R = { browser: type.name(), date: new Date().toISOString() };

/** Monitor de tareas largas (longtask en Chromium; huecos de rAF > 50 ms en cualquier navegador) y memoria. */
const MONITOR = () => {
  window.__lt = []; window.__gaps = []; window.__mem = 0;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch { /* WebKit */ }
  let last = performance.now();
  const f = (t) => { if (t - last > 50) window.__gaps.push(Math.round(t - last)); last = t; requestAnimationFrame(f); };
  requestAnimationFrame(f);
  setInterval(() => { const m = performance.memory?.usedJSHeapSize; if (m && m > window.__mem) window.__mem = m; }, 50);
};
const resetMon = (page) => page.evaluate(() => { window.__lt = []; window.__gaps = []; window.__mem = performance.memory?.usedJSHeapSize ?? 0; window.__perf?.reset(); });
const mon = (page) => page.evaluate(() => ({ longTasks: window.__lt.length, longestTask: Math.round(Math.max(0, ...window.__lt)), rafGaps: window.__gaps.length, longestGap: Math.max(0, ...window.__gaps), peakHeapMB: window.__mem ? Math.round(window.__mem / 1048576) : null, getPage: window.__perf?.c.getPage ?? 0, rangeMB: Math.round((window.__perf?.c.rangeBytes ?? 0) / 104857.6) / 10 }));
const dom = (page, root = '.pdf-viewer') => page.evaluate((root) => {
  const v = document.querySelector(root) ?? document;
  const canv = [...v.querySelectorAll('canvas')];
  return { pdfPages: v.querySelectorAll('.pdf-page').length, canvases: canv.length, canvasMP: Math.round(canv.reduce((a, c) => a + c.width * c.height, 0) / 1e5) / 10, textNodes: v.querySelectorAll('.pdf-text span, .textLayer span').length, thumbs: v.querySelectorAll('.pdf-thumb img').length, getPage: window.__perf?.c.getPage ?? 0 };
}, root);

async function fresh(w = 1180, h = 820) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'es-MX' });
  await ctx.addInitScript(MONITOR);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  return { ctx, page };
}

try {
  const { ctx, page } = await fresh();
  if (run('pdf')) {
    console.log('Importar el PDF de 800 páginas (~96 MB)');
    await page.goto(URL_ + '#/pdfs');
    await resetMon(page);
    let t0 = Date.now();
    await page.locator('input[type=file][accept*="pdf"]').setInputFiles(FIX + 'p800.pdf');
    await page.locator('.pdf-card').first().waitFor({ timeout: 180000 });
    R.import = { ms: Date.now() - t0, ...(await mon(page)) };
    await page.waitForTimeout(1500);
    console.log('  ', JSON.stringify(R.import));

    console.log('Abrir (por página)');
    await resetMon(page);
    t0 = Date.now();
    await page.locator('.pdf-card a.pdf-cover').first().click();
    await page.locator('.pdf-page[data-page="1"] canvas').first().waitFor({ timeout: 120000 });
    R.openPage = { msToPage1: Date.now() - t0 };
    await page.waitForTimeout(2000);
    Object.assign(R.openPage, await dom(page), await mon(page));
    console.log('  ', JSON.stringify(R.openPage));

    console.log('Continuo');
    await resetMon(page);
    await page.getByRole('button', { name: 'Ver continuo' }).click();
    await page.waitForTimeout(3000);
    R.continuous = { ...(await dom(page)), ...(await mon(page)) };
    console.log('  ', JSON.stringify(R.continuous));

    console.log('Desplazarse hasta la mitad y seguir');
    await resetMon(page);
    t0 = Date.now();
    const box = page.locator('.pdf-scroll');
    await box.evaluate((b) => { b.scrollTop = b.scrollHeight / 2; });
    await page.waitForTimeout(400);
    for (let i = 0; i < 30; i++) { await box.evaluate((b) => { b.scrollTop += 700; }); await page.waitForTimeout(60); }
    await page.waitForTimeout(2500);
    R.scroll = { ms: Date.now() - t0, ...(await dom(page)), ...(await mon(page)) };
    console.log('  ', JSON.stringify(R.scroll));

    console.log('Miniaturas');
    await resetMon(page);
    await page.getByRole('button', { name: 'Miniaturas' }).click();
    await page.waitForTimeout(3000);
    R.thumbs = { ...(await dom(page)), thumbButtons: await page.locator('.pdf-thumb').count(), ...(await mon(page)) };
    console.log('  ', JSON.stringify(R.thumbs));
    await page.getByRole('button', { name: 'Miniaturas' }).click();

    console.log('Buscar en las 800 páginas');
    await resetMon(page);
    t0 = Date.now();
    await page.getByRole('textbox', { name: 'Buscar en el PDF' }).fill('Pagina 777 ');
    await page.getByRole('textbox', { name: 'Buscar en el PDF' }).press('Enter');
    await page.getByText(/1 páginas?/).first().waitFor({ timeout: 240000 }).catch(() => {});
    R.find = { ms: Date.now() - t0, ...(await mon(page)) };
    console.log('  ', JSON.stringify(R.find));
  }

  if (run('lienzo')) {
    console.log('Lienzo con 30 paneles');
    await page.goto(URL_ + '#/espacios');
    await page.getByRole('button', { name: 'Nuevo espacio' }).first().click();
    await page.locator('.sheet input[name=n]').fill('Perf');
    await page.getByRole('button', { name: 'Crear', exact: true }).click();
    await page.getByText(/Añade paneles/).first().waitFor();
    await page.getByRole('group', { name: 'Modo' }).getByRole('button', { name: 'Lienzo' }).click();
    await page.locator('.canvas-wrap').waitFor();
    for (let i = 0; i < 30; i++) {
      const b = page.getByRole('button', { name: 'Añadir panel', exact: true });
      await b.click();
      await page.getByRole('menuitem', { name: 'Añadir panel ' + (i % 2 ? 'Pomodoro' : 'Estadísticas'), exact: true }).evaluate((x) => x.click());
      await page.waitForTimeout(60);
    }
    await page.waitForTimeout(800);
    const spot = await page.evaluate(() => { const w = document.querySelector('.canvas-wrap').getBoundingClientRect(); return { x: w.left + w.width - 40, y: w.top + 40 }; });
    await resetMon(page);
    await page.mouse.move(spot.x, spot.y);
    // paneo a zoom 100 %: cuántos paneles montan contenido y si alguno está fuera de la vista
    for (let i = 0; i < 20; i++) await page.mouse.wheel(-30, -20);
    const panRenders = await page.evaluate(() => window.__perf?.c.windowRender ?? 0);
    await page.waitForTimeout(400);
    const bodiesAt100 = await page.evaluate(() => {
      const w = document.querySelector('.canvas-wrap').getBoundingClientRect();
      const live = [...document.querySelectorAll('.canvas-plane > .win')].filter((e) => e.querySelector('.win-body > :not(.win-resize):not(p)'));
      return { n: live.length, offscreen: live.filter((e) => { const r = e.getBoundingClientRect(); return r.right < w.left - 200 || r.left > w.right + 200 || r.bottom < w.top - 200 || r.top > w.bottom + 200; }).length };
    });
    const before = await page.evaluate(() => window.__perf?.c.windowRender ?? 0);
    await page.keyboard.down('Control');
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 60);
    await page.keyboard.up('Control');
    for (let i = 0; i < 20; i++) await page.mouse.wheel(30, 20);
    const gesture = (await page.evaluate(() => window.__perf?.c.windowRender ?? 0)) - before;
    await page.waitForTimeout(600);
    R.canvas = {
      panels: await page.locator('.canvas-plane > .win').count(),
      windowRendersDuringPan: panRenders,
      bodiesAt100: bodiesAt100.n,
      bodiesOffscreen: bodiesAt100.offscreen,
      windowRendersDuringGesture: gesture,
      windowRendersTotal: await page.evaluate(() => window.__perf?.c.windowRender ?? 0),
      bodiesMounted: await page.locator('.canvas-plane > .win .win-body > :not(.win-resize):not(p)').count(),
      ...(await mon(page)),
    };
    console.log('  ', JSON.stringify(R.canvas));
  }

  const label = process.env.PERF_LABEL || 'actual';
  writeFileSync(`${OUT}perf-${label}.json`, JSON.stringify(R, null, 1));
  console.log(`\nGuardado en e2e/out/perf-${label}.json`);
  if (process.env.PERF_BASE && existsSync(process.env.PERF_BASE)) {
    const B = JSON.parse(readFileSync(process.env.PERF_BASE, 'utf8'));
    console.log('\nComparación (antes → después):');
    for (const k of Object.keys(R)) if (typeof R[k] === 'object' && B[k]) for (const m of Object.keys(R[k])) console.log(`  ${k}.${m}: ${B[k][m]} → ${R[k][m]}`);
  }
  // criterios de aceptación (Prompt 11)
  console.log('\nCriterios:');
  const ch = type === pw.chromium; // longtask solo existe en Chromium
  if (R.openPage) {
    check(R.openPage.pdfPages <= 7 && R.openPage.canvases <= 5, `abrir: ${R.openPage.pdfPages} páginas en el DOM, ${R.openPage.canvases} canvas`);
    check(R.openPage.getPage <= 3, `abrir: getPage solo cerca (${R.openPage.getPage})`);
    check(R.openPage.rangeMB < 48, `abrir: no lee el archivo entero (${R.openPage.rangeMB} MB de 95.8)`);
    check(R.continuous.pdfPages <= 7 && R.continuous.canvases <= 5 && R.continuous.getPage <= 7, `continuo: ${R.continuous.pdfPages} páginas, ${R.continuous.canvases} canvas, getPage ${R.continuous.getPage}`);
    check(R.scroll.pdfPages <= 7 && R.scroll.canvases <= 5, `desplazarse: ${R.scroll.pdfPages} páginas, ${R.scroll.canvases} canvas`);
    check(R.thumbs.thumbButtons <= 40, `miniaturas virtualizadas (${R.thumbs.thumbButtons} montadas)`);
    if (ch) check(R.import.longTasks === 0 && R.scroll.longTasks === 0, `sin tareas largas al importar (${R.import.longTasks}) ni al desplazarse (${R.scroll.longTasks})`);
  }
  if (R.canvas) {
    check(R.canvas.windowRendersDuringPan === 0 && R.canvas.windowRendersDuringGesture === 0, 'lienzo: 0 renders de panel durante paneo y zoom');
    check(R.canvas.bodiesAt100 <= 4 && R.canvas.bodiesOffscreen === 0, `lienzo: solo los paneles en pantalla tienen contenido (${R.canvas.bodiesAt100}, fuera: ${R.canvas.bodiesOffscreen})`);
  }
  await ctx.close();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
