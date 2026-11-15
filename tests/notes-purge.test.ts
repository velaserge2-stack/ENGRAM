import { describe, expect, it } from 'vitest';
import { purge, trash, trashList } from '../src/notes/model';
import { MemoryBackend } from '../src/vault/memory';

describe('papelera de notas: eliminar definitivamente', () => {
  it('borra solo esa nota y las carpetas vacías de la papelera', async () => {
    const v = new MemoryBackend();
    await v.write('notes/Cardio/Arritmias.md', new TextEncoder().encode('# Arritmias'));
    await v.write('notes/Otra.md', new TextEncoder().encode('# Otra'));
    await trash(v, 'notes/Cardio/Arritmias.md', 1000);
    await trash(v, 'notes/Otra.md', 2000);
    const [otra, arr] = await trashList(v);
    expect(arr!.path).toBe('notes/Cardio/Arritmias.md');
    await purge(v, arr!.stored);
    expect((await trashList(v)).map((t) => t.path)).toEqual([otra!.path]);
    expect(await v.exists('.app/trash/1000')).toBe(false);
    expect(await v.exists('.app/trash/2000/notes/Otra.md')).toBe(true);
  });

  it('no borra nada fuera de la papelera', async () => {
    const v = new MemoryBackend();
    await v.write('notes/A.md', new TextEncoder().encode('a'));
    await expect(purge(v, 'notes/A.md')).rejects.toThrow();
    expect(await v.exists('notes/A.md')).toBe(true);
  });
});
