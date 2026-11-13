// Mini prompt «vidrio» · 4: «Añadir examen» se ve como botón sobre cualquier fondo (5 fondos × 2
// modos): el botón contrasta ≥ 3:1 con lo que lo rodea y su texto ≥ 4.5:1 (medido en la captura).
//   npm run build && npm run e2e:glass
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4183;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };

/**
 * Colores medios (en la captura) de: el botón (franja sin texto), lo que lo rodea (un anillo de 4 px
 * por fuera) y el texto (los píxeles que más contrastan dentro del botón).
 */
async function measure(page, sel) {
  const r = await page.locator(sel).first().boundingBox();
  const pad = 10;
  const clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.width + pad * 2, height: r.height + pad * 2 };
  const png = await page.screenshot({ clip });
  return page.evaluate(async ({ b64, pad, w, h }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const s = img.width / (w + pad * 2), d = x.getImageData(0, 0, img.width, img.height).data;
    const px = (X, Y) => { const i = (Math.round(Y * s) * img.width + Math.round(X * s)) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const avg = (pts) => pts.reduce((a, p) => a.map((v, k) => v + p[k] / pts.length), [0, 0, 0]);
    const L = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const [hi, lo] = [L(a), L(b)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
    // botón: franja vertical a 8 px del borde izquierdo (dentro del radio de la píldora, sin texto)
    const btn = avg(Array.from({ length: 10 }, (_, i) => px(pad + 12, pad + h * (0.3 + i * 0.04))));
    // alrededor: anillo a 5 px por fuera (arriba, abajo, izquierda, derecha)
    const ring = [];
    for (let i = 0; i <= 20; i++) { ring.push(px(pad + w * (0.1 + i * 0.04), pad - 5), px(pad + w * (0.1 + i * 0.04), pad + h + 5)); }
    for (let i = 0; i <= 6; i++) { ring.push(px(pad - 5, pad + h * (0.2 + i * 0.1)), px(pad + w + 5, pad + h * (0.2 + i * 0.1))); }
    const around = Math.min(...ring.map((p) => ratio(p, btn)));
    // texto: el píxel que más contrasta con el relleno del botón en la mitad central
    let text = 1;
    for (let X = pad + w * 0.25; X < pad + w * 0.9; X += 1) for (let Y = pad + h * 0.3; Y < pad + h * 0.7; Y += 1) text = Math.max(text, ratio(px(X, Y), btn));
    return { control: Math.round(around * 100) / 100, text: Math.round(text * 100) / 100 };
  }, { b64: png.toString('base64'), pad, w: r.width, h: r.height });
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'es-MX' });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  const FONDOS = [['blanco', 'Color sólido #ffffff'], ['negro', 'Color sólido #000000'], ['rayas', 'Rayas'], ['degradado', 'Neón'], ['foto', 'Paisaje']];
  for (const [bg, name] of FONDOS) {
    for (const [modo, label] of [['dark', 'Oscuro'], ['light', 'Claro']]) {
      await page.goto(URL_ + '#/ajustes');
      await page.locator('.settings').waitFor();
      if (await page.getByRole('button', { name: 'Desplegar todo' }).count()) await page.getByRole('button', { name: 'Desplegar todo' }).click();
      await page.getByRole('radiogroup', { name: 'Fondos' }).getByRole('radio', { name, exact: true }).click();
      await page.getByRole('group', { name: 'Modo del vidrio' }).getByRole('button', { name: label, exact: true }).click();
      await page.waitForTimeout(500);
      for (const [screen, sel] of [['hoy', '.btn:has-text("Añadir examen")'], ['estadisticas', '.btn:has-text("Añadir examen")']]) {
        await page.goto(URL_ + '#/' + screen);
        await page.locator(sel).first().waitFor();
        await page.locator(sel).first().scrollIntoViewIfNeeded();
        await page.waitForTimeout(900); // el guardián vuelve a pasar
        const m = await measure(page, sel);
        check(m.control >= 3 && m.text >= 4.5, `${bg}/${modo} · ${screen}: botón vs alrededor ${m.control}:1 (≥ 3), texto ${m.text}:1 (≥ 4.5)`);
        if (bg === 'foto' || bg === 'rayas') await page.locator(sel).first().screenshot({ path: `${OUT}glass-boton-${screen}-${bg}-${modo}.png` });
      }
    }
  }
  // modo ligero: ningún backdrop-filter en ninguna pantalla; intensidad 0 %: desenfoque 0 también en .strong
  const blurs = () => page.evaluate(() => [...document.querySelectorAll('*')].map((e) => getComputedStyle(e).backdropFilter).filter((f) => f && f !== 'none'));
  await page.goto(URL_ + '#/ajustes');
  await page.locator('.settings').waitFor();
  if (await page.getByRole('button', { name: 'Desplegar todo' }).count()) await page.getByRole('button', { name: 'Desplegar todo' }).click();
  await page.getByRole('switch', { name: 'Modo ligero' }).or(page.getByRole('checkbox', { name: 'Modo ligero' })).first().click();
  await page.waitForFunction(() => !!document.querySelector('.light-mode'));
  let bad = [];
  for (const r of ['hoy', 'estudiar', 'notas', 'espacios', 'estadisticas', 'calendario', 'ajustes']) { await page.goto(URL_ + '#/' + r); await page.waitForTimeout(600); bad.push(...(await blurs()).map((f) => `${r}: ${f}`)); }
  check(!bad.length, `modo ligero: sin backdrop-filter en 7 pantallas${bad.length ? ' (' + bad.slice(0, 3).join(' · ') + ')' : ''}`);
  await page.goto(URL_ + '#/ajustes');
  await page.locator('.settings').waitFor();
  if (await page.getByRole('button', { name: 'Desplegar todo' }).count()) await page.getByRole('button', { name: 'Desplegar todo' }).click();
  await page.getByRole('switch', { name: 'Modo ligero' }).or(page.getByRole('checkbox', { name: 'Modo ligero' })).first().click();
  await page.waitForFunction(() => !document.querySelector('.light-mode'));
  await page.waitForTimeout(300);
  await page.evaluate(() => document.documentElement.style.setProperty('--k', '0'));
  const strong = await page.evaluate(() => { const e = document.createElement('div'); e.className = 'glass strong'; document.body.append(e); const f = getComputedStyle(e).backdropFilter; e.remove(); return f; });
  check(/blur\(0px\)/.test(strong), `intensidad 0 %: .glass.strong sin desenfoque (${strong})`);
  await page.evaluate(() => document.documentElement.style.setProperty('--k', '0.7'));
  const strong70 = await page.evaluate(() => { const e = document.createElement('div'); e.className = 'glass strong'; document.body.append(e); const f = getComputedStyle(e).backdropFilter; e.remove(); return f; });
  check(/blur\(40px\)/.test(strong70), `intensidad por defecto: .glass.strong igual que antes (${strong70})`);
  // prefers-reduced-transparency (si el navegador de pruebas lo emula)
  try {
    await page.emulateMedia({ reducedTransparency: 'reduce' });
    await page.goto(URL_ + '#/hoy');
    await page.waitForTimeout(600);
    const mq = await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches);
    const n = (await blurs()).length;
    if (!mq) console.log('  · prefers-reduced-transparency: el navegador de pruebas no aplica la consulta');
    else check(n === 0, `prefers-reduced-transparency: sin backdrop-filter (${n})`);
    await page.emulateMedia({ reducedTransparency: 'no-preference' });
  } catch { console.log('  · prefers-reduced-transparency: este Playwright no lo emula'); }
  if (failed) throw new Error(`${failed} comprobaciones fallaron`);
  console.log('OK');
  await ctx.close();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
