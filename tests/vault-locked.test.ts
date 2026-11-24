// Bug «a veces no puedo borrar/modificar»: handle ocupado (NoModificationAllowedError), cola y avisos.
import { beforeEach, describe, expect, it } from 'vitest';
import { noteStore, onNoteSaveFailed } from '../src/notes/store';
import { clearPendingSave, markPendingSave, takePendingSaves, techLine } from '../src/vault/errinfo';
import { MemoryBackend } from '../src/vault/memory';
import { codeOf } from '../src/vault/opfs';
import { retryLocked } from '../src/vault/retry';
import { SafeVault } from '../src/vault/safe';

const locked = () => Object.assign(new Error('The file is locked'), { name: 'NoModificationAllowedError' });
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
});

describe('bloqueo de handle OPFS', () => {
  it('NoModificationAllowedError e InvalidStateError ya no caen en io genérico', () => {
    expect(codeOf('NoModificationAllowedError')).toBe('locked');
    expect(codeOf('InvalidStateError')).toBe('locked');
    expect(codeOf('QuotaExceededError')).toBe('quota');
    expect(codeOf('SomethingElse')).toBe('io');
  });
  it('reintenta con espera corta y acaba escribiendo', async () => {
    let n = 0;
    const r = await retryLocked(async () => { if (++n < 3) throw locked(); return 'ok'; }, [1, 1, 1]);
    expect([r, n]).toEqual(['ok', 3]);
  });
  it('se rinde tras los reintentos y no reintenta otros errores', async () => {
    let n = 0;
    await expect(retryLocked(async () => { n++; throw locked(); }, [1, 1, 1])).rejects.toMatchObject({ name: 'NoModificationAllowedError' });
    expect(n).toBe(4);
    n = 0;
    await expect(retryLocked(async () => { n++; throw new Error('x'); }, [1])).rejects.toThrow('x');
    expect(n).toBe(1);
  });
});

describe('un error no deja la cola colgada', () => {
  it('tras un fallo de escritura la siguiente (editar, borrar) funciona', async () => {
    const m = new MemoryBackend();
    let fail = 0;
    const raw = Object.create(m) as MemoryBackend;
    raw.write = async (p, d) => { if (fail > 0 && p === 'notes/a.md') { fail--; throw locked(); } return m.write(p, d); };
    const v = new SafeVault(raw);
    await v.write('notes/a.md', 'uno');
    fail = 2; // el intento y su reintento interno fallan: el diario queda atascado
    await expect(v.write('notes/a.md', 'dos')).rejects.toBeTruthy();
    await v.write('notes/a.md', 'tres'); // recupera el diario y escribe
    expect(new TextDecoder().decode(await m.read('notes/a.md'))).toBe('tres');
    await v.remove('notes/a.md');
    expect(await m.exists('notes/a.md')).toBe(false);
  });
});

describe('aviso de fallo de guardado', () => {
  it('línea técnica Nombre: mensaje, sin rutas y ≤ 160', () => {
    const line = techLine(Object.assign(new Error('write notes/Mi tesis/x.md: NoModificationAllowedError: bloqueado'), { name: 'VaultError', code: 'locked' }));
    expect(line).toBe('VaultError/locked: NoModificationAllowedError: bloqueado');
    expect(techLine(new Error('a'.repeat(400))).length).toBe(160);
  });
  it('un guardado fallido deja marca; guardar bien la quita; el siguiente arranque la lee una vez', async () => {
    const m = new MemoryBackend();
    let fail = true;
    const raw = Object.create(m) as MemoryBackend;
    raw.write = async (p, d) => { if (fail) throw locked(); return m.write(p, d); };
    const seen: string[] = [];
    onNoteSaveFailed((p) => seen.push(p));
    await noteStore.load(raw, 'notes/b.md');
    noteStore.set(raw, 'notes/b.md', 'hola');
    await noteStore.flush('notes/b.md').catch(() => {});
    expect(seen).toEqual(['notes/b.md']);
    expect(store.get('engrama.pendingSave')).toContain('notes/b.md');
    fail = false;
    noteStore.set(raw, 'notes/b.md', 'hola 2');
    await noteStore.flush('notes/b.md');
    expect(store.has('engrama.pendingSave')).toBe(false);
    markPendingSave('notes/c.md'); markPendingSave('notes/d.md'); clearPendingSave('notes/d.md');
    expect(takePendingSaves()).toEqual(['notes/c.md']);
    expect(takePendingSaves()).toEqual([]);
  });
});
