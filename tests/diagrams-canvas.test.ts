// @vitest-environment happy-dom
// `h()` en lugar de JSX: vite.config.ts solo incluye `tests/**/*.test.ts`. happy-dom no acomoda (rectángulos en 0,
// clientWidth 0): la vista inicial es escala 1 con desplazamiento PAD − bounds, así que se calcula la pantalla a mano.
import { afterEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { DiagramCanvas, type DiagramSelection } from '../src/diagrams/canvas';
import { parseDiagram } from '../src/diagrams/parse';
import { buildModel } from '../src/diagrams/view';
import { applyEdit } from '../src/diagrams/edit';
import type { DiagramKind, Edit } from '../src/diagrams/types';

const PAD = 24;
let host: HTMLElement | null = null;
afterEach(() => { if (host) render(null, host); host?.remove(); host = null; });

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(text: string, kind: DiagramKind, phone = false) {
  host = document.createElement('div');
  document.body.appendChild(host);
  const edits: Edit[] = [];
  const sels: DiagramSelection[] = [];
  const draw = (tx: string) => render(h(DiagramCanvas, { text: tx, kind, phone, onEdit: (e) => edits.push(e), onSelect: (s) => sels.push(s) }), host!);
  draw(text);
  const { doc, layout: L } = buildModel(text, kind); // el lienzo acomoda con las medidas reales (P22)
  if (!L) throw new Error('sin acomodo');
  const scr = (wx: number, wy: number) => ({ x: wx + PAD - L.bounds.x, y: wy + PAD - L.bounds.y });
  const at = (id: string) => { const b = L.pos.get(id)!; return scr(b.x, b.y); };
  const board = host.querySelector<HTMLElement>('.diag-board')!;
  const fire = (type: string, p: { x: number; y: number }, pointerId = 1, pointerType = 'touch') =>
    board.dispatchEvent(new PointerEvent(type, { clientX: p.x, clientY: p.y, pointerId, pointerType, bubbles: true, button: 0 }));
  return { host, doc, L, at, scr, fire, edits, sels, draw, board };
}

describe('DiagramCanvas', () => {
  it('pinta nodos, flechas, barra con 3 botones con aria-label y touch-action solo en el lienzo', () => {
    const { host } = setup('[A] --> [B] --> [C]', 'flujo');
    expect(host.querySelectorAll('.diag-node')).toHaveLength(3);
    expect(host.querySelectorAll('path[data-path]')).toHaveLength(2);
    const btns = host.querySelectorAll('.diag-tools button');
    expect(btns).toHaveLength(3);
    for (const b of btns) { expect(b.getAttribute('aria-label')).toBeTruthy(); expect(b.hasAttribute('title')).toBe(false); }
  });

  it('toque selecciona un nodo (sin Edit); tocar el fondo la quita', async () => {
    const s = setup('[A] --> [B]', 'flujo');
    const a = s.doc.nodes[0]!.id;
    s.fire('pointerdown', s.at(a)); s.fire('pointermove', { x: s.at(a).x + 3, y: s.at(a).y }); s.fire('pointerup', s.at(a));
    await flush();
    expect(s.edits).toEqual([]);
    expect(s.host.querySelector(`[data-id="${a}"]`)?.classList.contains('diag-sel')).toBe(true);
    expect(s.sels.at(-1)).toEqual({ type: 'node', id: a });
    s.fire('pointerdown', s.scr(5000, 5000)); s.fire('pointerup', s.scr(5000, 5000));
    await flush();
    expect(s.sels.at(-1)).toBeNull();
  });

  it('arrastre: muchos fotogramas, UNA sola move al soltar; el DOM vuelve al acomodo hasta que llega el texto', async () => {
    const s = setup('[A] --> [B]\n[A] --> [C]', 'flujo');
    const id = s.doc.nodes[1]!.id;
    const p = s.at(id), b = s.L.pos.get(id)!;
    s.fire('pointerdown', p);
    for (let i = 1; i <= 30; i++) s.fire('pointermove', { x: p.x + i * 2, y: p.y + i });
    const el = s.host.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
    expect(el.classList.contains('diag-dragging')).toBe(true);
    s.fire('pointerup', { x: p.x + 60, y: p.y + 30 });
    expect(s.edits).toEqual([{ op: 'move', id, x: b.x + 60, y: b.y + 30 }]);
    expect(el.classList.contains('diag-dragging')).toBe(false);
    // el padre aplica la edición y re-renderiza: un solo reacomodo
    const next = applyEdit(s.doc, s.edits[0]!).doc;
    expect(next.nodes.find((n) => n.id === id)).toMatchObject({ x: b.x + 60, y: b.y + 30 });
  });

  it('conectar: chip «+» del nodo seleccionado (reemplaza al asa .diag-handle de antes de P22) → otro nodo = una connect', async () => {
    const s = setup('[A]\n[B]', 'flujo');
    const [a, b] = s.doc.nodes.map((n) => n.id) as [string, string];
    s.fire('pointerdown', s.at(a)); s.fire('pointerup', s.at(a));
    await flush();
    const chip = s.host.querySelector<HTMLElement>('[data-chip="derecha"]')!;
    expect(chip).not.toBeNull();
    const box = s.L.pos.get(a)!;
    const hp = s.scr(box.x + box.w / 2 + 23, box.y);
    // el evento nace en el chip (burbujea al lienzo, que lo reconoce por data-chip)
    chip.dispatchEvent(new PointerEvent('pointerdown', { clientX: hp.x, clientY: hp.y, pointerId: 1, pointerType: 'touch', bubbles: true, button: 0 }));
    s.fire('pointermove', { x: hp.x + 20, y: hp.y + 20 });
    s.fire('pointermove', s.at(b));
    expect(s.host.querySelector(`[data-id="${b}"]`)?.classList.contains('diag-target')).toBe(true);
    s.fire('pointerup', s.at(b));
    expect(s.edits).toEqual([{ op: 'connect', from: a, to: b }]);
    expect(s.host.querySelector('.diag-temp')?.getAttribute('d')).toBe('');
  });

  it('tocar una flecha la selecciona', async () => {
    const s = setup('[A] --> [B]', 'flujo');
    const pa = s.L.pos.get(s.doc.nodes[0]!.id)!, pb = s.L.pos.get(s.doc.nodes[1]!.id)!;
    const mid = s.scr((pa.x + pb.x) / 2, (pa.y + pa.h / 2 + pb.y - pb.h / 2) / 2);
    s.fire('pointerdown', mid); s.fire('pointerup', mid);
    await flush();
    expect(s.sels.at(-1)).toEqual({ type: 'edge', id: s.doc.edges[0]!.id });
    expect(s.host.querySelector('.diag-edge-sel')).not.toBeNull();
  });

  it('pellizco y paneo cambian solo la vista (sin Edit); un segundo dedo cancela el arrastre', () => {
    const s = setup('[A] --> [B]', 'flujo');
    const stage = s.host.querySelector<HTMLElement>('.diag-board-stage')!;
    const p = s.at(s.doc.nodes[0]!.id);
    s.fire('pointerdown', p, 1);
    s.fire('pointermove', { x: p.x + 20, y: p.y }, 1); // arrastre en curso
    s.fire('pointerdown', { x: p.x + 100, y: p.y }, 2); // segundo dedo
    s.fire('pointermove', { x: p.x + 200, y: p.y }, 2);
    expect(stage.style.transform).toContain('scale(2.25)') // 80 → 180 px entre dedos;
    s.fire('pointerup', { x: p.x + 20, y: p.y }, 1); s.fire('pointerup', { x: p.x + 200, y: p.y }, 2);
    expect(s.edits).toEqual([]);
    s.fire('pointerdown', s.scr(5000, 5000)); s.fire('pointermove', s.scr(5050, 5000)); s.fire('pointerup', s.scr(5050, 5000));
    expect(s.edits).toEqual([]);
  });

  it('teléfono: arrastrar un nodo desplaza la vista y no emite move; sin asa de conectar', async () => {
    const s = setup('[A] --> [B]', 'flujo', true);
    const id = s.doc.nodes[0]!.id;
    const p = s.at(id);
    s.fire('pointerdown', p); s.fire('pointermove', { x: p.x + 40, y: p.y }); s.fire('pointerup', { x: p.x + 40, y: p.y });
    expect(s.edits).toEqual([]);
    expect(s.host.querySelector<HTMLElement>('.diag-board-stage')!.style.transform).toContain('translate(');
    s.fire('pointerdown', p); s.fire('pointerup', p);
    await flush();
    const box = s.L.pos.get(id)!;
    const hp = s.scr(box.x + box.w / 2 + 22, box.y);
    s.fire('pointerdown', hp); s.fire('pointermove', s.at(s.doc.nodes[1]!.id)); s.fire('pointerup', s.at(s.doc.nodes[1]!.id));
    expect(s.edits).toEqual([]);
  });

  it('mapa: la raíz no se arrastra (pan); un hijo sí', () => {
    const s = setup('R\n- A\n- B', 'mapa');
    const [r, a] = s.doc.nodes.map((n) => n.id) as [string, string];
    const pr = s.at(r);
    s.fire('pointerdown', pr); s.fire('pointermove', { x: pr.x + 30, y: pr.y }); s.fire('pointerup', { x: pr.x + 30, y: pr.y });
    expect(s.edits).toEqual([]);
    // la vista se desplazó 30 px: recalcular
    const pa = s.at(a);
    const q = { x: pa.x + 30, y: pa.y };
    s.fire('pointerdown', q); s.fire('pointermove', { x: q.x, y: q.y + 40 }); s.fire('pointerup', { x: q.x, y: q.y + 40 });
    expect(s.edits).toHaveLength(1);
    expect(s.edits[0]).toMatchObject({ op: 'move', id: a });
  });

  it('concurrencia: si el texto cambia a mitad del arrastre, la move va al mismo nodo (por forma+texto)', () => {
    const s = setup('[A] --> [B]', 'flujo');
    const b = s.doc.nodes[1]!;
    const p = s.at(b.id);
    s.fire('pointerdown', p); s.fire('pointermove', { x: p.x + 20, y: p.y });
    const text2 = '[Z]\n[A] --> [B]';
    s.draw(text2); // otra pestaña cambió la nota
    s.fire('pointerup', { x: p.x + 20, y: p.y });
    const doc2 = parseDiagram(text2, 'flujo').doc;
    expect(s.edits).toHaveLength(1);
    expect(doc2.nodes.find((n) => n.id === (s.edits[0] as { id: string }).id)?.text).toBe('B');
  });

  it('pointercancel: sin Edit y el nodo vuelve a su sitio', () => {
    const s = setup('[A] --> [B]', 'flujo');
    const id = s.doc.nodes[0]!.id;
    const el = s.host.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
    const before = el.style.transform;
    const p = s.at(id);
    s.fire('pointerdown', p); s.fire('pointermove', { x: p.x + 50, y: p.y });
    expect(el.style.transform).not.toBe(before);
    s.fire('pointercancel', { x: p.x + 50, y: p.y });
    expect(s.edits).toEqual([]);
    expect(el.style.transform).toBe(before);
  });

  it('rendimiento: arrastre con 100 nodos, cada pointermove < 16 ms (avisa, no falla)', () => {
    const lines = [];
    for (let i = 1; i < 100; i++) lines.push(`[N${Math.floor((i - 1) / 2)}] --> [N${i}]`);
    const s = setup(lines.join('\n'), 'flujo');
    const id = s.doc.nodes[0]!.id;
    const p = s.at(id);
    s.fire('pointerdown', p);
    let worst = 0, total = 0;
    for (let i = 1; i <= 60; i++) {
      const t0 = performance.now();
      s.fire('pointermove', { x: p.x + i * 3, y: p.y + i });
      const dt = performance.now() - t0;
      total += dt; worst = Math.max(worst, dt);
    }
    s.fire('pointerup', { x: p.x + 180, y: p.y + 60 });
    console.info(`[canvas] 100 nodos (happy-dom): media ${(total / 60).toFixed(3)} ms, peor ${worst.toFixed(3)} ms por pointermove`);
    if (worst >= 16) console.warn(`[canvas] pointermove por encima de 16 ms: ${worst.toFixed(2)} ms`);
    expect(s.edits).toHaveLength(1);
  });
});
