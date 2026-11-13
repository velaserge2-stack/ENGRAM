// Exportar nota a PDF: el papel siempre es claro. Genera el PDF de una nota larga en
// {oscuro, claro} × {fondo foto, sólido} × printBackground {true, false} y mide por página el % de
// píxeles oscuros (pdftoppm), el texto (pdftotext) y el número de páginas.
//   npm run build && npm run e2e:pdf      (Chromium: page.pdf solo existe ahí)
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { strToU8, zipSync } from 'fflate';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/pdf/', import.meta.url).pathname;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4176;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
const browser = await pw.chromium.launch();
console.log('Navegador: chromium (page.pdf solo existe en Chromium)');
const LABEL = process.env.SHOT || 'despues';
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };

// PNG 2×2 gris para la imagen de la nota
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAAAAABX3VL4AAAADklEQVR4nGNgYGBgYGAAAAAFAAGKM+MAAAAASUVORK5CYII=', 'base64');
const parrafos = Array.from({ length: 60 }, (_, i) => `Párrafo ${i + 1}: el electrocardiograma muestra ritmo sinusal, eje normal y ondas sin alteraciones en la derivación ${i % 12}.`).join('\n\n');
const NOTA = `---
materia: Cardiología
tema: ECG
---
# Exportar a PDF

Texto con **negrita**, ==resaltado==, [rojo]{.rojo} y un [enlace](https://example.org).

- primero
- segundo

| Derivación | Valor |
|---|---|
| DII | 1.2 mV |
| V5 | 2.1 mV |

\`\`\`
codigo de ejemplo = 42
\`\`\`

> Una cita importante.

> [!note] Callout
> contenido del callout

![[pdf-img.png]]

${parrafos}

Fin de la nota ZZZFINAL.
`;

/** % de píxeles oscuros (luminancia < 60) de un PPM binario (P6). */
function darkShare(file) {
  const b = readFileSync(file);
  let p = 0, fields = [];
  while (fields.length < 4) { while (b[p] === 0x20 || b[p] === 0x0a || b[p] === 0x0d || b[p] === 0x09) p++; if (b[p] === 0x23) { while (b[p] !== 0x0a) p++; continue; } let s = ''; while (!(b[p] === 0x20 || b[p] === 0x0a || b[p] === 0x0d || b[p] === 0x09)) s += String.fromCharCode(b[p++]); fields.push(s); }
  p++;
  const [, w, h] = fields.map(Number);
  let dark = 0;
  for (let i = 0; i < w * h; i++) { const o = p + i * 3; if (0.2126 * b[o] + 0.7152 * b[o + 1] + 0.0722 * b[o + 2] < 60) dark++; }
  return dark / (w * h);
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'es-MX' });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.goto(URL_ + '#/mazos');
  await page.getByRole('button', { name: 'Importar archivo' }).click();
  await page.locator('.sheet input[type=file]').first().setInputFiles({ name: 'pdf.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync({ 'notes/Cardiología/ECG/Exportar.md': strToU8(NOTA), 'media/pdf-img.png': new Uint8Array(PNG) }, { level: 0 })) });
  await page.locator('.sheet').getByRole('button', { name: 'Importar', exact: true }).click();
  await page.waitForTimeout(1000);
  for (let i = 0; i < 3 && (await page.locator('.scrim').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }

  for (const [modo, label] of [['oscuro', 'Oscuro'], ['claro', 'Claro']]) {
    for (const [fondo, name] of [['foto', 'Paisaje'], ['solido', modo === 'oscuro' ? 'Color sólido #000000' : 'Color sólido #ffffff']]) {
      await page.goto(URL_ + '#/ajustes');
      await page.locator('.settings').waitFor();
      if (await page.getByRole('button', { name: 'Desplegar todo' }).count()) await page.getByRole('button', { name: 'Desplegar todo' }).click();
      await page.getByRole('radiogroup', { name: 'Fondos' }).getByRole('radio', { name, exact: true }).click();
      await page.getByRole('group', { name: 'Modo del vidrio' }).getByRole('button', { name: label, exact: true }).click();
      await page.waitForTimeout(400);
      await page.goto(URL_ + '#/notas/Cardiología/ECG/Exportar.md');
      await page.locator('.doc').waitFor();
      // como el botón «PDF / imprimir»: carga las imágenes y marca la impresión de la nota
      await page.evaluate(() => { window.print = () => (window.__printed = true); });
      await page.getByRole('button', { name: 'Compartir o exportar' }).first().click();
      await page.getByRole('button', { name: /PDF/ }).first().click();
      await page.waitForFunction(() => window.__printed === true, null, { timeout: 5000 });
      await page.emulateMedia({ media: 'print' });
      for (const bg of [true, false]) {
        const tag = `${LABEL}-${modo}-${fondo}-${bg ? 'confondo' : 'sinfondo'}`;
        const pdf = await page.pdf({ printBackground: bg, format: 'A4' });
        writeFileSync(`${OUT}${tag}.pdf`, pdf);
        execFileSync('pdftoppm', ['-r', '30', `${OUT}${tag}.pdf`, `${OUT}${tag}`]);
        const pages = readdirSync(OUT).filter((f) => f.startsWith(tag) && f.endsWith('.ppm')).sort();
        const shares = pages.map((f) => darkShare(OUT + f));
        execFileSync('pdftoppm', ['-r', '50', '-png', '-f', '1', '-l', '1', `${OUT}${tag}.pdf`, `${OUT}${tag}-p`]);
        const text = execFileSync('pdftotext', [`${OUT}${tag}.pdf`, '-']).toString();
        const worst = Math.max(...shares);
        const okText = ['Exportar a PDF', 'DII', '1.2 mV', 'codigo de ejemplo = 42', 'Una cita importante', 'contenido del callout', 'ZZZFINAL'].every((x) => text.includes(x));
        const chrome = ['Hoy', 'Mazos', 'Espacios', 'Esquema', 'Compartir'].filter((x) => new RegExp(`^${x}$`, 'm').test(text));
        check(worst <= 0.05 && okText && pages.length >= 2 && !chrome.length, `${modo} · fondo ${fondo} · printBackground ${bg}: ${pages.length} páginas, peor página ${(worst * 100).toFixed(1)} % oscura; texto completo ${okText ? 'sí' : 'NO'}${chrome.length ? '; se imprime la app: ' + chrome.join(', ') : ''}`);
      }
      await page.emulateMedia({ media: 'screen' });
    }
  }
  // nota abierta en un panel de Espacios (junto a otro panel): se imprime solo esa nota
  await page.goto(URL_ + '#/espacios/abrir/' + encodeURIComponent('notes/Cardiología/ECG/Exportar.md'));
  await page.locator('.win .doc').first().waitFor();
  await page.evaluate(() => { window.print = () => (window.__printed = 'panel'); });
  await page.locator('.win').filter({ has: page.locator('.doc') }).first().getByRole('button', { name: 'Compartir o exportar' }).click();
  await page.getByRole('button', { name: /PDF/ }).first().click();
  await page.waitForFunction(() => window.__printed === 'panel', null, { timeout: 5000 });
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ printBackground: true, format: 'A4' });
  writeFileSync(`${OUT}${LABEL}-panel.pdf`, pdf);
  const text = execFileSync('pdftotext', [`${OUT}${LABEL}-panel.pdf`, '-']).toString();
  const n = Number(/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [`${OUT}${LABEL}-panel.pdf`]).toString())?.[1] ?? 0);
  check(text.includes('ZZZFINAL') && text.includes('Una cita importante') && !/Ajustar al contenido|Añadir panel|Minimizar todos/.test(text) && n >= 2, `desde un panel de Espacios: solo la nota, ${n} páginas`);
  await page.emulateMedia({ media: 'screen' });
  if (failed) throw new Error(`${failed} comprobaciones fallaron`);
  console.log('OK');
  await ctx.close();
} catch (e) {
  console.error(e.message ?? e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
