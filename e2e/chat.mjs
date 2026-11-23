// Asistente · Fase 1b: add-on apagado = sin red ni código del SDK; encendido: añadir clave, Probar conexión
// (respuesta simulada OK y 401 → inválida). Sin red real: page.route simula las APIs.
//   npm run build && BROWSER=chromium npm run e2e:chat
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const PORT = Number(process.env.PORT) || 4195;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };
const SECRET = 'AIzaSyFAKEKEY0123456789abcdefABCD';

try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, locale: 'es-MX' });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  const apiHits = [], js = new Set(), logs = [];
  let mode = 'ok';
  page.on('request', (r) => r.url().endsWith('.js') && js.add(r.url()));
  page.on('console', (m) => logs.push(m.text()));
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  await page.route(/generativelanguage\.googleapis\.com|api\.groq\.com/, (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    apiHits.push(r.request().url());
    if (mode === '401') return r.fulfill({ status: 401, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: { code: 401, message: 'bad key', status: 'UNAUTHENTICATED' } }) });
    return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } }) });
  });
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();

  console.log('Apagado');
  await page.goto(URL_ + '#/ajustes');
  await page.locator('.settings').waitFor();
  await page.waitForTimeout(500);
  check(!(await page.locator('#asistente').count()), 'sin sección «Asistente»');
  check(apiHits.length === 0, 'ninguna petición a los proveedores');
  const sdkLoaded = async () => { for (const u of js) { const t = await (await fetch(u)).text(); if (/x-goog-api-key|APICallError/.test(t)) return true; } return false; };
  check(!(await sdkLoaded()), 'el SDK no se descargó');

  console.log('Encendido');
  if (await page.getByRole('button', { name: 'Desplegar todo' }).count()) await page.getByRole('button', { name: 'Desplegar todo' }).click();
  await page.getByRole('switch', { name: 'Asistente', exact: true }).click();
  const sec = page.locator('#asistente');
  await sec.waitFor();
  await sec.getByRole('button', { name: 'Asistente' }).first().waitFor();
  if ((await sec.getAttribute('class')).includes('open') === false) await sec.locator('.fold-btn').click();
  await sec.getByText('Aún no hay claves.').waitFor();
  check(apiHits.length === 0, 'abrir la sección no hace peticiones');
  await sec.getByLabel('Apodo (opcional)').fill('Mi clave');
  const pass = sec.getByLabel('Clave de API');
  check((await pass.getAttribute('type')) === 'password', 'el campo es de contraseña');
  check((await pass.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) >= 16, 'input ≥ 16 px');
  await pass.fill(SECRET);
  await sec.getByRole('button', { name: 'Mostrar clave' }).click();
  check((await pass.getAttribute('type')) === 'text', 'mostrar clave');
  await sec.getByRole('button', { name: 'Añadir clave' }).click();
  await sec.getByText('••••ABCD').waitFor();
  check(!(await sec.innerText()).includes(SECRET), 'la clave no se muestra completa');

  const ok = sec.getByRole('button', { name: 'Probar conexión' });
  check((await ok.boundingBox()).height >= 44, "botón de prueba ≥ 44 px");
  await ok.click();
  await sec.getByText('Conexión correcta.').waitFor();
  check(apiHits.length === 1, 'Probar conexión = una sola petición');
  check(await sdkLoaded(), 'el SDK se cargó solo al probar');

  mode = '401';
  await sec.getByRole('button', { name: 'Probar conexión' }).click();
  await sec.getByText(/rechazó la clave/).waitFor();
  check((await sec.innerText()).includes('inválida'), 'estado inválida tras 401');
  check(apiHits.length === 2, 'segunda prueba = una petición más');

  // reordenar: segunda clave y subir
  await sec.getByLabel('Apodo (opcional)').fill('Otra');
  await sec.getByLabel('Clave de API').fill('AIzaSyOTHER0123456789abcdefWXYZ');
  await sec.getByRole('button', { name: 'Añadir clave' }).click();
  await sec.getByRole('button', { name: 'Subir prioridad de Otra' }).click();
  const order = await sec.locator('.chat-key [data-user-content]').allInnerTexts();
  check(order.join() === 'Otra,Mi clave', `reordenar con el botón (${order})`);

  // la clave solo vive en localStorage: ni ajustes ni consola
  const st = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory(); const app = await root.getDirectoryHandle('.app');
    return await (await (await app.getFileHandle('settings.json')).getFile()).text().catch(() => '');
  });
  check(!st.includes('AIza') && !logs.some((l) => l.includes('AIza')), 'la clave no está en settings.json ni en la consola');

  console.log('Olvidar');
  await sec.getByRole('button', { name: 'Olvidar claves' }).click(); // confirm → aceptado abajo
} catch (e) {
  failed++;
  console.error(e);
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} FALLO(S)` : '\nOK');
process.exit(failed ? 1 : 0);
