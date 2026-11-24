// Auditor integral de solapes (add-ons Asistente, Sonido ambiente y Bandeja encendidos; todo real, sin cuadros simulados).
//   npm run build && npm run e2e:uiaudit      (SHOT=dir guarda capturas; ONLY=1024x768,...; BROWSER=chromium)
// Mide fijos/sticky en: Hoy/Mazos (barra superior sin envolver ni desbordar, reproductor con Popover), dock y mascota de GREX,
// chat compacto y grande, Notas (árbol + inspector + búsqueda), avisos, teclado, editor de diagramas (barra + FloatBar).
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const PORT = Number(process.env.PORT) || 4305;
const URL_ = `http://localhost:${PORT}/`;
const SHOT = process.env.SHOT;
if (SHOT) mkdirSync(SHOT, { recursive: true });
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
const ARGS = { args: ['--autoplay-policy=no-user-gesture-required'] };
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(type === pw.chromium ? ARGS : {}); } catch { type = pw.chromium; browser = await type.launch(ARGS); }
console.log('Navegador:', type.name());
const SIZES = [[1024, 768], [1366, 1024], [1440, 900], [768, 1024]];
const only = process.env.ONLY?.split(',');
const found = [];
const errors = [];

const SNAP = () => {
  const out = [];
  const els = [...document.querySelectorAll('body *')];
  els.forEach((el, id) => { el.__a = id; });
  for (const el of els) {
    const cs = getComputedStyle(el);
    if (cs.zIndex !== 'auto' && Number(cs.zIndex) < 0) continue;
    if (el.classList.contains('tooltip')) continue;
    if (!/fixed|sticky/.test(cs.position) || cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const anc = []; for (let p = el.parentElement; p; p = p.parentElement) anc.push(p.__a);
    const tag = el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).filter((c) => !/^(glass|strong|panel|row|stack)/.test(c))[0] : el.tagName.toLowerCase();
    // z efectivo: el del propio elemento o, si es auto, el del primer ancestro con z (portales: raíz)
    const flow = cs.position === 'sticky' && !(cs.top !== 'auto' && Math.abs(r.top - parseFloat(cs.top)) < 2) && !(cs.bottom !== 'auto' && Math.abs(innerHeight - r.bottom - parseFloat(cs.bottom)) < 2);
    out.push({ flow, id: el.__a, anc, name: tag, pos: cs.position, z: cs.zIndex === 'auto' ? 0 : Number(cs.zIndex), x: r.left, y: r.top, w: r.width, h: r.height });
  }
  return out;
};
/** Barra superior: una sola fila, sin desbordar. */
const TOPBAR = () => {
  const tb = document.querySelector('.topbar');
  if (!tb || getComputedStyle(tb).display === 'none') return null;
  const r = tb.getBoundingClientRect();
  const kids = [...tb.children].filter((c) => getComputedStyle(c).display !== 'none' && c.getBoundingClientRect().width > 0);
  const ctr = kids.map((c) => { const q = c.getBoundingClientRect(); return q.top + q.height / 2; });
  const out = kids.filter((c) => { const q = c.getBoundingClientRect(); return q.right > r.right + 1 || q.left < r.left - 1; }).map((c) => c.className);
  return { h: r.height, wrapped: Math.max(...ctr) - Math.min(...ctr), overflowX: tb.scrollWidth - tb.clientWidth, out, n: kids.length, right: r.right, vw: innerWidth };
};

function analyze(snap, w, h, kb, label) {
  const hits = [];
  const vis = h - kb;
  for (const a of snap) {
    if (!a.flow && (a.x < -1 || a.y < -1 || a.x + a.w > w + 1 || a.y + a.h > h + 1)) hits.push(`${label}: ${a.name} fuera de pantalla (${Math.round(a.x)},${Math.round(a.y)} ${Math.round(a.w)}x${Math.round(a.h)})`);
    if (kb && a.pos === 'fixed' && a.y + a.h > vis + 1 && a.y < h && a.y >= vis - a.h && !/^\.(dev-sign|tray)/.test(a.name) && a.y > 80) hits.push(`${label}: ${a.name} bajo el teclado (bottom ${Math.round(a.y + a.h)} > ${Math.round(vis)})`);
  }
  for (let i = 0; i < snap.length; i++) for (let j = i + 1; j < snap.length; j++) {
    const a = snap[i], b = snap[j];
    if (a.anc.includes(b.id) || b.anc.includes(a.id)) continue;
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    // avisos pasajeros (z-toast): por diseño van por encima de un panel del Asistente o de la barra flotante; no tapan la barra del Asistente
    const note = (n) => n === '.toast' || n === '.key-feedback', cover = (n) => n === '.chat-panel' || n === '.diag-fbar';
    // barra pegajosa todavía en su sitio natural del texto (sin pegar): el Asistente flotante pasa por encima como sobre cualquier contenido
    if (a.name === '.toast' && b.name === '.toast') continue; // el simulado del auditor sobre uno real
    if ((a.flow || b.flow) && /gx-dock|gx-mini/.test(a.name + b.name)) continue;
    if ((note(a.name) && cover(b.name)) || (note(b.name) && cover(a.name))) continue;
    if (ox > 4 && oy > 4) hits.push(`${label}: ${a.name}(z${a.z}) x ${b.name}(z${b.z}) ${Math.round(ox)}x${Math.round(oy)}px ${a.z === b.z ? 'MISMO z' : 'z distinto'} [${a.name} y${Math.round(a.y)}+${Math.round(a.h)} x${Math.round(a.x)}+${Math.round(a.w)} | ${b.name} y${Math.round(b.y)}+${Math.round(b.h)} x${Math.round(b.x)}+${Math.round(b.w)}]`);
  }
  return hits;
}

async function boot(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'es-MX' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.goto(URL_ + '#/ajustes/addons');
  const reg = page.getByRole('region', { name: 'Add-ons' });
  for (const n of ['Asistente', 'Sonido ambiente', 'Bandeja de entrada']) await reg.getByRole('switch', { name: n, exact: true }).check({ timeout: 4000 }).catch(() => console.log('  (add-on «' + n + '» no encontrado)'));
  // clave falsa: el chat abre igual
  await page.evaluate(() => localStorage.setItem('engrama.chat.keys', JSON.stringify({ v: 1, keys: [{ id: 'a', alias: 'Uno', provider: 'gemini', key: 'AIzaFake', status: 'active' }] })));
  await page.goto(URL_ + '#/hoy');
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  // ambiente sonando → reproductor en la barra
  await page.getByRole('button', { name: 'Sonido ambiente' }).click({ timeout: 1500 }).catch(async () => { await page.locator('.more-pill').click(); await page.getByRole('menuitem', { name: /Sonido ambiente/ }).click(); });
  const sh = page.getByRole('dialog', { name: 'Sonido ambiente' });
  await sh.getByRole('slider', { name: 'Volumen de Lluvia' }).fill('60');
  await sh.getByRole('button', { name: 'Reproducir', exact: true }).first().click();
  await page.keyboard.press('Escape');
  await page.locator('.mini-amb').waitFor({ timeout: 4000 }).catch(() => console.log('  (el reproductor no apareció)'));
  return { ctx, page };
}

let w0 = 0, h0 = 0;
const goto = async (page, hash) => { await page.goto(URL_ + hash); await page.waitForTimeout(500); };
const kbSet = (page, px) => page.evaluate((px) => { document.documentElement.style.setProperty('--kb-inset', px + 'px'); document.documentElement.classList.toggle('kb-open', px > 80); }, px);

for (const [w, h] of SIZES) {
  if (only && !only.includes(`${w}x${h}`)) continue;
  w0 = w; h0 = h;
  const { ctx, page } = await boot(w, h);
  const n0 = found.length;
  const measure = async (label, { kb = 0, scrolls = [0], topbar = false } = {}) => {
    for (const sy of scrolls) {
      await page.evaluate((y) => window.scrollTo(0, y), sy);
      await page.waitForTimeout(450);
      await page.waitForFunction(() => !document.getAnimations().some((a) => a.effect?.target?.closest?.('.toast, .key-feedback')), null, { timeout: 2500 }).catch(() => {});
      const L = `${w}x${h} ${label}${scrolls.length > 1 ? ' scroll' + sy : ''}`;
      found.push(...analyze(await page.evaluate(SNAP), w, h, kb, L));
      if (topbar) {
        const tb = await page.evaluate(TOPBAR);
        if (tb && (tb.wrapped > 6 || tb.overflowX > 1 || tb.out.length || tb.h > 80)) found.push(`${L}: barra superior envuelta/desbordada (alto ${Math.round(tb.h)}, filas ${Math.round(tb.wrapped)}, scrollX ${tb.overflowX}, fuera ${tb.out.join(',')})`);
      }
      if (SHOT) await page.screenshot({ path: `${SHOT}/${w}x${h}-${label.replace(/\W+/g, '_')}${scrolls.length > 1 ? '-s' + sy : ''}.png` });
    }
  };
  const setSize = async (want) => { const b = page.getByRole('button', { name: want === 'large' ? 'Panel grande' : 'Panel compacto', exact: true }); if (await b.count()) { await b.click(); await page.waitForTimeout(350); } };
  const click = (name, opts = {}) => page.getByRole('button', { name, exact: true }).first().click({ timeout: 3000, ...opts }).catch(() => found.push(`${w}x${h}: botón «${name}» no pulsable`));
  const notice = () => page.evaluate(() => {
    for (const [c, t] of [['key-feedback glass strong', '⌨ ⌘B → Negrita'], ['toast glass', 'Guardado']]) { if (!document.querySelector('.' + c.split(' ')[0])) { const k = document.createElement('div'); k.className = c; k.textContent = t; document.body.appendChild(k); } }
  });
  const clearNotice = () => page.evaluate(() => document.querySelectorAll('.key-feedback, .toast').forEach((e) => e.remove()));
  const closeChat = async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(250); };

  // 1) Hoy y Mazos: barra superior, reproductor y dock
  await goto(page, '#/hoy');
  await measure('hoy-reposo', { topbar: true });
  await page.locator('.mini-amb-main').click({ timeout: 3000 }).catch(() => found.push(`${w}x${h}: mini reproductor no pulsable`));
  await page.waitForTimeout(300);
  await measure('hoy-reproductor-popover', { topbar: true });
  await page.keyboard.press('Escape');
  await goto(page, '#/mazos');
  await measure('mazos', { topbar: true });
  // 2) chat compacto y grande en Hoy
  await goto(page, '#/hoy');
  await click('Escribir');
  await page.getByRole('dialog', { name: 'Asistente' }).waitFor({ timeout: 4000 }).catch(() => found.push(`${w}x${h}: el chat no abrió`));
  await setSize('compact');
  await measure('chat-compacto');
  await notice(); await measure('chat-compacto+avisos'); await clearNotice();
  await setSize('large');
  await measure('chat-grande');
  await notice(); await measure('chat-grande+avisos'); await clearNotice();
  await kbSet(page, 340); await notice(); await measure('chat-grande+teclado', { kb: 340 }); await clearNotice(); await kbSet(page, 0);
  await setSize('compact'); await closeChat();
  // 3) mascota minimizada
  await click('Minimizar a la mascota'); await page.waitForTimeout(300);
  await measure('mascota');
  await notice(); await measure('mascota+avisos'); await clearNotice();
  await kbSet(page, 340); await notice(); await measure('mascota+teclado', { kb: 340 }); await clearNotice(); await kbSet(page, 0);
  await click('Mostrar la barra del Asistente'); await page.waitForTimeout(300);

  // 4) Notas
  await goto(page, '#/notas');
  await page.getByRole('button', { name: 'Nueva nota', exact: true }).first().click();
  await page.locator('.sheet').getByLabel('Título').fill('Integral');
  await page.locator('.sheet').getByLabel('Título').press('Enter');
  await page.locator('.doc').waitFor();
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Ver Markdown' }).click();
  await page.getByLabel('Markdown de la nota').fill(Array.from({ length: 60 }, (_, i) => `## Título ${i}\n\nPárrafo ${i} con **texto** de relleno.`).join('\n\n'));
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Documento' }).click();
  await page.waitForTimeout(400);
  const panel = async (name, want) => { await page.evaluate(() => window.scrollTo(0, 0)); const b = page.getByRole('button', { name: want ? `Mostrar ${name}` : `Ocultar ${name}`, exact: true }).first(); if (await b.count()) await b.click({ force: true }); await page.waitForTimeout(350); };
  await panel('explorador', true); await panel('inspector', true);
  await page.getByRole('button', { name: 'Buscar en esta nota' }).first().click({ timeout: 4000, force: true }).catch(() => {});
  await page.waitForTimeout(250);
  await measure('notas-arbol+inspector+buscar', { scrolls: [0, 600], topbar: true });
  await notice(); await measure('notas-todo+avisos', { scrolls: [600] }); await clearNotice();
  await panel('explorador', false);
  await click('Escribir'); await page.getByRole('dialog', { name: 'Asistente' }).waitFor({ timeout: 4000 }).catch(() => {}); await setSize('compact');
  await measure('notas-inspector+chat-compacto', { scrolls: [0, 600] });
  await notice(); await measure('notas-inspector+chat-compacto+avisos', { scrolls: [600] }); await clearNotice();
  await setSize('large');
  await measure('notas-inspector+chat-grande', { scrolls: [0, 600] });
  await notice(); await measure('notas-inspector+chat-grande+avisos', { scrolls: [600] }); await clearNotice();
  await setSize('compact'); await closeChat();
  await kbSet(page, 340); await notice(); await measure('notas-teclado', { kb: 340, scrolls: [600] }); await clearNotice(); await kbSet(page, 0);
  await panel('inspector', false);
  await click('Minimizar a la mascota'); await page.waitForTimeout(300);
  await measure('notas-mascota', { scrolls: [0, 600] });
  await click('Mostrar la barra del Asistente');

  // 5) diagrama: barra del editor + FloatBar
  await goto(page, '#/notas');
  await page.getByRole('button', { name: 'Nueva nota', exact: true }).first().click();
  await page.locator('.sheet').getByLabel('Título').fill('Mapa integral');
  await page.locator('.sheet').getByRole('group', { name: 'Tipo de nota' }).getByRole('button', { name: 'Mapa mental', exact: true }).click();
  await page.locator('.sheet').getByRole('button', { name: 'Crear', exact: true }).click();
  await page.locator('.diag-editor').waitFor({ timeout: 6000 }).catch(() => found.push(`${w}x${h}: no abrió el editor de diagramas`));
  await page.waitForTimeout(500);
  await measure('diagrama', { scrolls: [0, 300], topbar: true });
  await page.locator('.diag-node').first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
  await measure('diagrama+floatbar', { scrolls: [0] });
  await click('Escribir'); await page.getByRole('dialog', { name: 'Asistente' }).waitFor({ timeout: 4000 }).catch(() => {});
  await setSize('large');
  await measure('diagrama+chat-grande');
  await notice(); await measure('diagrama+chat-grande+avisos'); await clearNotice();
  // barra superior: la pastilla de la pestaña activa cubre su enlace y su etiqueta (Bold incluido), una vez asentada la animación
  const innerWidthOf = w;
  const tabs = await page.$$eval('.seg-nav a', (as) => as.map((a) => a.getAttribute('href')));
  for (const h of tabs) {
    await goto(page, h); await page.waitForTimeout(700);
    const r = await page.evaluate(() => {
      const a = document.querySelector('.seg-nav a[aria-current="page"]'), sl = document.querySelector('.seg-nav .slider'), l = a?.querySelector('.lbl');
      if (!a || !sl || !l) return null;
      const A = a.getBoundingClientRect(), S = sl.getBoundingClientRect(), L = l.getBoundingClientRect(), N = a.closest('.seg-nav');
      const NR = N.getBoundingClientRect();
      return { nv: N.scrollWidth - N.clientWidth, hid: Math.round(Math.max(NR.left - A.left, A.right - NR.right)), tab: a.textContent.trim(), dw: Math.round(S.width - A.width), dl: Math.round(S.left - A.left), over: Math.round(L.right - S.right), overL: Math.round(S.left - L.left) };
    });
    if (r && (Math.abs(r.dw) > 2 || Math.abs(r.dl) > 2 || r.over > 0 || r.overL > 0 || r.hid > 1 || (innerWidthOf > 1000 && r.nv > 1))) found.push(`${w}x${h}`.replace(/x\d+$/, '') + ` barra superior: pastilla de «${r.tab}» no cubre su etiqueta (${JSON.stringify(r)})`);
  }
  await ctx.close();
  console.log(`== ${w}x${h}: ${found.length - n0} problemas`); found.slice(n0).forEach((f) => console.log('  ✗ ' + f));
}
process.on('exit', () => server.kill());
console.log(found.length ? `TOTAL ${found.length} problemas` : '  ✓ sin solapes');
if (errors.length) console.log('Errores de página:', errors.slice(0, 3));
server.kill();
await browser.close();
process.exit(found.length ? 1 : 0);
