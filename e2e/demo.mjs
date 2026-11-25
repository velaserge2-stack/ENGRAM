// Modo demo (`?demo=1`) dentro de un iframe sandbox="allow-scripts" (origen opaco) + aislamiento como página normal.
//   npm run build && BROWSER=chromium npm run e2e:demo
// Servidor estático propio con Access-Control-Allow-Origin: * (como GitHub Pages; `vite preview` no basta para origen opaco).
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const PORT = Number(process.env.PORT) || 4361;
const ORIGIN = `http://localhost:${PORT}`;
const DIST = new URL('../dist/', import.meta.url).pathname;
const SHOTS = process.env.SHOTS || 'e2e-shots/demo';
mkdirSync(SHOTS, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const PARENT = `<!doctype html><meta charset=utf-8><title>padre</title><style>body{margin:0}</style><iframe id=f sandbox="allow-scripts" src="./?demo=1&lang=es" style="width:100vw;height:100vh;border:0"></iframe>`;
const server = createServer((req, res) => {
  const u = new URL(req.url, ORIGIN);
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (u.pathname === '/__parent.html') return res.writeHead(200, { 'content-type': 'text/html' }).end(PARENT);
  if (u.pathname === '/__blank.html') return res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>blank</title>');
  let p = join(DIST, normalize(u.pathname === '/' ? 'index.html' : u.pathname));
  if (!p.startsWith(DIST) || !existsSync(p) || !statSync(p).isFile()) return res.writeHead(404).end('no');
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
  createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));
let type = pw[process.env.BROWSER || 'chromium'];
const browser = await type.launch();
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };

// lo persistente REAL del origen, visto desde una página sin protecciones
const inspect = async (page) => {
  await page.goto(ORIGIN + '/__blank.html');
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    let opfs = 0; for await (const _ of root.keys()) opfs++;
    return { ls: localStorage.length, ss: sessionStorage.length, idb: (await indexedDB.databases()).length, opfs, caches: (await caches.keys()).length, sw: (await navigator.serviceWorker.getRegistrations()).length };
  });
};
const zero = (s) => Object.values(s).every((n) => n === 0);

try {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await ctx.newPage();
  const errors = [], hosts = new Set();
  const watch = (p) => {
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    p.on('pageerror', (e) => errors.push(String(e)));
    p.on('request', (r) => { if (!/^(data|blob|about):/.test(r.url())) hosts.add(new URL(r.url()).origin); });
  };
  watch(page);

  console.log('— iframe sandbox="allow-scripts" (origen opaco)');
  const before = await inspect(page);
  check(zero(before), 'padre vacío antes ' + JSON.stringify(before));
  const msgs = [];
  await page.exposeFunction('__msg', (m) => msgs.push(m));
  await page.addInitScript(() => addEventListener('message', (e) => e.data && typeof e.data.type === 'string' && window.__msg(e.data)));
  await page.goto(ORIGIN + '/__parent.html');
  for (let i = 0; i < 100 && !msgs.some((m) => m.type === 'engrama-demo:ready'); i++) await page.waitForTimeout(100);
  check(msgs.some((m) => m.type === 'engrama-demo:ready'), 'engrama-demo:ready recibido');
  const fr = page.frames().find((f) => f !== page.mainFrame());
  check(!!fr, 'iframe cargado');
  await fr.waitForSelector('.gx-pill', { timeout: 15000 }).catch(async () => console.log('DBG', errors, await fr.evaluate(() => document.body.innerHTML.slice(0, 300))));
  check(await fr.locator('.gx-pill').isVisible(), 'pastilla de GREX visible');
  check((await fr.locator('.gx-ustrip .gx-u').count()) === 3, 'tira de uso con 3 claves/logos');
  check(await fr.locator('.gx-avatar').isVisible(), 'GREX a la derecha');
  check((await fr.locator('.gx-act.vz').count()) === 0, 'Dictar oculto');
  const go = async (hash) => { await page.evaluate((h) => document.getElementById('f').contentWindow.postMessage({ type: 'engrama-demo:go', hash: h }, '*'), hash); await page.waitForTimeout(900); };
  // mensajes ajenos o fuera de la lista blanca se ignoran
  await page.evaluate(() => document.getElementById('f').contentWindow.postMessage({ type: 'engrama-demo:go', hash: '#/ajustes' }, '*'));
  await page.waitForTimeout(300);
  check(!(await fr.evaluate(() => location.hash)).includes('ajustes'), 'ruta fuera de la lista blanca ignorada');
  const shot = async (n, w, h) => { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(500); await page.screenshot({ path: `${SHOTS}/${n}-${w}.png` }); };
  const routes = [];
  for (const h of ['#/hoy', '#/estudiar', '#/notas', '#/estadisticas', '#/calendario', '#/simulacros']) {
    await go(h);
    check(msgs.some((m) => m.type === 'engrama-demo:route' && m.hash === h) || h === '#/hoy', 'ruta ' + h);
    routes.push(h);
    if (['#/hoy', '#/estudiar', '#/notas', '#/estadisticas'].includes(h)) {
      if (h === '#/estudiar') {
        await fr.locator('.grade.inv').first().click();
        await fr.waitForSelector('.grades .grade:nth-child(4)', { timeout: 5000 });
        check((await fr.locator('.grades .grade').count()) === 4, 'tarjeta de repaso con 4 botones');
      }
      if (h === '#/estadisticas') {
        const n = await fr.locator('main svg rect, main svg path, main svg circle').count();
        check(n > 20, 'estadísticas con datos (' + n + ' marcas)');
        const txt = await fr.locator('main').innerText();
        check(/[1-9]/.test(txt), 'estadísticas con cifras');
      }
      if (h === '#/hoy') {
        const txt = await fr.locator('main').innerText();
        check(/Parcial de Cardiolog/.test(txt), 'Hoy muestra el examen próximo');
      }
      await shot(h.slice(2), 1024, 768);
      await shot(h.slice(2), 390, 844);
      await page.setViewportSize({ width: 1024, height: 768 });
    }
  }
  // asistente: acción rápida → chat → enviar → respuesta guionada + propuesta
  await go('#/hoy');
  await fr.locator('.gx-ib[aria-expanded]').first().click();
  check(await fr.locator('.gx-quick').isVisible(), 'acciones rápidas visibles');
  await page.screenshot({ path: `${SHOTS}/asistente-rapidas.png` });
  await fr.locator('.gx-quick .gx-ib').first().click(); // ⚙ selector
  check((await fr.locator('.gx-quick').innerText()).length > 0 && (await fr.locator('.gx-quick [role=radio], .gx-quick button').count()) > 3, '⚙ selector de claves');
  await page.screenshot({ path: `${SHOTS}/asistente-claves.png` });
  await page.keyboard.press('Escape');
  await fr.locator('.gx-txt').click();
  await fr.locator('textarea').first().fill('Crea 3 tarjetas de ECG');
  await fr.locator('textarea').first().press('Enter');
  const acc = fr.getByRole('button', { name: /Aceptar/ });
  await acc.first().waitFor({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  check(await acc.first().isVisible().catch(() => false), 'turno guionado con propuesta (Aceptar)');
  await page.screenshot({ path: `${SHOTS}/asistente-turno.png` });
  await acc.first().click().catch(() => {});
  await page.waitForTimeout(800);
  const g = await fr.evaluate(() => window.__demoGuard);
  check(!g.storage.some((k) => k.startsWith('engrama.chat.')), 'no tocó engrama.chat.* (accesos: ' + JSON.stringify(g.storage) + ')');
  check(g.net === 0, 'sin intentos de red');
  check(zero(await inspect(page)), 'padre vacío después');
  check(errors.length === 0, '0 errores de consola ' + errors.slice(0, 3).join(' | '));
  check([...hosts].every((h) => h === ORIGIN), 'peticiones solo al servidor propio ' + [...hosts]);

  console.log('— ?demo=1 FUERA de un iframe: la demo NO arranca y no toca datos reales');
  const p2 = await ctx.newPage(); const e2 = [], h2 = new Set();
  p2.on('console', (m) => m.type() === 'error' && e2.push(m.text())); p2.on('pageerror', (e) => e2.push(String(e)));
  p2.on('request', (r) => { if (!/^(data|blob|about):/.test(r.url())) h2.add(new URL(r.url()).origin); });
  // datos «reales» sembrados en el origen antes de abrir la página
  await p2.goto(ORIGIN + '/__blank.html');
  const SEED = JSON.stringify({ v: 1, keys: [{ id: 'real', alias: 'REAL', provider: 'gemini', key: 'AIzaSEED-REAL-0000', status: 'active' }] });
  await p2.evaluate((v) => localStorage.setItem('engrama.chat.keys', v), SEED);
  for (const q of ['?demo=1', '?demo=0', '?demo=1&theme=light&lang=en']) {
    await p2.goto(ORIGIN + '/' + q + '#/hoy');
    await p2.waitForTimeout(1500);
    check((await p2.evaluate(() => typeof window.__demoGuard)) === 'undefined', `${q}: la demo no arrancó fuera de un iframe`);
    check((await p2.locator('.gx-ustrip').count()) === 0 || (await p2.evaluate(() => !!localStorage.getItem('engrama.chat.keys'))), `${q}: sin pastilla de demo con claves falsas`);
    check((await p2.evaluate(() => localStorage.getItem('engrama.chat.keys'))) === SEED, `${q}: la clave real sigue intacta y sin cambios`);
  }
  check(e2.length === 0 && [...h2].every((h) => h === ORIGIN), 'página normal: 0 errores y sin red externa ' + e2.slice(0, 2));
} catch (e) { failed++; console.error(e); }
await browser.close();
server.close();
console.log(failed ? `\n${failed} fallo(s)` : '\nTodo bien');
process.exit(failed ? 1 : 0);
