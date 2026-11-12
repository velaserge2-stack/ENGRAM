// Prompt 7: lienzo estático al alejar, PDF por página y firma del desarrollador.
//   npm run build && npm run e2e:p7      (ONLY=lienzo,pdf,firma)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4183;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
const check = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✓', m); };

// Ajustes en acordeón (Prompt 6 · B4): desplegar todo antes de usar sus controles
const openAll = async (page) => { await page.locator('.settings').waitFor(); const b = page.getByRole('button', { name: 'Desplegar todo' }); if (await b.count()) { await b.click(); await page.waitForTimeout(300); } };
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const run = (k) => !only || only.includes(k);
const errors = [];

async function fresh(w = 1180, h = 820) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'es-MX', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  return { ctx, page };
}
async function addPanel(page, name) {
  const b = page.getByRole('button', { name: 'Añadir panel', exact: true });
  await b.scrollIntoViewIfNeeded();
  await b.click();
  await page.getByRole('menuitem', { name: 'Añadir panel ' + name, exact: true }).evaluate((x) => x.click());
  await page.waitForTimeout(150);
}
async function newSpace(page, name, panels = []) {
  await page.getByRole('button', { name: 'Nuevo espacio' }).first().click();
  await page.locator('.sheet input[name=n]').fill(name);
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.getByText(/Añade paneles/).first().waitFor();
  for (const p of panels) await addPanel(page, p);
}
/** Cajas de la interfaz fija (barra, riel, dock, bandeja, contenedor del lienzo). */
const fixedBoxes = (page) => page.evaluate(() => ['.topbar', '.rail', '.dock', '.tray', '.canvas-wrap', '.seg-nav'].map((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [s, Math.round(r.left * 100), Math.round(r.top * 100), Math.round(r.width * 100), Math.round(r.height * 100)].join(':'); }).filter(Boolean).join(' | '));
/** Un punto vacío del lienzo (ni panel ni controles). */
const emptySpot = (page) => page.evaluate(() => {
  const w = document.querySelector('.canvas-wrap').getBoundingClientRect();
  for (let y = w.top + 20; y < w.bottom - 20; y += 17) for (let x = w.left + 20; x < w.right - 20; x += 23) {
    const e = document.elementFromPoint(x, y);
    if (e && e.closest('.canvas-wrap') && !e.closest('.win, button, .minimap, .chip, .row')) return { x, y };
  }
  return null;
});
const zoomPct = (page) => page.locator('.canvas-wrap .chip').last().innerText();
const gesture = (page, spot, seq) => page.evaluate(({ spot: { x, y }, seq }) => {
  const el = document.elementFromPoint(x, y);
  return seq.map(([t, s]) => { const e = Object.assign(new Event(t, { bubbles: true, cancelable: true }), { scale: s, clientX: x, clientY: y }); el.dispatchEvent(e); return e.defaultPrevented; });
}, { spot, seq });

try {
  const { ctx, page } = await fresh();

  if (run('lienzo')) {
    console.log('Lienzo: la interfaz no se mueve al alejar');
    await page.goto(URL_ + '#/espacios');
    await newSpace(page, 'Zoom', ['Estadísticas', 'Pomodoro']);
    await page.getByRole('group', { name: 'Modo' }).getByRole('button', { name: 'Lienzo' }).click();
    await page.locator('.canvas-wrap').waitFor();
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      window.__ev = { wheel: 0, wheelPrevented: 0, gest: 0, gestPrevented: 0 };
      addEventListener('wheel', (e) => { if (e.ctrlKey && e.target.closest?.('.canvas-wrap')) (window.__ev.wheel++, e.defaultPrevented && window.__ev.wheelPrevented++); });
      addEventListener('gesturechange', (e) => { window.__ev.gest++; if (e.defaultPrevented) window.__ev.gestPrevented++; });
    });
    const before = await fixedBoxes(page);
    const spot = await emptySpot(page);
    check(!!spot, 'hay un punto vacío del lienzo');
    await page.screenshot({ path: OUT + 'p7-lienzo-antes.png' });
    await page.mouse.move(spot.x, spot.y);
    await page.keyboard.down('Control');
    const during = [];
    for (let i = 0; i < 45; i++) { await page.mouse.wheel(0, 240); if (i % 9 === 0) during.push(await fixedBoxes(page)); }
    await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    const after = await fixedBoxes(page);
    await page.screenshot({ path: OUT + 'p7-lienzo-despues.png' });
    check(await zoomPct(page) === '10 %', `Ctrl+rueda más allá del mínimo se queda en el tope (${await zoomPct(page)})`);
    check(during.every((d) => d === before) && after === before, 'barra, riel, dock y contenedor no cambian ni un píxel durante ni después');
    check(await page.evaluate(() => (window.visualViewport?.scale ?? 1) === 1), 'visualViewport.scale = 1 (sin zoom de página)');
    const ev = await page.evaluate(() => window.__ev);
    check(ev.wheel >= 45 && ev.wheelPrevented === ev.wheel, `todos los Ctrl+rueda se cancelan, también en el tope (${ev.wheelPrevented}/${ev.wheel})`);
    // sobre un panel también se consume (no escapa a la página)
    const win = await page.locator('.canvas-plane > .win .win-body').first().boundingBox();
    if (win && win.width > 4) {
      await page.mouse.move(win.x + win.width / 2, win.y + Math.min(20, win.height / 2));
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -200);
      await page.keyboard.up('Control');
      const e2 = await page.evaluate(() => window.__ev);
      check(e2.wheelPrevented === e2.wheel, 'Ctrl+rueda sobre un panel tampoco llega a la página');
    }
    // gesturechange de WebKit (pellizco del trackpad en Safari / dos dedos sobre un panel)
    const res = await gesture(page, spot, [['gesturestart', 1], ['gesturechange', 0.6], ['gesturechange', 0.3], ['gesturechange', 0.1], ['gestureend', 0.1]]);
    check(res.every(Boolean), 'gesturestart/gesturechange/gestureend se cancelan en el tope');
    check(await page.evaluate(() => window.__ev.gest === window.__ev.gestPrevented && window.__ev.gest > 0) && (await fixedBoxes(page)) === before, 'gesturechange: la interfaz sigue fija');
    // acercar con gesto y luego dos punteros táctiles que se juntan hasta el tope
    await gesture(page, spot, [['gesturestart', 1], ['gesturechange', 4], ['gestureend', 4]]);
    const k0 = await zoomPct(page);
    const spot2 = await emptySpot(page);
    await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      const ev = (type, id, px) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: px, clientY: y, bubbles: true, cancelable: true, isPrimary: id === 1 }));
      ev('pointerdown', 1, x - 150); ev('pointerdown', 2, x + 150);
      for (let d = 150; d >= 5; d -= 5) { ev('pointermove', 1, x - d); ev('pointermove', 2, x + d); }
      ev('pointerup', 1, x - 5); ev('pointerup', 2, x + 5);
    }, spot2);
    await page.waitForTimeout(200);
    const k1 = await zoomPct(page);
    check(k0 !== '10 %' && k1 === '10 %', `dos punteros táctiles que se juntan: ${k0} → ${k1} (tope 10 %)`);
    check((await fixedBoxes(page)) === before && await page.evaluate(() => (window.visualViewport?.scale ?? 1) === 1), 'tras el pellizco táctil la interfaz sigue fija');
    check(await page.evaluate(() => document.documentElement.classList.contains('in-canvas') && getComputedStyle(document.documentElement).overscrollBehaviorY === 'none'), 'sin rebote (overscroll-behavior: none) mientras se ve el lienzo');
    await page.goto(URL_ + '#/hoy');
    await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
    check(await page.evaluate(() => !document.documentElement.classList.contains('in-canvas') && getComputedStyle(document.documentElement).overscrollBehaviorY !== 'none'), 'fuera de Espacios la página no cambia');
  }

  if (run('pdf')) {
    console.log('PDF: «Ver por página» al abrir');
    const { PDFDocument, StandardFonts } = require('pdf-lib');
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 3; i++) pdf.addPage([595, 842]).drawText(`Pagina ${i}: ritmo sinusal`, { x: 60, y: 780, size: 14, font });
    await page.goto(URL_ + '#/pdfs');
    await page.locator('input[type=file][accept*="pdf"]').setInputFiles({ name: 'Paginas.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
    await page.locator('.pdf-card a.pdf-cover').first().waitFor();
    const open = async () => { await page.goto(URL_ + '#/pdfs'); await page.locator('.pdf-card a.pdf-cover').first().click(); await page.locator('.pdf-page canvas.page').first().waitFor({ timeout: 15000 }); await page.waitForTimeout(500); };
    const state = (root = page) => root.locator('.pdf-viewer').first().evaluate((v) => ({ pages: [...v.querySelectorAll('.pdf-page')].map((x) => x.dataset.page).join(','), byPage: v.querySelector('.pdf-bar button[aria-pressed="true"][aria-label="Ver continuo"]') !== null, counter: v.querySelector('.pdf-bar > .foot:last-child')?.textContent ?? '' }));
    await open();
    let st = await state();
    check(st.byPage && st.pages === '1' && st.counter.startsWith('1 / '), `un PDF nuevo abre por página, en la 1 (${st.counter})`);
    await page.getByRole('button', { name: /Siguiente/ }).last().click();
    await page.getByRole('button', { name: /Siguiente/ }).last().click();
    await page.waitForTimeout(1200); // se guarda la última página
    await open();
    st = await state();
    check(st.byPage && st.pages === '3', `con página recordada abre por página en esa página (${st.pages})`);
    await page.getByRole('button', { name: 'Ver continuo' }).click();
    await page.waitForTimeout(300);
    check((await state()).pages === '1,2,3', 'el botón cambia a continuo durante la sesión');
    await open();
    check((await state()).byPage, 'al volver a abrir no se recuerda el continuo: otra vez por página');
    await page.goto(URL_ + '#/pdfs');
    const link = (await page.locator('.pdf-card a.pdf-cover').first().getAttribute('href')) + '?p=2';
    await page.goto(URL_ + link);
    await page.locator('.pdf-page[data-page="2"] canvas.page').waitFor({ timeout: 15000 });
    st = await state();
    check(st.byPage && st.pages === '2', `un enlace a la página 2 abre por página en la 2 (${st.pages})`);
    // panel del lienzo
    await page.goto(URL_ + '#/espacios');
    await newSpace(page, 'PDF', []);
    await addPanel(page, 'PDF');
    await page.locator('.win .opt', { hasText: 'Paginas.pdf' }).first().click();
    await page.locator('.win .pdf-page canvas.page').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    st = await state(page.locator('.win').first());
    check(st.byPage && st.pages.split(',').length === 1, `en un panel del lienzo también abre por página (${st.pages})`);
    // pellizco del lienzo sobre el PDF: zoom del PDF (no de la página)
    await page.getByRole('group', { name: 'Modo' }).getByRole('button', { name: 'Lienzo' }).click();
    await page.locator('.canvas-wrap .pdf-viewer').waitFor();
    await page.waitForTimeout(400);
    const z0 = await page.locator('.canvas-wrap .pdf-bar .num').first().innerText();
    const box = await page.locator('.canvas-wrap .pdf-scroll').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(60, box.height / 2));
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control');
    await page.waitForTimeout(200);
    const z1 = await page.locator('.canvas-wrap .pdf-bar .num').first().innerText();
    check(z0 !== z1 && await page.evaluate(() => (window.visualViewport?.scale ?? 1) === 1), `en el lienzo, el pellizco sobre el PDF cambia el zoom del PDF (${z0} → ${z1})`);
  }

  if (run('firma')) {
    console.log('Firma del desarrollador');
    /** Estado de la firma y de lo que hay en su caja. */
    const sign = (pg) => pg.evaluate(() => {
      const el = document.querySelector('.dev-sign');
      if (!el) return { exists: false };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const shown = cs.display !== 'none' && r.width > 0;
      const rgb = cs.color.match(/\d+(\.\d+)?/g).map(Number);
      // controles o capas que se cruzan con la firma (no deben)
      // capas fijas (no deben cruzarse con la firma)
      const hit = [...document.querySelectorAll('.dock, .phone-tabbar, .tray, .rail, .sheet, .topbar, .key-feedback')]
        .filter((e) => { const b = e.getBoundingClientRect(); return b.width && b.height && getComputedStyle(e).visibility !== 'hidden' && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top; })
        .map((e) => e.className || e.tagName);
      // lo que pase por su esquina (contenido al desplazar) queda encima: la firma no lo tapa
      const above = [...document.querySelectorAll('button, a, input, .glass')].filter((e) => { const b = e.getBoundingClientRect(); return b.width && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top; });
      const under = above.filter((e) => { const b = e.getBoundingClientRect(); const x = Math.max(b.left, r.left) + 1, y = Math.max(b.top, r.top) + 1; const top = document.elementFromPoint(x, y); return top === el; }).length;
      return { under, exists: true, shown, text: el.textContent, left: r.left, bottomGap: innerHeight - r.bottom, pe: cs.pointerEvents, us: cs.userSelect || cs.webkitUserSelect, aria: el.getAttribute('aria-hidden'), z: cs.zIndex, neutral: rgb[0] === rgb[1] && rgb[1] === rgb[2], op: Number(cs.opacity), font: cs.fontFamily, size: parseFloat(cs.fontSize), hit };
    });
    const ok = (s, where) => {
      check(s.exists && s.shown && s.text === 'Desarrollador: SergeV', `${where}: se ve «Desarrollador: SergeV»`);
      check(s.left < 40 && s.bottomGap >= 0 && s.pe === 'none' && s.us === 'none' && s.aria === 'true' && Number(s.z) < 0, `${where}: abajo a la izquierda, no tocable ni seleccionable, aria-hidden, detrás del contenido`);
      check(s.neutral && s.op <= 0.45 && /Helvetica Neue/.test(s.font) && s.size >= 11 && s.size <= 12, `${where}: sin color, ${s.size}px, opacidad ${s.op}`);
      check(s.hit.length === 0 && s.under === 0, `${where}: no se cruza con dock, riel, barras ni bandeja y no tapa contenido` + (s.hit.length ? ` (${s.hit.join(', ')})` : ''));
    };
    const screens = ['hoy', 'mazos', 'notas', 'pdfs', 'calendario', 'espacios', 'simulacros', 'ajustes'];
    for (const [w, h, label] of [[1180, 820, 'iPad'], [1366, 768, 'web'], [390, 844, 'iPhone vertical'], [844, 390, 'iPhone horizontal']]) {
      const { ctx: c, page: pg } = await fresh(w, h);
      for (const r of screens) {
        await pg.goto(URL_ + '#/' + r);
        await pg.waitForTimeout(500);
        ok(await sign(pg), `${label} · ${r}`);
      }
      if (label === 'iPad') {
        // espacio con paneles minimizados: la bandeja ocupa la esquina y la firma sube
        await pg.goto(URL_ + '#/espacios');
        await newSpace(pg, 'Firma', ['Estadísticas']);
        const min = pg.getByRole('button', { name: /^Minimizar/ }).first();
        if (await min.count()) { await min.click(); await pg.waitForTimeout(700); ok(await sign(pg), 'iPad · espacios con bandeja'); }
        // estudio: oculta
        await pg.goto(URL_ + '#/estudiar');
        await pg.locator('.study-card').waitFor();
        check(!(await sign(pg)).shown, 'en la pantalla de estudio la firma se oculta');
        // notas a pantalla completa: oculta
        await pg.goto(URL_ + '#/notas/Cardiolog%C3%ADa/ECG/Clase%201%20-%20ECG%20b%C3%A1sico.md');
        await pg.locator('.doc').waitFor();
        await pg.getByRole('button', { name: 'Pantalla completa de notas' }).click();
        await pg.waitForTimeout(200);
        check(!(await sign(pg)).shown, 'en notas a pantalla completa la firma se oculta');
        await pg.locator('.notes-exit').click();
        await pg.waitForTimeout(200);
        check((await sign(pg)).shown, 'al salir de pantalla completa vuelve');
        // Ajustes → Acerca de
        await pg.goto(URL_ + '#/ajustes/acerca');
        check(await pg.locator('#acerca .fold-in').getByText('Desarrollador: SergeV').count() === 1, 'Ajustes → Acerca de muestra la línea del desarrollador (texto normal)');
        // legibilidad sobre los 5 fondos de prueba × 2 modos (estimación del guardián)
        const res = [];
        for (const bg of ['blanco', 'negro', 'rayas', 'degradado', 'foto']) for (const modo of ['dark', 'light']) {
          await pg.goto(`${URL_}#/design?bg=${bg}&modo=${modo}`);
          await pg.getByRole('heading', { name: 'Diseño · Cristal' }).waitFor();
          const want = { blanco: '#ffffff', negro: '#000000', rayas: 'rayas', degradado: 'neon', foto: 'paisaje' }[bg];
          await pg.waitForFunction(([wnt, m]) => window.__guard?.key?.includes(wnt) && window.__guard.key.includes(m), [want, modo], { timeout: 10000 });
          await pg.waitForTimeout(700);
          const g = await pg.evaluate(() => ({ c: window.__guard.sign, tone: document.querySelector('.dev-sign')?.dataset.tone }));
          res.push(`${bg}/${modo}: ${g.c?.toFixed(1)} (${g.tone})`);
          check(g.c >= 3, `legible sobre ${bg} en modo ${modo}: contraste estimado ${g.c?.toFixed(2)} con tono ${g.tone}`);
        }
      }
      await c.close();
    }
    for (const [lang, txt] of [['en', 'Developer: SergeV'], ['fr', 'Développeur : SergeV']]) {
      const { ctx: c, page: pg } = await fresh();
      await pg.goto(URL_ + '#/ajustes/idioma');
      await pg.getByRole('group', { name: 'Idioma' }).getByRole('button', { name: lang === 'en' ? 'English' : 'Français' }).click();
      await pg.waitForTimeout(400);
      check((await pg.locator('.dev-sign').textContent()) === txt, `${lang}: «${txt}»`);
      await c.close();
    }
  }

  check(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await ctx.close();
  console.log('\nOK');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
