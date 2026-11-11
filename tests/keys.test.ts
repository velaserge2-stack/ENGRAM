import { describe, expect, it } from 'vitest';
import { ACTIONS, bindingOf, conflicts, defaultConfig, keysOf, padActions, parseConfig, RESERVED, resolve, showKey } from '../src/lib/keys';

describe('atajos de teclado y mando', () => {
  it('normaliza pulsaciones', () => {
    expect(bindingOf({ key: ' ' })).toBe('Space');
    expect(bindingOf({ key: 'N', metaKey: true, shiftKey: true })).toBe('mod+shift+n');
    expect(bindingOf({ key: '?', shiftKey: true })).toBe('?'); // el «shift» va implícito en «?»
    expect(bindingOf({ key: '*', shiftKey: true })).toBe('*');
    expect(bindingOf({ key: 'k', ctrlKey: true })).toBe('mod+k');
    expect(bindingOf({ key: 'Shift', shiftKey: true })).toBe('');
    expect(showKey('mod+shift+n')).toBe('⌘⇧N');
    expect(showKey('g h')).toBe('G H');
  });
  it('los atajos de fábrica no chocan entre sí ni con el sistema', () => {
    expect(conflicts(defaultConfig())).toEqual([]);
    expect(ACTIONS.flatMap((a) => a.keys).some((k) => RESERVED.includes(k))).toBe(false);
  });
  it('detecta un conflicto al reasignar', () => {
    const cfg = { ...defaultConfig(), keys: { 'study.bury': ['e'] } }; // «e» ya es «editar»
    const c = conflicts(cfg);
    expect(c).toHaveLength(1);
    expect(c[0]!.actions.sort()).toEqual(['study.bury', 'study.edit']);
    // misma tecla en ámbitos distintos que no se pisan (tinta y repaso): no es conflicto
    expect(conflicts({ ...defaultConfig(), keys: { 'ink.pen': ['e'] } }).some((x) => x.actions.includes('ink.pen') && x.actions.includes('study.edit'))).toBe(false);
  });
  it('secuencias «g h» y reasignación que persiste', () => {
    const cfg = defaultConfig();
    expect(resolve(cfg, ['global'], 'g', null)).toEqual({ wait: 'g' });
    expect(resolve(cfg, ['global'], 'h', 'g')).toEqual({ action: 'global.goHoy' });
    expect(resolve(cfg, ['global', 'study'], '3', null)).toEqual({ action: 'study.good' });
    const saved = parseConfig(JSON.stringify({ ...cfg, keys: { 'study.good': ['PageDown'] } }));
    expect(keysOf(saved, 'study.good')).toEqual(['PageDown']);
    expect(parseConfig('basura')).toEqual(defaultConfig());
  });
  it('mando: A = mostrar/Bien, B = Otra vez, X = Difícil, Y = Fácil, cruceta = navegar, menú = deshacer', () => {
    const cfg = defaultConfig();
    expect(padActions(cfg, 'study', 0)).toEqual(['study.advance']);
    expect(padActions(cfg, 'study', 1)).toEqual(['study.again']);
    expect(padActions(cfg, 'study', 2)).toEqual(['study.hard']);
    expect(padActions(cfg, 'study', 3)).toEqual(['study.easy']);
    expect(padActions(cfg, 'study', 9)).toEqual(['study.undo']);
    expect(padActions(cfg, 'sim', 15)).toEqual(['sim.next']);
    expect(padActions({ ...cfg, pad: { 'study.again': [5] } }, 'study', 5)).toEqual(['study.again']);
  });
});
