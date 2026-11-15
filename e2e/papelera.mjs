// Papelera de notas: enviar una nota, verla en la papelera y eliminarla definitivamente (con confirmación).
//   npm run build && npm run e2e:papelera      (BROWSER=webkit|chromium)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const PORT = Number(process.env.PORT) || 4181;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let kind = process.env.BROWSER || 'webkit';
let browser;
try { browser = await pw[kind].launch(); } catch { kind = 'chromium'; browser = await pw.chromium.launch(); }
console.log('Navegador:', kind);
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };

try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'es-MX' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); void d.accept(); });
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.goto(URL_ + '#/notas');
  const link = page.locator('a[href^="#/notas/"]').first();
  await link.waitFor();
  const name = (await link.textContent()).trim();
  await link.click();
  await page.getByRole('button', { name: 'Enviar a la papelera' }).click();
  await page.waitForURL(/#\/notas$/);

  const openTrash = async () => { await page.getByRole('button', { name: 'Papelera', exact: true }).click(); await page.locator('.sheet').waitFor(); };
  await openTrash();
  const sheet = page.locator('.sheet');
  const row = sheet.locator('.row-i');
  await row.first().waitFor();
  check((await row.count()) === 1 && (await row.first().textContent()).includes(name), 'la nota borrada aparece en la papelera');
  const del = row.first().getByRole('button', { name: 'Eliminar definitivamente' });
  check((await del.count()) === 1, 'cada nota de la papelera tiene «Eliminar definitivamente»');
  const box = await del.boundingBox();
  check(box && box.height >= 44, `el botón mide al menos 44 px (${box?.height} px de alto)`);
  await del.click();
  await sheet.getByText('Vacía.').waitFor();
  check(dialogs.some((m) => m.includes(name) && m.includes('No se puede deshacer')), 'pide confirmación con el nombre de la nota');
  check(!(await row.count()), 'tras eliminar, la papelera queda vacía');

  await page.reload();
  await page.goto(URL_ + '#/notas');
  await openTrash();
  await page.locator('.sheet').getByText('Vacía.').waitFor();
  check(true, 'tras recargar, sigue vacía (se borró del disco)');
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
