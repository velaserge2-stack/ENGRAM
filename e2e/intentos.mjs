// Borrar un intento de simulacro: desde la lista y desde Resultados, con confirmación, deshacer,
// persistencia al recargar y el calendario del día al tanto.
//   npm run build && npm run e2e:intentos      (BROWSER=webkit|chromium)
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { strToU8, zipSync } from 'fflate';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const PORT = Number(process.env.PORT) || 4177;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let kind = process.env.BROWSER || 'webkit';
let browser;
try { browser = await pw[kind].launch(); } catch { kind = 'chromium'; browser = await pw.chromium.launch(); }
console.log('Navegador:', kind);
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };

// tres intentos terminados hoy, cada uno con una pregunta
const now = Date.now();
const q = { id: 'q1', n: 1, case: '', text: '¿Qué arteria?', options: [{ key: 'A', text: 'Derecha' }, { key: 'B', text: 'Izquierda' }], answer: ['A'], explanation: '', topic: 'Cardio', problems: [] };
const mk = (id, title, i) => ({ id, title, banks: ['exams-bank/cardio.md'], mode: 'sim', qs: [{ bank: 'exams-bank/cardio.md', q, order: 0 }], answers: { q1: ['A'] }, checked: [], marked: [], startedAt: now - (3 - i) * 600_000, endAt: null, finishedAt: now - (3 - i) * 600_000 + 300_000, elapsedMs: 300_000, perQ: {}, cur: 0, penalty: 0, pass: 60 });
const atts = [mk('aaa1', 'Intento Uno', 0), mk('bbb2', 'Intento Dos', 1), mk('ccc3', 'Intento Tres', 2)];
const zip = zipSync({
  'exams-bank/cardio.md': strToU8(readFileSync(new URL('../examples/simulacros/cardio-parcial.md', import.meta.url), 'utf8')),
  '.app/exam-attempts.jsonl': strToU8(atts.map((a) => JSON.stringify(a)).join('\n') + '\n'),
}, { level: 0 });

try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'es-MX' });
  const page = await ctx.newPage();
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.goto(URL_ + '#/mazos');
  await page.getByRole('button', { name: 'Importar archivo' }).click();
  await page.locator('.sheet input[type=file]').first().setInputFiles({ name: 'intentos.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await page.locator('.sheet').getByRole('button', { name: 'Importar', exact: true }).click();
  await page.waitForTimeout(1000);
  for (let i = 0; i < 3 && (await page.locator('.scrim').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }

  const rows = page.locator('.attempt-row');
  const titles = async () => (await rows.locator('.k').allTextContents()).map((s) => s.split(' · ')[0].trim());
  const sims = async () => {
    await page.goto(URL_ + '#/calendario');
    // el calendario coloca cada intento en el día local del navegador
    const day = await page.evaluate((ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }, atts[0].startedAt);
    const cell = page.locator(`.day[data-day="${day}"]`).first();
    await cell.waitFor();
    await page.waitForTimeout(300);
    return cell.locator('.ev', { hasText: 'Simulacro' }).count();
  };
  const home = async () => { await page.goto(URL_ + '#/simulacros'); await rows.first().waitFor(); };

  check((await sims()) === 3, 'el calendario del día muestra 3 simulacros');
  await home();
  check((await titles()).join() === 'Intento Tres,Intento Dos,Intento Uno', 'la lista muestra los 3 intentos');
  const btns = rows.getByRole('button', { name: 'Borrar intento' });
  check((await btns.count()) === 3, 'cada fila tiene «Borrar intento» con aria-label');
  const box = await btns.first().boundingBox();
  check(box && box.width >= 44 && box.height >= 44, `botón ≥ 44 px (${box?.width}×${box?.height})`);
  check((await rows.locator('a button').count()) === 0, 'el botón no está dentro del enlace');

  // cancelar no borra
  await rows.nth(1).getByRole('button', { name: 'Borrar intento' }).click();
  const sheet = page.locator('.sheet');
  await sheet.waitFor();
  check(/Se quitará del historial/.test(await sheet.textContent()), 'pide confirmación');
  await sheet.getByRole('button', { name: 'Cancelar' }).click();
  await page.waitForTimeout(300);
  check((await rows.count()) === 3, 'cancelar no borra');

  // borrar el del medio con teclado: foco en el botón, Enter, confirmar
  await rows.nth(1).getByRole('button', { name: 'Borrar intento' }).focus();
  await page.keyboard.press('Enter');
  await sheet.getByRole('button', { name: 'Borrar', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.attempt-row').length === 2);
  check((await titles()).join() === 'Intento Tres,Intento Uno', 'se borra solo el del medio');

  // deshacer lo devuelve a su sitio
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.attempt-row').length === 3);
  check((await titles()).join() === 'Intento Tres,Intento Dos,Intento Uno', 'deshacer restaura el intento en su posición');

  // borrar otra vez el del medio (sin deshacer)
  await rows.nth(1).getByRole('button', { name: 'Borrar intento' }).click();
  await sheet.getByRole('button', { name: 'Borrar', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.attempt-row').length === 2);

  // desde Resultados
  await page.goto(URL_ + '#/simulacros/resultado/ccc3');
  await page.getByRole('button', { name: 'Borrar este intento' }).click();
  await sheet.getByRole('button', { name: 'Borrar', exact: true }).click();
  await page.waitForFunction(() => location.hash === '#/simulacros' || location.hash === '#/simulacros/');
  await rows.first().waitFor();
  check((await titles()).join() === 'Intento Uno', 'desde Resultados: se borra y vuelve a Simulacros');

  check((await sims()) === 1, 'el calendario del día baja a 1 simulacro');

  // persistencia
  await page.reload();
  await home();
  check((await titles()).join() === 'Intento Uno', 'tras recargar sigue borrado');

  if (failed) throw new Error(`${failed} comprobaciones fallaron`);
  console.log('OK');
  await ctx.close();
} catch (e) {
  console.error(e.message ?? e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
