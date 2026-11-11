// Flujos de "Mejoras 1": vínculos del calendario, notas grandes, paneles minimizables y logo.
//   npm run build && npm run e2e:mejoras
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = 4177;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
const errors = [];
const check = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✓', m); };
const only = (process.env.ONLY || 'links,notes,tray,logo').split(',');
try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();

  if (only.includes('links')) {
    // segunda nota para vincular
    await page.goto(URL_ + '#/notas/+nueva');
    const sh = page.locator('.sheet');
    await sh.getByLabel('Materia').fill('Cardiología');
    await sh.getByLabel('Tema o clase').fill('ECG');
    await sh.getByLabel('Título').fill('Ejes');
    await page.getByRole('button', { name: 'Crear' }).click();
    await page.locator('.doc').waitFor();

    await page.goto(URL_ + '#/calendario');
    await page.getByRole('button', { name: 'Bloque' }).click();
    await page.getByLabel('Título').fill('Repaso ECG');
    for (const [tab, name] of [['Mazos y temas', 'Cardiología'], ['Notas', 'Clase 1 - ECG básico'], ['Notas', 'Ejes']]) {
      await page.getByRole('button', { name: 'Vincular' }).click();
      await page.getByRole('button', { name: tab, exact: true }).click();
      await page.locator('.sheet .opt').filter({ hasText: name }).first().click();
      await page.waitForTimeout(300);
    }
    check((await page.locator('.sheet [role=listitem]').count()) === 3, 'un mazo y dos notas vinculados (chips)');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await page.getByRole('button', { name: /Abrir Cardiología, \d+ vencidas/ }).waitFor();
    check(true, 'el día muestra datos vivos del mazo vinculado');
    // renombrar la nota con id no rompe el vínculo
    await page.goto(URL_ + '#/notas/Cardiología/ECG/Ejes.md');
    await page.getByRole('button', { name: 'Mover a otra materia o tema' }).click();
    await page.locator('.sheet').getByLabel('Título').fill('Ejes eléctricos');
    await page.getByRole('button', { name: 'Mover', exact: true }).click();
    await page.getByRole('tab', { name: 'Eventos' }).click();
    await page.locator('.insp').getByText('Repaso ECG').first().waitFor();
    check(true, 'la nota renombrada muestra el evento en su inspector');
    await page.goto(URL_ + '#/calendario');
    await page.getByRole('button', { name: 'Abrir Ejes eléctricos' }).waitFor();
    check((await page.getByText('enlace roto').count()) === 0, 'renombrar la nota (con id) no rompe el vínculo');
    await page.getByRole('button', { name: 'Iniciar bloque' }).first().click();
    await page.locator('.win').nth(2).waitFor();
    const titles = await page.locator('.win-bar .t').allTextContents();
    check(titles.length === 3 && titles.some((t) => t.includes('Clase 1')) && titles.some((t) => t.includes('Ejes')), `«Iniciar bloque» abre estudio filtrado y las dos notas (${titles.join(' · ')})`);
    check(/Cardiología/.test(await page.locator('.win').first().textContent()), 'la sesión de estudio está filtrada al mazo vinculado');
    await page.screenshot({ path: OUT + 'mejora-bloque.png' });
  }
  check(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log('\nOK');
} catch (e) {
  console.error('Errores de consola:', errors);
  for (const c of browser.contexts()) for (const [i, pg] of c.pages().entries()) await pg.screenshot({ path: OUT + `mejora-fallo-${i}.png` }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  server.kill();
}
