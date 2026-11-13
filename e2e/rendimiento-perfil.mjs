// Prompt 21 · Fase 1: perfilado de los escenarios más costosos de la línea base (solo mide; no optimiza).
//   npx vite build --minify false --outDir <dir>/dist-prof --emptyOutDir      (nombres de funciones legibles)
//   DIST=<dir>/dist-prof OUTDIR=<dir>/perfiles [ONLY=arranque,notas,ciclo,mover,zip500,restaurar,respaldo,nota5mb,estudio,fsrs] node e2e/rendimiento-perfil.mjs
// Por escenario: perfil de CPU del hilo principal (CDP Profiler, 0.2 ms), tiempo propio y total por función de src/
// y de dependencias, nº y tiempo acumulado de operaciones al Worker de OPFS (por tipo), tareas largas y pico de memoria.
// Los .cpuprofile crudos (abribles en DevTools) se guardan en OUTDIR; el resumen en OUTDIR/resumen.json.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const ROOT = new URL('../', import.meta.url).pathname;
const FIX = ROOT + 'tests/fixtures/rendimiento/';
const DIST = process.env.DIST || ROOT + 'dist';
const OUTDIR = process.env.OUTDIR || tmpdir() + '/engrama-perfiles';
const PROF = (process.env.PROFILES || tmpdir() + '/engrama-perf') + '/';
const PORT = Number(process.env.PORT) || 4196;
const URL_ = `http://localhost:${PORT}/`;
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const want = (k) => !only || only.includes(k);
mkdirSync(OUTDIR, { recursive: true });

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { stdio: 'pipe', cwd: ROOT });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
const ARGS = ['--enable-precise-memory-info'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};

// Cuenta y cronometra los mensajes al Worker de OPFS (op + id) sin tocar el código de la app.
const HOOK = () => {
  window.__ops = {}; window.__opsOn = true; window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ entryTypes: ['longtask'] }); } catch { /* sin longtask */ }
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(...a) {
      super(...a);
      const start = new Map();
      this.addEventListener('message', (ev) => {
        const r = ev.data; const s = start.get(r?.id);
        if (!s || 'progress' in r || 'alive' in r) return;
        start.delete(r.id);
        const o = (window.__ops[s.op] ??= { n: 0, ms: 0, bytes: 0 });
        o.n++; o.ms += performance.now() - s.t;
        if (r.value && r.value.byteLength) o.bytes += r.value.byteLength;
      });
      const post = this.postMessage.bind(this);
      this.postMessage = (m, t) => {
        if (window.__opsOn && m && typeof m.op === 'string' && typeof m.id === 'number') { start.set(m.id, { op: m.op, t: performance.now() }); if (m.data?.byteLength) ((window.__ops[m.op + ':enviado'] ??= { n: 0, ms: 0, bytes: 0 }).bytes += m.data.byteLength); }
        return post(m, t);
      };
    }
  };
};

async function open(dir = null) {
  const opts = { viewport: { width: 1180, height: 820 }, locale: 'es-MX', acceptDownloads: true, args: ARGS };
  let ctx, browser = null;
  if (dir) ctx = await pw.chromium.launchPersistentContext(dir, opts);
  else { browser = await pw.chromium.launch({ args: ARGS }); ctx = await browser.newContext(opts); }
  await ctx.addInitScript(HOOK);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('dialog', (d) => d.accept());
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable'); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  const heap = async () => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576;
  const reqs = [];
  page.on('request', (r) => reqs.push(r.url().replace(URL_, '')));
  return { ctx, page, cdp, heap, reqs, close: async () => { await ctx.close(); await browser?.close(); } };
}
const withCopy = async (size, fn) => {
  const dir = PROF + 'perfil-' + size + '-' + Date.now();
  cpSync(PROF + 'seed-' + size, dir, { recursive: true });
  const s = await open(dir);
  try { await s.page.goto(URL_ + '?perf'); await s.page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor(); await sleep(1500); return await fn(s); } finally { await s.close(); rmSync(dir, { recursive: true, force: true }); }
};
const waitIn = (page, fn, arg, timeout = 600000) => page.waitForFunction(fn, arg, { timeout, polling: 'raf' });

// ───────── análisis del perfil ─────────
function analyze(profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const key = (n) => `${n.callFrame.functionName || '(anónima)'} ${n.callFrame.url.replace(/^.*\/assets\//, '').replace(/^.*\//, '')}:${n.callFrame.lineNumber + 1}`;
  const self = new Map(), incl = new Map();
  let total = 0, idle = 0, gc = 0, prog = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = (profile.timeDeltas[i] ?? 0) / 1000;
    const n = nodes.get(profile.samples[i]);
    total += dt;
    const fn = n.callFrame.functionName;
    if (fn === '(idle)') { idle += dt; continue; }
    if (fn === '(garbage collector)') gc += dt;
    if (fn === '(program)') prog += dt;
    const k = key(n);
    self.set(k, (self.get(k) ?? 0) + dt);
    const seen = new Set();
    for (let id = n.id; id != null; id = parent.get(id)) { const kk = key(nodes.get(id)); if (!seen.has(kk)) { seen.add(kk); incl.set(kk, (incl.get(kk) ?? 0) + dt); } }
  }
  const top = (m, n, f = () => true) => [...m].filter(([k]) => f(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, Math.round(v * 10) / 10]);
  const isApp = (k) => !/\(root\)|\(program\)|\(idle\)|\(garbage|^\(anónima\) $/.test(k);
  return { totalMs: Math.round(total), activeMs: Math.round(total - idle), gcMs: Math.round(gc), programMs: Math.round(prog), topSelf: top(self, 14, isApp), topIncl: top(incl, 22, (k) => isApp(k) && !/^\(anónima\) /.test(k)) };
}

/** Ejecuta `fn` con perfil de CPU, contadores de operaciones, tareas largas y pico de memoria. */
async function profileRun(name, s, fn) {
  const { page, cdp, heap } = s;
  await page.evaluate(() => { window.__ops = {}; window.__lt = []; window.__opsOn = true; window.__perf?.reset(); });
  await cdp.send('Profiler.start');
  let peak = await heap(), stop = false;
  const sampler = (async () => { while (!stop) { try { peak = Math.max(peak, await heap()); } catch { /* navegando */ } await sleep(100); } })();
  const t0 = Date.now();
  let out;
  try { out = await fn(); } finally { stop = true; await sampler; }
  const ms = Date.now() - t0;
  const { profile } = await cdp.send('Profiler.stop');
  const m = await page.evaluate(() => { window.__opsOn = false; return { ops: window.__ops, lt: window.__lt, c: window.__perf?.c ?? {} }; }).catch(() => ({ ops: {}, lt: [], c: {} }));
  writeFileSync(`${OUTDIR}/${name}.cpuprofile`, JSON.stringify(profile));
  const a = analyze(profile);
  const ops = Object.fromEntries(Object.entries(m.ops).map(([k, v]) => [k, { n: v.n, ms: Math.round(v.ms), MB: Math.round(v.bytes / 104857.6) / 10 }]));
  const res = { name, wallMs: ms, ...a, longTasks: m.lt.length, longestMs: Math.max(0, ...m.lt.map((x) => x[1])), longTotalMs: m.lt.reduce((x, y) => x + y[1], 0), peakMB: Math.round(peak * 10) / 10, opsToWorker: ops, journal: m.c.journal ?? 0, out };
  R[name] = res;
  writeFileSync(OUTDIR + '/resumen.json', JSON.stringify(R, null, 1));
  console.log(`\n### ${name}: pared ${ms} ms · CPU activa ${a.activeMs} ms (gc ${a.gcMs}) · tareas largas ${res.longTasks} (máx ${res.longestMs}) · pico ${res.peakMB} MB · diario ${res.journal}`);
  console.log('  ops Worker: ' + Object.entries(ops).map(([k, v]) => `${k} ×${v.n} (${v.ms} ms, ${v.MB} MB)`).join(' · '));
  console.log('  self: ' + a.topSelf.slice(0, 6).map(([k, v]) => `${v} ${k}`).join(' | '));
  console.log('  incl: ' + a.topIncl.slice(0, 12).map(([k, v]) => `${v} ${k}`).join(' | '));
  return res;
}

async function startEmpty(s) {
  await s.page.goto(URL_ + '?perf');
  await s.page.getByRole('button', { name: 'Empezar' }).click();
  await s.page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await sleep(500);
}
async function importFile(s, path) {
  const { page } = s;
  await page.goto(URL_ + '?perf#/mazos');
  await page.getByRole('button', { name: /^Importar( archivo)?$/ }).first().click();
  await page.locator('.sheet input[type=file]').first().setInputFiles(path);
  const go = page.locator('.sheet').getByRole('button', { name: 'Importar', exact: true });
  await go.waitFor({ timeout: 900000 });
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('.sheet button')].find((x) => x.textContent.trim() === 'Importar'); return b && !b.disabled; }, null, { timeout: 900000 });
  const t1 = Date.now();
  await go.click();
  await page.locator('.sheet').getByRole('button', { name: 'Listo' }).waitFor({ timeout: 900000 });
  return { applyMs: Date.now() - t1 };
}
const navTo = (page, route, re) => page.evaluate(([route, src]) => new Promise((res) => {
  const r = new RegExp(src); const t0 = performance.now(); location.hash = '#/' + route;
  const tick = () => { if ([...document.querySelectorAll('h1')].some((h) => r.test(h.textContent.trim()))) requestAnimationFrame(() => requestAnimationFrame(() => res(Math.round(performance.now() - t0)))); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}), [route, re.source]);

const step = async (k, fn) => { if (!want(k)) return; console.log('\n== ' + k); try { await fn(); } catch (e) { console.error('FALLÓ ' + k + ': ' + (e.stack || e).toString().split('\n').slice(0, 4).join(' | ')); (R.errors ??= []).push(k + ': ' + e.message); } };

try {
  await step('arranque', async () => {
    const s = await open(PROF + 'seed-L');
    await s.page.goto('about:blank');
    await s.cdp.send('Network.enable');
    s.reqs.length = 0;
    await profileRun('arranque-L', s, async () => { await s.page.goto(URL_ + '?perf'); await waitIn(s.page, () => window.__hoy || (window.__perf?.c.colAt && [...document.querySelectorAll('h1')].some((h) => h.textContent.trim() === 'Hoy'))); await sleep(800); return { requests: s.reqs.length, urls: [...s.reqs] }; });
    await s.close();
  });
  await step('notas', async () => withCopy('L', async (s) => {
    await profileRun('abrir-notas-L', s, async () => { const ms = await navTo(s.page, 'notas', /^Notas$/); await sleep(9000); return { navMs: ms }; });
  }));
  await step('ciclo', async () => withCopy('L', async (s) => {
    await profileRun('ciclo-pantallas-L', s, async () => {
      const t = {};
      for (const [r, re] of [['mazos', /^Mazos$/], ['notas', /^Notas$/], ['estadisticas', /^Estad[ií]sticas$/], ['hoy', /^Hoy$/]]) { t[r] = await navTo(s.page, r, re); await sleep(r === 'notas' ? 7000 : 800); }
      return t;
    });
  }));
  await step('mover', async () => withCopy('L', async (s) => {
    await profileRun('mover-100-notas-L', s, () => s.page.evaluate(() => window.__perf.api.moveNotes('Lote', 'Movidas/A')));
  }));
  await step('zip500', async () => {
    const s = await open(null); await startEmpty(s);
    await profileRun('importar-zip-500', s, () => importFile(s, FIX + 'files500.zip'));
    await s.close();
  });
  await step('restaurar', async () => {
    const s = await open(null); await startEmpty(s);
    await profileRun('restaurar-respaldo-L', s, () => importFile(s, FIX + 'L.zip'));
    await s.close();
  });
  await step('respaldo', async () => withCopy('L', async (s) => {
    await profileRun('crear-respaldo-L', s, () => s.page.evaluate(() => window.__perf.api.backup()));
  }));
  await step('nota5mb', async () => {
    const s = await open(null); await startEmpty(s);
    await importFile(s, FIX + 'big-notes.zip');
    await s.page.keyboard.press('Escape'); await sleep(500);
    const path = encodeURI('Grandes/Nota 5 MB.md');
    await s.page.goto(URL_ + '?perf#/hoy'); await sleep(500);
    await profileRun('abrir-nota-5MB', s, async () => { await s.page.goto(URL_ + '?perf#/notas/' + path); await s.page.locator('.doc [aria-label="Editar bloque"]').last().waitFor({ timeout: 180000 }); await sleep(1500); });
    await s.page.getByRole('button', { name: 'Buscar en esta nota' }).first().click();
    await profileRun('buscar-en-nota-5MB', s, async () => { await s.page.getByRole('searchbox', { name: 'Buscar en esta nota' }).fill('ritmo'); await s.page.locator('.find-bar .num').filter({ hasText: /de/ }).waitFor({ timeout: 180000 }); });
    await s.close();
  });
  // Con el análisis de integridad ya terminado (sin contención en la cola del Worker): ¿cuánto tarda y cuánto cuestan después Notas y el estudio?
  await step('quieto', async () => withCopy('L', async (s) => {
    const { page } = s;
    await page.goto(URL_ + '?perf');
    const t0 = Date.now(); let last = -1, lastT = Date.now(), series = [];
    await waitIn(page, () => window.__perf?.c.colAt);
    while (Date.now() - lastT < 4000) { const n = await page.evaluate(() => window.__ops.read?.n ?? 0); if (n !== last) { last = n; lastT = Date.now(); series.push([Date.now() - t0, n]); } await sleep(250); }
    R['integridad-L'] = { seconds_until_reads_stop: Math.round((lastT - t0) / 100) / 10, totalReads: last, series: series.filter((_, i) => i % 6 === 0) };
    console.log('\n### integridad: lecturas hasta quedar quieto', last, 'en', (lastT - t0) / 1000, 's');
    await profileRun('abrir-notas-L-quieto', s, async () => { const ms = await navTo(page, 'notas', /^Notas$/); await sleep(6000); return { navMs: ms }; });
    await navTo(page, 'hoy', /^Hoy$/); await sleep(1500);
    await profileRun('ciclo-pantallas-L-quieto', s, async () => {
      const t = {};
      for (const [r, re] of [['mazos', /^Mazos$/], ['notas', /^Notas$/], ['estadisticas', /^Estad[ií]sticas$/], ['hoy', /^Hoy$/]]) { t[r] = await navTo(page, r, re); await sleep(r === 'notas' ? 4000 : 800); }
      return t;
    });
    await page.goto(URL_ + '?perf#/estudiar');
    const show = page.getByRole('button', { name: /Mostrar respuesta/ });
    await show.waitFor({ timeout: 120000 }); await sleep(1000);
    await profileRun('estudio-10-respuestas-L-quieto', s, async () => { for (let k = 0; k < 10; k++) { await show.waitFor(); await show.click(); await page.locator('.grades .grade').nth(2).waitFor(); await page.locator('.grades .grade').nth(2).click(); await show.waitFor(); } });
  }));
  // Un solo app.changed() (marcar una nota): ¿qué se vuelve a hacer? (Hoy abierto, y Notas abierto)
  await step('changed', async () => withCopy('L', async (s) => {
    const { page } = s;
    await sleep(14000); // deja terminar el análisis de integridad del arranque
    await profileRun('changed-con-Hoy-abierto-L', s, async () => { await page.evaluate(() => { location.hash = '#/notas/' + encodeURI('Lote/Nota 7.md'); }); await page.getByRole('button', { name: 'Marcar' }).first().waitFor({ timeout: 60000 }); await sleep(9000); });
    await profileRun('changed-un-solo-marcador-L', s, async () => { await page.getByRole('button', { name: 'Marcar' }).first().click(); await sleep(14000); });
  }));
  await step('estudio', async () => withCopy('L', async (s) => {
    const { page } = s;
    await page.goto(URL_ + '?perf#/estudiar');
    const show = page.getByRole('button', { name: /Mostrar respuesta/ });
    await show.waitFor({ timeout: 120000 }); await sleep(1000);
    await profileRun('estudio-10-respuestas-L', s, async () => { for (let k = 0; k < 10; k++) { await show.waitFor(); await show.click(); await page.locator('.grades .grade').nth(2).waitFor(); await page.locator('.grades .grade').nth(2).click(); await show.waitFor(); } });
  }));
  await step('fsrs', async () => withCopy('L', async (s) => {
    const text = readFileSync(FIX + 'reviews-100k.jsonl', 'utf8');
    await profileRun('fsrs-100k', s, () => s.page.evaluate((t) => window.__perf.api.fsrs(t), text));
  }));
} finally {
  writeFileSync(OUTDIR + '/resumen.json', JSON.stringify(R, null, 1));
  console.log('\nEscrito ' + OUTDIR + '/resumen.json');
  server.kill();
  process.exit(0);
}
void existsSync;
