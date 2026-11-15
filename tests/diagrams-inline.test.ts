// @vitest-environment happy-dom
// P22 §2.2/§2.6: edición en el sitio sin cuadro modal (doble clic/toque, F2/Intro, fantasma, Tab encadenado, IME,
// pegar lista, doble clic en el vacío y en flechas), espacio + arrastre y zoom propio hasta 400 %. Medidor simulado.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { h, render } from 'preact';
import { useState } from 'preact/hooks';
import { DiagramCanvas } from '../src/diagrams/canvas';
import { DiagramEditor } from '../src/diagrams/editor';
import { buildModel } from '../src/diagrams/view';
import { clearMeasureCache, setMeasurer } from '../src/diagrams/measure';
import { commitInline, ensureVisible, isDoubleTap, neighbor, pasteEdits, previewText, zoomBy4 } from '../src/diagrams/inline';
import type { DiagramKind, Edit } from '../src/diagrams/types';

const PAD = 24;
let host: HTMLElement | null = null;
beforeEach(() => { setMeasurer((t, f) => t.length * (parseFloat(/(\d+)px/.exec(f)?.[1] ?? '15') * 0.5)); });
afterEach(() => { if (host) render(null, host); host?.remove(); host = null; setMeasurer(null); clearMeasureCache(); });
const flush = () => new Promise((r) => setTimeout(r, 0));

function geo(text: string, kind: DiagramKind) {
  const { doc, layout: L } = buildModel(text, kind);
  if (!L) throw new Error('sin acomodo');
  const scr = (wx: number, wy: number) => ({ x: wx + PAD - L.bounds.x, y: wy + PAD - L.bounds.y });
  const at = (id: string) => { const b = L.pos.get(id)!; return scr(b.x, b.y); };
  return { doc, L, scr, at };
}

function setup(text: string, kind: DiagramKind, phone = false) {
  host = document.createElement('div');
  document.body.appendChild(host);
  const edits: Edit[] = [];
  render(h(DiagramCanvas, { text, kind, phone, onEdit: (e: Edit) => edits.push(e), onEdits: (es: Edit[]) => edits.push(...es) }), host);
  const g = geo(text, kind);
  const board = host.querySelector<HTMLElement>('.diag-board')!;
  return { host, board, edits, ...g, ...ev(board) };
}

function ev(board: HTMLElement) {
  const fire = (type: string, p: { x: number; y: number }, pointerId = 1, pointerType = 'touch') =>
    board.dispatchEvent(new PointerEvent(type, { clientX: p.x, clientY: p.y, pointerId, pointerType, bubbles: true, button: 0 }));
  const tap = (p: { x: number; y: number }, pointerType = 'touch') => { fire('pointerdown', p, 1, pointerType); fire('pointerup', p, 1, pointerType); };
  const dbl = (p: { x: number; y: number }) => board.dispatchEvent(new MouseEvent('dblclick', { clientX: p.x, clientY: p.y, bubbles: true }));
  return { fire, tap, dbl };
}
const area = (root: ParentNode) => root.querySelector<HTMLTextAreaElement>('textarea.diag-inline');
const type = (ta: HTMLTextAreaElement, v: string) => { ta.value = v; ta.dispatchEvent(new Event('input', { bubbles: true })); };
const key = (el: Element, k: string, o: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
const noModal = (root: ParentNode) => { expect(root.querySelector('.sheet, [role=dialog]')).toBeNull(); expect(document.querySelector('.sheet, [role=dialog]')).toBeNull(); };
const node = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`.diag-node[data-id="${id}"]`)!;

describe('edición en el sitio', () => {
  it('doble clic abre un textarea sobre el nodo (sin hoja ni diálogo), con el texto seleccionado', async () => {
    const s = setup('[Alfa] --> [Beta]', 'flujo');
    s.dbl(s.at('n0'));
    await flush();
    const ta = area(s.host)!;
    expect(ta).not.toBeNull();
    expect(ta.getAttribute('role')).toBe('textbox');
    expect(ta.getAttribute('aria-label')).toBe('Editar texto del nodo');
    expect(ta.value).toBe('Alfa');
    expect(ta.selectionStart).toBe(0);
    expect(ta.selectionEnd).toBe(4);
    expect(node(s.host, 'n0').contains(ta)).toBe(true);
    expect(parseFloat(ta.style.fontSize)).toBeGreaterThanOrEqual(16); // iOS no amplía al enfocar
    noModal(s.host);
  });

  it('Intro confirma con UN rename; el nodo crece en vivo sin escribir; ⇧Intro hace salto de línea', async () => {
    const s = setup('[A] --> [B]', 'flujo');
    s.dbl(s.at('n0'));
    await flush();
    const w0 = parseInt(node(s.host, 'n0').style.width);
    const ta = area(s.host)!;
    type(ta, 'Un texto bastante más largo');
    await flush();
    expect(parseInt(node(s.host, 'n0').style.width)).toBeGreaterThan(w0);
    expect(s.edits).toEqual([]);
    key(ta, 'Enter', { shiftKey: true });
    expect(area(s.host)).not.toBeNull(); // no confirma: el navegador inserta el salto
    key(ta, 'Enter');
    await flush();
    expect(s.edits).toEqual([{ op: 'rename', id: 'n0', text: 'Un texto bastante más largo' }]);
    expect(area(s.host)).toBeNull();
    expect(s.host.querySelector('[role=status]')!.textContent).toBe('Texto guardado');
  });

  it('Esc cancela sin edición; sin cambios no hay rename; vacío restaura', async () => {
    const s = setup('[A] --> [B]', 'flujo');
    s.dbl(s.at('n0')); await flush();
    type(area(s.host)!, 'Otro'); key(area(s.host)!, 'Escape'); await flush();
    s.dbl(s.at('n0')); await flush();
    key(area(s.host)!, 'Enter'); await flush();
    s.dbl(s.at('n0')); await flush();
    type(area(s.host)!, '   '); key(area(s.host)!, 'Enter'); await flush();
    expect(s.edits).toEqual([]);
    expect(area(s.host)).toBeNull();
  });

  it('F2 e Intro sobre el nodo seleccionado editan; tocar fuera confirma', async () => {
    const s = setup('R\n- A', 'mapa');
    s.tap(s.at('n1')); await flush();
    key(node(s.host, 'n1'), 'F2'); await flush();
    expect(area(s.host)).not.toBeNull();
    type(area(s.host)!, 'A2');
    s.tap(s.scr(5000, 5000)); await flush();
    expect(s.edits).toEqual([{ op: 'rename', id: 'n1', text: 'A2' }]);
    key(node(s.host, 'n1'), 'Enter'); await flush(); // seleccionado → editar
    expect(area(s.host)).not.toBeNull();
  });

  it('doble toque (< 300 ms, < 10 px) abre el editor; toque + paneo no', async () => {
    const s = setup('[A] --> [B]', 'flujo');
    const p = s.at('n1');
    s.tap(p); s.tap({ x: p.x + 4, y: p.y + 3 });
    await flush();
    expect(area(s.host)).not.toBeNull();
    key(area(s.host)!, 'Escape'); await flush();
    s.tap(p); await new Promise((r) => setTimeout(r, 320)); s.tap(p);
    await flush();
    expect(area(s.host)).toBeNull();
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 299, x: 6, y: 7 })).toBe(true);
    expect(isDoubleTap({ t: 0, x: 0, y: 0 }, { t: 100, x: 12, y: 0 })).toBe(false);
  });

  it('IME: Intro durante la composición no confirma', async () => {
    const s = setup('[A] --> [B]', 'flujo');
    s.dbl(s.at('n0')); await flush();
    const ta = area(s.host)!;
    ta.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    type(ta, 'にほん');
    key(ta, 'Enter', { isComposing: true });
    key(ta, 'Enter');
    expect(s.edits).toEqual([]);
    ta.dispatchEvent(new Event('compositionend', { bubbles: true }));
    key(ta, 'Enter'); await flush();
    expect(s.edits).toEqual([{ op: 'rename', id: 'n0', text: 'にほん' }]);
  });
});

describe('crear sin modal (fantasma)', () => {
  it('Tab sobre el seleccionado = hijo fantasma ya colocado; vacío no escribe; con texto UN addChild con la forma heredada', async () => {
    const s = setup('(A) --> [B]', 'flujo');
    s.tap(s.at('n0')); await flush();
    key(node(s.host, 'n0'), 'Tab'); await flush();
    expect(s.host.querySelectorAll('.diag-node')).toHaveLength(3);
    expect(s.host.querySelector('.diag-ghost textarea.diag-inline')).not.toBeNull();
    key(area(s.host)!, 'Enter'); await flush();
    expect(s.edits).toEqual([]);
    expect(s.host.querySelectorAll('.diag-node')).toHaveLength(2);
    key(node(s.host, 'n0'), 'Tab'); await flush();
    type(area(s.host)!, 'Hijo'); key(area(s.host)!, 'Enter'); await flush();
    expect(s.edits).toEqual([{ op: 'addChild', parent: 'n0', text: 'Hijo', shape: 'round' }]);
    expect(s.host.querySelector('[role=status]')!.textContent).toBe('Nodo creado');
    noModal(s.host);
  });

  it('chip «+» sin onChip abre un hijo fantasma (no escribe «Nuevo nodo»)', async () => {
    const s = setup('R\n- A', 'mapa');
    s.tap(s.at('n1')); await flush();
    const chip = s.host.querySelector<HTMLElement>('[data-chip]')!;
    chip.click(); // teclado: detail 0
    await flush();
    expect(area(s.host)).not.toBeNull();
    expect(s.edits).toEqual([]);
  });

  it('doble clic en el vacío de un flujo crea un nodo con {x,y} del mundo', async () => {
    const s = setup('[A] --> [B]', 'flujo');
    s.dbl(s.scr(400, 300)); await flush();
    type(area(s.host)!, 'Suelto'); key(area(s.host)!, 'Enter'); await flush();
    expect(s.edits).toHaveLength(1);
    expect(s.edits[0]).toMatchObject({ op: 'splice', remove: 0, insert: ['[Suelto] {x=400,y=300}'] });
  });

  it('doble clic en el vacío de un mapa = hijo de la raíz', async () => {
    const s = setup('R\n- A', 'mapa');
    s.dbl(s.scr(3000, 3000)); await flush();
    type(area(s.host)!, 'B'); key(area(s.host)!, 'Enter'); await flush();
    expect(s.edits).toEqual([{ op: 'addChild', parent: 'n0', text: 'B' }]);
  });

  it('doble clic en una flecha sin etiqueta le agrega una', async () => {
    const s = setup('[A] --> [B]', 'flujo');
    const a = s.L.pos.get('n0')!, b = s.L.pos.get('n1')!;
    s.dbl(s.scr((a.x + b.x) / 2, (a.y + a.h / 2 + b.y - b.h / 2) / 2)); await flush();
    const ta = s.host.querySelector<HTMLTextAreaElement>('textarea[data-edge]')!;
    expect(ta).not.toBeNull();
    expect(ta.getAttribute('aria-label')).toBe('Editar etiqueta de la flecha');
    type(ta, 'sí'); key(ta, 'Enter'); await flush();
    expect(s.edits).toEqual([{ op: 'label', id: 'e0', label: 'sí' }]);
  });

  it('pegar 3 líneas con sangría en un nodo en edición = UN addTree', async () => {
    const s = setup('R\n- A', 'mapa');
    s.dbl(s.at('n1')); await flush();
    const ta = area(s.host)!;
    const pe = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    Object.defineProperty(pe, 'clipboardData', { value: { getData: () => '- Uno\n  - Dos\n- Tres' } });
    ta.dispatchEvent(pe);
    await flush();
    expect(pe.defaultPrevented).toBe(true);
    expect(s.edits).toEqual([{ op: 'addTree', parent: 'n1', items: [{ text: 'Uno', depth: 0 }, { text: 'Dos', depth: 1 }, { text: 'Tres', depth: 0 }] }]);
    expect(s.host.querySelector('[role=status]')!.textContent).toBe('Creadas 3 ramas');
  });
});

describe('editor: Tab encadena hijos sin modales, un paso de historial por nodo', () => {
  it('5 hijos con Tab = 5 escrituras y 5 pasos; ⌘Z ×5 vuelve al texto original', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    const calls: string[] = [];
    let cur = 'Tema\n';
    function Wrap() {
      const [src, setSrc] = useState(cur);
      return h(DiagramEditor, { kind: 'mapa', src, onText: (b: string, k?: string) => { calls.push(k ?? ''); cur = b; setSrc(b); } });
    }
    render(h(Wrap, {}), host);
    await flush();
    const board = host.querySelector<HTMLElement>('.diag-board')!;
    const e = ev(board);
    e.tap(geo(cur, 'mapa').at('n0')); await flush();
    key(node(host, 'n0'), 'Tab'); await flush();
    for (let i = 1; i <= 5; i++) {
      const ta = area(host)!;
      expect(ta).not.toBeNull();
      type(ta, 'H' + i);
      key(ta, 'Tab');
      await flush(); await flush();
      noModal(host);
    }
    key(area(host)!, 'Escape'); await flush(); // el sexto, vacío, se descarta
    expect(calls).toEqual(['action', 'action', 'action', 'action', 'action']);
    expect(cur).toBe('Tema\n- H1\n  - H2\n    - H3\n      - H4\n        - H5\n');
    const root = host.querySelector<HTMLElement>('.diag-editor')!;
    for (let i = 0; i < 5; i++) { key(root, 'z', { metaKey: true }); await flush(); }
    expect(cur).toBe('Tema\n');
  });

  it('«Añadir hijo» de la barra crea en el sitio (sin hoja) e Intro tras confirmar crea un hermano', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    let cur = 'Tema\n- A\n';
    function Wrap() {
      const [src, setSrc] = useState(cur);
      return h(DiagramEditor, { kind: 'mapa', src, onText: (b: string) => { cur = b; setSrc(b); } });
    }
    render(h(Wrap, {}), host);
    await flush();
    const e = ev(host.querySelector<HTMLElement>('.diag-board')!);
    e.tap(geo(cur, 'mapa').at('n1')); await flush();
    document.querySelector<HTMLButtonElement>('.diag-fbar [aria-label="Añadir hijo (Tab)"]')!.click();
    await flush();
    noModal(host);
    type(area(host)!, 'B'); key(area(host)!, 'Enter'); await flush(); await flush();
    expect(cur).toBe('Tema\n- A\n  - B\n');
    key(node(host, 'n2'), 'Enter'); await flush(); // recién confirmado: Intro = hermano
    type(area(host)!, 'C'); key(area(host)!, 'Enter'); await flush(); await flush();
    expect(cur).toBe('Tema\n- A\n  - B\n  - C\n');
  });
});

describe('vista: espacio + arrastre y zoom hasta 400 %', () => {
  it('espacio sostenido + arrastre con ratón sobre un nodo panea (sin move)', () => {
    const s = setup('[A] --> [B]', 'flujo');
    const stage = s.host.querySelector<HTMLElement>('.diag-board-stage')!;
    const before = stage.style.transform;
    key(s.board, ' ');
    const p = s.at('n1');
    s.fire('pointerdown', p, 1, 'mouse'); s.fire('pointermove', { x: p.x + 50, y: p.y + 20 }, 1, 'mouse'); s.fire('pointerup', { x: p.x + 50, y: p.y + 20 }, 1, 'mouse');
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
    expect(s.edits).toEqual([]);
    expect(stage.style.transform).not.toBe(before);
    expect(stage.style.transform).toContain('scale(1)');
  });

  it('el botón «acercar» llega a ×4 y no pasa', () => {
    const s = setup('[A] --> [B]', 'flujo');
    const zin = s.host.querySelectorAll<HTMLButtonElement>('.diag-tools button')[1]!;
    for (let i = 0; i < 12; i++) zin.click();
    const stage = s.host.querySelector<HTMLElement>('.diag-board-stage')!;
    expect(stage.style.transform).toContain('scale(4)');
    zin.click();
    expect(stage.style.transform).toContain('scale(4)');
    expect(zoomBy4({ k: 3.9, x: 0, y: 0 }, 1.25, 100, 100).k).toBe(4);
  });
});

describe('inline.ts (puro)', () => {
  it('previewText pinta el fantasma sin tocar el original; commit vacío = nada', () => {
    const p = previewText('R\n- A\n', 'mapa', { mode: 'new', parent: 'n0', shape: 'rect', text: '' });
    expect(p.text.split('\n')).toHaveLength(4);
    expect(p.id).toBe('n2');
    expect(commitInline('R\n- A\n', 'mapa', { mode: 'new', parent: 'n0', shape: 'rect', text: ' ' }).edits).toEqual([]);
    expect(commitInline('R\n- A\n', 'mapa', { mode: 'new', after: 'n1', shape: 'rect', text: 'B' })).toMatchObject({ edits: [{ op: 'addSibling', id: 'n1', text: 'B' }], id: 'n2' });
  });
  it('pegar en un flujo encadena addChild por profundidad; una línea = null', () => {
    const r = pasteEdits('[A]\n', 'flujo', { parent: 'n0' }, '- X\n  - Y')!;
    expect(r.edits).toEqual([{ op: 'addChild', parent: 'n0', text: 'X', shape: 'rect' }, { op: 'addChild', parent: 'n1', text: 'Y', shape: 'rect' }]);
    expect(pasteEdits('[A]\n', 'flujo', { parent: 'n0' }, 'solo una')).toBeNull();
  });
  it('vecino por dirección y paneo mínimo', () => {
    const pos = new Map([['a', { x: 0, y: 0 }], ['b', { x: 100, y: 10 }], ['c', { x: 0, y: 100 }]]);
    expect(neighbor(pos, 'a', 1, 0)).toBe('b');
    expect(neighbor(pos, 'a', 0, 1)).toBe('c');
    expect(neighbor(pos, 'a', -1, 0)).toBeNull();
    const v = { k: 1, x: 0, y: 0 };
    expect(ensureVisible(v, { x: 50, y: 50, w: 20, h: 20 }, { x0: 0, y0: 0, x1: 200, y1: 200 })).toBe(v);
    expect(ensureVisible(v, { x: 50, y: 300, w: 20, h: 20 }, { x0: 0, y0: 0, x1: 200, y1: 200 })).toEqual({ k: 1, x: 0, y: -126 });
  });
});
