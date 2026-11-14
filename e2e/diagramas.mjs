// Diagramas (mapa, flujo, diagrama libre): crear por «Nueva nota» y por «/», 10 nodos, conectar y etiquetar,
// mover (`{x=,y=}` en el .md), plegar, Ordenar + deshacer, recarga, exportar PNG, carga bajo demanda y consola limpia.
// Chromium (en el contenedor no hay WebKit; con BROWSER=webkit se usa si existe).
//   npm run build && npm run e2e:diagramas
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4196;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'chromium'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };

const errors = [];
/** Contexto nuevo con bóveda de ejemplo; recoge errores de consola y de página. */
async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 1500 }, locale: 'es-MX', serviceWorkers: 'block', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  return { ctx, page };
}
/** Lee un archivo de la bóveda (OPFS) desde la propia app. */
const readVault = (page, path) => page.evaluate(async (path) => {
  const parts = path.split('/');
  let dir = await navigator.storage.getDirectory();
  try {
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p);
    return await (await (await dir.getFileHandle(parts.at(-1))).getFile()).text();
  } catch { return null; }
}, path);
/** Espera (máx. 4 s) a que el archivo cumpla `ok(texto)` y lo devuelve (el guardado va con retraso). */
async function vaultWhen(page, path, ok) {
  let t = null;
  for (let i = 0; i < 40; i++) { t = await readVault(page, path); if (t !== null && ok(t)) return t; await page.waitForTimeout(100); }
  return t;
}
async function newNote(page, title, kind) {
  await page.goto(URL_ + '#/notas');
  await page.getByRole('button', { name: 'Nueva nota', exact: true }).first().click();
  const sheet = page.locator('.sheet');
  await sheet.getByLabel('Título').fill(title);
  if (kind) await sheet.getByRole('group', { name: 'Tipo de nota' }).getByRole('button', { name: kind, exact: true }).click();
  await sheet.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.locator('.doc').waitFor();
}
const nodes = (page) => page.locator('.diag-node');
const nodeCount = (page) => nodes(page).count();
const node = (page, text) => page.locator('.diag-node', { hasText: text }).first();
const edgeCount = (page) => page.locator('path.diag-edge[data-path]').count();
const btn = (page, name) => page.getByRole('button', { name, exact: true });
const bar = (page, name) => page.getByRole('toolbar', { name: 'Edición del diagrama' }).getByRole('button', { name });
/** Pide texto en el diálogo (hoja) y acepta. */
async function ask(page, text) {
  const inp = page.locator('.sheet input.input');
  await inp.waitFor();
  await inp.fill(text);
  await inp.press('Enter');
  await page.locator('.sheet').waitFor({ state: 'detached' });
}
const click = async (loc) => { const b = await loc.boundingBox(); await loc.page().mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
async function drag(page, from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}
const center = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const body = (t) => t.replace(/^---\n[\s\S]*?\n---\n?/, '');

try {
  const { ctx, page } = await fresh();
  console.log('Navegador usado:', type.name(), '(WebKit no existe en este contenedor)');

  // ---------- 1. Crear una nota de cada tipo ----------
  console.log('1. Tipos de nota');
  const kinds = [['mapa', 'Mapa mental'], ['flujo', 'Diagrama de flujo'], ['diagrama', 'Diagrama libre']];
  for (const [k, label] of kinds) {
    const title = `T ${k} nueva`;
    await newNote(page, title, label);
    const txt = await vaultWhen(page, `notes/${title}.md`, () => true);
    check(txt !== null && new RegExp(`^tipo: ${k}$`, 'm').test(txt), `«Nueva nota» (${label}) escribe tipo: ${k} en el .md`);
    await page.locator('.diag-node').first().waitFor({ timeout: 5000 }).catch(() => {});
    check((await nodeCount(page)) > 0, `${label}: la vista muestra nodos (${await nodeCount(page)})`);
  }
  // desde «/» en una nota normal
  await newNote(page, 'Normal con barra');
  for (const [k, label] of kinds) {
    await page.getByRole('button', { name: /Escribe o usa/ }).click();
    await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
    await page.keyboard.type('/', { delay: 20 });
    await page.locator('.slash').getByText(label, { exact: true }).click();
    await page.keyboard.press('Escape');
    const txt = await vaultWhen(page, 'notes/Normal con barra.md', (t) => t.includes('```' + k));
    check(txt !== null && txt.includes('```' + k), `«/» ${label} inserta un bloque \`\`\`${k} en la nota normal`);
    await page.locator('.doc').click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(300);
  }
  const normal = await readVault(page, 'notes/Normal con barra.md');
  check(!/^tipo:/m.test(normal ?? ''), 'la nota normal sigue sin `tipo:`');

  // ---------- 2. Diez cajitas en un mapa ----------
  console.log('2. Mapa con 10 cajitas');
  await newNote(page, 'Mapa diez', 'Mapa mental');
  await nodes(page).first().waitFor();
  const n0 = await nodeCount(page);
  for (let i = 1; i <= 10; i++) {
    await click(node(page, 'Mapa diez').first());
    await bar(page, /Añadir hijo/).click();
    await ask(page, `H${i}`);
    await page.waitForFunction((n) => document.querySelectorAll('.diag-node').length >= n, n0 + i);
  }
  const n10 = await nodeCount(page);
  check(n10 === n0 + 10 && n10 >= 10, `10 cajitas añadidas con el botón «Añadir hijo» (${n0} + 10 = ${n10} nodos en la vista)`);
  const mapTxt = await vaultWhen(page, 'notes/Mapa diez.md', (t) => t.includes('H10'));
  check(mapTxt !== null && /- H1\b/.test(mapTxt) && /- H10\b/.test(mapTxt), 'las 10 cajitas están en el .md');
  // hijo con Tab desde el teclado
  await click(node(page, 'H1'));
  await node(page, 'H1').focus();
  await page.keyboard.press('Tab');
  await ask(page, 'Sub de H1');
  await node(page, 'Sub de H1').waitFor();
  check(true, 'hijo con Tab (teclado) sobre el nodo seleccionado');

  // ---------- 5. Plegar / desplegar ----------
  console.log('5. Plegar una rama');
  const before = await nodeCount(page);
  await click(node(page, 'H1'));
  await bar(page, 'Plegar').click();
  await page.waitForFunction((n) => document.querySelectorAll('.diag-node').length < n, before);
  const folded = await nodeCount(page);
  check(folded === before - 1 && (await node(page, 'Sub de H1').count()) === 0, `plegar oculta el hijo (${before} → ${folded})`);
  check(/\{plegado\}/.test((await vaultWhen(page, 'notes/Mapa diez.md', (t) => t.includes('{plegado}'))) ?? ''), '`{plegado}` queda escrito en el .md');
  await click(node(page, 'H1'));
  await bar(page, 'Desplegar').click();
  await page.waitForFunction((n) => document.querySelectorAll('.diag-node').length >= n, before);
  check((await nodeCount(page)) === before && (await node(page, 'Sub de H1').count()) === 1, 'desplegar devuelve el hijo');

  // ---------- 4. Mover un nodo ----------
  console.log('4. Mover un nodo');
  const pre = await readVault(page, 'notes/Mapa diez.md');
  check(!/\{x=/.test(pre), 'antes de mover no hay `{x=,y=}`');
  const h3 = node(page, 'H3');
  const c3 = await center(h3);
  await drag(page, c3, { x: c3.x + 90, y: c3.y + 70 });
  const moved = await vaultWhen(page, 'notes/Mapa diez.md', (t) => /\{x=-?\d+,y=-?\d+\}/.test(t));
  check(/- H3 \{x=-?\d+,y=-?\d+\}/.test(moved ?? ''), 'arrastrar H3 escribe `{x=,y=}` en el .md: ' + ((moved ?? '').match(/- H3[^\n]*/)?.[0] ?? '(nada)'));
  await page.screenshot({ path: OUT + 'diagramas-mapa.png' });

  // ---------- 6. Ordenar + deshacer ----------
  console.log('6. Ordenar y deshacer');
  // dos movimientos más para que «Ordenar» tenga qué limpiar
  const c5 = await center(node(page, 'H5'));
  await drag(page, c5, { x: c5.x - 60, y: c5.y + 50 });
  const withPos = await vaultWhen(page, 'notes/Mapa diez.md', (t) => (t.match(/\{x=/g) ?? []).length >= 2);
  const posBefore = await page.evaluate(() => [...document.querySelectorAll('.diag-node')].map((n) => n.style.transform).join('|'));
  await btn(page, 'Ordenar').click();
  await page.waitForTimeout(500);
  const ordered = await vaultWhen(page, 'notes/Mapa diez.md', (t) => t !== withPos);
  const posAfter = await page.evaluate(() => [...document.querySelectorAll('.diag-node')].map((n) => n.style.transform).join('|'));
  check(ordered !== withPos && posAfter !== posBefore, `«Ordenar» cambia el texto y las posiciones (${(withPos.match(/\{x=/g) ?? []).length} → ${(ordered.match(/\{x=/g) ?? []).length} posiciones fijadas)`);
  await btn(page, 'Deshacer').click();
  const undone = await vaultWhen(page, 'notes/Mapa diez.md', (t) => t === withPos);
  const posUndo = await page.evaluate(() => [...document.querySelectorAll('.diag-node')].map((n) => n.style.transform).join('|'));
  check(undone === withPos && posUndo === posBefore, 'Deshacer devuelve el texto y las posiciones anteriores');
  // y con el teclado: rehacer con ⌘⇧Z / Ctrl+Shift+Z y deshacer con Ctrl+Z
  await node(page, 'H2').focus();
  await page.keyboard.press('Control+Shift+Z');
  const redone = await vaultWhen(page, 'notes/Mapa diez.md', (t) => t === ordered);
  check(redone === ordered, 'Ctrl/⌘+Shift+Z rehace «Ordenar»');
  await node(page, 'H2').focus();
  await page.keyboard.press('Control+Z');
  const undone2 = await vaultWhen(page, 'notes/Mapa diez.md', (t) => t === withPos);
  check(undone2 === withPos, 'Ctrl/⌘+Z deshace con el teclado');

  // ---------- 3. Flujo: conectar y etiquetar ----------
  console.log('3. Flujo: conectar y etiquetar');
  await newNote(page, 'Flujo dos', 'Diagrama de flujo');
  await nodes(page).first().waitFor();
  const f0 = await nodeCount(page), e0 = await edgeCount(page);
  for (const name of ['Alfa', 'Beta']) {
    await page.locator('.diag-board').click({ position: { x: 4, y: 4 } }); // sin selección → nodo suelto
    await page.getByRole('button', { name: 'Nuevo nodo', exact: true }).click();
    await ask(page, name);
    await node(page, name).waitFor();
  }
  check((await nodeCount(page)) === f0 + 2, `dos nodos sueltos (${f0} → ${await nodeCount(page)})`);
  await page.getByRole('button', { name: 'Ajustar al contenido' }).click(); // todo el flujo dentro del lienzo
  await page.waitForTimeout(300);
  await click(node(page, 'Alfa'));
  const handle = page.locator('.diag-handle');
  await handle.waitFor();
  await page.waitForTimeout(300);
  await drag(page, await center(handle), await center(node(page, 'Beta')), 16);
  await page.waitForFunction((n) => document.querySelectorAll('path.diag-edge[data-path]').length > n, e0, { timeout: 4000 }).catch(() => {});
  const e1 = await edgeCount(page);
  const flowTxt = await vaultWhen(page, 'notes/Flujo dos.md', (t) => t.includes('[Alfa] --> [Beta]'));
  check(e1 === e0 + 1 && /\[Alfa\] --> \[Beta\]/.test(flowTxt ?? ''), `arrastrar desde el asa conecta Alfa → Beta (flechas ${e0} → ${e1}; texto ${/\[Alfa\] --> \[Beta\]/.test(flowTxt ?? '') ? 'ok' : 'sin la línea'})`);
  // seleccionar la flecha: clic en su punto medio
  const mid = await page.evaluate(() => {
    const ps = [...document.querySelectorAll('path.diag-edge[data-path]')];
    const p = ps.at(-1);
    const L = p.getTotalLength(), pt = p.getPointAtLength(L / 2), m = p.getScreenCTM();
    return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f };
  });
  await page.mouse.click(mid.x, mid.y);
  const labelBtn = page.getByRole('toolbar', { name: 'Edición del diagrama' }).getByRole('button', { name: 'Etiqueta de la flecha' });
  await labelBtn.waitFor({ timeout: 3000 }).catch(() => {});
  if (await labelBtn.count()) {
    await labelBtn.click();
    await ask(page, 'sí');
    const lab = await vaultWhen(page, 'notes/Flujo dos.md', (t) => /-- sí -->/.test(t));
    check(/\[Alfa\] -- sí --> \[Beta\]/.test(lab ?? ''), 'etiquetar la flecha escribe `-- sí -->`: ' + ((lab ?? '').match(/.*Alfa.*/)?.[0] ?? '(nada)'));
    const seen = (await page.locator('.diag-board .diag-label').count()) > 0 || /(^|\s)sí(\s|$)/.test(await page.locator('.diag-board').innerText());
    if (!seen) await page.screenshot({ path: OUT + 'diagramas-etiqueta.png' });
    check(seen, 'la etiqueta de la flecha se ve en el lienzo de edición');
  } else {
    check(false, 'seleccionar la flecha con un clic muestra «Etiqueta de la flecha»');
    await page.screenshot({ path: OUT + 'diagramas-flecha.png' });
  }
  await page.screenshot({ path: OUT + 'diagramas-flujo.png' });

  // ---------- 7. Recarga ----------
  console.log('7. Recargar');
  const flowNow = await readVault(page, 'notes/Flujo dos.md');
  const nFlow = await nodeCount(page), eFlow = await edgeCount(page);
  await page.reload();
  await nodes(page).first().waitFor({ timeout: 8000 }).catch(() => {});
  check((await nodeCount(page)) === nFlow && (await edgeCount(page)) === eFlow, `tras recargar el flujo sigue igual (${await nodeCount(page)} nodos, ${await edgeCount(page)} flechas)`);
  check((await readVault(page, 'notes/Flujo dos.md')) === flowNow, 'el .md no cambió al recargar');
  await page.goto(URL_ + '#/notas/' + encodeURIComponent('Mapa diez.md'));
  await nodes(page).first().waitFor({ timeout: 8000 }).catch(() => {});
  check((await nodeCount(page)) === before, `el mapa recargado conserva sus ${before} nodos (${await nodeCount(page)})`);

  // ---------- 8. Exportar PNG ----------
  console.log('8. Exportar PNG');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const dlP = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  const pngBtn = page.locator('.sheet').getByRole('button', { name: /PNG/ });
  await pngBtn.waitFor();
  await page.waitForFunction(() => !document.querySelector('.sheet')?.querySelectorAll('button')[1]?.disabled, null, { timeout: 15000 }).catch(() => {});
  await pngBtn.click();
  const dl = await dlP;
  if (!dl) check(false, 'el PNG se descarga (no hubo descarga; ¿navigator.share en el entorno?)');
  else {
    const path = await dl.path();
    const buf = readFileSync(path);
    const sig = buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    check(dl.suggestedFilename().endsWith('.png') && sig, `se descarga ${dl.suggestedFilename()} y es un PNG válido`);
    check(w > 0 && h > 0 && w <= 2048 && h <= 2048, `dimensiones ${w}×${h}: > 0 y ≤ 2 048 por lado`);
  }
  await page.keyboard.press('Escape');
  await ctx.close();

  // ---------- 9. Módulo sin usar ----------
  console.log('9. Carga bajo demanda');
  const { ctx: c2, page: p2 } = await fresh();
  const js = new Set(), css = new Set();
  p2.on('response', (r) => { const u = r.url(); if (u.endsWith('.js')) js.add(u); if (u.endsWith('.css')) css.add(u); });
  const isDiag = async (set, marks) => { const hit = []; for (const u of set) { const t = await (await fetch(u)).text(); if (marks.every((m) => t.includes(m))) hit.push(u.split('/').pop()); } return hit; };
  // contenido propio del motor: lienzo/vista (clases de nodo) y editor (clase del editor)
  const JSM = ['diag-node', 'diag-board'], CSSM = ['.diag-node'];
  await newNote(p2, 'Solo texto');
  await p2.getByRole('button', { name: /Escribe o usa/ }).click();
  await p2.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
  await p2.keyboard.insertText('Una nota normal sin diagramas.');
  await p2.waitForTimeout(800);
  await p2.goto(URL_ + '#/notas');
  await p2.waitForTimeout(800);
  await p2.goto(URL_ + '#/hoy');
  await p2.waitForTimeout(600);
  const jsA = await isDiag(js, JSM), cssA = await isDiag(css, CSSM);
  check(jsA.length === 0 && cssA.length === 0, `en una nota normal no se pide código del motor de diagramas (js ${js.size} fragmentos, css ${css.size}; coincidencias: ${[...jsA, ...cssA].join(', ') || 'ninguna'})`);
  const editorJs = await isDiag(js, ['diag-fbar']);
  check(editorJs.length === 0, 'tampoco el editor (barra flotante)');
  await newNote(p2, 'Con mapa', 'Mapa mental');
  await p2.locator('.diag-node').first().waitFor({ timeout: 8000 }).catch(() => {});
  await p2.waitForTimeout(400);
  const jsB = await isDiag(js, JSM), cssB = await isDiag(css, CSSM);
  check(jsB.length > 0 && cssB.length > 0, `control: al abrir una nota de mapa sí se pide (js ${jsB.join(', ')}; css ${cssB.join(', ')})`);
  await c2.close();

  // ---------- 10. Consola ----------
  console.log('10. Consola');
  check(errors.length === 0, `sin errores de consola ni de página en todo el recorrido (${errors.length})`);
  for (const e of errors.slice(0, 8)) console.log('     ', e.slice(0, 200));
} catch (e) {
  failed++;
  console.error(e);
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} FALLO(S)` : '\nOK');
process.exit(failed ? 1 : 0);
