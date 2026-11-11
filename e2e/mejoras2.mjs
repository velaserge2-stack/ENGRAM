// Flujos de "Mejoras 2" (bloque A): idiomas, capas, minimizar todo, tooltips.
//   npm run build && npm run e2e:mejoras2
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = 4178;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
const errors = [];
const check = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✓', m); };
const only = (process.env.ONLY || 'lang').split(',');
const SCREENS = ['hoy', 'mazos', 'estudiar', 'explorar', 'simulacros', 'calendario', 'notas', 'espacios', 'estadisticas', 'ajustes', 'bandeja', 'addons'];
try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'es-MX' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();

  if (only.includes('lang')) {
    await page.goto(URL_ + '#/ajustes');
    const grp = page.getByRole('group', { name: 'Idioma' });
    await grp.getByRole('button', { name: 'English' }).click();
    await page.getByRole('heading', { name: 'Settings', level: 1 }).waitFor({ timeout: 3000 });
    check(await page.evaluate(() => document.documentElement.lang) === 'en', 'cambio instantáneo a inglés, <html lang="en">');
    await page.goto(URL_ + '#/hoy');
    await page.getByRole('heading', { name: 'Today', level: 1 }).waitFor();
    await page.goto(URL_ + '#/ajustes');
    await page.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'Français' }).click();
    await page.getByRole('heading', { name: 'Réglages', level: 1 }).waitFor({ timeout: 3000 });
    check(await page.evaluate(() => document.documentElement.lang) === 'fr', 'cambio instantáneo a francés');
    await page.waitForTimeout(800);
    await page.reload();
    await page.getByRole('heading', { name: 'Réglages', level: 1 }).waitFor();
    check(true, 'el idioma elegido persiste tras recargar');
    await page.getByRole('group', { name: 'Langue' }).getByRole('button', { name: /^Auto/ }).click();
    await page.getByRole('heading', { name: 'Ajustes', level: 1 }).waitFor({ timeout: 3000 });
    check(true, 'Automático vuelve al idioma del dispositivo (es-MX)');

    // pseudoidioma +40 %: nada se desborda ni se recorta
    await page.goto(URL_ + '#/design');
    await page.getByRole('group', { name: 'Idioma de prueba' }).getByRole('button', { name: 'Pseudo +40 %' }).click();
    await page.waitForTimeout(300);
    const fails = [];
    for (const w of [1366, 1024, 834]) {
      await page.setViewportSize({ width: w, height: w === 834 ? 1194 : 768 });
      for (const r of SCREENS) {
        await page.goto(URL_ + '#/' + r);
        await page.waitForTimeout(350);
        const res = await page.evaluate(() => {
          const out = [];
          const hs = document.documentElement.scrollWidth - innerWidth;
          if (hs > 1) { const wide = [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed').slice(-3).map((e) => e.className || e.tagName); out.push('scroll horizontal ' + hs + 'px ' + wide.join(' | ')); }
          for (const el of document.querySelectorAll('button, .chip, .seg button, h1, h2, .tab, label')) {
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || !el.getClientRects().length) continue;
            const clipX = cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 2 && cs.textOverflow !== 'ellipsis';
            if (clipX) out.push((el.getAttribute('aria-label') || el.textContent || '').slice(0, 40));
          }
          return out;
        });
        if (res.length) console.log('   ', w, r, res.slice(0, 6));
        if (res.length) fails.push(`${w} ${r}`);
      }
    }
    check(fails.length === 0, 'pseudoidioma +40 % sin desbordes en ' + SCREENS.length + ' pantallas × 3 anchos' + (fails.length ? ': ' + fails.join(', ') : ''));
    await page.screenshot({ path: OUT + 'mejora2-pseudo.png' });
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.goto(URL_ + '#/design');
    await page.getByRole('button', { name: 'ES', exact: true }).click();
  }

  check(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log('\nOK');
} catch (e) {
  console.error('Errores de consola:', errors);
  for (const c of browser.contexts()) for (const [i, pg] of c.pages().entries()) await pg.screenshot({ path: OUT + `mejora2-fallo-${i}.png` }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  server.kill();
}
