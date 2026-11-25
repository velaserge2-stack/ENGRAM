// Carril V · visor de PDF: sin hojas en blanco al hacer zoom/rotar, buscador sin re-render del visor,
// nota adhesiva sin prompt/confirm nativos, números de página sin solape, scroll continuo sin huecos.
//   npm run build && flock /tmp/e2e.lock node e2e/pdfvisor.mjs     (BROWSER=webkit para WebKit)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const PORT = Number(process.env.PORT) || 4190;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'chromium'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
const SOFT = !!process.env.SOFT; // SOFT=1: medir sin abortar (línea base)
const check = (c, m) => { if (!c) { if (SOFT) return console.log('  ✗', m); throw new Error('FALLÓ: ' + m); } console.log('  ✓', m); };
const errors = [];

// PDF de 90 páginas de tamaño mixto (carta, apaisada, estrecha) y una rotada 90°
const { PDFDocument, StandardFonts, degrees } = require('pdf-lib');
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const SIZES = [[595, 842], [842, 595], [400, 700]];
for (let i = 1; i <= 90; i++) {
  const pg = pdf.addPage(SIZES[i % 3]);
  for (let l = 0; l < 20; l++) pg.drawText(`Pagina ${i} linea ${l + 1}: la fibrilacion auricular no tiene ondas P.`, { x: 40, y: pg.getHeight() - 60 - l * 22, size: 11, font });
  if (i === 5) pg.setRotation(degrees(90));
}
const bytes = Buffer.from(await pdf.save());

let nativeDialogs = 0;
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'es-MX' });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => { nativeDialogs++; void d.accept(); });

/** Páginas visibles en el área de scroll sin lienzo pintado (en blanco). */
const blanks = () => page.evaluate(() => {
  const box = document.querySelector('.pdf-scroll').getBoundingClientRect();
  let vis = 0, blank = 0;
  for (const p of document.querySelectorAll('.pdf-page')) {
    const r = p.getBoundingClientRect();
    if (r.bottom < box.top + 4 || r.top > box.bottom - 4) continue;
    vis++;
    const c = p.querySelector('canvas.page');
    if (!c || c.width === 0) blank++;
  }
  return { vis, blank };
});
const settle = async (ms = 1800) => { await page.waitForTimeout(ms); };
const renders = () => page.evaluate(() => window.__perf.c.viewerRenders ?? 0);

try {
  await page.goto(URL_ + '?app');
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.goto(URL_ + '?app#/pdfs');
  await page.locator('input[type=file][accept*="pdf"]').setInputFiles({ name: 'Mixto 90.pdf', mimeType: 'application/pdf', buffer: bytes });
  await page.locator('.pdf-card').first().waitFor();
  await page.locator('.pdf-card a.pdf-cover').first().click();
  await page.locator('.pdf-page[data-page="1"] canvas.page').waitFor({ timeout: 30000 });

  console.log('Continuo, zoom y rotación');
  await page.getByRole('button', { name: 'Ver continuo' }).click();
  await settle();
  let b = await blanks();
  check(b.vis >= 1 && b.blank === 0, `continuo: ${b.vis} páginas visibles, ${b.blank} en blanco`);

  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Acercar' }).click(); // ráfaga: 3 pasos seguidos
  await settle();
  b = await blanks();
  check(b.blank === 0, `tras acercar en ráfaga: ${b.vis} visibles, ${b.blank} en blanco`);
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Alejar' }).click();
  await settle();
  b = await blanks();
  check(b.blank === 0, `tras alejar en ráfaga: ${b.vis} visibles, ${b.blank} en blanco`);

  // pellizco del lienzo (evento propio): 10 pasos
  await page.evaluate(async () => { const v = document.querySelector('.pdf-viewer'); for (let i = 0; i < 14; i++) { v.dispatchEvent(new CustomEvent('ownzoom', { detail: { f: i < 7 ? 1.06 : 0.95 } })); await new Promise((r) => setTimeout(r, 30)); } });
  await settle();
  b = await blanks();
  check(b.blank === 0, `tras pellizco: ${b.vis} visibles, ${b.blank} en blanco`);

  await page.setViewportSize({ width: 820, height: 1180 }); // girar el iPad
  await settle();
  b = await blanks();
  check(b.blank === 0, `tras girar a vertical: ${b.vis} visibles, ${b.blank} en blanco`);
  await page.setViewportSize({ width: 1180, height: 820 });
  await settle();
  b = await blanks();
  check(b.blank === 0, `tras girar a horizontal: ${b.vis} visibles, ${b.blank} en blanco`);

  console.log('Números de página');
  const overlap = await page.evaluate(() => {
    const ps = [...document.querySelectorAll('.pdf-page')];
    let bad = 0;
    ps.forEach((p, i) => { const f = p.querySelector(':scope > .foot'); const nx = ps[i + 1]; if (!f || !nx) return; if (f.getBoundingClientRect().bottom > nx.getBoundingClientRect().top + 0.5) bad++; });
    return { bad, n: ps.length };
  });
  check(overlap.n > 1 && overlap.bad === 0, `el número de página no se mete en la siguiente (${overlap.n} páginas, ${overlap.bad} solapes)`);

  console.log('Scroll continuo');
  const S = await page.evaluate(() => new Promise((done) => {
    const box = document.querySelector('.pdf-scroll');
    const gaps = [];
    let last = performance.now(), frames = 0, blankFrames = 0;
    const tick = (t) => {
      gaps.push(t - last); last = t; frames++;
      box.scrollTop += 38;
      const br = box.getBoundingClientRect();
      let blank = false;
      for (const p of document.querySelectorAll('.pdf-page')) { const r = p.getBoundingClientRect(); if (r.bottom < br.top + 4 || r.top > br.bottom - 4) continue; const c = p.querySelector('canvas.page'); if (!c || c.width === 0) blank = true; }
      if (blank) blankFrames++;
      if (frames < 240) requestAnimationFrame(tick); else { gaps.sort((a, c) => a - c); done({ p95: Math.round(gaps[Math.floor(gaps.length * 0.95)]), max: Math.round(gaps[gaps.length - 1]), blankFrames, frames }); }
    };
    requestAnimationFrame(tick);
  }));
  console.log('  · scroll 240 cuadros:', JSON.stringify(S));
  await settle();
  b = await blanks();
  check(b.blank === 0, `al detenerse el scroll no queda ninguna hoja en blanco (${b.vis} visibles)`);

  console.log('Buscador');
  const input = page.getByRole('textbox', { name: 'Buscar en el PDF' });
  const r0 = await renders();
  await input.click();
  await input.pressSequentially('fibrilacion', { delay: 25 });
  const r1 = await renders();
  check(r1 === r0, `escribir en el buscador no vuelve a renderizar el visor (${r1 - r0} renders)`);
  const sb = await input.evaluate((e) => e.getBoundingClientRect().height);
  check(sb >= 44, `el campo de búsqueda mide ≥ 44 px (${sb})`);
  await input.press('Enter');
  await page.locator('.pdf-bar .link').first().waitFor({ timeout: 20000 });
  const lh = await page.locator('.pdf-bar .link').first().evaluate((e) => e.getBoundingClientRect().height);
  check(lh >= 44, `los enlaces de aciertos miden ≥ 44 px (${lh})`);

  console.log('Nota adhesiva');
  await page.getByRole('button', { name: 'Ver por página' }).click();
  await settle(800);
  await page.getByRole('button', { name: 'Anotar', exact: true }).click();
  await page.getByRole('button', { name: 'Nota adhesiva' }).click();
  await page.locator('.pdf-page').first().click({ position: { x: 100, y: 120 } });
  const dlg = page.getByRole('dialog', { name: 'Texto de la nota' });
  await dlg.waitFor({ timeout: 5000 });
  await dlg.locator('textarea').fill('repasar fibrilacion');
  await dlg.getByRole('button', { name: 'Guardar' }).click();
  await page.locator('.pdf-sticky').first().waitFor();
  await page.locator('.pdf-sticky-btn').first().click();
  await page.getByRole('button', { name: 'Borrar nota' }).first().click();
  const del = page.getByRole('dialog', { name: 'Borrar nota' });
  await del.waitFor({ timeout: 5000 });
  await del.getByRole('button', { name: 'Borrar' }).click();
  await page.waitForFunction(() => !document.querySelector('.pdf-sticky'));
  check(nativeDialogs === 0, `la nota adhesiva no usa prompt/confirm nativos (${nativeDialogs})`);

  check(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log('\nOK');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
