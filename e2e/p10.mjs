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
  await page.goto(URL_ + '?app');
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  return { ctx, page };
}
const FIX = new URL('../tests/fixtures/apkg/', import.meta.url).pathname;
const openImport = async (page) => {
  await page.goto(URL_ + '?app#/mazos');
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
    await page.goto(URL_ + '?app#/estudiar/decks/Medicina/Cardio/ECG.md');
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

  console.log('Selector sin accept, subida sin conexión y archivo no admitido');
  {
    const { ctx, page } = await fresh();
    await page.evaluate(() => navigator.serviceWorker?.ready);
    await page.reload();
    await page.evaluate(() => navigator.serviceWorker?.ready);
    await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
    await openImport(page);
    check(await page.locator('.sheet input[type=file]').first().getAttribute('accept') === null, 'el selector de Importar no limita por tipo (iOS deja elegir .apkg)');
    await page.locator('.sheet').getByRole('button', { name: 'Cerrar' }).first().click().catch(() => {});
    await ctx.setOffline(true);
    await openImport(page);
    await upload(page, 'compat.apkg');
    await page.locator('.sheet .import-sum').waitFor({ timeout: 30000 });
    check(/2 mazos · 6 tarjetas/.test(await page.locator('.sheet .import-sum').innerText()), 'sin conexión: el .apkg se lee (Worker y WASM desde el precaché)');
    await ctx.setOffline(false);
    await ctx.close();
  }
  {
    const { ctx, page } = await fresh();
    await openImport(page);
    await page.locator('.sheet input[type=file]').first().setInputFiles({ name: 'programa.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ\u0000\u0000') });
    await page.locator('.sheet .plan-list').waitFor({ timeout: 20000 });
    const li = await page.locator('.sheet .plan-list').innerText();
    check(/docs\/programa\.exe/.test(li) && !/decks\//.test(li), 'un archivo no admitido solo se ofrece como documento suelto (docs/), sin tocar mazos ni notas');
    check(await page.locator('.sheet').getByRole('button', { name: 'Elegir otros' }).count() === 1, 'y se puede cancelar antes de escribir nada');
    await ctx.close();
  }

  // Paquete grande: los medios no se cargan enteros (se leen por trozos desde el File y se escriben de uno en uno).
  //   APKG_MB=280 (por defecto). Mide el pico de JSHeapUsedSize de la página (CDP, solo Chromium) y el RSS de todos los procesos del navegador.
  if (run('grande')) {
    const MB = Number(process.env.APKG_MB) || 280;
    console.log(`Paquete de ${MB} MB de medios (sin guardarlo en el repo)`);
    const fs = require('node:fs'), os = require('node:os'), nodePath = require('node:path'), crypto = require('node:crypto'), { execSync } = require('node:child_process');
    const { zipSync, unzipSync, strToU8 } = require('fflate');
    const N = 5, each = Math.floor(MB / N) * 1024 * 1024;
    const z = unzipSync(fs.readFileSync(FIX + 'legado.apkg'));
    const map = { 0: 'ecg.png' }, entries = { ...z, 0: new Uint8Array([1, 2, 3]) };
    for (let i = 1; i <= N; i++) { const b = Buffer.alloc(each, i); crypto.randomFillSync(b, 0, 4096); entries[i] = [new Uint8Array(b.buffer, b.byteOffset, b.length), { level: 0 }]; map[i] = `grande${i}.bin`; }
    entries.media = strToU8(JSON.stringify(map));
    const file = nodePath.join(os.tmpdir(), `grande-${MB}.apkg`);
    fs.writeFileSync(file, zipSync(entries));
    const rss = () => { try { return execSync('ps -eo rss=,args=', { encoding: 'utf8' }).split('\n').filter((l) => /chrom|webkit|WebContent/i.test(l)).reduce((a, l) => a + (parseInt(l, 10) || 0), 0) / 1024; } catch { return 0; } };
    try {
      const { ctx, page } = await fresh();
      let cdp = null;
      if (type.name() === 'chromium') { cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable'); }
      const heap = async () => cdp ? (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576 : 0;
      const base = { heap: await heap(), rss: rss() };
      const peak = { heap: base.heap, rss: base.rss };
      const timer = setInterval(async () => { peak.heap = Math.max(peak.heap, await heap().catch(() => 0)); peak.rss = Math.max(peak.rss, rss()); }, 150);
      await openImport(page);
      await page.locator('.sheet input[type=file]').first().setInputFiles(file);
      await page.locator('.sheet .import-sum').waitFor({ timeout: 180000 });
      check(/2 mazos · 6 tarjetas · 6 imágenes y audios/.test(await page.locator('.sheet .import-sum').innerText()), 'se lee el paquete (supera los 200 MB de un archivo suelto) y cuenta los medios');
      await page.locator('.sheet').getByRole('button', { name: 'Importar', exact: true }).click();
      await page.locator('.sheet').getByRole('button', { name: 'Deshacer importación' }).waitFor({ timeout: 300000 });
      clearInterval(timer);
      const sizes = await page.evaluate(async () => {
        const out = {};
        const walk = async (d) => { for await (const [n, h] of d.entries()) { if (h.kind === 'directory') await walk(h); else if (/^grande\d\.bin$/.test(n)) out[n] = (await h.getFile()).size; } };
        await walk(await navigator.storage.getDirectory());
        return out;
      });
      check(Object.keys(sizes).length === N && Object.values(sizes).every((n) => n === each), `los ${N} medios quedan en media/ con su tamaño exacto`);
      console.log(`    JSHeapUsedSize de la página: base ${base.heap.toFixed(0)} MB, pico ${peak.heap.toFixed(0)} MB · RSS del navegador (todos los procesos): base ${base.rss.toFixed(0)} MB, pico ${peak.rss.toFixed(0)} MB`);
      if (cdp) check(peak.heap - base.heap < MB * 0.5, `el heap de la página no crece con el tamaño del paquete (+${(peak.heap - base.heap).toFixed(0)} MB)`);
      await ctx.close();
    } finally { fs.rmSync(file, { force: true }); }
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
