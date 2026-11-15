// @vitest-environment happy-dom
// P22 §2.3: estilo en la barra (color, tamaño, letra, flechas, fondo) y asas de redimensionar. Todo es una edición
// del texto, un paso de historial por acción. Medidor simulado: «A» mide 56×36 (se pinta 44 de alto).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { useState } from 'preact/hooks';
import { DiagramCanvas } from '../src/diagrams/canvas';
import { DiagramEditor } from '../src/diagrams/editor';
import { buildModel } from '../src/diagrams/view';
import { clearMeasureCache, setMeasurer } from '../src/diagrams/measure';
import { clampSize, keyResize, resizeBox } from '../src/diagrams/handles';
import { colorEdit, edgeStyleEdit, presetEdit, sizeFieldEdit } from '../src/diagrams/toolbar';
import type { DiagramKind, Edit } from '../src/diagrams/types';

const PAD = 24;
let host: HTMLElement | null = null;
beforeEach(() => { setMeasurer((t, f) => t.length * (parseFloat(/(\d+)px/.exec(f)?.[1] ?? '15') * 0.5)); });
afterEach(() => { if (host) render(null, host); host?.remove(); host = null; setMeasurer(null); clearMeasureCache(); document.body.innerHTML = ''; });
const flush = () => new Promise((r) => setTimeout(r, 0));

function at(text: string, kind: DiagramKind, id: string) {
  const { layout: L } = buildModel(text, kind);
  const b = L!.pos.get(id)!;
  return { x: b.x + PAD - L!.bounds.x, y: b.y + PAD - L!.bounds.y };
}
const ptr = (el: Element, type: string, p: { x: number; y: number }, o: PointerEventInit = {}) =>
  el.dispatchEvent(new PointerEvent(type, { clientX: p.x, clientY: p.y, pointerId: 1, pointerType: 'mouse', bubbles: true, button: 0, ...o }));
const tap = (board: Element, p: { x: number; y: number }) => { ptr(board, 'pointerdown', p, { pointerType: 'touch' }); ptr(board, 'pointerup', p, { pointerType: 'touch' }); };
const key = (el: Element, k: string, o: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
const bar = (label: string) => document.querySelector<HTMLButtonElement>(`.diag-fbar button[aria-label="${label}"]`)!;

/** Editor con el texto en estado; `writes` cuenta las escrituras (= pasos de historial). */
async function editor(init: string, kind: DiagramKind, props: Record<string, unknown> = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  const s = { text: init, writes: 0 };
  function Wrap() {
    const [src, setSrc] = useState(init);
    return h(DiagramEditor, { kind, src, onText: (b: string) => { s.text = b; s.writes++; setSrc(b); }, ...props });
  }
  render(h(Wrap, {}), host);
  await flush();
  const board = host.querySelector<HTMLElement>('.diag-board')!;
  return { s, board, select: async (id: string) => { tap(board, at(s.text, kind, id)); await flush(); } };
}

describe('color por nodo', () => {
  it('elegir el color 3 = una edición attrs con color 3; «sin color» borra la clave', async () => {
    const { s, select } = await editor('Tema\n- A\n', 'mapa');
    await select('n1');
    bar('Amarillo').click(); await flush();
    expect(s.text).toBe('Tema\n- A {color=3}\n');
    expect(s.writes).toBe(1);
    bar('Sin color').click(); await flush();
    expect(s.text).toBe('Tema\n- A\n');
    expect(s.writes).toBe(2);
    expect(colorEdit(['n1'], 3)).toEqual({ op: 'attrs', ids: ['n1'], set: { color: 3 } });
    expect(colorEdit(['n1'], undefined)).toEqual({ op: 'attrs', ids: ['n1'], unset: ['color'] });
  });

  it('las 8 muestras tienen nombre traducido y cada botón es de 44 px de zona (CSS)', async () => {
    const { select } = await editor('Tema\n- A\n', 'mapa');
    await select('n1');
    const sw = [...document.querySelectorAll<HTMLElement>('.diag-fbar .diag-sw[data-c]')];
    expect(sw.map((b) => b.getAttribute('aria-label'))).toEqual(['Rojo', 'Naranja', 'Amarillo', 'Verde', 'Verde azulado', 'Azul', 'Morado', 'Rosa']);
  });

  it('«Aplicar a toda la rama» = UN paso con todos los ids; deshacer lo revierte de una vez', async () => {
    const { s, select, board } = await editor('Tema\n- A {color=2}\n  - B\n  - C\n- D\n', 'mapa');
    await select('n1');
    bar('Aplicar a toda la rama').click(); await flush();
    expect(s.text).toBe('Tema\n- A {color=2}\n  - B {color=2}\n  - C {color=2}\n- D\n');
    expect(s.writes).toBe(1);
    key(host!.querySelector('.diag-editor')!, 'z', { metaKey: true }); await flush();
    expect(s.text).toBe('Tema\n- A {color=2}\n  - B\n  - C\n- D\n');
    expect(board).toBeTruthy();
  });
});

describe('tamaño del cuadro', () => {
  it('S/M/L fijan w/h y Automático los borra', async () => {
    const { s, select } = await editor('[A] --> [B]', 'flujo');
    await select('n1');
    bar('Tamaño del cuadro').click(); await flush();
    const btn = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.diag-fpanel button')].find((b) => b.textContent === name)!;
    btn('Grande').click(); await flush();
    expect(s.text).toMatch(/w=240/); expect(s.text).toMatch(/h=80/);
    btn('Pequeño').click(); await flush();
    expect(s.text).toMatch(/w=96/); expect(s.text).toMatch(/h=44/);
    btn('Automático').click(); await flush();
    expect(s.text).not.toMatch(/w=|h=/);
  });

  it('pedir un ancho menor al mínimo medido sube al mínimo (campo y función pura)', async () => {
    const { s, select } = await editor('[A] --> [B]', 'flujo');
    await select('n1');
    bar('Tamaño del cuadro').click(); await flush();
    const inp = document.querySelector<HTMLInputElement>('.diag-fpanel label input')!;
    inp.value = '10'; key(inp, 'Enter'); await flush();
    expect(s.text).toMatch(/w=56/); // «A» mide 56 de ancho
    expect(sizeFieldEdit('n1', 10, undefined, { w: 56, h: 36 })).toEqual({ op: 'attrs', ids: ['n1'], set: { w: 56 }, unset: ['h'] });
    expect(clampSize(10, 5, { w: 56, h: 36 })).toEqual({ w: 56, h: 36 });
    expect(presetEdit('n1', 's', { w: 120, h: 60 })).toEqual({ op: 'attrs', ids: ['n1'], set: { w: 120, h: 60 } });
  });

  it('tamaño de letra S/L y ancho máximo', async () => {
    const { s, select } = await editor('[A] --> [B]', 'flujo');
    await select('n1');
    bar('Tamaño del cuadro').click(); await flush();
    document.querySelector<HTMLButtonElement>('.diag-fpanel button[aria-label="Tamaño de letra: Grande"]')!.click(); await flush();
    expect(s.text).toContain('fs=l');
    document.querySelector<HTMLButtonElement>('.diag-fpanel button[aria-label="Tamaño de letra: Mediano"]')!.click(); await flush();
    expect(s.text).not.toContain('fs=');
  });
});

describe('asas de redimensionar', () => {
  function canvas(text: string, kind: DiagramKind, phone = false) {
    host = document.createElement('div');
    document.body.appendChild(host);
    const edits: Edit[] = [];
    render(h(DiagramCanvas, { text, kind, phone, onEdit: (e: Edit) => edits.push(e), onEdits: (es: Edit[]) => edits.push(...es) }), host);
    return { edits, board: host.querySelector<HTMLElement>('.diag-board')! };
  }

  it('arrastrar un asa 30 fotogramas = UNA edición attrs al soltar; durante el gesto solo se mueve el DOM', async () => {
    const t = '[A] --> [B]';
    const { edits, board } = canvas(t, 'flujo');
    tap(board, at(t, 'flujo', 'n1')); await flush();
    const handle = host!.querySelector<HTMLElement>('[data-handle="se"]')!;
    expect(handle).not.toBeNull();
    const el = host!.querySelector<HTMLElement>('.diag-node[data-id="n1"]')!;
    ptr(handle, 'pointerdown', { x: 100, y: 100 });
    for (let i = 1; i <= 30; i++) ptr(handle, 'pointermove', { x: 100 + i * 2, y: 100 + i });
    expect(edits).toEqual([]);
    expect(parseFloat(el.style.width)).toBeGreaterThan(56);
    ptr(handle, 'pointerup', { x: 160, y: 130 });
    expect(edits.length).toBe(1);
    const e = edits[0] as Extract<Edit, { op: 'attrs' }>;
    expect(e.op).toBe('attrs');
    expect(e.ids).toEqual(['n1']);
    expect(Number.isInteger(e.set!.w)).toBe(true);
    expect(e.set!.w!).toBeGreaterThan(56);
    expect(Number.isInteger(e.set!.h)).toBe(true);
  });

  it('el costado derecho solo cambia el ancho; sin movimiento no hay edición; nunca baja del mínimo', async () => {
    const t = '[A] --> [B]';
    const { edits, board } = canvas(t, 'flujo');
    tap(board, at(t, 'flujo', 'n1')); await flush();
    const e = host!.querySelector<HTMLElement>('[data-handle="e"]')!;
    ptr(e, 'pointerdown', { x: 0, y: 0 }); ptr(e, 'pointerup', { x: 0, y: 0 });
    expect(edits).toEqual([]);
    ptr(e, 'pointerdown', { x: 0, y: 0 }); ptr(e, 'pointermove', { x: 20, y: 40 }); ptr(e, 'pointerup', { x: 20, y: 40 });
    expect(Object.keys((edits[0] as { set: object }).set)).toEqual(['w']);
    ptr(e, 'pointerdown', { x: 0, y: 0 }); ptr(e, 'pointermove', { x: -500, y: 0 }); ptr(e, 'pointerup', { x: -500, y: 0 });
    expect(resizeBox('e', 56, 44, -500, 0, { w: 56, h: 36 }).w).toBe(56);
  });

  it('⇧ ajusta a la rejilla de 8; las asas no salen en teléfono ni al editar en el sitio', async () => {
    expect(resizeBox('se', 56, 44, 19, 9, { w: 24, h: 24 }, true)).toEqual({ w: 96, h: 64 });
    const t = '[A] --> [B]';
    const p = canvas(t, 'flujo', true);
    tap(p.board, at(t, 'flujo', 'n1')); await flush();
    expect(host!.querySelector('[data-handle]')).toBeNull();
  });

  it('⌥+flecha con el foco en el nodo cambia el tamaño 8 px; sin ⌥ no cambia el tamaño', async () => {
    const { s, select } = await editor('[A] --> [B]', 'flujo');
    await select('n1');
    const n = host!.querySelector<HTMLElement>('.diag-node[data-id="n1"]')!;
    key(n, 'ArrowRight', { altKey: true }); await flush();
    expect(s.text).toMatch(/w=64/);
    expect(s.writes).toBe(1);
    expect(keyResize({ w: 64, h: 44 }, { w: 56, h: 36 }, 'ArrowUp')).toEqual({ w: 64, h: 36 });
    expect(keyResize({ w: 64, h: 44 }, { w: 56, h: 36 }, 'x')).toBeNull();
  });
});

describe('estilo de flecha y fondo', () => {
  it('flecha: color, grosor, punteado y extremo con edgeAttrs; «todas» = todos los ids en un paso', async () => {
    const t = '[A] --> [B]\n[B] --> [C]';
    const { s, board } = await editor(t, 'flujo');
    const m = at(t, 'flujo', 'n0'), m2 = at(t, 'flujo', 'n1');
    tap(board, { x: (m.x + m2.x) / 2, y: (m.y + m2.y) / 2 }); await flush();
    expect(document.querySelector('.diag-fbar [aria-label="Estilo de flecha"]')).not.toBeNull();
    bar('Azul').click(); await flush();
    expect(s.text.split('\n')[0]).toContain('color=6');
    document.querySelector<HTMLButtonElement>('.diag-fbar button[aria-label="Grosor 3"]')!.click(); await flush();
    expect(s.text.split('\n')[0]).toMatch(/w=3/);
    expect(s.writes).toBe(2);
    expect(edgeStyleEdit(['e1', 'e2'], { dash: true, fin: 'rombo', color: undefined })).toEqual({ op: 'edgeAttrs', ids: ['e1', 'e2'], set: { dash: true, fin: 'rombo' }, unset: ['color'] });
    const all = document.querySelector<HTMLInputElement>('.diag-all input')!;
    all.checked = true; all.dispatchEvent(new Event('change', { bubbles: true })); await flush();
    bar('Rojo').click(); await flush();
    expect(s.text.split('\n').every((l) => l.includes('color=1'))).toBe(true);
    expect(s.writes).toBe(3);
  });

  it('fondo: el selector escribe `# fondo:` (una edición); con onBackdrop delega (frontmatter)', async () => {
    const { s } = await editor('[A] --> [B]', 'flujo');
    const sel = () => host!.querySelector<HTMLSelectElement>('select[aria-label="Fondo del lienzo"]')!;
    sel().value = 'puntos'; sel().dispatchEvent(new Event('change', { bubbles: true })); await flush();
    expect(s.text.split('\n')[0]).toBe('# fondo: puntos');
    expect(s.writes).toBe(1);
    sel().value = 'cristal'; sel().dispatchEvent(new Event('change', { bubbles: true })); await flush();
    expect(s.text).toBe('[A] --> [B]');
    render(null, host!); host!.remove(); host = null;
    const got: string[] = [];
    const e2 = await editor('[A] --> [B]', 'flujo', { backdrop: 'gris', onBackdrop: (b: string) => got.push(b) });
    expect(sel().value).toBe('gris');
    sel().value = 'oscuro'; sel().dispatchEvent(new Event('change', { bubbles: true })); await flush();
    expect(got).toEqual(['oscuro']);
    expect(e2.s.writes).toBe(0);
  });
});
