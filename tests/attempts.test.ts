import { describe, expect, it } from 'vitest';
import { ATTEMPTS, deleteAttempt, insertLine, removeLine, restoreAttempt } from '../src/data/extra';
import { MemoryBackend } from '../src/vault/memory';
import { readTextOr } from '../src/vault/util';

const line = (id: string, extra = '') => JSON.stringify({ id, title: `T ${id}`, finishedAt: 1, elapsedMs: 60000 }) + extra;
const FILE = [line('a'), line('b'), '{dañada', line('c'), ''].join('\n');

describe('borrar intentos (deleteAttempt)', () => {
  it('quita solo esa línea; la dañada y las demás quedan intactas', () => {
    const r = removeLine(FILE, 'c')!;
    expect(r.text).toBe([line('a'), line('b'), '{dañada', ''].join('\n'));
    expect(r.removed).toEqual({ raw: line('c'), index: 3, lines: 5 });
    expect(removeLine(FILE, 'b')!.text).toBe([line('a'), '{dañada', line('c'), ''].join('\n'));
  });
  it('id inexistente o archivo vacío: nada', () => {
    expect(removeLine(FILE, 'zz')).toBeNull();
    expect(removeLine('', 'a')).toBeNull();
  });
  it('el último intento deja el archivo sin él', () => {
    const one = line('x') + '\n';
    expect(removeLine(one, 'x')!.text).toBe('\n'.slice(1) + '');
  });
  it('deshacer restaura el archivo idéntico byte a byte (cualquier posición)', () => {
    for (const id of ['a', 'b', 'c']) {
      const r = removeLine(FILE, id)!;
      expect(insertLine(r.text, r.removed)).toBe(FILE);
    }
    const one = line('x');
    const r = removeLine(one, 'x')!;
    expect(insertLine(r.text, r.removed)).toBe(one);
  });
  it('por la bóveda: borra, no escribe si no existe y deshace idéntico', async () => {
    const v = new MemoryBackend();
    await v.write(ATTEMPTS, FILE);
    let writes = 0;
    const w = v.write.bind(v);
    v.write = async (p, d) => (writes++, w(p, d));
    expect(await deleteAttempt(v, 'nope')).toBeNull();
    expect(writes).toBe(0);
    const r = await deleteAttempt(v, 'b');
    expect(await readTextOr(v, ATTEMPTS, '')).not.toContain('"b"');
    await restoreAttempt(v, r!);
    expect(await readTextOr(v, ATTEMPTS, '')).toBe(FILE);
  });
});
