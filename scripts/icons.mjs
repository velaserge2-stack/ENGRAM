// Genera los PNG de los íconos a partir de scripts/icon.svg (usa el Chromium de Playwright).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Playwright puede estar instalado globalmente (no es dependencia del proyecto)
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const svg = readFileSync(new URL('./icon.svg', import.meta.url), 'utf8');
const out = new URL('../public/icons/', import.meta.url).pathname;
const browser = await chromium.launch();
const page = await browser.newPage();
async function shot(size, name, inset = 0) {
  await page.setViewportSize({ width: size, height: size });
  // maskable: el contenido dentro del 80 % central; apple: cuadrado completo (iOS redondea)
  const inner = size * (1 - inset);
  await page.setContent(`<html><body style="margin:0;background:#0A84FF;display:grid;place-items:center;width:${size}px;height:${size}px">
    <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await page.screenshot({ path: out + name, omitBackground: false });
}
await shot(180, 'apple-touch-icon.png');
await shot(192, 'icon-192.png');
await shot(512, 'icon-512.png');
await shot(512, 'icon-maskable-512.png', 0.2);
await browser.close();
console.log('íconos generados');
