// Prompt 15: minimapa del lienzo (tocar centra, arrastrar mueve en el sentido correcto, nunca
// desaparece, sin paneo inverso, paneles visibles y enfocado, tamaño reactivo, plegable y teclado).
//   npm run build && npm run e2e:p15
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4189;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
const check = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✓', m); };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/** Vista actual (del transform del plano) y geometría del lienzo, del minimapa y de su rectángulo. */
const geo = (page) => page.evaluate(() => {
  const plane = document.querySelector('.canvas-plane'), wrap = document.querySelector('.canvas-wrap').getBoundingClientRect();
  const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(plane.style.transform);
  const mini = document.querySelector('.minimap'), b = mini?.querySelector('b');
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  return { v: { x: +m[1], y: +m[2], k: +m[3] }, W: wrap.width, H: wrap.height, wrap: { x: wrap.x, y: wrap.y }, mini: R(mini), b: R(b), panels: mini ? mini.querySelectorAll('i').length : 0, visible: document.querySelectorAll('.canvas-plane > .win').length };
});
/** Punto del mundo bajo un píxel del minimapa (con la escala que da el rectángulo de vista). */
const worldAt = (g, px, py) => { const mk = g.b.w / (g.W / g.v.k); return { x: -g.v.x / g.v.k + (px - g.b.x) / mk, y: -g.v.y / g.v.k + (py - g.b.y) / mk }; };
const center = (g) => ({ x: (g.W / 2 - g.v.x) / g.v.k, y: (g.H / 2 - g.v.y) / g.v.k });
/** Tocar o arrastrar con eventos de puntero (táctil, Pencil) o con el ratón real. */
async function drag(page, kind, x, y, dx = 0, dy = 0) {
  if (kind === 'mouse') { await page.mouse.move(x, y); await page.mouse.down(); if (dx || dy) await page.mouse.move(x + dx, y + dy, { steps: 6 }); await page.mouse.up(); }
  else await page.evaluate(({ kind, x, y, dx, dy }) => {
    const el = document.elementFromPoint(x, y);
    const ev = (t, px, py) => el.dispatchEvent(new PointerEvent(t, { pointerId: 30, pointerType: kind, clientX: px, clientY: py, bubbles: true, cancelable: true, isPrimary: true, pressure: 0.5 }));
    ev('pointerdown', x, y);
    for (let i = 1; i <= 6; i++) ev('pointermove', x + (dx * i) / 6, y + (dy * i) / 6);
    ev('pointerup', x + dx, y + dy);
  }, { kind, x, y, dx, dy });
  await page.waitForTimeout(350);
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'es-MX' });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.goto(URL_ + '#/espacios');
  await page.getByRole('button', { name: 'Nuevo espacio' }).first().click();
  await page.locator('.sheet input[name=n]').fill('Mapa');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.getByRole('group', { name: 'Modo' }).getByRole('button', { name: 'Lienzo' }).click();
  await page.locator('.canvas-wrap').waitFor();
  for (let i = 0; i < 7; i++) {
    await page.getByRole('button', { name: 'Añadir panel', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Añadir panel ' + (i % 2 ? 'Pomodoro' : 'Estadísticas'), exact: true }).evaluate((x) => x.click());
    await page.waitForTimeout(150);
  }
  // uno minimizado: no debe aparecer en el minimapa
  await page.locator('.canvas-plane > .win').last().getByRole('button', { name: /Minimizar/ }).evaluate((b) => b.click());
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Ajustar al contenido' }).evaluate((b) => b.click());
  await page.waitForTimeout(400);
  let g = await geo(page);
  console.log('Minimapa con', g.visible, 'paneles visibles');
  check(g.mini && g.b, 'el minimapa y su rectángulo de vista existen');
  check(g.panels === g.visible && g.visible === 6, `7. solo los paneles visibles (${g.panels} de ${g.visible}; el minimizado no)`);

  for (const kind of ['mouse', 'touch', 'pen']) {
    console.log(`Puntero: ${kind}`);
    // 1. tocar una esquina centra la vista allí (sin cambiar el zoom)
    g = await geo(page);
    const px = g.mini.x + 10, py = g.mini.y + g.mini.h - 10;
    const target = worldAt(g, px, py);
    await drag(page, kind, px, py);
    let h = await geo(page);
    const c = center(h);
    check(h.v.k === g.v.k && near(c.x, target.x, 3 / (h.b.w / (h.W / h.v.k))) && near(c.y, target.y, 3 / (h.b.w / (h.W / h.v.k))), `1. tocar una esquina centra la vista allí (${Math.round(c.x)},${Math.round(c.y)} ≈ ${Math.round(target.x)},${Math.round(target.y)}), zoom igual`);
    // 2 y 4. arrastrar el rectángulo mueve la vista en el mismo sentido (sin paneo inverso)
    g = h;
    const c0 = center(g);
    await drag(page, kind, g.b.x + g.b.w / 2, g.b.y + g.b.h / 2, 24, -12);
    h = await geo(page);
    const c1 = center(h), mk = g.b.w / (g.W / g.v.k);
    check(c1.x - c0.x > 0 && c1.y - c0.y < 0 && near(c1.x - c0.x, 24 / mk, 3 / mk) && near(c1.y - c0.y, -12 / mk, 3 / mk), `2/4. arrastrar el rectángulo 24,-12 px mueve la vista ${Math.round(c1.x - c0.x)},${Math.round(c1.y - c0.y)} (esperado ${Math.round(24 / mk)},${Math.round(-12 / mk)}), sin paneo inverso`);
  }

  console.log('Lejos de los paneles y con el zoom al mínimo');
  const wb = await page.locator('.canvas-wrap').boundingBox();
  await page.mouse.move(wb.x + 300, wb.y + 300);
  for (let i = 0; i < 40; i++) await page.mouse.wheel(400, 300);
  await page.waitForTimeout(400);
  const inside = (g) => g.b && g.b.x >= g.mini.x - 1 && g.b.y >= g.mini.y - 1 && g.b.x + g.b.w <= g.mini.x + g.mini.w + 1 && g.b.y + g.b.h <= g.mini.y + g.mini.h + 1;
  g = await geo(page);
  check(inside(g), '3. el rectángulo sigue dentro del minimapa tras desplazarse muy lejos');
  await page.keyboard.down('Control');
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 300);
  await page.keyboard.up('Control');
  await page.waitForTimeout(400);
  g = await geo(page);
  check(g.v.k === 0.1 && inside(g), `3. y con el zoom al mínimo (${g.v.k})`);

  console.log('Tocar un panel en el minimapa');
  await page.getByRole('button', { name: 'Ajustar al contenido' }).evaluate((b) => b.click());
  await page.waitForTimeout(400);
  const pick = await page.evaluate(() => {
    const is = [...document.querySelectorAll('.minimap i')];
    const zs = [...document.querySelectorAll('.canvas-plane > .win')].map((w) => +w.style.zIndex);
    const r = is[0].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: is[0].dataset.id, maxZ: Math.max(...zs) };
  });
  await drag(page, 'touch', pick.x, pick.y);
  g = await geo(page);
  const pz = await page.evaluate((id) => { const w = document.querySelector(`.canvas-plane > .win[data-id="${id}"]`); const r = w.getBoundingClientRect(), c = document.querySelector('.canvas-wrap').getBoundingClientRect(); return { z: +w.style.zIndex, dx: r.x + r.width / 2 - (c.x + c.width / 2), dy: r.y + r.height / 2 - (c.y + c.height / 2), focused: w.classList.contains('focused') }; }, pick.id);
  check(pz.z >= pick.maxZ && pz.focused && Math.abs(pz.dx) < 4 && Math.abs(pz.dy) < 4, `5. el panel pasa al frente, con foco, y queda centrado (${Math.round(pz.dx)},${Math.round(pz.dy)})`);
  check(await page.locator('.minimap i.on').count() === 1, '5. el panel enfocado se marca en el minimapa');

  console.log('Tamaño de la ventana');
  g = await geo(page);
  await page.setViewportSize({ width: 820, height: 1180 }); // «girar» el iPad
  await page.waitForTimeout(500);
  const r = await geo(page);
  check(Math.abs(g.b.w / g.b.h - g.W / g.H) < 0.05 && Math.abs(r.b.w / r.b.h - r.W / r.H) < 0.05 && r.W !== g.W, `6. al girar, el rectángulo toma la nueva proporción (${(r.b.w / r.b.h).toFixed(2)} ≈ ${(r.W / r.H).toFixed(2)})`);
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.waitForTimeout(500);

  console.log('Teclado');
  g = await geo(page);
  await page.locator('.minimap').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  let h = await geo(page);
  check(center(h).x > center(g).x && h.v.k === g.v.k, '→ desplaza la vista a la derecha sin cambiar el zoom');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check(await page.evaluate(() => { const w = document.querySelector('.canvas-plane > .win.focused'), r = w.getBoundingClientRect(), c = document.querySelector('.canvas-wrap').getBoundingClientRect(); return Math.abs(r.x + r.width / 2 - (c.x + c.width / 2)) < 4; }), 'Intro centra el panel enfocado');
  check(await page.locator('.minimap').getAttribute('aria-label') === 'Minimapa del lienzo' && await page.locator('.minimap[aria-hidden]').count() === 0, 'rol y aria-label traducidos, sin aria-hidden');

  console.log('Pellizco, rueda y «Ajustar al contenido» siguen igual');
  g = await geo(page);
  await page.mouse.move(wb.x + 200, wb.y + 200);
  await page.mouse.wheel(30, 20);
  await page.waitForTimeout(300);
  h = await geo(page);
  check(near(h.v.x, g.v.x - 30, 0.5) && near(h.v.y, g.v.y - 20, 0.5), 'rueda: paneo igual que antes');
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -150); await page.keyboard.up('Control');
  await page.waitForTimeout(300);
  check((await geo(page)).v.k > h.v.k, 'Ctrl+rueda (pellizco): zoom igual que antes');
  // lejos de los paneles y luego «Ajustar» (clic del DOM: con el ratón, la captura del puntero del lienzo
  // se queda el clic de los botones de abajo; fallo previo, fuera de este prompt, ver DECISIONS)
  for (let i = 0; i < 10; i++) await page.mouse.wheel(400, 300);
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Ajustar al contenido' }).evaluate((b) => b.click());
  await page.waitForTimeout(400);
  check(await page.evaluate(() => { const c = document.querySelector('.canvas-wrap').getBoundingClientRect(); return [...document.querySelectorAll('.canvas-plane > .win')].every((w) => { const r = w.getBoundingClientRect(); return r.x >= c.x - 1 && r.y >= c.y - 1 && r.right <= c.right + 1 && r.bottom <= c.bottom + 1; }); }), '«Ajustar al contenido»: todos los paneles a la vista');
  await page.screenshot({ path: OUT + 'p15-minimapa.png' });

  console.log('Plegar y recargar');
  const before = (await geo(page)).v;
  await page.getByRole('button', { name: 'Ocultar minimapa' }).click();
  await page.waitForTimeout(700);
  check(await page.locator('.minimap').count() === 0, 'plegar oculta el minimapa');
  await page.reload();
  await page.locator('.canvas-wrap').waitFor();
  await page.waitForTimeout(500);
  const after = (await geo(page)).v;
  check(await page.locator('.minimap').count() === 0 && await page.getByRole('button', { name: 'Mostrar minimapa' }).count() === 1, '9. el estado plegado se conserva al recargar');
  check(near(after.x, before.x, 0.5) && near(after.y, before.y, 0.5) && near(after.k, before.k, 0.001), '9. la vista se conserva al recargar');
  await page.getByRole('button', { name: 'Mostrar minimapa' }).click();
  await page.locator('.minimap').waitFor();
  check(true, 'mostrar de nuevo');
  await ctx.close();
  console.log('OK');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
