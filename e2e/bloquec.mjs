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
