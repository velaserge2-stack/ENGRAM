// Asistente · acciones (pomodoro, sonido, ir_a, estudiar, tareas, stickies): propuesta → Aceptar → (Deshacer). API simulada.
// Requiere que turn.ts monte `makeActionTools` (cableado del integrador); si no, SALTA.
//   npm run build && flock /tmp/e2e.lock node e2e/acciones.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

if (!/makeActionTools/.test(readFileSync('src/chat/turn.ts', 'utf8'))) { console.log('SALTADO: turn.ts no monta makeActionTools todavía'); process.exit(0); }
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
const KEY = 'AIzaSyACCIONES0123456789abcdefAA';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const call = (name, args) => 'data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name, args } }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 3, totalTokenCount: 6 } }) + '\n\n';
const text = (s) => 'data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: s }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 3, totalTokenCount: 6 } }) + '\n\n';
let tool = null;
let page;
try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, locale: 'es-MX' });
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 300)));
  page.on('dialog', (d) => d.accept());
  await page.route(/generativelanguage\.googleapis\.com/, async (r) => {
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: CORS });
    if (/\/models(\?|$)/.test(r.request().url())) return r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{"models":[]}' });
    const done = (r.request().postData() ?? '').includes('functionResponse');
    const body = done || !tool ? text('Listo, revisa la propuesta.') : call(tool[0], tool[1]);
    return r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body });
  });
  await page.goto(URL_ + '?app');
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.goto(URL_ + '?app#/ajustes');
  await page.locator('.settings').waitFor();
  if (await page.getByRole('button', { name: 'Desplegar todo' }).count()) await page.getByRole('button', { name: 'Desplegar todo' }).click();
  for (const n of ['Asistente', 'Tareas', 'Sticky notes', 'Sonido ambiente']) { const sw = page.getByRole('switch', { name: n, exact: true }); if ((await sw.getAttribute('aria-checked')) !== 'true') await sw.click(); }
  await page.evaluate((k) => localStorage.setItem('engrama.chat.keys', JSON.stringify({ v: 1, keys: [{ id: 'a', alias: 'Uno', provider: 'gemini', key: k, status: 'active' }] })), KEY);
  await page.goto(URL_ + '?app#/hoy');
  await page.getByRole('button', { name: 'Abrir el asistente' }).click();
  const panel = page.getByRole('dialog', { name: 'Asistente' });
  await panel.waitFor();
  const ta = panel.getByLabel('Escribe tu mensaje');
  const pv = panel.locator('.chat-pv');
  const fileText = (path) => page.evaluate(async (pth) => { try { const parts = pth.split('/'); let d = await navigator.storage.getDirectory(); for (const x of parts.slice(0, -1)) d = await d.getDirectoryHandle(x); return await (await (await d.getFileHandle(parts.at(-1))).getFile()).text(); } catch { return null; } }, path);
  const ask = async (t, say) => { await panel.getByRole('button', { name: 'Nueva conversación' }).click(); tool = t; await ta.fill(say); await ta.press('Enter'); await pv.waitFor(); };

  console.log('Ir a');
  await ask(['ir_a', { seccion: 'estadisticas' }], 'abre estadísticas');
  check((await pv.innerText()).includes('Estadísticas'), 'vista previa «Ir a Estadísticas»');
  check((await pv.getByRole('button', { name: 'Editar' }).count()) === 0, 'sin «Editar»');
  const h0 = page.url();
  await pv.getByRole('button', { name: 'Cancelar' }).click();
  check(page.url() === h0, 'Cancelar no navega');
  await ask(['ir_a', { seccion: 'estadisticas' }], 'abre estadísticas');
  await pv.getByRole('button', { name: 'Aceptar' }).click();
  await page.waitForFunction(() => location.hash === '#/estadisticas');
  check(true, 'Aceptar navega');
  check((await pv.getByRole('button', { name: 'Deshacer' }).count()) === 0, 'navegar no ofrece Deshacer');

  console.log('Estudiar');
  await panel.getByRole('button', { name: 'Nueva conversación' }).click();
  tool = ['estudiar', { mazo: 'Mazo inexistente' }]; await ta.fill('estudiar el mazo inexistente'); await ta.press('Enter');
  await panel.getByText('Listo, revisa la propuesta.').waitFor();
  check((await pv.count()) === 0, 'mazo inexistente: error al modelo, sin vista previa');

  console.log('Pomodoro');
  await ask(['pomodoro', { accion: 'iniciar', minutos: 30, etiqueta: 'ECG' }], 'inicia un pomodoro de 30 minutos');
  check((await pv.innerText()).includes('30 min'), 'vista previa con duración');
  await pv.getByRole('button', { name: 'Aceptar' }).click();
  await page.locator('.mini-pomo').waitFor();
  check((await page.locator('.mini-pomo').innerText()).includes('30:0') || (await page.locator('.mini-pomo').innerText()).includes('29:5'), 'el temporizador corre con 30 min');
  await ask(['pomodoro', { accion: 'detener' }], 'detén el pomodoro');
  await pv.getByRole('button', { name: 'Aceptar' }).click();
  await pv.getByText(/Hecho/).waitFor();

  console.log('Tareas');
  await ask(['tareas', { accion: 'crear', texto: 'Resumen ECG', fecha: '2027-01-05' }], 'agrega una tarea: Resumen ECG');
  check((await fileText('notes/Tareas.md')) === null, 'proponer no escribe');
  await pv.getByRole('button', { name: 'Aceptar' }).click();
  await pv.getByRole('button', { name: 'Deshacer' }).waitFor();
  check(/- \[ \] Resumen ECG 📅 2027-01-05/.test((await fileText('notes/Tareas.md')) ?? ''), 'Aceptar escribe la tarea');
  await ask(['tareas', { accion: 'completar', texto: 'resumen' }], 'completa la tarea resumen');
  await pv.getByRole('button', { name: 'Aceptar' }).click();
  await pv.getByRole('button', { name: 'Deshacer' }).waitFor();
  check(/- \[x\] Resumen ECG/.test((await fileText('notes/Tareas.md')) ?? ''), 'completar marca [x]');
  await pv.getByRole('button', { name: 'Deshacer' }).click();
  await pv.getByText(/Deshecho/).waitFor();
  check(/- \[ \] Resumen ECG/.test((await fileText('notes/Tareas.md')) ?? ''), 'Deshacer restaura la tarea sin completar');

  console.log('Stickies');
  await ask(['stickies', { accion: 'crear', texto: 'Llamar a la doctora', color: 'amarillo' }], 'crea un sticky: llamar a la doctora');
  await pv.getByRole('button', { name: 'Aceptar' }).click();
  await pv.getByRole('button', { name: 'Deshacer' }).waitFor();
  const made = await page.evaluate(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('notes').then((n) => n.getDirectoryHandle('Stickies')); const out = []; for await (const [k] of d.entries()) out.push(k); return out; });
  check(made.length === 1, 'el sticky se creó');
  await pv.getByRole('button', { name: 'Deshacer' }).click();
  await pv.getByText(/Deshecho/).waitFor();
  const after = await page.evaluate(async () => { try { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle('notes').then((n) => n.getDirectoryHandle('Stickies')); const out = []; for await (const [k] of d.entries()) out.push(k); return out; } catch { return []; } });
  check(after.length === 0, 'Deshacer lo retira (a la papelera)');
  for (const b of await pv.getByRole('button').all()) { const bb = await b.boundingBox(); if (bb && bb.height < 43.5) check(false, 'botón < 44 px'); }
} catch (e) {
  failed++;
  console.error(e);
  try { console.error(await page.locator('.chat-panel').first().innerText()); } catch { /* */ }
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? `\n${failed} FALLO(S)` : '\nOK');
process.exit(failed ? 1 : 0);
