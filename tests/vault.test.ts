import { describe, expect, it } from 'vitest';
import { MemoryBackend } from '../src/vault/memory';
import { normalizePath, withSuffix } from '../src/vault/paths';
import { JOURNAL_PATH, SafeVault, TMP_DIR } from '../src/vault/safe';
import type { VaultAdapter } from '../src/vault/types';
import { checksum, readText, walk } from '../src/vault/util';

describe('normalizePath', () => {
  it('normaliza separadores y puntos', () => {
    expect(normalizePath('/decks//a/./b.md')).toBe('decks/a/b.md');
    expect(normalizePath('decks\\x.md')).toBe('decks/x.md');
    expect(normalizePath('')).toBe('');
  });
  it('rechaza rutas peligrosas', () => {
    expect(() => normalizePath('../etc/passwd')).toThrow();
    expect(() => normalizePath('a/../../b')).toThrow();
    expect(() => normalizePath('C:/Windows')).toThrow();
    expect(() => normalizePath('a\0b')).toThrow();
    expect(() => normalizePath(Array(20).fill('a').join('/'))).toThrow();
  });
  it('sufijo de duplicado', () => {
    expect(withSuffix('notes/x.md', 2)).toBe('notes/x (2).md');
    expect(withSuffix('LEEME', 3)).toBe('LEEME (3)');
  });
});

/** Pruebas de contrato: cualquier backend debe pasarlas. */
function contract(name: string, make: () => VaultAdapter) {
  describe(`contrato VaultAdapter: ${name}`, () => {
    it('escribe, lee, lista, mueve y borra', async () => {
      const v = make();
      await v.write('decks/Cardio/ECG.md', 'hola');
      await v.write('decks/Neuro.md', new Uint8Array([1, 2, 3]));
      expect(await readText(v, 'decks/Cardio/ECG.md')).toBe('hola');
      const root = await v.list('decks');
      expect(root.map((e) => `${e.kind}:${e.path}`).sort()).toEqual(['dir:decks/Cardio', 'file:decks/Neuro.md']);
      expect((await v.stat('decks/Neuro.md'))?.size).toBe(3);
      expect((await v.stat('decks/Cardio'))?.kind).toBe('dir');
      expect(await v.exists('nada.md')).toBe(false);
      expect(await v.list('no-existe')).toEqual([]);
      await v.move('decks/Neuro.md', 'decks/Cardio/Neuro.md');
      expect(await v.exists('decks/Neuro.md')).toBe(false);
      expect((await v.read('decks/Cardio/Neuro.md'))[2]).toBe(3);
      await v.write('decks/Cardio/ECG.md', 'adiós');
      expect(await readText(v, 'decks/Cardio/ECG.md')).toBe('adiós');
      await v.remove('decks/Cardio');
      expect(await walk(v)).toEqual([]);
      await v.remove('no-existe'); // no falla
      await expect(v.read('nada')).rejects.toThrow();
    });
  });
}

contract('MemoryBackend', () => new MemoryBackend());
contract('SafeVault(Memory)', () => new SafeVault(new MemoryBackend()));

/** Backend que "se cae" (lanza) tras N escrituras, para simular el cierre de Safari. */
class Crashy extends MemoryBackend {
  writesLeft = Infinity;
  override async write(path: string, data: Uint8Array | string) {
    if (this.writesLeft-- <= 0) throw new Error('crash');
    return super.write(path, data);
  }
}

describe('SafeVault: diario y recuperación', () => {
  it('no deja rastro tras una escritura normal', async () => {
    const raw = new MemoryBackend();
    const v = new SafeVault(raw);
    await v.write('notes/a.md', 'A');
    expect(await raw.exists(JOURNAL_PATH)).toBe(false);
    expect(await raw.exists(TMP_DIR)).toBe(false);
  });

  it('corte tras escribir el temporal: el destino queda intacto', async () => {
    const raw = new Crashy();
    await raw.write('notes/a.md', 'viejo');
    const v = new SafeVault(raw);
    raw.writesLeft = 1; // solo el temporal
    await expect(v.write('notes/a.md', 'nuevo')).rejects.toThrow();
    raw.writesLeft = Infinity;
    const rep = await new SafeVault(raw).recover();
    expect(rep).toEqual({ recovered: [], discarded: [], journalCorrupt: false });
    expect(await readText(raw, 'notes/a.md')).toBe('viejo');
    expect(await raw.exists(TMP_DIR)).toBe(false);
  });

  it('corte tras el diario: la recuperación rehace la escritura', async () => {
    const raw = new Crashy();
    await raw.write('notes/a.md', 'viejo');
    raw.writesLeft = 2; // temporal + diario, y muere antes del destino
    await expect(new SafeVault(raw).write('notes/a.md', 'nuevo')).rejects.toThrow();
    raw.writesLeft = Infinity;
    const rep = await new SafeVault(raw).recover();
    expect(rep.recovered).toEqual(['notes/a.md']);
    expect(await readText(raw, 'notes/a.md')).toBe('nuevo');
    expect(await raw.exists(JOURNAL_PATH)).toBe(false);
  });

  it('temporal dañado: se descarta y no se toca el destino', async () => {
    const raw = new MemoryBackend();
    await raw.write('notes/a.md', 'viejo');
    await raw.write(`${TMP_DIR}/x`, 'nue'); // truncado
    await raw.write(JOURNAL_PATH, JSON.stringify({ v: 1, entries: [{ op: 'write', path: 'notes/a.md', tmp: `${TMP_DIR}/x`, size: 5, hash: checksum(new TextEncoder().encode('nuevo')), ts: 1 }] }));
    const rep = await new SafeVault(raw).recover();
    expect(rep.discarded).toEqual(['notes/a.md']);
    expect(await readText(raw, 'notes/a.md')).toBe('viejo');
  });

  it('diario a medio escribir: se reporta y se limpia', async () => {
    const raw = new MemoryBackend();
    await raw.write(JOURNAL_PATH, '{"v":1,"entr');
    const rep = await new SafeVault(raw).recover();
    expect(rep.journalCorrupt).toBe(true);
    expect(await raw.exists(JOURNAL_PATH)).toBe(false);
  });

  it('mover se recupera: destino escrito y origen borrado', async () => {
    const raw = new Crashy();
    await raw.write('decks/a.md', 'A');
    raw.writesLeft = 2;
    await expect(new SafeVault(raw).move('decks/a.md', 'decks/b.md')).rejects.toThrow();
    raw.writesLeft = Infinity;
    await new SafeVault(raw).recover();
    expect(await readText(raw, 'decks/b.md')).toBe('A');
    expect(await raw.exists('decks/a.md')).toBe(false);
  });

  it('serializa escrituras concurrentes (el último gana)', async () => {
    const v = new SafeVault(new MemoryBackend());
    await Promise.all(['1', '2', '3'].map((x) => v.write('a.md', x)));
    expect(await readText(v, 'a.md')).toBe('3');
  });
});

import { asciiCodec } from '../src/vault/handle-fs';
describe('codificación de nombres OPFS', () => {
  it('es reversible y deja ASCII seguro intacto', () => {
    for (const n of ['Cardiología.md', 'a%20b.md', '日本.md', 'x y (2).md', 'Clase 1 - ECG.md', '100%.md', '%', 'a/b'])
      expect(asciiCodec.dec(asciiCodec.enc(n))).toBe(n);
    expect(asciiCodec.enc('Clase 1 - ECG.md')).toBe('Clase 1 - ECG.md');
    expect(asciiCodec.enc('Cardiología.md')).not.toMatch(/[^\x20-\x7e]/);
    expect(asciiCodec.enc('a%20b.md')).toBe('a%2520b.md');
  });
});
