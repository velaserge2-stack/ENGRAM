// Borrar bancos de preguntas: papelera con confirmación, deshacer, restaurar, eliminar
// definitivamente; los intentos y el simulacro en curso siguen funcionando.
//   npm run build && npm run e2e:bancos      (BROWSER=webkit|chromium)
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { strToU8, zipSync } from 'fflate';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const PORT = Number(process.env.PORT) || 4178;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let kind = process.env.BROWSER || 'webkit';
let browser;
try { browser = await pw[kind].launch(); } catch { kind = 'chromium'; browser = await pw.chromium.launch(); }
console.log('Navegador:', kind);
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };

const A = 'Cardiología, parcial 1';
const B = 'Neumología: un banco con un nombre larguísimo para comprobar que la fila nunca se desborda del panel';
const now = Date.now();
const q = { id: 'q1', n: 1, case: '', text: '¿Qué arteria se ocluye?', options: [{ key: 'A', text: 'Derecha' }, { key: 'B', text: 'Izquierda' }], answer: ['A'], explanation: '', topic: 'Cardio', problems: [] };
const att = (id, extra) => ({ id, title: A, banks: ['exams-bank/cardio.md'], mode: 'sim', qs: [{ bank: 'exams-bank/cardio.md', q, order: ['A', 'B'] }], answers: {}, checked: [], marked: [], startedAt: now - 600_000, endAt: null, perQ: {}, cur: 0, penalty: 0, pass: 0.6, ...extra });
const zip = zipSync({
  'exams-bank/cardio.md': strToU8(readFileSync(new URL('../examples/simulacros/cardio-parcial.md', import.meta.url), 'utf8')),
  'exams-bank/neumo.md': strToU8(`---\nexamen: ${B}\n---\n1. ¿Qué mide la espirometría?\n   A) Flujos y volúmenes *\n   B) Saturación\n`),
  '.app/exam-attempts.jsonl': strToU8(JSON.stringify(att('old1', { answers: { q1: ['A'] }, finishedAt: now - 300_000, elapsedMs: 300_000 })) + '\n'),
  '.app/exam-current.json': strToU8(JSON.stringify(att('cur1', {}))),
}, { level: 0 });

try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'es-MX' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.goto(URL_ + '#/mazos');
  await page.getByRole('button', { name: 'Importar archivo' }).click();
  await page.locator('.sheet input[type=file]').first().setInputFiles({ name: 'bancos.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await page.locator('.sheet').getByRole('button', { name: 'Importar', exact: true }).click();
  await page.waitForTimeout(1000);
  for (let i = 0; i < 3 && (await page.locator('.scrim').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }

  const banks = page.locator('section', { has: page.getByRole('heading', { name: 'Bancos', exact: true }) }).locator('.bank-row');
  const names = async () => (await banks.locator('.k').allTextContents()).map((s) => s.trim()).sort();
  const sheet = page.locator('.sheet');
  const trashBtn = page.getByRole('button', { name: /^Papelera de bancos/ });
  await page.goto(URL_ + '#/simulacros');
  await banks.first().waitFor();

  check((await banks.count()) === 2, 'se listan los 2 bancos');
  const del = page.getByRole('button', { name: `Borrar banco ${A}` });
  check((await del.count()) === 1 && (await page.getByRole('button', { name: `Borrar banco ${B}` }).count()) === 1, 'cada banco tiene «Borrar banco {nombre}» (aria-label)');
  const bx = await del.boundingBox();
  const px = await page.getByRole('link', { name: /Editar/ }).first().boundingBox();
  check(bx.width >= 44 && bx.height >= 44 && Math.abs(bx.y - px.y) < 2 && px.width === bx.width, `papelera ≥ 44 px junto al lápiz, mismo tamaño (${bx.width}×${bx.height})`);
  check(await page.evaluate(() => [...document.querySelectorAll('.bank-row')].every((r) => r.scrollWidth <= r.clientWidth + 1)), 'nombre largo: la fila no se desborda');
  check(!(await trashBtn.count()), 'sin papelera de bancos mientras está vacía');

  // confirmación; cancelar no borra
  await del.click();
  await sheet.waitFor();
  const txt = await sheet.textContent();
  check(/Tiene \d+ preguntas\. Irá a la papelera y podrás restaurarlo\./.test(txt) && txt.includes(A), 'la confirmación dice el nombre, cuántas preguntas y que va a la papelera');
  check(/1 intento hecho usó este banco\. No se borra/.test(txt), 'avisa que el intento que lo usó no se borra');
  await sheet.getByRole('button', { name: 'Cancelar' }).click();
  await page.waitForTimeout(300);
  check((await banks.count()) === 2, 'cancelar no borra');

  // teclado: foco + Enter, confirmar; deshacer
  await del.focus();
  await page.keyboard.press('Enter');
  await sheet.getByRole('button', { name: 'Mover a la papelera' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.bank-row').length === 1);
  check((await names()).join() === B, 'el banco borrado desaparece');
  await page.getByRole('button', { name: 'Deshacer' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.bank-row').length === 2);
  check((await names()).join('|') === [A, B].sort().join('|') && !(await trashBtn.count()), 'deshacer lo devuelve y la papelera queda vacía');

  // borrar y restaurar desde la papelera
  await del.click();
  await sheet.getByRole('button', { name: 'Mover a la papelera' }).click();
  await trashBtn.waitFor();
  check((await trashBtn.textContent()).includes('(1)') && (await trashBtn.getAttribute('aria-expanded')) === 'false', 'la papelera aparece plegada con 1 banco');
  await trashBtn.click();
  await page.getByRole('button', { name: 'Restaurar' }).click();
  await trashBtn.waitFor({ state: 'detached' });
  check((await names()).join('|') === [A, B].sort().join('|'), 'restaurar desde la papelera lo devuelve');

  // con el banco en la papelera: el intento viejo y el simulacro en curso siguen
  await del.click();
  await sheet.getByRole('button', { name: 'Mover a la papelera' }).click();
  await trashBtn.waitFor();
  await page.goto(URL_ + '#/simulacros/resultado/old1');
  await page.getByText('Borrar este intento').waitFor();
  check(!(await page.getByText('No se encontró el intento').count()), 'el intento viejo sigue abriéndose');
  await page.goto(URL_ + '#/simulacros/hacer');
  await page.getByText('¿Qué arteria se ocluye?').first().waitFor({ timeout: 5000 }).then(() => check(true, 'el simulacro en curso continúa'), () => check(false, 'el simulacro en curso continúa'));

  // recarga y persistencia
  await page.reload();
  await page.goto(URL_ + '#/simulacros');
  await banks.first().waitFor();
  check((await names()).join() === B && (await trashBtn.textContent()).includes('(1)'), 'tras recargar: sigue en la papelera');

  // eliminar definitivamente (con confirmación)
  await trashBtn.click();
  await page.locator('.bank-trash').getByRole('button', { name: 'Eliminar definitivamente' }).click();
  await sheet.waitFor();
  check((await sheet.textContent()).includes('No se puede deshacer'), 'eliminar definitivamente pide confirmación');
  await sheet.getByRole('button', { name: 'Eliminar definitivamente' }).click();
  await page.waitForTimeout(400);
  check(!(await trashBtn.count()), 'eliminado: la papelera desaparece');

  // 0 bancos: estado vacío
  await page.getByRole('button', { name: `Borrar banco ${B}` }).click();
  await sheet.getByRole('button', { name: 'Mover a la papelera' }).click();
  await page.getByText('Sin bancos de preguntas').waitFor();
  check(true, 'sin bancos: estado vacío');
  check(!errors.length, `sin errores en la página${errors.length ? ': ' + errors.join('; ') : ''}`);

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
