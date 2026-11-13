// Notas-Pro (fotos y add-ons de notas). Paquete 1 = Fase A: fotos con original, miniatura y acomodo libre.
//   npm run build && npm run e2e:notaspro      (ONLY=fotos,muchas para elegir)
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const { unzipSync } = require('fflate');
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT) || 4191;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
const check = (c, m) => { if (!c) throw new Error('FALLÓ: ' + m); console.log('  ✓', m); };
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const run = (k) => !only || only.includes(k);
const errors = [];
const same = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

async function fresh(w = 1180, h = 820) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'es-MX', acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  return { ctx, page };
}

async function newNote(page, title) {
  await page.goto(URL_ + '#/notas');
  await page.getByRole('button', { name: 'Nueva nota', exact: true }).first().click();
  await page.locator('.sheet').getByLabel('Título').fill(title);
  await page.locator('.sheet').getByLabel('Título').press('Enter');
  await page.locator('.doc').waitFor();
}

/** JPEG de ruido generado en el navegador (no comprime: pesa como una foto real). */
const noiseJpeg = (page, w, h, q = 0.92) => page.evaluate(async ([w, h, q]) => {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const x = c.getContext('2d');
  const id = x.createImageData(w, h);
  for (let i = 0; i < id.data.length; i += 4) (id.data[i] = (Math.random() * 255) | 0), (id.data[i + 1] = (i >> 9) & 255), (id.data[i + 2] = (Math.random() * 255) | 0), (id.data[i + 3] = 255);
  x.putImageData(id, 0, 0);
  const b = new Uint8Array(await (await new Promise((r) => c.toBlob(r, 'image/jpeg', q))).arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}, [w, h, q]).then((b64) => Buffer.from(b64, 'base64'));

const markdown = async (page) => {
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Ver Markdown' }).click();
  const v = await page.getByLabel('Markdown de la nota').inputValue();
  await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: 'Documento' }).click();
  return v;
};

async function exportFile(page, label) {
  await page.getByRole('button', { name: 'Compartir o exportar' }).click();
  await page.getByRole('button', { name: label }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Guardar / }).click();
  const d = await dl;
  const buf = readFileSync(await d.path());
  if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
  return buf;
}

try {
  if (run('fotos')) {
    console.log('Fase A · una foto grande');
    const { ctx, page } = await fresh();
    const photo = await noiseJpeg(page, 4032, 3024);
    writeFileSync(OUT + 'np-foto.jpg', photo);
    check(photo.length > 3_000_000, `foto de prueba de 12 MP (${(photo.length / 1e6).toFixed(1)} MB)`);
    await newNote(page, 'Fotos');
    // «/imagen» + Intro: si el menú no recibe el Intro (fallo previo de BlockInput al teclear rápido), se reintenta
    let chooser = null;
    for (let t = 0; t < 3 && !chooser; t++) {
      if (!(await page.locator('.doc textarea').count())) await page.getByRole('button', { name: /Escribe o usa/ }).click();
      await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA');
      await page.keyboard.type('/ima', { delay: 80 });
      await page.locator('.slash').getByText('Imagen').waitFor();
      const fc = page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null);
      await page.keyboard.press('Enter');
      chooser = await fc;
      if (!chooser) (await page.keyboard.press('Escape'), await page.locator('.doc textarea').fill('').catch(() => {}));
    }
    check(!!chooser, '«/imagen» abre el selector de archivos');
    await chooser.setFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: photo });
    const bar = page.getByRole('toolbar', { name: 'Opciones de la imagen' });
    await bar.waitFor({ timeout: 15000 });
    check(true, 'tras insertar, la barra de la imagen aparece lista');
    const img = page.locator('.doc img[data-media]').first();
    await page.waitForFunction(() => document.querySelector('.doc img[data-media]')?.naturalWidth > 0, null, { timeout: 20000 });
    const nat = await img.evaluate((e) => e.naturalWidth);
    check(nat <= 1200, `se muestra la miniatura (${nat} px), no el original de 4032 px`);

    await bar.getByRole('button', { name: 'Alinear a la izquierda (texto a la derecha)' }).click();
    await bar.getByRole('button', { name: 'Mediana (mitad)' }).click();
    check(/!\[\[[^\]]+\.jpg\|50%\|izq\]\]/.test(await markdown(page)), 'alineación y tamaño quedan en el Markdown (![[…|50%|izq]])');
    await page.locator('.doc img[data-media]').first().click();
    await bar.getByRole('button', { name: 'Texto al lado' }).click();
    await page.keyboard.type('Texto que fluye a la derecha de la foto.');
    await page.keyboard.press('Escape');
    const lay = await page.locator('.doc img[data-align="izq"]').first().evaluate((e) => ({ float: getComputedStyle(e).float, text: e.parentElement.textContent }));
    check(lay.float === 'left' && lay.text.includes('Texto que fluye'), 'la foto flota a la izquierda y el texto queda a su lado');

    // asa: arrastrar cambia el ancho; ⌘Z lo deshace
    await page.locator('.doc img[data-media]').first().click();
    const h = page.getByRole('button', { name: 'Cambiar tamaño (arrastra, o flechas)' });
    const hb = await h.boundingBox();
    const before = await markdown(page);
    await page.locator('.doc img[data-media]').first().click();
    const hb2 = await h.boundingBox();
    await page.mouse.move(hb2.x + 22, hb2.y + 22);
    await page.mouse.down();
    await page.mouse.move(hb2.x - 60, hb2.y + 22, { steps: 6 });
    await page.mouse.move(hb2.x - 120, hb2.y + 22, { steps: 6 });
    await page.mouse.up();
    const after = await markdown(page);
    const px = /\.jpg\|(\d+)\|izq/.exec(after)?.[1];
    check(hb && px && Number(px) >= 80 && after !== before, `el asa reescribe el ancho en píxeles (${px} px)` + (px ? '' : ' → ' + (/!\[\[[^\]]+\]\]/.exec(after)?.[0] ?? '') + ' hb=' + JSON.stringify(hb)));
    await page.locator('.doc h1, .doc .foot').first().click().catch(() => {});
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    check((await markdown(page)) === before, '⌘Z deshace el cambio de tamaño (un solo paso)');

    // texto alternativo
    await page.locator('.doc img[data-media]').first().click();
    await bar.getByLabel('Texto alternativo').fill('ECG | derivación II');
    await bar.getByLabel('Texto alternativo').press('Enter');
    await page.waitForTimeout(200);
    const mdAlt = await markdown(page);
    check(mdAlt.includes('|alt ECG | derivación II]]'), 'texto alternativo editable (con | dentro)' + (mdAlt.includes('alt') ? '' : ' → ' + (/!\[\[[^\]]+\]\]/.exec(mdAlt)?.[0] ?? '')));
    await page.keyboard.press('Escape');

    // persistencia
    const md = await markdown(page);
    await page.waitForTimeout(1200);
    await page.reload();
    await page.locator('.doc img[data-align="izq"]').waitFor({ timeout: 15000 });
    check((await markdown(page)) === md, 'cerrar y reabrir conserva posición, tamaño y alt (están en el .md)');

    // exportar: el original byte a byte
    const zip = unzipSync(new Uint8Array(await exportFile(page, /Preparar \.md/)));
    const zMedia = Object.entries(zip).filter(([k]) => k.startsWith('media/'));
    check(zMedia.length === 1 && same(zMedia[0][1], photo) && !Object.keys(zip).some((k) => k.includes('thumbs')), 'zip de la nota: el original idéntico byte a byte (sin miniaturas)');
    const docx = unzipSync(new Uint8Array(await exportFile(page, 'Preparar .docx')));
    const dMedia = Object.entries(docx).filter(([k]) => k.startsWith('word/media/'));
    check(dMedia.some(([, b]) => same(b, photo)), '.docx: el original idéntico byte a byte');
    check(new TextDecoder().decode(docx['word/document.xml']).includes('wp:anchor'), '.docx: la foto flota (misma posición que en la nota)');

    // imprimir/PDF: originales en lugar de miniaturas, y vuelta atrás
    await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
    await page.getByRole('button', { name: 'Compartir o exportar' }).click();
    await page.getByRole('button', { name: 'PDF (imprimir)' }).click();
    await page.waitForFunction(() => window.__printed, null, { timeout: 20000 });
    check(await img.evaluate((e) => e.naturalWidth) === 4032, 'al imprimir se usa el original (4032 px)');
    await page.evaluate(() => dispatchEvent(new Event('afterprint')));
    await page.waitForFunction(() => document.querySelector('.doc img[data-media]').naturalWidth <= 1200, null, { timeout: 5000 });
    check(true, 'tras imprimir vuelve la miniatura (se libera la memoria)');

    // ancho estrecho: la foto flotada pasa a ancho completo
    await page.setViewportSize({ width: 420, height: 820 });
    await page.waitForTimeout(300);
    const narrow = await page.locator('.doc img[data-align="izq"]').first().evaluate((e) => ({ float: getComputedStyle(e).float, w: e.getBoundingClientRect().width, p: e.closest('.md').clientWidth }));
    check(narrow.float === 'none' && narrow.w >= narrow.p - 2, 'en < 480 px la foto flotada ocupa todo el ancho');
    await page.screenshot({ path: OUT + 'np-fotos.png' });
    await ctx.close();
  }

  if (run('muchas')) {
    console.log('Fase A · 30 fotos en una nota');
    const { ctx, page } = await fresh();
    await newNote(page, 'Treinta');
    const one = await noiseJpeg(page, 1800, 1350, 0.97);
    check(one.length > 1_000_000, `cada foto pesa ${(one.length / 1e6).toFixed(1)} MB (necesita miniatura)`);
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      for (let i = 0; i < 30; i++) { const b = bytes.slice(); b[b.length - 3] = i; dt.items.add(new File([b], `f${i}.jpg`, { type: 'image/jpeg' })); }
      document.querySelector('.doc').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, one.toString('base64'));
    await page.waitForFunction(() => document.querySelectorAll('.doc img[data-media]').length === 30, null, { timeout: 60000 });
    check(true, 'soltar 30 fotos las guarda y las añade a la nota');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('.doc img[data-media]').length === 30, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const loaded = await page.evaluate(() => [...document.querySelectorAll('.doc img[data-media]')].filter((i) => i.getAttribute('src')).length);
    check(loaded < 30, `carga perezosa: al abrir solo hay ${loaded} de 30 imágenes cargadas`);
    // desplazar toda la nota midiendo los cuadros
    const m = await page.evaluate(async () => {
      const sc = (() => { let e = document.querySelector('.doc'); while (e && !(e.scrollHeight > e.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(e).overflowY))) e = e.parentElement; return e ?? document.scrollingElement; })();
      const frames = [];
      let last = performance.now();
      const h0 = sc.scrollHeight;
      for (let k = 0; k < 600 && sc.scrollTop + sc.clientHeight < sc.scrollHeight - 5; k++) {
        sc.scrollTop += 120;
        await new Promise((r) => requestAnimationFrame(r));
        const t = performance.now();
        frames.push(t - last);
        last = t;
      }
      for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 100));
      frames.sort((a, b) => a - b);
      return { h0, h1: sc.scrollHeight, n: frames.length, p50: frames[frames.length >> 1], p95: frames[Math.floor(frames.length * 0.95)], max: frames[frames.length - 1], gen: window.__perf.c['thumb:gen'] ?? 0, live: window.__perf.c['thumb:live'] ?? 0 };
    });
    check(Math.abs(m.h1 - m.h0) / m.h1 < 0.02, `el alto de la nota no salta al cargar las fotos (${m.h0} → ${m.h1} px)`);
    console.log(`    cuadros: ${m.n} · p50 ${m.p50.toFixed(1)} ms · p95 ${m.p95.toFixed(1)} ms · máx ${m.max.toFixed(1)} ms · miniaturas generadas ${m.gen} · URL vivas ${m.live}`);
    const nat = await page.evaluate(() => Math.max(...[...document.querySelectorAll('.doc img[data-media]')].map((i) => i.naturalWidth)));
    check(nat <= 1200, `ninguna imagen se muestra con su original (máx. ${nat} px de ancho)`);
    writeFileSync(OUT + 'np-30fotos.json', JSON.stringify({ browser: type.name(), ...m, maxNatural: nat }, null, 1));
    await ctx.close();
  }

  check(errors.length === 0, 'sin errores en consola' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log('\nOK');
} catch (e) {
  console.error('Errores de consola:', errors);
  for (const c of browser.contexts()) for (const [i, pg] of c.pages().entries()) await pg.screenshot({ path: OUT + `np-fallo-${i}.png` }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  server.kill();
}
