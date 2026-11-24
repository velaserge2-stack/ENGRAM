// Diagramas: la interfaz del editor (barra, flotante, zoom) no se mueve con zoom del lienzo, pellizco, rueda,
// desplazamiento ni teclado. Mide rects antes/después (±1 px). Chromium; capturas en e2e/out/dz-*.png.
//   npm run build && node e2e/diagramas-zoom.mjs   (REPORT=1 solo imprime, sin fallar)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4197;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', ...(process.env.DIST ? ['--outDir', process.env.DIST] : []), '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
process.on('exit', () => server.kill());
const browser = await pw.chromium.launch();
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };
const REPORT = !!process.env.REPORT;
const SHOTS = process.env.SHOTS || '';

const SEL = { tools: '.diag-editor [role=toolbar]:not(.diag-fbar)', fbar: '.diag-fbar', zoom: '.diag-tools', board: '.diag-board', top: '.topbar', zbar: '.diag-zbar' };
const rects = (page) => page.evaluate((SEL) => {
  const o = {};
  for (const [k, s] of Object.entries(SEL)) { const e = document.querySelector(s); if (e) { const r = e.getBoundingClientRect(); o[k] = [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 10) / 10); } }
  const v = window.visualViewport; o.vv = [v.scale, v.offsetLeft, v.offsetTop, v.width, v.height].map((n) => Math.round(n * 100) / 100);
  return o;
}, SEL);
const same = (a, b, keys) => keys.every((k) => !a[k] || (b[k] && a[k].every((n, i) => Math.abs(n - b[k][i]) <= 1)));

async function open(viewport, touch) {
  const ctx = await browser.newContext({ viewport, locale: 'es-MX', serviceWorkers: 'block', hasTouch: !!touch });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.goto(URL_ + '#/notas');
  await page.getByRole('button', { name: 'Nueva nota', exact: true }).first().click();
  const sheet = page.locator('.sheet');
  await sheet.getByLabel('Título').fill('Zoom');
  await sheet.getByRole('group', { name: 'Tipo de nota' }).getByRole('button', { name: 'Mapa mental', exact: true }).click();
  await sheet.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.locator('.diag-node').first().waitFor();
  await page.waitForTimeout(500);
  return { ctx, page };
}
const boardMid = async (page) => { const b = await page.locator('.diag-board').boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const select = async (page) => { await page.evaluate(() => document.querySelector('.diag-editor').scrollIntoView({ block: 'start' })); await page.waitForTimeout(200); const b = await page.locator('.diag-node').first().boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await page.locator('.diag-fbar').waitFor(); await page.waitForTimeout(200); };
const KEYS = ['tools', 'fbar', 'zoom', 'zbar', 'board'];

for (const vp of [{ width: 1024, height: 768 }, { width: 1366, height: 1024 }]) {
  console.log(`== ${vp.width}x${vp.height}`);
  const { ctx, page } = await open(vp, true);
  const cdp = await ctx.newCDPSession(page);
  await select(page);
  const base = await rects(page);
  console.log('  base', JSON.stringify(base));
  const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${OUT}dz-${SHOTS}-${vp.width}-${n}.png` }); };
  await shot('base');

  // 1. zoom del lienzo con ctrl+rueda (0.1 … 3)
  const m = await boardMid(page);
  for (const [name, dy, n] of [['alejar x', 120, 12], ['acercar x', -120, 30]]) {
    await page.mouse.move(m.x, m.y);
    for (let i = 0; i < n; i++) { await page.keyboard.down('Control'); await page.mouse.wheel(0, dy); await page.keyboard.up('Control'); }
    await page.waitForTimeout(150);
    const r = await rects(page);
    check(same(base, r, KEYS) && r.vv[0] === 1, `ctrl+rueda ${name}: interfaz fija y página sin escalar ${JSON.stringify(r.vv)}`);
    if (REPORT && !same(base, r, KEYS)) console.log('   Δ', JSON.stringify(r));
    await shot(name.split(' ')[0]);
  }
  // 2. botones − + Ajustar
  for (const lab of ['Alejar', 'Acercar', 'Ajustar al contenido']) {
    const b = page.getByRole('button', { name: lab, exact: true }).first();
    if (await b.count()) { for (let i = 0; i < 4; i++) await b.click(); }
  }
  check(same(base, await rects(page), KEYS), 'botones − + Ajustar: interfaz fija');
  // 3. zoom de la PÁGINA (pellizco fuera del lienzo): la barra flotante sigue visible y del mismo tamaño en pantalla
  const screen = (r, k) => { const v = r.vv; return r[k] && [(r[k][0] - v[1]) * v[0], (r[k][1] - v[2]) * v[0], r[k][2] * v[0], r[k][3] * v[0]]; };
  const inWin = (q, W, H) => q[0] >= -1 && q[1] >= -1 && q[0] + q[2] <= W + 1 && q[1] + q[3] <= H + 1;
  for (const sc of [1.5, 2, 3]) {
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: sc });
    await page.waitForTimeout(200);
    const r = await rects(page), q = screen(r, 'fbar'), q0 = screen(base, 'fbar');
    console.log(`  zoom de página ${sc}x: fbar en pantalla`, q.map(Math.round), 'ventana', vp.width, vp.height);
    check(inWin(q, vp.width, vp.height), `zoom de página ${sc}x: la barra flotante sigue dentro de la pantalla`);
    check(Math.abs(q[2] - q0[2]) <= 1.5 && Math.abs(q[3] - q0[3]) <= 1.5, `zoom de página ${sc}x: la barra flotante conserva su tamaño en pantalla (${Math.round(q[2])}×${Math.round(q[3])})`);
    await shot('pagezoom' + sc);
  }
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await page.waitForTimeout(200);
  check(same(base, await rects(page), KEYS), 'al volver al 100 % de página todo regresa a su sitio');
  // 4. pellizco táctil sobre el tablero y fuera de él (el sintetizado de Chromium de escritorio no escala la página)
  for (const [name, at] of [['en el tablero', m], ['fuera del tablero', { x: vp.width / 2, y: 12 }]]) {
    await cdp.send('Input.synthesizePinchGesture', { x: at.x, y: at.y, scaleFactor: 2.2, relativeSpeed: 400, gestureSourceType: 'touch' });
    await page.waitForTimeout(250);
    const r = await rects(page);
    check(same(base, r, ['tools', 'fbar', 'zoom', 'zbar']) && r.vv[0] === 1, `pellizco ${name}: barra en su sitio y página sin escalar (vv ${r.vv})`);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  }
  // 5. la barra de herramientas del editor queda visible bajo la barra superior (no tapada) al ponerse el lienzo en su sitio
  check(base.tools[1] >= base.top[1] + base.top[3] - 1, `la barra de herramientas no queda bajo la barra superior (${base.tools[1]} ≥ ${base.top[1] + base.top[3]})`);
  check(base.board[1] + base.board[3] <= vp.height + 1 && base.board[1] + base.board[3] >= vp.height - 40, `el lienzo llena el alto hasta el borde inferior (${Math.round(base.board[1] + base.board[3])} de ${vp.height})`);
  // 6. desplazar la nota (hacia arriba y abajo) no cambia el tamaño de la barra flotante ni la saca de pantalla
  await page.mouse.move(vp.width / 2, 20);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(250);
  const sc = await rects(page);
  check(inWin(sc.fbar, vp.width, vp.height) && same(base, sc, ['fbar', 'zbar']), 'desplazar la nota: barra flotante fija en pantalla');
  await page.mouse.wheel(0, 600);
  // 7. teclado en pantalla simulado (como theme.ts: --kb-inset): la barra flotante sube sobre él
  await page.evaluate(() => { document.documentElement.classList.add('kb-open'); document.documentElement.style.setProperty('--kb-inset', '300px'); });
  await page.waitForTimeout(200);
  const kb = await rects(page);
  check(kb.fbar[1] + kb.fbar[3] <= vp.height - 300 + 1, `con teclado la barra flotante queda sobre él (${Math.round(kb.fbar[1] + kb.fbar[3])} ≤ ${vp.height - 300})`);
  await page.evaluate(() => { document.documentElement.classList.remove('kb-open'); document.documentElement.style.removeProperty('--kb-inset'); });
  await page.waitForTimeout(200);
  check(same(base, await rects(page), ['fbar']), 'al cerrar el teclado la barra flotante regresa a su sitio');
  await ctx.close();
}
await browser.close();
server.kill();
console.log(failed && !REPORT ? `\n${failed} fallos` : '\nOK');
process.exit(failed && !REPORT ? 1 : 0);
