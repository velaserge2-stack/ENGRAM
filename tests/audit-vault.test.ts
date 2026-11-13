// Auditoría etapa 2.4 · vault. Cada `it.fails` demuestra un fallo; auditoría: cambiar a it() al corregir.
import { describe, expect, it } from 'vitest';
import { asciiCodec } from '../src/vault/handle-fs';
import { checkIntegrity } from '../src/vault/integrity';
import { MemoryBackend } from '../src/vault/memory';
import { normalizePath } from '../src/vault/paths';
import { SafeVault } from '../src/vault/safe';
import { VaultError } from '../src/vault/types';
import { blobChecksum, checksum, readText, readTextOr } from '../src/vault/util';

describe('auditoría vault', () => {
  // auditoría: corregido (plan 1)
  it('readTextOr solo debe devolver el valor por defecto cuando el archivo NO existe (RAÍZ de «leer vacío y escribir»)', async () => {
    const m = new MemoryBackend();
    const broken = Object.assign(Object.create(m), {
      read: async () => {
        throw new VaultError('disco lleno / acceso denegado', 'io', 'notes/a.md');
      },
    }) as MemoryBackend;
    await expect(readTextOr(broken, 'notes/a.md', '')).rejects.toBeTruthy();
  });

  // auditoría: corregido (menores)
  it('readText sobre UTF-8 inválido no debe perder bytes en silencio (reescribir deja U+FFFD)', async () => {
    const v = new MemoryBackend();
    const original = new Uint8Array([0x68, 0xe9, 0x6c]); // "hél" en Latin-1
    await v.write('notes/latin1.md', original);
    let lossless = false;
    try {
      const text = await readText(v, 'notes/latin1.md');
      lossless = !text.includes('�'); // o bien lanza (también aceptable)
    } catch {
      lossless = true;
    }
    expect(lossless).toBe(true);
  });

  // auditoría: corregido (plan 11)
  it('SafeVault.move(a, a) no debe borrar el archivo', async () => {
    const v = new SafeVault(new MemoryBackend());
    await v.write('notes/x.md', 'contenido');
    await v.move('notes/x.md', 'notes/x.md');
    expect(await v.exists('notes/x.md')).toBe(true);
  });

  // auditoría: corregido (plan 11)
  it('MemoryBackend.move(a, a) (archivo y carpeta) no debe borrar', async () => {
    const m = new MemoryBackend();
    await m.write('d/x.md', 'hola');
    await m.move('d/x.md', 'd/x.md');
    await m.move('d', 'd');
    expect(await m.exists('d/x.md')).toBe(true);
  });

  // auditoría: corregido (menores)
  it('ningún nombre aceptado por normalizePath supera 255 caracteres una vez codificado para OPFS', () => {
    const seg = 'á'.repeat(100); // codificado: 600
    expect(() => normalizePath(seg)).toThrow(); // se rechaza con VaultError claro en vez de un error crudo del navegador
    const ok = 'á'.repeat(40);
    expect(normalizePath(ok)).toBe(ok);
    expect(asciiCodec.enc(ok).length).toBeLessThanOrEqual(255);
  });

  // auditoría: corregido (menores)
  it('MemoryBackend.write sobre una ruta que ya es carpeta debe fallar (como HandleFS)', async () => {
    const m = new MemoryBackend();
    await m.write('a/b.md', 'x');
    await expect(m.write('a', 'y')).rejects.toBeTruthy();
  });

  // auditoría: corregido (menores)
  it('las rutas inválidas deben rechazar la promesa, no lanzar de forma síncrona', async () => {
    const v = new SafeVault(new MemoryBackend());
    let sync = false;
    let p: Promise<void> | undefined;
    try {
      p = v.write('../x', 'a');
    } catch {
      sync = true;
    }
    p?.catch(() => {});
    expect(sync).toBe(false);
  });

  // auditoría: corregido (plan 1)
  it('el Worker de OPFS debe informar código de texto (QuotaExceededError), no el numérico de DOMException', async () => {
    const posted: { id: number; ok?: boolean; code?: unknown }[] = [];
    const g = globalThis as Record<string, unknown>;
    const old = { self: g.self, postMessage: g.postMessage };
    const root = {
      getDirectoryHandle: async () => {
        throw new DOMException('lleno', 'QuotaExceededError');
      },
    };
    g.self = globalThis;
    g.postMessage = (m: { id: number }) => void posted.push(m);
    Object.defineProperty(globalThis, 'navigator', { value: { storage: { getDirectory: async () => root } }, configurable: true });
    try {
      await import('../src/vault/opfs.worker');
      (g.onmessage as (e: unknown) => void)({ data: { id: 1, op: 'list', path: 'a/b' } });
      await new Promise((r) => setTimeout(r, 20));
      expect(posted[0]?.ok).toBe(false);
      expect(posted[0]?.code).toBe('QuotaExceededError'); // hoy: 22
    } finally {
      g.self = old.self;
      g.postMessage = old.postMessage;
    }
  });

  // Controles (deben pasar): lo que SÍ funciona
  it('checkIntegrity reporta y no modifica nada', async () => {
    const m = new MemoryBackend();
    await m.write('decks/a.md', '---\nfoo: [\n---\n');
    await m.write('x.json', '{mal');
    await m.write('l.jsonl', '{"a":1}\nmal\n');
    await m.write('b.md', new Uint8Array([0xff, 0xfe, 0x41]));
    const before = JSON.stringify([...(await m.list('')), ...(await m.list('decks'))]);
    const r = await checkIntegrity(m);
    expect(r.problems.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify([...(await m.list('')), ...(await m.list('decks'))])).toBe(before);
  });
  it('blobChecksum == checksum a través del límite de trozo (4 MB)', async () => {
    const b = new Uint8Array(4 * 1024 * 1024 + 7).map((_, i) => (i * 31) & 255);
    expect(await blobChecksum(new Blob([b as BlobPart]))).toBe(checksum(b));
  });
  it('codec de nombres es biyectivo para % y Unicode', () => {
    for (const n of ['100%.md', 'a%20b', 'Cardiología.md', 'ñ%C3%B1']) expect(asciiCodec.dec(asciiCodec.enc(n))).toBe(n);
  });
});
