// Prompt 6: mover mazos, tarjetas y notas; Perfil como centro; Bandeja oculta; mini reproductor.
//   npm run build && npm run e2e:p6      (ONLY=mazos,notas,… para correr una parte)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4182;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
const check = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✓', m); };
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
const rowNames = (page) => page.locator('table.decks tbody tr[data-drop]').evaluateAll((rs) => rs.map((r) => r.dataset.drop));

try {
  const { ctx, page } = await fresh();

  if (run('mazos')) {
    console.log('Mover mazos y tarjetas');
    await page.goto(URL_ + '#/mazos');
    await page.locator('table.decks').waitFor();
    // engranaje → Mover a… → Cardiología
    await page.locator('tr[data-drop="Neurología/EVC"]').click();
    await page.getByRole('button', { name: 'Opciones de EVC' }).click();
    await page.getByRole('button', { name: 'Mover a…' }).click();
    const sh = page.getByRole('dialog', { name: 'Mover a…' });
    check(await sh.getByRole('radio', { name: /Neurología/ }).count() >= 1 && await sh.getByRole('radio', { name: 'EVC' }).count() === 0, 'el selector excluye el propio mazo');
    await sh.getByRole('radio', { name: 'Cardiología' }).click();
    await sh.getByRole('button', { name: 'Mover aquí' }).click();
    await page.locator('tr[data-drop="Cardiología/EVC"]').waitFor();
    check((await rowNames(page)).includes('Cardiología/EVC'), 'EVC pasa a ser submazo de Cardiología');
    await page.locator('.toast').getByRole('button', { name: 'Deshacer' }).click();
    await page.locator('tr[data-drop="Neurología/EVC"]').waitFor();
    check(true, '«Deshacer» lo devuelve');

    // menú contextual (clic derecho) → Mover a… → Nivel superior
    await page.locator('tr[data-drop="Neurología/Cefaleas"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Mover a…' }).click();
    await page.getByRole('dialog', { name: 'Mover a…' }).getByRole('radio', { name: /Nivel superior/ }).click();
    await page.getByRole('dialog', { name: 'Mover a…' }).getByRole('button', { name: 'Mover aquí' }).click();
    await page.locator('tr[data-drop="Cefaleas"]').waitFor();
    check(true, 'menú contextual: Cefaleas al nivel superior');

    // arrastrar y soltar (pulsación larga y arrastrar): Cefaleas → Cardiología
    const src = await page.locator('tr[data-drop="Cefaleas"] .name').boundingBox();
    const dst = await page.locator('tr[data-drop="Cardiología"] .name').boundingBox();
    await page.mouse.move(src.x + 60, src.y + src.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.move(src.x + 70, src.y + 20, { steps: 3 });
    await page.mouse.move(dst.x + 60, dst.y + dst.height / 2, { steps: 8 });
    check(await page.locator('.drag-ghost').isVisible(), 'al arrastrar aparece la etiqueta flotante');
    await page.mouse.up();
    await page.locator('tr[data-drop="Cardiología/Cefaleas"]').waitFor();
    check(true, 'arrastrar y soltar: Cefaleas dentro de Cardiología');

    // selección múltiple → Mover (n)
    await page.getByRole('button', { name: 'Seleccionar' }).click();
    await page.getByRole('checkbox', { name: /Seleccionar Cefaleas/ }).check();
    await page.getByRole('button', { name: 'Mover (1)' }).click();
    await page.getByRole('dialog', { name: 'Mover a…' }).getByRole('radio', { name: 'Neurología' }).click();
    await page.getByRole('dialog', { name: 'Mover a…' }).getByRole('button', { name: 'Mover aquí' }).click();
    await page.locator('tr[data-drop="Neurología/Cefaleas"]').waitFor();
    check(true, 'tocar para seleccionar y luego el destino');

    // mover una tarjeta desde el navegador
    await page.goto(URL_ + '#/explorar');
    const first = page.locator('table.tbl tbody tr').first();
    await first.waitFor();
    const deckBefore = await first.locator('td').nth(2).innerText();
    await first.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Mover a mazo…' }).click();
    const target = deckBefore.includes('Cardiología') ? 'EVC' : 'Cardiología';
    await page.getByRole('dialog', { name: /Mover 1 a mazo/ }).getByRole('button', { name: target }).click();
    await page.locator('.toast', { hasText: 'movidas' }).waitFor();
    check(true, `una tarjeta movida a ${target} (conserva ID)`);
    // desde la lista del mazo (también es el panel de mazo del lienzo)
    await page.goto(URL_ + '#/mazos/decks/Cardiolog%C3%ADa.md');
    await page.getByRole('region', { name: 'Vista previa' }).getByRole('button', { name: 'Seleccionar' }).click();
    await page.locator('.pick-note .pick').first().check();
    await page.getByRole('button', { name: 'Mover a mazo… (1)' }).click();
    await page.getByRole('dialog', { name: /Mover 1 a mazo/ }).getByRole('button', { name: 'Cefaleas' }).click();
    await page.locator('.toast', { hasText: 'Cefaleas' }).waitFor();
    check(true, 'desde la lista del mazo: tarjeta a Cefaleas');
    await page.goto(URL_ + '#/ajustes');
    await page.getByRole('button', { name: 'Comprobar' }).first().click();
    await page.getByText(/idéntico/i).first().waitFor();
    check(true, 'verifyDeterminism: el estado reconstruido es idéntico');
  }

  if (run('notas')) {
    console.log('Mover notas y temas');
    await page.goto(URL_ + '#/notas/+nueva');
    const sh = page.locator('.sheet');
    await sh.getByLabel('Materia').fill('Urgencias');
    await sh.getByLabel('Tema o clase').fill('Arritmias');
    await sh.getByLabel('Título').fill('Taquicardias');
    await page.getByRole('button', { name: 'Crear' }).click();
    await page.locator('.doc').waitFor();
    // desde la barra de acciones de la nota
    await page.goto(URL_ + '#/notas/Cardiolog%C3%ADa/ECG/Clase%201%20-%20ECG%20b%C3%A1sico.md');
    await page.locator('.doc').waitFor();
    await page.getByRole('button', { name: 'Mover a otra materia o tema' }).click();
    const mv = page.getByRole('dialog', { name: 'Mover a…' });
    check(await mv.getByRole('radio', { name: 'ECG' }).isDisabled(), 'el tema actual aparece como «aquí»');
    await mv.getByRole('radio', { name: 'Arritmias' }).click();
    await mv.getByRole('button', { name: 'Mover aquí' }).click();
    await page.waitForURL(/Urgencias\/Arritmias\/Clase/);
    await page.locator('.doc').waitFor();
    check((await page.locator('.doc').innerText()).includes('ECG básico'), 'la nota se abre en su nueva ruta');
    await page.getByRole('searchbox', { name: /Buscar en todas las notas/ }).fill('derivaciones');
    await page.getByRole('region', { name: 'Resultados de la búsqueda' }).waitFor();
    check((await page.getByRole('region', { name: 'Resultados de la búsqueda' }).innerText()).includes('Arritmias'), 'el buscador la encuentra en su nueva ubicación');
    await page.getByRole('searchbox', { name: /Buscar en todas las notas/ }).fill('');
    await page.locator('.toast').getByRole('button', { name: 'Deshacer' }).click();
    await page.waitForURL(/Cardiolog%C3%ADa\/ECG\/Clase|Cardiología\/ECG\/Clase/);
    check(true, '«Deshacer» la devuelve a Cardiología/ECG');

    // otra nota en otro tema para tener destinos
    await page.locator('.tree').getByRole('button', { name: 'Nota', exact: true }).click();
    await page.locator('.sheet').getByLabel('Materia').fill('Urgencias');
    await page.locator('.sheet').getByLabel('Tema o clase').fill('Choque');
    await page.locator('.sheet').getByLabel('Título').fill('Sepsis');
    await page.locator('.sheet').getByRole('button', { name: 'Crear', exact: true }).click();
    await page.waitForURL(/Sepsis/);
    await page.locator('.doc').waitFor();

    // árbol: menú contextual (clic derecho) en una nota
    await page.locator('.tree a', { hasText: 'Taquicardias' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Mover a…' }).click();
    await page.getByRole('dialog', { name: 'Mover a…' }).getByRole('radio', { name: 'ECG' }).click();
    await page.getByRole('dialog', { name: 'Mover a…' }).getByRole('button', { name: 'Mover aquí' }).click();
    await page.locator('.toast', { hasText: 'Cardiología/ECG' }).waitFor();
    await page.locator('.tree button.ti', { hasText: 'Arritmias' }).waitFor({ state: 'detached' });
    check(true, 'menú contextual del árbol: Taquicardias a Cardiología/ECG');

    // arrastrar un tema entero a otra materia: Cardiología/ECG → Urgencias
    const src = await page.locator('.tree button.ti', { hasText: 'ECG' }).boundingBox();
    const dst = await page.locator('.tree button.ti', { hasText: 'Urgencias' }).boundingBox();
    await page.mouse.move(src.x + 40, src.y + src.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.move(src.x + 44, src.y + src.height / 2 + 12, { steps: 3 });
    await page.mouse.move(dst.x + 40, dst.y + dst.height / 2, { steps: 8 });
    check(await page.locator('.tree .ti.drop-over').count() === 1, 'al arrastrar se marca la materia de destino');
    await page.mouse.up();
    await page.locator('.toast', { hasText: '2 nota' }).waitFor();
    await page.locator('.tree button.ti', { hasText: 'Cardiología' }).waitFor({ state: 'detached' });
    check(true, 'arrastrar: el tema completo (2 notas) pasa a Urgencias');

    // selección múltiple
    await page.getByRole('button', { name: 'Seleccionar notas' }).click();
    await page.locator('.tree .pick-row', { hasText: 'Taquicardias' }).getByRole('checkbox').check();
    await page.locator('.tree .pick-row', { hasText: 'Clase 1' }).getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Mover (2)' }).click();
    await page.getByRole('dialog', { name: 'Mover a…' }).getByRole('radio', { name: 'Choque' }).click();
    await page.getByRole('dialog', { name: 'Mover a…' }).getByRole('button', { name: 'Mover aquí' }).click();
    await page.locator('.toast', { hasText: 'Urgencias/Choque' }).waitFor();
    await page.locator('.tree button.ti', { hasText: 'ECG' }).waitFor({ state: 'detached' });
    check(true, 'varias notas a la vez (selección)');
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
