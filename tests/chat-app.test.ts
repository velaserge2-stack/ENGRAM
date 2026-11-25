import { describe, expect, it } from 'vitest';
import { wantsWrite } from '../src/chat/proposal';
import { groupsOf, writeSubset } from '../src/chat/roles';
import { applySetting, buildSetting, CATALOG, makeAppTools } from '../src/chat/tools-app';
import { defaultSettings, mergeSettings, type Settings } from '../src/lib/settings';
import { MemoryBackend } from '../src/vault/memory';

const ADDONS = ['tasks', 'assistant', 'ambient'];
const run = (t: any, n: string, i: object) => t[n].execute(i, { toolCallId: 't', messages: [] }); // eslint-disable-line @typescript-eslint/no-explicit-any
const mk = (s: Settings, allowed = true) => {
  const got: any[] = [], nav: string[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { got, nav, t: makeAppTools({ vault: new MemoryBackend(), col: null, today: '2026-03-01', sources: [], allowed: () => allowed, propose: (p) => got.push(p) }, { settings: s, addons: () => ADDONS, go: (x) => nav.push(x) }) };
};
const app = (s: Settings) => { const a = { settings: s, update: (p: Partial<Settings>) => { a.settings = mergeSettings({ ...a.settings, ...p }); } }; return a; };

describe('ajustes desde el Asistente', () => {
  it('«pon un pomodoro de 40 min» → pomo.work 25 → 40 y deshacer restaura', async () => {
    const s = defaultSettings(), { t, got } = mk(s);
    expect((await run(t, 'cambiar_ajuste', { ruta: 'pomo.work', valor: 40 })).estado).toMatch(/PROPUESTA/);
    expect(got[0].resumen).toBe('Pomodoro · trabajo: 25 min → 40 min');
    const a = app(s);
    expect(a.settings.pomo.work).toBe(25); // proponer no cambia
    applySetting(a, ADDONS, got[0]);
    expect(a.settings.pomo).toEqual({ ...s.pomo, work: 40 });
    applySetting(a, ADDONS, got[0], true);
    expect(a.settings.pomo).toEqual(s.pomo);
  });
  it('rangos, tipos y «sin cambio»', () => {
    const s = defaultSettings();
    expect(buildSetting(s, ADDONS, 'pomo.work', 999)).toMatchObject({ error: 'rango' });
    expect(buildSetting(s, ADDONS, 'pomo.work', 'abc')).toMatchObject({ error: 'valor' });
    expect(buildSetting(s, ADDONS, 'pomo.work', 25)).toMatchObject({ error: 'igual' });
    expect(buildSetting(s, ADDONS, 'tema', 'rosa')).toMatchObject({ error: 'valor' });
    expect(buildSetting(s, ADDONS, 'acento', 'rojo')).toMatchObject({ error: 'valor' });
    expect(buildSetting(s, ADDONS, 'retencion', 0.95)).toMatchObject({ resumen: expect.stringContaining('0.9 → 0.95') });
  });
  it('enum, idioma y acento', () => {
    const s = defaultSettings(), a = app(s);
    for (const [r, v] of [['tema', 'dark'], ['idioma', 'en'], ['acento', '#ff0000']] as const) { const p = buildSetting(a.settings, ADDONS, r, v); expect(p).toHaveProperty('tipo', 'ajuste'); applySetting(a, ADDONS, p as never); }
    expect([a.settings.glassMode, a.settings.lang, a.settings.accent.color]).toEqual(['dark', 'en', '#ff0000']);
    expect(a.settings.accent.usos).toEqual(s.accent.usos);
  });
  it('add-ons: solo los conocidos; deshacer vuelve a «sin clave»', () => {
    const s = defaultSettings(), a = app(s);
    expect(buildSetting(s, ADDONS, 'addon.inventado', true)).toMatchObject({ error: 'noexiste' });
    const p = buildSetting(s, ADDONS, 'addon.tasks', true) as never;
    applySetting(a, ADDONS, p);
    expect(a.settings.addons.tasks).toBe(true);
    applySetting(a, ADDONS, p, true);
    expect('tasks' in a.settings.addons && a.settings.addons.tasks).toBeFalsy();
  });
  it('rutas prohibidas: claves, almacenamiento, respaldo, borrado, chat', () => {
    const s = defaultSettings();
    for (const r of ['chat', 'chat.keys', 'chat.limits', 'engrama.chat.keys', 'vault', 'storage', 'lastExportAt', 'backup', 'welcomeDone', 'deckEmoji', 'tagList', '__proto__', 'addon.__proto__', '']) expect(buildSetting(s, ADDONS, r, 1)).toMatchObject({ error: 'noexiste' });
    expect(CATALOG.every((e) => !/chat|key|clave|vault|almac/i.test(e.ruta))).toBe(true);
  });
  it('apagar el Asistente exige confirmo', async () => {
    const s = defaultSettings(), { t, got } = mk(s);
    expect((await run(t, 'cambiar_ajuste', { ruta: 'addon.assistant', valor: false })).error).toMatch(/confirmación explícita/);
    expect(got).toHaveLength(0);
    expect((await run(t, 'cambiar_ajuste', { ruta: 'addon.assistant', valor: false, confirmo: true })).estado).toMatch(/PROPUESTA/);
  });
  it('sin `allowed` no propone; ir_a solo navega a pantallas conocidas; listar_ajustes trae el valor actual', async () => {
    const s = defaultSettings(), off = mk(s, false);
    expect(await run(off.t, 'cambiar_ajuste', { ruta: 'pomo.work', valor: 40 })).toHaveProperty('error');
    expect(off.got).toHaveLength(0); expect(await run(off.t, 'ir_a', { pantalla: 'hoy' })).toHaveProperty('error'); expect(off.nav).toEqual([]);
    const on = mk(s);
    await run(on.t, 'ir_a', { pantalla: 'calendario' }); expect(on.nav).toEqual(['calendario']);
    expect(await run(on.t, 'ir_a', { pantalla: 'http://x' })).toHaveProperty('error');
    const l = await run(on.t, 'listar_ajustes', {});
    expect(l.ajustes.find((x: { ruta: string }) => x.ruta === 'pomo.work')).toMatchObject({ min: 1, max: 180, actual: 25 });
    expect(l.ajustes.some((x: { ruta: string }) => x.ruta === 'addon.tasks')).toBe(true);
  });
  it('nuevas por día de UN mazo va al frontmatter del mazo con diff', async () => {
    const v = new MemoryBackend();
    await v.write('decks/Bio.md', new TextEncoder().encode('---\ndeck: Bio\n---\nQ:: a\nA:: b ^abcde\n'));
    const { loadCollection } = await import('../src/data/collection');
    const { DEFAULT_PARAMS } = await import('../src/srs/engine');
    const got: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const t = makeAppTools({ vault: v, col: await loadCollection(v, DEFAULT_PARAMS), today: '2026-03-01', sources: [], allowed: () => true, propose: (p) => got.push(p) }, { settings: defaultSettings(), addons: () => ADDONS, go: () => {} });
    expect((await run(t, 'cambiar_ajuste', { ruta: 'mazo.nuevas_por_dia', mazo: 'Bio', valor: 20 })).estado).toMatch(/PROPUESTA/);
    expect(got[0]).toMatchObject({ tipo: 'edicion', destino: 'decks/Bio.md' }); expect(got[0].contenido).toContain('new_per_day: 20');
    expect((await run(t, 'cambiar_ajuste', { ruta: 'mazo.nuevas_por_dia', mazo: 'Nada', valor: 20 })).error).toMatch(/noexiste/);
  });
  it('activación: verbos de ajuste y preguntas de capacidad; subconjunto «ajuste»', () => {
    for (const q of ['pon un pomodoro de 40 min', 'cambia el tema a oscuro', 'activa el add-on de tareas', 'set the language to english', 'puedes cambiar mis ajustes?', 'configura el pomodoro']) expect(wantsWrite(q), q).toBe(true);
    expect(wantsWrite('¿qué es un pomodoro?')).toBe(false);
    expect([...groupsOf('pon el tema oscuro')]).toEqual(['ajuste']);
    expect(Object.keys(writeSubset({ cambiar_ajuste: 1, crear_nota: 1, ir_a: 1 }, 'tema oscuro', true)).sort()).toEqual(['cambiar_ajuste', 'ir_a']);
  });
});
