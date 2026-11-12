// Mini prompt «vidrio»: mide fps, pintado/composición y superficies con backdrop-filter visibles en
// (a) Hoy con fondo de foto de 2400 px, (b) Espacios con 4 paneles (paneo y zoom), (c) Notas con
// una nota larga.   npm run build && PERF_LABEL=antes node e2e/glass-perf.mjs
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { strToU8, zipSync } from 'fflate';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4185;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
const R = { browser: type.name(), date: new Date().toISOString() };

/** Superficies con backdrop-filter visibles (en la pantalla y no ocultas). */
const glassCount = (page) => page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => {
  const cs = getComputedStyle(e), f = cs.backdropFilter || cs.webkitBackdropFilter;
  if (!f || f === 'none') return false;
  const r = e.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && cs.visibility !== 'hidden';
}).length);
/** fps durante `ms` mientras `step()` corre en cada fotograma (en la página). */
const fpsWhile = (page, stepSrc, ms = 2000) => page.evaluate(({ stepSrc, ms }) => new Promise((res) => {
  const step = new Function('i', stepSrc);
  const t0 = performance.now(); let n = 0, last = t0; const gaps = [];
  const f = (t) => { gaps.push(t - last); last = t; step(n++); if (t - t0 < ms) requestAnimationFrame(f); else { gaps.sort((a, b) => a - b); res({ fps: Math.round((n / (t - t0)) * 1000), p95FrameMs: Math.round(gaps[Math.floor(gaps.length * 0.95)]), worstFrameMs: Math.round(gaps[gaps.length - 1]) }); } };
  requestAnimationFrame(f);
}), { stepSrc, ms });
/** Pintado y composición (traza de Chromium) mientras corre `fn`. */
async function traced(page, fn) {
  if (type !== pw.chromium) return { ...(await fn()), paintMs: null };
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'] });
  const out = await fn();
  const buf = await browser.stopTracing();
  const ev = JSON.parse(buf.toString()).traceEvents ?? [];
  const sum = (names) => Math.round(ev.filter((e) => names.includes(e.name) && e.dur).reduce((a, e) => a + e.dur, 0) / 1000);
  return { ...out, paintMs: sum(['Paint', 'PaintImage']), compositeMs: sum(['CompositeLayers', 'UpdateLayerTree', 'Layerize']), rasterMs: sum(['RasterTask']), styleLayoutMs: sum(['UpdateLayoutTree', 'Layout']) };
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'es-MX' });
  // experimento: EXP=noblur quita todo backdrop-filter; EXP=nosat deja solo el blur; EXP=blur24 baja el de .strong
  const EXP = { noblur: '* { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }', nosat: '.glass { -webkit-backdrop-filter: blur(calc(var(--blur) * var(--k))) !important; backdrop-filter: blur(calc(var(--blur) * var(--k))) !important; } .glass.strong { -webkit-backdrop-filter: blur(40px) !important; backdrop-filter: blur(40px) !important; } .glass .glass, .glass.flat, .light-mode .glass { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }' , noshadow: '.glass { box-shadow: var(--hilite) !important; }', promote: '.bg-layer { transform: translateZ(0); } .topbar, .dock { isolation: isolate; }' }[process.env.EXP];
  if (EXP) await ctx.addInitScript((css) => addEventListener('DOMContentLoaded', () => document.head.append(Object.assign(document.createElement('style'), { textContent: css }))), EXP);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  // fondo: «foto» de 2400 px (ruido de color + formas: se comprime y difumina como una foto)
  const jpg = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 2400; c.height = 1600; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 2400, 1600); g.addColorStop(0, '#1d3a5a'); g.addColorStop(0.5, '#c79a5b'); g.addColorStop(1, '#2d5a3a'); x.fillStyle = g; x.fillRect(0, 0, 2400, 1600);
    for (let i = 0; i < 400; i++) { x.fillStyle = `hsla(${(i * 37) % 360} 60% ${30 + (i % 50)}% / .35)`; x.beginPath(); x.arc((i * 97) % 2400, (i * 53) % 1600, 20 + (i % 90), 0, 7); x.fill(); }
    const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85)); return [...new Uint8Array(await b.arrayBuffer())];
  });
  await page.goto(URL_ + '#/ajustes');
  await page.locator('.settings').waitFor();
  if (await page.getByRole('button', { name: 'Desplegar todo' }).count()) { await page.getByRole('button', { name: 'Desplegar todo' }).click(); await page.waitForTimeout(300); }
  await page.locator('.bg-grid input[type=file]').setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(jpg) });
  await page.locator('.bg-layer img').waitFor();
  await page.getByRole('region', { name: 'Apariencia · Fondo' }).getByRole('button', { name: 'Aplicar' }).click();
  await page.waitForTimeout(800);

  console.log('(a) Hoy con fondo de foto');
  await page.goto(URL_ + '#/hoy');
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.waitForTimeout(1200);
  R.hoy = { glass: await glassCount(page), ...(await traced(page, () => fpsWhile(page, 'const s = document.scrollingElement; s.scrollTop = (i % 60 < 30 ? (i % 30) : 30 - (i % 30)) * 20;'))) };
  console.log('  ', JSON.stringify(R.hoy));
  await page.screenshot({ path: OUT + `glass-hoy-${process.env.PERF_LABEL || 'actual'}.png` });

  console.log('(b) Espacios: 4 paneles, paneo y zoom');
  await page.goto(URL_ + '#/espacios');
  await page.getByRole('button', { name: 'Nuevo espacio' }).first().click();
  await page.locator('.sheet input[name=n]').fill('Vidrio');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.getByRole('group', { name: 'Modo' }).getByRole('button', { name: 'Lienzo' }).click();
  await page.locator('.canvas-wrap').waitFor();
  for (let i = 0; i < 4; i++) {
    await page.getByRole('button', { name: 'Añadir panel', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Añadir panel ' + (i % 2 ? 'Pomodoro' : 'Estadísticas'), exact: true }).evaluate((x) => x.click());
    await page.waitForTimeout(200);
  }
  await page.getByRole('button', { name: 'Ajustar al contenido' }).evaluate((b) => b.click());
  await page.waitForTimeout(800);
  const glassSp = await glassCount(page);
  // paneo y zoom con eventos de rueda reales del lienzo (el mismo camino que el trackpad)
  R.espacios = { glass: glassSp, ...(await traced(page, () => fpsWhile(page, `const w = document.querySelector('.canvas-wrap'), r = w.getBoundingClientRect(); w.dispatchEvent(new WheelEvent('wheel', i % 4 === 3 ? { deltaY: (i % 8 < 4 ? 8 : -8), ctrlKey: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, bubbles: true, cancelable: true } : { deltaX: (i % 40 < 20 ? 6 : -6), deltaY: 3, clientX: r.x + 100, clientY: r.y + 100, bubbles: true, cancelable: true }));`, 2500))) };
  R.espacios.glassDuringGesture = await page.evaluate(() => new Promise((res) => { const w = document.querySelector('.canvas-wrap'); w.dispatchEvent(new WheelEvent('wheel', { deltaX: 5, deltaY: 0, bubbles: true, cancelable: true })); requestAnimationFrame(() => res([...document.querySelectorAll('.canvas-wrap *')].filter((e) => { const f = getComputedStyle(e).backdropFilter; return f && f !== 'none'; }).length)); }));
  console.log('  ', JSON.stringify(R.espacios));
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + `glass-espacios-${process.env.PERF_LABEL || 'actual'}.png` });

  console.log('(c) Notas: nota larga');
  const larga = '# Larga\n\n' + Array.from({ length: 400 }, (_, i) => (i % 6 === 2 ? `| A | B |\n|---|---|\n| ${i} | fila ${i} |` : i % 6 === 4 ? `> [!note] Nota ${i}\n> texto del callout ${i}` : `Párrafo ${i}: el electrocardiograma muestra ritmo sinusal, eje normal y ondas sin alteraciones en la derivación ${i % 12}.`)).join('\n\n') + '\n';
  await page.goto(URL_ + '#/mazos');
  await page.getByRole('button', { name: 'Importar archivo' }).click();
  await page.locator('.sheet input[type=file]').first().setInputFiles({ name: 'n.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync({ 'notes/Vidrio/Larga.md': strToU8(larga) }, { level: 0 })) });
  await page.locator('.sheet').getByRole('button', { name: 'Importar', exact: true }).click();
  await page.waitForTimeout(1000);
  for (let i = 0; i < 3 && (await page.locator('.scrim').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  await page.goto(URL_ + '#/notas/Vidrio/Larga.md');
  await page.locator('.doc').waitFor();
  await page.waitForTimeout(1200);
  R.notas = { glass: await glassCount(page), ...(await traced(page, () => fpsWhile(page, `let el = document.querySelector('.doc'); while (el && !(el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement; el = el || document.scrollingElement; el.scrollTop += (i % 120 < 60 ? 40 : -40);`))) };
  console.log('  ', JSON.stringify(R.notas));

  const label = process.env.PERF_LABEL || 'actual';
  writeFileSync(`${OUT}glass-perf-${label}.json`, JSON.stringify(R, null, 1));
  if (process.env.PERF_BASE && existsSync(process.env.PERF_BASE)) {
    const B = JSON.parse(readFileSync(process.env.PERF_BASE, 'utf8'));
    console.log('\nAntes → después:');
    for (const k of ['hoy', 'espacios', 'notas']) if (R[k] && B[k]) for (const m of Object.keys(R[k])) console.log(`  ${k}.${m}: ${B[k][m]} → ${R[k][m]}`);
  }
  await ctx.close();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
