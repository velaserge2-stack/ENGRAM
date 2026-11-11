// Flujos de las fases 4–11 contra el build: simulacro (cerrar a mitad y continuar), bandeja Plaud,
// notas, espacios con PDF, calendario .ics.   npm run build && npm run e2e:flows
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const EX = new URL('../examples/', import.meta.url).pathname;
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = 4176;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
const errors = [];
const check = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✓', m); };

// Mejoras 2 · E13: sin preajustes; los paneles se añaden con el menú «＋ Añadir panel»
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
try {
  const ctx = await browser.newContext({ locale: 'es-MX', viewport: { width: 1180, height: 820 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();

  // ── Simulacro: importar, corregir dudosa, responder, "cerrar Safari", continuar
  await page.goto(URL_ + '#/simulacros/importar');
  let fc = page.waitForEvent('filechooser');
  await page.getByText('Elegir archivo').click();
  await (await fc).setFiles(EX + 'simulacros/cardio-parcial.md');
  await page.getByText(/5 preguntas detectadas; 1 sin respuesta marcada/).waitFor();
  check(true, 'vista previa: "5 preguntas detectadas; 1 sin respuesta marcada"');
  await page.getByLabel('Respuesta 5').fill('A');
  await page.getByLabel('Respuesta 5').blur();
  await page.getByRole('button', { name: /Guardar banco \(5 listas\)/ }).click();
  await page.getByRole('heading', { name: 'Simulacros' }).waitFor();
  await page.getByRole('button', { name: 'Crear simulacro' }).click();
  await page.getByRole('button', { name: /Empezar \(5 preguntas\)/ }).click();
  await page.getByRole('timer').waitFor();
  await page.keyboard.press('a');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('b');
  await page.waitForTimeout(400);
  const before = await page.getByRole('timer').textContent();
  await page.reload();
  await page.goto(URL_ + '#/simulacros');
  await page.getByRole('link', { name: 'Continuar simulacro' }).click();
  await page.getByRole('timer').waitFor();
  const answered = await page.locator('.qnav button.answered').count();
  const after = await page.getByRole('timer').textContent();
  check(answered === 2, `tras cerrar y reabrir se conservan las respuestas (${answered})`);
  check(Math.abs(toSec(before) - toSec(after)) <= 3, `el tiempo restante sigue correcto (${before} → ${after})`);
  await page.getByRole('button', { name: 'Terminar' }).first().click();
  await page.getByRole('button', { name: 'Terminar y ver resultados' }).click();
  await page.getByRole('heading', { name: 'Resultados' }).waitFor();
  await page.getByRole('button', { name: /Crear tarjetas de las falladas/ }).click();
  await page.getByText(/tarjetas creadas en decks\/Simulacros/).waitFor();
  check(true, 'resultados y "crear tarjetas de las falladas"');
  await page.screenshot({ path: OUT + 'flujo-resultados.png' });

  // ── Bandeja: archivos de Plaud → 4 pasos → nota archivada
  await page.goto(URL_ + '#/bandeja');
  fc = page.waitForEvent('filechooser');
  await page.getByText('Añadir archivos').click();
  await (await fc).setFiles([EX + 'plaud/Clase cardio 12-nov_summary.md', EX + 'plaud/Clase cardio 12-nov_transcript.txt', EX + 'plaud/Clase cardio 12-nov.srt']);
  await page.getByText(/1 elemento en la bandeja/).waitFor();
  check(true, 'tres archivos de la misma grabación se agrupan en un elemento');
  await page.getByRole('button', { name: 'Procesar' }).click();
  await page.getByLabel('Materia').fill('Cardiología');
  await page.getByLabel('Tema o clase').fill('ECG');
  await page.getByRole('button', { name: 'Siguiente: limpiar' }).click();
  await page.getByRole('button', { name: 'Siguiente: crear tarjetas' }).click();
  await page.getByRole('button', { name: 'Siguiente: archivar' }).click();
  await page.getByRole('button', { name: 'Archivar', exact: true }).last().click();
  await page.getByText(/Archivado en Cardiología › ECG/).waitFor();
  await page.locator('.doc').getByText('Bloqueos auriculoventriculares').first().waitFor();
  check(true, 'procesada y archivada como nota de clase (resumen arriba, transcripción plegada)');
  await page.screenshot({ path: OUT + 'flujo-nota.png' });

  // ── Notas: editar un bloque y ver la propiedad guardada
  await page.locator('.doc [aria-label="Editar bloque"]').nth(1).click();
  await page.locator('.doc textarea').fill('Texto **editado** con [[Clase 1 - ECG básico]]');
  await page.locator('.doc textarea').blur();
  await page.waitForTimeout(900);
  await page.reload();
  await page.locator('.doc').getByText('editado').waitFor();
  check(true, 'editar un bloque de la nota se guarda (autoguardado)');

  // ── Espacios: PDF + estudio y abrir un PDF
  await page.goto(URL_ + '#/espacios');
  await newSpace(page, 'PDF + tarjetas', ['PDF', 'Estudio']);
  fc = page.waitForEvent('filechooser');
  await page.getByText('Abrir PDF').click();
  await (await fc).setFiles(EX + 'docs/guia-ecg.pdf');
  await page.locator('.pdf-page canvas.page').first().waitFor({ timeout: 15000 });
  await page.locator('.textLayer span').first().waitFor({ timeout: 15000 });
  check(true, 'el PDF se renderiza con capa de texto en un panel junto al estudio');
  await page.screenshot({ path: OUT + 'flujo-espacios.png' });
  await page.getByRole('button', { name: 'Lienzo' }).click();
  await page.getByRole('button', { name: 'Ajustar al contenido' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + 'flujo-lienzo.png' });
  check(true, 'modo lienzo con ajustar al contenido');

  // ── Calendario: crear bloque y exportar .ics
  await page.goto(URL_ + '#/calendario');
  await page.getByRole('button', { name: 'Bloque' }).click();
  await page.getByLabel('Título').fill('Repasar ECG');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.locator('.cal .ev').getByText(/Repasar ECG/).first().waitFor();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar .ics' }).click();
  const ics = await (await dl).path();
  const txt = require('node:fs').readFileSync(ics, 'utf8');
  check(txt.includes('SUMMARY:Repasar ECG') && txt.includes('BEGIN:VALARM'), 'bloque de estudio exportado a .ics con alarma');
  await page.screenshot({ path: OUT + 'flujo-calendario.png' });

  check(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log('\nOK');
} catch (e) {
  console.error('Errores de consola:', errors);
  for (const c of browser.contexts()) for (const [i, pg] of c.pages().entries()) await pg.screenshot({ path: OUT + `flujo-fallo-${i}.png` }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  server.kill();
}
function toSec(t) { const [m, s] = String(t).trim().split(':').map(Number); return m * 60 + s; }
