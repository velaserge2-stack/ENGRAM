// Mejoras 2 · bloques C–F: perfil, papelera de mazos, fondos, almacenamiento, notas, calendario…
//   npm run build && npm run e2e:bloquec      (ONLY=perfil,papelera,… para correr una parte)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4180;
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

  if (run('perfil')) {
    console.log('Perfil');
    await page.goto(URL_ + '#/ajustes');
    await openAll(page);
    await page.getByRole('button', { name: /^Perfil/ }).first().click();
    await page.getByRole('heading', { name: 'Perfil', level: 1 }).waitFor();
    await page.getByLabel('Nombre', { exact: true }).fill('Ana López');
    await page.getByLabel('Bio').fill('Residente de medicina interna');
    await page.getByLabel('Meta o lema').fill('Poco a poco');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await page.waitForTimeout(500);
    check(await page.locator('.profile-head h2').innerText() === 'Ana López', 'el encabezado muestra el nombre');
    check(await page.locator('.profile-stats > div').count() === 3, 'tres cifras: racha, tarjetas y horas');
    check((await page.locator('.avatar-pill .avatar').innerText()).trim() === 'A', 'sin foto ni emoji, el avatar muestra la inicial');
    await page.reload();
    await page.goto(URL_ + '#/hoy');
    await page.getByText(/Hola, Ana/).waitFor();
    check(true, 'Hoy saluda con el nombre y el perfil persiste tras recargar');
    await page.goto(URL_ + '#/perfil');
    await page.getByLabel('Emoji de avatar').fill('🩺');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await page.waitForTimeout(400);
    check((await page.locator('.avatar-pill .avatar').innerText()).includes('🩺'), 'con emoji, el avatar lo muestra');
    await page.locator('.avatar-pill').click();
    await page.getByRole('heading', { name: 'Perfil', level: 1 }).waitFor();
    check(true, 'el avatar de la barra superior abre el perfil');
  }

  if (run('papelera')) {
    console.log('Papelera de mazos');
    await page.goto(URL_ + '#/mazos');
    const row = page.locator('tr.swipe-row', { hasText: 'Cardiología' });
    await row.locator('td').first().click({ position: { x: 4, y: 10 } });
    await page.getByRole('button', { name: 'Opciones de Cardiología' }).click();
    await page.getByRole('button', { name: 'Eliminar mazo…' }).click();
    const sheet = page.getByRole('dialog', { name: /Eliminar «Cardiología»/ });
    await sheet.waitFor();
    check(/Se moverán a la Papelera: \d+ tarjetas y \d+ repasos/.test(await sheet.innerText()), 'confirmación con cifras de tarjetas y repasos');
    await sheet.getByRole('button', { name: 'Mover a la Papelera' }).click();
    await page.waitForTimeout(800);
    check(await page.locator('tr.swipe-row', { hasText: 'Cardiología' }).count() === 0, 'el mazo desaparece de la lista (dos toques tras el engranaje)');
    await page.getByRole('button', { name: /Papelera \(1\)/ }).click();
    const tr = page.getByRole('dialog', { name: 'Papelera de mazos' });
    await tr.getByRole('button', { name: 'Restaurar' }).click();
    await page.waitForTimeout(800);
    await tr.getByRole('button', { name: 'Cerrar' }).click();
    check(await page.locator('tr.swipe-row', { hasText: 'Cardiología' }).count() === 1, 'restaurar devuelve el mazo íntegro');
    // selección múltiple: la carpeta Neurología se lleva sus submazos
    await page.getByRole('button', { name: 'Seleccionar', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Seleccionar Neurología' }).check();
    await page.getByRole('button', { name: 'Eliminar (1)' }).click();
    const multi = page.getByRole('dialog', { name: /Eliminar 2 mazos/ });
    await multi.waitFor();
    check((await multi.innerText()).includes('Cefaleas') && (await multi.innerText()).includes('EVC'), 'borrar una carpeta lista todos sus submazos');
    await multi.getByRole('button', { name: 'Mover a la Papelera' }).click();
    await page.waitForTimeout(800);
    check(await page.locator('tr.swipe-row', { hasText: 'Cefaleas' }).count() === 0, 'selección múltiple: varios mazos de una vez');
    await page.getByRole('button', { name: /Papelera \(1\)/ }).click();
    const tr2 = page.getByRole('dialog', { name: 'Papelera de mazos' });
    await tr2.getByRole('button', { name: 'Eliminar definitivamente' }).click();
    await page.waitForTimeout(600);
    check(await tr2.getByText('La papelera está vacía.').count() === 1, 'eliminar definitivamente vacía la entrada');
    await tr2.getByRole('button', { name: 'Cerrar' }).click();
  }

  if (run('fondos')) {
    console.log('Fondos: borrar y encuadrar');
    // una foto apaisada generada en el navegador (sin archivos de prueba)
    const png = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 1600; c.height = 900;
      const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 1600, 0); g.addColorStop(0, '#203040'); g.addColorStop(1, '#d0c0a0'); x.fillStyle = g; x.fillRect(0, 0, 1600, 900);
      const b = await new Promise((r) => c.toBlob(r, 'image/png')); return [...new Uint8Array(await b.arrayBuffer())];
    });
    await page.goto(URL_ + '#/ajustes');
    await openAll(page);
    await page.locator('.bg-grid input[type=file]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from(png) });
    await page.locator('.bg-layer img').waitFor();
    await page.getByRole('region', { name: 'Apariencia · Fondo' }).getByRole('button', { name: 'Aplicar' }).click();
    await page.getByRole('button', { name: 'Gestionar' }).click();
    await page.getByRole('checkbox', { name: 'Imagen propia' }).click();
    await page.getByRole('button', { name: 'Encuadrar' }).click();
    const box = page.locator('.frame-box');
    await box.waitFor();
    const bb = await box.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.mouse.move(bb.x + bb.width / 2 + 120, bb.y + bb.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.getByRole('slider', { name: 'Acercar' }).fill('1.5');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await page.waitForFunction(() => document.querySelector('.bg-layer img')?.style.getPropertyValue('--bg-zoom') === '1.5', null, { timeout: 10000 });
    const pos = () => page.locator('.bg-layer img').evaluate((i) => [i.style.getPropertyValue('--bg-pos'), i.style.getPropertyValue('--bg-zoom')]);
    const p1 = await pos();
    check(p1[0] && p1[0] !== '50% 50%' && p1[1] === '1.5', `el encuadre se aplica al fondo (${p1.join(' · ')})`);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.bg-layer img')?.style.getPropertyValue('--bg-zoom') === '1.5', null, { timeout: 10000 });
    check(JSON.stringify(await pos()) === JSON.stringify(p1), 'el encuadre se conserva al volver a abrir la app');
    await page.goto(URL_ + '#/ajustes');
    await openAll(page);
    await page.getByRole('button', { name: 'Gestionar' }).click();
    await page.getByRole('checkbox', { name: 'Imagen propia' }).click();
    await page.getByRole('button', { name: 'Eliminar (1)' }).click();
    await page.waitForTimeout(800);
    check(await page.locator('.bg-layer img').count() === 0 && await page.locator('.bg-layer canvas').count() === 1, 'borrar el fondo en uso vuelve al integrado');
    check(await page.getByRole('checkbox', { name: 'Imagen propia' }).count() === 0 && await page.getByRole('radio', { name: 'Imagen propia' }).count() === 0, 'el fondo borrado ya no está en la galería');
  }

  if (run('almacen')) {
    console.log('Almacenamiento');
    const png = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 300; c.height = 200; c.getContext('2d').fillRect(0, 0, 300, 200);
      const b = await new Promise((r) => c.toBlob(r, 'image/png')); return [...new Uint8Array(await b.arrayBuffer())];
    });
    await page.goto(URL_ + '#/ajustes');
    await openAll(page);
    await page.getByRole('region', { name: 'Respaldo' }).getByRole('button', { name: /Importar/ }).click();
    await page.locator('.sheet input[type=file]').first().setInputFiles([
      { name: 'usado.png', mimeType: 'image/png', buffer: Buffer.from(png) },
      { name: 'sobra.png', mimeType: 'image/png', buffer: Buffer.from(png) },
      { name: 'Con imagen.md', mimeType: 'text/markdown', buffer: Buffer.from('# Con imagen\n\nTexto ![[usado.png]] fin\n') },
    ]);
    await page.locator('.sheet .btn.primary').filter({ hasText: /Importar/ }).click();
    await page.getByRole('button', { name: 'Listo' }).click();
    await page.getByRole('button', { name: 'Administrar almacenamiento' }).click();
    const st = page.getByRole('dialog', { name: 'Almacenamiento' });
    await st.getByText('usado.png').waitFor();
    const rowOf = (n) => st.locator('label.row-i', { hasText: n });
    check((await rowOf('usado.png').innerText()).includes('Usado en 1 lugar'), '«Usado en 1 lugar(es)» para la imagen citada en una nota');
    check((await rowOf('sobra.png').innerText()).includes('Huérfano'), 'la imagen sin uso aparece como huérfana');
    check(await st.locator('[role=listitem]').count() >= 2, 'desglose por tipo');
    await st.getByRole('button', { name: /Seleccionar huérfanos \(1\)/ }).click();
    await st.getByRole('button', { name: 'Borrar definitivamente' }).click();
    await page.waitForTimeout(800);
    check(await rowOf('sobra.png').count() === 0, 'borrar el huérfano libera espacio (desaparece de la lista)');
    await rowOf('usado.png').locator('input').check();
    await st.getByRole('button', { name: 'Borrar definitivamente' }).click();
    await page.waitForTimeout(800);
    await st.getByRole('button', { name: 'Cerrar' }).click();
    await page.goto(URL_ + '#/notas');
    await page.getByRole('link', { name: /Con imagen/ }).first().click();
    await page.getByText('Archivo eliminado: usado.png').waitFor();
    check(true, 'la nota muestra «Archivo eliminado» en lugar de una imagen rota');
  }

  if (run('buscar')) {
    console.log('Buscador de notas');
    await page.goto(URL_ + '#/ajustes');
    await openAll(page);
    await page.getByRole('region', { name: 'Respaldo' }).getByRole('button', { name: /Importar/ }).click();
    await page.locator('.sheet input[type=file]').first().setInputFiles([
      { name: 'Hipertensión.md', mimeType: 'text/markdown', buffer: Buffer.from('# Hipertensión\n\nPrimer párrafo sin cifras.\n\nMeta de presión 120/80 en diabéticos.\n\nOtra vez la presión: 130/80.\n') },
      { name: 'Gasometría.md', mimeType: 'text/markdown', buffer: Buffer.from('# Gasometría\n\npH 7.4 normal y bicarbonato 24 mEq/L.\n') },
    ]);
    await page.locator('.sheet .btn.primary').filter({ hasText: /Importar/ }).click();
    await page.getByRole('button', { name: 'Listo' }).click();
    await page.goto(URL_ + '#/notas');
    const box = page.getByRole('searchbox', { name: /Buscar en todas las notas/ });
    await box.waitFor();
    check(await box.isVisible(), 'barra de búsqueda siempre visible en Notas');
    await box.fill('120/80');
    await page.locator('.search-hit').first().waitFor();
    check(await page.locator('.search-hit').count() === 1 && (await page.locator('.search-hit mark.hit').first().innerText()) === '120/80', '«120/80» encuentra la nota y resalta la coincidencia');
    await box.fill('PH');
    await page.waitForTimeout(400);
    check((await page.locator('.search-hit').first().innerText()).includes('Gasometría'), '«pH» sin distinguir mayúsculas');
    await box.fill('130/8');
    await page.waitForTimeout(400);
    check(await page.locator('.search-hit').count() === 0, 'los números son exactos («130/8» no encuentra «130/80»)');
    await box.fill('presion');
    await page.locator('.search-hit').first().waitFor();
    await page.locator('.search-hit').first().click();
    const fb = page.getByRole('search', { name: 'Buscar en esta nota' });
    await fb.waitFor();
    await page.waitForTimeout(500);
    check((await fb.innerText()).includes('1 de 2'), 'abre la nota con «Buscar en esta nota» en la primera coincidencia (1 de 2)');
    const hl = await page.evaluate(() => (typeof CSS !== 'undefined' && CSS.highlights ? CSS.highlights.get('engrama-find-cur')?.size ?? 0 : -1));
    check(hl === 1 || hl === -1, 'la coincidencia actual está resaltada');
    await fb.getByRole('button', { name: 'Coincidencia siguiente' }).click();
    check((await fb.innerText()).includes('2 de 2'), 'siguiente / anterior con contador');
    // escribir en la nota no se pierde y el índice se actualiza al guardar
    await fb.getByRole('button', { name: 'Cerrar' }).click();
    await page.getByRole('button', { name: /Escribe o usa/ }).click();
    await page.locator('.doc textarea').last().click();
    await page.keyboard.type('Dato nuevo 37.5 grados');
    await page.waitForTimeout(1200);
    await box.fill('37.5');
    await page.locator('.search-hit').first().waitFor();
    check((await page.locator('.search-hit').first().innerText()).includes('Hipertensión'), 'el índice se actualiza al guardar (incremental)');
  }

  if (run('calor')) {
    console.log('Mapa de adherencia proporcional');
    await page.goto(URL_ + '#/hoy');
    const panel = page.locator('.heat-panel');
    await panel.waitFor();
    const cells = () => panel.locator('.heat .c').count();
    check(await cells() === 56, 'sin historial largo: 8 semanas (56 días), no un año');
    const w = (await panel.boundingBox()).width;
    check(w < 600, `el panel se ajusta a su contenido (${Math.round(w)} px)`);
    await panel.getByRole('button', { name: 'Ver año completo' }).click();
    check(await cells() === 371, '«Ver año completo» muestra 53 semanas');
    await panel.getByRole('button', { name: 'Ver solo mi actividad' }).click();
    check(await cells() === 56, 'volver a la vista proporcional');
  }

  if (run('examen')) {
    console.log('Editor visual de exámenes');
    await page.goto(URL_ + '#/simulacros');
    await page.getByRole('link', { name: 'Nuevo examen' }).click();
    await page.getByLabel('Título del examen').fill('Repaso rápido');
    await page.getByLabel('Minutos').fill('5');
    for (let i = 0; i < 5; i++) {
      if (i) await page.getByRole('button', { name: 'Añadir pregunta' }).click();
      const q = page.getByRole('region', { name: `Pregunta ${i + 1}` });
      await q.getByLabel('Enunciado').fill(`¿Pregunta ${i + 1}?`);
      for (const [k, txt] of [['A', 'uno'], ['B', 'dos'], ['C', 'tres']]) await q.getByLabel(`Texto de la opción ${k}`).fill(`${txt} ${i}`);
      await q.getByLabel(`Opción ${'ABC'[i % 3]} correcta`).check();
    }
    // validación: una pregunta sin correcta no se guarda
    const q5 = page.getByRole('region', { name: 'Pregunta 5' });
    await q5.getByLabel('Opción B correcta').uncheck();
    await page.getByRole('button', { name: 'Guardar' }).click();
    check(await page.getByRole('alert').count() === 1 && (await q5.innerText()).includes('Sin respuesta marcada'), 'validación: «Sin respuesta marcada» impide guardar');
    await q5.getByLabel('Opción B correcta').check();
    await page.getByRole('button', { name: 'Guardar' }).click();
    await page.getByText('Repaso rápido').first().waitFor();
    check((await page.locator('.kv', { hasText: 'Repaso rápido' }).innerText()).includes('5 listas'), 'el examen queda en el banco con 5 preguntas listas');
    // hacerlo como simulacro y ver resultados
    await page.getByRole('button', { name: 'Crear simulacro' }).click();
    const sh = page.locator('.sheet');
    await sh.waitFor();
    await sh.getByRole('button', { name: /Empezar|Comenzar|Iniciar/ }).first().click();
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('a');
      await page.waitForTimeout(150);
      await page.keyboard.press('ArrowRight');
    }
    await page.getByRole('button', { name: /Terminar/ }).first().click();
    const fin = page.locator('.sheet').getByRole('button', { name: /Terminar/ });
    if (await fin.count()) await fin.first().click();
    await page.locator('text=/\\d+ %/').first().waitFor({ timeout: 10000 });
    await page.waitForFunction(() => location.hash.startsWith('#/simulacros/resultado/'), null, { timeout: 10000 });
    check(true, 'crear un examen de 5 preguntas, hacerlo y ver los resultados sin tocar archivos');
  }

  if (run('espacios')) {
    console.log('Espacios conectados');
    // el menú se cierra si la página se desplaza: abrirlo con el botón ya a la vista
    const addMenu = async () => { const b = page.getByRole('button', { name: 'Añadir panel' }); await b.scrollIntoViewIfNeeded(); await page.waitForTimeout(150); await b.click(); await page.getByRole('menu').waitFor(); };
    await page.goto(URL_ + '#/espacios');
    await page.getByRole('button', { name: 'Nuevo espacio' }).first().click();
    check(await page.getByLabel('Preajuste').count() === 0, 'crear un espacio ya no ofrece preajustes');
    await page.getByLabel(/Nombre/).fill('Estudio conectado');
    await page.getByRole('button', { name: 'Crear' }).click();
    await page.getByText(/Añade paneles/).first().waitFor();
    check(await page.locator('.win').count() === 0, 'un espacio nuevo está vacío');
    await page.getByRole('button', { name: 'Añadir panel' }).click();
    const items = await page.getByRole('menuitem').allInnerTexts();
    check(items.length >= 13 && ['Nueva nota', 'Nota existente', 'Mazo', 'Tema', 'Simulacro', 'PDF', 'Documento', 'Hoja', 'Imagen', 'Pomodoro', 'Estadísticas', 'Calendario'].every((k) => items.some((x) => x.includes(k))), `«＋ Añadir panel» ofrece todo (${items.length})`);
    // nota nueva creada de verdad desde el panel
    await page.getByRole('menuitem', { name: /Nueva nota/ }).click();
    const form = page.getByRole('dialog', { name: 'Nueva nota' });
    await form.getByLabel('Materia').fill('Cardiología');
    await form.getByLabel('Tema o clase').fill('Arritmias');
    await form.getByLabel('Título').fill('Panel vivo');
    await form.getByRole('button', { name: 'Crear' }).click();
    const panel = page.locator('.win', { hasText: 'Panel vivo' });
    await panel.locator('.doc').waitFor();
    await panel.getByRole('button', { name: /Escribe o usa/ }).click();
    await panel.locator('.doc textarea').last().click();
    await page.keyboard.type('Escrito en el panel');
    await page.waitForTimeout(700);
    await page.goto(URL_ + '#/notas/Cardiolog%C3%ADa/Arritmias/Panel%20vivo.md');
    await page.getByText('Escrito en el panel').first().waitFor();
    check(true, 'lo escrito en el panel de nota aparece en la pestaña Notas (misma nota en la bóveda)');
    await page.getByRole('button', { name: /Escribe o usa/ }).click();
    await page.locator('.doc textarea').last().click();
    await page.keyboard.type('Y esto desde Notas');
    await page.waitForTimeout(700);
    await page.goto(URL_ + '#/espacios');
    await page.locator('.win', { hasText: 'Panel vivo' }).getByText('Y esto desde Notas').waitFor();
    check(true, 'y al revés: lo escrito en Notas aparece en el panel');
    // mazo como panel: estudiar cuenta igual que en Estudiar
    await addMenu();
    await page.getByRole('menuitem', { name: 'Añadir panel Mazo' }).evaluate((b) => b.click());
    await page.locator('.win .opt', { hasText: 'Cardiología' }).first().click();
    const dp = page.locator('.win', { hasText: 'Cardiología' }).last();
    await dp.getByRole('button', { name: 'Estudiar' }).click();
    for (let i = 0; i < 5; i++) {
      await dp.getByRole('button', { name: /Mostrar respuesta/ }).click();
      await dp.getByRole('button', { name: /^Bien/ }).click();
      await page.waitForTimeout(200);
    }
    await page.goto(URL_ + '#/hoy');
    await page.getByText(/Estudiaste 5 tarjetas/).waitFor();
    check(true, 'estudiar 5 tarjetas desde un panel de mazo actualiza Hoy');
    await page.reload();
    await page.getByText(/Estudiaste 5 tarjetas/).waitFor();
    check(true, 'todo sobrevive a recargar');
    // simulacro dentro del panel: misma pantalla, sin salir del espacio
    await page.goto(URL_ + '#/espacios');
    await addMenu();
    await page.getByRole('menuitem', { name: /Simulacro/ }).evaluate((b) => b.click());
    const sp = page.locator('.win', { has: page.locator('.sim-embed') });
    await sp.getByRole('link', { name: 'Nuevo examen' }).click();
    await sp.getByLabel('Título del examen').waitFor();
    check((await page.evaluate(() => location.hash)).startsWith('#/espacios'), 'crear un examen desde el panel sin salir del espacio');
  }

  if (run('calendario')) {
    console.log('Calendario con horas');
    // lunes siguientes a la fecha del sistema
    const today = await page.evaluate(() => { const d = new Date(); return [d.getFullYear(), d.getMonth(), d.getDate(), (d.getDay() + 6) % 7]; });
    const ymd = (k) => { const d = new Date(today[0], today[1], today[2] + k); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
    const mon1 = ymd(7 - today[3]), mon2 = ymd(14 - today[3]), mon3 = ymd(21 - today[3]);
    await page.goto(URL_ + '#/calendario');
    const newEntry = async (title, kind, date, from, to, extra) => {
      await page.getByRole('button', { name: 'Bloque', exact: true }).click();
      const f = page.getByRole('dialog');
      await f.getByLabel('Título').fill(title);
      await f.getByRole('radio', { name: kind }).click();
      await f.getByLabel('Fecha').fill(date);
      await f.getByLabel('Inicio').fill(from);
      await f.getByLabel('Fin', { exact: true }).fill(to);
      if (extra) await extra(f);
      await f.getByRole('button', { name: 'Guardar' }).click();
      await f.waitFor({ state: 'detached' });
    };
    await newEntry('Anatomía', 'Clase', mon1, '08:00', '10:00', async (f) => { await f.getByLabel('Repetir').selectOption('WEEKLY'); await f.getByLabel('Lugar').fill('Aula 3'); });
    await newEntry('Repasar Neuro', 'Estudio', mon1, '17:00', '18:00', async (f) => {
      await f.getByRole('button', { name: 'Vincular' }).click();
      await page.locator('.sheet .opt', { hasText: 'Cardiología' }).first().click(); // Neurología pudo borrarse en «papelera»
    });
    // borrar solo el segundo lunes
    const dayCell = (d) => page.locator(`.cal .day[data-day="${d}"]`);
    if (!(await dayCell(mon2).count())) await page.getByRole('button', { name: 'Siguiente' }).click();
    await dayCell(mon2).click();
    await page.getByRole('button', { name: 'Editar Anatomía' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click();
    await page.getByRole('button', { name: 'Solo este día' }).click();
    await page.waitForTimeout(500);
    const monthHas = async (d, t) => (await dayCell(d).count()) ? (await dayCell(d).innerText()).includes(t) : null;
    const check4 = async (tag) => {
      // Mes
      await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Mes' }).click();
      await page.getByRole('button', { name: 'Hoy', exact: true }).click();
      const m = [];
      for (const d of [mon1, mon2, mon3]) { let v = await monthHas(d, 'Anatomía'); if (v === null) { await page.getByRole('button', { name: 'Siguiente' }).click(); v = await monthHas(d, 'Anatomía'); await page.getByRole('button', { name: 'Hoy', exact: true }).click(); } m.push(v); }
      check(m[0] && !m[1] && m[2], `${tag}: Mes muestra la clase los lunes salvo el borrado`);
      // Semana del primer lunes: la clase de 8:00 y el estudio de 17:00 con horas
      await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Semana' }).click();
      await page.getByRole('button', { name: 'Hoy', exact: true }).click();
      if (!(await page.locator(`.tg-col[data-col="${mon1}"]`).count())) await page.getByRole('button', { name: 'Siguiente' }).click();
      const col = page.locator(`.tg-col[data-col="${mon1}"]`);
      check((await col.getByRole('button', { name: /Clase: Anatomía, 08:00–10:00/ }).count()) === 1 && (await col.getByRole('button', { name: /Estudio: Repasar Neuro, 17:00–18:00/ }).count()) === 1, `${tag}: Semana muestra Clase 8:00–10:00 y Estudio 17:00–18:00`);
      await page.getByRole('button', { name: 'Siguiente' }).click();
      check((await page.locator(`.tg-col[data-col="${mon2}"]`).getByText('Anatomía').count()) === 0, `${tag}: el lunes borrado no tiene la clase`);
      // Día del tercer lunes
      await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Día' }).click();
      await page.getByRole('button', { name: 'Hoy', exact: true }).click();
      for (let i = 0; i < 25 && !(await page.locator(`.tg-col[data-col="${mon3}"]`).count()); i++) await page.getByRole('button', { name: 'Siguiente' }).click();
      check((await page.locator(`.tg-col[data-col="${mon3}"]`).getByText('Anatomía').count()) === 1, `${tag}: vista Día`);
      // Agenda
      await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Agenda' }).click();
      await page.getByRole('button', { name: 'Hoy', exact: true }).click();
      const ag = await page.locator('main .glass.panel').first().innerText();
      check(/08:00\S*( a\. ?m\.)? Anatomía/.test(ag) && /(17:00|05:00 p\. ?m\.) Repasar Neuro/.test(ag) && !ag.includes(mon2.slice(8) + ' nov\n08'), `${tag}: Agenda`);
    };
    await check4('antes de recargar');
    await page.reload();
    await page.getByRole('heading', { name: 'Calendario', level: 1 }).waitFor();
    await check4('al reabrir');
    // el bloque de estudio vinculado muestra su vínculo y se puede iniciar
    await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Mes' }).click();
    await page.getByRole('button', { name: 'Hoy', exact: true }).click();
    if (!(await dayCell(mon1).count())) await page.getByRole('button', { name: 'Siguiente' }).click();
    await dayCell(mon1).click();
    const side = page.getByRole('region', { name: 'Día seleccionado' });
    check((await side.innerText()).includes('Cardiología') && (await side.getByRole('button', { name: 'Iniciar bloque' }).count()) >= 1, 'el bloque de estudio muestra el mazo vinculado y «Iniciar»');
    // cuadrícula: tocar una franja crea 1 h; arrastrar la entrada la mueve de hora
    await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Semana' }).click();
    await page.getByRole('button', { name: 'Hoy', exact: true }).click();
    if (!(await page.locator(`.tg-col[data-col="${mon1}"]`).count())) await page.getByRole('button', { name: 'Siguiente' }).click();
    const col = page.locator(`.tg-col[data-col="${mon1}"]`);
    await col.evaluate((c) => { c.closest('.tg-body').scrollTop = 12 * 44; });
    const cb = await col.boundingBox();
    const y13 = cb.y + 13 * 44 + 4;
    await page.mouse.click(cb.x + cb.width / 2, y13);
    const f = page.getByRole('dialog');
    check(await f.getByLabel('Inicio').inputValue() === '13:00' && await f.getByLabel('Fin', { exact: true }).inputValue() === '14:00', 'tocar la franja de las 13:00 crea una entrada de 1 h');
    await f.getByLabel('Título').fill('Tutoría');
    await f.getByRole('button', { name: 'Guardar' }).click();
    await f.waitFor({ state: 'detached' });
    const ev = col.getByRole('button', { name: /Tutoría, 13:00–14:00/ });
    const eb = await ev.boundingBox();
    await page.mouse.move(eb.x + eb.width / 2, eb.y + 8);
    await page.mouse.down();
    await page.mouse.move(eb.x + eb.width / 2, eb.y + 8 + 2 * 44, { steps: 8 });
    await page.mouse.up();
    await col.getByRole('button', { name: /Tutoría, 15:00–16:00/ }).waitFor();
    check(true, 'arrastrar la entrada 2 h abajo la mueve a 15:00–16:00');
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
