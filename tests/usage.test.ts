import { describe, expect, it } from 'vitest';
import { countUses, DELETABLE, kindOf, orphans, refsIn, REGENERABLE } from '../src/lib/usage';

describe('almacenamiento', () => {
  it('clasifica por tipo', () => {
    expect(kindOf('docs/Harrison.pdf')).toBe('pdf');
    expect(kindOf('docs/clase.docx')).toBe('documentos');
    expect(kindOf('docs/notas.csv')).toBe('hojas');
    expect(kindOf('media/ecg.PNG')).toBe('fotos');
    expect(kindOf('media/.app/fondos/a.jpg')).toBe('fondos');
    expect(kindOf('media/clase.m4a')).toBe('audio');
    expect(kindOf('.app/state.json')).toBe('cache');
    expect(kindOf('notes/A/B/c.md')).toBe('datos');
    expect(REGENERABLE('.app/reviews.jsonl')).toBe(false); // la verdad de FSRS nunca es caché
    expect(DELETABLE('notes/x.md')).toBe(false);
    expect(DELETABLE('media/.app/perfil/a.jpg')).toBe(false);
    expect(DELETABLE('media/a.png')).toBe(true);
  });
  it('encuentra referencias de notas, mazos y espacios', () => {
    expect(refsIn('IO: ![[ecg.png]] y [[Clase 1]]\nsrc: docs/Harrison.pdf#p12\n[a](media/b%20c.jpg)')).toEqual(['ecg.png', 'Clase 1', 'media/b c.jpg', 'docs/Harrison.pdf']);
    expect(refsIn('{"panels":[{"type":"pdf","arg":"docs/H.pdf#p3"}]}')).toEqual(['docs/H.pdf']);
  });
  it('cuenta usos por ruta o por nombre y detecta huérfanos solo en media/', () => {
    const uses = countUses(['media/ecg.png', 'media/sobra.jpg', 'docs/H.pdf'], [
      { path: 'decks/Cardio.md', text: 'IO: ![[ecg.png]]' },
      { path: 'notes/A/B/n.md', text: '![[ecg.png]] ![[ecg.png]]' },
    ]);
    expect(uses.get('media/ecg.png')).toEqual(['decks/Cardio.md', 'notes/A/B/n.md']);
    expect(orphans(uses)).toEqual(['media/sobra.jpg']);
  });
});
