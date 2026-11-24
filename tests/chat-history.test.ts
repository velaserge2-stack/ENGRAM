import { beforeEach, describe, expect, it } from 'vitest';
import { add, append, clear, generation, getStatus, messages, remove, setStatus, subscribe, toModel, trimMessages } from '../src/chat/history';
import { ACTIONS, conflicts, defaultConfig, resolve } from '../src/lib/keys';
import { defaultChat, mergeSettings } from '../src/lib/settings';

beforeEach(() => clear());

describe('Asistente · historial en memoria', () => {
  it('añade, agrega texto (streaming) y quita', () => {
    const u = add('user', 'hola'), a = add('assistant', '');
    append(a.id, 'Ho'); append(a.id, 'la');
    expect(messages().map((m) => m.text)).toEqual(['hola', 'Hola']);
    remove(u.id);
    expect(messages()).toHaveLength(1);
  });
  it('«Nueva conversación» vacía, cambia de generación y reinicia el estado', () => {
    const g = generation();
    add('user', 'x'); setStatus({ busy: true, alias: 'A' });
    clear();
    expect(messages()).toEqual([]);
    expect(generation()).toBe(g + 1);
    expect(getStatus()).toEqual({ busy: false });
  });
  it('avisa a los suscriptores', () => {
    let n = 0;
    const off = subscribe(() => n++);
    add('user', 'x'); setStatus({ busy: true }); off(); add('user', 'y');
    expect(n).toBe(2);
  });
  it('toModel: solo usuario y asistente con texto, alterna y empieza por usuario', () => {
    add('assistant', 'suelto'); add('user', 'uno'); add('error', '', { code: 'quota' }); add('user', 'dos');
    add('assistant', 'r'); add('notice', '', { code: 'rotated', alias: 'B' }); add('assistant', '');
    expect(toModel()).toEqual([{ role: 'user', content: 'uno\n\ndos' }, { role: 'assistant', content: 'r' }]);
  });
  it('trimMessages respeta el presupuesto y empieza por usuario', () => {
    for (let i = 0; i < 60; i++) add(i % 2 ? 'assistant' : 'user', 'm' + i + ' ' + 'x'.repeat(100));
    const out = trimMessages(toModel(), 400);
    expect(out.length).toBeLessThan(60);
    expect(out[0]!.role).toBe('user');
  });
});

describe('Asistente · atajos y tamaño recordado', () => {
  it('atajos sin choques y resueltos en su ámbito', () => {
    expect(conflicts(defaultConfig())).toEqual([]);
    expect(resolve(defaultConfig(), ['chat'], 'mod+alt+a', null)).toEqual({ action: 'chat.toggle' });
    expect(resolve(defaultConfig(), ['chat'], 'mod+alt+e', null)).toEqual({ action: 'chat.size' });
    expect(ACTIONS.filter((a) => a.scope === 'chat')).toHaveLength(2);
  });
  it('chat.size: por defecto compacto; merge válido o vuelve al defecto', () => {
    expect(defaultChat().size).toBe('compact');
    expect(mergeSettings({ chat: { size: 'large' } }).chat.size).toBe('large');
    expect(mergeSettings({ chat: { size: 'enorme' } }).chat.size).toBe('compact');
    expect(mergeSettings({}).chat.size).toBe('compact');
  });
});
