// Dictado del chat (carril D): modo `speech` con API simulada (el texto llega al campo sin pisar lo escrito) y modo `system`
// (API ausente, standalone en iPad o API muda → ayuda visible y campo enfocado).
//   npm run build && BROWSER=chromium node e2e/voz-dictado.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const PORT = Number(process.env.PORT) || 4197;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'], browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };
try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 900 }, locale: 'es-MX' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 300)));
  await ctx.addInitScript(() => {
    const m = localStorage.getItem('e2e-sr');
    window.__gum = 0;
    try { const md = navigator.mediaDevices; if (md) { const o = md.getUserMedia?.bind(md); md.getUserMedia = (...a) => { window.__gum++; return o ? o(...a) : Promise.reject(new Error('x')); }; } } catch { /* */ }
    if (localStorage.getItem('e2e-standalone')) { try { Object.defineProperty(navigator, 'standalone', { value: true, configurable: true }); Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true }); Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15', configurable: true }); Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true }); } catch { /* */ } }
    const none = { value: undefined, configurable: true, writable: true };
    if (!m) { try { Object.defineProperty(window, 'SpeechRecognition', none); Object.defineProperty(window, 'webkitSpeechRecognition', none); } catch { /* */ } return; }
    const FK = class {
      start() { window.__sr = this; window.__srN = (window.__srN || 0) + 1; if (m === 'mute') return; }
      stop() { this.onend?.(); } abort() { window.__aborted = 1; this.onend?.(); }
      say(t, f) { this.onresult?.({ results: [Object.assign([{ transcript: t }], { isFinal: f })] }); }
    };
    window.webkitSpeechRecognition = FK; window.SpeechRecognition = FK;
  });
  await page.goto(URL_ + '?app');
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.goto(URL_ + '?app#/ajustes'); await page.locator('.settings').waitFor(); await page.waitForTimeout(400);
  if (await page.getByRole('button', { name: 'Desplegar todo' }).count()) await page.getByRole('button', { name: 'Desplegar todo' }).click();
  await page.getByRole('switch', { name: 'Asistente', exact: true }).click(); await page.locator('#asistente').waitFor(); await page.waitForTimeout(1500);
  await page.evaluate(() => localStorage.setItem('engrama.chat.keys', JSON.stringify({ v: 1, keys: [{ id: 'a', alias: 'Uno', provider: 'gemini', key: 'AIzaSyFAKEKEY0123456789abcdefABCD', status: 'active' }] })));
  const run = async (mode, standalone) => {
    await page.evaluate(([m, s]) => { m ? localStorage.setItem('e2e-sr', m) : localStorage.removeItem('e2e-sr'); s ? localStorage.setItem('e2e-standalone', '1') : localStorage.removeItem('e2e-standalone'); }, [mode, standalone]);
    await page.goto(URL_ + '?app#/hoy'); await page.reload(); await page.locator('.gx-dock').waitFor({ timeout: 8000 }).catch(async (e) => { await page.screenshot({ path: '/tmp/voz-fail.png' }); throw e; });
  };
  const field = () => page.locator('.chat-panel textarea');
  const dictar = () => page.locator('.gx-dock').getByRole('button', { name: 'Dictar' }).click({ delay: 30 });

  console.log('speech: API simulada');
  await run('ok', false);
  await dictar(); await field().waitFor();
  check(await page.evaluate(() => window.__srN === 1 && window.__gum === 0), 'empieza dentro del gesto y sin getUserMedia');
  await field().fill('antes');
  await page.evaluate(() => window.__sr.say('hola gre', false));
  await page.waitForTimeout(50);
  check(/hola gre/.test(await field().inputValue()), 'texto provisional en el campo');
  await page.evaluate(() => { window.__sr.say('hola grex', true); window.__sr.onend(); });
  check(/hola grex/.test(await field().inputValue()), 'texto final en el campo');
  check((await page.locator('.gx-voz-help').count()) === 0, 'sin ayuda de sistema cuando funciona');
  await page.keyboard.press('Escape');

  console.log('speech: API muda → watchdog');
  await run('mute', false);
  await dictar(); await field().waitFor();
  await page.locator('.gx-voz-help').first().waitFor({ timeout: 9000 });
  check(await page.evaluate(() => window.__aborted === 1), 'watchdog aborta el reconocimiento');
  check(await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA'), 'muda: campo enfocado');
  check((await page.locator('.gx-voz-msg[role=status]').count()) >= 1, 'muda: ayuda en región viva');

  console.log('system: sin API');
  await run(null, false);
  await dictar(); await field().waitFor();
  await page.locator('.gx-voz-help').first().waitFor();
  check(await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA' && window.__gum === 0), 'sin API: campo enfocado y ayuda, sin getUserMedia');

  console.log('system: standalone en iPad');
  await run('ok', true);
  await dictar(); await field().waitFor();
  await page.locator('.gx-voz-help').first().waitFor();
  check(await page.evaluate(() => !window.__srN), 'standalone iOS: no se usa SpeechRecognition');
  check((await page.locator('.gx-voz-msg').first().innerText()).includes('Toca el micrófono del teclado y habla'), 'ayuda de iPhone/iPad');
  check(await page.evaluate(() => document.activeElement?.tagName === 'TEXTAREA'), 'standalone: campo enfocado');
  await page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/voz-system.png` : '/tmp/voz-system.png' });
} catch (e) { failed++; console.error(e); }
await browser.close(); server.kill();
console.log(failed ? `FALLÓ (${failed})` : 'OK');
process.exit(failed ? 1 : 0);
