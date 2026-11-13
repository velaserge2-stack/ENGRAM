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

describe('writeStream: archivos grandes por trozos (Prompt 11)', () => {
  const big = (n: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 255; return b; };
  it('escribe por trozos con progreso; misma suma que checksum; sin temporales', async () => {
    const { SafeVault, TMP_DIR, JOURNAL_PATH } = await import('../src/vault/safe');
    const { MemoryBackend } = await import('../src/vault/memory');
    const { checksum, CHUNK } = await import('../src/vault/util');
    const raw = new MemoryBackend();
    const v = new SafeVault(raw);
    const data = big(CHUNK * 2 + 123);
    const seen: number[] = [];
    await v.writeStream('docs/grande.pdf', new Blob([data]), { onProgress: (n) => seen.push(n) });
    expect(seen).toEqual([CHUNK, CHUNK * 2, CHUNK * 2 + 123]);
    expect(checksum(await v.read('docs/grande.pdf'))).toBe(checksum(data));
    expect(await v.hash('docs/grande.pdf')).toEqual({ size: data.length, hash: checksum(data) });
    expect(await raw.exists(JOURNAL_PATH)).toBe(false);
    expect((await raw.list(TMP_DIR)).length).toBe(0);
    const f = await v.file('docs/grande.pdf');
    expect(f.size).toBe(data.length);
    expect(new Uint8Array(await f.slice(10, 14).arrayBuffer())).toEqual(data.slice(10, 14));
  });
  it('cancelar borra el temporal y no toca el destino', async () => {
    const { SafeVault, TMP_DIR } = await import('../src/vault/safe');
    const { MemoryBackend } = await import('../src/vault/memory');
    const { CHUNK } = await import('../src/vault/util');
    const raw = new MemoryBackend();
    const v = new SafeVault(raw);
    await v.write('docs/a.pdf', 'versión anterior');
    const ac = new AbortController();
    const p = v.writeStream('docs/a.pdf', new Blob([big(CHUNK * 3)]), { signal: ac.signal, onProgress: () => ac.abort() });
    await expect(p).rejects.toThrow(/Cancelado/);
    expect(new TextDecoder().decode(await v.read('docs/a.pdf'))).toBe('versión anterior');
    expect((await raw.list(TMP_DIR)).length).toBe(0);
  });
  it('corte a mitad de la escritura del temporal: recover() lo descarta y el destino queda igual', async () => {
    const { SafeVault, TMP_DIR, JOURNAL_PATH } = await import('../src/vault/safe');
    const { MemoryBackend } = await import('../src/vault/memory');
    const { CHUNK } = await import('../src/vault/util');
    const raw = new MemoryBackend();
    const v = new SafeVault(raw);
    await v.write('docs/a.pdf', 'original');
    raw.failAfter = CHUNK; // el «disco» se corta tras el primer trozo
    await expect(v.writeStream('docs/a.pdf', new Blob([big(CHUNK * 3)]))).rejects.toThrow(/Corte/);
    raw.failAfter = null;
    expect(await raw.exists(JOURNAL_PATH)).toBe(false); // el diario nunca se escribió
    const rep = await new SafeVault(raw).recover();
    expect(rep.recovered).toEqual([]);
    expect(new TextDecoder().decode(await raw.read('docs/a.pdf'))).toBe('original');
    expect((await raw.list(TMP_DIR)).length).toBe(0);
  });
  it('caída tras el diario (antes o después de mover): recover() termina la escritura verificando por trozos', async () => {
    const { SafeVault, TMP_DIR, JOURNAL_PATH } = await import('../src/vault/safe');
    const { MemoryBackend } = await import('../src/vault/memory');
    const { checksum } = await import('../src/vault/util');
    const data = big(5000);
    const entry = (tmp: string, hash = checksum(data)) => JSON.stringify({ v: 1, entries: [{ op: 'write', stream: true, path: 'docs/b.pdf', tmp, size: data.length, hash, ts: 1 }] });
    // (1) temporal completo, sin mover
    let raw = new MemoryBackend();
    await raw.write(`${TMP_DIR}/x`, data);
    await raw.write(JOURNAL_PATH, entry(`${TMP_DIR}/x`));
    let rep = await new SafeVault(raw).recover();
    expect(rep.recovered).toEqual(['docs/b.pdf']);
    expect(checksum(await raw.read('docs/b.pdf'))).toBe(checksum(data));
    expect(await raw.exists(`${TMP_DIR}/x`)).toBe(false);
    // (2) ya movido, faltaba borrar el diario
    raw = new MemoryBackend();
    await raw.write('docs/b.pdf', data);
    await raw.write(JOURNAL_PATH, entry(`${TMP_DIR}/y`));
    rep = await new SafeVault(raw).recover();
    expect(rep.recovered).toEqual(['docs/b.pdf']);
    // (3) temporal con suma distinta: se descarta y el destino no se toca
    raw = new MemoryBackend();
    await raw.write('docs/b.pdf', 'previo');
    await raw.write(`${TMP_DIR}/z`, data);
    await raw.write(JOURNAL_PATH, entry(`${TMP_DIR}/z`, 'deadbeef'));
    rep = await new SafeVault(raw).recover();
    expect(rep.discarded).toEqual(['docs/b.pdf']);
    expect(new TextDecoder().decode(await raw.read('docs/b.pdf'))).toBe('previo');
  });
  it('suma incremental = checksum de una vez', async () => {
    const { FNV_INIT, fnvHex, fnvUpdate, checksum, blobChecksum } = await import('../src/vault/util');
    const d = big(10_000);
    expect(fnvHex(fnvUpdate(fnvUpdate(FNV_INIT, d.subarray(0, 3333)), d.subarray(3333)))).toBe(checksum(d));
    expect(await blobChecksum(new Blob([d]))).toBe(checksum(d));
  });
});

describe('SafeVault: apply fallido con la app viva (auditoría plan 2)', () => {
  /** Destino que se trunca y falla `fails` veces seguidas (sync handle de OPFS sin cuota). */
  class Truncating extends MemoryBackend {
    target = '';
    fails = 0;
    override async write(p: string, d: Uint8Array | string) {
      if (p === this.target && this.fails > 0) {
        this.fails--;
        await super.write(p, new Uint8Array());
        throw new Error('sin espacio');
      }
      return super.write(p, d);
    }
  }
  it('si el reintento también falla, el diario se conserva y la siguiente escritura lo recupera antes', async () => {
    const raw = new Truncating();
    const v = new SafeVault(raw);
    await v.write('notes/a.md', 'v1');
    raw.target = 'notes/a.md';
    raw.fails = 2;
    await expect(v.write('notes/a.md', 'v2')).rejects.toThrow('sin espacio');
    expect(await raw.exists(JOURNAL_PATH)).toBe(true);
    await v.write('notes/b.md', 'otra');
    expect(await readText(raw, 'notes/a.md')).toBe('v2');
    expect(await raw.exists(JOURNAL_PATH)).toBe(false);
  });
  it('si la recuperación tampoco puede, se niega a escribir (no pisa el diario) y un arranque lo rehace', async () => {
    const raw = new Truncating();
    const v = new SafeVault(raw);
    raw.target = 'notes/a.md';
    raw.fails = 3;
    await expect(v.write('notes/a.md', 'v2')).rejects.toThrow();
    await expect(v.write('notes/b.md', 'otra')).rejects.toThrow(/a medias/);
    expect(await raw.exists('notes/b.md')).toBe(false);
    const r = await new SafeVault(raw).recover();
    expect(r.recovered).toEqual(['notes/a.md']);
    expect(await readText(raw, 'notes/a.md')).toBe('v2');
  });
  it('writeStream: si mover el temporal falla dos veces, el temporal sobrevive y se mueve después', async () => {
    class BadMove extends MemoryBackend {
      fails = 2;
      override async move(a: string, b: string) {
        if (this.fails-- > 0) throw new Error('move falló');
        return super.move(a, b);
      }
    }
    const raw = new BadMove();
    const v = new SafeVault(raw);
    await expect(v.writeStream('docs/x.pdf', new Blob(['PDF']))).rejects.toThrow('move falló');
    await v.write('notes/b.md', 'otra');
    expect(await readText(raw, 'docs/x.pdf')).toBe('PDF');
  });
});

describe('SafeVault: diario validado (auditoría plan 3)', () => {
  it('descarta entradas con op desconocida, ruta al diario o `from` fuera de lugar, y aplica la válida', async () => {
    const raw = new MemoryBackend();
    const ok = new TextEncoder().encode('bien');
    await raw.write('.app/tmp/a-1', ok);
    await raw.write('notes/keep.md', 'no tocar');
    const base = { tmp: '.app/tmp/a-1', size: ok.length, hash: checksum(ok), ts: 0 };
    await raw.write(JOURNAL_PATH, JSON.stringify({ v: 1, entries: [
      { ...base, op: 'delete', path: 'notes/keep.md' },
      { ...base, op: 'write', path: JOURNAL_PATH },
      { ...base, op: 'move', path: 'notes/x.md', from: '.app/tmp' },
      { ...base, op: 'write', path: 'notes/ok.md' },
    ] }));
    const r = await new SafeVault(raw).recover();
    expect(r.recovered).toEqual(['notes/ok.md']);
    expect(r.discarded).toHaveLength(3);
    expect(await readText(raw, 'notes/ok.md')).toBe('bien');
    expect(await readText(raw, 'notes/keep.md')).toBe('no tocar');
  });
});
