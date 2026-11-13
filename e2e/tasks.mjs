// Prompt 19 · 2: add-on «Tareas». Apagado = sin código cargado ni mosaico; encendido: agregar, tachar,
// editar con fecha, vencidas, reordenar (teclado y arrastre), borrar con deshacer, borrar completadas,
// filtro, minimizar/restaurar desde la bandeja con contador, y el .md en disco tras recargar.
//   npm run build && npm run e2e:tasks
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4192;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };

/** Lee un archivo de la bóveda desde la app (la vista de Notas en texto plano no hace falta). */
const readVault = (page, path) => page.evaluate(async (path) => {
  const root = await navigator.storage.getDirectory();
  const parts = path.split('/');
  let dir = root;
  try {
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
    return await (await (await dir.getFileHandle(parts.at(-1))).getFile()).text();
  } catch { return null; }
}, path);

try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, locale: 'es-MX' });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const js = new Set();
  page.on('request', (r) => r.url().endsWith('.js') && js.add(r.url()));
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.waitForTimeout(600);

  console.log('Apagado');
  check(!(await page.locator('section.tasks').count()), 'sin mosaico de Tareas');
  const before = new Set(js);
  // la vista previa sirve los fragmentos con hash: el de Tareas contiene «task-list»
  const tasksChunk = async () => { for (const u of js) { const t = await (await fetch(u)).text(); if (t.includes('task-list')) return u; } return null; };
  check(!(await tasksChunk()), 'el código de Tareas no se descargó');

  console.log('Encendido');
  await page.goto(URL_ + '#/ajustes');
  await page.locator('.settings').waitFor();
  if (await page.getByRole('button', { name: 'Desplegar todo' }).count()) await page.getByRole('button', { name: 'Desplegar todo' }).click();
  await page.getByRole('switch', { name: 'Tareas', exact: true }).click();
  await page.goto(URL_ + '#/hoy');
  const tile = page.locator('section.tasks');
  await tile.waitFor();
  check([...js].some((u) => !before.has(u)), 'al activarlo se carga un fragmento propio');
  check((await readVault(page, 'notes/Tareas.md')) === null, 'activar no escribe nada (sin archivo hasta editar)');

  const add = async (text, date) => {
    await tile.getByLabel('Añadir tarea…').fill(text);
    if (date) await tile.locator('.task-add input[type=date]').fill(date);
    await tile.getByLabel('Añadir tarea…').press('Enter');
    await page.waitForTimeout(120);
  };
  await add('Leer capítulo 3');
  await add('Repasar ECG', '2020-01-02'); // vencida
  await add('Pedir libro');
  check((await tile.locator('.task').count()) === 3, 'agregar con Intro: 3 tareas');
  check(/1 pendiente|3 pendientes/.test(await tile.locator('h2').textContent()), `contador: «${(await tile.locator('h2').textContent()).trim()}»`);
  check((await tile.locator('.task .due.late').textContent()).includes('Vencida'), 'vencida marcada con texto e icono (no solo color)');

  console.log('Tachar');
  await tile.getByRole('checkbox', { name: 'Leer capítulo 3' }).check();
  await page.waitForTimeout(150);
  const done = tile.locator('.task.done');
  check((await done.count()) === 1 && (await done.locator('.tx').textContent()) === 'Leer capítulo 3', 'tachada (clase done) y baja a «hechas»');
  const deco = await done.locator('.tx').evaluate((e) => getComputedStyle(e).textDecorationLine);
  check(deco.includes('line-through'), `texto tachado (${deco})`);
  check((await tile.locator('.task').last().locator('.tx').textContent()) === 'Leer capítulo 3', 'las hechas se muestran al final');

  console.log('Teclado');
  const cb = tile.getByRole('checkbox', { name: 'Pedir libro' });
  await cb.focus();
  await page.keyboard.press('Alt+ArrowUp');
  await page.waitForTimeout(200);
  let file = await readVault(page, 'notes/Tareas.md');
  await page.waitForTimeout(1500); // autoguardado
  file = await readVault(page, 'notes/Tareas.md');
  const order = (f) => [...f.matchAll(/- \[[ x]\] ([^📅\n]+)/g)].map((m) => m[1].trim());
  check(JSON.stringify(order(file)) === JSON.stringify(['Leer capítulo 3', 'Pedir libro', 'Repasar ECG']), `Alt+↑ reordena en el archivo (${order(file).join(' · ')})`);
  check(await page.evaluate(() => document.activeElement?.closest('.task')?.textContent?.includes('Pedir libro')), 'el foco sigue a la tarea');
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  check((await tile.locator('.task.done').count()) === 2, 'Espacio marca');
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);

  console.log('Arrastrar');
  const grip = (name) => tile.locator('.task', { hasText: name }).locator('.grip');
  const a = await grip('Repasar ECG').boundingBox(), b = await grip('Pedir libro').boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(1500);
  file = await readVault(page, 'notes/Tareas.md');
  check(JSON.stringify(order(file)) === JSON.stringify(['Leer capítulo 3', 'Repasar ECG', 'Pedir libro']), `arrastre con el asa reordena (${order(file).join(' · ')})`);

  if (process.env.DEBUG) console.log(JSON.stringify(file), await tile.locator('.task').evaluateAll((e) => e.map((x) => x.dataset.i + ':' + x.textContent)));
  console.log('Editar');
  await tile.getByRole('button', { name: 'Editar «Pedir libro»' }).click();
  await tile.getByLabel('Texto de la tarea').fill('Pedir libro de Guyton');
  await tile.locator('.task.editing input[type=date]').fill('2099-05-01');
  await tile.getByRole('button', { name: 'Guardar' }).click();
  await page.waitForTimeout(1500);
  file = await readVault(page, 'notes/Tareas.md');
  check(file.includes('- [ ] Pedir libro de Guyton 📅 2099-05-01'), 'editar texto y fecha queda en el .md');

  if (process.env.DEBUG) console.log(JSON.stringify(file));
  console.log('Subtarea');
  await tile.getByRole('button', { name: 'Convertir en subtarea' }).last().click();
  await page.waitForTimeout(1500);
  file = await readVault(page, 'notes/Tareas.md');
  check(/\n {2}- \[ \] Pedir libro de Guyton/.test(file), 'sangría de un nivel en el archivo');

  console.log('Borrar con deshacer');
  await tile.getByRole('button', { name: 'Borrar «Repasar ECG»' }).click();
  await page.waitForTimeout(150);
  check(!(await tile.locator('.task', { hasText: 'Repasar ECG' }).count()), 'borrada (con sus subtareas)');
  await page.locator('.toast').getByRole('button', { name: 'Deshacer' }).click();
  await page.waitForTimeout(200);
  check((await tile.locator('.task', { hasText: 'Repasar ECG' }).count()) === 1 && (await tile.locator('.task', { hasText: 'Guyton' }).count()) === 1, 'Deshacer la devuelve');

  console.log('Filtro');
  await tile.getByRole('group', { name: 'Filtro' }).getByRole('button', { name: 'Hechas' }).click();
  check((await tile.locator('.task').count()) === 1, 'Hechas: 1');
  await tile.getByRole('group', { name: 'Filtro' }).getByRole('button', { name: 'Pendientes' }).click();
  check((await tile.locator('.task.done').count()) === 0, 'Pendientes: ninguna hecha');
  await tile.getByRole('group', { name: 'Filtro' }).getByRole('button', { name: 'Todas' }).click();

  console.log('Bandeja');
  await page.locator('.mh:has(section.tasks) .min-btn, .mh:has(section.tasks) > button').first().click();
  await page.waitForTimeout(500);
  const sq = page.locator('.tray .tray-sq[aria-label^="Tareas"]');
  check((await sq.count()) === 1 && (await sq.locator('.tray-live').textContent()) === '2', `minimizado: en la bandeja con contador (${await sq.locator('.tray-live').textContent().catch(() => '?')})`);
  await sq.click();
  await page.waitForTimeout(400);
  check((await tile.count()) === 1, 'restaurar desde la bandeja');

  console.log('Borrar completadas y recargar');
  await tile.getByRole('button', { name: 'Borrar completadas' }).click();
  await page.waitForTimeout(1500);
  await page.reload();
  await tile.waitFor();
  await page.waitForTimeout(500);
  file = await readVault(page, 'notes/Tareas.md');
  check(!file.includes('[x]') && order(file).length === 2, `tras recargar: sin hechas en el .md (${JSON.stringify(file)})`);
  check((await tile.locator('.task').count()) === 2, 'y la lista se reconstruye del archivo');
  await tile.screenshot({ path: OUT + 'tareas.png' });

  console.log('Teléfono');
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-MX', hasTouch: true });
  await ctx.close();
  const pp = await ph.newPage();
  pp.on('dialog', (d) => d.accept());
  await pp.goto(URL_);
  await pp.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await pp.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await pp.goto(URL_ + '#/ajustes');
  await pp.locator('.settings').waitFor();
  if (await pp.getByRole('button', { name: 'Desplegar todo' }).count()) await pp.getByRole('button', { name: 'Desplegar todo' }).click();
  await pp.getByRole('switch', { name: 'Tareas', exact: true }).click();
  await pp.goto(URL_ + '#/hoy');
  const t2 = pp.locator('section.tasks');
  await t2.waitFor();
  await t2.getByLabel('Añadir tarea…').fill('Una tarea con un texto bastante largo para ver cómo se acomoda en el teléfono');
  await t2.getByLabel('Añadir tarea…').press('Enter');
  await pp.waitForTimeout(300);
  const over = await pp.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const small = await t2.locator('.task button, .task input, .task-add button, .task-add input').evaluateAll((els) => els.map((e) => (e.type === 'checkbox' ? e.closest('label') : e)).filter((e) => e.getBoundingClientRect().height && e.getBoundingClientRect().height < 43.5).map((e) => e.tagName + '.' + e.className + ':' + Math.round(e.getBoundingClientRect().height)));
  check(over <= 0 && small.length === 0, `teléfono: sin desbordamiento (${over}) y objetivos ≥ 44 px (${small.length} pequeños ${small.join(" ")})`);
  await t2.screenshot({ path: OUT + 'tareas-telefono.png' });
  await ph.close();
} catch (e) {
  failed++;
  console.error(e);
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} FALLO(S)` : '\nOK');
process.exit(failed ? 1 : 0);
