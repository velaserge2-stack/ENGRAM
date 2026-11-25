// Presentación de bienvenida (usuario nuevo en el navegador): puerta, flujo, textos y capturas.
//   PORT=4362 BROWSER=chromium npm run e2e:welcome   (después de `npm run build`)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('./out/welcome/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT || 4362);
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview salió ' + c))); });
const browser = await (pw[process.env.BROWSER || 'chromium'] ?? pw.chromium).launch();

let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'OK  ' : 'FALLA'} ${m}`); if (!c) fails++; };
const BLACK = /\.(md|jsonl|json|ics|apkg|zip|docx)\b|decks\/|notes\/|anki21b|\bv11\b|\bv18\b|zstd|fsrs|opfs|safevault|diario|suma de verificaci|markdown|wikilink|\[\[|q::|archivos? de texto|bóveda|boveda|frontmatter|indexeddb|service worker/i;
const FAKE = `<!doctype html><meta charset=utf-8><body style="margin:0;font:700 28px system-ui;display:grid;place-items:center;height:100vh;background:linear-gradient(135deg,#e3d3bf,#a7bdb0)"><div id=h>demo</div><script>
addEventListener('message',e=>{if(e.data&&e.data.type==='engrama-demo:go'){document.getElementById('h').textContent=e.data.hash;parent.postMessage({type:'engrama-demo:route',hash:e.data.hash},'*')}});
parent.postMessage({type:'engrama-demo:ready'},'*');</script>`;

async function ctxFor(opts = {}, { fake = true, init } = {}) {
  const ctx = await browser.newContext({ locale: 'es-MX', viewport: { width: 1366, height: 1024 }, ...opts });
  const reqs = [], errs = [];
  if (init) await ctx.addInitScript(init);
  if (fake) await ctx.route(/\/\?demo=1/, (r) => r.fulfill({ contentType: 'text/html', body: FAKE }));
  const page = await ctx.newPage();
  page.on('request', (r) => { if (!/^(http:\/\/localhost|data:|blob:|about:)/.test(r.url())) reqs.push(r.url()); });
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  return { ctx, page, reqs, errs };
}

try {
  // (a) raíz sin datos → landing; (e) Iniciar sesión → Instalar
  let { ctx, page, reqs, errs } = await ctxFor();
  await page.goto(URL_);
  await page.locator('.bv-root h1').first().waitFor();
  ok(/Recuerda más/.test(await page.locator('.bv-root h1').first().innerText()), '(a) raíz nueva muestra la presentación');
  ok((await page.locator('#bv-root .bv-plan').count()) === 4, 'precios: 4 tarjetas');
  ok((await page.locator('.bv-plan [aria-disabled=true]').count()) === 3, 'precios: 3 botones «Próximamente» deshabilitados');
  ok((await page.locator('.bv-plan.hi').count()) === 1, 'precios: «Gratis» destacada');
  ok((await page.locator('#bv-ia .bv-cardx').count()) === 8 && (await page.locator('#bv-ia .bv-guar li').count()) === 4, 'capacidades: 8 tarjetas y 4 garantías');
  // demo falso: ready → iframe visible; las pestañas mandan la ruta
  await page.locator('#bv-stage').scrollIntoViewIfNeeded();
  const fr = page.frameLocator('.bv-screen iframe');
  await fr.locator('#h').waitFor({ timeout: 8000 });
  await page.getByRole('tab', { name: 'Notas' }).click();
  await page.waitForFunction(() => document.querySelector('.bv-screen iframe')?.contentWindow && true);
  await fr.locator('#h', { hasText: '#/notas' }).waitFor({ timeout: 4000 });
  ok(true, 'demo: ready recibido y la pestaña cambia la ruta del iframe');
  ok((await page.locator('.bv-screen iframe').getAttribute('sandbox')) === 'allow-scripts', 'demo: sandbox="allow-scripts"');
  const txt = await page.locator('#bv-root').evaluate((e) => e.textContent);
  ok(!BLACK.test(txt), '(i) sin términos técnicos (es): ' + (txt.match(BLACK)?.[0] ?? ''));
  ok(!/ejemplo|maqueta|idea\b/i.test(txt), 'sin «ejemplo/maqueta/idea»');
  await page.getByRole('link', { name: 'Iniciar sesión' }).first().click();
  await page.getByRole('heading', { name: 'Instalar Engrama' }).waitFor();
  ok(page.url().endsWith('#/bienvenida/instalar'), '(e) Iniciar sesión lleva a Instalar');
  ok((await page.getByRole('button', { name: 'Instalar' }).count()) === 1 && (await page.locator('.bv-steps li').count()) === 3, '(g) Instalar: botón y 3 pasos');
  // beforeinstallprompt simulado
  await page.evaluate(() => { window.__p = 0; const e = new Event('beforeinstallprompt', { cancelable: true }); e.prompt = async () => { window.__p++; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); dispatchEvent(e); });
  await page.getByRole('button', { name: 'Instalar' }).click();
  ok((await page.evaluate(() => window.__p)) === 1 || !(await page.evaluate(() => 'onbeforeinstallprompt' in window)), '(g) el botón dispara beforeinstallprompt');
  ok((await page.locator('.bv-inst').innerText()).length < 400, 'Instalar casi vacía');
  // (f) crear cuenta
  await page.goto(URL_ + '?app#/bienvenida/crear');
  await page.getByLabel('Correo').waitFor();
  await page.getByRole('button', { name: 'Continuar' }).click();
  ok(/Escribe tu correo/.test(await page.getByRole('alert').innerText()) && (await page.getByLabel('Correo').getAttribute('aria-invalid')) === 'true', '(f) vacío: error accesible');
  await page.getByLabel('Correo').fill('mal@');
  await page.getByRole('button', { name: 'Continuar' }).click();
  ok(/incompleto/.test(await page.getByRole('alert').innerText()), '(f) correo inválido: error');
  const inp = await page.getByLabel('Correo').evaluate((e) => ({ t: e.type, ac: e.autocomplete, fs: parseFloat(getComputedStyle(e).fontSize), h: e.getBoundingClientRect().height }));
  ok(inp.t === 'email' && inp.ac === 'email' && inp.fs >= 16 && inp.h >= 44, '(f) input email ≥16 px / 44 px');
  const MAIL = 'secreto.prueba@ejemplo.com';
  await page.getByLabel('Correo').fill(MAIL);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.getByRole('heading', { name: 'Instalar Engrama' }).waitFor();
  const dump = await page.evaluate(async () => {
    let s = JSON.stringify({ ...localStorage, ...sessionStorage }) + location.href;
    try { const walk = async (d) => { for await (const [n, h] of d.entries()) { if (h.kind === 'file') s += n + (await (await h.getFile()).text()); else await walk(h); } }; await walk(await navigator.storage.getDirectory()); } catch {}
    try { for (const { name } of await indexedDB.databases()) { const db = await new Promise((r, j) => { const q = indexedDB.open(name); q.onsuccess = () => r(q.result); q.onerror = j; }); for (const st of db.objectStoreNames) { s += JSON.stringify(await new Promise((r) => { const q = db.transaction(st).objectStore(st).getAll(); q.onsuccess = () => r(q.result); q.onerror = () => r([]); })); } } } catch {}
    return s;
  });
  ok(!dump.includes(MAIL) && !reqs.some((u) => u.includes('secreto')), '(f) el correo no queda en almacenamiento, URL ni red');
  ok(/tu correo no se guarda/.test(await (await ctx.newPage().then(async (p) => { await p.goto(URL_ + '?app#/bienvenida/crear'); return p.locator('.bv-ac-card'); })).innerText()), 'texto honesto bajo el botón');
  // (h) tema e idiomas
  await page.goto(URL_ + '?app#/bienvenida');
  await page.getByRole('button', { name: 'Tema oscuro' }).first().click();
  ok(await page.locator('.bv-root.dark').count() === 1, '(h) tema oscuro');
  for (const [l, h1, bad] of [['en', /Remember more/, /Recuerda/], ['fr', /Retiens plus/, /Recuerda|Remember/], ['es', /Recuerda más/, /Remember/]]) {
    await page.locator('.bv-bot .bv-seg button', { hasText: l }).click();
    await page.getByRole('heading', { level: 1 }).first().filter({ hasText: h1 }).waitFor({ timeout: 4000 });
    const tx = await page.locator('#bv-root').evaluate((e) => e.textContent);
    ok(!BLACK.test(tx) && !bad.test(tx.slice(0, 400)), `(h/i) idioma ${l}: sin términos técnicos`);
  }
  ok(reqs.length === 0, '(j) 0 peticiones externas ' + reqs.join(','));
  ok(errs.filter((e) => !/ERR_|sandbox/.test(e)).length === 0, '(j) 0 errores de consola ' + errs.join(' | '));
  await ctx.close();

  // (b) ?app → Welcome actual; (c) standalone → Welcome; (d) welcomeDone → app
  ({ ctx, page } = await ctxFor());
  await page.goto(URL_ + '?app');
  await page.getByRole('heading', { name: 'Bienvenido a Engrama' }).waitFor();
  ok(true, '(b) con ?app: Welcome actual');
  await page.getByRole('button', { name: 'Empezar' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.goto(URL_);
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  ok((await page.locator('.bv-root').count()) === 0, '(d) con welcomeDone: la app, sin presentación');
  await ctx.close();
  ({ ctx, page } = await ctxFor({}, { init: () => { const m = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : m(q)); } }));
  await page.goto(URL_);
  await page.getByRole('heading', { name: 'Bienvenido a Engrama' }).waitFor();
  ok((await page.locator('.bv-root').count()) === 0, '(c) instalada (standalone): Welcome actual');
  await ctx.close();

  // demo sin respuesta → tarjeta amable a los 10 s
  ({ ctx, page } = await ctxFor({}, { fake: false }));
  await ctx.route(/\/\?demo=1/, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><p>sin ready' }));
  await page.goto(URL_);
  await page.locator('#bv-stage').scrollIntoViewIfNeeded();
  await page.locator('.bv-fb').waitFor({ timeout: 14000 });
  ok(/en vivo/.test(await page.locator('.bv-fb').innerText()) && (await page.locator('.bv-screen iframe').count()) === 0, 'demo sin ready: tarjeta «Míralo en vivo al instalar»');
  await ctx.close();

  // teléfono + capturas
  for (const [w, h] of [[1366, 1024], [1024, 768], [390, 844]]) {
    for (const dark of [false, true]) {
      ({ ctx, page } = await ctxFor({ viewport: { width: w, height: h }, hasTouch: w < 600 }));
      await page.goto(URL_ + '?app#/bienvenida');
      await page.locator('.bv-root h1').first().waitFor();
      if (dark) await page.getByRole('button', { name: 'Tema oscuro' }).first().click().catch(async () => { await page.locator('.bv-bot .bv-seg button[aria-label="Tema oscuro"]').click(); });
      const noScroll = await page.locator('#bv-root').evaluate((e) => e.scrollWidth <= e.clientWidth + 1);
      ok(noScroll, `(h) ${w}px ${dark ? 'oscuro' : 'claro'}: sin scroll horizontal`);
      const name = `${w}-${dark ? 'dark' : 'light'}`;
      for (const id of ['inicio', 'funciones', 'como', 'ia', 'migrar', 'precios', 'preguntas', 'empezar']) {
        await page.locator(`#bv-${id}`).evaluate((e) => e.scrollIntoView({ block: 'start' }));
        await page.locator('.bv-reveal').evaluateAll((a) => a.forEach((e) => e.classList.add('in')));
        await page.waitForTimeout(250);
        await page.screenshot({ path: `${OUT}${name}-${id}.png` });
      }
      for (const p of ['crear', 'instalar']) { await page.goto(URL_ + '?app#/bienvenida/' + p); await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}${name}-${p}.png` }); ok(await page.locator('#bv-root').evaluate((e) => e.scrollWidth <= e.clientWidth + 1), `(h) ${w}px ${p}: sin scroll horizontal`); }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(fails ? `\n${fails} FALLAS` : '\nTODO OK');
process.exit(fails ? 1 : 0);
