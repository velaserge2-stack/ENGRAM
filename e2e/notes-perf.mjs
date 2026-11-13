// Prompt 14: medición de notas pesadas, del asa de redimensionar y de imágenes en el lienzo.
//   node scripts/note-fixtures.mjs && npm run build && PERF_LABEL=antes npm run e2e:notas-perf
// ONLY=asa|notas|panel|img. Escribe e2e/out/notes-perf-<PERF_LABEL>.json; con PERF_BASE compara.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { zipSync } from 'fflate';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const FIX = new URL('../tests/fixtures/notes/', import.meta.url).pathname;
if (!existsSync(FIX + 'notas.zip')) { console.error('Faltan fixtures: node scripts/note-fixtures.mjs'); process.exit(1); }
const PORT = Number(process.env.PORT) || 4187;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(type === pw.chromium ? { args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] } : {}); } catch { type = pw.chromium; browser = await type.launch({ args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] }); }
console.log('Navegador:', type.name());
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const run = (k) => !only || only.includes(k);
const R = { browser: type.name(), date: new Date().toISOString() };
const fails = [];
const check = (c, m) => { if (!c) fails.push(m); console.log(c ? '  ✓' : '  ✗', m); };

/** Cuenta blob: URLs vivas, mide fotogramas y latencia input → siguiente fotograma. */
const PROBE = () => {
  const live = new Set();
  const c = URL.createObjectURL.bind(URL), r = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (o) => { const u = c(o); live.add(u); return u; };
  URL.revokeObjectURL = (u) => { live.delete(u); r(u); };
  window.__blobs = () => live.size;
  window.__lat = [];
  addEventListener('input', (e) => { const t0 = e.timeStamp; requestAnimationFrame(() => setTimeout(() => window.__lat.push(performance.now() - t0), 0)); }, true);
};
const mem = (page) => page.evaluate(() => ({ heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, dom: document.getElementsByTagName('*').length, blobs: window.__blobs() }));
/** fps de un desplazamiento programático: `step` px por fotograma durante `ms`. */
const scrollFps = (page, sel, step = 60, ms = 2000) => page.evaluate(({ sel, step, ms }) => new Promise((res) => {
  // el contenedor que de verdad se desplaza (el de la nota, o la página)
  let el = sel ? document.querySelector(sel) : document.querySelector('.doc');
  while (el && !(el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
  el ??= document.scrollingElement;
  const y0 = el.scrollTop, t0 = performance.now(); let n = 0, last = t0, worst = 0;
  const f = (t) => { n++; worst = Math.max(worst, t - last); last = t; el.scrollTop += step; if (t - t0 < ms) requestAnimationFrame(f); else res({ fps: Math.round((n / (t - t0)) * 1000), worstFrameMs: Math.round(worst), scrolledPx: Math.round(el.scrollTop - y0) }); };
  requestAnimationFrame(f);
}), { sel, step, ms });
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0); };

async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'es-MX' });
  await ctx.addInitScript(PROBE);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  return { ctx, page };
}
async function importZip(page, name, buffer) {
  await page.goto(URL_ + '#/mazos');
  await page.getByRole('button', { name: 'Importar archivo' }).click();
  await page.locator('.sheet input[type=file]').first().setInputFiles({ name, mimeType: 'application/zip', buffer });
  await page.locator('.sheet').getByRole('button', { name: 'Importar', exact: true }).click({ timeout: 120000 });
  await page.waitForTimeout(1500);
  // la hoja de resultado se cierra
  for (let i = 0; i < 3 && (await page.locator('.scrim').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
}
/** Escribe 20 caracteres en un bloque a mitad de la nota y devuelve p50/p95 de latencia. */
async function typeMid(page, root) {
  const blocks = page.locator(`${root} .doc [aria-label="Editar bloque"]`);
  const n = await blocks.count();
  const t0 = Date.now();
  await blocks.nth(Math.floor(n / 2)).click();
  const ta = page.locator(`${root} .doc textarea`).first();
  await ta.waitFor();
  const toEdit = Date.now() - t0;
  await ta.press('End');
  await page.evaluate(() => (window.__lat = []));
  for (const ch of 'escribiendo aquí xyz') await page.keyboard.type(ch, { delay: 30 });
  await page.waitForTimeout(400);
  const lat = await page.evaluate(() => window.__lat);
  await page.keyboard.press('Escape');
  return { blocks: n, clickToEditMs: toEdit, typeP50: pct(lat, 0.5), typeP95: pct(lat, 0.95), typeMax: Math.round(Math.max(0, ...lat)) };
}

try {
  if (run('asa')) {
    console.log('Asa de redimensionar en un panel de nota desplazado');
    const { ctx, page } = await fresh();
    await importZip(page, 'notas.zip', readFileSync(FIX + 'notas.zip'));
    await page.goto(URL_ + '#/espacios/abrir/' + encodeURIComponent('notes/Perf/Notas/N1.md'));
    await page.locator('.win').first().waitFor();
    await page.getByRole('group', { name: 'Modo' }).getByRole('button', { name: 'Lienzo' }).click();
    await page.locator('.canvas-plane .win .doc').first().waitFor({ timeout: 60000 });
    const pos = () => page.evaluate(() => {
      const w = document.querySelector('.canvas-plane .win'), h = w.querySelector('.win-resize');
      if (!h) return null;
      const a = w.getBoundingClientRect(), b = h.getBoundingClientRect();
      const s = [...w.querySelectorAll('.win-body')].find((x) => x.scrollHeight > x.clientHeight + 4);
      return { dx: Math.round(a.right - b.right), dy: Math.round(a.bottom - b.bottom), inside: b.bottom <= a.bottom + 1 && b.top >= a.top, scroller: s ? 'win-body' : 'otro' };
    });
    const before = await pos();
    await page.evaluate(() => { const s = document.querySelector('.canvas-plane .win .win-body'); s.scrollTop = s.scrollHeight; });
    await page.waitForTimeout(300);
    const after = await pos();
    R.asa = { before, after };
    console.log('  ', JSON.stringify(R.asa));
    check(after?.inside, 'el asa sigue en el área visible del panel tras desplazar hasta el final');
    await ctx.close();
  }

  if (run('notas') || run('panel')) {
    const { ctx, page } = await fresh();
    await importZip(page, 'notas.zip', readFileSync(FIX + 'notas.zip'));
    for (const N of ['N1', 'N2', 'N3']) {
      if (run('notas')) {
        console.log(`Pestaña Notas · ${N}`);
        await page.goto(URL_ + '#/hoy');
        await page.waitForTimeout(300);
        const t0 = Date.now();
        await page.goto(URL_ + `#/notas/Perf/Notas/${N}.md`);
        await page.locator('.doc [aria-label="Editar bloque"]').last().waitFor({ timeout: 120000 });
        const openMs = Date.now() - t0;
        await page.waitForTimeout(1500);
        const m0 = await mem(page);
        const typing = await typeMid(page, 'main');
        const fps = await scrollFps(page, null);
        // buscar en esta nota
        await page.getByRole('button', { name: 'Buscar en esta nota' }).first().click();
        const t1 = Date.now();
        await page.getByRole('searchbox', { name: 'Buscar en esta nota' }).fill('troponina');
        await page.locator('.find-bar .num').filter({ hasText: /de/ }).waitFor({ timeout: 60000 });
        const findMs = Date.now() - t1;
        await page.keyboard.press('Escape');
        const m1 = await mem(page);
        // «Ver Markdown»: escribir en el textarea con todo el texto
        await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Ver Markdown' }).click();
        const ta = page.getByRole('textbox', { name: 'Markdown de la nota' });
        await ta.waitFor();
        await ta.focus();
        await page.evaluate(() => { const t = document.activeElement; t.setSelectionRange(t.value.length / 2, t.value.length / 2); });
        await page.evaluate(() => (window.__lat = []));
        for (const ch of 'markdown xyz') await page.keyboard.type(ch, { delay: 30 });
        await page.waitForTimeout(400);
        const md = await page.evaluate(() => window.__lat);
        await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Documento' }).click();
        R[`tab_${N}`] = { openMs, ...typing, ...fps, findMs, mdTypeP50: pct(md, 0.5), mdTypeP95: pct(md, 0.95), ...m0, heapAfterMB: m1.heapMB, blobsAfter: m1.blobs };
        console.log('  ', JSON.stringify(R[`tab_${N}`]));
      }
    }
    if (run('panel')) {
      console.log('Panel del lienzo · N2 (dos paneles de la misma nota)');
      await page.goto(URL_ + '#/espacios/abrir/' + encodeURIComponent('notes/Perf/Notas/N2.md'));
      await page.locator('.win').first().waitFor();
      await page.getByRole('group', { name: 'Modo' }).getByRole('button', { name: 'Lienzo' }).click();
      const t0 = Date.now();
      await page.locator('.canvas-plane .win .doc [aria-label="Editar bloque"]').last().waitFor({ timeout: 120000 });
      const openMs = Date.now() - t0;
      await page.goto(URL_ + '#/espacios/abrir/' + encodeURIComponent('notes/Perf/Notas/N2.md'));
      await page.waitForFunction(() => document.querySelectorAll('.canvas-plane .win .doc').length >= 2, null, { timeout: 120000 });
      await page.waitForTimeout(1500);
      const m0 = await mem(page);
      const typing = await typeMid(page, '.canvas-plane .win:last-child');
      R.panel_N2x2 = { openMs, ...typing, ...m0 };
      console.log('  ', JSON.stringify(R.panel_N2x2));
    }
    await ctx.close();
  }

  if (run('soak')) {
    // 5 minutos escribiendo y desplazándose en N2: la memoria no debe crecer sin parar
    console.log('Memoria: 5 min escribiendo y desplazándose en N2');
    const { ctx, page } = await fresh();
    await importZip(page, 'notas.zip', readFileSync(FIX + 'notas.zip'));
    await page.goto(URL_ + '#/notas/Perf/Notas/N2.md');
    await page.locator('.doc [aria-label="Editar bloque"]').last().waitFor({ timeout: 120000 });
    const MIN = Number(process.env.SOAK_MIN || 5), samples = [];
    const t0 = Date.now();
    let k = 0;
    while (Date.now() - t0 < MIN * 60000) {
      const blocks = page.locator('.doc [aria-label="Editar bloque"]');
      // clic en el bloque (no en un enlace de dentro, que navegaría)
      await blocks.nth((k * 397) % 2900).evaluate((e) => (e.scrollIntoView({ block: 'center' }), e.click()));
      await page.locator('.doc textarea').first().press('End');
      await page.keyboard.type(' abc', { delay: 20 });
      await page.keyboard.press('Escape');
      await scrollFps(page, null, k % 2 ? -80 : 80, 600);
      if (k++ % 10 === 0) { await page.evaluate(() => window.gc?.()); samples.push({ s: Math.round((Date.now() - t0) / 1000), ...(await mem(page)) }); }
    }
    R.soak = { minutes: MIN, first: samples[1] ?? samples[0], last: samples[samples.length - 1], samples: samples.length };
    console.log('  ', JSON.stringify(R.soak));
    await ctx.close();
  }

  if (run('img')) {
    const imgs = ['img-2mp.jpg', 'img-12mp.jpg', 'img-24mp.jpg', 'img-48mp.jpg', 'img-12mp.png', 'img-48mp.png'];
    const { ctx, page } = await fresh();
    const files = {};
    for (const f of imgs) files[`media/${f}`] = new Uint8Array(readFileSync(FIX + f));
    await importZip(page, 'imagenes.zip', Buffer.from(zipSync(files, { level: 0 })));
    await page.goto(URL_ + '#/espacios');
    await page.getByRole('button', { name: 'Nuevo espacio' }).first().click();
    await page.locator('.sheet input[name=n]').fill('Imágenes');
    await page.getByRole('button', { name: 'Crear', exact: true }).click();
    await page.getByRole('group', { name: 'Modo' }).getByRole('button', { name: 'Lienzo' }).click();
    await page.locator('.canvas-wrap').waitFor();
    R.img = {};
    const shown = () => page.waitForFunction(() => [...document.querySelectorAll('.canvas-plane .win img')].some((i) => i.complete && i.naturalWidth > 0 && i.getBoundingClientRect().width > 0), null, { timeout: 60000 });
    const close = async () => { while (await page.locator('.canvas-plane > .win').count()) { await page.getByRole('button', { name: 'Cerrar panel' }).first().evaluate((b) => b.click()); await page.waitForTimeout(100); } await page.waitForTimeout(200); };
    for (const f of imgs) {
      await close();
      const t0 = Date.now();
      await page.goto(URL_ + '#/espacios/abrir/' + encodeURIComponent(`media/${f}`));
      await shown();
      await page.evaluate(() => Promise.all([...document.querySelectorAll('.canvas-plane .win img')].map((i) => i.decode().catch(() => {}))));
      R.img[f] = { showMs: Date.now() - t0, ...(await mem(page)), naturalPx: await page.evaluate(() => { const i = document.querySelector('.canvas-plane .win img'); return `${i.naturalWidth}×${i.naturalHeight}`; }) };
      console.log('  ', f, JSON.stringify(R.img[f]));
    }
    // paneo/zoom con 1, 2 y 4 paneles de imagen
    await close();
    for (const k of [1, 2, 4]) {
      while ((await page.locator('.canvas-plane > .win').count()) < k) {
        await page.goto(URL_ + '#/espacios/abrir/' + encodeURIComponent(`media/${imgs[(await page.locator('.canvas-plane > .win').count()) + 1]}`));
        await page.waitForTimeout(300);
      }
      await shown();
      await page.getByRole('button', { name: 'Ajustar al contenido' }).click();
      await page.waitForTimeout(800);
      // un punto vacío del lienzo (sobre una imagen, Ctrl+rueda acerca la imagen, no el lienzo)
      const spot = await page.evaluate(() => { const w = document.querySelector('.canvas-wrap').getBoundingClientRect(); for (let y = w.top + 20; y < w.bottom - 140; y += 15) for (let x = w.left + 20; x < w.right - 200; x += 15) { const e = document.elementFromPoint(x, y); if (e && e.closest('.canvas-wrap') && !e.closest('.win, button, .minimap, .chip, .row')) return { x, y }; } return { x: w.left + 10, y: w.top + 10 }; });
      await page.mouse.move(spot.x, spot.y);
      const fpsP = page.evaluate(() => new Promise((res) => { const t0 = performance.now(); let n = 0, last = t0, worst = 0; const f = (t) => { n++; worst = Math.max(worst, t - last); last = t; if (t - t0 < 2000) requestAnimationFrame(f); else res({ fps: Math.round((n / (t - t0)) * 1000), worstFrameMs: Math.round(worst) }); }; requestAnimationFrame(f); }));
      for (let i = 0; i < 30; i++) { await page.mouse.wheel(i % 2 ? 25 : -25, 15); if (i % 3 === 0) { await page.keyboard.down('Control'); await page.mouse.wheel(0, i % 6 ? -40 : 40); await page.keyboard.up('Control'); } }
      R[`pan_${k}img`] = { ...(await fpsP), ...(await mem(page)) };
      console.log('  ', `paneo/zoom con ${k} imagen(es)`, JSON.stringify(R[`pan_${k}img`]));
    }
    // abrir y cerrar 20 imágenes: las blob: no deben crecer
    await close();
    const b0 = (await mem(page)).blobs;
    const reopen = [];
    for (let i = 0; i < 20; i++) {
      const t0 = Date.now();
      await page.goto(URL_ + '#/espacios/abrir/' + encodeURIComponent(`media/${imgs[i % 4]}`));
      await shown();
      reopen.push(Date.now() - t0);
      await close();
    }
    await page.waitForTimeout(500);
    const b1 = (await mem(page)).blobs;
    R.blobLeak = { before: b0, after20: b1, reopenP50Ms: pct(reopen, 0.5) };
    console.log('  ', 'blob: vivas antes/después de abrir y cerrar 20', JSON.stringify(R.blobLeak));
    await ctx.close();
  }

  const label = process.env.PERF_LABEL || 'actual';
  writeFileSync(`${OUT}notes-perf-${label}.json`, JSON.stringify(R, null, 1));
  console.log(`\nGuardado en e2e/out/notes-perf-${label}.json`);
  if (process.env.PERF_BASE && existsSync(process.env.PERF_BASE)) {
    const B = JSON.parse(readFileSync(process.env.PERF_BASE, 'utf8'));
    console.log('\nComparación (antes → después):');
    for (const k of Object.keys(R)) if (typeof R[k] === 'object' && B[k]) for (const m of Object.keys(R[k])) console.log(`  ${k}.${m}: ${JSON.stringify(B[k][m])} → ${JSON.stringify(R[k][m])}`);
  }
  if (process.env.STRICT && fails.length) throw new Error('FALLÓ: ' + fails.join('; '));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
