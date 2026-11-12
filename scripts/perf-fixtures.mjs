// PDF de prueba para medir rendimiento (Prompt 11): 50, 300 y 800 páginas con texto real e
// imágenes grandes (ruido incompresible), hasta ~100 MB. Contenido sintético, sin derechos.
//   node scripts/perf-fixtures.mjs      → tests/fixtures/perf/{p50,p300,p800}.pdf (en .gitignore)
import { randomFillSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const OUT = new URL('../tests/fixtures/perf/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/** PNG RGB de W×H con ruido (no se comprime: cada imagen pesa ~W·H·3 bytes). */
function noisePng(w, h, seed) {
  const crc = (buf) => { let c, n = ~0; for (const b of buf) { c = (n ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; n = (n >>> 8) ^ c; } return ~n >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  randomFillSync(raw);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0; // filtro «none»
  raw[1] = seed & 255;
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}

for (const [pages, images] of [[50, 10], [300, 40], [800, 100]]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const imgs = [];
  for (let i = 0; i < images; i++) imgs.push(await pdf.embedPng(noisePng(640, 520, i)));
  for (let p = 1; p <= pages; p++) {
    const pg = pdf.addPage([595, 842]);
    pg.drawText(`Pagina ${p} de ${pages}`, { x: 60, y: 790, size: 18, font });
    for (let l = 0; l < 18; l++) pg.drawText(`Linea ${l + 1}: la fibrilacion auricular no tiene ondas P y el ritmo es irregular (${p}).`, { x: 60, y: 760 - l * 16, size: 10, font });
    const im = imgs[p % images];
    pg.drawImage(im, { x: 60, y: 60, width: 475, height: 386 });
  }
  const bytes = await pdf.save({ useObjectStreams: true });
  writeFileSync(`${OUT}p${pages}.pdf`, bytes);
  console.log(`p${pages}.pdf: ${pages} págs, ${(bytes.length / 1048576).toFixed(1)} MB`);
}
