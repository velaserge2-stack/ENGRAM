// Carril A · Analítica: paneles de Estadísticas (Dominio, Debilidades, Predicción, Olvidos, Confusiones),
// «Objetivos de hoy» y «Sesión adaptativa» en Hoy, y la sesión arrancando en Estudio. Sin red.
//   npm run build && flock /tmp/e2e.lock node e2e/analitica.mjs
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4197;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };

try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, locale: 'es-MX' });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const reqs = [];
  page.on('request', (r) => !r.url().startsWith(URL_) && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && reqs.push(r.url()));
  await page.goto(URL_ + '?app');
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();

  console.log('Hoy');
  const tile = page.locator('section[aria-label="Objetivos de hoy"]');
  await tile.waitFor();
  check(await tile.locator('.kv').count() > 0 || (await tile.innerText()).includes('No quedan'), 'tarjeta «Objetivos de hoy» con filas o vacío explicado');
  const bad = await tile.locator('a.btn, button').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 43.5).length);
  check(bad === 0, 'objetivos táctiles ≥ 44 px en la tarjeta');

  console.log('Estadísticas');
  await page.goto(URL_ + '?app#/estadisticas');
  const dom = page.locator('section', { has: page.getByRole('heading', { name: 'Dominio', level: 2 }) });
  await dom.waitFor();
  await page.locator('section[aria-busy=false]', { has: page.getByRole('heading', { name: 'Dominio', level: 2 }) }).waitFor(); // los paneles calculan diferidos
  for (const h of ['Debilidades', 'Predicción de retención', 'Olvidos', 'Confusiones']) check(await page.getByRole('heading', { name: h, level: 2 }).count() === 1, `panel «${h}»`);
  const tog = dom.locator('button[aria-expanded]').first();
  if (await tog.count()) {
    await tog.focus();
    await page.keyboard.press('ArrowRight');
    check((await tog.getAttribute('aria-expanded')) === 'true', 'el árbol se despliega con →');
    await page.keyboard.press('ArrowLeft');
    check((await tog.getAttribute('aria-expanded')) === 'false', 'el árbol se pliega con ←');
    await page.keyboard.press('ArrowDown');
    check(await page.evaluate(() => document.activeElement?.hasAttribute('data-tn')), '↓ mueve el foco a la fila siguiente');
  } else check(true, 'árbol sin ramas en la bóveda de ejemplo');
  check(!!(await dom.locator('[role=meter]').count()), 'barras de dominio presentes');

  console.log('Sesión adaptativa');
  await page.goto(URL_ + '?app#/hoy');
  await page.locator('section[aria-label="Objetivos de hoy"]').getByRole('link', { name: 'Sesión adaptativa' }).click();
  await page.locator('.study').waitFor();
  check((await page.locator('.study').innerText()).length > 0, 'Estudio abre en modo adaptativo');
  check(reqs.length === 0, 'sin peticiones de red (' + reqs.join(',') + ')');
  await page.screenshot({ path: OUT + 'analitica.png' });
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
