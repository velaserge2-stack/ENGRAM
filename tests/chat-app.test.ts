import { describe, expect, it } from 'vitest';
import { wantsWrite } from '../src/chat/proposal';
import { groupsOf, writeSubset } from '../src/chat/roles';
import { applySetting, buildSetting, buildSettings, CATALOG, makeAppTools } from '../src/chat/tools-app';
import { defaultSettings, mergeSettings, type Settings } from '../src/lib/settings';
import { MemoryBackend } from '../src/vault/memory';

const ADDONS = ['tasks', 'assistant', 'ambient'];
const LISTS = { addons: ADDONS, builtins: ['bruma', 'aurora', 'duna'], fondos: ['mi-foto'] };
const run = (t: any, n: string, i: object) => t[n].execute(i, { toolCallId: 't', messages: [] }); // eslint-disable-line @typescript-eslint/no-explicit-any
const mk = (s: Settings, allowed = true) => {
  const got: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  return { got, t: makeAppTools({ vault: new MemoryBackend(), col: null, today: '2026-03-01', sources: [], allowed: () => allowed, propose: (p) => got.push(p) }, { settings: s, lists: () => LISTS }) };
};
const app = (s: Settings) => { const a = { settings: s, update: (p: Partial<Settings>) => { a.settings = mergeSettings({ ...a.settings, ...p }); } }; return a; };

describe('ajustes desde el Asistente', () => {
  it('«pon un pomodoro de 40 min» → pomo.work 25 → 40 y deshacer restaura', async () => {
    const s = defaultSettings(), { t, got } = mk(s);
    expect((await run(t, 'cambiar_ajuste', { ruta: 'pomo.work', valor: 40 })).estado).toMatch(/PROPUESTA/);
    expect(got[0].resumen).toBe('Pomodoro · trabajo: 25 min → 40 min');
    const a = app(s);
    expect(a.settings.pomo.work).toBe(25); // proponer no cambia
    applySetting(a, LISTS, got[0]);
    expect(a.settings.pomo).toEqual({ ...s.pomo, work: 40 });
    applySetting(a, LISTS, got[0], true);
    expect(a.settings.pomo).toEqual(s.pomo);
  });
  it('rangos, tipos y «sin cambio»', () => {
    const s = defaultSettings();
    expect(buildSetting(s, LISTS, 'pomo.work', 999)).toMatchObject({ error: 'rango' });
    expect(buildSetting(s, LISTS, 'pomo.work', 'abc')).toMatchObject({ error: 'valor' });
    expect(buildSetting(s, LISTS, 'pomo.work', 25)).toMatchObject({ error: 'igual' });
    expect(buildSetting(s, LISTS, 'tema', 'rosa')).toMatchObject({ error: 'valor' });
    expect(buildSetting(s, LISTS, 'acento', 'rosado')).toMatchObject({ error: 'valor' });
    expect(buildSetting(s, LISTS, 'retencion', 0.95)).toMatchObject({ resumen: expect.stringContaining('0.9 → 0.95') });
  });
  it('enum, idioma y acento', () => {
    const s = defaultSettings(), a = app(s);
    for (const [r, v] of [['tema', 'dark'], ['idioma', 'en'], ['acento', '#0a3a8a']] as const) { const p = buildSetting(a.settings, LISTS, r, v); expect(p).toHaveProperty('tipo', 'ajuste'); applySetting(a, LISTS, p as never); }
    expect([a.settings.glassMode, a.settings.lang, a.settings.accent.color?.slice(0, 1)]).toEqual(['dark', 'en', '#']);
    expect(a.settings.accent.usos).toEqual(s.accent.usos);
  });
  it('add-ons: solo los conocidos; deshacer vuelve a «sin clave»', () => {
    const s = defaultSettings(), a = app(s);
    expect(buildSetting(s, LISTS, 'addon.inventado', true)).toMatchObject({ error: 'noexiste' });
    const p = buildSetting(s, LISTS, 'addon.tasks', true) as never;
    applySetting(a, LISTS, p);
    expect(a.settings.addons.tasks).toBe(true);
    applySetting(a, LISTS, p, true);
    expect('tasks' in a.settings.addons && a.settings.addons.tasks).toBeFalsy();
  });
  it('rutas prohibidas: claves, almacenamiento, respaldo, borrado, chat', () => {
    const s = defaultSettings();
    for (const r of ['chat', 'chat.keys', 'chat.limits', 'engrama.chat.keys', 'vault', 'storage', 'lastExportAt', 'backup', 'welcomeDone', 'deckEmoji', 'tagList', '__proto__', 'addon.__proto__', '']) expect(buildSetting(s, LISTS, r, 1)).toMatchObject({ error: 'noexiste' });
    expect(CATALOG.every((e) => !/key|clave|vault|almac|respaldo\.(exportar|borrar)/i.test(e.ruta))).toBe(true);
  });
  it('apagar el Asistente exige confirmo', async () => {
    const s = defaultSettings(), { t, got } = mk(s);
    expect((await run(t, 'cambiar_ajuste', { ruta: 'addon.assistant', valor: false })).error).toMatch(/confirmación explícita/);
    expect(got).toHaveLength(0);
    expect((await run(t, 'cambiar_ajuste', { ruta: 'addon.assistant', valor: false, confirmo: true })).estado).toMatch(/PROPUESTA/);
  });
  it('sin `allowed` no propone; listar_ajustes trae el valor actual, atajos y fondos', async () => {
    const s = defaultSettings(), off = mk(s, false);
    expect(await run(off.t, 'cambiar_ajuste', { ruta: 'pomo.work', valor: 40 })).toHaveProperty('error');
    expect(off.got).toHaveLength(0);
    const l = await run(mk(s).t, 'listar_ajustes', {});
    expect(l.ajustes.find((x: { ruta: string }) => x.ruta === 'pomo.work')).toMatchObject({ min: 1, max: 180, actual: 25 });
    expect(l.ajustes.some((x: { ruta: string }) => x.ruta === 'addon.tasks')).toBe(true);
    expect(l.ajustes.find((x: { ruta: string }) => x.ruta === 'fondo').valores).toContain('guardado:mi-foto');
    expect(l.atajos.length).toBeGreaterThan(3);
  });
  it('«pon el fondo azul» → color sólido; fondo integrado; guardado por nombre; sin subir archivos', async () => {
    const a = app(defaultSettings());
    const azul = buildSetting(a.settings, LISTS, 'fondo', 'azul') as never as { items: string[]; ajustes: unknown[] };
    expect(azul.items[0]).toMatch(/^Fondo: bruma → color #[0-9a-f]{6}$/i);
    applySetting(a, LISTS, azul as never); expect(a.settings.bg.kind).toBe('solid');
    applySetting(a, LISTS, buildSetting(a.settings, LISTS, 'fondo', 'aurora') as never); expect(a.settings.bg).toEqual({ kind: 'builtin', value: 'aurora' });
    applySetting(a, LISTS, buildSetting(a.settings, LISTS, 'fondo', 'mi-foto') as never); expect(a.settings.bg).toEqual({ kind: 'image', value: 'media/.app/fondos/mi-foto.jpg' });
    expect(buildSetting(a.settings, LISTS, 'fondo', 'media/../../x.jpg')).toMatchObject({ error: 'valor' });
    expect(buildSetting(a.settings, LISTS, 'fondo', 'https://x.com/a.jpg')).toMatchObject({ error: 'valor' });
  });
  it('«acento verde solo en botones» (dos ajustes, una propuesta) y deshacer', () => {
    const a = app(defaultSettings()), before = a.settings.accent;
    const c = buildSettings(a.settings, LISTS, [{ ruta: 'acento', valor: 'verde' }, { ruta: 'acento.usos', valor: 'boton' }]);
    expect(c).toMatchObject({ tipo: 'ajuste' }); expect((c as { items: string[] }).items).toHaveLength(2);
    applySetting(a, LISTS, c as never);
    expect(a.settings.accent.usos).toEqual(['boton']); expect(a.settings.accent.color).toMatch(/^#/);
    applySetting(a, LISTS, c as never, true);
    expect(a.settings.accent).toEqual(before);
    expect(buildSettings(a.settings, LISTS, [{ ruta: 'acento.usos', valor: 'cielo' }])).toMatchObject({ error: 'valor' });
  });
  it('el guardián de contraste ajusta un acento que no pasa AA y lo dice', () => {
    const s = { ...defaultSettings(), glassMode: 'light' as const };
    const p = buildSetting(s, LISTS, 'acento', '#ffff00') as { items: string[] };
    expect(p.items[0]).toMatch(/no pasa el contraste AA; propongo #[0-9a-f]{6}/);
  });
  it('«tema oscuro con fondo azul y acento verde» = UNA propuesta con 3 líneas, un deshacer', () => {
    const a = app(defaultSettings()), snap = JSON.stringify(a.settings);
    const p = buildSettings(a.settings, LISTS, [{ ruta: 'tema', valor: 'oscuro' }, { ruta: 'fondo', valor: 'azul' }, { ruta: 'acento', valor: 'verde' }]) as { items: string[] };
    expect(p.items).toHaveLength(3); expect(p.items[0]).toBe('Tema: sistema → oscuro');
    applySetting(a, LISTS, p as never); expect(a.settings.glassMode).toBe('dark');
    applySetting(a, LISTS, p as never, true); expect(JSON.stringify(a.settings)).toBe(snap);
    expect(buildSettings(a.settings, LISTS, [{ ruta: 'tema', valor: 'dark' }, { ruta: 'chat.keys', valor: 'x' }])).toMatchObject({ error: 'noexiste' }); // un cambio malo invalida todo
    expect(buildSettings(a.settings, LISTS, Array.from({ length: 7 }, () => ({ ruta: 'tema', valor: 'dark' })))).toMatchObject({ error: 'largo' });
  });
  it('GREX y sonido: dock, estilo, volumen por sonido', () => {
    const a = app(defaultSettings());
    applySetting(a, LISTS, buildSettings(a.settings, LISTS, [{ ruta: 'asistente.dock', valor: 'mascota' }, { ruta: 'sonido.volumen.rain', valor: 0.4 }, { ruta: 'sonido.bucle', valor: false }]) as never);
    expect([a.settings.chat.dock, a.settings.ambient.levels.rain, a.settings.ambient.loop]).toEqual(['mascota', 0.4, false]);
    expect(buildSetting(a.settings, LISTS, 'sonido.volumen.nada', 0.4)).toMatchObject({ error: 'noexiste' });
    expect(buildSetting(a.settings, LISTS, 'sonido.volumen.rain', 3)).toMatchObject({ error: 'rango' });
  });
  it('nuevas por día de UN mazo va al frontmatter del mazo con diff', async () => {
    const v = new MemoryBackend();
    await v.write('decks/Bio.md', new TextEncoder().encode('---\ndeck: Bio\n---\nQ:: a\nA:: b ^abcde\n'));
    const { loadCollection } = await import('../src/data/collection');
    const { DEFAULT_PARAMS } = await import('../src/srs/engine');
    const got: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const t = makeAppTools({ vault: v, col: await loadCollection(v, DEFAULT_PARAMS), today: '2026-03-01', sources: [], allowed: () => true, propose: (p) => got.push(p) }, { settings: defaultSettings(), lists: () => LISTS });
    expect((await run(t, 'cambiar_ajuste', { ruta: 'mazo.nuevas_por_dia', mazo: 'Bio', valor: 20 })).estado).toMatch(/PROPUESTA/);
    expect(got[0]).toMatchObject({ tipo: 'edicion', destino: 'decks/Bio.md' }); expect(got[0].contenido).toContain('new_per_day: 20');
    expect((await run(t, 'cambiar_ajuste', { ruta: 'mazo.nuevas_por_dia', mazo: 'Nada', valor: 20 })).error).toMatch(/noexiste/);
  });
  it('activación: verbos de ajuste y preguntas de capacidad; subconjunto «ajuste»', () => {
    for (const q of ['pon un pomodoro de 40 min', 'cambia el tema a oscuro', 'pon el fondo azul', 'acento verde solo en botones', 'modo oscuro', 'activa el add-on de tareas', 'set the language to english', 'puedes cambiar mis ajustes?', 'configura el pomodoro']) expect(wantsWrite(q), q).toBe(true);
    expect(wantsWrite('¿qué es un pomodoro?')).toBe(false);
    expect([...groupsOf('pon el tema oscuro')]).toEqual(['ajuste']);
    expect(Object.keys(writeSubset({ cambiar_ajuste: 1, crear_nota: 1 }, 'tema oscuro', true))).toEqual(['cambiar_ajuste']);
  });
});
