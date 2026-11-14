// break-ui con datos hostiles (Prompt 21 · fase 8). Chromium sin opciones.
//   npm run build && node e2e/break-ui.mjs      (PORT=4177; capturas e informe JSON en e2e/out/break-ui/)
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { strToU8, unzipSync, zipSync } from 'fflate';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const PORT = Number(process.env.PORT) || 4177;
const URL_ = `http://localhost:${PORT}/`;
const OUT = new URL('./out/break-ui/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });

// ---- datos hostiles --------------------------------------------------------------------------
const L200 = 'Anatomiaquirurgicaydiagnosticodiferencialdelabdomenagudoenelpacientepediatricoconcomorbilidadesmultiplesyevolucionatipica'.repeat(2).slice(0, 210);
const AR = 'التشريح الطبي المتقدم للجهاز القلبي الوعائي';
const JA = '心臓血管系の高度な解剖学と生理学の基礎知識';
const RTL = 'Cardio ' + AR + ' 😀🫀 (v2)';
const files = {};
const deckBody = (n, pre = '') => Array.from({ length: n }, (_, i) => `Q:: ${pre}pregunta ${i + 1}\nA:: respuesta ${i + 1}`).join('\n\n') + '\n';
const deck = (name, body, extra = '') => `---\ndeck: ${name}\n${extra}---\n${body}`;
const decks = {
  [L200]: deckBody(3), 'X': deckBody(2), [AR]: deckBody(2), [JA]: deckBody(2), [RTL]: deckBody(2), '😀🫀🧠': deckBody(2),
  [`${L200}/${L200.slice(0, 100)}`]: deckBody(2),
};
for (const [n, b] of Object.entries(decks)) files[`decks/${n.replace(/\//g, '/')}.md`] = strToU8(deck(n, b));
files['decks/Grande 20000.md'] = strToU8(deck('Grande 20000', deckBody(20000), 'tags: [masivo]\n'));
const note = (mat, tema, titulo, body = 'Texto de prueba.') => `---\nmateria: ${mat}\ntema: ${tema}\nfecha: 2026-11-01\ntags: [hostil]\n---\n# ${titulo}\n\n${body}\n`;
const nn = [[L200, L200.slice(5, 215), L200], ['Q', 'Z', 'a'], [AR, AR, AR], [JA, JA, JA], [RTL, RTL, RTL], ['😀', '🫀', '😀🫀🧠']];
for (const [m, t, ti] of nn) files[`notes/${m.slice(0, 80)}/${t.slice(0, 80)}/${ti.slice(0, 120)}.md`] = strToU8(note(m, t, ti));
// extra: carpetas de segmento 200+ (límite de nombre del sistema = 255 bytes)
files[`notes/${L200}/${L200}.md`] = strToU8(note(L200, 'x', L200));
for (const f of ['big-notes.zip', 'files500.zip']) {
  const p = new URL(`../tests/fixtures/rendimiento/${f}`, import.meta.url);
  if (existsSync(p)) Object.assign(files, unzipSync(new Uint8Array(readFileSync(p))));
}
const zip = zipSync(files, { level: 0 });
console.log('zip', (zip.length / 1e6).toFixed(1), 'MB', Object.keys(files).length, 'archivos');

// ---- auditoría ------------------------------------------------------------------------------
const findings = [];
const audit = (page, label) => page.evaluate(() => {
  const out = [];
  const vis = (el) => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0; };
  const hs = document.documentElement.scrollWidth - innerWidth;
  if (hs > 1) {
    const path = (e) => { const r = []; for (; e && e !== document.body && r.length < 5; e = e.parentElement) r.push(e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/)[0] : '')); return r.join('<'); };
    const wide = [...document.querySelectorAll('body *')].filter((e) => vis(e) && e.getBoundingClientRect().right > innerWidth + 1 && !e.closest('.canvas-wrap,.heat,.tbl-scroll')).sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right).slice(0, 2);
    out.push(`scroll horizontal ${hs}px: ${wide.map(path).join(' ;; ')}`);
  }
  // texto desbordado de su caja sin elipsis ni envoltura
  const clip = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || el.children.length || !el.textContent.trim()) continue;
    const cs = getComputedStyle(el);
    if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0 && cs.textOverflow !== 'ellipsis' && !['visible'].includes(cs.overflowX) === true && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') clip.push((el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName) + ':' + el.textContent.trim().slice(0, 25));
    else if (cs.overflowX === 'visible' && el.getBoundingClientRect().right > innerWidth + 1 && !el.closest('.canvas-wrap,.heat,.tbl-scroll')) clip.push('fuera:' + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName) + ':' + el.textContent.trim().slice(0, 25));
  }
  if (clip.length) out.push(`texto cortado/fuera (${clip.length}): ${[...new Set(clip)].slice(0, 5).join(' | ')}`);
  const small = [];
  for (const el of document.querySelectorAll('button, a[href], [role=button], input:not([type=hidden]), select')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width && (r.width < 43.5 || r.height < 43.5) && !el.closest('.phone-tabbar,.heat,.canvas-wrap')) small.push((el.getAttribute('aria-label') || el.textContent.trim() || el.tagName).slice(0, 20) + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  if (small.length) out.push(`${small.length} controles < 44 px: ${[...new Set(small)].slice(0, 5).join(' | ')}`);
  return out;
}).then((o) => { for (const m of o) findings.push({ pantalla: label, msg: m }); return o; });

const errors = [];
const kind = 'chromium';
const browser = await pw.chromium.launch();
console.log('Navegador:', kind);
const run = async (name, vp, steps) => {
  const ctx = await browser.newContext({ viewport: vp, locale: 'es-MX' });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text().slice(0, 160)}`));
  page.on('pageerror', (e) => errors.push(`${name}: pageerror ${String(e).slice(0, 160)}`));
  return { ctx, page };
};
const snap = async (page, label, wide) => {
  const t0 = Date.now();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}${label}.png`, fullPage: false });
  const o = await audit(page, label);
  console.log(` ${label}: ${o.length ? o.join(' ;; ') : 'sin hallazgos'}`);
};
const go = async (page, hash, label) => {
  const t0 = Date.now();
  await page.goto(URL_ + hash);
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => findings.push({ pantalla: label, msg: 'no queda en reposo en 10 s' }));
  const dt = Date.now() - t0;
  if (dt > 10000) findings.push({ pantalla: label, msg: `tarda ${dt} ms` });
  await snap(page, label);
};

try {
  for (const [dev, vp] of [['ipad', { width: 1180, height: 820 }], ['tel', { width: 390, height: 844 }]]) {
    const { page } = await run(dev, vp);
    await page.goto(URL_);
    await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
    await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
    await page.goto(URL_ + '#/mazos');
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Importar archivo' }).click();
    await page.locator('.sheet input[type=file]').first().setInputFiles({ name: 'hostil.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
    await page.locator('.sheet').getByRole('button', { name: 'Importar', exact: true }).click();
    await page.waitForFunction(() => !/Importando/.test(document.querySelector('.sheet')?.textContent || ''), null, { timeout: 300000 }).catch(() => findings.push({ pantalla: dev + '-importar', msg: 'importar no termina en 300 s' }));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}${dev}-importar.png` });
    console.log(` ${dev} importar: ${Date.now() - t0} ms; hoja:`, (await page.locator('.sheet').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200));
    for (let i = 0; i < 3 && (await page.locator('.scrim').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
    const tabs = dev === 'ipad' ? ['hoy', 'mazos', 'explorar', 'notas', 'estadisticas', 'calendario', 'ajustes'] : ['hoy', 'mazos', 'notas'];
    for (const s of tabs) await go(page, `#/${s}`, `${dev}-${s}`);
    if (dev === 'ipad') {
      await go(page, '#/mazos', 'ipad-mazos');
      const big = page.locator('a, button, .deck-row, .card').filter({ hasText: 'Grande 20000' }).first();
      const t1 = Date.now();
      await big.click().catch((e) => findings.push({ pantalla: 'ipad-mazo-grande', msg: 'no se pudo abrir: ' + String(e).slice(0, 80) }));
      await page.waitForTimeout(1500);
      console.log(' abrir mazo grande', Date.now() - t1, 'ms', page.url());
      await snap(page, 'ipad-mazo-grande');
      await go(page, '#/explorar/pregunta%2019999', 'ipad-explorar-busqueda');
      await go(page, '#/notas', 'ipad-notas-arbol');
      const bn = page.locator('a, button, .tree-item, li').filter({ hasText: 'Nota 5 MB' }).first();
      const t2 = Date.now();
      if (await bn.count()) { await bn.click().catch(() => {}); await page.waitForTimeout(6000); console.log(' abrir nota 5 MB', Date.now() - t2, 'ms'); await snap(page, 'ipad-nota-5mb'); }
      else findings.push({ pantalla: 'ipad-notas', msg: 'no se encontró «Nota 5 MB» en el árbol' });
    }
    await page.context().close();
  }
} finally {
  writeFileSync(OUT + 'break-ui.json', JSON.stringify({ findings, errors }, null, 1));
  console.log('\nHallazgos:', findings.length, ' errores de consola:', errors.length);
  errors.slice(0, 15).forEach((e) => console.log('  !', e));
  await browser.close();
  server.kill();
}
