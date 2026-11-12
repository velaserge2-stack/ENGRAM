// Prompt 10: importar .apkg de Anki en los tres formatos (legado, compatibilidad, nuevo) y archivos basura.
//   npm run build && npm run e2e:p10
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4184;
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
const FIX = new URL('../tests/fixtures/apkg/', import.meta.url).pathname;
const openImport = async (page) => {
  await page.goto(URL_ + '#/mazos');
  await page.getByRole('button', { name: 'Importar archivo' }).click();
  await page.locator('.sheet').waitFor();
};
const upload = (page, name) => page.locator('.sheet input[type=file]').first().setInputFiles(FIX + name);

try {
  for (const [file, label] of [['legado.apkg', 'legado'], ['compat.apkg', 'compatibilidad'], ['nuevo.apkg', 'formato nuevo']]) {
    console.log(`Anki ${label} (${file})`);
    const { ctx, page } = await fresh();
    await openImport(page);
    await upload(page, file);
    const sum = page.locator('.sheet .import-sum');
    await sum.waitFor({ timeout: 30000 });
    const txt = await sum.innerText();
    check(/2 mazos · 6 tarjetas · 1 imágenes y audios · 6 repasos de historial/.test(txt), `resumen antes de confirmar: ${txt}`);
    const warn = await page.locator('.sheet ul').first().innerText();
    check(/Esquema Anki v(11|18): 5 notas, 2 mazos, 1 medios/.test(warn) && /1 notas omitidas por estar vacías/.test(warn), 'avisa el esquema detectado y la nota vacía omitida');
    check(!(await page.locator('.sheet').innerText()).includes('Please update'), 'el marcador falso no aparece');
    await page.locator('.sheet').getByRole('button', { name: 'Importar', exact: true }).click();
    await page.locator('.sheet').getByRole('button', { name: 'Deshacer importación' }).waitFor();
    // la colección se recarga sola: los mazos ya están en la pestaña de fondo
    await page.locator('tr[data-drop="Medicina/Cardio/ECG"]').waitFor({ state: 'attached' });
    const base = file.replace('.apkg', '');
    check(await page.locator(`tr[data-drop="${base}"]`).count() === 1, `mazos jerárquicos (Medicina/Cardio/ECG) y «Default» con el nombre del archivo («${base}») sin recargar la app`);
    await page.locator('.sheet').getByRole('button', { name: 'Deshacer importación' }).click();
    await page.locator('tr[data-drop="Medicina/Cardio/ECG"]').waitFor({ state: 'detached' });
    check(true, 'deshacer la importación los quita');
    // otra vez, y ahora «Ver mazos» → estudiar una tarjeta
    await openImport(page);
    await upload(page, file);
    await page.locator('.sheet .import-sum').waitFor({ timeout: 30000 });
    await page.locator('.sheet').getByRole('button', { name: 'Importar', exact: true }).click();
    await page.locator('.sheet').getByRole('button', { name: 'Ver mazos' }).click();
    await page.waitForURL(/#\/mazos$/);
    await page.locator('tr[data-drop="Medicina/Cardio/ECG"]').waitFor();
    check(true, '«Ver mazos» lleva a la pestaña Mazos y ahí están');
    await page.goto(URL_ + '#/estudiar/decks/Medicina/Cardio/ECG.md');
    await page.locator('.study-card').waitFor();
    await page.getByRole('button', { name: /Mostrar respuesta/ }).click();
    await page.getByRole('group', { name: 'Calificación' }).getByRole('button', { name: /^Bien/ }).click();
    await page.waitForTimeout(300);
    check(true, 'se estudia una tarjeta importada');
    await ctx.close();
  }

  console.log('Paquete de Anki que llega como .zip');
  {
    const { ctx, page } = await fresh();
    await openImport(page);
    await page.locator('.sheet input[type=file]').first().setInputFiles({ name: 'Traumatologia.zip', mimeType: 'application/zip', buffer: require('node:fs').readFileSync(FIX + 'nuevo.apkg') });
    await page.locator('.sheet .import-sum').waitFor({ timeout: 30000 });
    check(/2 mazos · 6 tarjetas/.test(await page.locator('.sheet .import-sum').innerText()), 'se reconoce por su contenido y se importa como Anki');
    check(!(await page.locator('.sheet .plan-list').innerText()).includes('docs/'), 'no se tira como archivos sueltos en docs/');
    await page.locator('.sheet').getByRole('button', { name: 'Importar', exact: true }).click();
    await page.locator('.sheet').getByRole('button', { name: 'Ver mazos' }).click();
    await page.locator('tr[data-drop="Traumatologia"]').waitFor();
    check(true, 'aparece en Mazos (el «Default» toma el nombre del archivo)');
    if (process.env.USER_APKG) {
      await openImport(page);
      await page.locator('.sheet input[type=file]').first().setInputFiles(process.env.USER_APKG);
      await page.locator('.sheet .import-sum').waitFor({ timeout: 60000 });
      console.log('    archivo real:', await page.locator('.sheet .import-sum').innerText());
      await page.locator('.sheet').getByRole('button', { name: 'Importar', exact: true }).click();
      await page.locator('.sheet').getByRole('button', { name: 'Ver mazos' }).click({ timeout: 60000 });
      await page.waitForTimeout(800);
      console.log('    mazos:', (await page.locator('table.decks tbody tr[data-drop]').evaluateAll((r) => r.map((x) => x.dataset.drop))).filter((x) => /TRAUMA/i.test(x)).length, 'filas de TRAUMATOLOGÍA');
      await page.screenshot({ path: OUT + 'p10-archivo-real.png', fullPage: true });
    }
    await ctx.close();
  }

  console.log('Archivo basura renombrado a .apkg');
  {
    const { ctx, page } = await fresh();
    await openImport(page);
    await upload(page, 'basura.apkg');
    const alert = page.locator('.sheet .import-fail');
    await alert.waitFor({ timeout: 20000 });
    const txt = await alert.innerText();
    check(/No se encontraron tarjetas en este archivo/.test(txt) && /No es un paquete de Anki válido/.test(txt), 'mensaje principal claro con la causa y el paso siguiente');
    check(await alert.getAttribute('role') === 'alert', 'se anuncia (role=alert)');
    await page.locator('.sheet').getByRole('button', { name: 'Elegir otros' }).click();
    await page.locator('.sheet').getByRole('button', { name: 'Elegir archivos' }).waitFor();
    check(true, 'se puede volver a elegir sin que nada se rompa');
    await ctx.close();
  }

  check(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log('\nOK');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
