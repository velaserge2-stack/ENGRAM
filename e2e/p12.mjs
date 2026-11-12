// Prompt 12: crear notas pidiendo solo el título; «Sin clasificar» y «Sin tema».
//   npm run build && npm run e2e:p12
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4185;
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
const tree = (page) => page.locator('.tree').innerText();
/** Espera (sondeo) a que el árbol de notas cumpla una expresión. */
const treeHas = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.tree')?.innerText ?? ''), re.source, { timeout: 8000 }).then(() => true, () => false);
/** Abre «Nueva nota» desde la vista general de Notas. */
async function newNote(page, { title, materia = '', tema = '' }) {
  await page.goto(URL_ + '#/notas');
  await page.getByRole('button', { name: 'Nueva nota', exact: true }).first().click();
  const sh = page.locator('.sheet');
  await sh.waitFor();
  check(await page.waitForFunction(() => document.activeElement === document.querySelector('.sheet input'), null, { timeout: 2000 }).then(() => true, () => false), 'el título es el primer campo y tiene el foco');
  if (materia) await sh.getByLabel('Materia (opcional)').fill(materia);
  if (tema) await sh.getByLabel('Tema o clase (opcional)').fill(tema);
  await sh.getByLabel('Título').fill(title);
  await sh.getByLabel('Título').press('Enter');
  await page.locator('.doc').waitFor();
}

try {
  const { ctx, page } = await fresh();
  console.log('Crear con solo el título');
  await page.goto(URL_ + '#/notas');
  await page.getByRole('button', { name: 'Nueva nota', exact: true }).first().click();
  const sh = page.locator('.sheet');
  check(await sh.locator('input[required]').count() === 1, 'solo un campo obligatorio');
  check(await sh.getByLabel('Materia (opcional)').inputValue() === '' && await sh.getByLabel('Tema o clase (opcional)').inputValue() === '', 'materia y tema empiezan vacíos');
  await page.keyboard.press('Escape');
  await newNote(page, { title: 'Idea rápida 🫀 ñ' });
  check(decodeURIComponent(page.url()).endsWith('#/notas/Idea rápida 🫀 ñ.md'), 'Intro con solo el título crea y abre la nota al instante');
  check((await page.locator('.doc').innerText()).includes('Idea rápida 🫀 ñ'), 'la plantilla se rellena sin «undefined»');
  check(!(await page.locator('.doc').innerText()).includes('undefined'), 'sin «undefined»');
  await page.getByText('Sin clasificar').first().waitFor();
  check(await treeHas(page, /Sin clasificar[\s\S]*Idea rápida/), 'aparece en «Sin clasificar»');

  console.log('Solo materia y completa');
  await newNote(page, { title: 'Solo materia', materia: 'Cardiología' });
  check(decodeURIComponent(page.url()).endsWith('#/notas/Cardiología/Solo materia.md'), 'con solo materia: notes/Cardiología/Solo materia.md');
  check(await treeHas(page, /Cardiología[\s\S]*Sin tema[\s\S]*Solo materia/), 'aparece en su materia, grupo «Sin tema»');
  await newNote(page, { title: 'Completa', materia: 'Cardiología', tema: 'ECG' });
  check(decodeURIComponent(page.url()).endsWith('#/notas/Cardiología/ECG/Completa.md'), 'completa: igual que hoy');
  await newNote(page, { title: 'Idea rápida 🫀 ñ' });
  check(decodeURIComponent(page.url()).endsWith('#/notas/Idea rápida 🫀 ñ (2).md'), 'un título repetido no sobrescribe: «(2)»');

  console.log('Mover entre «Sin clasificar» y una materia/tema');
  await page.locator('.tree a', { hasText: 'Idea rápida 🫀 ñ (2)' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Mover a…' }).click();
  await page.getByRole('dialog', { name: 'Mover a…' }).getByRole('radio', { name: 'ECG' }).click();
  await page.getByRole('dialog', { name: 'Mover a…' }).getByRole('button', { name: 'Mover aquí' }).click();
  await page.waitForURL(/Cardiolog.*ECG.*Idea/);
  await page.locator('.tree a[href*="ECG"]', { hasText: 'Idea rápida 🫀 ñ (2)' }).waitFor();
  check(true, 'de «Sin clasificar» a Cardiología › ECG');
  await page.locator('.tree a[href*="ECG"]', { hasText: 'Idea rápida 🫀 ñ (2)' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Mover a…' }).click();
  await page.getByRole('dialog', { name: 'Mover a…' }).getByRole('radio', { name: 'Sin clasificar' }).click();
  await page.getByRole('dialog', { name: 'Mover a…' }).getByRole('button', { name: 'Mover aquí' }).click();
  await page.waitForURL(/#\/notas\/Idea[^/]*$/);
  check(true, 'y de vuelta a «Sin clasificar»');

  console.log('Recargar, buscar y abrir');
  await page.reload();
  await page.locator('.doc').waitFor();
  for (const x of ['Idea rápida 🫀 ñ (2)', 'Solo materia', 'Completa']) await page.locator('.tree a', { hasText: x }).first().waitFor();
  check(await treeHas(page, /Sin clasificar[\s\S]*Idea rápida 🫀 ñ/) && await treeHas(page, /Sin tema[\s\S]*Solo materia/) && await treeHas(page, /ECG[\s\S]*Completa/), 'tras recargar todo sigue en su sitio');
  await page.getByRole('searchbox', { name: /Buscar en todas las notas/ }).fill('rápida');
  await page.getByRole('region', { name: 'Resultados de la búsqueda' }).waitFor();
  check((await page.getByRole('region', { name: 'Resultados de la búsqueda' }).innerText()).includes('Idea rápida'), 'el buscador encuentra la nota sin clasificar');
  await page.getByRole('searchbox', { name: /Buscar en todas las notas/ }).fill('');

  console.log('Panel de nota del lienzo');
  await page.goto(URL_ + '#/espacios');
  await page.getByRole('button', { name: 'Nuevo espacio' }).first().click();
  await page.locator('.sheet input[name=n]').fill('Notas');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.getByText(/Añade paneles/).first().waitFor();
  await addPanel(page, 'Nota');
  await page.locator('.win').getByRole('button', { name: /Nueva nota/ }).click();
  await page.locator('.sheet').getByLabel('Título').fill('Desde el lienzo');
  await page.locator('.sheet').getByLabel('Título').press('Enter');
  await page.locator('.win .doc').waitFor();
  check((await page.locator('.win .doc').innerText()).includes('Desde el lienzo'), 'desde el panel del lienzo: solo el título, y se abre en el panel');

  console.log('Respaldo .zip y reimportación con las tres variantes');
  await page.goto(URL_ + '#/perfil');
  await page.getByRole('button', { name: /^Respaldo/ }).first().click();
  await page.getByRole('button', { name: 'Preparar respaldo (.zip)' }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Guardar en Archivos' }).click();
  const zip = await (await dl).path();
  const { ctx: c2, page: p2 } = await fresh();
  await p2.goto(URL_ + '#/mazos');
  await p2.getByRole('button', { name: 'Importar archivo' }).click();
  await p2.locator('.sheet input[type=file]').first().setInputFiles({ name: 'respaldo.zip', mimeType: 'application/zip', buffer: require('node:fs').readFileSync(zip) });
  await p2.locator('.sheet').getByRole('button', { name: 'Importar', exact: true }).click();
  await p2.waitForTimeout(800);
  await p2.goto(URL_ + '#/notas');
  for (const x of ['Idea rápida 🫀 ñ', 'Solo materia', 'Completa']) await p2.locator('.tree a', { hasText: x }).first().waitFor();
  check(await treeHas(p2, /Sin clasificar[\s\S]*Idea rápida 🫀 ñ/) && await treeHas(p2, /Sin tema[\s\S]*Solo materia/) && await treeHas(p2, /ECG[\s\S]*Completa/), 'el respaldo reimportado trae las tres variantes en su sitio');
  await c2.close();

  console.log('Idiomas');
  for (const [lang, btn, nueva, mat, tem, sin] of [['fr', 'Français', 'Nouvelle note', 'Matière (facultatif)', 'Thème ou cours (facultatif)', 'Non classées'], ['en', 'English', 'New note', 'Subject (optional)', 'Topic or class (optional)', 'Unsorted']]) {
    await page.goto(URL_ + '#/ajustes/idioma');
    await page.locator('#idioma').getByRole('button', { name: btn }).click();
    await page.waitForTimeout(400);
    await page.goto(URL_ + '#/notas');
    await page.getByRole('button', { name: nueva, exact: true }).first().click();
    const f = page.locator('.sheet');
    check(await f.getByLabel(mat).count() === 1 && await f.getByLabel(tem).count() === 1, `${lang}: «${mat}» y «${tem}»`);
    await page.keyboard.press('Escape');
    check(await treeHas(page, new RegExp(sin)), `${lang}: grupo «${sin}»`);
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
