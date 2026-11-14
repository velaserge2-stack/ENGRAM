import { describe, expect, it } from 'vitest';
import { History, LIMIT, runEdits } from '../src/diagrams/history';
import { orderEdits } from '../src/diagrams/editor';
import { parseDiagram } from '../src/diagrams/parse';
import type { Edit } from '../src/diagrams/types';

const MAPA = 'Cardiología\n- Anatomía\n  - Cámaras\n- Fisiología {x=120,y=-40}\n';
const FLUJO = '(Inicio) --> [Triaje]\n[Triaje] --> [Alta]\n';

describe('historial del editor', () => {
  it('deshacer y rehacer devuelven el texto exacto, varias veces', () => {
    const h = new History();
    let t = MAPA;
    const steps: Edit[][] = [
      [{ op: 'addChild', parent: 'n1', text: 'Nuevo' }],
      [{ op: 'rename', id: 'n0', text: 'Corazón' }],
      [{ op: 'fold', id: 'n1', folded: true }],
      [{ op: 'remove', id: 'n3' }],
    ];
    const seen = [t];
    for (const s of steps) { t = h.apply(t, 'mapa', s)!; expect(t).not.toBeNull(); seen.push(t); }
    for (let i = steps.length - 1; i >= 0; i--) { t = h.undo(t, 'mapa')!; expect(t).toBe(seen[i]); }
    expect(h.undo(t, 'mapa')).toBeNull();
    for (let i = 1; i <= steps.length; i++) { t = h.redo(t, 'mapa')!; expect(t).toBe(seen[i]); }
    expect(h.redo(t, 'mapa')).toBeNull();
  });

  it('un lote (Ordenar) es un solo paso y se deshace entero', () => {
    const h = new History();
    const doc = parseDiagram(FLUJO, 'flujo').doc;
    const moves = orderEdits(doc);
    expect(moves.length).toBe(3);
    const t = h.apply(FLUJO, 'flujo', moves)!;
    expect(t).toContain('{x=');
    expect(h.undo(t, 'flujo')).toBe(FLUJO);
    expect(h.done.length).toBe(0);
  });

  it('Ordenar en un mapa no mueve la raíz', () => {
    const e = orderEdits(parseDiagram(MAPA, 'mapa').doc);
    expect(e.some((x) => x.op === 'move' && x.id === 'n0')).toBe(false);
  });

  it('una acción nueva vacía lo rehacible; una edición sin efecto no registra', () => {
    const h = new History();
    const a = h.apply(FLUJO, 'flujo', [{ op: 'rename', id: 'n1', text: 'Valoración' }])!;
    const b = h.undo(a, 'flujo')!;
    expect(h.canRedo(b)).toBe(true);
    expect(h.apply(b, 'flujo', [{ op: 'rename', id: 'nope', text: 'x' }])).toBeNull();
    expect(h.canRedo(b)).toBe(true);
    h.apply(b, 'flujo', [{ op: 'rename', id: 'n1', text: 'Otra' }]);
    expect(h.undone.length).toBe(0);
  });

  it('si el texto cambió por fuera, el historial se descarta', () => {
    const h = new History();
    const a = h.apply(MAPA, 'mapa', [{ op: 'rename', id: 'n1', text: 'X' }])!;
    expect(h.canUndo(a + 'extra')).toBe(false);
    expect(h.undo(a + 'extra', 'mapa')).toBeNull();
    expect(h.done.length).toBe(0);
  });

  it('la pila está acotada', () => {
    const h = new History();
    let t = MAPA;
    for (let i = 0; i < LIMIT + 20; i++) t = h.apply(t, 'mapa', [{ op: 'rename', id: 'n1', text: 'a' + i }])!;
    expect(h.done.length).toBe(LIMIT);
  });

  it('runEdits omite las ediciones inválidas y encadena el inverso', () => {
    const r = runEdits(MAPA, 'mapa', [{ op: 'rename', id: 'zz', text: 'x' }, { op: 'rename', id: 'n1', text: 'Y' }]);
    expect(r.fwd.length).toBe(1);
    expect(runEdits(r.text, 'mapa', r.inv).text).toBe(MAPA);
  });
});
