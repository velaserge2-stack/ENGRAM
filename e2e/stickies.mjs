// Prompt 19 · 3: add-on «Sticky notes». Apagado = sin código ni mosaico; encendido: crear, editar
// (Markdown seguro), color con contraste, mover, fijar, archivar, eliminar con deshacer, convertir en
// nota, abrir en Notas, minimizar/restaurar y el .md en disco tras recargar.
//   npm run build && npm run e2e:stickies
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4194;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };

/** Lista y lee archivos de la bóveda (OPFS) desde la página. */
const vaultFiles = (page, dir) => page.evaluate(async (dir) => {
  let d = await navigator.storage.getDirectory();
  try { for (const p of dir.split('/')) d = await d.getDirectoryHandle(p); } catch { return {}; }
  const out = {};
  for await (const [name, h] of d.entries()) if (h.kind === 'file') out[name] = await (await h.getFile()).text();
  return out;
}, dir);
const contrast = (page, sel) => page.locator(sel).first().evaluate((el) => {
  const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number);
  const L = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const fg = L(rgb(getComputedStyle(el.querySelector('p, li, strong') ?? el).color)), bg = L(rgb(getComputedStyle(el).backgroundColor));
  return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
});

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
  check(!(await page.locator('section.stickies').count()), 'sin mosaico');
  let found = false;
  for (const u of js) if ((await (await fetch(u)).text()).includes('sticky-grid')) found = true;
  check(!found, 'el código de Sticky notes no se descargó');

  console.log('Encendido');
  await page.goto(URL_ + '#/ajustes');
  await page.locator('.settings').waitFor();
  if (await page.getByRole('button', { name: 'Desplegar todo' }).count()) await page.getByRole('button', { name: 'Desplegar todo' }).click();
  await page.getByRole('switch', { name: 'Sticky notes', exact: true }).click();
  await page.goto(URL_ + '#/hoy');
  const tile = page.locator('section.stickies');
  await tile.waitFor();
  check(Object.keys(await vaultFiles(page, 'notes/Stickies')).length === 0, 'activar no escribe nada');

  const write = async (text) => {
    await tile.getByRole('button', { name: 'Nueva sticky' }).click();
    const ta = tile.getByLabel('Texto de la sticky (Markdown)');
    await ta.waitFor();
    await ta.fill(text);
    await ta.press('Escape');
    await page.waitForTimeout(150);
  };
  await write('**Llamar** al tutor\n- [ ] confirmar hora');
  await write('Segunda sticky');
  await write('Tercera <img src=x onerror="window.__xss=1">');
  check((await tile.locator('.sticky').count()) === 3, 'crear 3 stickies (la nueva arriba)');
  check((await tile.locator('.sticky').first().textContent()).includes('Tercera'), 'la más nueva queda primero');
  check((await tile.locator('.sticky strong').first().textContent()) === 'Llamar' && (await tile.locator('.sticky input[type=checkbox]').count()) === 1, 'Markdown: negrita y casilla de tarea');
  check(!(await page.evaluate(() => window.__xss)) && !(await tile.locator('.sticky img').count()), 'saneado: el HTML del usuario no se ejecuta');
  await page.waitForTimeout(1500);
  let files = await vaultFiles(page, 'notes/Stickies');
  check(Object.keys(files).length === 3 && Object.values(files).every((f) => f.startsWith('---\nsticky: true\norden: ')), `3 archivos .md con frontmatter (${Object.keys(files).join(', ')})`);

  console.log('Editar en el sitio');
  await tile.locator('.sticky', { hasText: 'Segunda' }).locator('.sticky-view').click();
  await tile.getByLabel('Texto de la sticky (Markdown)').fill('Segunda, editada');
  await tile.getByLabel('Texto de la sticky (Markdown)').press('Escape');
  await page.waitForTimeout(1500);
  files = await vaultFiles(page, 'notes/Stickies');
  check(Object.values(files).some((f) => f.endsWith('\nSegunda, editada\n')), 'la edición queda en su .md');

  console.log('Color');
  const more = (name) => tile.locator('.sticky', { hasText: name }).getByRole('button', { name: 'Más acciones' });
  await more('Llamar').click();
  await page.locator('.popover').getByRole('radio', { name: 'Amarillo' }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const paper = tile.locator('.sticky', { hasText: 'Llamar' }).locator('.sticky-paper');
  check((await paper.getAttribute('data-color')) === 'amarillo' && (await paper.getAttribute('data-user-content')) !== null, 'color elegido por sticky, marcado como contenido del usuario');
  const c = await contrast(page, '.sticky-paper[data-color="amarillo"]');
  check(c >= 4.5, `texto sobre el color: ${c.toFixed(1)}:1 (≥ 4.5)`);

  console.log('Fijar y mover');
  await more('Segunda').click();
  await page.locator('.popover').getByRole('menuitem', { name: 'Fijar arriba' }).click();
  await page.waitForTimeout(200);
  check((await tile.locator('.sticky').first().textContent()).includes('Segunda'), 'fijada: sube al principio');
  // arrastrar «Llamar» (3.ª) sobre «Tercera» (2.ª)
  const g = (name) => tile.locator('.sticky', { hasText: name }).getByRole('button', { name: /^Mover/ });
  const a = await g('Llamar').boundingBox(), b = await g('Tercera').boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const order = await tile.locator('.sticky .sticky-paper').evaluateAll((e) => e.map((x) => x.textContent.slice(0, 7)));
  check(order[1].startsWith('Llamar') && order[2].startsWith('Tercera'), `arrastrar reordena (${order.join(' · ')})`);
  // teclado: Alt + → la devuelve
  await tile.locator('.sticky', { hasText: 'Llamar' }).getByRole('button', { name: /^Mover/ }).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await page.waitForTimeout(300);
  const order2 = await tile.locator('.sticky .sticky-paper').evaluateAll((e) => e.map((x) => x.textContent.slice(0, 7)));
  check(order2[2].startsWith('Llamar'), `Alt + → mueve con el teclado (${order2.join(' · ')})`);

  console.log('Archivar');
  await more('Tercera').click();
  await page.locator('.popover').getByRole('menuitem', { name: 'Archivar' }).click();
  await page.waitForTimeout(200);
  check((await tile.locator('.sticky').count()) === 2 && (await tile.getByRole('button', { name: '1 archivada' }).count()) === 1, 'archivada: sale de la vista, con su contador');
  await tile.getByRole('button', { name: '1 archivada' }).click();
  check((await tile.locator('.sticky').count()) === 1, 'ver archivadas');
  await tile.getByRole('button', { name: '1 archivada' }).click();

  console.log('Eliminar con deshacer');
  await more('Segunda').click();
  await page.locator('.popover').getByRole('menuitem', { name: 'Eliminar' }).click();
  await page.waitForTimeout(400);
  check((await tile.locator('.sticky').count()) === 1, 'eliminada (a la papelera)');
  await page.locator('.toast').getByRole('button', { name: 'Deshacer' }).click();
  await page.waitForTimeout(800);
  check((await tile.locator('.sticky', { hasText: 'Segunda' }).count()) === 1, 'Deshacer la devuelve');

  console.log('Convertir en nota');
  await more('Llamar').click();
  await page.locator('.popover').getByRole('menuitem', { name: 'Convertir en nota' }).click();
  await page.waitForTimeout(800);
  const notes = await vaultFiles(page, 'notes');
  check(notes['Llamar al tutor.md'] === '**Llamar** al tutor\n- [ ] confirmar hora\n', `nota «Llamar al tutor.md» sin las claves de sticky (${JSON.stringify(notes['Llamar al tutor.md'])})`);
  check(!(await tile.locator('.sticky', { hasText: 'Llamar' }).count()), 'y ya no es sticky');

  console.log('Abrir en Notas');
  await more('Segunda').click();
  await page.locator('.popover').getByRole('menuitem', { name: 'Abrir en Notas' }).click();
  await page.waitForTimeout(800);
  check(/#\/notas\/Stickies\//.test(page.url()) && (await page.locator('.doc, .note-panel, main').first().textContent()).includes('Segunda'), `abre la nota en Notas (${page.url().split('#')[1]})`);

  console.log('Bandeja y recarga');
  await page.goto(URL_ + '#/hoy');
  await tile.waitFor();
  await page.locator('.mh:has(section.stickies) .min-btn').click();
  await page.waitForTimeout(500);
  const sq = page.locator('.tray .tray-sq[aria-label^="Sticky notes"]');
  check((await sq.count()) === 1 && !(await tile.count()), 'minimizar a la bandeja');
  await sq.click();
  await page.waitForTimeout(400);
  check((await tile.count()) === 1, 'restaurar');
  await page.reload();
  await tile.waitFor();
  await page.waitForTimeout(600);
  check((await tile.locator('.sticky').count()) === 1 && (await tile.getByRole('button', { name: '1 archivada' }).count()) === 1, 'tras recargar, todo sale de los archivos');
  await tile.screenshot({ path: OUT + 'stickies.png' });
  await ctx.close();
} catch (e) {
  failed++;
  console.error(e);
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} FALLO(S)` : '\nOK');
process.exit(failed ? 1 : 0);
