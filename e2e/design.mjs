// Pruebas del tema Cristal contra el build: "sin color" y legibilidad sobre 5 fondos × 2 modos.
//   npm run build && npm run e2e:design
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = 4175;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());

// Recorre el DOM y devuelve colores con croma > 5 % fuera del fondo, emojis y contenido del usuario.
const NO_COLOR = () => {
  const bad = [];
  const parse = (s) => {
    const out = [];
    for (const m of s.matchAll(/rgba?\(([^)]+)\)|color\(srgb ([^)]+)\)/g)) {
      const p = (m[1] ?? m[2]).split(/[\s,/]+/).filter(Boolean).map(Number);
      const k = m[2] ? 255 : 1;
      const [r, g, b] = p.map((x) => x * k);
      const a = p.length > 3 ? p[3] : 1;
      if (a > 0.02) out.push({ r, g, b, a, raw: m[0] });
    }
    return out;
  };
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('[data-user-content], [data-bg], .bg-layer, .bg-veil, canvas, img, input[type="color"]')) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    for (const prop of ['color', 'background-color', 'border-top-color', 'border-bottom-color', 'border-left-color', 'border-right-color', 'outline-color', 'box-shadow', 'text-shadow', 'fill', 'stroke', 'background-image']) {
      for (const c of parse(cs.getPropertyValue(prop))) {
        const chroma = (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
        if (chroma > 0.05) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} ${prop}: ${c.raw}`);
      }
    }
  }
  return [...new Set(bad)].slice(0, 20);
};

let failed = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  for (const bg of ['blanco', 'negro', 'rayas', 'degradado', 'foto']) {
    for (const modo of ['dark', 'light']) {
      await page.goto(`${URL_}#/design?bg=${bg}&modo=${modo}`);
      await page.getByRole('heading', { name: 'Diseño · Cristal' }).waitFor();
      const want = { blanco: '#ffffff', negro: '#000000', rayas: 'rayas', degradado: 'neon', foto: 'paisaje' }[bg];
      await page.waitForFunction(([w, m]) => window.__guard?.key?.includes(w) && window.__guard.key.includes(m), [want, modo], { timeout: 10000 });
      await page.waitForTimeout(700); // el guardián vuelve a pasar tras las mutaciones del DOM
      const g = await page.evaluate(() => window.__guard);
      const colors = await page.evaluate(NO_COLOR);
      const okC = g && g.minContrast >= 4.5;
      console.log(`${okC && !colors.length ? '✓' : '✗'} ${bg}/${modo}: contraste mínimo ${g?.minContrast?.toFixed(2)} (paneles ${g?.panels}, ajustados ${g?.adjusted}); colores ${colors.length}`);
      if (!okC || colors.length) (failed++, colors.forEach((c) => console.log('   ', c)));
      await page.screenshot({ path: `${OUT}design-${bg}-${modo}.png` });
    }
  }
  // pantallas reales en modo auto sobre el fondo por defecto
  for (const r of ['hoy', 'mazos', 'estudiar', 'estadisticas', 'calendario', 'simulacros', 'notas', 'espacios', 'ajustes']) {
    await page.goto(`${URL_}#/${r}`);
    await page.waitForTimeout(900);
    const colors = await page.evaluate(NO_COLOR);
    console.log(`${colors.length ? '✗' : '✓'} sin color en #/${r}`);
    if (colors.length) (failed++, colors.forEach((c) => console.log('   ', c)));
    await page.screenshot({ path: `${OUT}pantalla-${r}.png` });
  }
} finally {
  await browser.close();
  server.kill();
}
if (failed) (console.error(`\n${failed} comprobaciones fallaron`), process.exit(1));
console.log('\nOK');
