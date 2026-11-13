import { describe, expect, it } from 'vitest';
import { asNote, newStickyPath, parseSticky, reorder, serializeSticky, sortStickies, stickyTitle } from '../src/stickies/model';

describe('Sticky notes (Prompt 19 · 3): frontmatter', () => {
  it('ida y vuelta; claves desconocidas intactas; idempotente', () => {
    const text = '---\nsticky: true\norden: 20\ncolor: amarillo\nfijada: true\netiquetas: [a, b]\n---\n**Hola**\n- [ ] algo\n';
    const s = parseSticky('notes/Stickies/x.md', text);
    expect(s).toMatchObject({ order: 20, color: 'amarillo', pinned: true, archived: false, body: '**Hola**\n- [ ] algo\n' });
    expect(s.rest).toEqual({ etiquetas: ['a', 'b'] });
    const out = serializeSticky(s);
    expect(parseSticky(s.path, out)).toEqual(s);
    expect(serializeSticky(parseSticky(s.path, out))).toBe(out);
  });

  it('valores raros: color desconocido = neutro; sin frontmatter = orden 0', () => {
    expect(parseSticky('p', '---\ncolor: fucsia\n---\nx').color).toBeNull();
    expect(parseSticky('p', 'solo texto')).toMatchObject({ order: 0, color: null, pinned: false, body: 'solo texto' });
    expect(serializeSticky({ path: 'p', body: '', order: 10, color: null, pinned: false, archived: true, rest: {} })).toContain('archivada: true');
  });

  it('orden: fijadas primero, luego `orden`; reordenar renumera solo lo necesario', () => {
    const mk = (p: string, order: number, pinned = false) => ({ path: p, body: '', order, color: null, pinned, archived: false, rest: {} });
    const sorted = sortStickies([mk('c', 30), mk('a', 10), mk('b', 20), mk('z', 99, true)]);
    expect(sorted.map((s) => s.path)).toEqual(['z', 'a', 'b', 'c']);
    const ch = reorder(sortStickies([mk('a', 10), mk('b', 20), mk('c', 30)]), 2, 0);
    expect(ch.map((s) => [s.path, s.order])).toEqual([['c', 10], ['a', 20], ['b', 30]]);
    expect(reorder(sortStickies([mk('a', 10), mk('b', 20)]), 0, 0)).toEqual([]);
  });

  it('rutas nuevas únicas, título y conversión a nota', () => {
    const now = 1_700_000_000_000;
    const id = now.toString(36);
    expect(newStickyPath(now, () => false)).toBe(`notes/Stickies/${id}.md`);
    expect(newStickyPath(now, (p) => p.endsWith(`${id}.md`))).toBe(`notes/Stickies/${id}-2.md`);
    expect(stickyTitle('\n# **Llamar** al _doctor_\nmás', 'Sticky')).toBe('Llamar al doctor');
    expect(stickyTitle('- [ ] comprar pan', 'Sticky')).toBe('comprar pan');
    expect(stickyTitle('', 'Sticky')).toBe('Sticky');
    const s = parseSticky('p', '---\nsticky: true\norden: 10\ncolor: rosa\nautor: yo\n---\nTexto');
    expect(asNote(s)).toBe('---\nautor: yo\n---\nTexto\n');
    expect(asNote(parseSticky('p', '---\nsticky: true\n---\nSolo'))).toBe('Solo\n');
  });
});
