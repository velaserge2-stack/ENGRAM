// Prompt 17: barra de herramientas fija del editor de notas.
//   npm run build && npm run e2e:barra      (ONLY=fija,formato,tablas,imagen,orden,lienzo,telefono)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4193;
const URL_ = `http://localhost:${PORT}/`;
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

async function fresh(w = 1180, h = 820, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'es-MX', ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => (errors.push(String(e)), process.env.DBG && console.log(e.stack)));
  page.on('console', (m) => (m.type() === 'error' && errors.push(m.text()), process.env.DBG && m.text().startsWith('DBG') && console.log('    ' + m.text())));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  return { ctx, page };
}
async function newNote(page, title) {
  await page.goto(URL_ + '#/notas');
  await page.getByRole('button', { name: 'Nueva nota', exact: true }).first().click();
  await page.locator('.sheet').getByLabel('Título').fill(title);
  await page.locator('.sheet').getByLabel('Título').press('Enter');
  await page.locator('.doc').waitFor();
}
const bar = (page) => page.getByRole('toolbar', { name: 'Barra de formato' });
const btn = (page, name) => bar(page).getByRole('button', { name, exact: false });
const box = async (page) => { const b = await bar(page).boundingBox(); return b && { y: Math.round(b.y), h: Math.round(b.height) }; };
const markdown = async (page) => {
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Ver Markdown' }).click();
  const v = await page.getByLabel('Markdown de la nota').inputValue();
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Documento' }).click();
  return v;
};
/** Abre un bloque nuevo al final y escribe (a ritmo humano). */
async function write(page, text) {
  await page.getByRole('button', { name: /Escribe o usa/ }).click();
  await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
  // (con saltos de línea, de una vez: Intro al final de un bloque pierde el «\n», fallo previo de main)
  if (text.includes('\n')) await page.keyboard.insertText(text);
  else await page.keyboard.type(text, { delay: 15 });
}
/** Selección en el bloque en edición (tras un cuadro: la barra restaura la suya después de cada acción). */
const sel = async (page, a, b) => (await page.waitForTimeout(80), page.evaluate(([a, b]) => { const t = document.querySelector('.doc textarea'); t.focus(); t.setSelectionRange(a, b); document.dispatchEvent(new Event('selectionchange')); }, [a, b]));
/** Espera (máx. 2 s) a que el bloque en edición tenga exactamente `v`: la barra escribe y el editor vuelve a pintar. */
const is = (page, v) => page.waitForFunction((v) => document.querySelector('.doc textarea')?.value === v, v, { timeout: 2000 }).then(() => true, () => false);
const taVal = (page) => page.evaluate(() => document.querySelector('.doc textarea')?.value ?? null);

try {
  if (run('fija')) {
    console.log('La barra siempre está');
    const { ctx, page } = await fresh();
    await newNote(page, 'Barra fija');
    await bar(page).waitFor();
    const b0 = await box(page);
    check(b0 && b0.h >= 44, `visible al abrir la nota (alto ${b0?.h} px)`);
    check(await btn(page, 'Negrita').isDisabled(), 'sin bloque en edición, los botones de texto están desactivados (no ocultos)');
    await write(page, 'Párrafo largo de prueba. '.repeat(30));
    check(!(await btn(page, 'Negrita').isDisabled()), 'al editar un bloque se activan');
    // desplazar una nota larga: la barra sigue arriba
    for (let i = 0; i < 12; i++) await write(page, `Párrafo ${i} `.repeat(40));
    await page.keyboard.press('Escape');
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(300);
    const b1 = await box(page);
    check(b1 && b1.y >= 0 && b1.y < 140 && b1.h === b0.h, `al desplazar sigue visible arriba y con el mismo alto (y=${b1?.y})`);
    // cambiar doc ↔ md y abrir paneles laterales
    await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Ver Markdown' }).click();
    check(await bar(page).isVisible(), 'en modo Markdown sigue visible');
    await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Documento' }).click();
    for (const tab of ['Propiedades', 'Tarjetas', 'Eventos', 'Esquema']) {
      const t = page.getByRole('tab', { name: tab });
      if (await t.count()) await t.click();
      check(await bar(page).isVisible(), `con el panel «${tab}» abierto sigue visible`);
    }
    // plegar: queda la franja con desplegar, deshacer, rehacer y negrita; se recuerda al recargar
    await btn(page, 'Plegar barra').click();
    const f = await box(page);
    check(f.h === b0.h && await btn(page, 'Desplegar barra').isVisible() && await btn(page, 'Deshacer').isVisible() && await btn(page, 'Negrita').isVisible() && !(await btn(page, 'Cursiva').count()), 'plegada: franja fija con desplegar, deshacer, rehacer y negrita (mismo alto: el texto no salta)');
    await page.reload();
    await bar(page).waitFor();
    check(await btn(page, 'Desplegar barra').isVisible(), 'el estado plegado sobrevive a recargar');
    await btn(page, 'Desplegar barra').click();
    check(await btn(page, 'Cursiva').isVisible(), 'desplegar devuelve todos los botones');
    await page.screenshot({ path: OUT + 'barra-fija.png' });
    await ctx.close();
  }

  if (run('formato')) {
    console.log('Formato sin escribir Markdown');
    const { ctx, page } = await fresh();
    await newNote(page, 'Formato');
    await write(page, 'hola mundo feliz');
    await sel(page, 5, 10);
    await btn(page, 'Negrita').click();
    check(await is(page, 'hola **mundo** feliz'), 'negrita sobre la selección');
    check(await page.waitForFunction(() => document.querySelector('.editorbar [aria-label^="Negrita"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 2000 }).then(() => true, () => false), 'el botón refleja el formato en el cursor (aria-pressed)');
    await btn(page, 'Negrita').click();
    check(await is(page, 'hola mundo feliz'), 'negrita otra vez la quita (alternar)');
    for (const [name, mark] of [['Subrayado', '++'], ['Tachado', '~~'], ['Resaltar', '=='], ['Cursiva', '*'], ['Código en línea', '`']]) {
      await sel(page, 5, 10);
      await btn(page, name).click();
      const v = await taVal(page);
      check(v === `hola ${mark}mundo${mark} feliz`, `${name}: ${v}`);
      await btn(page, 'Deshacer').click();
      await page.waitForTimeout(100);
      check(await is(page, 'hola mundo feliz'), `${name}: deshacer lo quita (un paso)`);
      await btn(page, 'Rehacer').click();
      await page.waitForTimeout(100);
      check(await is(page, `hola ${mark}mundo${mark} feliz`), `${name}: rehacer lo vuelve a poner`);
      await btn(page, 'Deshacer').click();
      await page.waitForTimeout(100);
    }
    // atajo de teclado
    await sel(page, 0, 4);
    await page.keyboard.press('Control+b');
    check(await is(page, '**hola** mundo feliz'), 'atajo ⌘B / Ctrl+B');
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(100);
    check(await is(page, 'hola mundo feliz'), '⌘Z deshace dentro del bloque');
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(100);
    check(await is(page, '**hola** mundo feliz'), '⌘⇧Z rehace');
    // color y tamaño
    await sel(page, 15, 20);
    await btn(page, 'Color del texto').click();
    await page.locator('.eb-pop').getByRole('menuitem', { name: 'Rojo', exact: true }).click();
    await sel(page, 17, 18);
    await btn(page, 'Tamaño de letra').click();
    await page.locator('.eb-pop').getByRole('menuitem', { name: 'Grande', exact: true }).click();
    check(await is(page, '**hola** mundo [feliz]{.rojo .grande}'), `color y tamaño en la misma marca legible: ${await taVal(page)}`);
    // estilo de párrafo y alineación
    await bar(page).getByLabel('Estilo de párrafo').selectOption('h2');
    check((await taVal(page)).startsWith('## '), 'estilo «Título 2» desde el selector (el bloque sigue en edición)');
    await btn(page, 'Centrar').click();
    check((await taVal(page)).endsWith(' {.centro}'), 'centrar añade la marca final {.centro}');
    await page.keyboard.press('Escape');
    const h2 = page.locator('.doc h2.al-centro');
    check(await h2.count() === 1 && /feliz/.test(await h2.textContent()), 'se ve como título centrado (sin la marca)');
    // listas, tareas y sangría
    await write(page, 'uno\ndos');
    if (process.env.DBG) console.log('    DBG tras escribir', JSON.stringify(await taVal(page)));
    await sel(page, 0, 7);
    if (process.env.DBG) console.log('    DBG tras sel', JSON.stringify(await taVal(page)));
    await btn(page, 'Lista de tareas').click();
    if (process.env.DBG) { await page.waitForTimeout(300); console.log('    DBG tras clic', JSON.stringify(await taVal(page)), await page.evaluate(() => [...document.querySelectorAll('[data-block]')].map((e) => e.textContent.slice(0, 30)).slice(-3))); }
    check(await is(page, '- [ ] uno\n- [ ] dos'), 'lista de tareas → ' + JSON.stringify(await taVal(page)));
    await btn(page, 'Lista numerada').click();
    check(await is(page, '1. uno\n2. dos'), 'cambiar el tipo de lista');
    await sel(page, 9, 9);
    await btn(page, 'Aumentar sangría').click();
    check(await is(page, '1. uno\n  2. dos'), 'subir el nivel con la sangría');
    // enlace, fecha y quitar formato
    await page.keyboard.press('Escape');
    await write(page, 'ver nota');
    await sel(page, 4, 8);
    await btn(page, 'Enlace').click();
    await page.locator('.eb-pop input').fill('Clase 1');
    await page.locator('.eb-pop').getByRole('button', { name: /Clase 1/ }).click();
    check(await is(page, 'ver [[Clase 1 - ECG básico|nota]]'), `enlace a una nota con alias: ${await taVal(page)}`);
    await sel(page, 0, 0);
    await btn(page, 'Fecha de hoy').click();
    const fv = await page.waitForFunction(() => /^\d{4}-\d{2}-\d{2}ver/.test(document.querySelector('.doc textarea')?.value ?? ''), null, { timeout: 2000 }).then(() => '', async () => JSON.stringify(await taVal(page)));
    check(!fv, 'fecha de hoy en el cursor' + (fv ? ' → ' + fv : ''));
    await page.keyboard.press('Escape');
    await btn(page, 'Línea divisoria').click();
    // todo queda en el .md tras recargar
    await page.waitForTimeout(1200);
    await page.reload();
    await bar(page).waitFor();
    const md = await markdown(page);
    check(md.includes('## **hola** mundo [feliz]{.rojo .grande} {.centro}') && md.includes('1. uno\n  2. dos') && md.includes('[[Clase 1 - ECG básico|nota]]') && md.includes('\n---'), 'tras recargar, todo quedó como Markdown legible en el .md');
    await page.screenshot({ path: OUT + 'barra-formato.png' });
    await ctx.close();
  }

  if (run('tablas')) {
    console.log('Tablas');
    const { ctx, page } = await fresh();
    await newNote(page, 'Tablas');
    await btn(page, 'Insertar tabla').click();
    await page.locator('.eb-grid button[aria-label="3 × 3"]').click();
    const t0 = await taVal(page);
    check(t0 === '| Columna 1 | Columna 2 | Columna 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |', 'tabla 3×3 desde la rejilla');
    await sel(page, 3, 3);
    check(await btn(page, 'Agregar fila').waitFor({ timeout: 2000 }).then(() => true, () => false), 'con el cursor en la tabla aparece el grupo de tabla');
    await btn(page, 'Agregar fila').click();
    await sel(page, 3, 3);
    await btn(page, 'Agregar columna').click();
    await sel(page, 3, 3);
    await btn(page, 'Centrar columna').click();
    await page.waitForTimeout(150);
    const t1 = await taVal(page);
    check(t1.split('\n').length === 5 && t1.split('\n')[0].split('|').length === 6 && t1.split('\n')[1].startsWith('| :-: |'), 'agregar fila y columna, y alinear la columna');
    await sel(page, 3, 3);
    await btn(page, 'Ajustar columnas').click();
    await page.waitForTimeout(150);
    check((await taVal(page)).split('\n').every((l, _i, a) => l.length === a[0].length), 'ajustar columnas deja el texto alineado');
    await page.keyboard.press('Escape');
    check(await page.locator('.doc table th').count() === 4, 'se ve como tabla');
    await ctx.close();
  }

  if (run('orden')) {
    console.log('Mover párrafos');
    const { ctx, page } = await fresh();
    // la nota de ejemplo tiene tarjetas vinculadas a sus párrafos
    await page.goto(URL_ + '#/notas/' + encodeURI('Cardiología/ECG/Clase 1 - ECG básico.md'));
    await page.locator('.doc').waitFor();
    const before = await markdown(page);
    const blocks = await page.locator('[data-block]').count();
    await page.locator('[data-block="2"]').click();
    await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
    const moved = await taVal(page);
    await btn(page, 'Bajar bloque').click();
    await page.waitForTimeout(200);
    check(await is(page, moved), 'el bloque movido sigue en edición');
    check(/posición 4 de/.test(await page.locator('.sr-only[aria-live]').textContent()), 'se anuncia la nueva posición');
    await page.keyboard.press('Control+Alt+ArrowUp');
    await page.waitForTimeout(200);
    check(await is(page, moved), '⌘⌥↑ lo sube otra vez (sigue en edición)');
    await page.keyboard.press('Control+Alt+ArrowDown');
    await page.waitForTimeout(200);
    const after = await markdown(page);
    check(after !== before && after.replace(/\s+/g, '').length === before.replace(/\s+/g, '').length && after.includes(moved), 'bajar un bloque cambia el orden sin perder texto (ni sus ^id)');
    // deshacer el movimiento devuelve el texto exacto
    for (let k = 0; k < 3; k++) (await btn(page, 'Deshacer').click(), await page.waitForTimeout(150));
    check(await markdown(page) === before, 'deshacer los tres movimientos deja el texto idéntico al original');
    check(await btn(page, 'Deshacer').isDisabled(), 'sin más pasos, «Deshacer» queda desactivado');
    check(await page.locator('[data-block]').count() === blocks, 'mismo número de bloques');
    await ctx.close();
  }

  if (run('cobertura')) {
    console.log('Mover un párrafo con tarjeta vinculada');
    const { ctx, page } = await fresh();
    await newNote(page, 'Cobertura');
    await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Ver Markdown' }).click();
    await page.getByLabel('Markdown de la nota').fill('# Cobertura\n\nPrimer párrafo largo sobre el eje eléctrico del corazón.\n\nSegundo párrafo largo sobre la onda P y el intervalo PR.\n\nTercer párrafo largo sobre el complejo QRS ancho.');
    await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Documento' }).click();
    if (!(await page.getByRole('tab', { name: 'Tarjetas' }).count())) await page.getByRole('button', { name: 'Mostrar inspector' }).click();
    await page.getByRole('tab', { name: 'Tarjetas' }).click();
    await page.locator('.insp button.opt', { hasText: 'Segundo párrafo' }).click();
    await page.locator('.sheet').getByLabel('Respuesta').fill('PR');
    await page.locator('.sheet').getByRole('button', { name: 'Añadir' }).click();
    await page.locator('.sheet').waitFor({ state: 'detached' });
    const covered = () => page.locator('.insp button.opt').allTextContents();
    await page.waitForFunction(() => ![...document.querySelectorAll('.insp button.opt')].some((b) => b.textContent.includes('Segundo')), null, { timeout: 5000 });
    check(true, 'la tarjeta cubre el segundo párrafo');
    await page.locator('[data-block]', { hasText: 'Segundo párrafo' }).click();
    await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
    await btn(page, 'Bajar bloque').click();
    await page.waitForTimeout(1500);
    const un = await covered();
    check(!un.some((t) => t.includes('Segundo')) && un.some((t) => t.includes('Tercer')), `tras moverlo sigue cubierto el mismo párrafo (sin cubrir: ${un.map((t) => t.slice(0, 14)).join(' | ')})`);
    await btn(page, 'Deshacer').click();
    await page.waitForTimeout(1500);
    check(!(await covered()).some((t) => t.includes('Segundo')), 'y al deshacer también');
    await ctx.close();
  }

  if (run('imagen')) {
    console.log('Imagen desde la barra (con la lógica de Notas-Pro · A)');
    const { ctx, page } = await fresh();
    await newNote(page, 'Imagen');
    await write(page, 'Texto que irá junto a la foto.');
    await sel(page, 0, 0);
    const png = Buffer.from(await page.evaluate(async () => { const c = Object.assign(document.createElement('canvas'), { width: 600, height: 400 }); const x = c.getContext('2d'); x.fillStyle = '#888'; x.fillRect(0, 0, 600, 400); const b = await new Promise((r) => c.toBlob(r, 'image/png')); return [...new Uint8Array(await b.arrayBuffer())]; }));
    const fc = page.waitForEvent('filechooser');
    await btn(page, 'Insertar imagen').click();
    await (await fc).setFiles({ name: 'foto.png', mimeType: 'image/png', buffer: png });
    const ib = page.getByRole('toolbar', { name: 'Opciones de la imagen' });
    await ib.waitFor({ timeout: 10000 });
    check(true, 'insertar imagen desde la barra abre su barra flotante (mismo saveImage)');
    for (const [name, al] of [['Alinear a la izquierda (texto a la derecha)', 'izq'], ['Centrar', 'centro'], ['Alinear a la derecha (texto a la izquierda)', 'der']]) {
      await ib.getByRole('button', { name, exact: true }).click();
      await page.waitForTimeout(200);
      const md = await markdown(page);
      check(new RegExp(`!\\[\\[[^\\]]+\\.png\\|${al}\\]\\]Texto`).test(md), `${al}: ${/!\[\[[^\]]+\]\]/.exec(md)?.[0]}`);
      await page.locator('.doc img[data-media]').first().click();
    }
    await ib.getByRole('button', { name: 'Mediana (mitad)' }).click();
    await page.waitForTimeout(200);
    check(/\.png\|50%\|der\]\]/.test(await markdown(page)), 'tamaño M');
    await page.locator('.doc img[data-media]').first().click();
    await ib.getByRole('button', { name: /^Quitar la imagen/ }).click();
    await page.waitForTimeout(200);
    check(!(await markdown(page)).includes('![['), 'quitar la imagen de la nota');
    await btn(page, 'Deshacer').click();
    await page.waitForTimeout(200);
    check((await markdown(page)).includes('|50%|der]]'), 'deshacer la devuelve');
    await ctx.close();
  }

  if (run('lienzo')) {
    console.log('Panel de nota en Espacios');
    const { ctx, page } = await fresh();
    await page.goto(URL_ + '#/espacios');
    await page.getByRole('button', { name: 'Nuevo espacio' }).first().click();
    await page.locator('.sheet input[name=n]').fill('Notas');
    await page.getByRole('button', { name: 'Crear', exact: true }).click();
    await page.getByText(/Añade paneles/).first().waitFor();
    const add = page.getByRole('button', { name: 'Añadir panel', exact: true });
    await add.scrollIntoViewIfNeeded();
    await add.click();
    await page.getByRole('menuitem', { name: 'Añadir panel Nota', exact: true }).evaluate((x) => x.click());
    await page.locator('.win').getByRole('button', { name: /Nueva nota/ }).click();
    await page.locator('.sheet').getByLabel('Título').fill('En el lienzo');
    await page.locator('.sheet').getByLabel('Título').press('Enter');
    await page.locator('.win .doc').waitFor();
    const pb = page.locator('.win .editorbar');
    check(await pb.isVisible(), 'la barra está dentro del panel de nota');
    await page.locator('.win .win-body').evaluate((e) => (e.scrollTop = e.scrollHeight));
    await page.waitForTimeout(200);
    const r = await pb.evaluate((e) => { const a = e.getBoundingClientRect(), w = e.closest('.win-body').getBoundingClientRect(); return { top: a.top - w.top, inside: a.top >= w.top - 1 && a.bottom <= w.bottom + 1 }; });
    check(r.inside && r.top < 4, `al desplazar el panel sigue arriba y dentro (${Math.round(r.top)} px)`);
    await page.screenshot({ path: OUT + 'barra-lienzo.png' });
    await ctx.close();
  }

  if (run('telefono')) {
    console.log('iPhone');
    const { ctx, page } = await fresh(390, 844, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    check(await page.evaluate(() => document.documentElement.classList.contains('is-phone')), 'modo teléfono');
    await newNote(page, 'Teléfono');
    await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Ver Markdown' }).click();
    await page.getByLabel('Markdown de la nota').fill(Array.from({ length: 40 }, (_, i) => `Párrafo ${i} con texto suficiente para ocupar varias líneas en un iPhone.`).join('\n\n'));
    await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Documento' }).click();
    await bar(page).waitFor();
    const b0 = await box(page);
    await page.evaluate(() => scrollTo(0, 2000));
    await page.waitForTimeout(200);
    const b1 = await box(page);
    const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    check(b1 && b1.y >= 0 && b1.y < 60 && b1.h === b0.h && noHScroll, `visible arriba al desplazar, un solo renglón y sin scroll horizontal de la página (y=${b1?.y}, alto ${b1?.h})`);
    check(await bar(page).evaluate((e) => e.querySelector('.eb-scroll').scrollWidth > e.querySelector('.eb-scroll').clientWidth), 'los botones se desplazan dentro de la barra; «Más» y plegar siempre a la vista');
    await page.screenshot({ path: OUT + 'barra-telefono.png' });
    await ctx.close();
  }

  if (run('pseudo')) {
    console.log('Pseudoidioma (+40 %)');
    const { ctx, page } = await fresh();
    await newNote(page, 'Pseudo');
    const h0 = (await box(page)).h;
    await page.goto(URL_ + '#/design');
    await page.getByRole('button', { name: 'Pseudo +40 %' }).click();
    await page.goto(URL_ + '#/notas/' + encodeURI('Pseudo.md'));
    await page.locator('.editorbar').waitFor();
    const r = await page.locator('.editorbar').evaluate((e) => ({ h: Math.round(e.getBoundingClientRect().height), page: document.documentElement.scrollWidth <= innerWidth }));
    check(r.h === h0 && r.page, `con textos un 40 % más largos la barra sigue en un renglón (${r.h} px) y la página sin scroll horizontal`);
    await page.goto(URL_ + '#/design');
    await page.getByRole('button', { name: 'ES', exact: true }).click();
    await ctx.close();
  }

  check(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log('\nOK');
} catch (e) {
  console.error('Errores de consola:', errors);
  for (const c of browser.contexts()) for (const [i, pg] of c.pages().entries()) await pg.screenshot({ path: OUT + `barra-fallo-${i}.png` }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  server.kill();
}
