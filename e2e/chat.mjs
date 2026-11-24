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
  page.on('dialog', (d) => d.accept());
  const apiHits = [], js = new Set(), logs = [];
  let mode = 'ok', lmode = 'ok', lrelease = null;
  const listReqs = [];
  const EX_DATE = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10);
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
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();

  console.log('Apagado');
  await page.goto(URL_ + '#/ajustes');
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
  await page.waitForTimeout(300);

  console.log('Panel');
  mode = 'stream'; apiHits.length = 0;
  const seed = (extra) => page.evaluate(([a, b]) => { localStorage.removeItem('engrama.chat.usage'); localStorage.setItem('engrama.chat.keys', JSON.stringify({ v: 1, keys: [{ id: 'a', alias: 'Uno', provider: 'gemini', key: a, status: 'active' }, { id: 'b', alias: 'Dos', provider: 'gemini', key: b, status: 'active' }] })); }, [K1, K2]);
  await seed();
  await page.goto(URL_ + '#/hoy');
  const fab = page.getByRole('button', { name: 'Abrir el asistente' });
  await fab.waitFor();
  const fb = await fab.boundingBox();
  check(fb.width >= 44 && fb.height >= 44, 'botón flotante ≥ 44 px');
  check((await page.locator('.dev-sign').boundingBox()).x < 400 && fb.x > 700, 'el botón va a la derecha, la firma a la izquierda');
  check(!(await page.evaluate(() => document.querySelector('.chat-fab').closest('.glass:not(.chat-fab)'))), 'el botón flotante no está dentro de otro vidrio');
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
  await page.goto(URL_ + '#/hoy');

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
  await page.goto(URL_ + '#/hoy');
  if (!(await panel.isVisible())) { await page.keyboard.press('Control+Alt+a'); await panel.waitFor(); }
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  mode = 'toolnone'; toolBodies.length = 0;
  await ta.fill('¿Y esto?'); await ta.press('Enter');
  await log.getByText('No lo encontré en tus notas.').waitFor();
  check((await log.locator('a.chat-cite').count()) === 0, 'sin resultados: «No lo encontré en tus notas» y sin citas');
  await page.goto(URL_ + '#/hoy');
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
  // Mini reproductor simulado: el botón y el panel no lo tapan; ni la firma
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div class="mini-amb docked glass on" id="fake-mini"><div class="mini-amb-pill"><button class="mini-amb-main" type="button">Mini</button></div></div>'));
  const mini = await page.locator('#fake-mini').boundingBox();
  const hit = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  await page.waitForTimeout(150);
  check(!hit(await fab.boundingBox(), mini), 'con el mini reproductor, el botón no lo tapa');
  await fab.click(); await panel.waitFor(); await page.waitForTimeout(400);
  { const pbx = await panel.boundingBox(); check(!hit(pbx, mini), `con el mini reproductor, el panel compacto no lo tapa (${JSON.stringify(pbx)} vs ${JSON.stringify(mini)})`); }
  await page.screenshot({ path: `${SHOTS}/1024-compacto-mini.png` });
  await panel.getByRole('button', { name: 'Panel grande' }).click();
  await page.waitForTimeout(350);
  check(!hit(await panel.boundingBox(), await page.locator('.dev-sign').boundingBox()), 'el panel grande no tapa la firma');
  await page.screenshot({ path: `${SHOTS}/1024-grande-mini.png` });
  await page.evaluate(() => document.getElementById('fake-mini').remove());

  // pseudo-idioma +40 %: sin desbordes
  await page.keyboard.press('Escape');
  await page.goto(URL_ + '#/design');
  await page.getByRole('button', { name: /pseudo/i }).first().click();
  await page.goto(URL_ + '#/hoy');
  await page.keyboard.press('Control+Alt+a');
  panel = page.locator('.chat-panel');
  await panel.waitFor();
  const over = await page.evaluate(() => [...document.querySelectorAll('.chat-panel *')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible' && e.clientWidth > 0).map((e) => e.className || e.tagName).slice(0, 5));
  check(over.length === 0, 'xx: sin desbordes horizontales ' + over.join(','));
  await page.screenshot({ path: `${SHOTS}/1024-xx.png` });
  await page.keyboard.press('Escape');
  await page.goto(URL_ + '#/design');
  await page.getByRole('button', { name: 'ES', exact: true }).click();
  panel = page.getByRole('dialog', { name: 'Asistente' });

  // teléfono 390×844
  await page.goto(URL_ + '#/hoy');
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
  // toda la sesión: solo localhost y los 2 hosts del Asistente (incluida la carga del SDK)
  { const bad = [...hosts].filter((h) => !/^localhost(:\d+)?$/.test(h) && h !== 'generativelanguage.googleapis.com' && h !== 'api.groq.com'); check(bad.length === 0, 'peticiones solo a self y 2 hosts ' + bad.join(',')); }
} catch (e) {
  failed++;
  console.error(e);
  try { console.error(await page.locator('.chat-panel').first().evaluate((el) => el.innerText + '\n' + [...el.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')).join('|'))); } catch { /* sin panel */ }
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} FALLO(S)` : '\nOK');
process.exit(failed ? 1 : 0);
