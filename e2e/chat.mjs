// Asistente · Fases 1b y 2: add-on apagado = sin red ni código del SDK; encendido: añadir clave, Probar conexión
// (respuesta simulada OK y 401 → inválida). Sin red real: page.route simula las APIs.
//   npm run build && BROWSER=chromium npm run e2e:chat
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

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
const SHOTS = process.env.SHOTS || 'e2e-shots/chat';
mkdirSync(SHOTS, { recursive: true });
const SECRET = 'AIzaSyFAKEKEY0123456789abcdefABCD';

let page;
try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, locale: 'es-MX' });
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 300)));
  page.on('console', (m) => m.type() === 'error' && console.log('CONERR', m.text().slice(0, 200)));
  page.on('dialog', (d) => d.accept());
  const apiHits = [], genKeys = [], js = new Set(), logs = [];
  let mode = 'ok', lmode = 'ok', lrelease = null;
  const listReqs = [];
  // el «día» de la app empieza a las 4 a. m. (dayKey): restar 4 h para que «20 días» valga a cualquier hora
  const EX_DATE = new Date(Date.now() - 4 * 36e5 + 20 * 864e5).toISOString().slice(0, 10);
  const CREATE = {
    cnota: ['crear_nota', { titulo: 'Nota IA ECG', contenido: 'El ECG registra **12 derivaciones**.\n\n<script>window.__x=1</script><b>x</b>', materia: 'Cardio IA', tema: 'ECG' }],
    cmapa: ['crear_diagrama', { tipo: 'mapa', titulo: 'Mapa IA Arritmias', fuente: 'Arritmias\n- Taquicardias\n  - Fibrilación\n- Bradicardias' }],
    cmalo: ['crear_diagrama', { tipo: 'mapa', titulo: 'Mapa malo', fuente: 'Raíz\n      - salto' }],
    cfecha: ['registrar_examen', { nombre: 'Parcial IA ECG', fecha: EX_DATE, temas: ['ECG IA'] }],
  };
  const hosts = new Set();
  page.on('request', (r) => { /\.(js|css)(\?|$)/.test(r.url()) && js.add(r.url()); try { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol)) hosts.add(u.host); } catch { /* data:, blob: */ } });
  page.on('console', (m) => logs.push(m.text()));
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  // Fase 2: modos del servidor simulado (streaming SSE de Gemini)
  const K1 = 'AIzaSyKEYONE0123456789abcdefAAAA', K2 = 'AIzaSyKEYTWO0123456789abcdefBBBB';
  const toolBodies = [];
  let reply = 'Hola mundo', inflight = 0, maxInflight = 0, release = null;
  const sse = (text) => 'data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, index: 0 }] }) + '\n\n'
    + 'data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '' }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 3, totalTokenCount: 6 } }) + '\n\n';
  const day429 = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel' }] }] } };
  await page.route(/generativelanguage\.googleapis\.com|api\.groq\.com/, async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    apiHits.push(r.request().url());
    if (!/\/models(\?|$)/.test(r.request().url())) genKeys.push({ url: r.request().url(), key: r.request().headers()['x-goog-api-key'] });
    if (/\/models(\?|$)/.test(r.request().url()) && r.request().method() === 'GET') {
      listReqs.push({ url: r.request().url(), key: r.request().headers()['x-goog-api-key'] });
      if (lmode === 'hold') await new Promise((res) => { lrelease = res; });
      if (lmode === '403') return r.fulfill({ status: 403, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'nope' } }) });
      if (lmode === 'empty') return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ models: [] }) });
      const g = (n, m = ['generateContent']) => ({ name: 'models/' + n, supportedGenerationMethods: m });
      return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ models: [g('gemini-2.5-pro'), g('gemini-2.5-flash'), g('text-embedding-004', ['embedContent'])] }) });
    }
    if (mode !== 'ok' && mode !== '401' && mode !== '404') {
      const key = r.request().headers()['x-goog-api-key'];
      inflight++; maxInflight = Math.max(maxInflight, inflight);
      try {
        if (mode === 'hold') await new Promise((res) => { release = res; });
        if (mode === 'tool' || mode === 'toolnone') {
          const done = (r.request().postData() ?? '').includes('functionResponse');
          const fc = { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'buscar_notas', args: { consulta: mode === 'tool' ? 'ECG derivaciones' : 'zzzxqwv' } } }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 3, totalTokenCount: 6 } };
          toolBodies.push(r.request().postData() ?? '');
          if (!done) return await r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: 'data: ' + JSON.stringify(fc) + '\n\n' });
          await new Promise((res) => setTimeout(res, 600));
          return await r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse(mode === 'tool' ? 'El ECG usa 12 derivaciones [[Clase 1 - ECG básico]]. Otra fuente: [[Nota Inventada]] y [PDF: Falso p.3].' : 'No lo encontré en tus notas.') });
        }
        if (mode === 'exam') {
          const done = (r.request().postData() ?? '').includes('functionResponse');
          if (done) return await r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse('Te dejo el examen para revisar.') });
          const cita = '[PDF: Recopilación 1 Parcial Gine 1.pdf p.5]';
          const preguntas = ['C', 'C', 'D', 'A', 'D'].map((c, i) => ({ texto: `Paciente ${20 + i} años con sangrado uterino anormal, ¿manejo inicial? ${cita}`, opciones: ['Observar', 'Legrado', 'ACO', 'Histerectomía', 'Ninguna'], correcta: c, explicacion: `Según la guía ${cita}`, tema: 'Ginecología' }));
          const args = { nombre: examName, minutos: 90, preguntas };
          return await r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: 'data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'crear_examen', args } }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 3, totalTokenCount: 6 } }) + '\n\n' });
        }
        if (mode === 'write' || mode === 'writeno') {
          const done = (r.request().postData() ?? '').includes('functionResponse');
          if (done) return await r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse('Te dejo una propuesta para revisar.') });
          const args = { mazo: 'ECG IA', tarjetas: [{ pregunta: '¿Cuántas derivaciones tiene el ECG?', respuesta: '12' }, { pregunta: '<b>x</b> ¿Eje normal?', respuesta: '-30 a +90' }] };
          return await r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: 'data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'crear_tarjetas', args } }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 3, totalTokenCount: 6 } }) + '\n\n' });
        }
        if (CREATE[mode]) {
          const done = (r.request().postData() ?? '').includes('functionResponse');
          if (done) return await r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse('Te dejo la propuesta para revisar.') });
          const [name, args] = CREATE[mode];
          return await r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: 'data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args } }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 3, totalTokenCount: 6 } }) + '\n\n' });
        }
        if (mode === 'del' || mode === 'delno') {
          const done = (r.request().postData() ?? '').includes('functionResponse');
          if (done) return await r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse('Te dejo la confirmación.') });
          return await r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: 'data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'borrar_mazo', args: { nombre: 'ECG IA' } } }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 3, totalTokenCount: 6 } }) + '\n\n' });
        }
        if (mode === 'empty') return await r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: 'data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [] }, finishReason: 'MAX_TOKENS', index: 0 }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 0, totalTokenCount: 3 } }) + '\n\n' });
        const dead = mode === 'all429' || (mode === 'q1' && key === K1);
        if (dead) return await r.fulfill({ status: 429, headers: CORS, contentType: 'application/json', body: JSON.stringify(day429) });
        return await r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse(reply) });
      } catch { /* petición cancelada */ } finally { inflight--; }
      return;
    }
    if (mode === '404') return r.fulfill({ status: 404, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: { code: 404, message: 'models/gemini-3.5-flash is not found for API version v1beta', status: 'NOT_FOUND' } }) });
    if (mode === '401') return r.fulfill({ status: 401, headers: CORS, contentType: 'application/json', body: JSON.stringify({ error: { code: 401, message: 'bad key', status: 'UNAUTHENTICATED' } }) });
    return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } }) });
  });
  await page.goto(URL_ + '?app');
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();

  console.log('Apagado');
  await page.goto(URL_ + '?app#/ajustes');
  await page.locator('.settings').waitFor();
  await page.waitForTimeout(500);
  check(!(await page.locator('#asistente').count()), 'sin sección «Asistente»');
  check(apiHits.length === 0, 'ninguna petición a los proveedores');
  const sdkLoaded = async () => { for (const u of js) { const t = await (await fetch(u)).text(); if (/APICallError/.test(t)) return true; } return false; };
  check(!(await sdkLoaded()), 'el SDK no se descargó');
  const chatCode = async () => { for (const u of js) { const t = await (await fetch(u)).text(); if (/chat-fab|chat-panel/.test(t)) return true; } return false; };
  check(!(await chatCode()) && !(await page.locator('.chat-fab, .chat-panel').count()), 'apagado: ni botón ni código del panel');
  await page.keyboard.press('Control+Alt+a');
  await page.waitForTimeout(300);
  check(!(await page.locator('.chat-panel').count()), 'apagado: el atajo no abre nada');

  console.log('Encendido');
  if (await page.getByRole('button', { name: 'Desplegar todo' }).count()) await page.getByRole('button', { name: 'Desplegar todo' }).click();
  await page.getByRole('switch', { name: 'Asistente', exact: true }).click();
  const sec = page.locator('#asistente');
  await sec.waitFor();
  await sec.getByRole('button', { name: 'Asistente' }).first().waitFor();
  if ((await sec.getAttribute('class')).includes('open') === false) await sec.locator('.fold-btn').click();
  await sec.getByText('Aún no hay claves.').waitFor();
  check(apiHits.length === 0, 'abrir la sección no hace peticiones');
  const dlg = page.getByRole('dialog', { name: 'Añadir clave' });
  await sec.getByRole('button', { name: 'Añadir clave' }).click();
  await dlg.waitFor();
  check(apiHits.length === 0, 'abrir la hoja no hace peticiones');
  await dlg.getByLabel('Apodo (opcional)').fill('Mi clave');
  const pass = dlg.getByLabel('Clave de API');
  check((await pass.getAttribute('type')) === 'password', 'el campo es de contraseña');
  check((await pass.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) >= 16, 'input ≥ 16 px');
  await pass.fill(SECRET);
  await dlg.getByRole('button', { name: 'Mostrar clave' }).click();
  check((await pass.getAttribute('type')) === 'text', 'mostrar clave');
  await dlg.getByRole('button', { name: 'Añadir clave' }).click();
  await dlg.waitFor({ state: 'detached' });
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

  mode = '404';
  await sec.getByRole('button', { name: 'Probar conexión' }).click();
  await sec.getByText(/El modelo «gemini-flash-latest» no está disponible/).waitFor();
  await sec.getByText('[HTTP 404 · NOT_FOUND] models/gemini-3.5-flash is not found for API version v1beta').waitFor();
  check(!(await sec.innerText()).includes(SECRET), 'el detalle técnico no muestra la clave');
  check((await sec.innerText()).includes('inválida'), 'un 404 de modelo no cambia el estado de la clave (sigue inválida de la prueba 401, no se tocó)');

  await sec.getByText(/Prueba «Ver modelos disponibles»/).waitFor();

  console.log('Ver modelos');
  const ver = sec.getByRole('button', { name: 'Ver modelos disponibles' }).first();
  check((await ver.boundingBox()).height >= 44, 'botón «Ver modelos» ≥ 44 px');
  const before = apiHits.length;
  lmode = 'hold';
  await ver.click();
  await sec.getByText('Consultando modelos…').waitFor();
  check(await sec.getByRole('button', { name: 'Probar conexión' }).first().isDisabled(), 'una sola petición: «Probar» deshabilitado mientras lista');
  lrelease(); lmode = 'ok';
  const lm = sec.locator('.chat-models');
  await lm.getByText('2 modelos disponibles').waitFor();
  check(apiHits.length === before + 1 && listReqs.length === 1, 'Ver modelos = una sola petición');
  check(listReqs[0].key === SECRET && !listReqs[0].url.includes(SECRET) && !/key=/.test(listReqs[0].url), 'la clave va en cabecera, no en la URL');
  const items = await lm.locator('button code').allInnerTexts();
  check(items.join() === 'gemini-2.5-flash,gemini-2.5-pro', `filtrada y ordenada (${items})`);
  check((await lm.locator('button').first().boundingBox()).height >= 44, 'opciones ≥ 44 px');
  check((await lm.innerText()).includes('sugerido') && (await lm.innerText()).includes('Modelo en uso: gemini-flash-latest'), 'sugiere sin fijar');
  await lm.getByRole('button', { name: /gemini-2\.5-flash/ }).click();
  await lm.getByText('Modelo en uso: gemini-2.5-flash').waitFor();
  mode = 'ok';
  await lm.getByRole('button', { name: 'Probar conexión' }).click();
  await sec.getByText('Conexión correcta.').waitFor();
  check(/models\/gemini-2\.5-flash:/.test(apiHits[apiHits.length - 1]), 'la prueba usa el modelo elegido');
  lmode = '403';
  await sec.getByRole('button', { name: 'Ver modelos disponibles' }).first().click();
  await sec.getByText('[HTTP 403 · PERMISSION_DENIED] nope').waitFor();
  lmode = 'empty';
  await sec.getByRole('button', { name: 'Ver modelos disponibles' }).first().click();
  await sec.getByText(/no devolvió modelos de texto/).waitFor();
  lmode = 'ok';

  // reordenar: segunda clave y subir
  await sec.getByRole('button', { name: 'Añadir clave' }).click();
  await dlg.getByLabel('Apodo (opcional)').fill('Otra');
  await dlg.getByLabel('Clave de API').fill('AIzaSyOTHER0123456789abcdefWXYZ');
  await dlg.getByRole('button', { name: 'Añadir clave' }).click();
  await dlg.waitFor({ state: 'detached' });
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
  await page.waitForTimeout(300);

  console.log('Panel');
  mode = 'stream'; apiHits.length = 0;
  const seed = (extra) => page.evaluate(([a, b]) => { localStorage.removeItem('engrama.chat.usage'); localStorage.setItem('engrama.chat.keys', JSON.stringify({ v: 1, keys: [{ id: 'a', alias: 'Uno', provider: 'gemini', key: a, status: 'active' }, { id: 'b', alias: 'Dos', provider: 'gemini', key: b, status: 'active' }] })); }, [K1, K2]);
  await seed();
  await page.goto(URL_ + '?app#/hoy');
  const fab = page.getByRole('button', { name: 'Abrir el asistente' });
  await fab.waitFor();
  const fb = await fab.boundingBox();
  check(fb.width >= 44 && fb.height >= 44, 'botón flotante ≥ 44 px');
  check((await page.locator('.dev-sign').boundingBox()).x < 400 && Math.abs((await page.locator('.gx-pill').boundingBox()).x + 220 - page.viewportSize().width / 2) < 2 && fb.x > page.viewportSize().width / 2, 'la pastilla va al centro (GREX al final), la firma a la izquierda');
  check(!(await page.evaluate(() => document.querySelector('.gx-dock').closest('.glass'))) && (await page.locator('.gx-pill.glass').count()) === 1, 'la barra no está dentro de otro vidrio (una sola pastilla)');
  await fab.click();
  let panel = page.getByRole('dialog', { name: 'Asistente' });
  await panel.waitFor();
  const ta = panel.getByLabel('Escribe tu mensaje');
  check((await ta.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))) >= 16, 'campo de texto ≥ 16 px');
  check(await ta.evaluate((e) => e === document.activeElement), 'el foco queda en el campo');
  let pb = await panel.boundingBox();
  check(pb.width <= 361 && pb.height <= 521 && pb.width >= 300, `compacto ≈ 360×520 (${pb.width}×${pb.height})`);
  check(await page.evaluate(() => document.querySelector('.chat-panel').classList.contains('glass') && document.querySelector('.chat-panel').classList.contains('strong')), 'superficie .glass.strong');
  for (const b of await panel.getByRole('button').all()) { const bb = await b.boundingBox(); if (bb.height < 43.5 || bb.width < 43.5) check(false, 'botón < 44 px: ' + (await b.getAttribute('aria-label'))); }
  const log = panel.getByRole('log');
  check((await log.getAttribute('aria-live')) === 'polite', 'registro con aria-live educado');
  await page.screenshot({ path: `${SHOTS}/1024-compacto-vacio.png` });

  await ta.fill('Hola');
  await ta.press('Enter');
  await log.getByText('Hola mundo').waitFor();
  check((await log.getAttribute('aria-busy')) === 'false', 'aria-busy false al terminar');
  check(apiHits.length === 1 && maxInflight === 1, 'una petición');
  check((await panel.innerText()).includes('Clave: Uno'), 'indica la clave usada (apodo)');

  // alternar tamaño sin perder la conversación; se recuerda
  await panel.getByRole('button', { name: 'Panel grande' }).click();
  await page.waitForTimeout(350);
  pb = await panel.boundingBox();
  check(pb.width > 500 && pb.x > 200, `grande: ancho ${pb.width}, deja libre el borde izquierdo`);
  check((await log.innerText()).includes('Hola mundo'), 'alternar conserva los mensajes');
  await page.screenshot({ path: `${SHOTS}/1024-grande.png` });
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });
  check(await fab.evaluate((e) => e === document.activeElement), 'al cerrar, el foco vuelve al botón');
  await page.keyboard.press('Control+Alt+a');
  await panel.waitFor();
  pb = await panel.boundingBox();
  check(pb.width > 500 && (await panel.getByRole('log').innerText()).includes('Hola mundo'), 'reabrir recuerda el tamaño y la conversación');
  await page.keyboard.press('Control+Alt+e');
  await page.waitForTimeout(350);
  check((await panel.boundingBox()).width <= 361, 'atajo de tamaño → compacto');

  // Markdown seguro
  reply = 'Mira [web](https://example.com) y [mala](javascript:alert(1)) y [nota](#/ajustes) ![](https://evil.test/x.png) <img src=x onerror=alert(1)> **negrita**';
  await ta.fill('md'); await ta.press('Enter');
  await log.locator('strong', { hasText: 'negrita' }).waitFor();
  const ans = await log.locator('.chat-msg.assistant').last();
  check((await ans.locator('img').count()) === 0, 'sin imágenes en las respuestas');
  check((await ans.locator('a[href^="javascript"], a[href^="#"]').count()) === 0, 'sin enlaces javascript: ni internos');
  check((await ans.locator('a[href^="http"]').count()) === 0 && (await ans.innerText()).includes('web (example.com)'), 'enlace externo sin href: texto + dominio');
  check(await ans.evaluate((e) => e.hasAttribute('data-user-content')), 'respuesta con data-user-content');
  reply = 'Hola mundo';

  // Detener y una sola petición en vuelo
  mode = 'hold'; apiHits.length = 0; maxInflight = 0;
  await ta.fill('largo'); await ta.press('Enter');
  const stopBtn = panel.getByRole('button', { name: 'Detener' });
  await stopBtn.waitFor();
  check((await log.getAttribute('aria-busy')) === 'true', 'aria-busy true mientras responde');
  await ta.fill('otro'); await ta.press('Enter');
  await page.waitForTimeout(300);
  check(apiHits.length === 1 && maxInflight === 1, 'un solo request en vuelo');
  await stopBtn.click();
  await panel.getByText('Respuesta detenida.').waitFor();
  await panel.getByRole('button', { name: 'Enviar' }).waitFor();
  check(true, 'Detener cancela y vuelve a Enviar');
  if (release) release();

  // cuota agotada → rota a la segunda clave y avisa
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  await seed();
  mode = 'q1'; apiHits.length = 0;
  await ta.fill('rota'); await ta.press('Enter');
  await log.getByText('Hola mundo').waitFor();
  check(apiHits.length === 2, 'cuota agotada: 2 peticiones (rota una vez)');
  check((await log.innerText()).includes('Cambié a la clave «Dos»'), 'avisa el cambio de clave');
  check((await panel.innerText()).includes('Clave: Dos'), 'indicador muestra la clave nueva');

  // todas agotadas → mensaje + Ir a Ajustes
  mode = 'all429'; await seed();
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  await ta.fill('nada'); await ta.press('Enter');
  await panel.getByText('La cuota de la clave se agotó.').waitFor();
  await panel.getByText('Todas tus claves están agotadas o son inválidas.').waitFor();
  check((await panel.getByRole('progressbar', { name: 'Uso' }).getAttribute('aria-valuenow')) === '100', 'barra de uso visible al 100 %');
  await page.screenshot({ path: `${SHOTS}/1024-error.png` });
  await panel.getByRole('button', { name: 'Ir a Ajustes' }).first().click();
  await panel.waitFor({ state: 'detached' });
  check(page.url().includes('#/ajustes'), '«Ir a Ajustes» navega y cierra el panel');
  await page.goto(URL_ + '?app#/hoy');

  // sin clave
  await page.evaluate(() => localStorage.removeItem('engrama.chat.keys'));
  mode = 'stream';
  await page.keyboard.press('Control+Alt+a');
  await panel.waitFor();
  await panel.getByLabel('Escribe tu mensaje').fill('x'); await panel.getByLabel('Escribe tu mensaje').press('Enter');
  await panel.getByText('Aún no hay una clave. Añade una en Ajustes.').waitFor();
  check(true, 'sin clave: mensaje con código');
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  await panel.getByText('Pregúntame lo que quieras').waitFor();
  check(true, 'Nueva conversación vacía el historial');


  // Fase 3a: herramienta de lectura + cita tocable
  console.log('Herramientas');
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  await seed();
  mode = 'tool'; apiHits.length = 0;
  await ta.fill('¿Cuántas derivaciones tiene el ECG?'); await ta.press('Enter');
  await panel.getByText('Buscando en tus notas…').waitFor();
  check(await panel.locator('[role=status]').filter({ hasText: 'Buscando en tus notas…' }).count() === 1, 'estado «Buscando en tus notas…» con role=status (aria-live)');
  const cite = log.locator('a.chat-cite', { hasText: 'Clase 1 - ECG básico' });
  await cite.waitFor();
  check(apiHits.length === 2, 'pregunta → herramienta → respuesta (2 peticiones)');
  check(toolBodies.some((b) => b.includes('functionResponse') && b.includes('DATOS') && b.includes('Clase 1 - ECG básico')), 'el resultado vuelve al modelo marcado como dato con su fuente');
  check((await cite.boundingBox()).height >= 43.5, 'cita ≥ 44 px');
  check((await log.locator('.chat-cite.off').count()) === 2 && (await log.locator('a.chat-cite').count()) === 1, 'cita sin fuente real (nota y PDF inventados): sin enlace');
  check((await log.locator('.chat-cite.off').first().getAttribute('aria-disabled')) === 'true', 'cita inexistente deshabilitada con aviso');
  check((await log.innerText()).includes('fuente no encontrada'), 'aviso accesible de fuente no encontrada');
  await page.screenshot({ path: `${SHOTS}/1024-cita.png` });
  await cite.click();
  await page.waitForFunction(() => location.hash.startsWith('#/notas/'));
  check(decodeURIComponent(page.url()).includes('#/notas/Cardiología/ECG/Clase 1 - ECG básico.md'), 'clic en la cita abre la nota');
  await page.getByRole('heading', { name: /ECG básico/ }).first().waitFor();
  await page.goto(URL_ + '?app#/hoy');
  if (!(await panel.isVisible())) { await page.keyboard.press('Control+Alt+a'); await panel.waitFor(); }
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  mode = 'toolnone'; toolBodies.length = 0;
  await ta.fill('¿Y esto?'); await ta.press('Enter');
  await log.getByText('No lo encontré en tus notas.').waitFor();
  check((await log.locator('a.chat-cite').count()) === 0, 'sin resultados: «No lo encontré en tus notas» y sin citas');
  await page.goto(URL_ + '?app#/hoy');
  if (!(await panel.isVisible())) { await page.keyboard.press('Control+Alt+a'); await panel.waitFor(); }
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  // Fase 3b: escritura con vista previa
  console.log('Escritura');
  const examName = 'Simulacro 1 Parcial Ginecología';
  const deckText = () => page.evaluate(async () => { try { let d = await navigator.storage.getDirectory(); for (const part of ['decks']) d = await d.getDirectoryHandle(part); return await (await (await d.getFileHandle('ECG IA.md')).getFile()).text(); } catch { return null; } });
  const appText = () => page.evaluate(() => document.querySelector('#app')?.innerText ?? '');
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  mode = 'empty'; apiHits.length = 0;
  await ta.fill('Crea un examen de 20 preguntas'); await ta.press('Enter');
  const retry = panel.getByRole('button', { name: 'Reintentar' });
  await retry.waitFor();
  check((await panel.locator('.chat-err').innerText()).includes('no devolvió una respuesta') && (await panel.locator('.chat-err code').count()) === 1, 'respuesta vacía: mensaje de error con motivo, nunca silencio');
  mode = 'reply'; const hits0 = apiHits.length;
  await retry.click();
  await panel.getByText(reply, { exact: false }).first().waitFor();
  check(apiHits.length > hits0, 'Reintentar reenvía el último mensaje');
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  mode = 'writeno'; apiHits.length = 0;
  await ta.fill('¿Cuántas derivaciones tiene el ECG?'); await ta.press('Enter');
  await panel.getByText('Te dejo una propuesta').waitFor().catch(() => {});
  await page.waitForTimeout(600);
  check((await panel.locator('.chat-pv').count()) === 0, 'el modelo intenta escribir sin que se lo pidan: no hay vista previa');
  check((await deckText()) === null, 'y no se escribió nada');
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  mode = 'write';
  await ta.fill('Crea tarjetas de mi nota Clase 1 - ECG básico'); await ta.press('Enter');
  const pv = panel.locator('.chat-pv');
  await pv.waitFor();
  check((await pv.locator('li').count()) === 2 && (await pv.innerText()).includes('<b>x</b>') && (await pv.locator('b, script, img').count()) === 1, 'vista previa: 2 tarjetas, HTML escapado como texto');
  check((await deckText()) === null, 'proponer no escribe');
  for (const n of ['Aceptar', 'Editar', 'Cancelar']) check((await pv.getByRole('button', { name: n }).boundingBox()).height >= 43.5, `«${n}» ≥ 44 px`);
  await page.screenshot({ path: `${SHOTS}/1024-vista-previa.png` });
  await pv.getByRole('button', { name: 'Cancelar' }).click();
  await pv.getByText('Propuesta cancelada').waitFor();
  check((await deckText()) === null, 'Cancelar: no se escribió nada');
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  await ta.fill('Crea tarjetas de mi nota Clase 1 - ECG básico'); await ta.press('Enter');
  await pv.waitFor();
  await pv.getByRole('button', { name: 'Editar' }).click();
  const area = pv.getByRole('textbox');
  await area.fill('texto sin formato');
  await pv.getByRole('button', { name: 'Revisar' }).click();
  check(await pv.getByRole('alert').isVisible(), 'Editar: texto inválido muestra error y no avanza');
  await area.fill('Q:: ¿Derivaciones del ECG?\nA:: 12 <!-- origen: usuario -->');
  await pv.getByRole('button', { name: 'Revisar' }).click();
  await pv.getByRole('button', { name: 'Aceptar' }).waitFor();
  check((await pv.locator('li').count()) === 1, 'Editar: revalidada, queda 1 tarjeta');
  await pv.getByRole('button', { name: 'Aceptar' }).dblclick();
  await pv.getByRole('button', { name: 'Deshacer' }).waitFor();
  const saved = await deckText();
  check(saved !== null && (saved.match(/^Q::/gm) ?? []).length === 1 && saved.includes('<!-- origen: ia -->') && !saved.includes('usuario'), 'Aceptar (doble clic): una sola escritura, con origen: ia');
  await page.evaluate(() => { location.hash = '#/mazos'; });
  await page.waitForFunction(() => document.querySelector('#app')?.innerText.includes('ECG IA'));
  check((await appText()).includes('ECG IA'), 'el mazo aparece en Mazos');
  await pv.getByRole('button', { name: 'Deshacer' }).click();
  await pv.getByText(/Deshecho/).waitFor();
  check(((await deckText()) ?? '').trim() === '---\ndeck: ECG IA\ntags: []\n---' || !/^Q::/m.test((await deckText()) ?? ''), 'Deshacer: las tarjetas ya no están');
  // Examen propuesto por el Asistente: carpeta exams-bank/ nueva, Aceptar, aparece en Simulacros, nombre repetido
  console.log('Examen');
  const bankText = () => page.evaluate(async (n) => { try { let d = await navigator.storage.getDirectory(); d = await d.getDirectoryHandle('exams-bank'); return await (await (await d.getFileHandle(encodeURIComponent(n) + '.md')).getFile()).text(); } catch { return null; } }, examName);
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  mode = 'exam';
  await ta.fill('Crea un examen de 5 preguntas de mis PDFs'); await ta.press('Enter');
  await pv.waitFor();
  check((await pv.locator('li').count()) === 5 && (await bankText()) === null, 'examen: vista previa con 5 preguntas, proponer no escribe');
  await pv.getByRole('button', { name: 'Aceptar' }).click();
  await Promise.race([pv.getByRole('button', { name: 'Deshacer' }).waitFor(), pv.locator('.chat-pv-err').waitFor()]);
  const eb = await bankText();
  check(eb !== null && (eb.match(/^origen: ia$/gm) ?? []).length === 1 && eb.includes('[PDF: Recopilación 1 Parcial Gine 1.pdf p.5]'), 'examen: Aceptar escribe exams-bank/ (carpeta nueva) con origen: ia' + (await pv.locator('.chat-pv-err').allInnerTexts()).join('|'));
  await page.evaluate(() => { location.hash = '#/simulacros'; });
  await page.waitForFunction((n) => document.querySelector('#app')?.innerText.includes(n), examName);
  check(true, 'examen: aparece en Simulacros');
  await page.evaluate(() => { location.hash = '#/'; });
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  await ta.fill('Crea un examen de 5 preguntas de mis PDFs'); await ta.press('Enter');
  await pv.waitFor();
  await pv.getByRole('button', { name: 'Aceptar' }).click();
  await pv.getByText('Ya existe un archivo').waitFor();
  check(true, 'examen: nombre repetido → «Ya existe un archivo»');
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  mode = 'stream';

  // Crear notas, diagramas y registrar exámenes (propuesta → Aceptar)
  console.log('Crear');
  const fileText = (path) => page.evaluate(async (pth) => { try { const parts = pth.split('/'); let d = await navigator.storage.getDirectory(); for (const x of parts.slice(0, -1)) d = await d.getDirectoryHandle(encodeURIComponent(x).replace(/%20/g, ' ')); return await (await (await d.getFileHandle(encodeURIComponent(parts.at(-1)).replace(/%20/g, ' '))).getFile()).text(); } catch { return null; } }, path);
  const fresh = async () => { await panel.getByRole('button', { name: 'Nueva conversación' }).click(); };
  await fresh();
  mode = 'write'; // el mazo «ECG IA» existe para el examen con fecha
  await ta.fill('Crea tarjetas de mi nota Clase 1 - ECG básico'); await ta.press('Enter');
  { const w = panel.locator('.chat-pv'); await w.getByRole('button', { name: 'Aceptar' }).click(); await w.getByRole('button', { name: 'Deshacer' }).waitFor(); }
  await fresh();
  mode = 'cnota';
  await ta.fill('Crea una nota de ECG'); await ta.press('Enter');
  await pv.waitFor();
  check((await pv.innerText()).includes('notes/Cardio IA/ECG/Nota IA ECG.md') && (await pv.locator('.chat-pv-md strong').count()) === 1 && (await pv.locator('.chat-pv-md script').count()) === 0 && !(await page.evaluate(() => window.__x)), 'nota: vista previa con la ruta y el Markdown (sin script)');
  check((await fileText('notes/Cardio IA/ECG/Nota IA ECG.md')) === null, 'nota: proponer no escribe');
  for (const n of ['Aceptar', 'Editar', 'Cancelar']) check((await pv.getByRole('button', { name: n }).boundingBox()).height >= 43.5, `nota: «${n}» ≥ 44 px`);
  check((await pv.getAttribute('aria-live')) === 'polite', 'nota: aria-live');
  await pv.getByRole('button', { name: 'Aceptar' }).click();
  await pv.getByRole('button', { name: 'Deshacer' }).waitFor();
  check(/origen: ia/.test((await fileText('notes/Cardio IA/ECG/Nota IA ECG.md')) ?? ''), 'nota: Aceptar escribe con origen: ia');
  await page.evaluate(() => { location.hash = '#/notas'; });
  await page.waitForFunction(() => document.querySelector('#app')?.innerText.includes('Nota IA ECG'));
  check(true, 'nota: aparece en Notas');
  await pv.getByRole('button', { name: 'Deshacer' }).click();
  await pv.getByText(/papelera de notas/).waitFor();
  check((await fileText('notes/Cardio IA/ECG/Nota IA ECG.md')) === null, 'nota: Deshacer la manda a la papelera de notas');
  await fresh();
  mode = 'cmalo';
  await ta.fill('Haz un mapa mental de arritmias'); await ta.press('Enter');
  await panel.getByText('Te dejo la propuesta').waitFor().catch(() => {});
  check((await panel.locator('.chat-pv').count()) === 0, 'diagrama inválido: sin vista previa (el modelo recibe el error)');
  await fresh();
  mode = 'cmapa';
  await ta.fill('Haz un mapa mental de arritmias'); await ta.press('Enter');
  await pv.waitFor();
  await pv.locator('.chat-pv-diag .diag-node').first().waitFor();
  check((await pv.locator('.chat-pv-diag .diag-node').count()) >= 4 && (await fileText('notes/Mapa IA Arritmias.md')) === null, 'mapa: vista previa del diagrama (4 nodos), no escribe');
  await pv.getByRole('button', { name: 'Aceptar' }).click();
  await pv.getByRole('button', { name: 'Deshacer' }).waitFor();
  check(/tipo: mapa/.test((await fileText('notes/Mapa IA Arritmias.md')) ?? ''), 'mapa: Aceptar escribe con tipo: mapa');
  await page.evaluate(() => { location.hash = '#/notas/' + encodeURIComponent('Mapa IA Arritmias.md'); });
  await page.locator('#app .diag-node', { hasText: 'Fibrilación' }).first().waitFor();
  check(true, 'mapa: abre como mapa en Notas');
  await fresh();
  mode = 'cfecha';
  await ta.fill(`Registra mi examen Parcial IA ECG el ${EX_DATE}`); await ta.press('Enter');
  await pv.waitFor();
  check((await pv.innerText()).includes('Parcial IA ECG') && (await pv.innerText()).includes(EX_DATE) && (await pv.innerText()).includes('20 días') && (await fileText('exams/Parcial IA ECG.md')) === null, 'examen con fecha: vista previa legible, no escribe');
  await pv.getByRole('button', { name: 'Aceptar' }).click();
  await pv.getByRole('button', { name: 'Deshacer' }).waitFor();
  check(/origen: ia/.test((await fileText('exams/Parcial IA ECG.md')) ?? ''), 'examen con fecha: Aceptar escribe exams/ con origen: ia');
  await page.evaluate(() => { location.hash = '#/estadisticas'; });
  await page.waitForFunction(() => document.querySelector('#app')?.innerText.includes('Parcial IA ECG'));
  check(true, 'examen con fecha: aparece en Exámenes');
  await fresh();
  await ta.fill(`Registra mi examen Parcial IA ECG el ${EX_DATE}`); await ta.press('Enter');
  await panel.getByText('Te dejo la propuesta').waitFor().catch(() => {});
  check((await panel.locator('.chat-pv').count()) === 0 && (await fileText('exams/Parcial IA ECG.md')) !== null, 'examen con fecha repetido: no se propone y no se pisa');
  await page.evaluate(() => { location.hash = '#/'; });
  await fresh();
  mode = 'stream';

  // Borrar desde el Asistente = papelera + confirmación
  console.log('Borrar');
  const inTrash = () => page.evaluate(async () => { try { let d = await navigator.storage.getDirectory(); for (const part of ['.app', 'papelera-mazos']) d = await d.getDirectoryHandle(part); let n = 0; for await (const k of d.keys()) n++; return n; } catch { return 0; } });
  const deckThere = async () => (await deckText()) !== null;
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  mode = 'write'; // un mazo con tarjetas reales que borrar
  await ta.fill('Crea tarjetas de mi nota Clase 1 - ECG básico'); await ta.press('Enter');
  { const w = panel.locator('.chat-pv'); await w.getByRole('button', { name: 'Aceptar' }).click(); await w.getByRole('button', { name: 'Deshacer' }).waitFor(); }
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  mode = 'delno';
  await ta.fill('¿Cuántas derivaciones tiene el ECG?'); await ta.press('Enter');
  await panel.getByText('Te dejo la confirmación').waitFor().catch(() => {});
  await page.waitForTimeout(600);
  check((await panel.locator('.chat-dl').count()) === 0 && (await deckThere()), 'el modelo intenta borrar sin petición: no hay tarjeta y no se tocó nada');
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  mode = 'del';
  await ta.fill('Borra el mazo ECG IA'); await ta.press('Enter');
  const dl = panel.locator('.chat-dl');
  await dl.waitFor();
  check((await dl.innerText()).includes('Confirmar borrado') && (await dl.innerText()).includes('papelera'), 'tarjeta «Confirmar borrado»');
  check(await dl.getByRole('button', { name: 'Cancelar' }).evaluate((b) => document.activeElement === b), 'el foco inicial está en «Cancelar»');
  for (const n of ['Mover a la papelera', 'Cancelar']) check((await dl.getByRole('button', { name: n }).boundingBox()).height >= 43.5, `«${n}» ≥ 44 px`);
  check((await deckThere()) && (await inTrash()) === 0, 'proponer no cambia nada');
  await dl.getByRole('button', { name: 'Cancelar' }).click();
  await dl.getByText(/Cancelado/).waitFor();
  check((await deckThere()) && (await inTrash()) === 0, 'Cancelar no borra');
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  await ta.fill('Borra el mazo ECG IA'); await ta.press('Enter');
  await dl.waitFor();
  await dl.getByRole('button', { name: 'Mover a la papelera' }).dblclick();
  await dl.getByRole('button', { name: 'Deshacer' }).waitFor();
  check(!(await deckThere()) && (await inTrash()) === 1, 'confirmar: el mazo está en la papelera de mazos (una vez)');
  await dl.getByRole('button', { name: 'Deshacer' }).click();
  await dl.getByText('Restaurado.').waitFor();
  check((await deckThere()) && (await inTrash()) === 0, 'Deshacer: el mazo vuelve y la papelera queda vacía');
  // panel grande: no tapa la firma ni la barra
  await page.keyboard.press('Escape');
  const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  await fab.click(); await panel.waitFor(); await page.waitForTimeout(400);
  await panel.getByRole('button', { name: /Panel grande|Panel compacto/ }).click();
  await page.waitForTimeout(350);
  if ((await panel.boundingBox()).width < 500) { await panel.getByRole('button', { name: 'Panel grande' }).click(); await page.waitForTimeout(350); }
  check(!hit(await panel.boundingBox(), await page.locator('.dev-sign').boundingBox()), 'el panel grande no tapa la firma');
  check((await page.locator('.gx-dock, .gx-mini, .chat-fab').count()) === 0, 'con el chat abierto no existe ni la pastilla ni la mascota (solo el chat)');
  { const bar = await page.locator('.topbar').boundingBox(), pg = await panel.boundingBox();
    check(pg.y >= bar.y + bar.height - 1 && pg.y + pg.height <= page.viewportSize().height, 'el chat grande queda bajo la barra superior y dentro de la pantalla'); }
  await page.screenshot({ path: `${SHOTS}/1024-grande-dock.png` });
  await panel.getByRole('button', { name: 'Panel compacto' }).click();
  await page.waitForTimeout(350);

  // ───── GREX: barra, atajos, minimizar, posición estable ─────
  console.log('GREX · barra');
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });
  await page.evaluate(() => { const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); localStorage.setItem('engrama.chat.usage', JSON.stringify({ v: 1, perKey: { a: { day: d, req: 230, tok: 0, min: { t: 0, req: 0, tok: 0 } } } })); });
  await page.goto(URL_ + '?app#/hoy');
  const dock = page.locator('.gx-dock');
  await dock.waitFor();
  { const tx = await dock.innerText();
    check(tx.includes('GREX') && tx.includes('Toca para escribir') && !tx.includes('Acciones rápidas'), 'pastilla en reposo: «GREX» + «Toca para escribir», sin pestaña de acciones rápidas'); }
  { const pb = await page.locator('.gx-pill').boundingBox();
    check(pb.width <= 440.5 && pb.height <= 56.5, `pastilla ≤ 440×56 (${Math.round(pb.width)}×${Math.round(pb.height)})`); }
  // uso: tira «unida» bajo la pastilla (no dentro de ella); la pastilla queda a 16 px del borde inferior
  { const st = page.locator('.gx-ustrip'), pb = await page.locator('.gx-pill').boundingBox(), sb = await st.boundingBox(), vh = page.viewportSize().height;
    check((await st.count()) === 1 && (await st.getAttribute('role')) === 'status' && (await st.getAttribute('aria-label')) === 'Uso por modelo', 'tira de uso: role=status y «Uso por modelo»');
    check((await page.locator('.gx-pill .gx-u, .gx-pill .gx-ustrip').count()) === 0 && !(await page.locator('.gx-pill').innerText()).includes('%'), 'el uso ya no está dentro de la pastilla');
    check(sb.height <= 36.5 && sb.width <= pb.width && sb.x >= pb.x - 1 && sb.x + sb.width <= pb.x + pb.width + 1, `tira ≤ 36 px y dentro del ancho de la pastilla (${Math.round(sb.width)}×${Math.round(sb.height)})`);
    check(Math.abs(vh - (pb.y + pb.height) - 16) <= 1, `la pastilla queda a 16 px del borde inferior (${Math.round(vh - pb.y - pb.height)})`);
    check((await page.locator('.gx-ustrip .gx-u').count()) === 2 && (await page.locator('.gx-ustrip .gx-u.on').count()) === 1, 'una entrada por clave, una activa');
    const hot = page.locator('.gx-ustrip .gx-u.hot');
    check((await hot.count()) === 1 && /casi al límite/.test(await hot.getAttribute('aria-label')), '≥ 80 %: «casi al límite» solo como etiqueta');
    const [fw, hh, hn] = await Promise.all([page.locator('.gx-ustrip .gx-u.on').evaluate((e) => +getComputedStyle(e).fontWeight), hot.locator('.gx-bar').evaluate((e) => e.getBoundingClientRect().height), page.locator('.gx-ustrip .gx-u:not(.hot) .gx-bar').evaluate((e) => e.getBoundingClientRect().height)]);
    check(fw >= 700 && hh > hn, `activa en Bold; ≥ 80 % con barra más gruesa (${fw}, ${hh} > ${hn})`);
    check((await st.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)), 'la tira no desborda a 440 de ancho'); 
    check(await page.evaluate(() => /mono|Menlo|ui-monospace/i.test(getComputedStyle(document.querySelector('.gx-ustrip .gx-pc')).fontFamily)), 'el % de la tira va en monoespaciada');
    check((await page.locator('.gx-ustrip svg.prov-logo').count()) === 2 && (await page.locator('.gx-ustrip [data-provider="gemini"] svg path').count()) > 0, 'logos por proveedor en la tira (decorativos)');
  }
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.gx-ttl')).fontFamily.includes('Helvetica Neue')), 'tipografía Helvetica Neue');
  // «Escribir» abre el chat y SOLO el chat (la pastilla sale del DOM); no envía nada
  const hitsBefore = apiHits.length;
  check((await dock.getByRole('button', { name: 'Escribir', exact: true }).count()) === 0, 'sin botón «Escribir»: se toca el texto o a GREX');
  await dock.locator('.gx-txt').click();
  panel = page.getByRole('dialog', { name: 'Asistente' });
  await panel.waitFor();
  check((await page.locator('.gx-dock, .gx-mini, .chat-fab, .gx-ustrip').count()) === 0 && (await page.locator('.chat-panel').count()) === 1, 'tocar el texto: solo existe el chat (sin pastilla, tira ni mascota)');
  check(await panel.getByLabel('Escribe tu mensaje').evaluate((e) => e === document.activeElement) && apiHits.length === hitsBefore, 'el foco va al campo y no se envía nada');
  check((await panel.locator('h2').innerText()) === 'GREX', 'título del asistente: GREX');
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });
  await dock.waitFor();
  check((await page.locator('.gx-avatar').evaluate((e) => e === document.activeElement)) && (await page.locator('.gx-mini').count()) === 0, 'cerrar: vuelve la pastilla (reposo) con el foco en GREX');

  // trabajando: estado + Detener en la barra
  mode = 'hold'; apiHits.length = 0;
  await page.locator('.gx-avatar').click();
  await panel.waitFor();
  await panel.getByLabel('Escribe tu mensaje').fill('espera');
  await panel.getByLabel('Escribe tu mensaje').press('Enter');
  await page.keyboard.press('Escape'); await panel.waitFor({ state: 'detached' });
  await page.locator('.gx-dock.work').waitFor();
  check((await dock.innerText()).includes('Pensando') && (await dock.getByRole('button', { name: 'Detener' }).count()) === 1, 'trabajando: «Pensando…» y botón «Detener» en la barra');
  await dock.getByRole('button', { name: 'Detener' }).click();
  await page.locator('.gx-dock.work').waitFor({ state: 'detached' });
  if (release) release();
  check((await dock.innerText()).includes('Toca para escribir'), 'Detener desde la barra: vuelve al reposo');
  { const pb = await page.locator('.gx-pill').boundingBox(); check(pb.width <= 440.5 && pb.height <= 56.5, 'trabajando: la pastilla no crece'); }
  mode = 'stream';

  // posición estable: abrir teclado simulado y abrir/cerrar el panel no mueven la barra (≤ 1 px)
  const rect = () => dock.evaluate((e) => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
  const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 1);
  const r0 = await rect();
  await page.locator('.gx-avatar').click(); await panel.waitFor(); await page.waitForTimeout(400);
  await page.keyboard.press('Escape'); await panel.waitFor({ state: 'detached' }); await dock.waitFor();
  const r1 = await rect();
  await page.evaluate(() => { document.documentElement.classList.add('kb-open'); document.documentElement.style.setProperty('--kb-inset', '320px'); });
  await page.waitForTimeout(150);
  const r2 = await rect();
  check((await dock.evaluate((e) => getComputedStyle(e).visibility)) === 'hidden', 'con el teclado abierto la barra se oculta (no estorba el campo)');
  await page.evaluate(() => { document.documentElement.classList.remove('kb-open'); document.documentElement.style.removeProperty('--kb-inset'); });
  await page.waitForTimeout(150);
  const r3 = await rect();
  check(same(r0, r1) && same(r0, r2) && same(r0, r3), `posición estable ≤ 1 px: ${r0.map(Math.round)} / ${r1.map(Math.round)} / ${r2.map(Math.round)} / ${r3.map(Math.round)}`);

  // minimizar a la mascota (abajo a la derecha), persistencia y restaurar
  await dock.getByRole('button', { name: 'Minimizar a la mascota' }).click();
  const mini = page.locator('.gx-mini');
  await mini.waitFor();
  check((await dock.count()) === 0, 'minimizada: la barra desaparece');
  check(await mini.evaluate((e) => e === document.activeElement), 'minimizar: el foco pasa a la mascota');
  { const m = await mini.boundingBox(), vw = page.viewportSize().width, vh = page.viewportSize().height;
    check(Math.abs(m.width - 56) <= 1 && Math.abs(m.height - 56) <= 1 && Math.abs(vw - (m.x + m.width) - 16) <= 1 && Math.abs(vh - (m.y + m.height) - 16) <= 1, `GREX minimizada abajo a la derecha (${Math.round(m.x)},${Math.round(m.y)} ${m.width}×${m.height})`); }
  await page.waitForTimeout(600);
  await page.goto(URL_ + '?app#/hoy');
  await page.locator('.gx-mini').waitFor();
  check((await page.locator('.gx-dock').count()) === 0, 'minimizar persiste (settings.chat.dock = mascota)');
  await page.setViewportSize({ width: 1024, height: 768 }); await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}/1024-mascota.png` });
  await page.locator('.gx-mini').click();
  await dock.waitFor();
  check(await page.locator('.gx-avatar').evaluate((e) => e === document.activeElement), 'restaurar: el foco pasa a la barra');
  await page.waitForTimeout(600);
  await page.goto(URL_ + '?app#/hoy');
  await dock.waitFor();
  check((await page.locator('.gx-mini').count()) === 0, 'restaurar persiste (barra)');


  // ───── Acciones rápidas (pestaña sobre la pastilla) ─────
  console.log('GREX · acciones rápidas');
  await page.goto(URL_ + '?app#/hoy'); await page.reload(); await dock.waitFor();
  { await page.mouse.move(5, 5); await page.waitForTimeout(300);
    const q = page.locator('.gx-quick'), pb = await page.locator('.gx-pill').boundingBox();
    check((await q.evaluate((e) => getComputedStyle(e).opacity)) === '0', 'acciones: ocultas en reposo');
    await page.locator('.gx-pill').hover(); await page.waitForTimeout(350);
    const qb = await q.boundingBox();
    check((await q.evaluate((e) => getComputedStyle(e).opacity)) === '1', 'acciones: aparecen con el cursor');
    check(Math.abs(qb.width - pb.width) <= 1 && Math.abs(pb.y - (qb.y + qb.height) - 8) <= 1, `acciones: mismo ancho que la pastilla y a 8 px (${Math.round(qb.width)}, ${Math.round(pb.y - qb.y - qb.height)})`);
    check((await q.locator('.gx-qc').count()) === 4, '4 acciones de fábrica');
    await page.mouse.move(5, 5); await page.waitForTimeout(350);
    check((await q.evaluate((e) => getComputedStyle(e).opacity)) === '0', 'acciones: se ocultan al salir');
    await dock.getByRole('button', { name: 'Acciones rápidas', exact: true }).click(); await page.waitForTimeout(300);
    await page.mouse.move(5, 5);
    check((await q.evaluate((e) => getComputedStyle(e).opacity)) === '1' && (await dock.getAttribute('class')).includes(' q'), 'acciones: ⚡ las abre (táctil)');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    check((await q.evaluate((e) => getComputedStyle(e).opacity)) === '0', 'acciones: Esc las cierra');
    await page.keyboard.press('Shift'); await dock.getByRole('button', { name: 'Minimizar a la mascota' }).focus(); await page.waitForTimeout(300);
    check((await q.evaluate((e) => getComputedStyle(e).opacity)) === '1', 'acciones: aparecen al enfocar con teclado');
    for (const b of await q.getByRole('button').all()) { const bb = await b.boundingBox(); if (bb.height < 43.5 || bb.width < 43.5) check(false, 'acción < 44 px: ' + ((await b.getAttribute('aria-label')) ?? (await b.innerText()))); }
    // pulsar una acción: abre el chat con el texto en el campo, [tema] seleccionado, sin enviar
    const n0 = apiHits.length;
    await q.getByRole('button', { name: /Crear tarjetas de/ }).click();
    panel = page.getByRole('dialog', { name: 'Asistente' }); await panel.waitFor();
    const f = panel.getByLabel('Escribe tu mensaje');
    check((await f.inputValue()) === 'Crear tarjetas de [tema]' && apiHits.length === n0, 'acción: rellena el campo y no envía');
    check(await f.evaluate((e) => e.value.slice(e.selectionStart, e.selectionEnd) === '[tema]' && document.activeElement === e), 'acción: [tema] queda seleccionado y con el foco');
    check((await panel.locator('.chat-hint').count()) === 1, 'aviso de partes editables');
    await page.keyboard.type('anatomía');
    check((await f.inputValue()) === 'Crear tarjetas de anatomía', 'escribir sobrescribe el marcador');
    await f.fill('Registrar examen de [materia] el [fecha]'); await f.evaluate((e) => e.setSelectionRange(0, 0));
    await page.keyboard.press('Tab'); check(await f.evaluate((e) => e.value.slice(e.selectionStart, e.selectionEnd)) === '[materia]', 'Tab: salta a [materia]');
    await page.keyboard.press('Tab'); check(await f.evaluate((e) => e.value.slice(e.selectionStart, e.selectionEnd)) === '[fecha]', 'Tab: salta a [fecha]');
    await f.fill(''); await page.keyboard.press('Escape'); await panel.waitFor({ state: 'detached' });
  }
  // editar: en el sitio, añadir, quitar, persistir y validar
  { await dock.waitFor(); await page.locator('.gx-pill').hover(); await page.waitForTimeout(300);
    const q = page.locator('.gx-quick');
    await q.getByRole('button', { name: 'Editar acciones' }).click();
    const eds = q.locator('[contenteditable]');
    check((await eds.count()) === 4 && (await eds.first().getAttribute('aria-label')) === 'Editar la acción', 'editar: cada acción es editable (aria-label)');
    await eds.first().fill('Mi acción [x]'); await eds.first().press('Enter');
    check((await q.locator('[contenteditable]').first().innerText()) === 'Mi acción [x]', 'editar: guarda en el sitio');
    await q.getByRole('button', { name: 'Añadir' }).click();
    check((await q.locator('[contenteditable]').count()) === 5, 'añadir: 5 acciones');
    await q.getByRole('button', { name: 'Quitar la acción' }).last().click();
    check((await q.locator('[contenteditable]').count()) === 4, 'quitar: 4 acciones');
    await q.locator('[contenteditable]').nth(1).fill('x'.repeat(200)); await q.locator('[contenteditable]').nth(1).press('Enter');
    check((await q.locator('[contenteditable]').nth(1).innerText()).length === 120, 'validación: máx. 120 caracteres');
    await q.locator('[contenteditable]').nth(2).fill('línea uno\nlínea dos'); await q.locator('[contenteditable]').nth(2).press('Enter');
    check(!(await q.locator('[contenteditable]').nth(2).innerText()).includes('\n'), 'validación: sin saltos de línea');
    for (let i = 0; i < 6 && (await q.getByRole('button', { name: 'Añadir' }).count()); i++) await q.getByRole('button', { name: 'Añadir' }).click();
    check((await q.locator('[contenteditable]').count()) === 8 && (await q.getByRole('button', { name: 'Añadir' }).count()) === 0, 'validación: máx. 8 acciones');
    for (let i = 0; i < 4; i++) await q.getByRole('button', { name: 'Quitar la acción' }).last().click();
    await q.getByRole('button', { name: 'Listo' }).click();
    await page.waitForTimeout(700);
    await page.goto(URL_ + '?app#/hoy'); await page.reload(); await dock.waitFor(); await page.locator('.gx-pill').hover(); await page.waitForTimeout(300);
    check((await page.locator('.gx-quick .gx-qc').count()) === 4 && (await page.locator('.gx-quick .gx-qc').first().innerText()) === 'Mi acción [x]', 'la lista editada persiste tras recargar');
    check(await page.evaluate(() => !JSON.stringify(localStorage).includes('Mi acción')), 'las acciones no se guardan en localStorage del navegador (van a Ajustes)');
  }

  // ───── Modelo y claves (misma pestaña) ─────
  console.log('GREX · modelo y claves');
  { await seed(); await page.goto(URL_ + '?app#/hoy'); await page.reload(); await dock.waitFor(); await page.locator('.gx-pill').hover(); await page.waitForTimeout(300);
    const q = page.locator('.gx-quick');
    await q.getByRole('button', { name: 'Modelo y claves' }).click();
    const rg = q.getByRole('radiogroup'), rs = rg.getByRole('radio');
    check((await rs.count()) === 2 && (await rs.first().getAttribute('aria-checked')) === 'true', 'claves: una fila por clave; la activa marcada');
    const qb = await q.boundingBox(), pb = await page.locator('.gx-pill').boundingBox();
    check(Math.abs(qb.width - pb.width) <= 1 && (await rs.first().evaluate((e) => e.closest('.gx-krow').getBoundingClientRect().height)) >= 46, 'claves: misma geometría de la pestaña y filas ≥ 46 px');
    check(await page.evaluate(([a, b]) => { const h = document.body.innerHTML; return !h.includes(a) && !h.includes(b) && !h.includes(a.slice(0, -4)); }, [K1, K2]) && (await q.innerText()).includes('••••AAAA'), 'la clave nunca aparece completa (solo ••••últimos 4)');
    await rs.first().focus(); await page.keyboard.press('ArrowDown');
    check(await rs.nth(1).evaluate((e) => e === document.activeElement), 'teclado: ↓ mueve entre claves');
    await page.keyboard.press('Space');
    check((await rs.first().getAttribute('aria-checked')) === 'true' && (await rs.first().innerText()).includes('Dos') && (await q.getByText('Ahora responde con Dos').count()) === 1, 'elegir: «Ahora responde con Dos» (aria-live)');
    check(await page.evaluate(() => JSON.parse(localStorage.getItem('engrama.chat.keys')).keys[0].alias === 'Dos'), 'elegir: esa clave pasa a ser la primera (persiste)');
    check((await page.locator('.gx-ustrip .gx-u.on').getAttribute('data-key')) === 'b', 'la tira de uso marca la clave activa');
    // la petición siguiente usa esa clave
    await page.keyboard.press('Escape'); await page.mouse.move(5, 5);
    mode = 'stream'; genKeys.length = 0;
    await dock.locator('.gx-txt').click(); panel = page.getByRole('dialog', { name: 'Asistente' }); await panel.waitFor();
    await panel.getByLabel('Escribe tu mensaje').fill('hola'); await panel.getByLabel('Escribe tu mensaje').press('Enter');
    await page.locator('.chat-msg.assistant').first().waitFor();
    check(genKeys.length >= 1 && genKeys[0].key === K2, 'la petición siguiente usa la clave elegida');
    await page.keyboard.press('Escape'); await panel.waitFor({ state: 'detached' });
    // modelo: «Ver modelos disponibles» + elegir
    await dock.waitFor(); await page.locator('.gx-pill').hover(); await page.waitForTimeout(300);
    await q.getByRole('button', { name: 'Modelo y claves' }).click();
    const lr0 = listReqs.length;
    await q.getByRole('button', { name: 'Ver modelos disponibles' }).click();
    await page.waitForFunction((n) => true, 0); await page.waitForTimeout(500);
    check(listReqs.length === lr0 + 1 && listReqs[lr0].key === K2 && !listReqs[lr0].url.includes('AIza'), 'ver modelos: UNA petición, clave solo en cabecera');
    await q.getByRole('button', { name: /Modelo de Dos/ }).click();
    const mi = page.getByRole('menuitemradio', { name: 'gemini-2.5-pro' });
    check((await mi.count()) === 1 && (await page.locator('.popover.gx-menu').evaluate((e) => +getComputedStyle(e).zIndex)) > 250, 'selector de modelo: incluye los obtenidos y queda sobre el asistente');
    await mi.click();
    await page.waitForTimeout(700);
    check((await q.getByRole('button', { name: /Modelo de Dos/ }).innerText()).includes('gemini-2.5-pro'), 'elegir modelo: se ve en la fila');
    check(await page.evaluate(() => /mono|Menlo|ui-monospace/i.test(getComputedStyle(document.querySelector('.gx-mdl .mono')).fontFamily)), 'el modelo va en monoespaciada');
    await page.keyboard.press('Escape'); await page.mouse.move(5, 5);
    genKeys.length = 0;
    await dock.locator('.gx-txt').click(); await panel.waitFor();
    await panel.getByLabel('Escribe tu mensaje').fill('otra'); await panel.getByLabel('Escribe tu mensaje').press('Enter');
    await page.locator('.chat-msg.assistant').nth(1).waitFor().catch(() => {});
    check(genKeys.length >= 1 && /models\/gemini-2\.5-pro:/.test(genKeys[0].url), 'cambiar de modelo llega a la siguiente petición');
    await page.keyboard.press('Escape'); await panel.waitFor({ state: 'detached' });
    // claves no elegibles
    await page.evaluate(() => { const o = JSON.parse(localStorage.getItem('engrama.chat.keys')); o.keys[1].status = 'invalid'; localStorage.setItem('engrama.chat.keys', JSON.stringify(o)); });
    await page.goto(URL_ + '?app#/hoy'); await page.reload(); await dock.waitFor(); await page.locator('.gx-pill').hover(); await page.waitForTimeout(300);
    await q.getByRole('button', { name: 'Modelo y claves' }).click();
    const bad = q.getByRole('radio').nth(1);
    check((await bad.getAttribute('aria-disabled')) === 'true' && (await bad.innerText()).includes('inválida'), 'clave inválida: atenuada, con su etiqueta y no elegible');
    await bad.click({ force: true });
    check(await page.evaluate(() => JSON.parse(localStorage.getItem('engrama.chat.keys')).keys[0].alias === 'Dos'), 'clave no elegible: no cambia el orden');
    await q.getByRole('button', { name: 'Volver a las acciones' }).click();
    check((await q.locator('.gx-qc').count()) === 4, '‹ vuelve a las acciones');
    // sin claves
    await page.evaluate(() => localStorage.removeItem('engrama.chat.keys'));
    await page.goto(URL_ + '?app#/hoy'); await page.reload(); await dock.waitFor(); await page.locator('.gx-pill').hover(); await page.waitForTimeout(300);
    await q.getByRole('button', { name: 'Modelo y claves' }).click();
    check((await q.getByText('Aún no tienes claves').count()) === 1 && (await q.getByRole('button', { name: 'Añadir clave' }).count()) === 1 && (await page.locator('.gx-ustrip').count()) === 0, 'sin claves: aviso + «Añadir clave» y sin tira de uso');
    await q.getByRole('button', { name: 'Añadir clave' }).click();
    const kd = page.getByRole('dialog', { name: 'Añadir clave' });
    await kd.waitFor();
    check(page.url().includes('#/hoy'), '«Añadir clave» abre la hoja sin salir de Hoy');
    await kd.getByLabel('Clave de API').fill('gsk_HOJA0123456789abcdefHOJA');
    await kd.getByLabel('Proveedor').selectOption('groq');
    await kd.getByRole('button', { name: 'Añadir clave' }).click();
    await kd.waitFor({ state: 'detached' });
    check((await q.locator('.gx-krow').count()) === 1 && (await q.innerText()).includes('••••HOJA'), 'la hoja añade la clave y aparece en Modelo y claves');
    // tira con 1–4 claves: se ajusta al contenido, ≤ pastilla, máx. 3 entradas y «+N»
    const provs = ['gemini', 'groq', 'openrouter', 'kimi'], ws = [], ds = new Set();
    for (let n = 1; n <= 4; n++) {
      await page.evaluate(([n, provs]) => localStorage.setItem('engrama.chat.keys', JSON.stringify({ v: 1, keys: provs.slice(0, n).map((p, i) => ({ id: 'k' + i, alias: 'K' + i, provider: p, key: 'sk-test' + i + 'WXYZ', status: 'active' })) })), [n, provs]);
      await page.goto(URL_ + '?app#/hoy'); await page.reload(); await dock.waitFor(); await page.waitForTimeout(200);
      const st = page.locator('.gx-ustrip'), sb = await st.boundingBox(), pb = await page.locator('.gx-pill').boundingBox();
      ws.push(sb.width);
      check((await st.locator('.gx-u:not(.more)').count()) === Math.min(n, 3) && (await st.locator('.more').count()) === (n > 3 ? 1 : 0) && (n < 4 || (await st.locator('.more').innerText()) === '+1'), `tira con ${n} clave(s): ${Math.min(n, 3)} entradas${n > 3 ? ' y «+1»' : ''}`);
      check(sb.width <= pb.width && (await st.locator('.gx-u.on').count()) === 1 && (await st.locator('.gx-u.on').evaluate((e) => +getComputedStyle(e).fontWeight)) >= 700 && (await st.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)), `tira con ${n}: ≤ ancho de la pastilla (${Math.round(sb.width)}), sin desborde, activa en Bold`);
      for (const p of provs.slice(0, Math.min(n, 3))) ds.add(p + ':' + await st.locator(`[data-provider="${p}"] svg`).first().innerHTML());
    }
    check(ws[0] < ws[1] && ws[1] < ws[2] && ws[3] > ws[2], `ancho adaptable al contenido (${ws.map(Math.round)})`);
    check(ds.size === 3 && new Set([...ds].map((x) => x.split(':')[1])).size === 3, 'logo propio por proveedor');
    await page.locator('.gx-pill').hover(); await page.waitForTimeout(300);
    await page.locator('.gx-quick').getByRole('button', { name: 'Modelo y claves' }).click();
    check((await page.locator('.gx-quick').getByRole('radio').count()) === 4 && (await page.locator('.gx-quick .gx-lg svg').count()) === 4, 'el selector de claves muestra las 4 con su logo');
    await seed(); await page.goto(URL_ + '?app#/hoy'); await page.reload(); await dock.waitFor();
  }

  // no solapa la firma ni la barra del editor (1024×768 y 1366×1024); claro y oscuro
  await page.goto(URL_ + '?app#/notas');
  await page.getByRole('button', { name: 'Nueva nota', exact: true }).first().click();
  await page.locator('.sheet').getByLabel('Título').fill('Nota GREX');
  await page.locator('.sheet').getByLabel('Título').press('Enter');
  await page.locator('.doc').waitFor();
  for (const [w, h] of [[1024, 768], [1366, 1024]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(250);
    for (const dark of [false, true]) {
      await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark);
      await page.waitForTimeout(100);
      const eb = page.locator('.editorbar').first(), sg = await page.locator('.dev-sign').boundingBox();
      const d = await page.locator('.gx-dock').boundingBox();
      check(!hit(d, sg), `${w}×${h}${dark ? ' oscuro' : ''}: la barra no tapa la firma`);
      check((await eb.count()) > 0 && !hit(d, await eb.boundingBox()), `${w}×${h}${dark ? ' oscuro' : ''}: la barra no tapa la barra del editor`);
      await page.screenshot({ path: `${SHOTS}/${w}-notas-${dark ? 'oscuro' : 'claro'}.png` });
    }
    await page.locator('.gx-dock .gx-minimize, .gx-dock [aria-label="Minimizar a la mascota"]').click();
    await page.locator('.gx-mini').waitFor();
    { const m = await page.locator('.gx-mini').boundingBox(), eb = await page.locator('.editorbar').first().boundingBox(), sg = await page.locator('.dev-sign').boundingBox();
      check(!hit(m, eb) && !hit(m, sg), `${w}×${h}: la mascota minimizada no tapa la barra del editor ni la firma`); }
    await page.screenshot({ path: `${SHOTS}/${w}-notas-mascota.png` });
    await page.locator('.gx-mini').click();
    await page.locator('.gx-dock').waitFor();
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.setViewportSize({ width: 1180, height: 900 });

  // reduced-motion: mascota y barra sin animación
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(URL_ + '?app#/hoy');
  await page.locator('.gx-dock').waitFor();
  check(await page.evaluate(() => [...document.querySelectorAll('.gx-dock *, .gx-dock')].every((e) => getComputedStyle(e).animationName === 'none' && !/after/.test('')) && getComputedStyle(document.querySelector('.gx-dock .blink')).animationName === 'none'), 'reduced-motion: sin animaciones en la barra ni en GREX');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(URL_ + '?app#/hoy');
  await page.locator('.gx-dock').waitFor();
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.gx-dock .blink')).animationName === 'm-blink'), 'con movimiento: GREX parpadea');

  // pseudo-idioma +40 %: sin desbordes
  await page.keyboard.press('Escape');
  await page.goto(URL_ + '?app#/design');
  await page.getByRole('button', { name: /pseudo/i }).first().click();
  await page.goto(URL_ + '?app#/hoy');
  await page.keyboard.press('Control+Alt+a');
  panel = page.locator('.chat-panel');
  await panel.waitFor();
  const over = await page.evaluate(() => [...document.querySelectorAll('.chat-panel *')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible' && e.clientWidth > 0).map((e) => e.className || e.tagName).slice(0, 5));
  check(over.length === 0, 'xx: sin desbordes horizontales ' + over.join(','));
  await page.screenshot({ path: `${SHOTS}/1024-xx.png` });
  await page.keyboard.press('Escape');
  await page.goto(URL_ + '?app#/design');
  await page.getByRole('button', { name: 'ES', exact: true }).click();
  panel = page.getByRole('dialog', { name: 'Asistente' });

  // teléfono 390×844
  await page.goto(URL_ + '?app#/hoy');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const fp = await fab.boundingBox(), tb = await page.locator('.phone-tabbar').boundingBox();
  check(fp.y + fp.height <= tb.y + 1, 'teléfono: el botón queda sobre la barra inferior');
  await page.getByRole('button', { name: 'Más' }).click();
  check((await page.getByRole('button', { name: 'Asistente', exact: true }).count()) === 1, 'teléfono: «Asistente» en «Más»');
  await page.getByRole('button', { name: 'Asistente', exact: true }).click();
  await panel.waitFor();
  await page.waitForTimeout(400);
  pb = await panel.boundingBox();
  check(pb.width >= 389 && pb.height >= 843, `teléfono: hoja a pantalla completa (${pb.width}×${pb.height})`);
  check((await panel.getAttribute('aria-modal')) === 'true', 'teléfono: modal');
  check((await panel.evaluate((e) => document.documentElement.scrollWidth <= innerWidth)), 'teléfono: sin scroll horizontal');
  await page.screenshot({ path: `${SHOTS}/390-telefono.png` });
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });

  // OpenRouter y Kimi (claves de prueba; el servidor es falso y habla el dialecto OpenAI)
  console.log('OpenRouter y Kimi');
  const ORK = 'sk-or-v1-FAKEOPENROUTERKEY0123456789', KMK = 'sk-FAKEKIMIKEY0123456789abcdefABCD';
  const oai = { hits: [], mode: 'ok' };
  await page.route(/openrouter\.ai|api\.moonshot\.ai/, async (r) => {
    const rq = r.request(), u = new URL(rq.url());
    if (rq.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const auth = rq.headers()['authorization'] ?? '';
    oai.hits.push({ url: rq.url(), auth, h: Object.keys(rq.headers()), max: (() => { try { return rq.postDataJSON()?.max_tokens; } catch { return undefined; } })() });
    const json = (status, body) => r.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
    if (oai.mode === '401') return json(401, { error: { message: 'bad key', code: 401 } });
    if (u.pathname.endsWith('/models')) return json(200, { data: [{ id: 'x/pago', pricing: { prompt: '0.001', completion: '0.001' } }, { id: 'y/gratis:free', pricing: { prompt: '0', completion: '0' } }, { id: 'kimi-k2-0905-preview' }] });
    const c = (delta, fin = null) => 'data: ' + JSON.stringify({ id: '1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: fin }] }) + '\n\n';
    if (rq.postDataJSON()?.stream) return r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: c({ role: 'assistant', content: 'Hola ' }) + c({ content: 'desde OpenRouter' }) + c({}, 'stop') + 'data: [DONE]\n\n' });
    return json(200, { id: '1', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
  });
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.goto(URL_ + '?app#/ajustes');
  await page.locator('#asistente').waitFor();
  if ((await page.locator('#asistente').getAttribute('class')).includes('open') === false) await page.locator('#asistente .fold-btn').click();
  const s2 = page.locator('#asistente');
  await s2.getByRole('button', { name: 'Añadir clave' }).waitFor(); // el cuerpo de la sección se carga con import() al desplegarla
  const d2 = page.getByRole('dialog', { name: 'Añadir clave' });
  await s2.getByRole('button', { name: 'Añadir clave' }).click();
  const provs = await d2.getByLabel('Proveedor').locator('option').allInnerTexts();
  await d2.getByRole('button', { name: 'Cerrar' }).click();
  check(provs.join() === 'Gemini,Groq,OpenRouter,Kimi', 'selector con los 4 proveedores: ' + provs.join());
  check((await s2.innerText()).includes('Hasta 4'), 'texto «Hasta 4»');
  check((await s2.innerText()).includes('OpenRouter reenvía') && (await s2.innerText()).includes('Kimi (Moonshot AI)'), 'avisos de privacidad por proveedor');
  for (const [prov, alias, key] of [['openrouter', 'Cuenta-OR', ORK], ['kimi', 'Cuenta-KM', KMK]]) {
    await s2.getByRole('button', { name: 'Añadir clave' }).click();
    await d2.getByLabel('Proveedor').selectOption(prov);
    await d2.getByLabel('Apodo (opcional)').fill(alias);
    await d2.getByLabel('Clave de API').fill(key);
    await d2.getByRole('button', { name: 'Añadir clave' }).click();
    await d2.waitFor({ state: 'detached' });
  }
  const rowOf = (a) => s2.locator('.chat-key', { hasText: a });
  oai.hits.length = 0; oai.mode = '401';
  await rowOf('Cuenta-KM').getByRole('button', { name: 'Probar conexión' }).click();
  await rowOf('Cuenta-KM').getByText('El proveedor rechazó la clave', { exact: false }).waitFor();
  check(oai.hits[0].url === 'https://api.moonshot.ai/v1/chat/completions' && oai.hits[0].auth === 'Bearer ' + KMK, 'Kimi: petición a api.moonshot.ai/v1 con Bearer');
  oai.mode = 'ok';
  await rowOf('Cuenta-KM').getByRole('button', { name: 'Reactivar' }).click();
  await rowOf('Cuenta-KM').getByRole('button', { name: 'Probar conexión' }).click();
  await rowOf('Cuenta-KM').getByText('Conexión correcta.').waitFor();
  oai.hits.length = 0;
  await rowOf('Cuenta-OR').getByRole('button', { name: 'Ver modelos disponibles' }).click();
  await rowOf('Cuenta-OR').getByText('3 modelos disponibles').waitFor();
  check(oai.hits[0].url === 'https://openrouter.ai/api/v1/models' && !oai.hits[0].url.includes('sk-'), 'OpenRouter: GET /models, clave solo en cabecera');
  check((await rowOf('Cuenta-OR').locator('.chat-models code').first().innerText()) === 'y/gratis:free', 'OpenRouter: gratuitos primero');
  await rowOf('Cuenta-OR').getByRole('button', { name: 'Probar conexión' }).first().click();
  await rowOf('Cuenta-OR').getByText('Conexión correcta.').waitFor();
  check(!oai.hits.some((h) => h.h.includes('http-referer') || h.h.includes('x-title')), 'sin cabeceras HTTP-Referer/X-Title');
  // chat con OpenRouter en streaming (solo esa clave)
  await page.evaluate((k) => { localStorage.removeItem('engrama.chat.usage'); localStorage.setItem('engrama.chat.keys', JSON.stringify({ v: 1, keys: [{ id: 'o', alias: 'OR', provider: 'openrouter', key: k, status: 'active' }] })); }, ORK);
  await page.goto(URL_ + '?app#/hoy');
  await page.keyboard.press('Control+Alt+a');
  await panel.waitFor();
  await panel.getByLabel('Escribe tu mensaje').fill('hola'); await panel.getByLabel('Escribe tu mensaje').press('Enter');
  await panel.getByText('Hola desde OpenRouter').waitFor();
  check(true, 'chat con OpenRouter en streaming');
  const chatMax = () => oai.hits.filter((h) => h.url.endsWith('/chat/completions') && h.max !== undefined && h.max > 100).at(-1)?.max;
  check(chatMax() === 4096, 'contexto normal: max_tokens de OpenRouter = 4096 (' + chatMax() + ')');
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });
  await page.goto(URL_ + '?app#/ajustes');
  await page.locator('#asistente').waitFor();
  if ((await page.locator('#asistente').getAttribute('class')).includes('open') === false) await page.locator('#asistente .fold-btn').click();
  check((await s2.getByLabel('Contexto del Asistente').inputValue()) === 'normal', 'Ajustes: contexto «Normal» por defecto');
  check((await s2.innerText()).includes('la cuota gratuita se agota antes'), 'Ajustes: línea del coste del contexto amplio');
  await s2.getByLabel('Contexto del Asistente').selectOption('amplio');
  await page.goto(URL_ + '?app#/hoy');
  await page.keyboard.press('Control+Alt+a');
  await panel.waitFor();
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  await panel.getByLabel('Escribe tu mensaje').fill('otra vez'); await panel.getByLabel('Escribe tu mensaje').press('Enter');
  await panel.getByText('Hola desde OpenRouter').waitFor();
  check(chatMax() === 8192, 'contexto amplio: max_tokens de OpenRouter = 8192 (' + chatMax() + ')');
  check(!(await page.content()).includes(ORK) && !logs.some((l) => l.includes(ORK) || l.includes(KMK)), 'la clave no está en el DOM ni en la consola');
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });
  // ───── Dictado (voz del sistema, simulada) ─────
  console.log('Dictado');
  await page.context().addInitScript(() => {
    const m = localStorage.getItem('e2e-sr');
    if (!m) { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; try { Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true }); Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true }); } catch { /* */ } return; }
    const FK = class {
      start() { window.__sr = this; window.__srN = (window.__srN || 0) + 1; this.lang0 = this.lang; if (m === 'denied') setTimeout(() => { this.onerror?.({ error: 'not-allowed' }); this.onend?.(); }, 20); }
      stop() { this.onend?.(); } abort() { this.onend?.(); }
      say(t, f) { this.onresult?.({ results: [Object.assign([{ transcript: t }], { isFinal: f })] }); }
    };
    window.webkitSpeechRecognition = FK; window.SpeechRecognition = FK; // Chromium ya trae el suyo
  });
  const sr = async (mode) => { await page.evaluate((m) => { m ? localStorage.setItem('e2e-sr', m) : localStorage.removeItem('e2e-sr'); }, mode); await page.reload(); await page.locator('.gx-dock').waitFor(); };
  const field = () => page.locator('.chat-panel textarea');
  const apiBefore = apiHits.length;
  await sr('ok');
  const dk = page.locator('.gx-dock');
  const dbtn = dk.getByRole('button', { name: 'Dictar' });
  check((await dbtn.boundingBox()).height >= 44, 'Dictar: ≥ 44 px');
  check((await dbtn.getAttribute('aria-pressed')) === 'false' && !(await dbtn.getAttribute('title')), 'Dictar: aria-pressed false y sin title');
  await page.screenshot({ path: `${SHOTS}/1024-dictar-reposo.png` });
  await dbtn.click({ position: { x: 20, y: 20 }, delay: 30 });  // toque
  await field().waitFor();
  check(await page.evaluate(() => window.__srN === 1 && window.__sr.lang0 === 'es-MX'), 'toque: empieza el reconocimiento (es-MX)');
  await page.evaluate(() => window.__sr.say('hola gre', false));
  check((await field().inputValue()) === 'hola gre', 'texto provisional en el campo');
  check((await field().getAttribute('class')).includes('vz-int'), 'provisional en gris/cursiva');
  check((await page.locator('.chat-panel .mascot').first().getAttribute('data-state')) === 'listening' , 'la mascota pasa a listening');
  { const b = page.getByRole('button', { name: 'Escuchando… · Detener' }).first();
    check((await b.count()) >= 1 && (await b.getAttribute('aria-pressed')) === 'true', 'botón: «Escuchando… · Detener» (pressed)'); }
  await page.screenshot({ path: `${SHOTS}/1024-dictar-escuchando.png` });
  await page.evaluate(() => window.__sr.say('hola grex', true));
  await page.evaluate(() => window.__sr.onend());
  check((await field().inputValue()) === 'hola grex' && !(await field().getAttribute('class')).includes('vz-int'), 'texto definitivo en el campo');
  await page.waitForTimeout(300);
  check(!(await page.locator('.chat-msg.user').count()) && apiHits.length === apiBefore, 'NO se envía solo');
  // con texto previo: se añade con espacio
  await page.locator('.chat-form .vz').click({ delay: 30 });
  await page.evaluate(() => window.__sr.say('otra frase', true)); await page.evaluate(() => window.__sr.onend());
  check((await field().inputValue()) === 'hola grex otra frase', 'si ya hay texto, se añade con un espacio');
  // el botón del campo del panel
  await field().fill('');
  const vpb = page.locator('.chat-form .vz');
  check((await vpb.boundingBox()).height >= 44, 'botón del campo: ≥ 44 px');
  await vpb.dispatchEvent('pointerdown', { pointerId: 1, isPrimary: true, button: 0 });
  await page.waitForTimeout(450);
  check(await page.evaluate(() => window.__srN === 3), 'mantener: empieza al pulsar');
  await page.evaluate(() => window.__sr.say('mantenido', true));
  await vpb.dispatchEvent('pointerup', { pointerId: 1, isPrimary: true });
  await page.waitForTimeout(100);
  check((await field().inputValue()) === 'mantenido' && (await page.locator('.chat-form .vz.on').count()) === 0, 'mantener ≥ 350 ms: al soltar se detiene');
  // toque corto en el campo: sigue escuchando hasta otro toque
  await vpb.dispatchEvent('pointerdown', { pointerId: 2, isPrimary: true, button: 0 });
  await vpb.dispatchEvent('pointerup', { pointerId: 2, isPrimary: true });
  check((await page.locator('.chat-form .vz.on').count()) === 1, 'toque corto: sigue escuchando');
  await vpb.dispatchEvent('pointerdown', { pointerId: 3, isPrimary: true, button: 0 });
  await vpb.dispatchEvent('pointerup', { pointerId: 3, isPrimary: true });
  check((await page.locator('.chat-form .vz.on').count()) === 0, 'segundo toque: detiene');
  await page.keyboard.press('Escape'); await panel.waitFor({ state: 'detached' });
  // permiso denegado
  await sr('denied');
  await page.locator('.gx-dock').getByRole('button', { name: 'Dictar' }).click({ delay: 30 });
  await page.getByText('Activa el micrófono para Engrama en Ajustes de Safari').first().waitFor();
  check((await page.locator('.gx-voz-msg[role=status][aria-live=polite]').count()) >= 1, 'permiso denegado: mensaje claro con aria-live');
  await page.keyboard.press('Escape'); await panel.waitFor({ state: 'detached' });
  // sin soporte
  await sr(null);
  await page.locator('.gx-dock').getByRole('button', { name: 'Dictar' }).click({ delay: 30 });
  await panel.waitFor();
  await page.getByText('Usa el micrófono del teclado para dictar').first().waitFor();
  check(await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA'), 'sin soporte: el campo queda enfocado y hay aviso');
  await page.keyboard.press('Escape'); await panel.waitFor({ state: 'detached' });
  // teléfono
  await sr('ok');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.chat-fab').click();
  await panel.waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/390-dictar-reposo.png` });
  await page.locator('.chat-form').getByRole('button', { name: 'Dictar' }).click({ delay: 30 });
  await page.evaluate(() => window.__sr.say('hola desde el teléfono', false));
  await page.screenshot({ path: `${SHOTS}/390-dictar-escuchando.png` });
  check((await field().inputValue()) === 'hola desde el teléfono', 'teléfono: el texto llega al campo');
  await page.keyboard.press('Escape'); await panel.waitFor({ state: 'detached' }).catch(() => {});
  await page.setViewportSize({ width: 1180, height: 900 });
  await sr(null);

  // toda la sesión: solo localhost y los 4 hosts del Asistente (incluida la carga del SDK)
  { const bad = [...hosts].filter((h) => !/^localhost(:\d+)?$/.test(h) && h !== 'generativelanguage.googleapis.com' && h !== 'api.groq.com' && h !== 'openrouter.ai' && h !== 'api.moonshot.ai'); check(bad.length === 0, 'peticiones solo a self y 4 hosts ' + bad.join(',')); }
} catch (e) {
  failed++;
  console.error(e);
  try { await page.screenshot({ path: '/tmp/claude-0/fail.png' }); } catch { /* */ }
  try { console.error('DBGPAGE', await page.evaluate(() => document.body.innerText.slice(0, 400) + ' | ' + [...document.querySelectorAll('h1,h2')].map((h) => h.tagName + ':' + h.textContent).join(';'))); } catch { /* */ }
  try { console.error(await page.locator('.chat-panel').first().first().evaluate((el) => el.innerText + '\n' + [...el.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')).join('|'))); } catch { /* sin panel */ }
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} FALLO(S)` : '\nOK');
process.exit(failed ? 1 : 0);
