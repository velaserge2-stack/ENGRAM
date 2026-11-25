// Arranque del modo demo (`?demo=1`): app real con una bóveda 100 % en memoria. Se carga con import() solo si hay ?demo.
import { applyReview, newState, type LogEntry, type Rating, scheduler } from '../srs/engine';
import { loadCollection, REVIEWS } from '../data/collection';
import { stringifyFrontmatter } from '../lib/frontmatter';
import { addDays, dayKey } from '../lib/days';
import { serializeExam } from '../lib/exams';
import { exampleFiles } from '../lib/example';
import { defaultSettings, serializeSettings, SETTINGS_PATH, srsParams, type Settings } from '../lib/settings';
import { MemoryBackend } from '../vault/memory';
import { SafeVault } from '../vault/safe';
import type { OpenedVault } from '../vault/open';
import { t } from '../i18n';
import { DEMO_DECK } from './deck';
import { installGuard } from './guard';
import { demoOn, mem } from './state';

const HASHES = ['#/hoy', '#/estudiar', '#/notas', '#/estadisticas', '#/calendario', '#/simulacros'];
const DAY = 86_400_000;

const MAPA = `Corazón
- Cámaras
  - Aurículas
  - Ventrículos
- Válvulas
  - Mitral
  - Aórtica
- Conducción
  - Nodo SA
  - Nodo AV
  - Haz de His
`;

/** Repasos pasados con el motor real (misma programación que usaría la app); sin azar: el patrón de notas depende del índice. */
function simulate(ids: string[], params: ReturnType<typeof srsParams>, now: number, dayStartHour: number): string {
  ids = ids.slice(0, Math.ceil(ids.length * 0.8)); // el resto queda como tarjetas nuevas
  const f = scheduler(params), states = new Map(ids.map((id) => [id, newState(now - 45 * DAY)]));
  const out: LogEntry[] = [];
  // inicio del día de estudio vigente (antes de `dayStartHour` todavía es «ayer»): los repasos caen siempre en días anteriores
  const midnight = new Date(now); midnight.setHours(dayStartHour, 0, 0, 0);
  if (now < midnight.getTime()) midnight.setTime(midnight.getTime() - DAY);
  for (let d = 40, n = 0; d >= 1; d--) {
    const at0 = midnight.getTime() - d * DAY + 6 * 3_600_000;
    let fresh = 0, k = 0;
    for (const id of ids) {
      const st = states.get(id)!;
      const isNew = st.history.length === 0;
      if (isNew ? fresh >= 2 : st.card.due.getTime() > at0 + 6 * 3_600_000) continue;
      if (isNew) fresh++;
      const r: Rating = ((n * 7 + k * 3) % 11 === 0 ? 1 : (n + k) % 5 === 0 ? 2 : (n + k) % 4 === 0 ? 4 : 3) as Rating;
      out.push(applyReview(f, st, id, r, at0 + k * 40_000, 6000 + ((n * 13 + k * 7) % 9) * 1000));
      k++; n++;
    }
    // día sin nada vencido ni nuevo: repaso libre de la tarjeta más antigua (así hay racha, como en el uso real)
    if (!k && out.length) {
      const old = ids.filter((id) => states.get(id)!.history.length).sort((a, b) => states.get(a)!.card.last_review!.getTime() - states.get(b)!.card.last_review!.getTime())[0];
      if (old) out.push(applyReview(f, states.get(old)!, old, 3, at0, 7000));
    }
  }
  return out.map((e) => JSON.stringify(e)).join('\n') + (out.length ? '\n' : '');
}

export async function openDemo(): Promise<{ opened: OpenedVault; settings: Settings }> {
  demoOn();
  installGuard();
  const raw = new MemoryBackend();
  // la app avisa de «modo temporal» si el backend es de memoria: aquí es a propósito, sin ese aviso
  Object.defineProperty(raw, 'kind', { value: 'opfs' });
  const vault = new SafeVault(raw);
  const now = Date.now();
  const q = new URLSearchParams(location.search);
  const lang = q.get('lang'), theme = q.get('theme');
  const base = defaultSettings();
  const settings: Settings = {
    ...base,
    welcomeDone: true,
    lastExportAt: now,
    lang: lang === 'es' || lang === 'en' || lang === 'fr' ? lang : '',
    glassMode: theme === 'light' || theme === 'dark' ? theme : base.glassMode,
    addons: { assistant: true, ambient: false, inbox: false },
    chat: { ...base.chat, dock: 'barra' },
  };
  for (const f of await exampleFiles()) await vault.write(f.path, f.text);
  const today = dayKey(now, settings.timeZone, settings.dayStartHour);
  await vault.write('decks/Farmacología.md', DEMO_DECK);
  await vault.write('exams/Parcial de Cardiología.md', serializeExam({ path: '', name: 'Parcial de Cardiología', date: addDays(today, 21), topics: ['Cardiología', 'Neurología/EVC'], goal: 0.9, finalDays: 5, minPerDay: null, created: addDays(today, -14), notes: '' }));
  await vault.write('notes/Cardiología/Mapa del corazón.md', stringifyFrontmatter({ tipo: 'mapa' }, MAPA));
  // el primer cargado asigna los ids de tarjeta; con ellos se simula el historial
  const params = srsParams(settings);
  const col = await loadCollection(vault, params, now);
  await vault.write(REVIEWS, simulate([...col.byCid.keys()], params, now, settings.dayStartHour));
  await vault.write(SETTINGS_PATH, serializeSettings(settings));
  // claves y uso FALSOS, solo en memoria (ver chat/keys.ts y usage.ts)
  const prov = [['gemini', 'Gemini', 0.31], ['groq', 'Groq', 0.52], ['openrouter', 'OpenRouter', 0.12]] as const;
  mem.keys = { v: 1, keys: prov.map(([provider, alias], i) => ({ id: 'demo-' + provider, alias, provider, key: 'demo-000' + (i + 1), status: 'active' })) };
  const day = new Date(now).toISOString().slice(0, 10);
  mem.usage = { v: 1, perKey: Object.fromEntries(prov.map(([p, , f]) => ['demo-' + p, { day, req: Math.round(settings.chat.limits[p].rpd * f), tok: 0, min: { t: 0, req: 0, tok: 0 } }])) };
  return { opened: { vault, recovery: await vault.recover(), detail: 'demo', folderNeedsPermission: false }, settings };
}

/** Contrato con la página que lo muestra: solo estos mensajes, solo de `parent`, solo estas rutas. */
export function announce(): void {
  // el guardián de legibilidad avisa «Ajustamos el vidrio…» al pintar el fondo: en la demo es ruido
  const msg = t('app.ajustamos_el_vidrio_para_que_se');
  new MutationObserver(() => document.querySelectorAll<HTMLElement>('.toast').forEach((n) => n.textContent === msg && (n.style.display = 'none'))).observe(document.body, { childList: true, subtree: true });
  if (parent === window) return;
  const post = (m: object) => parent.postMessage(m, '*');
  addEventListener('hashchange', () => post({ type: 'engrama-demo:route', hash: location.hash }));
  addEventListener('message', (e) => {
    const d = e.data as { type?: unknown; hash?: unknown } | null;
    if (e.source !== parent || d?.type !== 'engrama-demo:go' || typeof d.hash !== 'string' || !HASHES.includes(d.hash)) return;
    location.hash = d.hash;
  });
  let tries = 0;
  const wait = () => (document.querySelector('.gx-pill') || ++tries > 120 ? post({ type: 'engrama-demo:ready' }) : requestAnimationFrame(wait));
  wait();
}
