// Prompt 21 · Fase 0: línea base de rendimiento con bóvedas sintéticas (scripts/vault-gen.mjs).
//   node scripts/vault-gen.mjs && npm run build && npm run perf
// Variables: SIZES=S,M,L · RUNS=5 · RUNS_L=5 (corridas de L) · ONLY=inicio,pantallas,estudio,fsrs,busqueda,notas,mover,importar,respaldo
//            OUT=docs/rendimiento/baseline.json · BROWSER=webkit|chromium (WebKit si existe; si no, Chromium) · PLAYWRIGHT_PATH
// Mide con ?perf: contadores `journal` (escrituras al diario de SafeVault), tareas largas (>50 ms, longtask),
// memoria (CDP Performance.getMetrics JSHeapUsedSize, hilo principal; los Workers no cuentan) y ms de reloj.
// Qué va por la interfaz y qué por ganchos (`window.__perf.api`, src/lib/perfhooks.ts): ver docs/rendimiento/baseline.md.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const ROOT = new URL('../', import.meta.url).pathname;
const FIX = ROOT + 'tests/fixtures/rendimiento/';
const OUT = process.env.OUT || ROOT + 'docs/rendimiento/baseline.json';
const PROF = (process.env.PROFILES || tmpdir() + '/engrama-perf') + '/';
const PORT = Number(process.env.PORT) || 4196;
const URL_ = `http://localhost:${PORT}/`;
const SIZES = (process.env.SIZES || 'S,M,L').split(',');
const RUNS = Number(process.env.RUNS) || 5;
const RUNS_L = Number(process.env.RUNS_L) || RUNS;
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const want = (k) => !only || only.includes(k);
const runsOf = (s) => (s === 'L' ? RUNS_L : RUNS);
for (const f of ['S.zip']) if (!existsSync(FIX + f)) { console.error('Faltan bóvedas: node scripts/vault-gen.mjs'); process.exit(1); }

// ───────── servidor y navegador ─────────
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', cwd: ROOT });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
const ARGS = ['--enable-precise-memory-info'];
let probe;
try { probe = await type.launch(type === pw.chromium ? { args: ARGS } : {}); } catch { type = pw.chromium; probe = await type.launch({ args: ARGS }); }
const browserVersion = probe.version();
await probe.close();
const IS_CR = type === pw.chromium;
console.log(`Navegador: ${type.name()} ${browserVersion}${process.env.BROWSER === 'webkit' && IS_CR ? ' (WebKit no existe en este contenedor: se usa Chromium)' : ''}`);
const ENV = { browser: `${type.name()} ${browserVersion}`, cpu: `${cpus()[0].model.trim()} × ${cpus().length}`, ramGB: Math.round(totalmem() / 2 ** 30), os: `${platform()} ${release()}`, date: new Date().toISOString(), runs: RUNS, runsL: RUNS_L, note: IS_CR ? 'Chromium: tareas largas con longtask y memoria con CDP (solo hilo principal)' : 'sin CDP: huecos de rAF' };

// ───────── estadística ─────────
const sorted = (a) => [...a].sort((x, y) => x - y);
const median = (a) => { if (!a.length) return null; const s = sorted(a), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const p95 = (a) => { if (!a.length) return null; const s = sorted(a); return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)]; };
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const R = { env: ENV, bundle: null, metrics: {} };
/** Guarda una muestra: `m` = {ms, journal, longTasks, longestTask, peakMB, …}; `extra` = otras cifras por corrida. */
function rec(name, size, m, key = 'ms') {
  const e = ((R.metrics[name] ??= {})[size] ??= { samples: [] });
  e.samples.push(m);
  const col = (k) => e.samples.map((s) => s[k]).filter((v) => typeof v === 'number');
  const ms = col(key);
  Object.assign(e, { n: ms.length, median: r1(median(ms)), p95: r1(p95(ms)), journal: median(col('journal')), longTasks: median(col('longTasks')), longestTask: r1(median(col('longestTask'))), peakMB: r1(median(col('peakMB'))) });
  console.log(`  · ${name} [${size}] ${key}=${r1(m[key])} ms${m.journal != null ? ` · diario ${m.journal}` : ''}${m.longTasks != null ? ` · tareas largas ${m.longTasks} (máx ${m.longestTask} ms)` : ''}${m.peakMB != null ? ` · pico ${m.peakMB} MB` : ''}`);
}
const extra = (name, size, obj) => Object.assign(((R.metrics[name] ??= {})[size] ??= { samples: [] }), obj);

// ───────── monitor en la página ─────────
const MONITOR = () => {
  window.__lt = []; window.__mem = 0; window.__hoy = 0;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ entryTypes: ['longtask'] }); } catch { /* sin longtask */ }
  let last = performance.now(); window.__gaps = [];
  const f = (t) => { if (t - last > 50) window.__gaps.push(Math.round(t - last)); last = t;
    if (!window.__hoy && window.__perf?.c.colAt && [...document.querySelectorAll('h1')].some((h) => h.textContent.trim() === 'Hoy')) window.__hoy = Math.round(performance.now());
    requestAnimationFrame(f); };
  requestAnimationFrame(f);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Sesión: contexto + página + CDP. `dir` = perfil persistente (OPFS sobrevive). */
async function open(dir = null, { w = 1180, h = 820 } = {}) {
  const opts = { viewport: { width: w, height: h }, locale: 'es-MX', acceptDownloads: true, ...(IS_CR ? { args: ARGS } : {}) };
  let ctx, browser = null;
  if (dir) ctx = await type.launchPersistentContext(dir, opts);
  else { browser = await type.launch(IS_CR ? { args: ARGS } : {}); ctx = await browser.newContext(opts); }
  await ctx.addInitScript(MONITOR);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('dialog', (d) => d.accept());
  const cdp = IS_CR ? await ctx.newCDPSession(page) : null;
  if (cdp) await cdp.send('Performance.enable');
  const heap = async () => (cdp ? (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576 : 0);
  return { ctx, page, cdp, heap, close: async () => { await ctx.close(); await browser?.close(); } };
}

/** Mide `fn`: tiempo, escrituras al diario, tareas largas y pico de memoria (muestreo cada 100 ms). */
async function measure(s, fn, { resetCounters = true } = {}) {
  const { page, heap } = s;
  await page.evaluate(() => { window.__lt = []; window.__gaps = []; window.__mem = performance.memory?.usedJSHeapSize ?? 0; });
  if (resetCounters) await page.evaluate(() => window.__perf?.reset());
  let peak = await heap(), stop = false;
  const sampler = (async () => { while (!stop) { try { peak = Math.max(peak, await heap()); } catch { /* página navegando */ } await sleep(100); } })();
  const t0 = Date.now();
  let out;
  try { out = await fn(); } finally { stop = true; await sampler; }
  const ms = Date.now() - t0;
  const m = await page.evaluate(() => ({ lt: window.__lt, gaps: window.__gaps, mem: window.__mem, journal: window.__perf?.c.journal ?? 0 }));
  const lt = IS_CR ? m.lt : m.gaps;
  return { ms, journal: m.journal, longTasks: lt.length, longestTask: Math.round(Math.max(0, ...lt)), totalLongMs: Math.round(lt.reduce((a, b) => a + b, 0)), peakMB: Math.round(Math.max(peak, (m.mem || 0) / 1048576) * 10) / 10, ...(typeof out === 'object' && out ? out : {}) };
}

/** Espera (por rAF) a que `pred()` en la página sea verdadero; devuelve ms desde `t0` del que llama. */
const waitIn = (page, fnSrc, arg, timeout = 600000) => page.waitForFunction(fnSrc, arg, { timeout, polling: 'raf' });

// ───────── interfaz: empezar, importar ─────────
async function startEmpty(s) {
  await s.page.goto(URL_ + '?perf');
  await s.page.getByRole('button', { name: 'Empezar' }).click();
  await s.page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
}
/** Importa un archivo por «Importar archivo» (Mazos). Devuelve fases: leer+plan (a), aplicar (b). */
async function importFile(s, path, { timeout = 900000 } = {}) {
  const { page } = s;
  await page.goto(URL_ + '?perf#/mazos');
  await page.getByRole('button', { name: /^Importar( archivo)?$/ }).first().click();
  const t0 = Date.now();
  await page.locator('.sheet input[type=file]').first().setInputFiles(path);
  const go = page.locator('.sheet').getByRole('button', { name: 'Importar', exact: true });
  await go.waitFor({ timeout });
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('.sheet button')].find((x) => x.textContent.trim() === 'Importar'); return b && !b.disabled; }, null, { timeout });
  const t1 = Date.now();
  await go.click();
  await page.locator('.sheet').getByRole('button', { name: 'Listo' }).waitFor({ timeout });
  const t2 = Date.now();
  return { readPlanMs: t1 - t0, applyMs: t2 - t1 };
}
const closeSheets = async (page) => { for (let i = 0; i < 3 && (await page.locator('.scrim').count()); i++) { await page.keyboard.press('Escape'); await sleep(200); } };

// ───────── perfiles sembrados ─────────
const profile = (size) => PROF + 'seed-' + size;
async function seed(size) {
  const dir = profile(size);
  if (process.env.REUSE && existsSync(dir + '/.seeded')) return;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  console.log(`Sembrando ${size} (importar ${size}.zip por la interfaz)`);
  const s = await open(dir);
  await startEmpty(s);
  const m = await measure(s, () => importFile(s, FIX + size + '.zip'), { resetCounters: true });
  rec('importar-zip-boveda', size, m);
  await closeSheets(s.page);
  await sleep(1500);
  await s.close();
  writeFileSync(dir + '/.seeded', '1');
}
/** Copia del perfil sembrado (las pruebas que escriben no ensucian el original). */
async function withCopy(size, fn) {
  const dir = PROF + 'work-' + size + '-' + Date.now();
  cpSync(profile(size), dir, { recursive: true });
  const s = await open(dir);
  try { await s.page.goto(URL_ + '?perf'); await waitIn(s.page, () => window.__hoy); return await fn(s); } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
}

// ───────── tamaño del paquete ─────────
function bundle() {
  const dist = ROOT + 'dist/';
  const html = readFileSync(dist + 'index.html', 'utf8');
  const initial = new Set([...html.matchAll(/(?:src|href)="(?:\.?\/)?([^"]+\.(?:js|css))"/g)].map((m) => m[1]));
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) { if (f.isDirectory()) walk(d + f.name + '/'); else files.push((d + f.name).slice(dist.length)); } };
  walk(dist);
  const gz = (f) => gzipSync(readFileSync(dist + f), { level: 9 }).length;
  const rows = files.filter((f) => /\.(js|css|wasm|mjs)$/.test(f) && !f.startsWith('workbox')).map((f) => ({ f, raw: statSync(dist + f).size, gz: gz(f), initial: initial.has(f) }));
  const ini = rows.filter((r) => r.initial), def = rows.filter((r) => !r.initial).sort((a, b) => b.gz - a.gz);
  R.bundle = { initialGzKB: Math.round(ini.reduce((a, r) => a + r.gz, 0) / 102.4) / 10, initialRawKB: Math.round(ini.reduce((a, r) => a + r.raw, 0) / 102.4) / 10, initialFiles: ini.map((r) => r.f), deferredCount: def.length, deferredGzKB: Math.round(def.reduce((a, r) => a + r.gz, 0) / 102.4) / 10, deferred: def.map((r) => ({ file: r.f, gzKB: Math.round(r.gz / 102.4) / 10, rawKB: Math.round(r.raw / 102.4) / 10 })) };
  console.log(`Paquete: inicial ${R.bundle.initialGzKB} KB gzip (${ini.length} archivos), diferido ${R.bundle.deferredGzKB} KB gzip en ${def.length} fragmentos`);
}

// ───────── escenarios ─────────
async function startup(size) {
  const dir = profile(size);
  for (let i = 0; i < runsOf(size); i++) {
    const s = await open(dir);
    const reqs = { n: 0, bytes: 0 };
    if (s.cdp) { await s.cdp.send('Network.enable'); s.cdp.on('Network.loadingFinished', (e) => { reqs.bytes += e.encodedDataLength; }); s.cdp.on('Network.requestWillBeSent', () => reqs.n++); }
    await s.page.goto('about:blank');
    if (s.cdp) { await s.cdp.send('Network.clearBrowserCache'); await s.cdp.send('Storage.clearDataForOrigin', { origin: new URL(URL_).origin, storageTypes: 'service_workers,cache_storage,cache_storage' }); }
    for (const kind of ['frio', 'caliente']) {
      reqs.n = 0; reqs.bytes = 0;
      const m = await measure(s, async () => {
        await s.page.goto(URL_ + '?perf');
        await waitIn(s.page, () => window.__hoy);
        const o = await s.page.evaluate(() => ({ hoyMs: window.__hoy, colMs: window.__perf.c.colMs }));
        return o;
      });
      await sleep(kind === 'frio' ? 1500 : 300); // el SW termina de cachear en frío
      m.requests = reqs.n; m.transferKB = Math.round(reqs.bytes / 102.4) / 10;
      m.heapAfterMB = Math.round(await s.heap() * 10) / 10;
      rec('arranque-' + kind + '-hasta-Hoy', size, m, 'hoyMs');
      extra('arranque-' + kind + '-hasta-Hoy', size, { requests: median(R.metrics['arranque-' + kind + '-hasta-Hoy'][size].samples.map((x) => x.requests)), transferKB: median(R.metrics['arranque-' + kind + '-hasta-Hoy'][size].samples.map((x) => x.transferKB)), colMs: median(R.metrics['arranque-' + kind + '-hasta-Hoy'][size].samples.map((x) => x.colMs)) });
    }
    await s.close();
  }
}

const ROUTES = [['mazos', /^Mazos$/], ['notas', /^Notas$/], ['estadisticas', /^Estad[ií]sticas$/], ['hoy', /^Hoy$/]];
async function screens(size) {
  const s = await open(profile(size));
  await s.page.goto(URL_ + '?perf'); await waitIn(s.page, () => window.__hoy);
  for (let i = 0; i < runsOf(size); i++) {
    for (const [route, re] of ROUTES) {
      const m = await measure(s, () => s.page.evaluate(([route, src]) => new Promise((res) => {
        const re = new RegExp(src); const t0 = performance.now();
        location.hash = '#/' + route;
        const tick = () => { if ([...document.querySelectorAll('h1')].some((h) => re.test(h.textContent.trim()))) requestAnimationFrame(() => requestAnimationFrame(() => res({ navMs: Math.round(performance.now() - t0) }))); else requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      }), [route, re.source]));
      await sleep(400);
      rec('pantalla-' + route, size, m, 'navMs');
    }
  }
  // cambio completo Hoy→Mazos→Notas→Estadísticas→Hoy (suma por ciclo)
  const cyc = R.metrics['pantalla-hoy']?.[size];
  extra('ciclo-pantallas', size, { median: r1(ROUTES.reduce((a, [r]) => a + (R.metrics['pantalla-' + r][size].median ?? 0), 0)), note: 'suma de las medianas de las 4 transiciones' });
  void cyc;
  await s.close();
}

async function study(size) {
  await withCopy(size, async (s) => {
    const { page } = s;
    await page.goto(URL_ + '?perf#/estudiar');
    const show = page.getByRole('button', { name: /Mostrar respuesta/ });
    await show.waitFor({ timeout: 120000 });
    const per = Math.ceil(40 / runsOf(size)) + 10;
    const batch = [];
    for (let run = 0; run < runsOf(size); run++) {
      const a = [], b = [];
      let j0 = 0;
      const m = await measure(s, async () => {
        for (let k = 0; k < per; k++) {
          await show.waitFor();
          const t0 = await page.evaluate(() => performance.now());
          await show.click();
          await page.locator('.grades .grade').nth(2).waitFor();
          const t1 = await page.evaluate(() => performance.now());
          j0 = await page.evaluate(() => window.__perf.c.journal ?? 0);
          await page.locator('.grades .grade').nth(2).click();
          await show.waitFor();
          const t2 = await page.evaluate(() => performance.now());
          a.push(t1 - t0); b.push(t2 - t1);
        }
      });
      void j0;
      batch.push(...b);
      rec('estudio-mostrar', size, { ...m, ms: median(a), p95ms: p95(a) });
      rec('estudio-responder-siguiente', size, { ...m, ms: median(b), p95ms: p95(b), journalPerCard: m.journal / per });
      extra('estudio-responder-siguiente', size, { p95: r1(p95(batch)), allMedian: r1(median(batch)), cards: batch.length });
    }
  });
}

async function fsrs(size) {
  const text = readFileSync(FIX + 'reviews-100k.jsonl', 'utf8');
  await withCopy(size, async (s) => {
    for (let i = 0; i < runsOf(size); i++) {
      const m = await measure(s, () => s.page.evaluate((t) => window.__perf.api.fsrs(t), text));
      rec('fsrs-100k-reconstruir-y-verificar', size, { ...m, ms: m.parseMs + m.replayMs + m.verifyMs, sinEscribirMs: undefined });
      extra('fsrs-100k-reconstruir-y-verificar', size, { parts: { parseMs: r1(m.parseMs), replayMs: r1(m.replayMs), loadStatesMs: r1(m.loadStatesMs), verifyMs: r1(m.verifyMs), entries: m.entries, cards: m.cards, ok: m.ok } });
    }
  });
}

async function search(size) {
  await withCopy(size, async (s) => {
    const qs = ['ritmo', 'arteria ventrículo', 'fármaco dosis', 'sodio', 'nota 12', 'insulina tiroides', 'bloqueo', 'canal iones', 'vacuna', 'derivación pared'];
    for (let i = 0; i < runsOf(size); i++) {
      const m = await measure(s, () => s.page.evaluate(() => window.__perf.api.buildIndex()));
      rec('busqueda-indice', size, { ...m, ms: m.readMs + m.resetMs });
      extra('busqueda-indice', size, { parts: { readMs: r1(m.readMs), resetMs: r1(m.resetMs), notes: m.notes } });
    }
    const lat = [];
    for (let r = 0; r < 5; r++) for (const q of qs) lat.push((await s.page.evaluate((q) => window.__perf.api.query(q), q)).ms);
    extra('busqueda-consulta', size, { median: r1(median(lat)), p95: r1(p95(lat)), n: lat.length });
    console.log(`  · busqueda-consulta [${size}] mediana ${r1(median(lat))} ms · p95 ${r1(p95(lat))} ms`);
  });
}

async function notes(size = 'S') {
  await withCopy(size, async (s) => {
    const { page } = s;
    await importFile(s, FIX + 'big-notes.zip'); await closeSheets(page);
    const LAT = () => page.evaluate(() => { window.__lat = []; if (!window.__latOn) { window.__latOn = 1; document.addEventListener('input', () => { const t = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => window.__lat.push(performance.now() - t))); }, true); } });
    const view = (n) => page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: n });
    for (const [label, name] of [['1MB', 'Nota 1 MB'], ['5MB', 'Nota 5 MB']]) {
      const path = encodeURI(`Grandes/${name}.md`);
      for (let i = 0; i < RUNS; i++) {
        await page.goto(URL_ + '?perf#/hoy'); await sleep(400);
        const mo = await measure(s, async () => { await page.goto(URL_ + '?perf#/notas/' + path); await page.locator('.doc [aria-label="Editar bloque"]').last().waitFor({ timeout: 180000 }); await sleep(1500); });
        rec('nota-abrir-' + label, 'nota', mo);
        // teclear 50 caracteres en un bloque (vista Documento)
        const blocks = page.locator('main .doc [aria-label="Editar bloque"]');
        await blocks.nth(Math.floor((await blocks.count()) / 2)).click();
        const ta0 = page.locator('main .doc textarea').first();
        await ta0.waitFor(); await ta0.press('End'); await LAT();
        const mt = await measure(s, async () => { await page.keyboard.type('a'.repeat(50), { delay: 25 }); await sleep(2500); });
        const lat = await page.evaluate(() => window.__lat);
        rec('nota-teclear-50-bloque-' + label, 'nota', { ...mt, ms: median(lat), p95ms: p95(lat) });
        await page.keyboard.press('Escape');
        // teclear 50 caracteres en la vista Markdown (textarea con todo el texto)
        await view('Ver Markdown').click();
        const ta = page.getByRole('textbox', { name: 'Markdown de la nota' });
        await ta.waitFor({ timeout: 180000 });
        await ta.focus();
        await page.evaluate(() => { const t = document.activeElement; t.setSelectionRange(t.value.length / 2, t.value.length / 2); });
        await LAT();
        const mm = await measure(s, async () => { await page.keyboard.type('b'.repeat(50), { delay: 25 }); await sleep(2500); });
        const lat2 = await page.evaluate(() => window.__lat);
        rec('nota-teclear-50-markdown-' + label, 'nota', { ...mm, ms: median(lat2), p95ms: p95(lat2) });
        await view('Documento').click();
        await page.locator('.doc [aria-label="Editar bloque"]').last().waitFor({ timeout: 180000 });
        // buscar en la nota
        await page.getByRole('button', { name: 'Buscar en esta nota' }).first().click();
        const mf = await measure(s, async () => { await page.getByRole('searchbox', { name: 'Buscar en esta nota' }).fill('ritmo'); await page.locator('.find-bar .num').filter({ hasText: /de/ }).waitFor({ timeout: 180000 }); });
        rec('nota-buscar-en-nota-' + label, 'nota', mf);
        await page.keyboard.press('Escape');
      }
    }
  });
}

async function moves(size) {
  await withCopy(size, async (s) => {
    let from = 'Lote', dest = 'Movidas/A';
    for (let i = 0; i < runsOf(size); i++) {
      const m = await measure(s, async () => { const r = await s.page.evaluate(([f, d]) => window.__perf.api.moveNotes(f, d), [from, dest]); return { n: r.n, journalApi: r.journal }; });
      rec('mover-100-notas', size, m);
      [from, dest] = from === 'Lote' ? ['Movidas/A', 'Lote'] : ['Lote', 'Movidas/A'];
      if (from === 'Movidas/A') dest = 'Lote';
    }
    let path = 'decks/Rendimiento/Grande.md', folder = 'Otros';
    for (let i = 0; i < runsOf(size); i++) {
      const m = await measure(s, async () => { const r = await s.page.evaluate(([p, f]) => window.__perf.api.moveDeck(p, f), [path, folder]); return { cards: r.cards, journalApi: r.journal }; });
      rec('mover-mazo-5000', size, m);
      [path, folder] = folder === 'Otros' ? ['decks/Otros/Grande.md', 'Rendimiento'] : ['decks/Rendimiento/Grande.md', 'Otros'];
    }
  });
}

async function imports() {
  const items = [['importar-zip-500-archivos', FIX + 'files500.zip'], ['importar-apkg-5000', FIX + 'apkg-5000.apkg']];
  for (const [name, f] of items) {
    if (!existsSync(f)) { console.warn('  (falta ' + f + ')'); continue; }
    for (let i = 0; i < RUNS; i++) {
      const s = await open(null);
      await startEmpty(s);
      const m = await measure(s, () => importFile(s, f));
      rec(name, 'n/a', { ...m, ms: m.readPlanMs + m.applyMs });
      await s.close();
    }
  }
}

async function backups(size) {
  mkdirSync(PROF + 'out', { recursive: true });
  const zipPath = PROF + 'out/respaldo-' + size + '.zip';
  await withCopy(size, async (s) => {
    for (let i = 0; i < runsOf(size); i++) {
      const m = await measure(s, async () => {
        const r = await s.page.evaluate(() => window.__perf.api.backup());
        return r;
      });
      rec('respaldo-crear', size, { ...m, ms: m.collectMs + m.zipMs });
      extra('respaldo-crear', size, { parts: { collectMs: r1(m.collectMs), zipMs: r1(m.zipMs), files: m.files, MB: Math.round(m.bytes / 104857.6) / 10 } });
    }
    const [dl] = await Promise.all([s.page.waitForEvent('download', { timeout: 300000 }), s.page.evaluate(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(window.__backup); a.download = 'respaldo.zip'; document.body.append(a); a.click(); })]);
    await dl.saveAs(zipPath);
  });
  for (let i = 0; i < runsOf(size); i++) {
    const s = await open(null);
    await startEmpty(s);
    const m = await measure(s, () => importFile(s, zipPath));
    rec('respaldo-restaurar', size, { ...m, ms: m.readPlanMs + m.applyMs });
    await s.close();
  }
  rmSync(zipPath, { force: true });
}

// ───────── ejecución ─────────
const step = async (name, fn) => { console.log('\n== ' + name); const t = Date.now(); try { await fn(); } catch (e) { console.error('  FALLÓ ' + name + ': ' + (e.stack || e).toString().split('\n').slice(0, 4).join(' | ')); (R.errors ??= []).push(name + ': ' + e.message); } console.log(`   (${Math.round((Date.now() - t) / 1000)} s)`); writeFileSync(OUT, JSON.stringify(R, null, 1)); };
mkdirSync(new URL('.', 'file://' + OUT).pathname, { recursive: true });
try {
  await step('paquete', async () => bundle());
  for (const sz of SIZES) await step('sembrar ' + sz, () => seed(sz));
  if (want('inicio')) for (const sz of SIZES) await step('arranque ' + sz, () => startup(sz));
  if (want('pantallas')) for (const sz of SIZES.filter((x) => x !== 'S')) await step('pantallas ' + sz, () => screens(sz));
  if (want('estudio')) for (const sz of SIZES.filter((x) => x !== 'S')) await step('estudio ' + sz, () => study(sz));
  if (want('fsrs') && SIZES.includes('L')) await step('fsrs L', () => fsrs('L'));
  if (want('busqueda')) for (const sz of SIZES.filter((x) => x !== 'S')) await step('búsqueda ' + sz, () => search(sz));
  if (want('notas')) await step('notas grandes', () => notes('S'));
  if (want('mover')) for (const sz of SIZES.filter((x) => x !== 'S')) await step('mover ' + sz, () => moves(sz));
  if (want('importar')) await step('importar', imports);
  if (want('respaldo') && SIZES.includes('L')) await step('respaldo L', () => backups('L'));
} finally {
  writeFileSync(OUT, JSON.stringify(R, null, 1));
  console.log('\nEscrito ' + OUT);
  server.kill();
  process.exit(0);
}
