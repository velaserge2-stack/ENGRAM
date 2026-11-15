import { describe, expect, it } from 'vitest';
import {
  DRAG_SLOP, dragFrame, dropAt, exitPoint, fitView, handleAt, hitEdge, hitHandle, hitNode, isDrag, links, pathPoints,
  pinch, resolveNode, startDrag, toScreen, toWorld, wheel,
} from '../src/diagrams/gestures';
import { parseDiagram } from '../src/diagrams/parse';
import { layoutLayered, layoutTree } from '../src/diagrams/layout';

const flow = (n: number) => {
  const lines = [];
  for (let i = 1; i < n; i++) lines.push(`[N${Math.floor((i - 1) / 2)}] --> [N${i}]`);
  return lines.join('\n');
};

describe('gestos: puros', () => {
  it('umbral de 8 px entre toque y arrastre', () => {
    expect(DRAG_SLOP).toBe(8);
    expect(isDrag({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe(false); // 7.07 px
    expect(isDrag({ x: 0, y: 0 }, { x: 6, y: 6 })).toBe(true); // 8.49 px
  });

  it('pantalla ↔ mundo con escala y desplazamiento', () => {
    const v = { k: 2, x: 100, y: -50 };
    const w = toWorld(v, { x: 300, y: 150 });
    expect(w).toEqual({ x: 100, y: 100 });
    expect(toScreen(v, w)).toEqual({ x: 300, y: 150 });
  });

  it('pellizco: escala por razón de distancias y el punto medio queda fijo en el mundo', () => {
    const v0 = { k: 1, x: 0, y: 0 };
    const v = pinch(v0, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 });
    expect(v.k).toBeCloseTo(2);
    expect(toWorld(v, { x: 150, y: 100 })).toEqual({ x: 150, y: 100 });
    // dos dedos que se desplazan juntos: solo paneo
    const p = pinch(v0, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 30, y: 40 }, { x: 130, y: 40 });
    expect(p).toEqual({ k: 1, x: 30, y: 40 });
    // topes de canvaszoom
    expect(pinch(v0, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }).k).toBe(0.1);
    // dedos en el mismo punto: sin división por cero
    expect(Number.isFinite(pinch(v0, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 9, y: 9 }, { x: 9, y: 9 }).k)).toBe(true);
  });

  it('rueda: desplaza, o acerca anclada con Ctrl', () => {
    expect(wheel({ k: 1, x: 0, y: 0 }, 10, 20, false, { x: 0, y: 0 })).toEqual({ k: 1, x: -10, y: -20 });
    const z = wheel({ k: 1, x: 0, y: 0 }, 0, -50, true, { x: 40, y: 40 });
    expect(z.k).toBeGreaterThan(1);
    expect(toWorld(z, { x: 40, y: 40 }).x).toBeCloseTo(40);
  });

  it('ajustar encuadra los límites; sin tamaño, escala 1', () => {
    const b = { x: -100, y: -50, w: 200, h: 100 };
    const v = fitView(b, 248, 148, 24);
    expect(v.k).toBeCloseTo(1);
    expect(toScreen(v, { x: 0, y: 0 })).toEqual({ x: 124, y: 74 });
    expect(fitView(b, 848, 448, 24).k).toBeCloseTo(1.5);
    expect(fitView(b, 0, 0).k).toBe(1);
    expect(fitView({ x: 0, y: 0, w: 10, h: 10 }, 1000, 1000).k).toBe(1.5); // no agranda de más
  });

  it('nodo bajo un punto (alto mínimo de 44) y asa', () => {
    const pos = new Map([['a', { x: 0, y: 0, w: 100, h: 36 }], ['b', { x: 40, y: 0, w: 100, h: 36 }]]);
    expect(hitNode(pos, { x: 60, y: 0 })).toBe('b'); // el último pintado gana
    expect(hitNode(pos, { x: -40, y: 21 })).toBe('a'); // dentro de los 44 px
    expect(hitNode(pos, { x: 0, y: 30 })).toBeNull();
    const box = pos.get('a')!;
    expect(handleAt(box, 2)).toEqual({ x: 61, y: 0 });
    expect(hitHandle(box, { x: 61, y: 10 }, 2)).toBe(true);
    expect(hitHandle(box, { x: 61, y: 12 }, 2)).toBe(false); // 22 px de pantalla = 11 de mundo
  });

  it('flechas: trazos M/L/C y tolerancia', () => {
    expect(pathPoints('M 0 0 L 10 0 L 10 10')).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(pathPoints('M 0 0 C 0 50 100 50 100 100')).toHaveLength(9);
    const paths = new Map([['e1', 'M 0 0 L 100 0'], ['e2', 'M 0 50 C 0 100 100 100 100 150']]);
    expect(hitEdge(paths, { x: 50, y: 5 }, 10)).toBe('e1');
    expect(hitEdge(paths, { x: 50, y: 25 }, 10)).toBeNull();
    expect(hitEdge(paths, { x: 50, y: 100 }, 10)).toBe('e2');
    expect(exitPoint({ x: 0, y: 0, w: 100, h: 40 }, { x: 200, y: 0 })).toEqual({ x: 50, y: 0 });
  });

  it('arrastre de flujo: solo se mueve el nodo y sus flechas; posición final entera', () => {
    const doc = parseDiagram(flow(10), 'flujo').doc;
    const L = layoutLayered(doc, 'TB');
    const id = doc.nodes[1]!.id;
    const b = L.pos.get(id)!;
    const d = startDrag(doc, L, links(doc), id, { x: b.x, y: b.y })!;
    expect([...d.moving.keys()]).toEqual([id]);
    expect(d.touched.every((l) => l.from === id || l.to === id)).toBe(true);
    const f = dragFrame(d, L, { x: b.x + 30.4, y: b.y - 10 });
    expect(f.boxes.get(id)).toMatchObject({ x: b.x + 30.4, y: b.y - 10 });
    expect(f.paths.size).toBe(d.touched.length);
    expect(dropAt(d, { x: b.x + 30.4, y: b.y - 10 })).toEqual({ x: Math.round(b.x + 30.4), y: b.y - 10 });
  });

  it('arrastre de mapa: los descendientes sin posición propia siguen', () => {
    const doc = parseDiagram('R\n- A\n  - A1\n  - A2 {x=10,y=10}\n- B', 'mapa').doc;
    const L = layoutTree(doc);
    const a = doc.nodes[1]!;
    const d = startDrag(doc, L, links(doc), a.id, { x: 0, y: 0 })!;
    expect([...d.moving.keys()].map((id) => doc.nodes.find((n) => n.id === id)!.text)).toEqual(['A', 'A1']);
  });

  it('concurrencia: el id se resuelve por forma + texto si el documento cambió', () => {
    const before = parseDiagram('[A] --> [B]', 'flujo').doc;
    const b = before.nodes[1]!;
    const key = `${b.shape}\u0000${b.text}`;
    const after = parseDiagram('[Z]\n[A] --> [B]', 'flujo').doc; // los ids se recorren
    const id = resolveNode(after, b.id, key);
    expect(after.nodes.find((n) => n.id === id)?.text).toBe('B');
    expect(resolveNode(parseDiagram('[A]', 'flujo').doc, b.id, key)).toBeNull(); // borrado: se descarta
  });

  it('rendimiento: un fotograma de arrastre con 100 nodos < 16 ms (avisa, no falla)', () => {
    const doc = parseDiagram(flow(100), 'flujo').doc;
    const L = layoutLayered(doc, 'TB');
    const all = links(doc);
    const id = doc.nodes[0]!.id; // la raíz: más flechas tocadas
    const t0 = performance.now();
    const d = startDrag(doc, L, all, id, { x: 0, y: 0 })!;
    let worst = 0;
    for (let i = 0; i < 120; i++) {
      const s = performance.now();
      dragFrame(d, L, { x: i, y: i / 2 });
      worst = Math.max(worst, performance.now() - s);
    }
    const total = performance.now() - t0;
    console.info(`[gestos] 100 nodos: inicio+120 fotogramas ${total.toFixed(2)} ms; peor fotograma ${worst.toFixed(3)} ms`);
    if (worst >= 16) console.warn(`[gestos] fotograma de arrastre por encima de 16 ms: ${worst.toFixed(2)} ms`);
    expect(doc.nodes).toHaveLength(100);
  });
});
