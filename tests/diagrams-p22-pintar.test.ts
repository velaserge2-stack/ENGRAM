// @vitest-environment happy-dom
// P22 «pintar»: flechas sin <marker>, chips «+», color por nodo y texto largo sin recorte (medidor simulado).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { DiagramCanvas } from '../src/diagrams/canvas';
import { DiagramView } from '../src/diagrams/view';
import { clearMeasureCache, setMeasurer } from '../src/diagrams/measure';
import type { DiagramKind } from '../src/diagrams/types';

let host: HTMLElement | null = null;
beforeEach(() => { setMeasurer((t, f) => t.length * (parseFloat(/(\d+)px/.exec(f)?.[1] ?? '15') * 0.5)); });
afterEach(() => { if (host) render(null, host); host?.remove(); host = null; setMeasurer(null); clearMeasureCache(); });
const flush = () => new Promise((r) => setTimeout(r, 0));

function canvas(text: string, kind: DiagramKind, phone = false) {
  host = document.createElement('div'); document.body.appendChild(host);
  render(h(DiagramCanvas, { text, kind, phone, onEdit: () => {} }), host);
  return host;
}
const sty = (e: Element) => (e.getAttribute('style') ?? '').replace(/\s+/g, '');

describe('P22 flechas', () => {
  it('sin <marker>; línea y punta con el mismo color y opacidad 1', () => {
    const el = canvas('[A] --> [B] {color=2}', 'flujo');
    expect(el.querySelector('marker')).toBeNull();
    const line = el.querySelector<SVGElement>('path[data-path]')!, head = el.querySelector<SVGElement>('path[data-head]')!;
    expect(head.getAttribute('d')).toMatch(/^M /);
    expect(sty(line)).toContain('stroke:var(--diag-c2)');
    expect(sty(line)).toContain('stroke-opacity:1');
    expect(sty(head)).toContain('fill:var(--diag-c2)');
    expect(sty(head)).toContain('fill-opacity:1');
  });
  it('sin color: tinta opaca --diag-ink en la vista', () => {
    host = document.createElement('div'); document.body.appendChild(host);
    render(h(DiagramView, { text: '[A] --> [B]', kind: 'flujo' }), host);
    expect(host.querySelector('marker')).toBeNull();
    expect(sty(host.querySelector('path[data-head]')!)).toContain('fill:var(--diag-ink)');
    expect(sty(host.querySelector('path[data-path]')!)).toContain('stroke:var(--diag-ink)');
  });
});

describe('P22 chips', () => {
  it('ninguno sin selección', () => { expect(canvas('[A] --> [B]', 'flujo').querySelectorAll('.diag-chip')).toHaveLength(0); });
  it('flujo: 4 con aria-label; mapa: solo hacia afuera; teléfono: ninguno', async () => {
    const el = canvas('[A] --> [B]', 'flujo');
    const tap = (host2: HTMLElement) => {
      const b = host2.querySelector('.diag-board')!;
      const a = host2.querySelector<HTMLElement>('.diag-node')!;
      const mm = /translate\((-?\d+)px, (-?\d+)px\)/.exec(a.style.transform)!;
      const view = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec((host2.querySelector('.diag-board-stage') as HTMLElement).style.transform)!;
      const k = Number(view[3]);
      const q = { x: (Number(mm[1]) + parseInt(a.style.width) / 2) * k + Number(view[1]), y: (Number(mm[2]) + parseInt(a.style.height) / 2) * k + Number(view[2]) };
      for (const type of ['pointerdown', 'pointerup']) b.dispatchEvent(new PointerEvent(type, { clientX: q.x, clientY: q.y, pointerId: 1, pointerType: 'touch', bubbles: true, button: 0 }));
    };
    tap(el); await flush();
    const chips = [...el.querySelectorAll('.diag-chip')];
    expect(chips.map((c) => c.getAttribute('data-chip')).sort()).toEqual(['abajo', 'arriba', 'derecha', 'izquierda']);
    for (const c of chips) expect(c.getAttribute('aria-label')).toBeTruthy();
    render(null, el); el.remove();

    host = document.createElement('div'); document.body.appendChild(host);
    render(h(DiagramCanvas, { text: 'Raíz\n  Hijo', kind: 'mapa', onEdit: () => {} }), host);
    tap(host); await flush();
    expect([...host.querySelectorAll('.diag-chip')].map((c) => c.getAttribute('data-chip'))).toEqual(['derecha']);
    render(null, host); host.remove();

    host = document.createElement('div'); document.body.appendChild(host);
    render(h(DiagramCanvas, { text: '[A] --> [B]', kind: 'flujo', phone: true, onEdit: () => {} }), host);
    tap(host); await flush();
    expect(host.querySelectorAll('.diag-chip')).toHaveLength(0);
  });
});

describe('P22 color y texto', () => {
  it('color 3 aplica la clase que usa --diag-c3', () => {
    const el = canvas('[A] {color=3}\n[B]', 'flujo');
    const nodes = el.querySelectorAll('.diag-node');
    expect(nodes[0]!.classList.contains('diag-c3')).toBe(true);
    expect(nodes[1]!.className).not.toMatch(/diag-c\d/);
    expect(nodes[0]!.querySelector('.diag-text')!.hasAttribute('data-user-content')).toBe(true);
  });
  it('texto de 1000 caracteres: se pinta completo y la caja crece con las líneas medidas', () => {
    const long = ('palabra ').repeat(125).trim(); // 999 caracteres
    const el = canvas(`[${long}] --> [B]`, 'flujo');
    const n = el.querySelector<HTMLElement>('.diag-node')!;
    expect(n.querySelector('.diag-text')!.textContent).toBe(long);
    expect(n.textContent).not.toContain('…');
    expect(parseInt(n.style.height)).toBeGreaterThan(200);
    expect(n.style.fontSize).toBe('15px');
  });
});
