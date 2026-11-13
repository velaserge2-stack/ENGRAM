// Prompt 21 · Fase 0: bóvedas sintéticas reproducibles para medir rendimiento.
//   node scripts/vault-gen.mjs [S|M|L ...]        (sin argumentos: las tres + extras)
// Salida (en .gitignore): tests/fixtures/rendimiento/
//   S.zip M.zip L.zip   bóvedas en formato Engrama, importables con «Importar archivo»
//   reviews-100k.jsonl  100 000 repasos coherentes para FSRS (ids de tarjetas de L)
//   files500.zip        500 archivos sueltos (notas + imágenes) para medir la importación
//   big-notes.zip       notas de 1 MB y 5 MB
//   apkg-5000.apkg      5 000 tarjetas (solo si hay un Python con `anki`: ANKI_PY=/ruta/python)
// Semilla fija (SEED) y fecha base (BASE, por defecto hoy 00:00 UTC): mismas entradas → mismos bytes.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const { zipSync, strToU8 } = require('fflate');
const OUT = new URL('../tests/fixtures/rendimiento/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const SEED = Number(process.env.SEED) || 20261113;
const DAY = 86_400_000;
const BASE = process.env.BASE ? Date.parse(process.env.BASE) : Math.floor(Date.now() / DAY) * DAY;

/** mulberry32 */
function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

const SIZES = { S: { cards: 500, notes: 100, images: 20, decks: 10 }, M: { cards: 5000, notes: 500, images: 200, decks: 40 }, L: { cards: 20000, notes: 2000, images: 500, decks: 100 } };
const MATERIAS = ['Cardiología', 'Neumología', 'Nefrología', 'Farmacología', 'Anatomía', 'Fisiología', 'Pediatría', 'Neurología', 'Infectología', 'Endocrinología'];
const WORDS = 'ritmo onda segmento derivación pared inferior arteria ventrículo aurícula bloqueo presión volumen gasto frecuencia fármaco dosis receptor canal iones sodio potasio calcio túbulo glomérulo filtrado hormona insulina tiroides cortisol sinapsis neurona mielina corteza cerebelo bacteria virus antibiótico resistencia vacuna'.split(' ');
const sentence = (r, n) => Array.from({ length: n }, () => pick(r, WORDS)).join(' ');

/** PNG RGB w×h con ruido suave (real, decodificable; ~w·h·3 bytes comprimidos a la mitad). */
function png(r, w = 48, h = 48) {
  const crc = (buf) => { let c, n = ~0; for (const b of buf) { c = (n ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; n = (n >>> 8) ^ c; } return ~n >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const [r0, g0, b0] = [int(r, 0, 255), int(r, 0, 255), int(r, 0, 255)];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (r0 + x * 3 + int(r, 0, 20)) & 255; raw[o + 1] = (g0 + y * 3 + int(r, 0, 20)) & 255; raw[o + 2] = (b0 + x + y + int(r, 0, 20)) & 255; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const b36 = (n) => n.toString(36).padStart(4, '0');

/** Un mazo: texto + los ids de tarjeta (cid) que produce. Tipos: básica, reversa (2 tarjetas), cloze. */
function deckText(r, name, n, start) {
  const cids = [];
  const parts = [`---\ndeck: ${name}\n---\n`];
  let i = start, made = 0;
  while (made < n) {
    const id = 'c' + b36(i++);
    const k = r();
    if (k < 0.6 || n - made < 2) { parts.push(`Q:: ¿${sentence(r, 6)}?\nA:: ${sentence(r, 8)} ^${id}\n`); cids.push(id); made++; }
    else if (k < 0.8) { parts.push(`QR:: ${sentence(r, 4)}\nA:: ${sentence(r, 4)} ^${id}\n`); cids.push(id, id + ':r'); made += 2; }
    else { parts.push(`Cloze: La {{c1::${pick(r, WORDS)}}} se relaciona con {{c2::${pick(r, WORDS)}}} y ${sentence(r, 4)}. ^${id}\n`); cids.push(id + ':c1', id + ':c2'); made += 2; }
  }
  return { text: parts.join('\n'), cids };
}

/** Historial FSRS coherente: por tarjeta 1–8 repasos con intervalos crecientes; el último, entre hace 0 y 40 días. */
function reviewsFor(r, cids, target) {
  const out = [];
  const pool = cids.slice();
  // se barajan (determinista) y se reparte hasta `target` líneas
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  for (const id of pool) {
    if (out.length >= target) break;
    const n = int(r, 1, 8);
    const gaps = []; let g = 0;
    for (let k = 0; k < n; k++) { g = k === 0 ? 0 : Math.max(1, Math.round((g || 1) * (1.5 + r() * 2.5))); gaps.push(g); }
    const total = gaps.reduce((a, b) => a + b, 0);
    let ts = BASE - (total + int(r, 0, 40)) * DAY + int(r, 8, 20) * 3_600_000;
    for (let k = 0; k < n; k++) {
      ts += gaps[k] * DAY + int(r, 0, 3_600_000);
      if (ts > BASE) break;
      out.push(JSON.stringify({ id, ts, rating: r() < 0.12 ? 1 : r() < 0.2 ? 2 : r() < 0.85 ? 3 : 4, ms: int(r, 2500, 40000) }));
    }
  }
  return out;
}

function noteText(r, i, titles, imgs) {
  const mat = MATERIAS[i % MATERIAS.length];
  const links = Array.from({ length: int(r, 1, 4) }, () => `[[${pick(r, titles)}]]`).join(', ');
  const img = imgs.length && r() < 0.3 ? `\n![[${pick(r, imgs)}|300]]\n` : '';
  const lines = [`---\nmateria: ${mat}\ntema: Tema ${1 + (i % 7)}\nfecha: 2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')}\ntags: [${pick(r, WORDS)}]\n---\n`, `# ${titles[i]}\n`, `Resumen: **${sentence(r, 5)}** y *${sentence(r, 3)}*. Ver ${links}.\n`];
  for (let s = 0; s < int(r, 2, 6); s++) {
    lines.push(`## ${sentence(r, 3)}\n`, `${sentence(r, int(r, 25, 70))}.\n`, ...Array.from({ length: int(r, 2, 5) }, () => `- ${sentence(r, 6)}`), '');
  }
  lines.push('| Dato | Valor |\n|---|---|\n' + Array.from({ length: 3 }, () => `| ${pick(r, WORDS)} | ${int(r, 1, 99)} |`).join('\n'), img);
  return lines.join('\n');
}

/** Nota de ~`bytes` bytes (párrafos, listas, tabla y enlaces). */
function bigNote(r, title, bytes) {
  const out = [`---\nmateria: Grandes\ntema: Rendimiento\nfecha: 2026-01-01\ntags: []\n---\n`, `# ${title}\n`];
  let n = out.join('\n').length, k = 0;
  while (n < bytes) {
    const blk = `## Sección ${++k}\n\n${sentence(r, 80)}. Ver [[Nota 1]] y [[Nota 2]].\n\n- ${sentence(r, 8)}\n- ${sentence(r, 8)}\n\n`;
    out.push(blk); n += blk.length;
  }
  return out.join('\n');
}

function build(name) {
  const sz = SIZES[name];
  const r = prng(SEED + name.charCodeAt(0));
  const files = {};
  const allCids = [];
  // un mazo grande de 5 000 tarjetas para «mover un mazo» (en M y L); el resto se reparte
  const big = sz.cards >= 5000 ? 5000 : 0;
  const rest = sz.cards - big;
  let start = 0;
  const mk = (path, nm, n) => { const d = deckText(r, nm, n, start); start += n; files[path] = strToU8(d.text); allCids.push(...d.cids); };
  for (let d = 0; d < sz.decks; d++) { const mat = MATERIAS[d % MATERIAS.length]; mk(`decks/${mat}/Mazo ${d + 1}.md`, `Mazo ${d + 1}`, Math.round(rest / sz.decks)); }
  if (big) mk('decks/Rendimiento/Grande.md', 'Grande', big);
  // imágenes
  const imgs = [];
  for (let i = 0; i < sz.images; i++) { const n = `img-${String(i).padStart(4, '0')}.png`; files['media/' + n] = png(r); imgs.push(n); }
  // notas; en M y L, 100 en notes/Lote/ para «mover 100 notas»
  const titles = Array.from({ length: sz.notes }, (_, i) => `Nota ${i + 1}`);
  const lote = sz.notes >= 500 ? 100 : 0;
  for (let i = 0; i < sz.notes; i++) {
    const folder = i < lote ? 'Lote' : MATERIAS[i % MATERIAS.length] + '/Tema ' + (1 + (i % 7));
    files[`notes/${folder}/${titles[i]}.md`] = strToU8(noteText(r, i, titles, imgs));
  }
  // historial: ~60 % de las tarjetas con repasos (para L ~ 12 000 tarjetas × 3.5)
  const target = Math.round(sz.cards * 0.6 * 4.5);
  files['.app/reviews.jsonl'] = strToU8(reviewsFor(r, allCids, target).join('\n') + '\n');
  if (name === 'L') for (const p of ['p50.pdf', 'p300.pdf']) {
    const f = new URL(`../tests/fixtures/perf/${p}`, import.meta.url).pathname;
    if (existsSync(f)) files[`docs/${p}`] = new Uint8Array(readFileSync(f));
    else console.warn(`  (sin ${p}: node scripts/perf-fixtures.mjs)`);
  }
  if (name === 'L' && files['docs/p50.pdf']) files['docs/p50b.pdf'] = files['docs/p50.pdf']; // 3.º PDF (copia)
  const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: /\.(png|pdf)$/.test(k) ? 0 : 6 }]])), { level: 6 });
  writeFileSync(OUT + name + '.zip', zip);
  console.log(`${name}.zip: ${Object.keys(files).length} archivos, ${(zip.length / 1048576).toFixed(1)} MB, ${allCids.length} tarjetas, ${files['.app/reviews.jsonl'].length} B de historial`);
  return allCids;
}

const want = process.argv.slice(2).filter((a) => SIZES[a]);
const sizes = want.length ? want : ['S', 'M', 'L'];
let lcids = null;
for (const s of sizes) { const c = build(s); if (s === 'L') lcids = c; }
if (!want.length || want.includes('L')) {
  // 100 000 líneas para FSRS (ids de L)
  const r = prng(SEED + 7);
  const lines = [];
  let guard = 0;
  while (lines.length < 100_000 && guard++ < 20) lines.push(...reviewsFor(r, lcids, 100_000 - lines.length));
  writeFileSync(OUT + 'reviews-100k.jsonl', lines.slice(0, 100_000).join('\n') + '\n');
  console.log(`reviews-100k.jsonl: ${Math.min(lines.length, 100_000)} líneas`);
}
if (!want.length) {
  const r = prng(SEED + 11);
  const f = {};
  for (let i = 0; i < 500; i++) f[i % 10 === 0 ? `media/arch-${i}.png` : `notes/Importadas/Arch ${i}.md`] = i % 10 === 0 ? png(r) : strToU8(`# Arch ${i}\n\n${sentence(r, 60)}. Ver [[Arch ${(i + 1) % 500}]].\n`);
  writeFileSync(OUT + 'files500.zip', zipSync(f, { level: 6 }));
  console.log('files500.zip: 500 archivos');
  writeFileSync(OUT + 'big-notes.zip', zipSync({ 'notes/Grandes/Nota 1 MB.md': strToU8(bigNote(r, 'Nota 1 MB', 1_000_000)), 'notes/Grandes/Nota 5 MB.md': strToU8(bigNote(r, 'Nota 5 MB', 5_000_000)) }, { level: 6 }));
  console.log('big-notes.zip: 1 MB y 5 MB');
  const py = process.env.ANKI_PY || '/tmp/venv/bin/python';
  if (existsSync(py)) {
    try { execFileSync(py, ['-I', new URL('./vault-gen-apkg.py', import.meta.url).pathname, OUT + 'apkg-5000.apkg', String(SEED)], { stdio: 'inherit' }); }
    catch { console.warn('apkg-5000.apkg: no se pudo generar (¿falta `pip install anki`?)'); }
  } else console.warn('apkg-5000.apkg omitido: sin Python con `anki` (ANKI_PY)');
}
