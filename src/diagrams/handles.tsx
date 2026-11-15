// Asas de redimensionar del nodo seleccionado (P22 §2.3) y la parte pura del tamaño. Durante el arrastre solo se
// escribe el DOM (nodo y asas); al soltar sale UNA edición `attrs` con `w`/`h`. El cambio es simétrico respecto al
// centro (la esquina sigue al puntero) para que la vista previa coincida con lo que el acomodo pinta al escribir.
// Las asas se pintan ANTES que los chips «+» en el DOM: donde se solapan (costado derecho), el chip gana.
// Costado derecho: la zona táctil de 44 px se desplaza 12 px hacia dentro y el punto visible se queda sobre el borde,
// así no pisa la zona del chip derecho (que empieza 1 px fuera del borde).
import type { JSX } from 'preact';
import { t } from '../i18n';
import { DEFAULT_MAXW, measureNode } from './measure';
import { FONT_PX, MIN } from './view';
import type { DiagramKind, DiagramNode, Edit } from './types';

export type HandleId = 'nw' | 'ne' | 'sw' | 'se' | 'e';
export const HANDLES: HandleId[] = ['nw', 'ne', 'sw', 'se', 'e'];
const KEY: Record<HandleId, string> = {
  nw: 'diag.asa_arriba_izquierda', ne: 'diag.asa_arriba_derecha', sw: 'diag.asa_abajo_izquierda', se: 'diag.asa_abajo_derecha', e: 'diag.asa_lado_derecho',
};
export const SIZE_MIN = 24, SIZE_MAX = 2000, KEY_STEP = 8, SNAP = 8;
const ZONE = 44, INSET = 12;

export interface Size { w: number; h: number }

/** Tamaño mínimo medido de un nodo (sin `w`/`h` manuales). */
export function nodeMin(n: DiagramNode, kind: DiagramKind): Size {
  const m = measureNode({ text: n.text, shape: kind === 'mapa' ? 'rect' : n.shape, fontSize: FONT_PX[n.fs ?? 'm'], maxW: n.maxw ?? DEFAULT_MAXW });
  return { w: m.w, h: m.h };
}

/** Redondea y sube al mínimo medido; nunca fuera de 24–2000. */
export function clampSize(w: number, h: number, min: Size): Size {
  const f = (v: number, m: number) => Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.ceil(m), Math.round(v)));
  return { w: f(w, min.w), h: f(h, min.h) };
}

/** Nuevo tamaño al arrastrar un asa `dx,dy` unidades del mundo (simétrico; el costado solo cambia el ancho). ⇧ = rejilla de 8. */
export function resizeBox(hid: HandleId, w0: number, h0: number, dx: number, dy: number, min: Size, snap = false): Size {
  const sx = hid === 'nw' || hid === 'sw' ? -1 : 1, sy = hid === 'nw' || hid === 'ne' ? -1 : 1;
  let w = w0 + 2 * sx * dx, h = hid === 'e' ? h0 : h0 + 2 * sy * dy;
  if (snap) { w = Math.round(w / SNAP) * SNAP; if (hid !== 'e') h = Math.round(h / SNAP) * SNAP; }
  return clampSize(w, h, min);
}

/** ⌥+flechas: ±8 px de ancho (←→) o alto (↑↓). `null` si la tecla no es una flecha. */
export function keyResize(cur: Size, min: Size, key: string): Size | null {
  const d: Record<string, [number, number]> = { ArrowRight: [KEY_STEP, 0], ArrowLeft: [-KEY_STEP, 0], ArrowDown: [0, KEY_STEP], ArrowUp: [0, -KEY_STEP] };
  const v = d[key];
  return v ? clampSize(cur.w + v[0], cur.h + v[1], min) : null;
}

export const sizeEdit = (id: string, s: { w?: number; h?: number }): Edit => ({ op: 'attrs', ids: [id], set: s });
export const SIZE_PRESETS: Record<'s' | 'm' | 'l', Size> = { s: { w: 96, h: 44 }, m: { w: 160, h: 56 }, l: { w: 240, h: 80 } };

const place = (el: HTMLElement, hid: HandleId, c: { x: number; y: number }, w: number, h: number) => {
  const sx = hid === 'nw' || hid === 'sw' ? -1 : 1, sy = hid === 'nw' || hid === 'ne' ? -1 : hid === 'e' ? 0 : 1;
  const ox = hid === 'e' ? -ZONE / 2 - INSET : -ZONE / 2;
  el.style.transform = `translate(${Math.round(c.x + (sx * w) / 2)}px, ${Math.round(c.y + (sy * h) / 2)}px) scale(var(--diag-inv, 1)) translate(${ox}px, ${-ZONE / 2}px)`;
};

export interface HandlesProps {
  id: string;
  /** Caja del nodo en el mundo (x,y = centro). */
  box: { x: number; y: number; w: number; h: number };
  min: Size;
  /** Escala actual del lienzo (se lee en cada movimiento). */
  scale: () => number;
  /** Elemento del nodo, para mover el DOM durante el arrastre. */
  nodeEl: () => HTMLElement | null;
  onCommit: (id: string, size: { w: number; h?: number }) => void;
}

export function Handles(p: HandlesProps): JSX.Element {
  const c = { x: p.box.x, y: p.box.y };
  const h0 = Math.max(MIN, p.box.h);
  const down = (hid: HandleId) => (e: PointerEvent) => {
    if (e.button) return;
    e.stopPropagation(); e.preventDefault(); // ni paneo ni arrastre del nodo
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture?.(e.pointerId);
    const group = el.parentElement as HTMLElement;
    const node = p.nodeEl();
    const keep = node ? { w: node.style.width, h: node.style.height, t: node.style.transform } : null;
    let last: Size = { w: p.box.w, h: h0 };
    const move = (ev: PointerEvent) => {
      ev.stopPropagation();
      const k = p.scale() || 1;
      last = resizeBox(hid, p.box.w, h0, (ev.clientX - e.clientX) / k, (ev.clientY - e.clientY) / k, p.min, ev.shiftKey);
      const dh = Math.max(MIN, last.h);
      if (node) {
        node.style.width = `${last.w}px`; node.style.height = `${dh}px`;
        node.style.transform = `translate(${Math.round(c.x - last.w / 2)}px, ${Math.round(c.y - dh / 2)}px)`;
      }
      group.querySelectorAll<HTMLElement>('[data-handle]').forEach((b) => place(b, b.dataset.handle as HandleId, c, last.w, dh));
    };
    const end = (ev: PointerEvent, ok: boolean) => {
      ev.stopPropagation();
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', cancel);
      el.releasePointerCapture?.(e.pointerId);
      if (ok && (last.w !== p.box.w || (hid !== 'e' && last.h !== h0))) { p.onCommit(p.id, hid === 'e' ? { w: last.w } : last); return; }
      if (node && keep) { node.style.width = keep.w; node.style.height = keep.h; node.style.transform = keep.t; } // sin cambio: DOM como estaba
      group.querySelectorAll<HTMLElement>('[data-handle]').forEach((b) => place(b, b.dataset.handle as HandleId, c, p.box.w, h0));
    };
    const up = (ev: PointerEvent) => end(ev, true);
    const cancel = (ev: PointerEvent) => end(ev, false);
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', cancel);
  };
  return (
    <div class="diag-handles" data-handles={p.id}>
      {HANDLES.map((hid) => (
        <button type="button" key={hid} tabIndex={-1} class="diag-handle" data-handle={hid} aria-label={t(KEY[hid])}
          ref={(el) => { if (el) place(el, hid, c, p.box.w, h0); }} onPointerDown={down(hid)}>
          <span class="diag-handle-dot" />
        </button>
      ))}
    </div>
  );
}
