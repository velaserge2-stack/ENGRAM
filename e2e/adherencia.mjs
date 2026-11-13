// Mini prompt: el botón de minimizar del panel «Adherencia» queda en la esquina del panel (también
// en la versión recortada), no tapa los controles y minimizar/restaurar siguen funcionando.
//   npm run build && npm run e2e:adherencia
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4181;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };
const LABEL = process.env.SHOT || 'despues';

/** Rectángulos del panel, de su botón de minimizar y de los controles del encabezado. */
const geo = (page) => page.evaluate(() => {
  const p = document.querySelector('.heat-panel'), mh = p.closest('.mh'), b = mh.querySelector(':scope > .min-btn');
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const ctrls = [...p.querySelectorAll('.panel-h button, .panel-h .seg')].map(R);
  const btn = R(b), pan = R(p);
  const overlap = ctrls.some((c) => c.x < btn.r && btn.x < c.r && c.y < btn.b && btn.y < c.b);
  return { pan, btn, overlap, fit: p.classList.contains('fit') };
});
const inside = (g) => g.btn.x >= g.pan.x && g.btn.r <= g.pan.r && g.btn.y >= g.pan.y && g.btn.b <= g.pan.b;

async function setMode(page, label) {
  await page.goto(URL_ + '#/ajustes');
  await page.locator('.settings').waitFor();
  if (await page.getByRole('button', { name: /Desplegar todo|Tout déplier|Expand all/ }).count()) await page.getByRole('button', { name: /Desplegar todo|Tout déplier|Expand all/ }).click();
  await page.getByRole('group', { name: /Modo del vidrio|Mode du verre|Glass mode/ }).getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(400);
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'es-MX' });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  for (const [modo, label] of [['oscuro', 'Oscuro'], ['claro', 'Claro']]) {
    await setMode(page, label);
    await page.goto(URL_ + '#/hoy');
    const panel = page.locator('.heat-panel');
    await panel.waitFor();
    await panel.scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    for (const version of ['recortada', 'grande']) {
      const g = await geo(page);
      check(g.fit === (version === 'recortada'), `${modo} · versión ${version}`);
      check(inside(g), `${modo} · ${version}: el botón minimizar queda dentro del panel (botón ${Math.round(g.btn.x)}–${Math.round(g.btn.r)}, panel ${Math.round(g.pan.x)}–${Math.round(g.pan.r)})`);
      check(Math.abs(g.pan.r - g.btn.r - 10) <= 1.5 && Math.abs(g.btn.y - g.pan.y - 10) <= 1.5, `${modo} · ${version}: en la esquina superior derecha (a 10 px)`);
      check(!g.overlap && g.btn.h >= 36, `${modo} · ${version}: no tapa los controles del encabezado`);
      await page.locator('.mh:has(> .heat-panel)').screenshot({ path: `${OUT}adherencia-${LABEL}-${modo}-${version}.png` });
      await page.getByRole('button', { name: version === 'recortada' ? 'Ver año completo' : 'Ver solo mi actividad' }).click();
      await page.waitForTimeout(300);
    }
  }
  // minimizar y restaurar (bandeja)
  await page.getByRole('button', { name: 'Minimizar Mapa de adherencia' }).click();
  await page.waitForTimeout(600);
  check(await page.locator('.heat-panel').count() === 0, 'minimizar manda el panel a la bandeja');
  await page.getByRole('button', { name: /Mapa de adherencia/ }).last().click();
  await page.waitForTimeout(600);
  check(await page.locator('.heat-panel').count() === 1 && inside(await geo(page)), 'restaurar lo devuelve con el botón en su esquina');
  // francés: el encabezado se envuelve y el botón sigue sin tapar nada
  await page.goto(URL_ + '#/ajustes/idioma');
  await page.locator('#idioma').getByRole('button', { name: 'Français' }).click();
  await page.waitForTimeout(500);
  await page.goto(URL_ + '#/hoy');
  await page.locator('.heat-panel').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const fr = await geo(page);
  check(inside(fr) && !fr.overlap, `francés: dentro del panel y sin tapar controles (${fr.fit ? 'recortada' : 'grande'})`);
  await page.locator('.mh:has(> .heat-panel)').screenshot({ path: `${OUT}adherencia-${LABEL}-fr.png` });
  if (failed) throw new Error(`${failed} comprobaciones fallaron`);
  console.log('OK');
  await ctx.close();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
