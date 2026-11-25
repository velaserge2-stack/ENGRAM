// Rol Analista: herramientas de lectura y `aplicar_objetivos` ejecutadas en el navegador real (módulos del servidor de desarrollo,
// bóveda en memoria, sin red). El cableado en turn.ts es de otro carril: aquí se prueba la capa de herramientas y propuestas.
//   flock /tmp/e2e.lock node e2e/analista.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const PORT = Number(process.env.PORT) || 4197;
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((res, rej) => { server.stdout.on('data', (d) => String(d).includes('localhost') && res()); server.on('exit', (c) => rej(new Error('vite ' + c))); });
let type = pw[process.env.BROWSER || 'webkit'];
let browser;
try { browser = await type.launch(); } catch { type = pw.chromium; browser = await type.launch(); }
console.log('Navegador:', type.name());
let failed = 0;
const check = (c, m) => { if (!c) failed++; console.log(c ? '  ✓' : '  ✗', m); };
try {
  const page = await (await browser.newContext()).newPage();
  const hits = [];
  page.on('request', (r) => { if (!r.url().startsWith(`http://localhost:${PORT}`) && /^https?:/.test(r.url())) hits.push(r.url()); });
  page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 300)));
  await page.goto(`http://localhost:${PORT}/?app`);
  const r = await page.evaluate(async () => {
    const [{ MemoryBackend }, { SafeVault }, { loadCollection }, { DEFAULT_PARAMS }, tools, prop] = await Promise.all([
      import('/src/vault/memory.ts'), import('/src/vault/safe.ts'), import('/src/data/collection.ts'), import('/src/srs/engine.ts'),
      import('/src/chat/tools-analytics.ts'), import('/src/chat/proposal.ts'),
    ]);
    const P = { ...DEFAULT_PARAMS, fuzz: false };
    const v = new SafeVault(new MemoryBackend());
    const enc = (s) => new TextEncoder().encode(s);
    await v.write('decks/a.md', enc('---\ndeck: Med/A\n---\n' + [1, 2, 3, 4, 5, 6].map((i) => `Q:: P${i}\nA:: R${i} ^c${i}`).join('\n\n') + '\n'));
    const col = await loadCollection(v, P, Date.now());
    const got = [];
    const ctx = { vault: v, col, today: '2026-03-01', sources: [], allowed: () => true, propose: (p) => got.push(p), params: P, goal: { newPerDay: 3, reviewLimit: 200, tz: 'UTC', dayStartHour: 0 } };
    const t = tools.makeAnalyticsTools(ctx);
    const call = (n, i = {}) => t[n].execute(i, { toolCallId: 'x', messages: [] });
    const names = Object.keys(t);
    const plan = await call('plan_de_repaso'), goals = await call('objetivos_hoy');
    const before = new TextDecoder().decode(await v.read('decks/a.md'));
    await call('aplicar_objetivos');
    const mid = new TextDecoder().decode(await v.read('decks/a.md'));
    await prop.applyProposal(v, col, got[0], 1);
    const applied = new TextDecoder().decode(await v.read('decks/a.md'));
    await prop.undoProposal(v, 1);
    const undone = new TextDecoder().decode(await v.read('decks/a.md'));
    return { names, plan, goals, before, mid, applied, undone, n: got.length };
  });
  check(r.names.length === 8, '8 herramientas');
  check(Array.isArray(r.plan.acciones ?? []) || r.plan.vacio, 'plan_de_repaso responde');
  check(r.goals.mazos?.[0]?.objetivo === 2, 'objetivos_hoy: objetivo base = 2');
  check(r.n === 1 && r.mid === r.before, 'aplicar_objetivos propone sin escribir');
  check(/new_per_day: 2\n/.test(r.applied), 'Aceptar escribe new_per_day');
  check(r.undone === r.before, 'Deshacer restaura exacto');
  check(hits.length === 0, 'sin peticiones de red: ' + hits.join(','));
} catch (e) { failed++; console.log('ERROR', e); }
await browser.close();
server.kill();
process.exit(failed ? 1 : 0);
