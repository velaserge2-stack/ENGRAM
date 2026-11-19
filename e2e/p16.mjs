// Fase 4 · exportar a Anki desde la UI, ida y vuelta e importación perezosa.
//   npm run build && npm run e2e:p16
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const PORT = Number(process.env.PORT) || 4186;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
const check = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✓', m); };
const errors = [];
const requests = [];

async function fresh() {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'es-MX', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => requests.push(r.url()));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  return { ctx, page };
}
const nums = (s) => [...s.matchAll(/\d+/g)].map((m) => +m[0]);

try {
  const FIX = new URL('../tests/fixtures/apkg/nuevo.apkg', import.meta.url).pathname;
  // importa el fixture, exporta (con/sin historial), reimporta en un contexto nuevo y compara
  async function roundTrip(history) {
    const { ctx, page } = await fresh();
    await page.goto(URL_ + '#/mazos');
    await page.getByRole('button', { name: 'Exportar Anki' }).waitFor();
    if (history) check(!requests.some((u) => /\.wasm|worker/.test(u) && !/opfs|search|thumb/.test(u)), 'sin abrir la hoja no se pide sql.js ni el exportador');
    await page.getByRole('button', { name: 'Importar archivo' }).click();
    await page.locator('.sheet input[type=file]').first().setInputFiles(FIX);
    await page.locator('.sheet .import-sum').waitFor({ timeout: 30000 });
    await page.locator('.sheet').getByRole('button', { name: 'Importar', exact: true }).click();
    await page.locator('.sheet').getByRole('button', { name: 'Ver mazos' }).click();
    await page.locator('tr[data-drop="Medicina/Cardio/ECG"]').waitFor();
    await page.getByRole('button', { name: 'Exportar Anki' }).click();
    const sheet = page.locator('.sheet');
    await sheet.waitFor();
    check(await sheet.getByRole('button', { name: 'Preparar .apkg' }).isEnabled(), 'la hoja abre con mazos marcados');
    if (history) await sheet.getByLabel('Incluir historial de repasos').check();
    await sheet.getByRole('button', { name: 'Preparar .apkg' }).click();
    const save = sheet.getByRole('button', { name: 'Guardar / Compartir' });
    await save.waitFor({ timeout: 60000 });
    const sum = await sheet.locator('.import-sum').innerText();
    console.log('   exporta:', sum);
    const [dl] = await Promise.all([page.waitForEvent('download'), save.click()]);
    check(/^Engrama-.+-\d{4}-\d{2}-\d{2}\.apkg$/.test(dl.suggestedFilename()), 'nombre ' + dl.suggestedFilename());
    const bytes = readFileSync(await dl.path());
    await ctx.close();

    const b = await fresh();
    await b.page.goto(URL_ + '#/mazos');
    await b.page.getByRole('button', { name: 'Importar archivo' }).click();
    await b.page.locator('.sheet input[type=file]').first().setInputFiles({ name: 'x.apkg', mimeType: 'application/octet-stream', buffer: bytes });
    await b.page.locator('.sheet .import-sum').waitFor({ timeout: 30000 });
    const back = await b.page.locator('.sheet .import-sum').innerText();
    console.log('   reimporta:', back);
    const e = nums(sum), r = nums(back);
    check(e[0] === r[0], `mismos mazos (${e[0]})`);
    check(e[1] === r[1], `mismas tarjetas (${e[1]})`);
    check(e[2] === r[2] && e[2] > 0, `mismas imágenes (${e[2]})`);
    if (history) check(e[3] === r[3] && e[3] > 0, `mismos repasos (${e[3]})`);
    else {
      check(!/[1-9]\d* repasos/.test(sum), 'sin historial: 0 repasos exportados');
      check(!/[1-9]\d* repasos/.test(back), 'sin historial: 0 repasos al reimportar');
    }
    await b.ctx.close();
  }
  await roundTrip(true);
  await roundTrip(false);
  // sin desbordes en francés y pseudo-idioma (+40 %), iPad pequeño y teléfono
  {
    const { ctx, page } = await fresh();
    const SHOTS = process.env.SHOTS || '';
    for (const lang of ['fr', 'xx']) {
      await page.goto(URL_ + '#/design');
      await page.getByRole('button', { name: lang === 'fr' ? 'FR' : /pseudo/i }).first().click();
      for (const [w, h] of [[1024, 768], [390, 844]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.goto(URL_ + '#/mazos');
        await page.locator('.footer-pills button:has(svg.lucide-package-open)').click();
        const sheet = page.locator('.sheet');
        await sheet.waitFor();
        await sheet.locator('button.btn.primary').click();
        await sheet.locator('.import-sum').waitFor({ timeout: 60000 });
        const bad = await sheet.evaluate((el) => {
          const box = el.getBoundingClientRect(), out = [];
          if (el.scrollWidth > el.clientWidth + 1) out.push('scrollX');
          for (const c of el.querySelectorAll('*')) { const r = c.getBoundingClientRect(); if (r.width && (r.right > box.right + 1 || r.left < box.left - 1)) out.push(c.tagName + '.' + c.className); }
          return out.slice(0, 3);
        });
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/p16-${lang}-${w}.png` });
        check(bad.length === 0, `${lang} ${w}×${h}: sin desbordes ${bad.join(',')}`);
        await page.keyboard.press('Escape');
      }
    }
    await ctx.close();
  }
  check(errors.length === 0, 'sin errores de consola: ' + errors.join(' | '));
} finally {
  await browser.close();
  server.kill();
}
