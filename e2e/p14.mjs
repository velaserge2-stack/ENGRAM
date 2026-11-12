// Prompt 14: asa de redimensionar fija, notas pesadas (funciones intactas) e imágenes del lienzo.
//   npm run build && npm run e2e:p14     (ONLY=asa|notas|img)
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { strToU8, zipSync } from 'fflate';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4188;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const run = (k) => !only || only.includes(k);
const check = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✓', m); };
const EX = new URL('../examples/', import.meta.url).pathname;

const larga = '# Larga\n\n' + Array.from({ length: 200 }, (_, i) => (i % 9 === 4 ? `- punto ${i}\n- otro ${i}` : `Bloque ${i}: el electrocardiograma muestra ritmo sinusal y ondas normales en la derivación ${i % 12}.`)).join('\n\n') + '\n';
const VAULT = zipSync({
  'notes/P14/Larga.md': strToU8(larga),
  'docs/guia-ecg.pdf': new Uint8Array(readFileSync(EX + 'docs/guia-ecg.pdf')),
  'docs/apuntes-neuro.docx': new Uint8Array(readFileSync(EX + 'docs/apuntes-neuro.docx')),
  'docs/neuro.csv': strToU8(Array.from({ length: 400 }, (_, i) => `fila ${i},${i * 2},texto ${i}`).join('\n')),
}, { level: 0 });

async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'es-MX' });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.goto(URL_ + '#/mazos');
  await page.getByRole('button', { name: 'Importar archivo' }).click();
  await page.locator('.sheet input[type=file]').first().setInputFiles({ name: 'p14.zip', mimeType: 'application/zip', buffer: Buffer.from(VAULT) });
  await page.locator('.sheet').getByRole('button', { name: 'Importar', exact: true }).click();
  await page.waitForTimeout(1200);
  for (let i = 0; i < 3 && (await page.locator('.scrim').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  return { ctx, page };
}

/** Posición del asa respecto al panel, scroll del contenido y tamaño guardado. */
const state = (page) => page.evaluate(() => {
  const w = document.querySelector('.canvas-plane > .win'), h = w.querySelector(':scope > .win-resize');
  const sc = [...w.querySelectorAll('.win-body, .win-body *')].find((x) => x.scrollHeight > x.clientHeight + 4 && getComputedStyle(x).overflowY !== 'visible');
  const a = w.getBoundingClientRect(), b = h?.getBoundingClientRect();
  // bloque visible arriba (lo que el usuario está leyendo)
  const r = sc?.getBoundingClientRect();
  const top = r ? document.elementFromPoint(r.left + 40, r.top + 12)?.closest('[aria-label="Editar bloque"]')?.textContent?.slice(0, 30) ?? null : null;
  return { has: !!h, dx: b ? Math.round(a.right - b.right) : null, dy: b ? Math.round(a.bottom - b.bottom) : null, inside: !!b && b.bottom <= a.bottom + 1 && b.right <= a.right + 1 && b.top >= a.top, cx: b ? b.x + b.width / 2 : 0, cy: b ? b.y + b.height / 2 : 0, w: parseFloat(w.style.width), h: parseFloat(w.style.height), scroll: sc ? Math.round(sc.scrollTop) : null, top, scrollMax: sc ? sc.scrollHeight - sc.clientHeight : null, focus: document.activeElement?.tagName };
});
const scrollTo = (page, f) => page.evaluate((f) => {
  const w = document.querySelector('.canvas-plane > .win');
  const sc = [...w.querySelectorAll('.win-body, .win-body *')].find((x) => x.scrollHeight > x.clientHeight + 4 && getComputedStyle(x).overflowY !== 'visible');
  if (sc) sc.scrollTop = (sc.scrollHeight - sc.clientHeight) * f;
}, f);
/** Arrastre con eventos de puntero sintéticos (táctil o Pencil) sobre el asa. */
const synth = (page, kind, x, y, dx, dy) => page.evaluate(({ kind, x, y, dx, dy }) => {
  const el = document.querySelector('.canvas-plane > .win > .win-resize');
  const ev = (t, px, py) => el.dispatchEvent(new PointerEvent(t, { pointerId: 40, pointerType: kind, clientX: px, clientY: py, bubbles: true, cancelable: true, isPrimary: true, pressure: 0.5 }));
  ev('pointerdown', x, y);
  for (let i = 1; i <= 6; i++) ev('pointermove', x + (dx * i) / 6, y + (dy * i) / 6);
  ev('pointerup', x + dx, y + dy);
}, { kind, x, y, dx, dy });
/** Zoom del lienzo a `k` anclado en la esquina superior izquierda del panel. */
async function zoomTo(page, k) {
  await page.evaluate((k) => {
    const wrap = document.querySelector('.canvas-wrap');
    const cur = parseFloat(wrap.querySelector('.chip:last-of-type')?.textContent ?? '100') / 100;
    const r = document.querySelector('.canvas-plane > .win').getBoundingClientRect();
    wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: -300 * Math.log(k / cur), ctrlKey: true, clientX: r.left + 1, clientY: r.top + 1, bubbles: true, cancelable: true }));
  }, k);
  await page.waitForTimeout(350);
  // que la esquina quede dentro de la pantalla (paneo con la rueda, sin Ctrl)
  await page.evaluate(() => {
    const wrap = document.querySelector('.canvas-wrap'), w = wrap.getBoundingClientRect();
    const r = document.querySelector('.canvas-plane > .win').getBoundingClientRect();
    const dx = Math.max(0, r.right - w.right + 220), dy = Math.max(0, r.bottom - w.bottom + 160);
    if (dx || dy) wrap.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: dy, clientX: w.left + 5, clientY: w.top + 5, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(350);
}

try {
  if (run('asa')) {
    const { ctx, page } = await fresh();
    for (const [label, path] of [['nota', 'notes/P14/Larga.md'], ['PDF', 'docs/guia-ecg.pdf'], ['documento', 'docs/apuntes-neuro.docx'], ['hoja', 'docs/neuro.csv']]) {
      console.log(`Asa de redimensionar · panel de ${label}`);
      await page.goto(URL_ + '#/espacios');
      await page.getByRole('button', { name: 'Nuevo espacio' }).first().click();
      await page.locator('.sheet input[name=n]').fill('Asa ' + label);
      await page.getByRole('button', { name: 'Crear', exact: true }).click();
      await page.getByRole('group', { name: 'Modo' }).getByRole('button', { name: 'Lienzo' }).click();
      await page.locator('.canvas-wrap').waitFor();
      await page.goto(URL_ + '#/espacios/abrir/' + encodeURIComponent(path));
      await page.locator('.canvas-plane > .win .win-body > *').first().waitFor();
      await page.waitForTimeout(label === 'nota' ? 600 : 1500);
      // tamaño de partida pequeño para que quepa a escala 2
      let s = await state(page);
      await page.mouse.move(s.cx, s.cy); await page.mouse.down(); await page.mouse.move(s.cx - 400, s.cy - 400, { steps: 4 }); await page.mouse.up();
      s = await state(page);
      const minW = label === 'nota' ? 480 : 260, minH = label === 'nota' ? 360 : 200;
      check(s.w === minW && s.h === minH, `achicar hasta el mínimo (${s.w}×${s.h})`);
      for (const k of [1, 0.5, 2]) {
        await zoomTo(page, k);
        for (const [f, kind] of [[1, 'mouse'], [0.5, 'touch'], [0, 'pen']]) {
          await scrollTo(page, f);
          await page.waitForTimeout(120);
          const a = await state(page);
          check(a.has && a.inside && Math.abs(a.dx) <= Math.max(1, k) && Math.abs(a.dy) <= Math.max(1, k), `k=${k}, scroll ${f * 100} %: asa en la esquina visible (${a.dx}, ${a.dy}${a.scrollMax ? `, scroll ${a.scroll}/${a.scrollMax}` : ''})`);
          const D = 60;
          if (kind === 'mouse') { await page.mouse.move(a.cx, a.cy); await page.mouse.down(); await page.mouse.move(a.cx + D, a.cy + D, { steps: 5 }); await page.mouse.up(); }
          else await synth(page, kind, a.cx, a.cy, D, D);
          await page.waitForTimeout(150);
          const b = await state(page);
          const want = Math.round(D / k);
          check(Math.abs(b.w - a.w - want) <= 2 && Math.abs(b.h - a.h - want) <= 2, `k=${k} · ${kind}: agranda ${Math.round(b.w - a.w)}×${Math.round(b.h - a.h)} (esperado ${want})`);
          check((b.top === a.top || b.scroll === b.scrollMax) && b.focus !== 'TEXTAREA', `k=${k} · ${kind}: no desplaza la nota ni abre el teclado`);
          if (kind === 'mouse') { await page.mouse.move(b.cx, b.cy); await page.mouse.down(); await page.mouse.move(b.cx - D, b.cy - D, { steps: 5 }); await page.mouse.up(); }
          else await synth(page, kind, b.cx, b.cy, -D, -D);
          await page.waitForTimeout(150);
          const c = await state(page);
          check(Math.abs(c.w - a.w) <= 2 && Math.abs(c.h - a.h) <= 2, `k=${k} · ${kind}: achica de vuelta (${c.w}×${c.h})`);
        }
      }
      await zoomTo(page, 1);
      // bordes: derecho solo ancho, inferior solo alto
      const e0 = await state(page);
      const edge = (side) => page.evaluate((side) => {
        // punto del borde dentro de la parte visible del lienzo (lejos de la barra y del minimapa)
        const r = document.querySelector(`.canvas-plane > .win > .win-edge.${side}`).getBoundingClientRect(), w = document.querySelector('.canvas-wrap').getBoundingClientRect();
        const mid = (a, b) => (a + b) / 2;
        return side === 'right' ? { x: r.x + r.width / 2, y: mid(Math.max(r.top, w.top + 80), Math.min(r.bottom, w.bottom - 160)) } : { x: mid(Math.max(r.left, w.left + 220), Math.min(r.right, w.right - 220)), y: r.y + r.height / 2 };
      }, side);
      let p = await edge('right');
      await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 50, p.y + 30, { steps: 4 }); await page.mouse.up();
      p = await edge('bottom');
      await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 30, p.y + 40, { steps: 4 }); await page.mouse.up();
      const e1 = await state(page);
      check(e1.w - e0.w === 50 && e1.h - e0.h === 40, `bordes: derecho +${e1.w - e0.w} de ancho, inferior +${e1.h - e0.h} de alto`);
      if (label === 'nota') await page.screenshot({ path: OUT + 'p14-asa-nota.png' });
    }
    // en pausa (dormido) no hay asa
    const asleep = await page.locator('.canvas-plane > .win.asleep').count();
    if (asleep) check(await page.locator('.canvas-plane > .win.asleep > .win-resize').count() === 0, 'panel en pausa: sin asa');
    await ctx.close();
  }
  console.log('OK');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
