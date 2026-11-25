// Ajustes de la app desde el Asistente: catálogo CERRADO de rutas (todo lo modificable de Settings salvo claves, almacenamiento, respaldo
// y borrado). Solo PROPONE: una propuesta con una línea «antes → después» por cambio, un Aceptar y un Deshacer; la interfaz aplica con el
// mismo `app.update(...)` de Ajustes. Valida aplicando el parche a `mergeSettings` (sin tocar settings.ts).
import { jsonSchema, tool, type ToolSet } from 'ai';
import { t } from '../i18n';
import { ACTIONS } from '../lib/keys';
import { SOUNDS } from '../lib/noise';
import { accentVariant, COLOR_NAMES, resolveColor } from '../lib/palette';
import { ACCENT_USES, mergeSettings, type AccentUse, type Settings } from '../lib/settings';
import { setKeys } from '../lib/frontmatter';
import { readTextOr } from '../vault/util';
import { editProposal } from './tools-edit';
import { pick } from './delete';
import { isBad, MAX_PROPOSALS, MAX_TURN, turnCount, type Bad, type Proposal } from './proposal';
import type { WriteCtx } from './tools-write';

type Val = string | number | boolean | null | undefined;
/** Listas que dependen de la app en ejecución (add-ons, fondos integrados, fondos guardados). */
export interface Lists { addons: string[]; builtins: string[]; fondos: string[] }
interface Entry { ruta: string; label: string; tipo: 'int' | 'num' | 'bool' | 'enum' | 'color' | 'texto'; min?: number; max?: number; valores?: readonly string[]; unidad?: string; get: (s: Settings) => Val; patch: (s: Settings, v: Val) => Partial<Settings>; fmt?: (v: Val) => string }
const pomo = (k: keyof Settings['pomo'], label: string, min: number, max: number, unidad = 'min'): Entry => ({ ruta: `pomo.${k}`, label: `Pomodoro · ${label}`, tipo: 'int', min, max, unidad, get: (s) => s.pomo[k] as number, patch: (s, v) => ({ pomo: { ...s.pomo, [k]: v as number } }) });
const top = (ruta: string, k: keyof Settings, label: string, tipo: 'int' | 'num', min: number, max: number, unidad = ''): Entry => ({ ruta, label, tipo, min, max, unidad, get: (s) => s[k] as number, patch: (_s, v) => ({ [k]: v }) as Partial<Settings> });
const flag = (ruta: string, k: keyof Settings, label: string): Entry => ({ ruta, label, tipo: 'bool', get: (s) => s[k] as boolean, patch: (_s, v) => ({ [k]: v }) as Partial<Settings> });
const chat = (ruta: string, k: 'dock' | 'estilo' | 'size' | 'context', label: string, valores: readonly string[]): Entry => ({ ruta, label, tipo: 'enum', valores, get: (s) => s.chat[k], patch: (s, v) => ({ chat: { ...s.chat, [k]: v } }) as Partial<Settings> });
const amb = (ruta: string, k: 'background' | 'duck' | 'loop' | 'shuffle' | 'onlyFocus', label: string): Entry => ({ ruta, label, tipo: 'bool', get: (s) => s.ambient[k], patch: (s, v) => ({ ambient: { ...s.ambient, [k]: v as boolean } }) });
const csv = (v: Val) => String(v ?? '').split(',').filter(Boolean);

/** Todo lo que el Asistente puede cambiar. Nada de claves, almacenamiento, respaldo, borrado ni del propio Asistente (salvo el add-on, con confirmación). */
export const CATALOG: readonly Entry[] = [
  pomo('work', 'trabajo', 1, 180), pomo('short', 'descanso corto', 1, 60), pomo('long', 'descanso largo', 1, 120), pomo('every', 'sesiones hasta el descanso largo', 1, 12, ''),
  { ruta: 'pomo.sound', label: 'Pomodoro · sonido', tipo: 'bool', get: (s) => s.pomo.sound, patch: (s, v) => ({ pomo: { ...s.pomo, sound: v as boolean } }) },
  { ruta: 'tema', label: 'Tema', tipo: 'enum', valores: ['auto', 'dark', 'light'], get: (s) => s.glassMode, patch: (_s, v) => ({ glassMode: v as Settings['glassMode'] }), fmt: (v) => ({ auto: t('asist2.v_sistema'), dark: t('asist2.v_oscuro'), light: t('asist2.v_claro') })[String(v)] ?? String(v) },
  { ruta: 'idioma', label: 'Idioma', tipo: 'enum', valores: ['', 'es', 'en', 'fr'], get: (s) => s.lang, patch: (_s, v) => ({ lang: v as Settings['lang'] }), fmt: (v) => String(v || t('asist2.v_dispositivo')) },
  { ruta: 'acento', label: 'Acento', tipo: 'color', get: (s) => s.accent.color, patch: (s, v) => ({ accent: { ...s.accent, color: (v as string | null) || null } }), fmt: (v) => String(v ?? t('asist2.v_sin_acento')) },
  { ruta: 'acento.usos', label: 'Acento · dónde se usa', tipo: 'texto', valores: ACCENT_USES, get: (s) => s.accent.usos.join(','), patch: (s, v) => ({ accent: { ...s.accent, usos: csv(v) as AccentUse[] } }), fmt: (v) => csv(v).join(', ') || t('asist2.v_ninguno') },
  top('vidrio', 'glass', 'Intensidad del vidrio', 'int', 0, 100, '%'), flag('modo_ligero', 'lightMode', 'Modo ligero (sin desenfoque)'),
  top('fondo.desenfoque', 'bgBlur', 'Desenfoque del fondo', 'int', 0, 40), top('fondo.velo', 'bgDim', 'Velo del fondo (− oscurece, + aclara)', 'int', -50, 50), top('texto.escala', 'textScale', 'Tamaño del texto', 'num', 0.8, 1.6),
  top('nuevas_por_dia', 'newPerDay', 'Tarjetas nuevas al día', 'int', 0, 9999), top('repasos_por_dia', 'reviewLimit', 'Repasos máximos al día', 'int', 0, 99999),
  top('retencion', 'retention', 'Retención deseada', 'num', 0.7, 0.99), top('intervalo_maximo', 'maxInterval', 'Intervalo máximo', 'int', 1, 36500, 'd'), top('umbral_sanguijuela', 'leechThreshold', 'Fallos para marcar sanguijuela', 'int', 1, 99, ''),
  top('dia.inicia', 'dayStartHour', 'Hora en que empieza el día de estudio', 'int', 0, 23, 'h'), flag('semana.lunes', 'weekStartsMonday', 'La semana empieza en lunes'), top('racha.minimo', 'streakMin', 'Tarjetas mínimas para la racha', 'int', 1, 999, ''),
  top('respaldo.recordatorio_dias', 'backupReminderDays', 'Recordatorio de respaldo cada', 'int', 1, 365, 'd'),
  flag('mostrar.grafo', 'showGraph', 'Mostrar el grafo de notas'), flag('mostrar.enlaces_entrantes', 'showBacklinks', 'Mostrar enlaces entrantes'),
  chat('asistente.dock', 'dock', 'GREX · barra', ['barra', 'mascota']), chat('asistente.estilo', 'estilo', 'GREX · estilo de respuestas', ['a', 'b']), chat('asistente.tamano', 'size', 'GREX · tamaño del chat', ['compact', 'large']), chat('asistente.contexto', 'context', 'GREX · contexto', ['normal', 'amplio']),
  amb('sonido.fondo', 'background', 'Sonido ambiente · seguir en segundo plano'), amb('sonido.bajar_con_voz', 'duck', 'Sonido ambiente · bajar con otros sonidos'), amb('sonido.bucle', 'loop', 'Música · repetir'), amb('sonido.aleatorio', 'shuffle', 'Música · aleatorio'), amb('sonido.solo_enfoque', 'onlyFocus', 'Sonido ambiente · solo en enfoque'),
];
const ADDON = /^addon\.([\w-]{1,40})$/, VOL = /^sonido\.volumen\.([a-z]{2,10})$/;
const DECK_NEW = 'mazo.nuevas_por_dia';

const addonEntry = (id: string): Entry => ({ ruta: `addon.${id}`, label: `Add-on «${id}»`, tipo: 'bool', get: (s) => s.addons[id], patch: (s, v) => { const a = { ...s.addons }; if (v === undefined) delete a[id]; else a[id] = v as boolean; return { addons: a }; } });
const volEntry = (id: string): Entry => ({ ruta: `sonido.volumen.${id}`, label: `Volumen · ${id}`, tipo: 'num', min: 0, max: 1, get: (s) => s.ambient.levels[id] ?? 0, patch: (s, v) => ({ ambient: { ...s.ambient, levels: { ...s.ambient.levels, [id]: v as number } } }) });
const FONDO = (L: Lists): Entry => ({
  ruta: 'fondo', label: 'Fondo', tipo: 'texto', valores: [...L.builtins, '#rrggbb', 'nombre de color', ...L.fondos.map((f) => `guardado:${f}`)],
  get: (s) => `${s.bg.kind}:${s.bg.value}`, patch: (_s, v) => { const [kind, ...r] = String(v).split(':'); return { bg: { kind: kind as 'builtin' | 'image' | 'solid', value: r.join(':') } }; },
  fmt: (v) => { const [k, ...r] = String(v).split(':'), x = r.join(':'); return k === 'image' ? t('asist2.v_imagen', { x: x.replace(/^.*\//, '').replace(/\.\w+$/, '') }) : k === 'solid' ? t('asist2.v_color', { x }) : x; },
});
export function entryOf(ruta: string, L: Lists): Entry | null {
  if (ruta === 'fondo') return FONDO(L);
  const a = ADDON.exec(ruta); if (a) return L.addons.includes(a[1]!) ? addonEntry(a[1]!) : null;
  const v = VOL.exec(ruta); if (v) return (SOUNDS as string[]).includes(v[1]!) ? volEntry(v[1]!) : null;
  return CATALOG.find((e) => e.ruta === ruta) ?? null;
}

/** Etiqueta traducida de una entrada (`asist2.l_<ruta con _>`; `label` queda como respaldo en español). */
const labelOf = (e: Entry): string => (e.ruta.startsWith('addon.') ? t('asist2.l_addon', { x: e.ruta.slice(6) }) : e.ruta.startsWith('sonido.volumen.') ? t('asist2.l_volumen', { x: e.ruta.slice(15) }) : t('asist2.l_' + e.ruta.replace(/\./g, '_')));
const unit = (u?: string) => (u === 'd' ? ' ' + t('asist2.v_dias') : u ? ' ' + u : '');
const show = (e: Entry, v: Val) => (e.fmt ? e.fmt(v) : v === undefined || v === null || v === '' ? '—' : typeof v === 'boolean' ? t(v ? 'asist2.v_si' : 'asist2.v_no') : `${v}${unit(e.unidad)}`);
const NAMES = new Set<string>(COLOR_NAMES);
const coerce = (e: Entry, raw: unknown, L: Lists, s: Settings): Val | Bad => {
  if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) return { error: 'valor', detail: 'Falta el valor (para quitar el acento usa «ninguno»).' };
  if (e.ruta === 'fondo') {
    const v = String(raw ?? '').trim(), low = v.toLowerCase();
    if (L.builtins.includes(low)) return `builtin:${low}`;
    if (/^#[0-9a-f]{6}$/i.test(v)) return `solid:${low}`;
    if (NAMES.has(low)) return `solid:${resolveColor(low, s.glassMode !== 'light').toLowerCase()}`;
    const f = L.fondos.find((x) => x.toLowerCase() === low.replace(/^guardado:/, ''));
    return f ? `image:media/.app/fondos/${f}.jpg` : { error: 'valor', detail: `Integrados: ${L.builtins.join(', ')}; un color (#rrggbb o ${COLOR_NAMES.join('/')}); guardados: ${L.fondos.join(', ') || '(ninguno)'}. No se suben archivos.` };
  }
  if (e.ruta === 'acento.usos') {
    const l = (Array.isArray(raw) ? raw : String(raw ?? '').split(/[,\s]+/)).map((x) => String(x).toLowerCase()).filter(Boolean);
    const bad = l.find((x) => !(ACCENT_USES as readonly string[]).includes(x));
    return bad ? { error: 'valor', detail: `Usos: ${ACCENT_USES.join(', ')}` } : [...new Set(l)].join(',');
  }
  if (e.tipo === 'bool') return typeof raw === 'boolean' ? raw : raw === 'true' || raw === 'sí' || raw === 'on' ? true : raw === 'false' || raw === 'no' || raw === 'off' ? false : { error: 'valor', detail: 'Debe ser true o false.' };
  if (e.tipo === 'enum') {
    const aliases: Record<string, string> = { oscuro: 'dark', claro: 'light', sistema: 'auto', automatico: 'auto' };
    let v = String(raw ?? '').trim().toLowerCase(); v = aliases[v] ?? v;
    if (e.ruta === 'idioma' && (v === 'auto' || v === 'dispositivo')) v = '';
    return e.valores!.includes(v) ? v : { error: 'valor', detail: `Valores: ${e.valores!.map((x) => x || 'auto').join(', ')}` };
  }
  if (e.tipo === 'color') {
    const v = String(raw ?? '').trim().toLowerCase();
    if (v === '' || v === 'ninguno' || v === 'null') return null;
    const hex = (NAMES.has(v) ? resolveColor(v, s.glassMode !== 'light') : v).toLowerCase();
    return /^#[0-9a-f]{6}$/.test(hex) ? hex : { error: 'valor', detail: `Color #rrggbb o ${COLOR_NAMES.join('/')}, o «ninguno».` };
  }
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(',', '.'));
  if (!Number.isFinite(n)) return { error: 'valor', detail: 'Debe ser un número.' };
  if (n < e.min! || n > e.max!) return { error: 'rango', detail: `Entre ${e.min} y ${e.max}.` };
  return e.tipo === 'int' ? Math.round(n) : n;
};

export interface Change { ruta: string; antes: unknown; despues: unknown }
/** Varios cambios = UNA propuesta (una línea por cambio). Cada uno se valida sobre el resultado del anterior, aplicando `mergeSettings`. */
export function buildSettings(s: Settings, L: Lists, cambios: { ruta: string; valor: unknown }[]): Proposal | Bad {
  if (!Array.isArray(cambios) || !cambios.length) return { error: 'vacio' };
  if (cambios.length > 6) return { error: 'largo', detail: 'Máximo 6 cambios por propuesta.' };
  let w = s;
  const items: string[] = [], ch: Change[] = [];
  for (const c of cambios) {
    const e = entryOf(String(c?.ruta ?? ''), L);
    if (!e) return { error: 'noexiste', detail: `«${String(c?.ruta ?? '').slice(0, 40)}» no está en el catálogo (usa listar_ajustes).` };
    let v = coerce(e, c.valor, L, w);
    if (isBad(v)) return { ...v, detail: `${e.ruta}: ${v.detail ?? ''}` };
    let note = '';
    if (e.ruta === 'acento' && typeof v === 'string') { // guardián de contraste AA: se propone el color más cercano que pase en el modo activo
      const mode = w.glassMode === 'auto' ? (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : w.glassMode;
      const c2 = accentVariant(v, mode).color.toLowerCase();
      if (c2 !== v) { note = ` — ${t('asist2.v_contraste', { a: v, b: c2 })}`; v = c2; }
    }
    const merged = mergeSettings({ ...w, ...e.patch(w, v) }), after = e.get(merged), before = e.get(w);
    if (after === before) return { error: 'igual', detail: `${e.ruta} ya tiene ese valor.` };
    items.push(`${labelOf(e)}: ${show(e, before)} → ${show(e, after)}${after !== v ? ` (${t('asist2.v_quedo', { x: show(e, after) })})` : ''}${note}`);
    ch.push({ ruta: e.ruta, antes: before, despues: after });
    w = merged;
  }
  return { tipo: 'ajuste', destino: 'settings', contenido: '', resumen: items.join(' · '), items, reversible: true, ajustes: ch };
}
export const buildSetting = (s: Settings, L: Lists | string[], ruta: string, valor: unknown): Proposal | Bad => buildSettings(s, Array.isArray(L) ? { addons: L, builtins: ['bruma', 'aurora', 'duna', 'bosque', 'neon', 'niebla'], fondos: [] } : L, [{ ruta, valor }]);

type App = { settings: Settings; update: (p: Partial<Settings>) => void };
/** Lo llama la interfaz tras «Aceptar» (despues) o «Deshacer» (antes): el mismo `app.update` de Ajustes, un solo parche. */
export function applySetting(app: App, L: Lists | string[], p: Proposal, undo = false): void {
  const l: Lists = Array.isArray(L) ? { addons: L, builtins: [], fondos: [] } : L;
  let w = app.settings, acc: Partial<Settings> = {};
  const list = undo ? [...(p.ajustes ?? [])].reverse() : p.ajustes ?? [];
  if (!list.length) throw new Error('path');
  for (const a of list) {
    const e = entryOf(a.ruta, a.ruta === 'fondo' ? { ...l, builtins: ['*'] } : l) ?? (a.ruta === 'fondo' ? FONDO(l) : null);
    if (!e) throw new Error('path');
    const patch = e.patch(w, (undo ? a.antes : a.despues) as Val);
    acc = { ...acc, ...patch }; w = { ...w, ...patch };
  }
  app.update(acc);
}

/** Listas de la app en ejecución (carga bajo demanda: la pantalla de add-ons y el módulo de fondos). */
export async function appLists(vault: { list(d: string): Promise<{ path: string; kind: string }[]> }): Promise<Lists> {
  const [a, b] = await Promise.all([import('../screens/addons'), import('../ui/background')]);
  let fondos: string[] = [];
  try { fondos = (await vault.list('media/.app/fondos')).filter((f) => f.kind === 'file' && /\.jpe?g$/i.test(f.path) && !/-thumb\.jpe?g$/i.test(f.path)).map((f) => f.path.replace(/^.*\//, '').replace(/\.\w+$/, '')); } catch { /* sin fondos guardados */ }
  return { addons: a.MODULES().map((m) => m.id), builtins: b.BUILTINS.map((x) => x.id), fondos };
}
const str = { type: 'string' } as const;

export interface AppDeps { settings: Settings; lists: () => Promise<Lists> | Lists }
export function makeAppTools(ctx: WriteCtx, deps: AppDeps): ToolSet {
  let n = 0;
  const turn = turnCount(ctx);
  const NO = { error: 'El usuario no pidió cambiar nada: no se propone nada.' };
  const out = (p: Proposal | Bad) => {
    if (isBad(p)) return { error: `No válido (${p.error}${p.detail ? ': ' + p.detail : ''}).` };
    if (n >= MAX_PROPOSALS || turn.n >= MAX_TURN) return { error: 'Límite alcanzado: ya hay 3 propuestas en este turno.' };
    n++; turn.n++; ctx.propose(p);
    return { estado: 'PROPUESTA mostrada al usuario; no se ha cambiado nada hasta que pulse Aceptar.', resumen: p.resumen };
  };
  return {
    listar_ajustes: tool({
      description: 'Lista los ajustes que puedes proponer cambiar (ruta, tipo, rango/valores y valor actual), los add-ons, fondos y los atajos (solo lectura).',
      inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {}, additionalProperties: false }),
      execute: async () => {
        const L = await deps.lists(), s = deps.settings;
        const es = [...CATALOG, FONDO(L), ...L.addons.map(addonEntry), ...SOUNDS.map(volEntry)];
        return {
          ajustes: es.map((e) => ({ ruta: e.ruta, tipo: e.tipo, ...(e.min !== undefined ? { min: e.min, max: e.max } : {}), ...(e.valores ? { valores: e.valores.map((x) => x || 'auto') } : {}), actual: e.get(s) ?? null })),
          mazo: { ruta: DECK_NEW, nota: 'cambiar_ajuste con `mazo` = nombre del mazo' },
          atajos: ACTIONS.slice(0, 40).map((a) => ({ id: a.id, teclas: a.keys })),
        };
      },
    }),
    cambiar_ajuste: tool({
      description: 'Propone cambiar uno o VARIOS ajustes de la app en una sola propuesta (`cambios`: [{ruta, valor}], máx. 6; o `ruta`+`valor`). Ej.: pomo.work=40, tema=dark, fondo=azul, acento=verde + acento.usos=boton, addon.tasks=true. Con ruta mazo.nuevas_por_dia y `mazo`, el límite de nuevas de ese mazo. No cambia nada: el usuario acepta y puede deshacer. Apagar addon.assistant solo si el usuario lo pidió con esas palabras (asistente/GREX).',
      inputSchema: jsonSchema<{ ruta?: string; valor?: string | number | boolean; cambios?: { ruta: string; valor: string | number | boolean }[]; mazo?: string }>({ type: 'object', properties: { ruta: str, valor: { type: ['string', 'number', 'boolean'] }, cambios: { type: 'array', items: { type: 'object', properties: { ruta: str, valor: { type: ['string', 'number', 'boolean'] } }, required: ['ruta', 'valor'], additionalProperties: false } }, mazo: str }, additionalProperties: false }),
      execute: async ({ ruta, valor, cambios, mazo }) => {
        if (!ctx.allowed()) return NO;
        const list = cambios?.length ? cambios : ruta !== undefined ? [{ ruta, valor }] : [];
        if (list.length === 1 && list[0]!.ruta === DECK_NEW) {
          const d = ctx.col ? pick(ctx.col.decks.map((x) => ({ key: x.path, names: [x.full, x.name, x.path], label: x.full })), String(mazo ?? '')) : ({ error: 'noexiste' } as Bad);
          if ('error' in d) return out(d);
          const v = Number(list[0]!.valor);
          if (!Number.isInteger(v) || v < 0 || v > 9999) return out({ error: 'rango', detail: 'Entero entre 0 y 9999.' });
          const text = await readTextOr(ctx.vault, d.key, '');
          return out(editProposal(d.key, text, setKeys(text, { new_per_day: v }), t('asist2.l_nuevas_mazo', { mazo: d.label, a: String(ctx.col!.decks.find((x) => x.path === d.key)?.newPerDay ?? t('asist2.v_general')), b: String(v) })));
        }
        // apagar el Asistente: lo decide el USUARIO (su último mensaje), no un parámetro del modelo
        const off = list.some((c) => c.ruta === 'addon.assistant' && !(c.valor === true || c.valor === 'true'));
        if (off && !/asistente|grex|assistant/i.test(ctx.userText ?? '')) return { error: 'Apagar el Asistente solo si el usuario lo pide con esas palabras en su último mensaje; pregúntale.' };
        const r = buildSettings(deps.settings, await deps.lists(), list as { ruta: string; valor: unknown }[]);
        return out(off && !isBad(r) ? { ...r, aviso: 'asist2.aviso_apagar' } : r);
      },
    }),
  };
}
