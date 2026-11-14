import { describe, expect, it } from 'vitest';
import { diagramFence, diagramKindOf, newDiagramNote, newDiagramText } from '../src/notes/diagramtype';
import { parseDiagram } from '../src/diagrams/parse';

describe('tipo de nota', () => {
  it('sin tipo o desconocido es nota', () => {
    expect(diagramKindOf('# Hola')).toBe('nota');
    expect(diagramKindOf('---\nmateria: X\n---\ncuerpo')).toBe('nota');
    expect(diagramKindOf('---\ntipo: raro\n---\n')).toBe('nota');
  });
  it('lee mapa, flujo y diagrama', () => {
    for (const k of ['mapa', 'flujo', 'diagrama'] as const) expect(diagramKindOf(`---\ntipo: ${k}\n---\nx`)).toBe(k);
  });
  it('las plantillas se leen sin errores', () => {
    for (const k of ['mapa', 'flujo', 'diagrama'] as const) {
      const r = parseDiagram(newDiagramText(k, 'Cardio'), k);
      expect(r.errors).toEqual([]);
      expect(r.doc.nodes.length).toBeGreaterThan(1);
    }
    expect(newDiagramText('mapa', 'Cardio').startsWith('Cardio\n')).toBe(true);
  });
  it('la nota nueva lleva tipo y se reconoce al leerla', () => {
    const t = newDiagramNote('flujo', '', '', 'Triaje', new Date(2026, 0, 2));
    expect(diagramKindOf(t)).toBe('flujo');
    expect(t).toContain('(Inicio) --> [Paso]');
  });
  it('detecta bloques de diagrama', () => {
    expect(diagramFence('```mapa\nA\n- B\n```')).toEqual({ kind: 'mapa', src: 'A\n- B' });
    expect(diagramFence('```js\nx\n```')).toBeNull();
  });
});
