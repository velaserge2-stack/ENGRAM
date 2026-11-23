// Mascota: 5 estados × 44/72 px × claro/oscuro; con reducedMotion no hay animaciones. Chromium, servidor de desarrollo.
//   node e2e/mascot.mjs   (PORT=4178; capturas en e2e/out/mascot/)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const pw = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
const PORT = Number(process.env.PORT) || 4178;
const OUT = new URL('./out/mascot/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('vite ' + c))); });
const STATES = ['idle', 'listening', 'thinking', 'responding', 'error'];
let bad = 0;
const browser = await pw.chromium.launch();
try {
  for (const reduced of [false, true]) for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ colorScheme: scheme, reducedMotion: reduced ? 'reduce' : 'no-preference', viewport: { width: 600, height: 240 } });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PORT}/index.html`);
    await page.evaluate(async (states) => {
            const { mount } = await import('/e2e/mascot-mount.mjs');
      document.body.innerHTML = '<div id="m" style="display:flex;gap:16px;padding:16px;flex-wrap:wrap"></div>';
      const box = document.getElementById('m');
      for (const size of [44, 72]) for (const s of states) {
        const d = document.createElement('div'); d.className = 'glass'; d.style.cssText = 'padding:8px;border-radius:16px';
        box.append(d); mount(d, s, size);
      }
    }, STATES);
    await page.waitForTimeout(700);
    const n = await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('.mascot')).length);
    if (reduced && n !== 0) { bad++; console.log('FALLA: animaciones con reduced-motion =', n); }
    if (!reduced && n === 0) { bad++; console.log('FALLA: sin animaciones en modo normal'); }
    await page.screenshot({ path: `${OUT}${scheme}-${reduced ? 'reduce' : 'motion'}.png` });
    await ctx.close();
  }
} finally { await browser.close(); server.kill(); }
console.log(bad ? `${bad} fallo(s)` : 'mascot e2e OK');
process.exit(bad ? 1 : 0);
