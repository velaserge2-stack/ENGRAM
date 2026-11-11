// Mejoras 2 · bloque B (iPhone).
//   npm run build && npm run e2e:phone
// Modos (variable MODE):
//   check     (por defecto) pruebas de teléfono: sin scroll horizontal, barra inferior, hojas, áreas seguras…
//   audit     capturas en 6 tamaños de iPhone + lista de fallos (no falla; solo informa)
//   baseline  capturas de iPad y web en BASE_DIR (antes de tocar nada)
//   compare   vuelve a capturar iPad y web y exige diferencia de 0 píxeles contra BASE_DIR
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const MODE = process.env.MODE || 'check';
const BASE_DIR = process.env.BASE_DIR || OUT + 'base/';
const PORT = Number(process.env.PORT) || 4179;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
// Chromium: rasterizado en un solo hilo y sin GPU, para que dos capturas del mismo estado sean idénticas
const ARGS = ['--num-raster-threads=1', '--disable-gpu', '--disable-partial-raster', '--force-color-profile=srgb', '--disable-skia-runtime-opts'];
try { browser = await type.launch(type.name() === 'chromium' ? { args: ARGS } : {}); } catch { type = pw.chromium; browser = await type.launch({ args: ARGS }); }
console.log('Navegador:', type.name(), '· modo:', MODE);
const check = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✓', m); };

const SCREENS = ['hoy', 'mazos', 'estudiar', 'explorar', 'simulacros', 'calendario', 'notas', 'espacios', 'estadisticas', 'ajustes', 'bandeja', 'addons'];
const BIG = [[1366, 768], [1024, 768], [834, 1194]];
const PHONES = [[375, 667], [390, 844], [393, 852], [430, 932], [440, 956], [852, 393]];
const FIXED = new Date('2026-11-11T15:00:00-06:00');

/** Contexto con reloj fijo y bóveda de ejemplo: las capturas son reproducibles. */
async function open(w, h, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: opts.locale || 'es-MX', reducedMotion: 'reduce', hasTouch: !!opts.touch, isMobile: false });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.clock.setFixedTime(FIXED);
  await page.goto(URL_);
  await page.getByRole('button', { name: /bóveda de ejemplo|sample vault|coffre d’exemple/i }).click();
  await page.locator('h1').first().waitFor();
  await page.mouse.move(1, 1); // fuera de cualquier botón: sin ayudas emergentes ni :hover
  await page.waitForTimeout(600);
  return { ctx, page, errors };
}

/** Espera a que no haya avisos, animaciones ni imágenes pendientes. */
async function settle(page) {
  await page.waitForTimeout(MODE === 'check' ? 250 : 500);
  if (MODE !== 'check') for (let i = 0; i < 40 && (await page.locator('.toast').count()); i++) await page.waitForTimeout(150);
  await page.evaluate(() => Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => (i.onload = i.onerror = r)))));
  await page.waitForTimeout(300);
}

async function go(page, r) {
  await page.goto(URL_ + '#/' + r);
  if (MODE === 'baseline' || MODE === 'compare') await page.reload(); // carga limpia: la píldora de la sección activa no viene animándose
  await page.locator('h1').first().waitFor().catch(() => {});
  await page.mouse.move(1, 1);
  await settle(page);
}

/** Compara dos PNG dentro del navegador (sin dependencias): número de píxeles distintos. */
async function diff(page, a, b) {
  return page.evaluate(async ([a, b]) => {
    const load = (b64) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b64; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { px: -1, size: `${ia.width}×${ia.height} vs ${ib.width}×${ib.height}` };
    const data = (img) => { const c = new OffscreenCanvas(img.width, img.height); const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, img.width, img.height).data; };
    const da = data(ia), db = data(ib);
    let px = 0;
    for (let i = 0; i < da.length; i += 4) if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2] || da[i + 3] !== db[i + 3]) px++;
    return { px };
  }, [a.toString('base64'), b.toString('base64')]);
}

/** Fallos de teléfono en la pantalla actual. */
function phoneProblems(page) {
  return page.evaluate(() => {
    const out = [];
    const vis = (el) => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0; };
    const hs = document.documentElement.scrollWidth - innerWidth;
    if (hs > 1) {
      const wide = [...document.querySelectorAll('body *')].filter((e) => vis(e) && e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.seg-nav, .heat, .tbl-scroll, .canvas-wrap, .rail, .dock, .tray'));
      out.push(`scroll horizontal ${hs}px: ${[...new Set(wide.slice(-4).map((e) => (e.className && typeof e.className === 'string' ? '.' + e.className.split(' ')[0] : e.tagName)))].join(' ')}`);
    }
    for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]), textarea, select')) {
      if (vis(el) && parseFloat(getComputedStyle(el).fontSize) < 16) { out.push('campo con fuente < 16 px'); break; }
    }
    let small = 0;
    const smallNames = [];
    for (const el of document.querySelectorAll('.phone-tabbar a, .phone-tabbar button, .topbar a, .topbar button')) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 - 0.5 || r.height < 44 - 0.5) (small++, smallNames.push(el.getAttribute('aria-label') || el.textContent.trim().slice(0, 12)));
    }
    if (small) out.push(`${small} controles de navegación < 44 px (${smallNames.slice(0, 3).join(', ')})`);
    return out;
  });
}

try {
  if (MODE === 'baseline' || MODE === 'compare') {
    mkdirSync(BASE_DIR, { recursive: true });
    const fails = [];
    let n = 0;
    for (const [w, h] of BIG) {
      const { ctx, page, errors } = await open(w, h);
      for (const r of SCREENS) {
        await go(page, r);
        // el uso real del almacenamiento del navegador cambia entre ejecuciones: se enmascara
        const png = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide', style: '.tooltip{display:none!important}', mask: [page.locator('.row-i', { hasText: /Espacio usado|Space used|Espace utilisé/ })] });
        const file = `${BASE_DIR}${w}x${h}-${r}.png`;
        if (MODE === 'baseline') writeFileSync(file, png);
        else {
          if (!existsSync(file)) throw new Error('No hay línea base: ' + file);
          const d = await diff(page, readFileSync(file), png);
          if (d.px !== 0) (fails.push(`${w}×${h} ${r}: ${d.px < 0 ? d.size : d.px + ' px'}`), writeFileSync(`${OUT}diff-${w}x${h}-${r}.png`, png));
        }
        n++;
      }
      check(errors.length === 0, `${w}×${h}: sin errores en consola` + (errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''));
      await ctx.close();
    }
    if (MODE === 'baseline') console.log(`  ✓ ${n} capturas guardadas en ${BASE_DIR}`);
    else check(fails.length === 0, `iPad y web: diferencia de 0 píxeles en ${n} capturas` + (fails.length ? '\n    ' + fails.join('\n    ') : ''));
  }

  if (MODE === 'audit') {
    const report = [];
    for (const [w, h] of PHONES) {
      const { ctx, page } = await open(w, h, { touch: true });
      for (const r of SCREENS) {
        await go(page, r);
        await page.screenshot({ path: `${OUT}phone-${w}x${h}-${r}.png`, animations: 'disabled' });
        for (const p of await phoneProblems(page)) report.push(`${w}×${h} ${r}: ${p}`);
      }
      await ctx.close();
    }
    console.log(report.length ? report.join('\n') : '  (sin fallos detectados)');
    writeFileSync(OUT + 'phone-audit.txt', report.join('\n') + '\n');
  }

  if (MODE === 'check') {
    for (const locale of ['es-MX', 'fr-FR']) {
      for (const [w, h] of PHONES) {
        const { ctx, page, errors } = await open(w, h, { touch: true, locale });
        check(await page.evaluate(() => document.documentElement.classList.contains('is-phone')), `${locale} ${w}×${h}: <html class="is-phone">`);
        const fails = [];
        for (const r of SCREENS) {
          await go(page, r);
          for (const p of await phoneProblems(page)) fails.push(`${r}: ${p}`);
        }
        check(fails.length === 0, `${locale} ${w}×${h}: ${SCREENS.length} pantallas sin scroll horizontal, campos ≥ 16 px y navegación ≥ 44 px` + (fails.length ? '\n    ' + fails.join('\n    ') : ''));
        // barra inferior dentro del área visible y por encima de la barra de inicio
        const bar = await page.locator('.phone-tabbar').boundingBox();
        check(!!bar && bar.y + bar.height <= h + 0.5 && bar.y > h / 2, `${locale} ${w}×${h}: barra inferior visible`);
        check(errors.length === 0, `${locale} ${w}×${h}: sin errores en consola` + (errors.length ? ': ' + errors.slice(0, 2).join(' | ') : ''));
        await ctx.close();
      }
    }

    // tamaños de texto extremos (Ajustes → Tamaño de texto: 0.8× y 1.6×) en francés, el idioma más largo
    for (const scale of ['0.8', '1.6']) {
      const { ctx, page } = await open(375, 667, { touch: true, locale: 'fr-FR' });
      const fails = [];
      for (const r of SCREENS) {
        await go(page, r);
        await page.evaluate((k) => document.documentElement.style.setProperty('--text-scale', k), scale);
        await page.waitForTimeout(150);
        for (const p of await phoneProblems(page)) fails.push(`${r}: ${p}`);
      }
      check(fails.length === 0, `texto ${scale}× (fr 375×667): sin desbordes` + (fails.length ? '\n    ' + fails.join('\n    ') : ''));
      await ctx.close();
    }

    const { ctx, page } = await open(390, 844, { touch: true });
    // barra inferior: Hoy · Mazos · Estudiar · Notas · Más
    const tabs = await page.locator('.phone-tabbar > *').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    check(JSON.stringify(tabs) === JSON.stringify(['Hoy', 'Mazos', 'Estudiar', 'Notas', 'Más']), 'barra inferior: ' + tabs.join(' · '));
    await page.locator('.phone-tabbar').getByRole('button', { name: 'Más' }).click();
    const more = page.locator('.sheet');
    await more.waitFor();
    for (const name of ['Simulacros', 'Calendario', 'Espacios', 'Estadísticas', 'Ajustes']) check(await more.getByRole('link', { name }).count() === 1, `«Más» abre ${name}`);
    const sb = await more.boundingBox();
    check(Math.abs(sb.y + sb.height - 844) < 1 && sb.width === 390, 'las hojas son inferiores y a todo el ancho');
    await more.getByRole('link', { name: 'Calendario' }).click();
    await page.getByRole('heading', { name: 'Calendario', level: 1 }).waitFor();
    check(await page.locator('.sheet').count() === 0, 'elegir una sección cierra la hoja «Más»');
    check(await page.locator('.phone-tabbar [aria-current="page"]').getAttribute('aria-label') === 'Más', 'una sección de «Más» marca «Más» como activa');
    // el contenido no queda bajo la barra inferior
    await go(page, 'ajustes');
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(200);
    const lastBottom = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.page .glass')].map((e) => e.getBoundingClientRect().bottom)));
    const barTop = (await page.locator('.phone-tabbar').boundingBox()).y;
    check(lastBottom <= barTop + 1, 'el final de la página queda por encima de la barra inferior');
    // espacios: un panel a la vez; el otro queda como cuadrito y tocarlo lo muestra
    await go(page, 'espacios');
    await page.getByRole('button', { name: 'Nuevo espacio' }).first().click();
    await page.getByLabel(/Nombre/).fill('Cel');
    await page.getByRole('button', { name: 'Crear' }).click();
    for (const k of ['PDF', 'Pomodoro']) {
      await page.getByRole('button', { name: 'Añadir panel' }).click();
      await page.getByRole('menuitem', { name: `Añadir panel ${k}` }).click();
      await page.waitForTimeout(300);
    }
    await page.locator('.tiles > .win').first().waitFor();
    check(await page.locator('.tiles > .win').count() === 1, 'Espacios en teléfono muestra un panel a la vez');
    const sq = page.locator('.rail .tray-sq');
    check(await sq.count() === 1, 'el otro panel queda como cuadrito en la bandeja');
    const before = await page.locator('.tiles > .win .win-bar').innerText();
    await sq.first().click();
    await page.waitForTimeout(400);
    const after = await page.locator('.tiles > .win .win-bar').innerText();
    check(before !== after && await page.locator('.tiles > .win').count() === 1, 'tocar el cuadrito muestra ese panel');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Espacios sin scroll horizontal');
    await page.screenshot({ path: OUT + 'phone-espacios.png' });
    await ctx.close();

    // landscape: la barra superior no tapa el contenido y la inferior sigue ahí
    const l = await open(852, 393, { touch: true });
    check(await l.page.locator('.phone-tabbar').isVisible(), 'horizontal 852×393: barra inferior');
    await l.ctx.close();
  }
  console.log('\nOK');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
