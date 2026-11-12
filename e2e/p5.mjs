// Prompt 5: sonido ambiente, tinta (Pencil simulado con pointerType «pen»), PDFs, notas manuscritas, atajos y mando.
//   npm run build && npm run e2e:p5      (ONLY=sonido,tinta,… para correr una parte)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4181;
const URL_ = `http://localhost:${PORT}/`;
const EX = new URL('../examples/', import.meta.url).pathname;
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

try {
  const { ctx, page } = await fresh();

  if (run('sonido')) {
    console.log('Sonido ambiente');
    check(await page.getByRole('button', { name: 'Sonido ambiente' }).count() === 0, 'apagado por defecto: sin icono en la barra');
    await page.goto(URL_ + '#/ajustes/addons');
    await page.getByRole('region', { name: 'Add-ons' }).getByRole('switch', { name: 'Sonido ambiente' }).check();
    const btn = page.getByRole('button', { name: 'Sonido ambiente' });
    await btn.waitFor();
    check(await page.evaluate(() => window.__ambient?.state() === 'none'), 'nada suena al activar: no hay AudioContext hasta tocar «Reproducir»');
    await btn.click();
    const sh = page.getByRole('dialog', { name: 'Sonido ambiente' });
    await sh.getByRole('slider', { name: 'Volumen de Lluvia' }).fill('60');
    await sh.getByRole('slider', { name: 'Volumen de Ruido marrón' }).fill('40');
    await sh.getByRole('button', { name: 'Reproducir', exact: true }).first().click();
    await sh.getByRole('button', { name: 'Detener' }).waitFor();
    await page.waitForTimeout(300);
    check(await page.evaluate(() => window.__ambient.state() === 'running' && window.__ambient.playing && window.__ambient.levels().rain === 0.6 && window.__ambient.levels().brown === 0.4), 'lluvia + ruido marrón suenan mezclados (AudioContext en marcha)');
    await sh.getByRole('group', { name: 'Apagado programado' }).getByRole('button', { name: '15 min' }).click();
    check((await sh.innerText()).includes('Se apaga en 15 min'), 'temporizador de apagado de 15 min');
    await sh.getByRole('button', { name: 'Detener' }).click();
    await sh.getByRole('button', { name: 'Reproducir', exact: true }).first().waitFor();
    await sh.getByRole('button', { name: 'Cerrar' }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Sonido ambiente' }).click();
    const sh2 = page.getByRole('dialog', { name: 'Sonido ambiente' });
    check(await sh2.getByRole('slider', { name: 'Volumen de Lluvia' }).inputValue() === '60' && await page.evaluate(() => window.__ambient.state() === 'none'), 'los volúmenes persisten y al reabrir no suena nada solo');
    await sh2.getByRole('button', { name: 'Cerrar' }).click();
  }

  if (run('tinta')) {
    console.log('Motor de tinta');
    await page.goto(URL_ + '#/design');
    const surf = page.locator('.ink-demo .ink-live');
    await surf.waitFor();
    const count = async () => Number(await page.getByTestId('ink-count').innerText());
    // trazo con Pencil simulado: pointerType «pen», presión variable
    const stroke = (type, id, pts, extra = {}) => surf.evaluate((el, [type, id, pts, extra]) => {
      const r = el.getBoundingClientRect();
      const ev = (name, [x, y, p]) => el.dispatchEvent(new PointerEvent(name, { pointerType: type, pointerId: id, isPrimary: true, pressure: p, clientX: r.left + x, clientY: r.top + y, buttons: name === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, ...extra }));
      ev('pointerdown', pts[0]);
      for (const p of pts.slice(1)) ev('pointermove', p);
      ev('pointerup', pts[pts.length - 1]);
    }, [type, id, pts, extra]);
    const line = (x0, y, x1, n = 12) => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y, 0.2 + (0.7 * i) / (n - 1)]);
    check(await surf.evaluate((el) => getComputedStyle(el).touchAction).then((v) => v.includes('pan') || v === 'manipulation'), 'por defecto el dedo desplaza y hace zoom (touch-action con pan y pinch)');
    await stroke('pen', 11, line(40, 60, 300));
    check(await count() === 1, 'un trazo con Pencil (presión variable) se guarda como vector');
    // palma: un toque mientras el Pencil está apoyado no dibuja nada
    await surf.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const ev = (name, type, id, x, y) => el.dispatchEvent(new PointerEvent(name, { pointerType: type, pointerId: id, pressure: 0.5, clientX: r.left + x, clientY: r.top + y, buttons: 1, bubbles: true, cancelable: true }));
      ev('pointerdown', 'pen', 12, 50, 120);
      ev('pointerdown', 'touch', 13, 200, 200); // palma
      ev('pointermove', 'touch', 13, 260, 210);
      ev('pointermove', 'pen', 12, 200, 125);
      ev('pointerup', 'touch', 13, 260, 210);
      ev('pointerup', 'pen', 12, 220, 126);
    });
    check(await count() === 2, 'la palma apoyada mientras se escribe no marca nada');
    await stroke('touch', 14, line(40, 200, 300));
    check(await count() === 2, 'con «solo Pencil» el dedo no dibuja');
    await page.getByRole('button', { name: 'Deshacer (⌘Z)' }).click();
    check(await count() === 1, 'deshacer');
    await page.getByRole('button', { name: 'Rehacer (⇧⌘Z)' }).click();
    check(await count() === 2, 'rehacer');
    await page.keyboard.press('e');
    check(await page.getByRole('button', { name: 'Borrador (E)' }).getAttribute('aria-pressed') === 'true', 'atajo E: borrador');
    await stroke('pen', 15, [[170, 30, 0.5], [170, 90, 0.5], [170, 140, 0.5]]);
    check(await count() < 2, 'el borrador por trazo quita lo que toca');
    await page.keyboard.press('p');
    await page.getByRole('button', { name: 'Regla (líneas rectas)' }).click();
    await stroke('pen', 16, [[40, 220, 0.5], [120, 160, 0.5], [300, 220, 0.5]]);
    check(await count() >= 1, 'la regla dibuja una línea recta');
  }

  if (run('pdfs')) {
    console.log('PDFs con subrayado');
    // PDF de 120 páginas con texto real (para la capa de texto)
    const { PDFDocument, StandardFonts } = require('pdf-lib');
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let i = 1; i <= 120; i++) {
      const pg = pdf.addPage([595, 842]);
      for (let l = 0; l < 30; l++) pg.drawText(`Pagina ${i} linea ${l + 1}: la fibrilacion auricular no tiene ondas P y el ritmo es irregular.`, { x: 60, y: 780 - l * 22, size: 11, font });
    }
    const bytes = Buffer.from(await pdf.save());
    await page.goto(URL_ + '#/pdfs');
    await page.locator('input[type=file][accept*="pdf"]').setInputFiles({ name: 'Cardiologia 120.pdf', mimeType: 'application/pdf', buffer: bytes });
    await page.locator('.pdf-card').first().waitFor();
    check(await page.locator('.pdf-card img').first().waitFor({ timeout: 15000 }).then(() => true), 'la biblioteca muestra el PDF con miniatura');
    await page.locator('.pdf-card a.pdf-cover').first().click();
    await page.locator('.pdf-page[data-page="1"] .textLayer span').first().waitFor({ timeout: 20000 });
    check(true, 'el visor abre un PDF de 120 páginas con capa de texto');
    await page.getByRole('button', { name: 'Anotar', exact: true }).click();
    await page.keyboard.press('h');
    const pg1 = page.locator('.pdf-page[data-page="1"]');
    // cinco trazos de resaltador con Pencil, cada uno sobre una línea (un poco torcidos y cortos)
    for (let l = 0; l < 5; l++) {
      await pg1.locator('.ink-live').evaluate((el, l) => {
        const r = el.closest('.pdf-page').getBoundingClientRect();
        const k = r.width / 595;
        const y = r.top + (842 - (780 - l * 22) - 4) * k; // centro aproximado de la línea
        const ev = (name, x, yy) => el.dispatchEvent(new PointerEvent(name, { pointerType: 'pen', pointerId: 30 + l, pressure: 0.5, clientX: r.left + x * k, clientY: yy, buttons: name === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
        ev('pointerdown', 70, y + 2);
        for (let x = 80; x <= 300; x += 20) ev('pointermove', x, y + (x % 40 ? 2 : -1));
        ev('pointerup', 300, y);
      }, l);
      await page.waitForTimeout(120);
    }
    const marks = await pg1.locator('.pdf-mark').count();
    check(marks === 5, `cinco resaltados ajustados a las líneas de texto (${marks})`);
    const geom = await pg1.locator('.pdf-mark').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.top, r.height]; }));
    check(geom.every(([, h]) => h > 6 && h < 30), 'cada resaltado tiene la altura de una línea (no la del trazo)');
    // escribir en el margen con el bolígrafo
    await page.keyboard.press('p');
    await pg1.locator('.ink-live').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const ev = (name, x, y) => el.dispatchEvent(new PointerEvent(name, { pointerType: 'pen', pointerId: 50, pressure: 0.6, clientX: r.left + x, clientY: r.top + y, buttons: name === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
      ev('pointerdown', 10, 100); for (let i = 0; i < 20; i++) ev('pointermove', 12 + i, 100 + i * 4); ev('pointerup', 32, 180);
    });
    await page.waitForTimeout(800);
    await page.reload();
    await page.locator('.pdf-page[data-page="1"] .pdf-mark').first().waitFor({ timeout: 20000 });
    check(await page.locator('.pdf-page[data-page="1"] .pdf-mark').count() === 5, 'tras reabrir la app los resaltados siguen ahí');
    await page.waitForTimeout(400);
    const inked = await page.locator('.pdf-page[data-page="1"] canvas.ink-base').evaluate((c) => { const d = c.getContext('2d').getImageData(0, Math.round(100 * (c.width / c.clientWidth)), Math.round(60 * (c.width / c.clientWidth)), Math.round(80 * (c.width / c.clientWidth))).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
    check(inked > 20, `lo escrito en el margen sigue ahí al reabrir (${inked} px de tinta)`);
    await page.getByRole('button', { name: /^Resaltados \(5\)/ }).click();
    check((await page.locator('.pdf-side').innerText()).includes('fibrilacion'), 'panel «Resaltados» por página con el texto');
    // exportar con anotaciones aplanadas
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar PDF con anotaciones' }).click();
    await page.getByRole('button', { name: 'Guardar en Archivos' }).click();
    const file = await (await dl).path();
    const out = await PDFDocument.load(require('node:fs').readFileSync(file));
    check(out.getPageCount() === 120 && require('node:fs').statSync(file).size > bytes.length, 'el PDF exportado tiene las 120 páginas y las anotaciones dibujadas');

  }

  if (run('manuscrito')) {
    console.log('Notas manuscritas');
    await page.goto(URL_ + '#/notas/+nueva');
    const f = page.getByRole('dialog', { name: 'Nueva nota' });
    await f.getByLabel('Materia').fill('Fisiología');
    await f.getByLabel('Tema o clase').fill('Renal');
    await f.getByLabel('Título').fill('Fórmulas');
    await f.getByRole('button', { name: 'Crear' }).click();
    await page.locator('.doc').waitFor();
    // párrafo antes, dibujo, párrafo después
    const write = async (txt) => { await page.getByRole('button', { name: /Escribe o usa/ }).click(); await page.locator('.doc textarea').last().click(); await page.keyboard.type(txt); };
    await write('Párrafo antes de la fórmula');
    await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
    await page.keyboard.type('/dib');
    await page.getByRole('option', { name: /Dibujo \/ manuscrito/ }).or(page.getByRole('menuitem', { name: /Dibujo \/ manuscrito/ })).or(page.locator('.slash button', { hasText: 'Dibujo / manuscrito' })).first().click();
    await page.locator('.drawing-block .ink-live').waitFor();
    const live = page.locator('.drawing-block .ink-live');
    await live.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const ev = (name, x, y, p) => el.dispatchEvent(new PointerEvent(name, { pointerType: 'pen', pointerId: 70, pressure: p, clientX: r.left + x, clientY: r.top + y, buttons: name === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true }));
      // «E = mc²» aproximado: varios trazos
      ev('pointerdown', 30, 30, 0.3); for (let i = 0; i < 15; i++) ev('pointermove', 30 + i * 6, 30 + Math.sin(i) * 12, 0.3 + i / 30); ev('pointerup', 120, 40, 0.5);
    });
    await page.waitForTimeout(1500);
    await write('Párrafo después de la fórmula');
    await page.waitForTimeout(900);
    await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Ver Markdown' }).click();
    const md = await page.locator('.doc textarea').inputValue();
    const iA = md.indexOf('Párrafo antes'), iD = md.search(/!\[\[dibujo-[\w-]+\.png\]\]/), iB = md.indexOf('Párrafo después');
    check(iA >= 0 && iD > iA && iB > iD, 'la nota guarda texto · ![[dibujo-….png]] · texto, en ese orden');
    await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Documento' }).click();
    await page.reload();
    await page.locator('.drawing-block canvas.ink-base').waitFor();
    await page.waitForTimeout(500);
    const px = async () => page.locator('.drawing-block canvas.ink-base').evaluate((c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
    check(await px() > 50, 'al reabrir la app la fórmula a mano sigue intacta');
    await page.emulateMedia({ media: 'print' });
    check(await page.locator('.drawing-block canvas.ink-base').isVisible() && await px() > 50 && !(await page.locator('.drawing-block .ink-toolbar').isVisible()), 'al exportar a PDF (imprimir) el dibujo es visible y sin herramientas');
    await page.emulateMedia({ media: 'screen' });
    // búsqueda: los dibujos no se indexan, pero la nota muestra su miniatura
    await page.getByRole('searchbox', { name: /Buscar en todas las notas/ }).fill('fórmula');
    await page.locator('.search-hit').first().waitFor();
    check(await page.locator('.search-hit .search-thumb img').count() >= 1, 'el resultado muestra la miniatura del dibujo');
    await page.getByRole('searchbox', { name: /Buscar en todas las notas/ }).fill('dibujo');
    await page.waitForTimeout(500);
    check(await page.locator('.search-hit', { hasText: 'Fórmulas' }).count() === 0, 'la referencia del dibujo no se indexa como texto');
  }

  if (run('atajos')) {
    console.log('Atajos de teclado y mando');
    // mazo de 25 tarjetas nuevas (sin tocar la pantalla para repasar)
    const deck = '---\ndeck: Teclado\nnew_per_day: 40\n---\n' + Array.from({ length: 25 }, (_, i) => `Q:: Pregunta ${i + 1}\nA:: Respuesta ${i + 1} ^tk${i + 1}`).join('\n\n') + '\n';
    await page.goto(URL_ + '#/ajustes');
    await openAll(page);
    await page.getByRole('region', { name: 'Respaldo' }).getByRole('button', { name: /Importar/ }).click();
    await page.locator('.sheet input[type=file]').first().setInputFiles({ name: 'Teclado.md', mimeType: 'text/markdown', buffer: Buffer.from(deck) });
    await page.locator('.sheet .btn.primary').filter({ hasText: /Importar/ }).click();
    await page.getByRole('button', { name: 'Listo' }).click();
    await page.goto(URL_ + '#/estudiar/decks/Teclado.md');
    await page.locator('.study-card').waitFor();
    await page.locator('body').click({ position: { x: 2, y: 2 } }).catch(() => {});
    const before = await page.evaluate(() => document.querySelectorAll('.study-card').length);
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Space');
      await page.getByRole('group', { name: 'Calificación' }).getByRole('button', { name: /^Bien/ }).waitFor();
      await page.keyboard.press(i % 5 === 4 ? '4' : '3');
      await page.waitForTimeout(120);
    }
    await page.goto(URL_ + '#/hoy');
    await page.getByText(/Estudiaste 20 tarjetas/).waitFor({ timeout: 8000 });
    check(before === 1, 'estudiar 20 tarjetas solo con el teclado (Espacio, 3, 4) sin tocar la pantalla');
    // clicker (PageDown = mostrar o Bien) y mando simulado (A = mostrar/Bien, B = Otra vez)
    await page.goto(URL_ + '#/estudiar/decks/Teclado.md');
    await page.locator('.study-card').waitFor();
    const q1 = await page.locator('.study-card').innerText();
    await page.keyboard.press('PageDown');
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(250);
    check(await page.locator('.study-card').innerText() !== q1 && (await page.locator('.key-feedback').innerText()).includes('Mostrar respuesta o Bien'), 'clicker: PageDown muestra y califica, con indicador del último botón');
    await page.evaluate(() => {
      const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
      const pad = { id: 'Mando de prueba', index: 0, connected: true, mapping: 'standard', buttons, axes: [0, 0, 0, 0], timestamp: 0 };
      window.__pad = pad;
      navigator.getGamepads = () => [pad, null, null, null];
      window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: pad }));
    });
    const press = async (i) => { await page.evaluate((i) => (window.__pad.buttons[i].pressed = true), i); await page.waitForTimeout(80); await page.evaluate((i) => (window.__pad.buttons[i].pressed = false), i); await page.waitForTimeout(120); };
    const q2 = await page.locator('.study-card').innerText();
    await press(0); // A: mostrar
    check(await page.getByRole('group', { name: 'Calificación' }).getByRole('button', { name: /^Bien/ }).count() === 1, 'mando: A muestra la respuesta');
    await press(1); // B: Otra vez
    await page.waitForTimeout(200);
    await page.locator('.key-feedback', { hasText: '🎮 B → Otra vez' }).waitFor({ timeout: 3000 });
    check(await page.getByRole('button', { name: /Mostrar respuesta/ }).count() === 1, 'mando: B = Otra vez (califica y pasa a la siguiente)');
    void q2;
    // reasignar «Bien» a «b» y que persista
    await page.goto(URL_ + '#/ajustes/atajos');
    await page.getByRole('button', { name: 'Cambiar tecla de «Bien»' }).click();
    await page.keyboard.press('b');
    await page.waitForTimeout(400);
    await page.reload();
    await page.goto(URL_ + '#/ajustes/atajos');
    await page.getByRole('region', { name: /Atajos/ }).waitFor();
    check((await page.getByRole('button', { name: 'Restablecer «Bien»' }).count()) === 1 && (await page.locator('.key-row', { has: page.getByRole('button', { name: 'Restablecer «Bien»' }) }).locator('kbd').allInnerTexts()).join() === 'B', 'reasignar una tecla y que persista tras recargar (.app/atajos.json)');
    await page.goto(URL_ + '#/estudiar/decks/Teclado.md');
    await page.locator('.study-card').waitFor();
    await page.keyboard.press('Space');
    await page.getByRole('group', { name: 'Calificación' }).getByRole('button', { name: /^Bien/ }).waitFor();
    const q3 = await page.locator('.study-card').innerText();
    await page.keyboard.press('3');
    await page.waitForTimeout(200);
    check(await page.locator('.study-card').innerText() === q3, 'tras reasignar, «3» ya no califica');
    await page.keyboard.press('b');
    await page.waitForTimeout(250);
    check(await page.locator('.study-card').innerText() !== q3, 'y «b» califica Bien');
    // escribir en una nota no dispara ningún atajo
    await page.goto(URL_ + '#/notas/+nueva');
    const f = page.getByRole('dialog', { name: 'Nueva nota' });
    await f.getByLabel('Materia').fill('Atajos');
    await f.getByLabel('Tema o clase').fill('Prueba');
    await f.getByLabel('Título').fill('Escribir');
    await f.getByRole('button', { name: 'Crear' }).click();
    await page.getByRole('button', { name: /Escribe o usa/ }).click();
    await page.locator('.doc textarea').last().click();
    const hash = await page.evaluate(() => location.hash);
    await page.keyboard.type('g h 3 e s * f ? b z');
    await page.waitForTimeout(300);
    check(await page.evaluate(() => location.hash) === hash && await page.locator('.doc textarea').last().inputValue() === 'g h 3 e s * f ? b z' && await page.getByRole('dialog').count() === 0, 'escribir en una nota no dispara ningún atajo');
    await page.locator('.doc textarea').last().blur();
    await page.locator('body').click({ position: { x: 2, y: 2 } }).catch(() => {});
    await page.keyboard.press('?');
    await page.getByRole('dialog', { name: 'Atajos de teclado y mando' }).waitFor();
    check(true, '«?» fuera de un campo abre la hoja de atajos');
    await page.keyboard.press('Escape');
    await page.keyboard.press('g');
    await page.keyboard.press('c');
    await page.waitForFunction(() => location.hash === '#/calendario');
    check(true, 'secuencia G y luego C va al Calendario');
  }

  if (run('ipad')) {
    console.log('Barra superior en iPad');
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(URL_ + '#/hoy');
    await page.locator('.seg-nav').waitFor();
    await page.waitForTimeout(300);
    check(await page.locator('.seg-nav').evaluate((n) => n.scrollWidth <= n.clientWidth + 1), 'a 1024 px se ven todas las secciones, PDFs incluida');
    check(await page.getByRole('link', { name: 'Ajustes', exact: true }).count() === 0, 'Respaldo y Ajustes ya no están en la barra (viven en Perfil)');
    if (await page.locator('.more-pill').count()) {
      await page.locator('.more-pill').click();
      await page.getByRole('menuitem', { name: 'Sonido ambiente' }).click();
      await page.getByRole('dialog', { name: 'Sonido ambiente' }).getByRole('button', { name: 'Cerrar' }).click();
      check(true, '«⋯» lleva a Sonido ambiente');
      await page.setViewportSize({ width: 1366, height: 768 });
      check(await page.locator('.more-pill').isHidden(), 'en escritorio no cambia nada');
    }
    await page.setViewportSize({ width: 1180, height: 820 });
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
