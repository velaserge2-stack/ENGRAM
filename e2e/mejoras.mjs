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
  if (only.includes('notes')) {
    await page.goto(URL_ + '#/notas/Cardiología/ECG/Clase 1 - ECG básico.md');
    await page.locator('.doc').waitFor();
    if (await page.getByRole('button', { name: 'Ocultar explorador' }).count()) await page.getByRole('button', { name: 'Ocultar explorador' }).click();
    if (await page.getByRole('button', { name: 'Ocultar inspector' }).count()) await page.getByRole('button', { name: 'Ocultar inspector' }).click();
    await page.getByRole('button', { name: 'Completo' }).click();
    const [docW, mainW] = await page.evaluate(() => [document.querySelector('.doc-inner').getBoundingClientRect().width, document.querySelector('main').getBoundingClientRect().width]);
    check(docW > mainW - 90, `explorador e inspector ocultos: el texto usa todo el ancho (${Math.round(docW)} de ${Math.round(mainW)} px)`);
    // editar sin guardar y pasar a pantalla completa
    await page.locator('.doc [aria-label="Editar bloque"]').nth(1).click();
    const ta = page.locator('.doc textarea');
    await ta.fill('Texto sin guardar todavía');
    await ta.evaluate((el) => el.setSelectionRange(5, 5));
    await page.getByRole('button', { name: 'Pantalla completa de notas' }).click();
    await page.waitForTimeout(200);
    const st = await page.evaluate(() => ({ top: getComputedStyle(document.querySelector('.topbar')).display, focus: document.activeElement?.tagName, pos: document.activeElement?.selectionStart, val: document.activeElement?.value }));
    check(st.top === 'none' && st.focus === 'TEXTAREA' && st.pos === 5 && st.val === 'Texto sin guardar todavía', 'pantalla completa: oculta la barra y conserva cursor y texto');
    await page.screenshot({ path: OUT + 'mejora-notas-completa.png' });
    await page.getByRole('button', { name: 'Salir de pantalla completa' }).first().click();
    const back = await page.evaluate(() => ({ top: getComputedStyle(document.querySelector('.topbar')).display, focus: document.activeElement?.tagName, val: document.activeElement?.value }));
    check(back.top !== 'none' && back.focus === 'TEXTAREA' && back.val === 'Texto sin guardar todavía', 'al salir se conserva el cursor y el texto');
    await page.reload();
    await page.locator('.doc').waitFor();
    check(await page.getByRole('button', { name: 'Mostrar explorador' }).count() === 1, 'se recuerda el estado del explorador');
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.getByRole('button', { name: 'Mostrar inspector' }).click();
    check(await page.locator('.insp-over').count() === 1, 'en vertical, el inspector se superpone en lugar de apretar el editor');
    await page.screenshot({ path: OUT + 'mejora-notas-vertical.png' });
    await page.getByRole('button', { name: 'Cerrar inspector' }).click();
    await page.setViewportSize({ width: 1180, height: 820 });
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
