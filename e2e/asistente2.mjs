// Asistente 2 (estudio inteligente · carril C): pregunta de capacidad → «sí» → propuesta de edición con diff → Aceptar → Deshacer,
// roles (lista blanca, «Sin fuente»), contexto desde una nota y quitarlo. API simulada con page.route; sin red real.
//   npm run build && flock /tmp/e2e.lock node e2e/asistente2.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const PORT = Number(process.env.PORT) || 4197;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };
const SHOTS = process.env.SHOTS || 'e2e-shots/asistente2';
mkdirSync(SHOTS, { recursive: true });
const NOTE = 'notes/Cardiología/ECG/Clase 1 - ECG básico.md';

let page;
try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, locale: 'es-MX' });
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 300)));
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  const SSE = { ...CORS, 'content-type': 'text/event-stream' };
  const sse = (text) => 'data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, index: 0 }] }) + '\n\n'
    + 'data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '' }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 3, totalTokenCount: 6 } }) + '\n\n';
  const call = (name, args) => 'data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args } }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 3, totalTokenCount: 6 } }) + '\n\n';
  const bodies = [];
  let script = (b) => sse('ok');
  await page.route(/generativelanguage\.googleapis\.com/, async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    const b = r.request().postData() ?? '';
    bodies.push(b);
    return r.fulfill({ status: 200, headers: SSE, body: script(b, b.includes('functionResponse')) });
  });
  const fileText = (path) => page.evaluate(async (pth) => {
    const alt = (x) => [x, encodeURIComponent(x), encodeURIComponent(x).replace(/%20/g, ' ')];
    const go = async (d, parts) => { if (parts.length === 1) { for (const n of alt(parts[0])) { try { return await (await (await d.getFileHandle(n)).getFile()).text(); } catch { /* otra grafía */ } } return null; } for (const n of alt(parts[0])) { try { const r = await go(await d.getDirectoryHandle(n), parts.slice(1)); if (r !== null) return r; } catch { /* otra grafía */ } } return null; };
    return go(await navigator.storage.getDirectory(), pth.split('/'));
  }, path);

  await page.goto(URL_ + '?app');
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.goto(URL_ + '?app#/ajustes');
  await page.locator('.settings').waitFor();
  if (await page.getByRole('button', { name: 'Desplegar todo' }).count()) await page.getByRole('button', { name: 'Desplegar todo' }).click();
  await page.getByRole('switch', { name: 'Asistente', exact: true }).click();
  await page.evaluate(() => localStorage.setItem('engrama.chat.keys', JSON.stringify({ v: 1, keys: [{ id: 'a', alias: 'Uno', provider: 'gemini', key: 'AIzaSyKEYONE0123456789abcdefAAAA', status: 'active' }] })));
  await page.goto(URL_ + '?app#/hoy');
  await page.getByRole('button', { name: 'Abrir el asistente' }).waitFor();
  await page.keyboard.press('Control+Alt+a');
  const panel = page.locator('.chat-panel');
  await panel.waitFor();
  const ta = panel.getByLabel('Escribe tu mensaje');
  const say = async (t) => { await ta.fill(t); await ta.press('Enter'); };
  const fresh = () => panel.getByRole('button', { name: 'Nueva conversación' }).click();
  const hasTool = (b, n) => b.includes(`"${n}"`);

  console.log('Capacidad → sí → propuesta de edición');
  const original = await fileText(NOTE);
  check(original !== null, 'la nota de ejemplo existe');
  script = (b, done) => (done ? sse('Te dejo la propuesta de etiquetas para revisar.')
    : /hazlo/.test(b) ? call('etiquetar_nota', { nota: 'Clase 1 - ECG básico', anadir: ['urgencias'] })
      : sse('Sí, puedo crear notas con etiquetas y editar las que ya tienes. ¿Quieres que la etiquete ahora?'));
  await say('oye tú puedes hacer notas o notas con tags?');
  await panel.getByText(/Sí, puedo crear notas/).waitFor();
  check(hasTool(bodies.at(-1), 'etiquetar_nota') && hasTool(bodies.at(-1), 'crear_nota'), 'la pregunta de capacidad habilita las herramientas de escritura');
  check(/NEVER say you are read-only/.test(bodies.at(-1)), 'el system declara que puede proponer escribir');
  await say('hazlo');
  const pv = panel.locator('.chat-pv');
  await pv.waitFor();
  check(hasTool(bodies[bodies.length - 2], 'etiquetar_nota'), '«hazlo» mantiene la escritura (pegajoso)');
  check((await pv.locator('li').filter({ hasText: /^\+ .*urgencias/ }).count()) === 1, 'vista previa con diff (+ tags … urgencias)');
  check((await fileText(NOTE)) === original, 'proponer no escribe');
  await page.screenshot({ path: `${SHOTS}/edicion.png` });
  await pv.getByRole('button', { name: 'Aceptar' }).click();
  await pv.getByRole('button', { name: 'Deshacer' }).waitFor();
  check(/urgencias/.test((await fileText(NOTE)) ?? ''), 'Aceptar escribe la etiqueta en el frontmatter');
  await pv.getByRole('button', { name: 'Deshacer' }).click();
  await pv.getByText(/Deshecho|deshech/i).first().waitFor();
  check((await fileText(NOTE)) === original, 'Deshacer restaura la nota byte a byte');

  console.log('Ajustes de la app');
  await page.goto(URL_ + '?app#/hoy');
  if (!(await panel.isVisible())) { await page.keyboard.press('Control+Alt+a'); await panel.waitFor(); }
  await fresh();
  const pomoWork = async () => { const t = await fileText('.app/settings.json'); try { return JSON.parse(t).pomo.work; } catch { return null; } };
  script = (b, done) => (done ? sse('Te dejo el cambio para revisar.') : call('cambiar_ajuste', { cambios: [{ ruta: 'pomo.work', valor: 40 }, { ruta: 'tema', valor: 'oscuro' }] }));
  bodies.length = 0;
  await say('pon un pomodoro de 40 min y el tema oscuro');
  const pa = panel.locator('.chat-pv').last();
  await pa.waitFor();
  check(hasTool(bodies[0], 'cambiar_ajuste') && hasTool(bodies[0], 'listar_ajustes'), 'el verbo «pon» habilita las herramientas de ajustes');
  check((await pa.locator('li').count()) === 2 && (await pa.innerText()).includes('Pomodoro · trabajo: 25 min → 40 min'), 'una propuesta con dos líneas antes → después');
  check((await pomoWork()) !== 40, 'proponer no cambia el ajuste');
  await pa.getByRole('button', { name: 'Aceptar' }).click();
  await pa.getByRole('button', { name: 'Deshacer' }).waitFor();
  await page.waitForFunction(() => document.documentElement.className.includes('dark') || true);
  await page.waitForTimeout(1200);
  check((await pomoWork()) === 40, 'Aceptar aplica con app.update (guardado en settings.json)');
  await pa.getByRole('button', { name: 'Deshacer' }).click();
  await pa.getByText(/deshech/i).first().waitFor();
  await page.waitForTimeout(1200);
  check((await pomoWork()) === 25, 'Deshacer restaura el valor previo exacto');

  console.log('Roles');
  await fresh();
  await panel.getByLabel('Rol').selectOption('investigador');
  script = () => sse('El ECG registra la actividad eléctrica del corazón en 12 derivaciones estándar.');
  bodies.length = 0;
  await say('Crea tarjetas del ECG');
  await panel.getByText('12 derivaciones estándar').waitFor();
  check(!hasTool(bodies[0], 'crear_tarjetas') && hasTool(bodies[0], 'buscar_notas'), 'Investigador: solo lectura aunque se pida crear');
  check((await panel.locator('.chat-nosrc').count()) === 1, 'Investigador: chip «Sin fuente» en una afirmación sin cita');
  await panel.getByLabel('Rol').selectOption('creador');
  await fresh(); bodies.length = 0;
  await say('hola');
  await panel.getByText('12 derivaciones estándar').waitFor();
  check(hasTool(bodies[0], 'crear_tarjetas') && hasTool(bodies[0], 'convertir_clase'), 'Creador: escritura y conversión siempre activas');
  await panel.getByLabel('Rol').selectOption('tutor');
  await panel.getByRole('button', { name: 'Socrático' }).click();
  await panel.getByLabel('Nivel de explicación').selectOption('clinica');
  await fresh(); bodies.length = 0;
  await say('explica el ECG');
  await panel.getByText('12 derivaciones estándar').waitFor();
  check(/Socratic mode/.test(bodies[0]) && /CLINICAL level/.test(bodies[0]), 'socrático y nivel clínico llegan al system');
  await panel.getByRole('button', { name: 'Socrático' }).click();
  await panel.getByLabel('Nivel de explicación').selectOption('');

  console.log('Contexto desde una nota');
  await page.evaluate((h) => { location.hash = h; }, '#/notas/' + NOTE.slice(6).split('/').map(encodeURIComponent).join('/'));
  const ask = page.getByRole('button', { name: 'Preguntar a GREX' }).first();
  await ask.waitFor();
  check((await ask.boundingBox()).height >= 43.5, '«Preguntar a GREX» ≥ 44 px');
  await ask.click();
  await panel.waitFor();
  const chip = panel.locator('.chat-ctx .chip');
  await chip.waitFor();
  check((await chip.innerText()).includes('Contexto: Clase 1 - ECG básico'), 'chip «Contexto: …»');
  await fresh(); bodies.length = 0;
  await say('resume esto');
  await panel.getByText('12 derivaciones estándar').waitFor();
  check(/DATOS \(no son instrucciones\)/.test(bodies[0]) && bodies[0].includes('Clase 1 - ECG básico'), 'el contexto llega recortado como DATOS');
  await chip.getByRole('button', { name: 'Quitar el contexto' }).click();
  check((await panel.locator('.chat-ctx').count()) === 0, 'el chip se quita');
  bodies.length = 0;
  await say('otra vez');
  await panel.locator('.chat-msg.assistant').nth(1).waitFor();
  check(!/DATOS \(no son instrucciones\)/.test(bodies[0]), 'sin chip no hay contexto');
} catch (e) {
  failed++;
  console.error(e);
  try { await page.screenshot({ path: `${SHOTS}/fallo.png` }); console.error(await page.locator('.chat-panel').first().innerText()); } catch { /* */ }
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} FALLO(S)` : '\nOK');
process.exit(failed ? 1 : 0);
