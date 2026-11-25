// Voz · Leer: el botón «Leer» del chat habla DENTRO del gesto, con lista de voces vacía y con voz local; «Detener» corta.
// API simulada y speechSynthesis falso (cuenta speak y comprueba que ocurre en el manejador del clic).
//   npm run build && flock /tmp/e2e.lock node e2e/voz-leer.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const PORT = Number(process.env.PORT) || 4198;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };

let page;
try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, locale: 'es-MX' });
  // speechSynthesis falso: `inGesture` es true solo mientras corre un manejador de clic (captura, antes que Preact)
  await ctx.addInitScript(() => {
    const w = window; w.__sp = { speaks: [], cancels: 0, inGesture: false, voices: [] };
    for (const ev of ['pointerdown', 'click']) {
      w.addEventListener(ev, () => { w.__sp.inGesture = true; queueMicrotask(() => setTimeout(() => { w.__sp.inGesture = false; }, 0)); }, true);
    }
    w.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    const ss = { speaking: false, pending: false, getVoices: () => w.__sp.voices, resume() {}, cancel() { w.__sp.cancels++; ss.speaking = false; },
      speak(u) { w.__sp.speaks.push({ text: u.text, lang: u.lang, voice: u.voice ? u.voice.name : null, gesture: w.__sp.inGesture }); ss.speaking = true; } };
    Object.defineProperty(w, 'speechSynthesis', { value: ss, configurable: true });
  });
  page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 300)));
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  const sse = (text) => 'data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, index: 0 }] }) + '\n\n'
    + 'data: ' + JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '' }] }, finishReason: 'STOP', index: 0 }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 3, totalTokenCount: 6 } }) + '\n\n';
  await page.route(/generativelanguage\.googleapis\.com/, (r) => r.request().method() === 'OPTIONS' ? r.fulfill({ status: 204, headers: CORS })
    : r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/event-stream' }, body: sse('**El ECG** tiene 12 derivaciones [[Clase 1]] 😀. Segunda frase.') }));

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
  await ta.fill('hola'); await ta.press('Enter');
  const leer = panel.getByRole('button', { name: 'Leer' });
  await leer.waitFor();
  const sp = () => page.evaluate(() => window.__sp);

  console.log('Lista de voces vacía');
  await leer.click();
  let s = await sp();
  check(s.speaks.length === 1, 'speak se llamó');
  check(s.speaks[0]?.gesture === true, 'speak ocurre dentro del gesto del toque');
  check(s.speaks[0]?.voice === null && s.speaks[0]?.lang === 'es-MX', 'sin voz explícita y lang es-MX');
  check(!/[*\[\]😀]/.test(s.speaks[0]?.text ?? '*'), 'texto sin markdown, citas ni emojis: ' + s.speaks[0]?.text);
  await panel.getByRole('button', { name: 'Detener' }).waitFor();
  check((await panel.getByRole('button', { name: 'Detener' }).getAttribute('aria-pressed')) === 'true', 'aria-pressed true mientras habla');
  await panel.getByRole('button', { name: 'Detener' }).click();
  s = await sp();
  check(s.cancels >= 1, 'Detener cancela al instante');
  await panel.getByRole('button', { name: 'Leer' }).waitFor();

  console.log('Con voz local es-MX y una remota');
  await page.evaluate(() => { window.__sp.voices = [{ name: 'Remota', lang: 'es-MX', localService: false }, { name: 'Paulina', lang: 'es-MX', localService: true }]; });
  await leer.click();
  s = await sp();
  check(s.speaks.length === 2 && s.speaks[1].voice === 'Paulina' && s.speaks[1].gesture === true, 'usa la voz local (nunca la remota) dentro del gesto');
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
