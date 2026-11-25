// Arreglo del reproductor: un clic en Reproducir hace sonar (contexto en marcha, master > 0), la
// música arranca en el mismo clic, el cursor encima no inicia audio, un play() rechazado avisa, y el
// mini reproductor es UNA sola pieza de vidrio (píldora y expandido).   npm run build && npm run e2e:reproductor
// Chromium con --autoplay-policy=user-gesture-required (como Safari: sin gesto no hay audio).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4178;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
const ARGS = { args: ['--autoplay-policy=user-gesture-required', '--use-fake-device-for-media-stream'] };
try { browser = await type.launch(type === pw.chromium ? ARGS : {}); } catch { type = pw.chromium; browser = await type.launch(ARGS); }
console.log('Navegador:', type.name());
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };

/** Registra cada play() de <audio> (cuándo y cómo terminó) y el último clic real. */
const PROBE = () => {
  window.__plays = [];
  addEventListener('click', () => (window.__click = performance.now()), true);
  const orig = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const r = { t: performance.now(), sinceClick: performance.now() - (window.__click ?? -1e9) };
    window.__plays.push(r);
    if (window.__reject) { r.err = window.__reject; return Promise.reject(new DOMException('no', window.__reject)); }
    const p = orig.call(this);
    p.then(() => (r.ok = true), (e) => (r.err = e.name));
    return p;
  };
};
// WAV de 3 s (tono) para la música
const wav = (() => { const rate = 8000, n = rate * 3, b = Buffer.alloc(44 + n * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 6) * 6000), 44 + i * 2); return b; })();

try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'es-MX' });
  await ctx.addInitScript(PROBE);
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_ + '?app');
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.goto(URL_ + '?app#/ajustes/addons');
  await page.getByRole('region', { name: 'Add-ons' }).getByRole('switch', { name: 'Sonido ambiente' }).check();
  await page.goto(URL_ + '?app#/hoy');
  await page.getByRole('button', { name: 'Sonido ambiente' }).click();
  const sh = page.getByRole('dialog', { name: 'Sonido ambiente' });

  console.log('Ambiente: un clic en Reproducir');
  await sh.getByRole('slider', { name: 'Volumen de Lluvia' }).fill('60');
  await sh.getByRole('button', { name: 'Reproducir', exact: true }).first().click();
  await page.waitForTimeout(400);
  let d = await page.evaluate(() => window.__ambient.diag());
  check(d.state === 'running' && d.master > 0 && !d.muted, `AudioContext en marcha y master > 0 (${d.state}, master ${d.master})`);
  await sh.getByRole('button', { name: 'Probar sonido' }).click();
  await page.locator('.toast', { hasText: 'Debería oírse un tono corto' }).waitFor({ timeout: 3000 });
  check(true, '«Probar sonido» suena y lo dice');
  await sh.getByRole('button', { name: 'Detener' }).click();

  console.log('Música: arranca en el mismo clic');
  await sh.locator('input[type=file]').setInputFiles({ name: 'tono.wav', mimeType: 'audio/wav', buffer: wav });
  await sh.locator('.track').first().waitFor();
  await page.evaluate(() => (window.__plays = []));
  await sh.getByRole('button', { name: 'Reproducir', exact: true }).last().click();
  await page.waitForFunction(() => window.__player.playing, null, { timeout: 5000 });
  const plays = await page.evaluate(() => window.__plays);
  check(plays.length >= 1 && plays[0].sinceClick < 50, `el primer play() de la música ocurre dentro del clic (${Math.round(plays[0]?.sinceClick)} ms tras el clic)`);
  check(await page.evaluate(() => window.__player.playing), 'la música suena (el <audio> no está en pausa)');
  await sh.getByRole('button', { name: 'Cerrar' }).click();

  console.log('Mini reproductor: pastilla en la barra, controles en un Popover');
  const mini = page.locator('.mini-amb');
  await mini.waitFor();
  const pop = page.locator('.mini-amb-pop');
  const glassIn = () => page.evaluate(() => { const m = document.querySelector('.mini-amb'); return [m, ...m.querySelectorAll('*')].filter((e) => { const f = getComputedStyle(e).backdropFilter; return f && f !== 'none'; }).length; });
  check(await mini.count() === 1 && await glassIn() === 1, `píldora: un solo mini con un solo backdrop-filter (${await glassIn()})`);
  const geo = await page.evaluate(() => { const m = document.querySelector('.mini-amb'), p = document.querySelector('.mini-pomo').getBoundingClientRect(), r = m.getBoundingClientRect(); return { inBar: !!m.closest('.topbar'), pos: getComputedStyle(m).position, h: r.height, dx: r.left - p.right, dy: Math.abs(r.top + r.height / 2 - (p.top + p.height / 2)) }; });
  check(geo.inBar && geo.pos !== 'fixed' && geo.h >= 44 && geo.dx >= 0 && geo.dx < 24 && geo.dy < 4, `está en la barra, pegado al reloj, sin position:fixed (dx ${Math.round(geo.dx)}, alto ${Math.round(geo.h)})`);
  await mini.screenshot({ path: OUT + 'reproductor-pildora.png' });
  // pasar el cursor no abre ni inicia audio
  await page.evaluate(() => (window.__plays = []));
  await mini.hover();
  await page.waitForTimeout(400);
  check(await pop.count() === 0 && (await page.evaluate(() => window.__plays.length)) === 0, 'pasar el cursor no abre controles ni inicia audio');
  // tocar abre el Popover con foco; Esc lo cierra y devuelve el foco a la pastilla
  await mini.getByRole('button', { name: /^Controles de/ }).click();
  await pop.waitFor();
  await page.waitForTimeout(100); 
  check(await pop.getByRole('slider', { name: 'Volumen general' }).count() === 1 && await page.evaluate(() => !!document.activeElement?.closest('.mini-amb-pop')), 'tocar abre el Popover (volumen, pausa) y el foco entra');
  await pop.screenshot({ path: OUT + 'reproductor-expandido.png' });
  await page.keyboard.press('Escape');
  await pop.waitFor({ state: 'detached' });
  check(await page.evaluate(() => document.activeElement?.classList.contains('mini-amb-main')), 'Esc lo cierra y el foco vuelve a la pastilla');
  // pausar y reanudar desde el Popover
  const act = async (name) => { await mini.getByRole('button', { name: /^Controles de/ }).click(); await pop.waitFor(); await pop.getByRole('button', { name, exact: true }).click(); await page.keyboard.press('Escape'); await pop.waitFor({ state: 'detached' }); };
  await act('Pausar');
  await page.waitForTimeout(300);
  check(!(await page.evaluate(() => window.__player.playing || window.__ambient.playing)), 'pausar desde el Popover detiene');
  await act('Reanudar');
  await page.waitForFunction(() => window.__player.playing, null, { timeout: 3000 });
  check(true, 'reanudar desde el Popover con un toque');

  console.log('play() rechazado');
  await act('Pausar');
  await page.evaluate(() => (window.__reject = 'NotAllowedError'));
  await act('Reanudar');
  await page.locator('.toast', { hasText: 'no dejó reproducir' }).waitFor({ timeout: 3000 });
  check(!(await page.evaluate(() => window.__player.playing)), 'avisa con la causa y queda detenido');
  await page.evaluate(() => (window.__reject = null));

  // lienzo con 2 paneles: el mini no tapa minimapa, «Ajustar», dock ni el botón del minimapa; capturas claro/oscuro
  await page.goto(URL_ + '?app#/espacios');
  await page.getByRole('button', { name: 'Nuevo espacio' }).first().click();
  await page.locator('.sheet input[name=n]').fill('Música');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.getByRole('group', { name: 'Modo' }).getByRole('button', { name: 'Lienzo' }).click();
  for (let i = 0; i < 2; i++) { await page.getByRole('button', { name: 'Añadir panel', exact: true }).click(); await page.getByRole('menuitem', { name: 'Añadir panel Pomodoro', exact: true }).evaluate((x) => x.click()); await page.waitForTimeout(200); }
  const lienzo = page.url();
  for (const [m, label] of [['claro', 'Claro'], ['oscuro', 'Oscuro']]) {
    await page.goto(URL_ + '?app#/ajustes');
    await page.locator('.settings').waitFor();
    if (await page.getByRole('button', { name: 'Desplegar todo' }).count()) await page.getByRole('button', { name: 'Desplegar todo' }).click();
    await page.getByRole('group', { name: 'Modo del vidrio' }).getByRole('button', { name: label, exact: true }).click();
    await page.goto(lienzo);
    await page.locator('.canvas-wrap').waitFor();
    if (!(await page.evaluate(() => window.__player.playing))) {
      await page.getByRole('button', { name: 'Sonido ambiente' }).click();
      await page.getByRole('dialog', { name: 'Sonido ambiente' }).getByRole('button', { name: 'Reproducir', exact: true }).last().click();
      await page.getByRole('dialog', { name: 'Sonido ambiente' }).getByRole('button', { name: 'Cerrar' }).click();
    }
    await page.locator('.mini-amb').waitFor();
    await page.waitForTimeout(500);
    const hits = await page.evaluate(() => {
      const m = document.querySelector('.mini-amb').getBoundingClientRect();
      return ['.minimap', '.minimap-toggle', '.dock > *', '.canvas-wrap > .row'].flatMap((sel) => [...document.querySelectorAll(sel)].map((e) => [sel, e.getBoundingClientRect()])).filter(([, r]) => r.width && m.left < r.right && r.left < m.right && m.top < r.bottom && r.top < m.bottom).map(([sel]) => sel);
    });
    check(!hits.length, `${m}: el mini no tapa minimapa, «Ajustar», dock ni botón del minimapa${hits.length ? ' (' + hits.join(', ') + ')' : ''}`);
    await page.screenshot({ path: OUT + `reproductor-${m}.png` });
  }
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
