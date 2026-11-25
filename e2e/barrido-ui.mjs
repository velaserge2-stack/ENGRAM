// Barrido UI: el área de toque de .btn.small, .btn.icon.small, button.chip y .tog llega a 44 px
// (se comprueba con elementFromPoint a 21 px del centro) y no hay scroll horizontal.
//   npm run build && node e2e/barrido-ui.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const PORT = Number(process.env.PORT) || 4191;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };
try {
  const page = await browser.newPage({ viewport: { width: 820, height: 1000 } });
  await page.goto(`http://localhost:${PORT}/?app`);
  await page.waitForSelector('.app');
  const res = await page.evaluate(() => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;display:flex;gap:60px;padding:60px;background:#fff';
    host.innerHTML = '<button class="btn small" id="a">Ok</button><button class="btn icon small" id="b">x</button><button class="chip" id="c">#tag ✕</button><button class="tog" id="d">▾</button>';
    document.body.append(host);
    const out = {};
    for (const id of ['a', 'b', 'c', 'd']) {
      const el = document.getElementById(id), r = el.getBoundingClientRect(), cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const hit = (x, y) => document.elementFromPoint(x, y) === el;
      out[id] = { vis: [Math.round(r.width), Math.round(r.height)], v: hit(cx, cy - 21) && hit(cx, cy + 21), h: hit(cx - 21, cy) && hit(cx + 21, cy) };
    }
    out.scroll = document.documentElement.scrollWidth <= document.documentElement.clientWidth;
    return out;
  });
  for (const id of ['a', 'b', 'c', 'd']) check(res[id].v && res[id].h, `área de toque ≥44 px en #${id} (aspecto ${res[id].vis.join('×')})`);
  check(res.scroll, 'sin scroll horizontal');
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
