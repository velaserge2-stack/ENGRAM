import { describe, expect, it } from 'vitest';
import { layoutLayered, layoutTree, nodeSize } from '../src/diagrams/layout';
import type { DiagramDoc } from '../src/diagrams/types';

const doc = (kind: 'flujo' | 'mapa'): DiagramDoc => ({ kind, eol: '\n', lines: [], edges: [{ id: 'e0', from: 'a', to: 'b', arrow: 'to', line: 0 }],
  nodes: [{ id: 'a', shape: 'rect', text: 'a', depth: 0, line: 0 }, { id: 'b', shape: 'rect', text: 'b', depth: 1, line: 1, parent: 'a' }] });

describe('layout con sizes', () => {
  it('sin sizes usa nodeSize; con sizes usa lo medido y los ids ausentes caen a nodeSize', () => {
    const d = doc('flujo');
    expect(layoutLayered(d, 'TB').pos.get('a')!.w).toBe(nodeSize(d.nodes[0]!).w);
    const l = layoutLayered(d, 'TB', new Map([['a', { w: 300, h: 90 }]]));
    expect(l.pos.get('a')).toMatchObject({ w: 300, h: 90 });
    expect(l.pos.get('b')!.w).toBe(nodeSize(d.nodes[1]!).w);
    expect(layoutTree(doc('mapa'), 'horizontal', new Map([['b', { w: 500, h: 70 }]])).pos.get('b')).toMatchObject({ w: 500, h: 70 });
  });
});
