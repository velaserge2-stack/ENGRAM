// Exámenes 2: examen real, falladas automáticas, distractores, comparar y preguntas de IA con revisión.
//   npm run build && node e2e/examenes2.mjs      (BROWSER=webkit|chromium)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { strToU8, zipSync } from 'fflate';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const PORT = Number(process.env.PORT) || 4181;
const URL_ = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('preview ' + c))); });
let kind = process.env.BROWSER || 'webkit';
let browser;
try { browser = await pw[kind].launch(); } catch { kind = 'chromium'; browser = await pw.chromium.launch(); }
console.log('Navegador:', kind);
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };

// mismo hash que `qid` de src/sim/parse.ts
const qid = (text, opts) => { let h = 0x811c9dc5; for (const ch of text + '|' + opts.join('|')) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193); return (h >>> 0).toString(36); };
const Q = [1, 2, 3, 4, 5, 6].map((i) => ({ id: '', n: i, case: '', text: `¿Pregunta ${i}?`, options: [{ key: 'A', text: `uno ${i}` }, { key: 'B', text: `dos ${i}` }, { key: 'C', text: `tres ${i}` }], answer: ['A'], explanation: `Porque ${i}`, topic: i <= 3 ? 'Alfa' : 'Beta', problems: [] }));
for (const q of Q) q.id = qid(q.case + q.text, q.options.map((o) => o.text));
const BANK = '---\nexamen: Banco E2E\nminutos: 30\n---\n' + Q.map((q) => `${q.n}. ${q.text}\n   ${q.options.map((o) => `${o.key}) ${o.text}`).join('\n   ')}\n   Respuesta: A\n   Explicación: ${q.explanation}\n   Tema: ${q.topic}\n`).join('\n');
const DAY = 86_400_000, now = Date.now();
const att = (id, daysAgo, ans) => ({ id, title: 'Banco E2E', banks: ['exams-bank/Banco E2E.md'], mode: 'sim', qs: Q.slice(0, 3).map((q) => ({ bank: 'exams-bank/Banco E2E.md', q, order: q.options.map((o) => o.key) })), answers: Object.fromEntries(Q.slice(0, 3).map((q, i) => [q.id, [ans[i]]])), checked: [], marked: [], startedAt: now - daysAgo * DAY, endAt: null, finishedAt: now - daysAgo * DAY + 600_000, elapsedMs: 600_000, perQ: {}, cur: 0, penalty: 0, pass: 0.6 });
const zip = zipSync({
  'exams-bank/Banco E2E.md': strToU8(BANK),
  '.app/exam-attempts.jsonl': strToU8([att('aaa1', 10, ['B', 'B', 'A']), att('bbb2', 9, ['B', 'A', 'A'])].map((a) => JSON.stringify(a)).join('\n') + '\n'),
}, { level: 0 });
const GEN = '1. ¿Pregunta nueva uno?\n   A) bien\n   B) mal\n   Respuesta: A\n   Explicación: porque sí\n   Tema: Alfa\n\n2. ¿Pregunta nueva dos?\n   A) igual\n   B) igual\n   Respuesta: A\n   Tema: Alfa\n';

try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, locale: 'es-MX' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const page = await ctx.newPage();
  await page.goto(URL_ + '?app');
  await page.getByRole('button', { name: 'Con bóveda de ejemplo' }).click();
  await page.getByRole('heading', { name: 'Hoy', level: 1 }).waitFor();
  await page.goto(URL_ + '?app#/mazos');
  await page.getByRole('button', { name: 'Importar archivo' }).click();
  await page.locator('.sheet input[type=file]').first().setInputFiles({ name: 'e2e.zip', mimeType: 'application/zip', buffer: Buffer.from(zip) });
  await page.locator('.sheet').getByRole('button', { name: 'Importar', exact: true }).click();
  await page.waitForTimeout(1000);
  for (let i = 0; i < 3 && (await page.locator('.scrim').count()); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(200); }
  await page.goto(URL_ + '?app#/simulacros');
  await page.locator('.attempt-row').first().waitFor();

  // falladas automáticas: solo la pregunta 1 (2 fallos seguidos, hace 9 días)
  const rep = page.getByRole('button', { name: /Repetir falladas \(1\)/ });
  check(await rep.isVisible(), '«Repetir falladas (1)»: solo la pregunta con fallos seguidos vencida');
  const rb = await rep.boundingBox();
  check(rb && rb.height >= 44, `botón ≥ 44 px (${rb?.height})`);
  await rep.click();
  await page.locator('.study-card').waitFor();
  check((await page.locator('.qnav button').count()) === 1, 'el intento tiene 1 pregunta');
  await page.goBack();

  // distractores y comparar en Resultados del último intento
  await page.goto(URL_ + '?app#/simulacros/resultado/bbb2');
  await page.getByRole('button', { name: 'Distractores' }).click();
  const dis = await page.locator('main, #app, body').first().innerText();
  check(/Atractivo/.test(dis), 'distractores: marca la opción atractiva');
  check(/Respondida 2 veces, 2 incorrectas/.test(dis), 'distractores: conteo de respuestas');
  await page.getByRole('button', { name: 'Comparar', exact: true }).click();
  const cmp = await page.locator('body').innerText();
  check(/De mal a bien/.test(cmp) && /¿Pregunta 2\?/.test(cmp), 'comparar: la pregunta 2 pasó de mal a bien');
  check(/0 → 0|33 % → 67 %/.test(cmp.replace(/\s+/g, ' ')) || /33 %/.test(cmp), 'comparar: puntajes de ambos intentos');

  // examen real
  await page.goto(URL_ + '?app#/simulacros');
  await page.getByRole('button', { name: 'Crear simulacro' }).click();
  await page.locator('.sheet').getByRole('button', { name: 'Examen real', exact: true }).click();
  check((await page.locator('.sheet').getByRole('group', { name: 'Modo' }).count()) === 0, 'examen real: sin selector de modo');
  await page.locator('.sheet').getByRole('button', { name: /^Empezar/ }).click();
  await page.locator('.study-card').waitFor();
  check((await page.getByRole('button', { name: 'Comprobar' }).count()) === 0, 'examen real: sin «Comprobar»');
  check((await page.locator('[role=timer]').count()) === 1, 'examen real: con cronómetro');
  check(/Examen real/.test(await page.locator('.study').first().innerText()), 'examen real: se indica en la cabecera');
  await page.locator('.opt').first().click();
  check(!(await page.locator('.opt.ok, .opt.bad').count()), 'examen real: sin retroalimentación al responder');
  await page.getByRole('button', { name: 'Terminar', exact: true }).first().click();
  await page.getByRole('button', { name: 'Terminar y ver resultados' }).click();
  await page.getByRole('heading', { name: 'Resultados' }).waitFor();
  await page.goto(URL_ + '?app#/simulacros/hacer');
  check(await page.getByText('No hay un simulacro en curso').isVisible(), 'examen real: al entregar no se puede reabrir');

  // IA: pegar → pendientes → revisar una por una
  await page.goto(URL_ + '?app#/simulacros');
  await page.getByRole('button', { name: 'Preguntas con IA: Banco E2E' }).click();
  const sheet = page.locator('.sheet');
  check(/Respuesta:/.test(await sheet.locator('textarea[readonly]').inputValue()), 'plantilla con el formato de banco');
  await sheet.locator('textarea:not([readonly])').fill(GEN);
  await sheet.getByRole('button', { name: 'Enviar a revisión' }).click();
  const pend = page.getByRole('button', { name: '2 pendientes de revisión' });
  await pend.waitFor();
  const listas = async () => Number(/(\d+) listas/.exec(await page.locator('.bank-row').first().innerText())?.[1]);
  check((await listas()) === 6, 'el banco sigue con 6 preguntas (nada entra sin revisar)');
  await pend.click();
  const ok = sheet.getByRole('button', { name: 'Aceptar y añadir al banco' });
  check(await ok.isDisabled(), 'Aceptar deshabilitado sin revisar');
  for (const n of ['Revisé la pregunta', 'Revisé la respuesta', 'Revisé la explicación']) await sheet.getByLabel(n).check();
  check(await ok.isEnabled(), 'Aceptar con las tres revisiones');
  await ok.click();
  await page.waitForTimeout(500);
  check(/Pregunta 2 de|Pregunta 1 de 1/.test(await sheet.innerText()) || /nueva dos/.test(await sheet.innerText()), 'pasa a la siguiente pendiente');
  check(/Falta la explicación/.test(await sheet.innerText()) && /repetidas/.test(await sheet.innerText()), 'la inválida muestra sus errores');
  check(await ok.isDisabled(), 'una pendiente con errores no se puede aceptar');
  await sheet.getByRole('button', { name: 'Descartar' }).click();
  await page.waitForTimeout(500);
  check((await listas()) === 7, 'el banco quedó con 7 (solo la aceptada)');
  check(!(await page.getByRole('button', { name: /pendientes de revisión/ }).count()), 'sin pendientes');

  if (failed) throw new Error(`${failed} comprobaciones fallaron`);
  console.log('OK');
  await ctx.close();
} catch (e) {
  console.error(e.message ?? e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
