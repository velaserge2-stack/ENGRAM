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

const larga = '# Larga\n\n' + Array.from({ length: 200 }, (_, i) => (i === 150 ? '![[p14-a.png]]' : i === 199 ? 'Bloque final con la palabra zanahoria.' : i % 9 === 4 ? `- punto ${i}\n- otro ${i}` : `Bloque ${i}: el electrocardiograma muestra ritmo sinusal y ondas normales en la derivación ${i % 12}.`)).join('\n\n') + '\n';
// PNG de 2×2 (gris)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAAAAABX3VL4AAAADklEQVR4nGNgYGBgYGAAAAAFAAGKM+MAAAAASUVORK5CYII=', 'base64');
const VAULT = zipSync({
  'notes/P14/Larga.md': strToU8(larga),
  'media/p14-a.png': new Uint8Array(PNG),
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
    // la esquina del panel a un sitio fijo y libre del lienzo (lejos del minimapa y de los bordes):
    // dónde aparece un panel nuevo depende del momento, y a veces quedaba fuera por la izquierda
    const dx = r.right - (w.left + w.width * 0.6), dy = r.bottom - (w.top + w.height * 0.55);
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) wrap.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: dy, clientX: w.left + 5, clientY: w.top + 5, bubbles: true, cancelable: true }));
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
  if (run('notas')) {
    const { ctx, page } = await fresh();
    console.log('Nota larga: buscar, imprimir, exportar, pestaña + panel y guardado');
    await page.goto(URL_ + '#/notas/P14/Larga.md');
    await page.locator('.doc .doc-chunk').first().waitFor();
    await page.waitForFunction(() => document.querySelector('.doc .doc-chunk:nth-child(6) [aria-label="Editar bloque"]'), null, { timeout: 8000 }); // el pintado en reposo completa los tramos
    const nb = await page.locator('.doc [aria-label="Editar bloque"]').count(), nc = await page.locator('.doc .doc-chunk').count();
    check(nc === Math.ceil(nb / 40), `${nb} bloques en ${nc} tramos de 40 con content-visibility`);
    await page.waitForTimeout(500);
    check(await page.evaluate(() => !document.querySelector('.doc img[data-media]').src), 'la imagen lejana aún no se carga (perezosa)');
    // buscar: la coincidencia está fuera de pantalla (último bloque)
    await page.getByRole('button', { name: 'Buscar en esta nota' }).first().click();
    await page.getByRole('searchbox', { name: 'Buscar en esta nota' }).fill('zanahoria');
    await page.locator('.find-bar .num', { hasText: '1 de 1' }).waitFor();
    await page.waitForTimeout(1800);
    const seen = await page.evaluate(() => { const el = [...document.querySelectorAll('.doc .md p')].find((p) => p.textContent.includes('zanahoria')); const r = el.getBoundingClientRect();  return r.top >= 0 && r.bottom <= innerHeight; });
    check(seen, 'buscar en esta nota: 1 de 1 y la coincidencia (fuera de pantalla) queda a la vista');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.print = () => (window.__printed = true); });
    await page.getByRole('button', { name: 'Compartir o exportar' }).first().click();
    await page.getByRole('button', { name: /PDF/ }).first().click();
    await page.waitForFunction(() => window.__printed === true, null, { timeout: 5000 });
    check(await page.evaluate(() => document.querySelector('.doc img[data-media]').src.startsWith('blob:')), 'imprimir/PDF: antes de imprimir se cargan todas las imágenes');
    await page.emulateMedia({ media: 'print' });
    check(await page.evaluate(() => [...document.querySelectorAll('.doc-chunk')].every((c) => getComputedStyle(c).contentVisibility === 'visible')), 'al imprimir todos los tramos se pintan (content-visibility: visible)');
    await page.emulateMedia({ media: 'screen' });
    // exportar .md y .docx
    for (const [btn, ext] of [[/Preparar \.md/, 'zip'], [/Preparar \.docx/, 'docx']]) {
      await page.getByRole('button', { name: 'Compartir o exportar' }).first().click();
      await page.getByRole('button', { name: btn }).click();
      const dl = page.waitForEvent('download');
      await page.getByRole('button', { name: new RegExp(`Guardar .*\\.${ext}`) }).click();
      const d = await dl;
      const size = readFileSync(await d.path()).length;
      check(d.suggestedFilename().endsWith('.' + ext) && size > 500, `exportar ${d.suggestedFilename()} (${size} bytes)`);
    }
    // editar un bloque a mitad y comprobar el archivo guardado
    await page.locator('.doc [aria-label="Editar bloque"]').nth(100).click();
    const ta = page.locator('.doc textarea').first();
    await ta.press('End');
    await page.keyboard.type(' añadido');
    await page.keyboard.press('Escape');
    // la misma nota en un panel del lienzo ve el cambio
    await page.goto(URL_ + '#/espacios/abrir/' + encodeURIComponent('notes/P14/Larga.md'));
    await page.locator('.win .doc').first().waitFor();
    await page.locator('.win .doc').first().getByText('añadido').waitFor({ timeout: 8000 }).catch(() => {}); // el panel pinta el resto en reposo
    check(await page.locator('.win .doc').first().getByText('añadido').count() === 1, 'pestaña y panel comparten el documento (el panel ve lo escrito)');
    await page.waitForTimeout(1200);
    await page.reload();
    await page.goto(URL_ + '#/notas/P14/Larga.md');
    await page.locator('.doc .doc-chunk').first().waitFor();
    // lo editado está en el 6.º tramo: se pinta en reposo tras abrir (si se hubiera perdido, no aparece nunca)
    await page.locator('.doc').getByText('añadido').waitFor({ timeout: 8000 }).catch(() => {});
    check(await page.locator('.doc').getByText('añadido').count() === 1, 'tras recargar, lo escrito sigue ahí');
    await ctx.close();
  }
  if (run('img')) {
    console.log('Imagen grande en un panel del lienzo');
    const { ctx, page } = await fresh();
    await ctx.addInitScript(() => {
      const live = new Set(); const c = URL.createObjectURL.bind(URL), r = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (o) => { const u = c(o); live.add(u); return u; };
      URL.revokeObjectURL = (u) => { live.delete(u); r(u); };
      window.__blobs = () => live.size;
    });
    // foto de 12 MP (4000×3000) generada en el navegador e importada a media/
    const b64 = await page.evaluate(async () => { const c = new OffscreenCanvas(4000, 3000), x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 4000, 3000); g.addColorStop(0, '#89a'); g.addColorStop(1, '#234'); x.fillStyle = g; x.fillRect(0, 0, 4000, 3000); const b = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 }); return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(b); }); });
    const orig = Buffer.from(b64, 'base64');
    await page.goto(URL_ + '#/mazos');
    await page.getByRole('button', { name: 'Importar archivo' }).click();
    await page.locator('.sheet input[type=file]').first().setInputFiles({ name: 'foto.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync({ 'media/foto-12mp.jpg': new Uint8Array(orig) }, { level: 0 })) });
    await page.locator('.sheet').getByRole('button', { name: 'Importar', exact: true }).click();
    await page.waitForTimeout(1000);
    for (let i = 0; i < 3 && (await page.locator('.scrim').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    await page.reload();
    await page.goto(URL_ + '#/espacios');
    await page.getByRole('button', { name: 'Nuevo espacio' }).first().click();
    await page.locator('.sheet input[name=n]').fill('Foto');
    await page.getByRole('button', { name: 'Crear', exact: true }).click();
    await page.getByRole('group', { name: 'Modo' }).getByRole('button', { name: 'Lienzo' }).click();
    await page.locator('.canvas-wrap').waitFor();
    const t0 = Date.now();
    await page.goto(URL_ + '#/espacios/abrir/' + encodeURIComponent('media/foto-12mp.jpg'));
    const img = page.locator('.canvas-plane .win .img-view img');
    await page.waitForFunction(() => { const i = document.querySelector('.canvas-plane .win .img-view img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
    const ms = Date.now() - t0;
    const nat = await img.evaluate((i) => [i.naturalWidth, i.clientWidth]);
    check(nat[0] < 4000 && nat[0] >= nat[1], `muestra una versión reducida (${nat[0]} px de ancho para ${nat[1]} px en pantalla) en ${ms} ms`);
    // zoom propio: Ctrl+rueda sobre la imagen la acerca a ella (no al lienzo)
    const chip0 = await page.locator('.canvas-wrap .chip').last().innerText();
    const bb = await img.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -400); await page.keyboard.up('Control');
    await page.waitForTimeout(400);
    check(await img.evaluate((i) => /scale\((?!1\))/.test(i.style.transform)) && (await page.locator('.canvas-wrap .chip').last().innerText()) === chip0, 'el pellizco/Ctrl+rueda sobre la imagen la acerca a ella; el lienzo no cambia');
    await page.waitForFunction(() => document.querySelector('.canvas-plane .win .img-view img')?.naturalWidth > 640, null, { timeout: 15000 }).catch(() => {});
    check((await img.evaluate((i) => i.naturalWidth)) > nat[0], `al acercar se pide una versión mayor (${await img.evaluate((i) => i.naturalWidth)} px)`);
    await page.getByRole('button', { name: 'Ajustar', exact: true }).click();
    await page.getByRole('button', { name: 'Ver original' }).click();
    await page.waitForFunction(() => document.querySelector('.canvas-plane .win .img-view img')?.naturalWidth === 4000, null, { timeout: 15000 });
    check(true, '«Ver original» carga el original (4000 px)');
    // el original no se tocó: respaldo → media/foto-12mp.jpg idéntico; la reducida vive en .app/cache/img
    await page.getByRole('button', { name: 'Cerrar panel' }).first().click();
    await page.waitForTimeout(400);
    check(await page.evaluate(() => window.__blobs()) === 0, 'al cerrar el panel no queda ninguna blob: viva');
    await page.goto(URL_ + '#/perfil');
    await page.getByRole('button', { name: /^Respaldo/ }).first().click();
    await page.getByRole('button', { name: 'Preparar respaldo (.zip)' }).click();
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Guardar en Archivos' }).click();
    const { unzipSync } = await import('fflate');
    const z = unzipSync(readFileSync(await (await dl).path()));
    check(Buffer.from(z['media/foto-12mp.jpg']).equals(orig), 'el original en media/ es idéntico byte a byte');
    check(!Object.keys(z).some((k) => k.startsWith('media/') && k !== 'media/foto-12mp.jpg' && /foto/.test(k)), 'ninguna versión reducida en media/');
    await ctx.close();
  }
  if (run('guardado')) {
    // mismo flujo en esta rama y en la base: el .md guardado debe ser idéntico byte a byte
    const { ctx, page } = await fresh();
    console.log('Archivo guardado tras editar un bloque');
    await page.goto(URL_ + '#/notas/P14/Larga.md');
    await page.locator('.doc [aria-label="Editar bloque"]').nth(100).waitFor();
    await page.locator('.doc [aria-label="Editar bloque"]').nth(100).click();
    await page.locator('.doc textarea').first().press('End');
    await page.keyboard.type(' añadido');
    await page.keyboard.press('Enter');
    await page.keyboard.type('nuevo bloque partido');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    // archivo guardado: respaldo .zip → notes/P14/Larga.md (se compara con la rama base, ver DECISIONS)
    await page.goto(URL_ + '#/perfil');
    await page.getByRole('button', { name: /^Respaldo/ }).first().click();
    await page.getByRole('button', { name: 'Preparar respaldo (.zip)' }).click();
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Guardar en Archivos' }).click();
    const { unzipSync } = await import('fflate');
    const saved = unzipSync(readFileSync(await (await dl).path()))['notes/P14/Larga.md'];
    const { createHash } = await import('node:crypto');
    const sha = createHash('sha256').update(saved).digest('hex');
    (await import('node:fs')).writeFileSync(OUT + 'p14-guardado.md', saved);
    console.log('  · guardado', saved.length, 'bytes, sha256', sha.slice(0, 16));
    if (process.env.SAVED_SHA) check(sha.startsWith(process.env.SAVED_SHA), 'el archivo guardado es idéntico byte a byte al de la rama base');
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
