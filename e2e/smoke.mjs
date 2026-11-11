// Prueba de humo de la fase 1 contra el build (`npm run build` antes).
// Usa WebKit si está instalado (aproximación de Safari); si no, Chromium.
//   BROWSER=webkit|chromium  PLAYWRIGHT_PATH=/ruta/a/playwright  npm run e2e
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { unzipSync, strFromU8 } from 'fflate';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = 4173;
const URL_ = `http://localhost:${PORT}/`;

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => {
  server.stdout.on('data', (d) => String(d).includes('localhost') && res());
  server.on('exit', (c) => rej(new Error('preview salió ' + c)));
});

let browserType = pw[process.env.BROWSER || 'webkit'];
let browser;
try {
  browser = await browserType.launch();
} catch {
  console.warn('WebKit no disponible; usando Chromium');
  browserType = pw.chromium;
  browser = await browserType.launch();
}
console.log('Navegador:', browserType.name());

const errors = [];
const check = (cond, msg) => {
  if (!cond) throw new Error('FALLÓ: ' + msg);
  console.log('  ✓', msg);
};

try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(URL_);
  await page.getByText('Bienvenido a Engrama').waitFor();
  check(true, 'pantalla de bienvenida con guía de instalación manual');
  await page.screenshot({ path: OUT + '0-bienvenida.png' });

  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.getByRole('link', { name: 'Cardiología' }).first().waitFor();
  check(true, 'bóveda de ejemplo cargada y visible en Hoy');
  await page.waitForTimeout(800); // autoguardado de ajustes (500 ms)

  await page.reload();
  await page.getByRole('link', { name: 'Cardiología' }).first().waitFor();
  check((await page.getByText('Bienvenido a Engrama').count()) === 0, 'tras recargar, los datos y ajustes sobreviven (OPFS)');

  await page.goto(URL_ + '#/ajustes');
  await page.getByText('OPFS').first().waitFor();
  const detail = await page.getByText('OPFS').first().textContent();
  check(true, 'backend: ' + detail);
  check((await page.getByText('✓ Sin problemas').count()) === 1, 'comprobación de integridad sin problemas');
  await page.screenshot({ path: OUT + '2-ajustes.png', fullPage: false });

  // estudiar una tarjeta: mostrar respuesta → Bien; queda en reviews.jsonl
  await page.goto(URL_ + '#/estudiar');
  await page.getByRole('button', { name: /Mostrar respuesta/ }).click();
  await page.getByRole('button', { name: /^Bien, vuelve en/ }).click();
  await page.waitForTimeout(600);
  await page.goto(URL_ + '#/hoy');
  await page.getByText(/Estudiaste 1 tarjetas/).waitFor();
  check(true, 'estudiar registra el repaso y Hoy lo refleja');
  await page.goto(URL_ + '#/ajustes');
  await page.getByRole('button', { name: 'Comprobar', exact: true }).click();
  await page.getByText(/✓ Idéntico/).waitFor();
  check(true, 'reconstruir desde reviews.jsonl da el mismo estado que state.json');

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // ahora controlada por el SW
  await ctx.setOffline(true);
  await page.goto(URL_ + '#/hoy');
  await page.getByRole('link', { name: 'Cardiología' }).first().waitFor();
  check(true, 'funciona sin conexión (service worker)');
  await ctx.setOffline(false);
  await page.screenshot({ path: OUT + '1-hoy-claro.png' });

  // Exportar → descarga (Chromium/WebKit headless no comparten archivos)
  await page.getByRole('button', { name: 'Respaldo' }).first().click();
  await page.getByRole('button', { name: 'Preparar respaldo (.zip)' }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Guardar en Archivos' }).click();
  const download = await dl;
  const file = OUT + download.suggestedFilename();
  await download.saveAs(file);
  check(/^Engrama_.*\.zip$/.test(download.suggestedFilename()), 'nombre del respaldo: ' + download.suggestedFilename());
  const zip = unzipSync(new Uint8Array(readFileSync(file)));
  const manifest = JSON.parse(strFromU8(zip['manifest.json']));
  check(manifest.format === 'engrama-vault' && manifest.counts.decks === 3 && !!zip['.app/reviews.jsonl'], `zip con manifest.json (${manifest.counts.files} archivos, ${manifest.counts.decks} mazos)`);
  check(!Object.keys(zip).some((k) => k.startsWith('.app/tmp') || k === '.app/journal.json'), 'el zip no incluye diario ni temporales');
  await page.getByText('Respaldo descargado').waitFor();
  await page.waitForTimeout(700);

  // Reimportar en un contexto limpio
  const ctx2 = await browser.newContext({ viewport: { width: 820, height: 1180 } });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push(String(e)));
  await p2.goto(URL_);
  await p2.getByRole('button', { name: 'Restaurar respaldo' }).click();
  const chooser = p2.waitForEvent('filechooser');
  await p2.getByRole('button', { name: 'Elegir archivos' }).click();
  await (await chooser).setFiles(file);
  await p2.getByText(/archivos: \d+ nuevos/).waitFor();
  await p2.screenshot({ path: OUT + '3-importar.png' });
  await p2.getByRole('button', { name: 'Importar', exact: true }).click();
  await p2.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await p2.getByRole('link', { name: 'EVC' }).first().waitFor();
  await p2.getByText(/Estudiaste 1 tarjetas/).waitFor();
  check(true, 'reimportar el .zip restaura mazos, ajustes e historial');
  await p2.screenshot({ path: OUT + '4-hoy-vertical.png' });

  // Oscuro
  const ctx3 = await browser.newContext({ viewport: { width: 1180, height: 820 }, colorScheme: 'dark' });
  const p3 = await ctx3.newPage();
  await p3.goto(URL_);
  await p3.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await p3.getByRole('link', { name: 'Cardiología' }).first().waitFor();
  await p3.screenshot({ path: OUT + '5-hoy-oscuro.png' });

  check(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log('\nOK');
} catch (e) {
  console.error('Errores de consola:', errors);
  for (const c of browser.contexts()) for (const [i, pg] of c.pages().entries()) await pg.screenshot({ path: OUT + `fallo-${i}.png` }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  server.kill();
}
