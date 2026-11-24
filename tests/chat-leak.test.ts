import { beforeEach, describe, expect, it } from 'vitest';
import { addKey, loadKeys, saveKeys } from '../src/chat/keys';
import { zipVault } from '../src/io/zip';
import { defaultSettings, serializeSettings } from '../src/lib/settings';
import { MemoryBackend } from '../src/vault/memory';

const SECRET = 'AIzaSySECRETO1234567890abcdef';
describe('la clave no sale de localStorage', () => {
  beforeEach(() => {
    const m = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  });
  it('ni en zipVault ni en settings.json', async () => {
    saveKeys(addKey(loadKeys(), 'gemini', 'g', SECRET)!);
    expect(loadKeys().keys[0]!.key).toBe(SECRET);
    const v = new MemoryBackend();
    await v.write('notes/a.md', new TextEncoder().encode('hola'));
    await v.write('.app/settings.json', new TextEncoder().encode(serializeSettings(defaultSettings())));
    const { blob } = await zipVault(v, 'test');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const { unzipSync, strFromU8 } = await import('fflate');
    const all = Object.values(unzipSync(bytes)).map((u) => strFromU8(u)).join('\n');
    expect(all).not.toContain(SECRET);
    expect(serializeSettings(defaultSettings())).not.toContain(SECRET);
    expect(JSON.stringify(Object.keys(defaultSettings()))).not.toMatch(/key/i);
  });
});
