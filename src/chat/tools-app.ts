// Ajustes de la app desde el Asistente: catálogo CERRADO de rutas. Solo PROPONE (vista previa «antes → después», Aceptar, deshacer);
// la interfaz aplica con el mismo `app.update(...)` que usa Ajustes. Valida aplicando el parche a `mergeSettings` (sin tocar settings.ts).
import { jsonSchema, tool, type ToolSet } from 'ai';
import { setKeys } from '../lib/frontmatter';
import { mergeSettings, type Settings } from '../lib/settings';
import { readTextOr } from '../vault/util';
import { editProposal } from './tools-edit';
import { pick } from './delete';
import { isBad, type Bad, type Proposal } from './proposal';
import type { WriteCtx } from './tools-write';

type Val = string | number | boolean | null | undefined;
interface Entry { ruta: string; label: string; tipo: 'int' | 'num' | 'bool' | 'enum' | 'color'; min?: number; max?: number; valores?: readonly string[]; unidad?: string; get: (s: Settings) => Val; patch: (s: Settings, v: Val) => Partial<Settings> }
const pomo = (k: keyof Settings['pomo'], label: string, min: number, max: number, unidad = 'min'): Entry => ({ ruta: `pomo.${k}`, label: `Pomodoro · ${label}`, tipo: 'int', min, max, unidad, get: (s) => s.pomo[k] as number, patch: (s, v) => ({ pomo: { ...s.pomo, [k]: v as number } }) });
const top = (ruta: string, k: keyof Settings, label: string, tipo: 'int' | 'num', min: number, max: number, unidad = ''): Entry => ({ ruta, label, tipo, min, max, unidad, get: (s) => s[k] as number, patch: (_s, v) => ({ [k]: v }) as Partial<Settings> });
const flag = (ruta: string, k: keyof Settings, label: string): Entry => ({ ruta, label, tipo: 'bool', get: (s) => s[k] as boolean, patch: (_s, v) => ({ [k]: v }) as Partial<Settings> });

/** Todo lo que el Asistente puede cambiar. Nada de claves, almacenamiento, respaldo, borrado ni del propio Asistente (salvo el add-on, con confirmación). */
export const CATALOG: readonly Entry[] = [
  pomo('work', 'trabajo', 1, 180), pomo('short', 'descanso corto', 1, 60), pomo('long', 'descanso largo', 1, 120), pomo('every', 'sesiones hasta el descanso largo', 1, 12, ''),
  { ruta: 'pomo.sound', label: 'Pomodoro · sonido', tipo: 'bool', get: (s) => s.pomo.sound, patch: (s, v) => ({ pomo: { ...s.pomo, sound: v as boolean } }) },
  { ruta: 'tema', label: 'Tema', tipo: 'enum', valores: ['auto', 'dark', 'light'], get: (s) => s.glassMode, patch: (_s, v) => ({ glassMode: v as Settings['glassMode'] }) },
  { ruta: 'idioma', label: 'Idioma', tipo: 'enum', valores: ['', 'es', 'en', 'fr'], get: (s) => s.lang, patch: (_s, v) => ({ lang: v as Settings['lang'] }) },
  { ruta: 'acento', label: 'Acento', tipo: 'color', get: (s) => s.accent.color, patch: (s, v) => ({ accent: { ...s.accent, color: (v as string | null) || null } }) },
  top('vidrio', 'glass', 'Intensidad del vidrio', 'int', 0, 100, '%'), flag('modo_ligero', 'lightMode', 'Modo ligero (sin desenfoque)'),
  top('fondo.desenfoque', 'bgBlur', 'Desenfoque del fondo', 'int', 0, 40), top('fondo.brillo', 'bgDim', 'Brillo del fondo', 'int', -50, 50), top('texto.escala', 'textScale', 'Tamaño del texto', 'num', 0.8, 1.6),
  top('nuevas_por_dia', 'newPerDay', 'Tarjetas nuevas al día', 'int', 0, 9999), top('repasos_por_dia', 'reviewLimit', 'Repasos máximos al día', 'int', 0, 99999),
  top('retencion', 'retention', 'Retención deseada', 'num', 0.7, 0.99), top('intervalo_maximo', 'maxInterval', 'Intervalo máximo', 'int', 1, 36500, 'días'), top('umbral_sanguijuela', 'leechThreshold', 'Fallos para marcar sanguijuela', 'int', 1, 99, ''),
  top('dia.inicia', 'dayStartHour', 'Hora en que empieza el día de estudio', 'int', 0, 23, 'h'), flag('semana.lunes', 'weekStartsMonday', 'La semana empieza en lunes'), top('racha.minimo', 'streakMin', 'Tarjetas mínimas para la racha', 'int', 1, 999, ''),
  top('respaldo.recordatorio_dias', 'backupReminderDays', 'Recordatorio de respaldo cada', 'int', 1, 365, 'días'), top('papelera.dias', 'deckTrashDays', 'Días en la papelera de mazos', 'int', 0, 365, 'días'),
  flag('mostrar.grafo', 'showGraph', 'Mostrar el grafo de notas'), flag('mostrar.enlaces_entrantes', 'showBacklinks', 'Mostrar enlaces entrantes'),
];
const ADDON = /^addon\.([\w-]{1,40})$/;
const DECK_NEW = 'mazo.nuevas_por_dia';

/** Todas las rutas válidas (el catálogo más un `addon.<id>` por add-on conocido). */
const addonEntry = (id: string): Entry => ({ ruta: `addon.${id}`, label: `Add-on «${id}»`, tipo: 'bool', get: (s) => s.addons[id], patch: (s, v) => { const a = { ...s.addons }; if (v === undefined) delete a[id]; else a[id] = v as boolean; return { addons: a }; } });
export function entryOf(ruta: string, addons: readonly string[]): Entry | null {
  const m = ADDON.exec(ruta);
  if (m) return addons.includes(m[1]!) ? addonEntry(m[1]!) : null;
  return CATALOG.find((e) => e.ruta === ruta) ?? null;
}

const show = (e: Entry, v: Val) => (v === undefined || v === null || v === '' ? (e.tipo === 'enum' || e.tipo === 'color' ? 'auto' : '—') : typeof v === 'boolean' ? (v ? 'sí' : 'no') : `${v}${e.unidad ? ' ' + e.unidad : ''}`);
const coerce = (e: Entry, raw: unknown): Val | Bad => {
  if (e.tipo === 'bool') return typeof raw === 'boolean' ? raw : raw === 'true' || raw === 'sí' || raw === 'on' ? true : raw === 'false' || raw === 'no' || raw === 'off' ? false : { error: 'valor', detail: 'Debe ser true o false.' };
  if (e.tipo === 'enum') { const v = raw === 'auto' && e.ruta === 'idioma' ? '' : String(raw ?? ''); return e.valores!.includes(v) ? v : { error: 'valor', detail: `Valores: ${e.valores!.map((x) => x || 'auto').join(', ')}` }; }
  if (e.tipo === 'color') { const v = String(raw ?? '').trim().toLowerCase(); return v === '' || v === 'ninguno' || v === 'null' ? null : /^#[0-9a-f]{6}$/.test(v) ? v : { error: 'valor', detail: 'Color #rrggbb o «ninguno».' }; }
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) return { error: 'valor', detail: 'Debe ser un número.' };
  if (n < e.min! || n > e.max!) return { error: 'rango', detail: `Entre ${e.min} y ${e.max}.` };
  return e.tipo === 'int' ? Math.round(n) : n;
};

/** Propuesta de cambio de un ajuste: valida aplicando el parche con `mergeSettings` (si se normaliza distinto, lo dice). */
export function buildSetting(s: Settings, addons: readonly string[], ruta: string, valor: unknown): Proposal | Bad {
  const e = entryOf(String(ruta ?? ''), addons);
  if (!e) return { error: 'noexiste', detail: 'Esa ruta no está en el catálogo (usa listar_ajustes).' };
  const v = coerce(e, valor);
  if (isBad(v)) return v;
  const after = e.get(mergeSettings({ ...s, ...e.patch(s, v) })), before = e.get(s);
  if (after === before) return { error: 'igual', detail: 'Ya tiene ese valor.' };
  const aviso = after !== v ? ` (quedó en ${show(e, after)})` : '';
  const text = `${e.label}: ${show(e, before)} → ${show(e, after)}${aviso}`;
  return { tipo: 'ajuste', destino: 'settings', contenido: '', resumen: text, items: [text], reversible: true, ajuste: { ruta: e.ruta, antes: before, despues: after } };
}

type App = { settings: Settings; update: (p: Partial<Settings>) => void };
/** Lo llama la interfaz tras «Aceptar» (despues) o «Deshacer» (antes): el mismo `app.update` de Ajustes. */
export function applySetting(app: App, addons: readonly string[], p: Proposal, undo = false): void {
  const a = p.ajuste, e = a && entryOf(a.ruta, addons);
  if (!a || !e) throw new Error('path');
  app.update(e.patch(app.settings, (undo ? a.antes : a.despues) as Val));
}

export const addonIds = async (): Promise<string[]> => (await import('../screens/addons')).MODULES().map((m) => m.id);
export const SCREENS = ['hoy', 'mazos', 'estudiar', 'estadisticas', 'calendario', 'notas', 'espacios', 'simulacros', 'pdfs', 'perfil', 'ajustes'] as const;
const str = { type: 'string' } as const;

export interface AppDeps { settings: Settings; addons: () => Promise<string[]> | string[]; go: (screen: string) => void }
export function makeAppTools(ctx: WriteCtx, deps: AppDeps): ToolSet {
  let n = 0;
  const NO = { error: 'El usuario no pidió cambiar nada: no se propone nada.' };
  const out = (p: Proposal | Bad) => {
    if (isBad(p)) return { error: `No válido (${p.error}${p.detail ? ': ' + p.detail : ''}).` };
    if (n >= 3) return { error: 'Límite alcanzado: ya hay 3 propuestas en este turno.' };
    n++; ctx.propose(p);
    return { estado: 'PROPUESTA mostrada al usuario; no se ha cambiado nada hasta que pulse Aceptar.', resumen: p.resumen };
  };
  return {
    listar_ajustes: tool({
      description: 'Lista los ajustes que puedes proponer cambiar (ruta, tipo, rango y valor actual), más `addon.<id>` y `mazo.nuevas_por_dia`.',
      inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
      execute: async () => ({
        ajustes: [...CATALOG, ...(await deps.addons()).map(addonEntry)].map((e) => ({ ruta: e.ruta, tipo: e.tipo, ...(e.min !== undefined ? { min: e.min, max: e.max } : {}), ...(e.valores ? { valores: e.valores.map((x) => x || 'auto') } : {}), actual: e.get(deps.settings) ?? null })),
        mazo: { ruta: DECK_NEW, nota: 'cambiar_ajuste con `mazo` = nombre del mazo' },
      }),
    }),
    cambiar_ajuste: tool({
      description: 'Propone cambiar UN ajuste de la app (p. ej. pomo.work=40, tema=dark, idioma=en, addon.tasks=true, nuevas_por_dia=20; con ruta mazo.nuevas_por_dia y `mazo`, el límite de nuevas de ese mazo). No cambia nada: el usuario acepta y puede deshacer. Apagar addon.assistant exige confirmo=true tras preguntárselo.',
      inputSchema: jsonSchema<{ ruta: string; valor: string | number | boolean; mazo?: string; confirmo?: boolean }>({ type: 'object', properties: { ruta: str, valor: { type: ['string', 'number', 'boolean'] }, mazo: str, confirmo: { type: 'boolean' } }, required: ['ruta', 'valor'], additionalProperties: false }),
      execute: async ({ ruta, valor, mazo, confirmo }) => {
        if (!ctx.allowed()) return NO;
        if (ruta === DECK_NEW) {
          const d = ctx.col ? pick(ctx.col.decks.map((x) => ({ key: x.path, names: [x.full, x.name, x.path], label: x.full })), String(mazo ?? '')) : ({ error: 'noexiste' } as Bad);
          if ('error' in d) return out(d);
          const v = Number(valor);
          if (!Number.isInteger(v) || v < 0 || v > 9999) return out({ error: 'rango', detail: 'Entero entre 0 y 9999.' });
          const text = await readTextOr(ctx.vault, d.key, '');
          const next = setKeys(text, { new_per_day: v });
          return out(editProposal(d.key, text, next, `Nuevas al día en ${d.label}: ${ctx.col!.decks.find((x) => x.path === d.key)?.newPerDay ?? 'general'} → ${v}`));
        }
        if (ruta === 'addon.assistant' && !(valor === true || valor === 'true') && confirmo !== true) return { error: 'Apagar el Asistente exige confirmación explícita: pregúntale al usuario y, si dice que sí, vuelve a llamar con confirmo=true.' };
        return out(buildSetting(deps.settings, await deps.addons(), ruta, valor));
      },
    }),
    ir_a: tool({
      description: 'Abre una pantalla de la app (solo navega).',
      inputSchema: jsonSchema<{ pantalla: string }>({ type: 'object', properties: { pantalla: { type: 'string', enum: [...SCREENS] } }, required: ['pantalla'], additionalProperties: false }),
      execute: async ({ pantalla }) => {
        if (!ctx.allowed()) return NO;
        if (!(SCREENS as readonly string[]).includes(pantalla)) return { error: 'Pantalla desconocida.' };
        deps.go(pantalla);
        return { estado: `Abierta: ${pantalla}` };
      },
    }),
  };
}
