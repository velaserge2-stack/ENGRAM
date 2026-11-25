// Auditor de solapes en Notas (fijos/sticky): mide rects en varias situaciones y tamaños.
//   npm run build && npm run e2e:uiaudit-notas      (SHOT=dir guarda capturas; ONLY=1024x768,...)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const PORT = Number(process.env.PORT) || 4304;
const URL_ = `http://localhost:${PORT}/`;
const SHOT = process.env.SHOT;
if (SHOT) mkdirSync(SHOT, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort', ...(process.env.DIST ? ['--outDir', process.env.DIST] : [])], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
const SIZES = [[1024, 768], [1366, 1024], [1440, 900], [768, 1024], [700, 900]];
const only = process.env.ONLY?.split(',');
const found = [];
const errors = [];

/** Fijos/sticky visibles con su caja, z-index y cadena de ancestros (para ignorar pares anidados). */
const SNAP = () => {
  const out = [];
  const els = [...document.querySelectorAll('body *')];
  els.forEach((el, id) => { el.__a = id; });
  for (const el of els) {
    const cs = getComputedStyle(el);
    if (cs.zIndex !== 'auto' && Number(cs.zIndex) < 0) continue; // fondos
    if (el.classList.contains('dev-sign') || el.classList.contains('tooltip')) continue; // firma; tooltip (transitorio, sigue al puntero) // firma del desarrollador (fuera de Notas)
    if (!/fixed|sticky/.test(cs.position) || cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const anc = []; for (let p = el.parentElement; p; p = p.parentElement) anc.push(p.__a);
    const tag = el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).filter((c) => !/^(glass|strong|panel|row|stack)/.test(c))[0] : el.tagName.toLowerCase();
    // controles pulsables dentro de fijos (objetivo táctil)
    const small = [...el.querySelectorAll('button, a, input, select, [role=button]')].filter((b) => { const q = b.getBoundingClientRect(); return q.width > 0 && (q.height < 44 || q.width < 44) && getComputedStyle(b).visibility !== 'hidden'; }).length;
    out.push({ id: el.__a, anc, name: tag, pos: cs.position, z: cs.zIndex === 'auto' ? 0 : Number(cs.zIndex), x: r.left, y: r.top, w: r.width, h: r.height, small });
  }
  return out;
};

function analyze(snap, w, h, kb, label) {
  const hits = [];
  const vis = h - kb;
  for (const a of snap) {
    if (a.x < -1 || a.y < -1 || a.x + a.w > w + 1 || a.y + a.h > h + 1) hits.push(`${label}: ${a.name} fuera de pantalla (${Math.round(a.x)},${Math.round(a.y)} ${Math.round(a.w)}x${Math.round(a.h)})`);
    if (kb && !['.fakedock', '.toast'].includes(a.name) && a.y + a.h > vis + 1 && a.y < h && a.pos === 'fixed' && a.y > vis - 400 && a.y >= vis - a.h) hits.push(`${label}: ${a.name} bajo el teclado (bottom ${Math.round(a.y + a.h)} > ${Math.round(vis)})`);
  }
  for (let i = 0; i < snap.length; i++) for (let j = i + 1; j < snap.length; j++) {
    const a = snap[i], b = snap[j];
    if (a.anc.includes(b.id) || b.anc.includes(a.id)) continue;
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox > 4 && oy > 4 && !(a.name === '.toast' && b.name === '.fakedock' || b.name === '.toast' && a.name === '.fakedock')) hits.push(`${label}: ${a.name}(z${a.z}) x ${b.name}(z${b.z}) ${Math.round(ox)}x${Math.round(oy)}px ${a.z === b.z ? 'MISMO z' : 'z distinto'}`);
  }
  return hits;
}

async function boot(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'es-MX' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_ + '?app');
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.goto(URL_ + '?app#/notas');
  await page.getByRole('button', { name: 'Nueva nota', exact: true }).first().click();
  await page.locator('.sheet').getByLabel('Título').fill('Auditoría');
  await page.locator('.sheet').getByLabel('Título').press('Enter');
  await page.locator('.doc').waitFor();
  // contenido largo (para que lo sticky se pegue) y títulos
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Ver Markdown' }).click();
  const body = Array.from({ length: 60 }, (_, i) => `## Título ${i}\n\nPárrafo ${i} con **texto** de relleno para la auditoría de solapes.`).join('\n\n');
  await page.getByLabel('Markdown de la nota').fill(body);
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Documento' }).click();
  await page.waitForTimeout(400);
  return { ctx, page };
}
let w0 = 0, h0 = 0;
const setPanel = async (page, name, want) => {
  await page.evaluate(() => window.scrollTo(0, 0));
  const btn = page.getByRole('button', { name: want ? `Mostrar ${name}` : `Ocultar ${name}`, exact: true }).first();
  if (await btn.count()) await btn.click({ timeout: 3000 }).catch(async () => { found.push(`${w0}x${h0} botón «${name}» tapado (no pulsable)`); await btn.click({ force: true }); });
  await page.waitForTimeout(350);
};
const scrolled = (page, y) => page.evaluate((y) => { window.scrollTo(0, y); }, y).then(() => page.waitForTimeout(150));

for (const [w, h] of SIZES) {
  if (only && !only.includes(`${w}x${h}`)) continue;
  w0 = w; h0 = h;
  const { ctx, page } = await boot(w, h);
  const n0 = found.length;
  const fakeDock = () => page.evaluate(() => {
    for (const [id, css] of [['fd-c', 'left:50%;transform:translateX(-50%);bottom:16px;width:360px'], ['fd-r', 'right:16px;bottom:16px;width:56px']]) {
      if (document.getElementById(id)) continue;
      const d = document.createElement('div'); d.id = id; d.className = 'fakedock';
      d.style.cssText = `position:fixed;z-index:150;height:56px;${css}`; document.body.appendChild(d);
    }
  });
  const kbSet = (px) => page.evaluate((px) => { document.documentElement.style.setProperty('--kb-inset', px + 'px'); document.documentElement.classList.toggle('kb-open', px > 80); }, px);
  const measure = async (label, kb = 0) => {
    for (const sy of [0, 600]) {
      await scrolled(page, sy);
      await page.waitForTimeout(400); // animaciones de entrada (toast, key-feedback)
      const hits = analyze(await page.evaluate(SNAP), w, h, kb, `${w}x${h} ${label} scroll${sy}`);
      // los fakedock son dummies del chat: solo cuentan frente a elementos de Notas
      found.push(...hits);
      if (SHOT && sy === 600) await page.screenshot({ path: `${SHOT}/${w}x${h}-${label.replace(/\W+/g, '_')}.png` });
    }
  };
  await fakeDock();
  await measure('reposo');
  // árbol y inspector (a la vez)
  await setPanel(page, 'explorador', true);
  await measure('arbol');
  await setPanel(page, 'inspector', true);
  await measure('arbol+inspector');
  await setPanel(page, 'inspector', false);
  await setPanel(page, 'explorador', false);
  await setPanel(page, 'inspector', true);
  await measure('inspector');
  // búsqueda
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'Buscar en esta nota' }).first().click({ timeout: 4000 }).catch(async () => { found.push(`${w}x${h}: botón «Buscar» tapado/no pulsable con el inspector abierto`); await page.getByRole('button', { name: 'Buscar en esta nota' }).first().click({ force: true }); });
  await page.waitForTimeout(200);
  await measure('buscar+inspector');
  await setPanel(page, 'inspector', false);
  await measure('buscar');
  // key-feedback y toast simulados con el mismo markup que la app
  await page.evaluate(() => {
    const k = document.createElement('div'); k.className = 'key-feedback glass strong'; k.textContent = '⌨ ⌘B → Negrita'; document.body.appendChild(k);
    if (!document.querySelector('.toast')) { const t = document.createElement('div'); t.className = 'toast glass'; t.textContent = 'Guardado'; document.body.appendChild(t); }
  });
  await measure('buscar+key+toast');
  await setPanel(page, 'inspector', true);
  await measure('buscar+key+toast+inspector');
  await page.evaluate(() => document.querySelectorAll('.key-feedback, .toast').forEach((e) => e.remove()));
  // teclado
  await kbSet(340);
  await page.evaluate(() => { const t = document.createElement('div'); t.className = 'toast glass'; t.textContent = 'Guardado'; document.body.appendChild(t); });
  await measure('teclado', 340);
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((e) => e.remove()));
  await kbSet(0);
  // pantalla completa
  await page.getByRole('button', { name: 'Pantalla completa de notas' }).first().click({ timeout: 4000, force: true }).catch(() => found.push(`${w}x${h}: no hay botón de pantalla completa`));
  await page.waitForTimeout(300);
  await measure('pantalla-completa');
  await setPanel(page, 'inspector', true);
  await measure('pantalla-completa+inspector');
  await ctx.close();
  console.log(`== ${w}x${h}: ${found.length - n0} solapes`); found.slice(n0).forEach((f) => console.log('  ✗ ' + f));
}
process.on('exit', () => server.kill());
console.log(found.length ? `TOTAL ${found.length} solapes` : '  ✓ sin solapes');
if (errors.length) console.log('Errores de página:', errors.slice(0, 3));
server.kill();
await browser.close();
process.exit(found.length ? 1 : 0);
