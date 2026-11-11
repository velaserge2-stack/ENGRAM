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
const only = (process.env.ONLY || 'lang,layers,minall').split(',');
const EX = new URL('../examples/', import.meta.url).pathname;
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

  if (only.includes('layers')) {
    const dialogOk = async (what) => {
      const d = page.getByRole('dialog').last();
      await d.waitFor();
      const r = await d.evaluate((el) => {
        const b = el.getBoundingClientRect();
        const top = document.elementFromPoint(b.left + b.width / 2, b.top + 30);
        const scrim = el.parentElement;
        return { inside: b.left >= 0 && b.top >= 0 && b.right <= innerWidth + 0.5 && b.bottom <= innerHeight + 0.5, onTop: el.contains(top), w: b.width,
          portal: scrim.parentElement === document.body, scrimBg: getComputedStyle(scrim).backgroundColor, cx: Math.abs(b.left + b.width / 2 - innerWidth / 2) };
      });
      check(r.inside && r.onTop && r.portal && r.cx < 2 && r.w <= 562 && /0\.5\)$/.test(r.scrimBg), `${what}: modal centrado, dentro del viewport, encima de todo, con velo (${Math.round(r.w)} px)`);
      // foco atrapado
      for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
      check(await d.evaluate((el) => el.contains(document.activeElement)), `${what}: el foco no sale del modal`);
      await page.keyboard.press('Escape');
      await d.waitFor({ state: 'detached' });
    };
    // Papelera de Notas (antes quedaba dentro del explorador)
    await page.goto(URL_ + '#/notas');
    await page.getByRole('button', { name: 'Papelera' }).click();
    await dialogOk('Papelera de Notas');
    // Ajustes del mazo desde Hoy
    await page.goto(URL_ + '#/hoy');
    const row = page.locator('tr').filter({ hasText: 'Cardiología' }).first();
    await row.click({ position: { x: 300, y: 10 } });
    await page.getByRole('button', { name: /^Opciones de/ }).first().click();
    await dialogOk('Opciones del mazo desde Hoy');
    // tocar fuera cierra
    await page.getByRole('button', { name: /^Opciones de/ }).first().click();
    await page.getByRole('dialog').waitFor();
    await page.mouse.click(5, 400);
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    check(true, 'tocar fuera cierra el modal');

    // Lienzo: 6 paneles sin solaparse; tocar uno lo trae al frente
    await page.goto(URL_ + '#/espacios');
    await page.getByRole('button', { name: 'Nuevo espacio' }).click();
    await page.getByLabel('Nombre (materia o examen)').fill('Capas');
    await page.getByRole('button', { name: 'Crear', exact: true }).click();
    await page.getByRole('group', { name: 'Modo' }).getByRole('button', { name: 'Lienzo' }).click();
    for (const n of ['Pomodoro', 'Estadísticas', 'Imagen', 'PDF', 'Documento', 'Hoja']) {
      await page.getByRole('button', { name: 'Añadir panel ' + n }).click();
      await page.waitForTimeout(150);
    }
    const rects = await page.locator('.canvas-plane > .win').evaluateAll((els) => els.map((e) => ({ x: e.offsetLeft, y: e.offsetTop, w: e.offsetWidth, h: e.offsetHeight })));
    const over = rects.some((a, i) => rects.some((b, j) => j > i && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
    check(rects.length === 6 && !over, `6 paneles en el lienzo sin solaparse (${rects.map((r) => `${r.x},${r.y}`).join(' ')})`);
    // un panel visible que no esté al frente
    const idx = await page.locator('.canvas-plane > .win').evaluateAll((els) => { const w = document.querySelector('.canvas-wrap').getBoundingClientRect(); return els.findIndex((e) => { const r = e.querySelector('.win-bar').getBoundingClientRect(); return Number(e.style.zIndex) < 6 && r.left + 80 > w.left && r.left + 80 < w.right && r.top + 10 > w.top && r.top + 10 < w.bottom; }); });
    const bar = await page.locator('.canvas-plane > .win').nth(idx).locator('.win-bar').boundingBox();
    await page.mouse.click(bar.x + 80, bar.y + 10);
    await page.waitForTimeout(200);
    const zs = await page.locator('.canvas-plane > .win').evaluateAll((els) => els.map((e) => Number(e.style.zIndex)));
    check(idx >= 0 && zs[idx] === 6 && [...zs].sort().join() === '1,2,3,4,5,6', 'tocar un panel lo trae al frente; z normalizados 1…6');
    await page.screenshot({ path: OUT + 'mejora2-lienzo.png' });
  }

  if (only.includes('minall')) {
    // simulacro en marcha
    await page.goto(URL_ + '#/simulacros/importar');
    const fc = page.waitForEvent('filechooser');
    await page.getByText('Elegir archivo').click();
    await (await fc).setFiles(EX + 'simulacros/cardio-parcial.md');
    await page.getByLabel('Respuesta 5').fill('A');
    await page.getByLabel('Respuesta 5').blur();
    await page.getByRole('button', { name: /Guardar banco/ }).click();
    await page.getByRole('button', { name: 'Crear simulacro' }).click();
    await page.getByRole('button', { name: /Empezar \(5 preguntas\)/ }).click();
    await page.getByRole('timer').waitFor();
    await page.keyboard.press('a');
    await page.waitForTimeout(400);

    await page.goto(URL_ + '#/espacios');
    await page.getByRole('button', { name: 'Nuevo espacio' }).click();
    await page.getByLabel('Nombre (materia o examen)').fill('Todo');
    await page.locator('.sheet select').selectOption('Repaso');
    await page.getByRole('button', { name: 'Crear', exact: true }).click();
    await page.locator('.win').first().waitFor();
    check(await page.getByRole('button', { name: 'Minimizar Estudio' }).count() === 1, 'la sesión de estudio tiene botón de minimizar');
    await page.getByRole('button', { name: 'Añadir panel Simulacro' }).click();
    await page.getByRole('link', { name: 'Continuar simulacro' }).waitFor();
    check(true, 'el panel de simulacro ofrece continuar el intento en curso');
    await page.getByRole('button', { name: 'Minimizar todos' }).first().click();
    await page.waitForTimeout(300);
    check(await page.locator('.win').count() === 0, '«Minimizar todos» manda todos los paneles a la bandeja');
    const sim = page.getByRole('button', { name: /^Simulacro, minimizado/ });
    const t1 = await sim.locator('.tray-live').textContent();
    await page.waitForTimeout(2100);
    const t2 = await sim.locator('.tray-live').textContent();
    check(/^\d\d:\d\d$/.test(t1) && t1 !== t2, `el cuadrito del simulacro muestra el tiempo restante y sigue corriendo (${t1} → ${t2})`);
    await page.getByRole('button', { name: 'Restaurar todos' }).first().click();
    await page.waitForTimeout(300);
    check(await page.locator('.win').count() === 3, '«Restaurar todos» en mosaico devuelve 3 paneles (el resto queda en la bandeja)');
    // también desde el dock
    await page.locator('.dock').getByRole('button', { name: 'Minimizar todos' }).click();
    await page.waitForTimeout(300);
    check(await page.locator('.win').count() === 0, 'el dock también minimiza todos');
    await page.locator('.dock').getByRole('button', { name: 'Restaurar todos' }).click();
    await page.waitForTimeout(300);
    // Hoy: el panel de mazos también se minimiza
    await page.goto(URL_ + '#/hoy');
    await page.getByRole('button', { name: 'Minimizar Mazos' }).click();
    await page.getByRole('button', { name: /^Mazos, minimizado/ }).waitFor();
    await page.getByRole('button', { name: /^Mazos, minimizado/ }).click();
    await page.locator('table.decks').waitFor();
    check(true, 'en Hoy el panel de mazos se minimiza y se restaura');
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
