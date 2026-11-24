import { beforeEach, describe, expect, it } from 'vitest';
import { addKey, KEYS_STORAGE, loadKeys, markKey, mask, pickKey, saveKeys, type KeyEntry } from '../src/chat/keys';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
});
const K = (id: string, status: KeyEntry['status'] = 'active', until?: number): KeyEntry => ({ id, alias: id, provider: 'groq', key: 'gsk_' + id.repeat(12), status, until });

describe('chat keys', () => {
  it('pickKey: orden, estados y skip', () => {
    expect(pickKey([K('a'), K('b')], 0)?.id).toBe('a');
    expect(pickKey([K('a', 'paused'), K('b', 'invalid'), K('c')], 0)?.id).toBe('c');
    expect(pickKey([K('a'), K('b')], 0, new Set(['a']))?.id).toBe('b');
    expect(pickKey([], 0)).toBeNull();
  });
  it('exhausted se reabre en until', () => {
    const ks = [K('a', 'exhausted', 100), K('b')];
    expect(pickKey(ks, 99)?.id).toBe('b');
    expect(pickKey(ks, 100)?.id).toBe('a');
    expect(pickKey([K('a', 'exhausted')], 1e12)).toBeNull();
  });
  it('markKey es pura', () => {
    const s = { v: 1 as const, keys: [K('a')] };
    const t = markKey(s, 'a', 'exhausted', 5);
    expect(s.keys[0]!.status).toBe('active');
    expect(t.keys[0]).toMatchObject({ status: 'exhausted', until: 5 });
  });
  it('tope 3 y mask', () => {
    let s = loadKeys();
    for (let i = 0; i < 3; i++) s = addKey(s, 'groq', '', 'gsk_secret' + i)!;
    expect(addKey(s, 'groq', '', 'x')).toBeNull();
    expect(addKey(loadKeys(), 'groq', '', '  ')).toBeNull();
    expect(mask('gsk_abcd1234')).toBe('••••1234');
  });
  it('guardar/cargar, JSON corrupto y sin localStorage no lanzan', () => {
    const s = addKey(loadKeys(), 'gemini', 'mía', 'AIzaXXXX')!;
    expect(saveKeys(s)).toBe(true);
    expect(loadKeys().keys[0]).toMatchObject({ alias: 'mía', provider: 'gemini' });
    store.set(KEYS_STORAGE, '{no json');
    expect(loadKeys().keys).toEqual([]);
    store.set(KEYS_STORAGE, JSON.stringify({ v: 1, keys: [{ id: 1 }, K('ok')] }));
    expect(loadKeys().keys.map((k) => k.id)).toEqual(['ok']);
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadKeys().keys).toEqual([]);
    expect(saveKeys(s)).toBe(false);
  });
});
