// Prompt 14 · 2.1: fixtures reproducibles de rendimiento (no tocan la app).
//   node scripts/note-fixtures.mjs  →  tests/fixtures/notes/
// - notas.zip: bóveda importable con N1 (500 bloques), N2 (3 000) y N3 (10 000) en notes/Perf/,
//   30 imágenes JPEG de 1–3 MP y 5 dibujos (media/dibujo-*.ink.json + .png).
// - img-{2,12,24,48}mp.{jpg,png}: imágenes de prueba (degradados y formas generados, sin derechos).
// Determinista: misma semilla → mismos textos. Las imágenes se codifican con el Chromium de Playwright.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { zipSync, strToU8 } from 'fflate';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const OUT = new URL('../tests/fixtures/notes/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

let seed = 14;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const WORDS = 'corazón válvula aorta presión ritmo sinusal onda P complejo QRS segmento ST isquemia infarto troponina diurético betabloqueador fracción eyección ventrículo aurícula soplo estenosis insuficiencia arritmia fibrilación flutter bloqueo rama derecha izquierda eje desviación hipertrofia pericarditis miocarditis endocarditis'.split(' ');
const sentence = (n) => Array.from({ length: n }, () => pick(WORDS)).join(' ');
const IMGS = Array.from({ length: 30 }, (_, i) => `perf-img-${String(i + 1).padStart(2, '0')}.jpg`);
const DRAWS = Array.from({ length: 5 }, (_, i) => `dibujo-perf${i + 1}`);

function block(i, n) {
  // reparte 30 imágenes, 5 dibujos y 3 consultas a lo largo de la nota
  const img = Math.floor((i * 30) / n), prevImg = Math.floor(((i - 1) * 30) / n);
  if (i > 0 && img !== prevImg) return `![[${IMGS[img - 1]}]]`;
  const dr = Math.floor((i * 5) / n), prevDr = Math.floor(((i - 1) * 5) / n);
  if (i > 0 && dr !== prevDr) return `![[${DRAWS[dr - 1]}.png]]`;
  if (i > 0 && i % Math.floor(n / 3) === 7) return '```query\nmateria:Perf\n```';
  if (i % 50 === 0) return `## Sección ${i / 50 + 1} · ${sentence(3)}`;
  switch (i % 7) {
    case 1: return `- ${sentence(6)}\n- ${sentence(5)} [[Nota ${i % 40}]]\n- ${sentence(7)}`;
    case 2: return `| Fármaco | Dosis | Nota |\n|---|---|---|\n| ${pick(WORDS)} | ${i} mg | ${sentence(3)} |\n| ${pick(WORDS)} | ${i * 2} mg | ==${sentence(2)}== |`;
    case 3: return `> [!note] ${sentence(2)}\n> ${sentence(12)}`;
    case 4: return `1. ${sentence(5)}\n2. ${sentence(6)}\n3. **${sentence(2)}** ${sentence(4)}`;
    default: return `${sentence(14)} **${pick(WORDS)}** ${sentence(10)} [[Cardiología ${i % 25}]] ${sentence(8)}.`;
  }
}
const note = (title, n) => `---\nmateria: Perf\ntema: Notas\n---\n# ${title}\n\n` + Array.from({ length: n }, (_, i) => block(i, n)).join('\n\n') + '\n';

const files = {};
for (const [t, n] of [['N1', 500], ['N2', 3000], ['N3', 10000]]) {
  files[`notes/Perf/Notas/${t}.md`] = strToU8(note(t, n));
  console.log(t, n, 'bloques,', Math.round(files[`notes/Perf/Notas/${t}.md`].length / 1024), 'KB');
}

const browser = await pw.chromium.launch();
const page = await browser.newPage();
/** Imagen de w×h codificada en el navegador: degradado + círculos (se comprime como una foto). */
const encode = (w, h, type, s) => page.evaluate(async ({ w, h, type, s }) => {
  const c = new OffscreenCanvas(w, h);
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${s * 37 % 360} 60% 70%)`);
  g.addColorStop(1, `hsl(${(s * 37 + 120) % 360} 50% 35%)`);
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) {
    x.fillStyle = `hsla(${(s * 13 + i * 29) % 360} 70% 55% / .5)`;
    x.beginPath();
    x.arc(((i * 97 + s * 31) % 100) / 100 * w, ((i * 53 + s * 17) % 100) / 100 * h, (5 + (i % 9)) / 100 * Math.min(w, h), 0, Math.PI * 2);
    x.fill();
  }
  x.fillStyle = '#fff';
  x.font = `${Math.round(h / 12)}px sans-serif`;
  x.fillText(`${w}×${h}`, w / 20, h / 6);
  const b = await c.convertToBlob({ type, quality: 0.85 });
  return await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(b); });
}, { w, h, type, s }).then((b64) => new Uint8Array(Buffer.from(b64, 'base64')));

for (let i = 0; i < 30; i++) {
  const mp = 1 + (i % 3); // 1, 2 o 3 MP
  const w = Math.round(Math.sqrt(mp * 1e6 * 4 / 3)), h = Math.round(w * 3 / 4);
  files[`media/${IMGS[i]}`] = await encode(w, h, 'image/jpeg', i);
}
for (let i = 0; i < 5; i++) {
  const strokes = Array.from({ length: 40 }, (_, k) => ({ id: `s${k}`, tool: 'pen', color: '#1c1c1e', size: 3, pts: Array.from({ length: 30 }, (_, j) => [0.05 + j * 0.03, 0.05 + (k % 10) * 0.035 + Math.sin(j / 3 + k) * 0.01, 0.5]) }));
  files[`media/${DRAWS[i]}.ink.json`] = strToU8(JSON.stringify({ v: 1, strokes, h: 0.45 }));
  files[`media/${DRAWS[i]}.png`] = await encode(1000, 450, 'image/png', 100 + i);
}
writeFileSync(OUT + 'notas.zip', zipSync(files, { level: 0 }));
console.log('notas.zip', Math.round(Object.values(files).reduce((a, b) => a + b.length, 0) / 1048576), 'MB');

for (const mp of [2, 12, 24, 48]) {
  const w = Math.round(Math.sqrt(mp * 1e6 * 4 / 3)), h = Math.round(w * 3 / 4);
  for (const [ext, type] of [['jpg', 'image/jpeg'], ['png', 'image/png']]) {
    const b = await encode(w, h, type, mp);
    writeFileSync(`${OUT}img-${mp}mp.${ext}`, b);
    console.log(`img-${mp}mp.${ext}`, `${w}×${h}`, Math.round(b.length / 1048576 * 10) / 10, 'MB');
  }
}
await browser.close();
