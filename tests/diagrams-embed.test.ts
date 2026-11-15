import { describe, expect, it } from 'vitest';
import { embedName, resolveDiagramEmbed } from '../src/diagrams/embed';
import { diagramKindOf, newDiagramNote } from '../src/notes/diagramtype';
import { createIndex } from '../src/notes/search';

const mapa = newDiagramNote('mapa', 'Bio', '', 'Ciclo de Krebs', new Date(2026, 0, 2));
const notes = [
  { path: 'notes/Bio/Ciclo de Krebs.md', title: 'Ciclo de Krebs' },
  { path: 'notes/Bio/Corazón y Pulmón.md', title: 'Corazón y Pulmón' },
  { path: 'notes/Bio/Normal.md', title: 'Normal' },
];
const texts = new Map([
  [notes[0]!.path, mapa],
  [notes[1]!.path, '---\ntipo: flujo\n---\n(Inicio) --> [Sístole] --> (Fin)\n'],
  [notes[2]!.path, '# Una nota\ntexto'],
]);

describe('embed de nota de diagrama', () => {
  it('embedName solo acepta ![[nombre]] como bloque', () => {
    expect(embedName('![[Mi mapa]]')).toBe('Mi mapa');
    expect(embedName('  ![[Mi mapa]]\n')).toBe('Mi mapa');
    expect(embedName('![[foto.png]]')).toBeNull();
    expect(embedName('![[a|alias]]')).toBeNull();
    expect(embedName('texto ![[a]]')).toBeNull();
  });
  it('nota de diagrama: tipo, ruta y cuerpo sin frontmatter', () => {
    const r = resolveDiagramEmbed('Ciclo de Krebs', notes, texts);
    expect(r).toMatchObject({ state: 'diagram', kind: 'mapa', path: notes[0]!.path, title: 'Ciclo de Krebs' });
    expect(r && r.state === 'diagram' && r.src.startsWith('Ciclo de Krebs\n')).toBe(true);
  });
  it('acentos, espacios, mayúsculas, NFD y extensión .md', () => {
    expect(resolveDiagramEmbed('corazón y pulmón', notes, texts)).toMatchObject({ state: 'diagram', kind: 'flujo' });
    expect(resolveDiagramEmbed('Corazón y Pulmón.md', notes, texts)).toMatchObject({ state: 'diagram' });
    expect(resolveDiagramEmbed('Bio/Ciclo de Krebs', notes, texts)).toMatchObject({ state: 'diagram' });
  });
  it('nota normal: null (comportamiento de siempre); inexistente: falta', () => {
    expect(resolveDiagramEmbed('Normal', notes, texts)).toBeNull();
    expect(resolveDiagramEmbed('No existe', notes, texts)).toEqual({ state: 'missing', name: 'No existe' });
  });
  it('diagramKindOf', () => {
    expect(diagramKindOf('---\ntipo: Mapa\n---\nx')).toBe('mapa');
    expect(diagramKindOf('texto')).toBe('nota');
  });
  it('el texto de los nodos del diagrama se indexa tal cual', () => {
    const ix = createIndex();
    ix.add({ id: 'notes/Bio/Corazón y Pulmón.md', title: 'Corazón y Pulmón', body: '(Inicio) --> [Sístole ventricular] --> (Fin)\n', materia: 'Bio', tema: '', fecha: '' });
    expect(ix.search('ventricular').map((r) => r.id)).toEqual(['notes/Bio/Corazón y Pulmón.md']);
  });
});
