import { describe, expect, it } from 'vitest';
import { noteStore } from '../src/notes/store';
import { MemoryBackend } from '../src/vault/memory';
import { SafeVault } from '../src/vault/safe';
import { readText } from '../src/vault/util';

describe('NoteStore: una sola fuente para la pestaña Notas y los paneles', () => {
  it('dos vistas de la misma nota ven lo mismo al instante y se guarda una vez', async () => {
    const v = new SafeVault(new MemoryBackend());
    await v.write('notes/A/B/n.md', 'hola');
    const seenA: string[] = [], seenB: string[] = [];
    const ua = noteStore.subscribe(v, 'notes/A/B/n.md', (t) => seenA.push(t));
    const ub = noteStore.subscribe(v, 'notes/A/B/n.md', (t) => seenB.push(t));
    expect(await noteStore.load(v, 'notes/A/B/n.md')).toBe('hola');
    noteStore.set(v, 'notes/A/B/n.md', 'hola mundo'); // escribe el panel…
    expect(seenA).toEqual(['hola mundo']); // …y la pestaña lo ve sin recargar
    expect(seenB).toEqual(['hola mundo']);
    await noteStore.flush('notes/A/B/n.md');
    expect(await readText(v, 'notes/A/B/n.md')).toBe('hola mundo');
    // un cambio externo (importar, restaurar) se recarga si no hay nada pendiente
    await v.write('notes/A/B/n.md', 'desde fuera');
    await noteStore.refresh(v, 'notes/A/B/n.md');
    expect(seenA.at(-1)).toBe('desde fuera');
    ua(); ub();
    await noteStore.forget('notes/A/B/n.md');
  });
  it('no pisa lo escrito: un cambio pendiente gana a una recarga', async () => {
    const v = new SafeVault(new MemoryBackend());
    await v.write('notes/x.md', 'a');
    await noteStore.load(v, 'notes/x.md');
    noteStore.set(v, 'notes/x.md', 'b');
    await noteStore.refresh(v, 'notes/x.md'); // hay un guardado pendiente: no se recarga
    expect(noteStore.peek('notes/x.md')).toBe('b');
    await noteStore.forget('notes/x.md');
    expect(await readText(v, 'notes/x.md')).toBe('b');
  });
});
