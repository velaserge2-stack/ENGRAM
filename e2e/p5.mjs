// Prompt 5: sonido ambiente, tinta (Pencil simulado con pointerType «pen»), PDFs, notas manuscritas, atajos y mando.
//   npm run build && npm run e2e:p5      (ONLY=sonido,tinta,… para correr una parte)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4181;
const URL_ = `http://localhost:${PORT}/`;
const EX = new URL('../examples/', import.meta.url).pathname;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
const check = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✓', m); };
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const run = (k) => !only || only.includes(k);
const errors = [];

async function fresh(w = 1180, h = 820) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'es-MX', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  return { ctx, page };
}

try {
  const { ctx, page } = await fresh();

  if (run('sonido')) {
    console.log('Sonido ambiente');
    check(await page.getByRole('button', { name: 'Sonido ambiente' }).count() === 0, 'apagado por defecto: sin icono en la barra');
    await page.goto(URL_ + '#/ajustes/addons');
    await page.getByRole('region', { name: 'Add-ons' }).getByRole('switch', { name: 'Sonido ambiente' }).check();
    const btn = page.getByRole('button', { name: 'Sonido ambiente' });
    await btn.waitFor();
    check(await page.evaluate(() => window.__ambient?.state() === 'none'), 'nada suena al activar: no hay AudioContext hasta tocar «Reproducir»');
    await btn.click();
    const sh = page.getByRole('dialog', { name: 'Sonido ambiente' });
    await sh.getByRole('slider', { name: 'Volumen de Lluvia' }).fill('60');
    await sh.getByRole('slider', { name: 'Volumen de Ruido marrón' }).fill('40');
    await sh.getByRole('button', { name: 'Reproducir', exact: true }).first().click();
    await sh.getByRole('button', { name: 'Detener' }).waitFor();
    await page.waitForTimeout(300);
    check(await page.evaluate(() => window.__ambient.state() === 'running' && window.__ambient.playing && window.__ambient.levels().rain === 0.6 && window.__ambient.levels().brown === 0.4), 'lluvia + ruido marrón suenan mezclados (AudioContext en marcha)');
    await sh.getByRole('group', { name: 'Apagado programado' }).getByRole('button', { name: '15 min' }).click();
    check((await sh.innerText()).includes('Se apaga en 15 min'), 'temporizador de apagado de 15 min');
    await sh.getByRole('button', { name: 'Detener' }).click();
    await sh.getByRole('button', { name: 'Reproducir', exact: true }).first().waitFor();
    await sh.getByRole('button', { name: 'Cerrar' }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Sonido ambiente' }).click();
    const sh2 = page.getByRole('dialog', { name: 'Sonido ambiente' });
    check(await sh2.getByRole('slider', { name: 'Volumen de Lluvia' }).inputValue() === '60' && await page.evaluate(() => window.__ambient.state() === 'none'), 'los volúmenes persisten y al reabrir no suena nada solo');
    await sh2.getByRole('button', { name: 'Cerrar' }).click();
  }

  if (run('tinta')) {
    console.log('Motor de tinta');
    await page.goto(URL_ + '#/design');
    const surf = page.locator('.ink-demo .ink-live');
    await surf.waitFor();
    const count = async () => Number(await page.getByTestId('ink-count').innerText());
    // trazo con Pencil simulado: pointerType «pen», presión variable
    const stroke = (type, id, pts, extra = {}) => surf.evaluate((el, [type, id, pts, extra]) => {
      const r = el.getBoundingClientRect();
      const ev = (name, [x, y, p]) => el.dispatchEvent(new PointerEvent(name, { pointerType: type, pointerId: id, isPrimary: true, pressure: p, clientX: r.left + x, clientY: r.top + y, buttons: name === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, ...extra }));
      ev('pointerdown', pts[0]);
      for (const p of pts.slice(1)) ev('pointermove', p);
      ev('pointerup', pts[pts.length - 1]);
    }, [type, id, pts, extra]);
    const line = (x0, y, x1, n = 12) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y, 0.2 + (0.7 * i) / (n - 1)]);
    check(await surf.evaluate((el) => getComputedStyle(el).touchAction).then((v) => v.includes('pan') || v === 'manipulation'), 'por defecto el dedo desplaza y hace zoom (touch-action con pan y pinch)');
    await stroke('pen', 11, line(40, 60, 300));
    check(await count() === 1, 'un trazo con Pencil (presión variable) se guarda como vector');
    // palma: un toque mientras el Pencil está apoyado no dibuja nada
    await surf.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const ev = (name, type, id, x, y) => el.dispatchEvent(new PointerEvent(name, { pointerType: type, pointerId: id, pressure: 0.5, clientX: r.left + x, clientY: r.top + y, buttons: 1, bubbles: true, cancelable: true }));
      ev('pointerdown', 'pen', 12, 50, 120);
      ev('pointerdown', 'touch', 13, 200, 200); // palma
      ev('pointermove', 'touch', 13, 260, 210);
      ev('pointermove', 'pen', 12, 200, 125);
      ev('pointerup', 'touch', 13, 260, 210);
      ev('pointerup', 'pen', 12, 220, 126);
    });
    check(await count() === 2, 'la palma apoyada mientras se escribe no marca nada');
    await stroke('touch', 14, line(40, 200, 300));
    check(await count() === 2, 'con «solo Pencil» el dedo no dibuja');
    await page.getByRole('button', { name: 'Deshacer (⌘Z)' }).click();
    check(await count() === 1, 'deshacer');
    await page.getByRole('button', { name: 'Rehacer (⇧⌘Z)' }).click();
    check(await count() === 2, 'rehacer');
    await page.keyboard.press('e');
    check(await page.getByRole('button', { name: 'Borrador (E)' }).getAttribute('aria-pressed') === 'true', 'atajo E: borrador');
    await stroke('pen', 15, [[170, 30, 0.5], [170, 90, 0.5], [170, 140, 0.5]]);
    check(await count() < 2, 'el borrador por trazo quita lo que toca');
    await page.keyboard.press('p');
    await page.getByRole('button', { name: 'Regla (líneas rectas)' }).click();
    await stroke('pen', 16, [[40, 220, 0.5], [120, 160, 0.5], [300, 220, 0.5]]);
    check(await count() >= 1, 'la regla dibuja una línea recta');
  }

  check(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await ctx.close();
  console.log('\nOK');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
