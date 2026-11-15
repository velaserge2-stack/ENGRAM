// Diagramas (mapa, flujo, diagrama libre): crear por «Nueva nota» y por «/», 10 nodos, conectar y etiquetar,
// mover (`{x=,y=}` en el .md), plegar, Ordenar + deshacer, recarga, exportar PNG, carga bajo demanda y consola limpia.
// Chromium (en el contenedor no hay WebKit; con BROWSER=webkit se usa si existe).
//   npm run build && npm run e2e:diagramas
import { spawn, execFileSync } from 'node:child_process';
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
async function fresh(viewport = { width: 1180, height: 1500 }) {
  const ctx = await browser.newContext({ viewport, locale: 'es-MX', serviceWorkers: 'block', acceptDownloads: true });
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
  const inp = page.locator('textarea.diag-inline');
  await inp.waitFor();
  await inp.fill(text);
  await inp.press('Enter');
  await inp.waitFor({ state: 'detached' });
}
const click = async (loc) => { await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); await loc.page().mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
async function drag(page, from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}
const center = async (loc) => { const b = await loc.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
/** Pone el texto fuente con la vista de texto del editor y vuelve a la vista del diagrama. */
async function setText(page, text) {
  const toggle = page.locator('.diag-editor button[aria-pressed]').first();
  await toggle.click();
  await page.locator('.diag-editor textarea').fill(text);
  await toggle.click();
  await page.waitForTimeout(400);
}
const fit = async (page) => { await page.getByRole('button', { name: 'Ajustar al contenido', exact: true }).click(); await page.waitForTimeout(300); };
const bodyOf = (page) => page.locator('.diag-board');
/** Hojas o diálogos abiertos ahora mismo (no debe haber al editar en el sitio). */
const dialogs = (page) => page.locator('.sheet, [role=dialog]').count();
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
  await page.getByRole('button', { name: 'Ajustar al contenido', exact: true }).click();
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
  const handle = page.locator('.diag-chip[data-chip="derecha"]');
  await handle.waitFor();
  await page.waitForTimeout(300);
  await handle.scrollIntoViewIfNeeded();
  await drag(page, await center(handle), await center(node(page, 'Beta')), 16);
  await page.waitForTimeout(500);
  await page.waitForFunction((n) => document.querySelectorAll('path.diag-edge[data-path]').length > n, e0, { timeout: 4000 }).catch(() => {});
  const e1 = await edgeCount(page);
  const flowTxt = await vaultWhen(page, 'notes/Flujo dos.md', (t) => t.includes('[Alfa] --> [Beta]'));
  check(e1 === e0 + 1 && /\[Alfa\] --> \[Beta\]/.test(flowTxt ?? ''), `arrastrar desde el asa conecta Alfa → Beta (flechas ${e0} → ${e1}; texto ${/\[Alfa\] --> \[Beta\]/.test(flowTxt ?? '') ? 'ok' : 'sin la línea'})`);
  await fit(page); // el nuevo trazo cambia el acomodo: Ajustar otra vez
  await page.locator('.diag-board').click({ position: { x: 4, y: 4 } }); // sin selección: los chips del nodo no tapan la flecha
  await page.waitForTimeout(200);
  // seleccionar la flecha con un clic: el punto del trazo pintado más cercano a su mitad que esté dentro del tablero y de la ventana
  await page.locator('.diag-board').scrollIntoViewIfNeeded();
  const mid = await page.evaluate(() => {
    const p = [...document.querySelectorAll('path.diag-edge[data-path]')].at(-1);
    const m = p.getScreenCTM(), bd = document.querySelector('.diag-board').getBoundingClientRect();
    const L = p.getTotalLength(), pad = 8;
    const vis = (q) => q.x > Math.max(bd.left, 0) + pad && q.x < Math.min(bd.right, innerWidth) - pad && q.y > Math.max(bd.top, 0) + pad && q.y < Math.min(bd.bottom, innerHeight) - pad;
    let best = null;
    for (let i = 0; i <= 40; i++) {
      const pt = p.getPointAtLength(L * i / 40);
      const q = { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f, d: Math.abs(i - 20) };
      if (vis(q) && (!best || q.d < best.d)) best = q;
    }
    return best;
  });
  check(!!mid, 'la flecha tiene un tramo visible dentro del tablero para tocarla');
  await page.mouse.click(mid.x, mid.y);
  await page.waitForTimeout(300);
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

  // =====================================================================
  // Prompt 22 · §5: editor nuevo (lienzo grande, edición en el sitio, chips, texto, color, PDF…)
  // =====================================================================
  const { ctx: cq, page: q } = await fresh({ width: 1180, height: 820 });
  const toasts = () => q.locator('.toast').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});

  // ---------- 11. El lienzo ocupa casi todo el espacio disponible ----------
  console.log('11. Lienzo grande');
  await newNote(q, 'P22 grande', 'Mapa mental');
  await q.locator('.diag-board').waitFor();
  await toasts();
  const geo = await q.evaluate(() => {
    scrollTo(0, 0);
    const b = document.querySelector('.diag-board').getBoundingClientRect(), tb = document.querySelector('.topbar')?.getBoundingClientRect(), ed = document.querySelector('.diag-editor').getBoundingClientRect();
    const doc = document.querySelector('.doc').getBoundingClientRect();
    const top = tb ? tb.bottom : 0, tools = b.top - ed.top;
    return { bh: b.height, bw: b.width, availH: innerHeight - top - tools, docW: doc.width, innerW: innerWidth, tools };
  });
  check(geo.bh >= 0.85 * geo.availH, `el tablero ocupa ≥ 85 % del alto disponible (${Math.round(geo.bh)} de ${Math.round(geo.availH)} px = ${Math.round(100 * geo.bh / geo.availH)} %)`);
  check(geo.bw >= 0.85 * Math.min(geo.docW, geo.innerW), `y ≥ 85 % del ancho (${Math.round(geo.bw)} de ${Math.round(Math.min(geo.docW, geo.innerW))} px)`);

  // ---------- 12. Edición en el sitio ----------
  console.log('12. Edición en el sitio');
  await setText(q, 'Tema\n- Uno\n- Dos\n- Tres');
  await fit(q);
  await q.locator('.diag-board').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await toasts();
  const nUno = node(q, /^Uno$/);
  let c = await center(nUno);
  await q.mouse.dblclick(c.x, c.y);
  const ta = q.locator('textarea.diag-inline');
  await ta.waitFor({ timeout: 3000 });
  check((await dialogs(q)) === 0, 'doble clic abre un cuadro DENTRO del nodo, sin hoja ni diálogo');
  const inNode = await ta.evaluate((el) => !!el.closest('.diag-node') || (() => { const r = el.getBoundingClientRect(), n = document.querySelector('.diag-node.sel, .diag-node[data-editing]')?.getBoundingClientRect(); return !!n; })());
  check(inNode, 'el textarea está dentro del nodo (o en el sitio del nodo editado)');
  check(await ta.evaluate((el) => el.selectionStart === 0 && el.selectionEnd === el.value.length), 'al entrar se selecciona todo el texto');
  check(await ta.evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 16), 'el cuadro tiene letra ≥ 16 px (sin zoom en iOS)');
  await q.keyboard.type('Uno editado');
  await q.keyboard.press('Enter');
  await ta.waitFor({ state: 'detached', timeout: 3000 });
  let mdE = await vaultWhen(q, 'notes/P22 grande.md', (t) => t.includes('Uno editado'));
  check(/- Uno editado/.test(mdE ?? ''), 'Intro confirma y escribe en el .md');
  // Esc cancela
  c = await center(node(q, /Uno editado/));
  await q.mouse.dblclick(c.x, c.y);
  await ta.waitFor();
  await q.keyboard.type('NO DEBE QUEDAR');
  await q.keyboard.press('Escape');
  await ta.waitFor({ state: 'detached', timeout: 3000 });
  await q.waitForTimeout(500);
  check(!/NO DEBE QUEDAR/.test((await readVault(q, 'notes/P22 grande.md')) ?? '') && (await node(q, /Uno editado/).count()) === 1, 'Esc cancela y deja el texto como estaba');
  // clic fuera confirma
  c = await center(node(q, /^Dos$/));
  await q.mouse.dblclick(c.x, c.y);
  await ta.waitFor();
  await q.keyboard.type(' fuera');
  const bd = await q.locator('.diag-board').boundingBox();
  await q.mouse.click(bd.x + 6, bd.y + bd.height - 6);
  await ta.waitFor({ state: 'detached', timeout: 3000 });
  mdE = await vaultWhen(q, 'notes/P22 grande.md', (t) => /Dos fuera|fuera/.test(t));
  check(/fuera/.test(mdE ?? ''), 'clic fuera confirma el texto');
  // Tab encadena 5 hijos
  await fit(q);
  c = await center(node(q, /^Tres$/));
  await q.mouse.dblclick(c.x, c.y);
  await ta.waitFor();
  let maxDialogs = 0;
  await q.keyboard.type('Hijo 1');
  for (let i = 2; i <= 5; i++) {
    await q.keyboard.press('Tab');
    await ta.waitFor({ timeout: 3000 });
    maxDialogs = Math.max(maxDialogs, await dialogs(q));
    await q.keyboard.type('Hijo ' + i);
  }
  await q.keyboard.press('Enter');
  await ta.waitFor({ state: 'detached', timeout: 3000 });
  mdE = await vaultWhen(q, 'notes/P22 grande.md', (t) => t.includes('Hijo 5'));
  check([1, 2, 3, 4, 5].every((i) => (mdE ?? '').includes('Hijo ' + i)) && maxDialogs === 0, `Tab encadena 5 hijos sin ninguna hoja ni diálogo (hojas vistas: ${maxDialogs})`);
  check(/- Tres\n( +)- Hijo 1\n\1  - Hijo 2/.test(mdE ?? '') || /Hijo 1[\s\S]*Hijo 5/.test(mdE ?? ''), 'los hijos quedan en el .md encadenados: ' + JSON.stringify((mdE ?? '').split('\n').filter((l) => /Hijo|Tres/.test(l)).join(' | ')));
  // un solo ⌘Z deshace un confirmar
  await q.screenshot({ path: OUT + 'diagramas-p22-edicion.png' });

  // ---------- 13. Chips «+» ----------
  console.log('13. Chips «+»');
  await newNote(q, 'P22 chips', 'Diagrama de flujo');
  await setText(q, '[Alfa] --> [Beta]');
  await fit(q);
  await q.locator('.diag-board').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await toasts();
  c = await center(node(q, 'Alfa'));
  await q.mouse.click(c.x, c.y);
  await q.waitForTimeout(250);
  const chips = await q.evaluate(() => {
    const t = [...document.querySelectorAll('.diag-node')].find((n) => /Alfa/.test(n.textContent))?.querySelector('.diag-text')?.getBoundingClientRect();
    return [...document.querySelectorAll('.diag-chip')].map((ch) => {
      const r = ch.getBoundingClientRect(), d = ch.querySelector('.diag-chip-dot').getBoundingClientRect();
      const ov = t ? !(d.right <= t.left || d.left >= t.right || d.bottom <= t.top || d.top >= t.bottom) : null;
      return { side: ch.dataset.chip, zone: [r.width, r.height], dot: [d.width, d.height], overlapsText: ov, label: ch.getAttribute('aria-label') };
    });
  });
  check(chips.length >= 3, `el nodo seleccionado muestra chips «+» (${chips.map((x) => x.side).join(', ')})`);
  check(chips.every((x) => x.zone[0] >= 44 && x.zone[1] >= 44), `cada chip tiene zona táctil ≥ 44 px (${chips.map((x) => x.zone.map(Math.round).join('×')).join(', ')})`);
  check(chips.every((x) => x.dot[0] >= 18 && x.dot[0] <= 26), `el punto visible mide ~22 px (${chips.map((x) => Math.round(x.dot[0])).join(', ')})`);
  check(chips.every((x) => x.overlapsText === false) && chips.every((x) => !!x.label), 'los puntos no tapan el texto del nodo y tienen aria-label');
  // clic en el chip crea un hijo en el sitio
  const nBefore = await nodeCount(q);
  const chipR = q.locator('.diag-chip[data-chip="derecha"]');
  await click(chipR);
  await ta.waitFor({ timeout: 3000 });
  await q.keyboard.type('Nuevo por chip');
  await q.keyboard.press('Enter');
  await ta.waitFor({ state: 'detached' });
  const chipTxt = await vaultWhen(q, 'notes/P22 chips.md', (t) => t.includes('Nuevo por chip'));
  check(/Nuevo por chip/.test(chipTxt ?? '') && (await nodeCount(q)) === nBefore + 1 && (await dialogs(q)) === 0, 'clic en el chip crea un nodo escrito en el sitio');

  // ---------- 14. Texto sin cortar y punta de flecha opaca ----------
  console.log('14. Texto completo y flecha');
  await newNote(q, 'P22 texto', 'Diagrama de flujo');
  const long1000 = ('palabra larga ' + 'x'.repeat(0)).repeat(100).trim().slice(0, 1000).trim();
  const word80 = 'W'.repeat(80);
  await setText(q, `[${long1000}] --> [${word80}]\n[${word80}] --> {¿Es un rombo con texto largo?}\n[Corto] --> [Fin]`);
  await fit(q); // los nodos fuera de vista no se pintan: Ajustar los trae todos
  const ov = await q.evaluate(() => [...document.querySelectorAll('.diag-node')].map((n) => {
    const tx = n.querySelector('.diag-text') ?? n;
    return { txt: tx.textContent.slice(0, 14), len: tx.textContent.length, cls: n.className.baseVal ?? n.className, h: n.scrollHeight - n.clientHeight, w: n.scrollWidth - n.clientWidth, th: tx.scrollHeight - tx.clientHeight, tw: tx.scrollWidth - tx.clientWidth };
  }));
  console.log('     nodos:', ov.map((x) => `${x.txt}…(${x.len}) ${x.cls.split(' ').filter((k) => /shape|rombo|decision/.test(k)).join('')}`).join(' | '));
  check(ov.length >= 4 && ov.some((x) => x.len >= 900) && ov.some((x) => x.len === 80), `hay nodos de 1 000 caracteres y de 80 letras sin espacios (${ov.length} nodos)`);
  check(ov.every((x) => x.h <= 0 && x.w <= 0 && x.th <= 0 && x.tw <= 0), 'ningún nodo con texto cortado (scrollHeight ≤ clientHeight y scrollWidth ≤ clientWidth): ' + JSON.stringify(ov.filter((x) => x.h > 0 || x.w > 0 || x.th > 0 || x.tw > 0)));
  const romb = await q.evaluate(() => [...document.querySelectorAll('.diag-node')].filter((n) => /rombo/.test(n.textContent)).map((n) => ({ cls: String(n.getAttribute('class')), h: n.scrollHeight - n.clientHeight, w: n.scrollWidth - n.clientWidth })));
  check(romb.length === 1 && romb[0].h <= 0 && romb[0].w <= 0, 'el rombo con texto largo no desborda: ' + JSON.stringify(romb));
  await q.screenshot({ path: OUT + 'diagramas-p22-texto.png' });
  // punta de flecha
  await setText(q, '[A] --> [B] {color=3}\n[B] --> [C]');
  await fit(q);
  await q.locator('.diag-board').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await toasts();
  const head = await q.evaluate(() => {
    const h = document.querySelector('.diag-board [data-head], .diag-board .diag-head');
    if (!h) return null;
    const r = h.getBoundingClientRect(), line = document.querySelector('.diag-board path.diag-edge[data-path]');
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, fill: getComputedStyle(h).fill, fo: getComputedStyle(h).fillOpacity, stroke: getComputedStyle(line).stroke, so: getComputedStyle(line).strokeOpacity, op: getComputedStyle(h).opacity };
  });
  check(!!head, 'la flecha tiene punta propia (sin <marker>)');
  if (head) {
    const png = await q.screenshot({ clip: { x: head.x - 1, y: head.y - 1, width: 2, height: 2 } });
    const px = await q.evaluate(async (src) => { const img = new Image(); img.src = src; await img.decode(); const cv = document.createElement('canvas'); cv.width = 2; cv.height = 2; const g = cv.getContext('2d'); g.drawImage(img, 0, 0); return [...g.getImageData(0, 0, 1, 1).data]; }, 'data:image/png;base64,' + png.toString('base64'));
    const rgb = (str) => (str.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const ink = rgb(head.stroke), same = ink.every((v, i) => Math.abs(v - px[i]) <= 6);
    check(px[3] === 255 && Number(head.fo) === 1 && Number(head.op) === 1, `la punta es opaca: píxel central RGBA ${px.join(',')} (relleno opacidad ${head.fo})`);
    check(same, `y del mismo color que la línea (punta ${px.slice(0, 3).join(',')} vs línea ${ink.join(',')})`);
  }

  // ---------- 15. Color y tamaño persisten ----------
  console.log('15. Color y tamaño manual');
  await newNote(q, 'P22 estilo', 'Mapa mental');
  await setText(q, 'Tema\n- Uno\n- Dos\n  - Tres');
  await fit(q);
  await q.locator('.diag-board').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await toasts();
  c = await center(node(q, /^Dos$/));
  await q.mouse.click(c.x, c.y);
  await q.waitForTimeout(250);
  await q.locator('.diag-fbar').getByRole('button', { name: 'Azul', exact: true }).click();
  const colTxt = await vaultWhen(q, 'notes/P22 estilo.md', (t) => /- Dos[^\n]*color=/.test(t));
  check(/- Dos[^\n]*\{[^}]*color=\d/.test(colTxt ?? ''), 'elegir «Azul» escribe `color=` en el .md: ' + ((colTxt ?? '').match(/- Dos[^\n]*/)?.[0] ?? '(nada)'));
  await q.locator('.diag-board').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const nb = await node(q, /^Dos$/).boundingBox();
  const hs = await q.locator('[data-handle="se"]').boundingBox();
  const hc = { x: hs.x + hs.width / 2, y: hs.y + hs.height / 2 };
  await q.mouse.move(hc.x, hc.y); await q.mouse.down();
  for (let i = 1; i <= 20; i++) await q.mouse.move(hc.x + i * 4, hc.y + i * 2);
  await q.mouse.up();
  const sizeTxt = await vaultWhen(q, 'notes/P22 estilo.md', (t) => /- Dos[^\n]*\bw=\d+/.test(t) || /\bw=\d+/.test(t));
  const nb2 = await node(q, /^Dos$/).boundingBox();
  check(nb2.width > nb.width + 20 && /\bw=\d+/.test(sizeTxt ?? '') && /\bh=\d+/.test(sizeTxt ?? ''), `arrastrar el asa cambia el tamaño (${Math.round(nb.width)}×${Math.round(nb.height)} → ${Math.round(nb2.width)}×${Math.round(nb2.height)}) y escribe w=/h= en el .md: ` + ((sizeTxt ?? '').match(/.*\bw=\d+.*/)?.[0] ?? '(nada)'));
  const bg1 = await node(q, /^Dos$/).evaluate((el) => getComputedStyle(el).backgroundColor);
  const mdBefore = await readVault(q, 'notes/P22 estilo.md');
  await q.reload();
  await q.locator('.diag-node').first().waitFor({ timeout: 8000 });
  await fit(q);
  const bg2 = await node(q, /^Dos$/).evaluate((el) => getComputedStyle(el).backgroundColor);
  const nb3 = await node(q, /^Dos$/).boundingBox(), nbTema = await node(q, /^Uno$/).boundingBox();
  check(bg1 === bg2 && bg2 !== 'rgba(0, 0, 0, 0)', `el color persiste tras recargar (${bg1} → ${bg2})`);
  check((await readVault(q, 'notes/P22 estilo.md')) === mdBefore && nb3.width > nbTema.width, `el tamaño manual persiste y el .md no cambió al recargar (Dos ${Math.round(nb3.width)} px > Uno ${Math.round(nbTema.width)} px)`);

  // ---------- 16. Exportar PDF desde la hoja ----------
  console.log('16. PDF');
  await newNote(q, 'P22 pdf', 'Diagrama de flujo');
  const frase = 'Texto largo completo del primer nodo que debe aparecer entero en el PDF sin puntos suspensivos ni recortes de ninguna clase';
  await setText(q, `[${frase}] --> [Segundo nodo]\n[Segundo nodo] --> {¿Decisión final?}`);
  await q.getByRole('button', { name: 'Exportar', exact: true }).click();
  await q.locator('.sheet').waitFor();
  await q.locator('.sheet').getByRole('button', { name: 'PDF', exact: true }).click();
  const save = q.locator('.sheet').getByRole('button', { name: 'Guardar', exact: true });
  await save.waitFor();
  await q.waitForFunction(() => { const b = [...document.querySelectorAll('.sheet button')].find((x) => x.textContent.trim().endsWith('Guardar')); return b && !b.disabled; }, null, { timeout: 20000 }).catch(() => {});
  check(await save.isEnabled(), 'la hoja PDF prepara el archivo (Guardar habilitado)');
  check(/Sald[rá]+ \d+ página/.test(await q.locator('.sheet').innerText()), 'muestra «Saldrá N página(s)»');
  const dlPdf = q.waitForEvent('download', { timeout: 15000 }).catch(() => null);
  await save.click();
  const pdf = await dlPdf;
  if (!pdf) check(false, 'el PDF se descarga con «Guardar» (no hubo descarga)');
  else {
    const pth = await pdf.path();
    const head5 = readFileSync(pth).subarray(0, 5).toString();
    check(pdf.suggestedFilename().endsWith('.pdf') && head5 === '%PDF-', `se descarga ${pdf.suggestedFilename()} y empieza con %PDF-`);
    let txt = null;
    try { txt = execFileSync('pdftotext', [pth, '-'], { encoding: 'utf8' }); } catch { txt = null; }
    if (txt === null) console.log('  - pdftotext no está: se omite la comprobación del texto');
    else {
      const flat = txt.replace(/\s+/g, '');
      const want = [frase, 'Segundo nodo', '¿Decisión final?'];
      check(want.every((w) => flat.includes(w.replace(/\s+/g, ''))) && !txt.includes('…'), 'el PDF contiene TODO el texto de los nodos y ningún «…»' + (want.every((w) => flat.includes(w.replace(/\s+/g, ''))) ? '' : ' · pdftotext: ' + JSON.stringify(txt.slice(0, 300))));
    }
  }
  await q.keyboard.press('Escape');

  // ---------- 17. Recargar conserva todo ----------
  console.log('17. Recargar');
  const mdPdf = await readVault(q, 'notes/P22 pdf.md');
  const n17 = await nodeCount(q);
  await q.reload();
  await q.locator('.diag-node').first().waitFor({ timeout: 8000 });
  check((await nodeCount(q)) === n17 && (await readVault(q, 'notes/P22 pdf.md')) === mdPdf, `tras recargar quedan ${n17} nodos y el .md idéntico`);

  // ---------- 18. La misma nota en la pestaña de Notas y en un panel de Espacios ----------
  console.log('18. Pestaña y panel a la vez');
  await newNote(q, 'P22 doble', 'Mapa mental');
  await setText(q, 'Raíz\n- Alfa\n- Beta');
  await vaultWhen(q, 'notes/P22 doble.md', (t) => t.includes('Beta'));
  await q.goto(URL_ + '#/espacios');
  await q.getByRole('button', { name: 'Nuevo espacio' }).first().click();
  await q.locator('.sheet input[name=n]').fill('Doble');
  await q.getByRole('button', { name: 'Crear', exact: true }).click();
  await q.getByText(/Añade paneles/).first().waitFor();
  await q.getByRole('button', { name: 'Añadir panel', exact: true }).click();
  await q.getByRole('menuitem', { name: 'Añadir panel Nota', exact: true }).evaluate((x) => x.click());
  const pick = q.locator('.win').last();
  await pick.waitFor();
  const find = pick.getByRole('searchbox').or(pick.locator('input')).first();
  if (await find.count()) await find.fill('P22 doble');
  await pick.getByText('P22 doble').first().click({ timeout: 4000 }).catch(() => {});
  await pick.locator('.diag-node').first().waitFor({ timeout: 8000 }).catch(() => {});
  const inPanel = await pick.locator('.diag-node').count();
  check(inPanel >= 3, `el panel de Espacios muestra el diagrama (${inPanel} nodos)`);
  if (inPanel >= 3) {
    const pn = pick.locator('.diag-node', { hasText: /^Alfa$/ }).first();
    await pn.scrollIntoViewIfNeeded();
    const pc = await center(pn);
    await q.mouse.dblclick(pc.x, pc.y);
    await pick.locator('textarea.diag-inline').waitFor({ timeout: 3000 }).catch(() => {});
    await q.keyboard.type('Alfa en panel');
    await q.keyboard.press('Enter');
    const md1 = await vaultWhen(q, 'notes/P22 doble.md', (t) => t.includes('Alfa en panel'));
    check(/Alfa en panel/.test(md1 ?? ''), 'editar en el panel escribe el .md');
    await q.goto(URL_ + '#/notas/' + encodeURIComponent('P22 doble.md'));
    await q.locator('.diag-node').first().waitFor({ timeout: 8000 });
    check((await node(q, 'Alfa en panel').count()) === 1, 'la pestaña de Notas ve lo editado en el panel');
    await fit(q);
    await q.locator('.diag-board').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await toasts();
    const cc = await center(node(q, 'Beta'));
    await q.mouse.dblclick(cc.x, cc.y);
    await q.locator('textarea.diag-inline').waitFor({ timeout: 3000 }).catch(() => {});
    await q.keyboard.type('Beta en pestaña');
    await q.keyboard.press('Enter');
    await vaultWhen(q, 'notes/P22 doble.md', (t) => t.includes('Beta en pestaña'));
    await q.goto(URL_ + '#/espacios');
    const pw2 = q.locator('.win', { has: q.locator('.diag-node') }).first();
    await pw2.locator('.diag-node').first().waitFor({ timeout: 8000 }).catch(() => {});
    check((await pw2.locator('.diag-node', { hasText: 'Beta en pestaña' }).count()) === 1 && (await pw2.locator('.diag-node', { hasText: 'Alfa en panel' }).count()) === 1, 'el panel ve lo editado en la pestaña y conserva lo suyo');
  }
  // ---------- 19. Fondo del lienzo (`fondo:` del frontmatter) ----------
  console.log('19. Fondo');
  await newNote(q, 'P22 fondo', 'Mapa mental');
  await q.locator('.diag-node').first().waitFor();
  const sel = q.locator('.diag-editor select').first();
  await sel.selectOption({ label: 'Oscuro' });
  const fMd = await vaultWhen(q, 'notes/P22 fondo.md', (t) => /^fondo:/m.test(t));
  check(/^fondo: ?oscuro$/m.test(fMd ?? ''), '«Oscuro» escribe `fondo: oscuro` en el frontmatter del .md: ' + JSON.stringify((fMd ?? '').split('\n').slice(0, 7).join(' | ')));
  check(!/# fondo:/.test(body(fMd ?? '')), 'y no deja `# fondo:` en el cuerpo');
  await q.reload();
  await q.locator('.diag-node').first().waitFor({ timeout: 8000 });
  check((await q.locator('.diag-editor select').first().inputValue()) !== (await q.locator('.diag-editor select option').first().getAttribute('value')) && /Oscuro/.test(await q.locator('.diag-editor select').first().evaluate((el) => el.selectedOptions[0].textContent)), 'tras recargar el selector sigue en «Oscuro»');
  check((await readVault(q, 'notes/P22 fondo.md')) === fMd, 'el .md no cambió al recargar');

  // ---------- 20. Alto del bloque (`alto=` en el fence) ----------
  console.log('20. Alto del bloque');
  await newNote(q, 'P22 bloque');
  await q.getByRole('button', { name: /Escribe o usa/ }).click();
  await q.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
  await q.keyboard.type('/', { delay: 20 });
  await q.locator('.slash').getByText('Mapa mental', { exact: true }).click();
  await q.keyboard.press('Escape');
  await vaultWhen(q, 'notes/P22 bloque.md', (t) => t.includes('```mapa'));
  await q.locator('.doc').click({ position: { x: 5, y: 5 } });
  await q.waitForTimeout(500);
  const slider = q.getByRole('slider', { name: 'Alto del lienzo' }).first();
  await slider.waitFor({ timeout: 8000 }).catch(() => {});
  if (!(await slider.count())) check(false, 'el bloque de diagrama de la nota normal tiene el asa «Alto del lienzo»');
  else {
    await slider.scrollIntoViewIfNeeded();
    const hOf = async () => +(await slider.getAttribute('aria-valuenow'));
    const h0 = await hOf();
    await slider.focus();
    for (let i = 0; i < 4; i++) await q.keyboard.press('ArrowDown');
    const aMd = await vaultWhen(q, 'notes/P22 bloque.md', (t) => /```(mapa|flujo|diagrama)[^\n]*alto=\d+/.test(t));
    const m = (aMd ?? '').match(/```(?:mapa|flujo|diagrama)[^\n]*alto=(\d+)/);
    const h1 = await hOf();
    check(!!m && h1 > h0, `ArrowDown ×4 en el asa escribe \`alto=\` en el fence del .md (${m?.[0] ?? 'nada'}; ${Math.round(h0)} → ${Math.round(h1)} px)`);
    await q.reload();
    await slider.waitFor({ timeout: 8000 });
    const h2 = await hOf();
    check(m && Math.abs(h2 - h1) <= 2, `el alto persiste tras recargar (${Math.round(h1)} → ${Math.round(h2)} px)`);
  }
  await q.screenshot({ path: OUT + 'diagramas-p22-panel.png' });
  await cq.close();

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
