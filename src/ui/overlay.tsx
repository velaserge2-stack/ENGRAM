import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

/**
 * Gestor de capas: todo lo que flota (modales, menús, popovers, tooltips) se monta en un portal
 * sobre <body>, fuera de cualquier panel de vidrio. Un ancestro con `backdrop-filter` o `transform`
 * encierra a los `position: fixed` y los recortaba o solapaba (Papelera de Notas, ajustes del mazo
 * desde Hoy). La pila decide quién recibe Esc y quién atrapa el foco: solo la capa de arriba.
 */
interface Layer { id: number; close: () => void; modal: boolean; el: () => HTMLElement | null }
const stack: Layer[] = [];
let seq = 0;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function top(): Layer | undefined {
  return stack[stack.length - 1];
}

function onKey(e: KeyboardEvent) {
  const l = top();
  if (!l) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    l.close();
    return;
  }
  if (e.key !== 'Tab' || !l.modal) return;
  const root = l.el();
  if (!root) return;
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.getClientRects().length);
  if (!items.length) return (e.preventDefault(), root.focus());
  const first = items[0]!, last = items[items.length - 1]!;
  const a = document.activeElement;
  const outside = a === root || !root.contains(a);
  if (e.shiftKey && (a === first || outside)) (e.preventDefault(), last.focus());
  else if (!e.shiftKey && (a === last || outside)) (e.preventDefault(), first.focus());
}

/** Registra una capa en la pila mientras está montada. */
export function useLayer(close: () => void, opts: { modal: boolean; el: () => HTMLElement | null }) {
  const closeRef = useRef(close);
  closeRef.current = close;
  // useLayoutEffect: la capa existe desde el primer pintado (useEffect llega un cuadro tarde)
  useLayoutEffect(() => {
    const layer: Layer = { id: ++seq, close: () => closeRef.current(), modal: opts.modal, el: opts.el };
    if (!stack.length) document.addEventListener('keydown', onKey, true);
    stack.push(layer);
    const prev = document.activeElement as HTMLElement | null;
    if (opts.modal) {
      document.documentElement.classList.add('has-modal');
      const f = () => { const r = opts.el(); if (r && !r.contains(document.activeElement)) r.focus(); };
      queueMicrotask(f);
      requestAnimationFrame(f); // por si el clic que la abrió devolvió el foco a su botón
    }
    return () => {
      stack.splice(stack.indexOf(layer), 1);
      if (!stack.length) document.removeEventListener('keydown', onKey, true);
      if (!stack.some((x) => x.modal)) document.documentElement.classList.remove('has-modal');
      if (opts.modal && prev?.isConnected) prev.focus?.();
    };
  }, []);
}

/** ¿Hay una capa modal abierta? (los atajos globales la respetan) */
export const modalOpen = () => stack.some((x) => x.modal);

export function Portal(props: { children: ComponentChildren }) {
  return typeof document === 'undefined' ? null : createPortal(props.children, document.body);
}

/**
 * Menú o popover anclado a un elemento: se coloca debajo (o encima si no cabe), dentro de la
 * ventana; tocar fuera, Esc o desplazar la página lo cierra.
 */
export function Popover(props: { anchor: HTMLElement | null; onClose: () => void; children: ComponentChildren; label: string; role?: string; class?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayer(props.onClose, { modal: false, el: () => ref.current });
  useLayoutEffect(() => {
    const el = ref.current, a = props.anchor;
    if (!el || !a) return;
    const r = a.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight, M = 8;
    const left = Math.min(Math.max(M, r.left), innerWidth - w - M);
    const below = r.bottom + 6;
    const top = below + h + M <= innerHeight || r.top - h - 6 < M ? Math.min(below, innerHeight - h - M) : r.top - h - 6;
    setPos({ left, top: Math.max(M, top) });
  }, [props.anchor]);
  useEffect(() => {
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!ref.current?.contains(t) && !props.anchor?.contains(t)) props.onClose(); };
    const opened = performance.now();
    // solo si el ancla se movió; se ignora el desplazamiento que llega justo al abrir (inercia o el que acercó el botón)
    const scroll = (e: Event) => { const t = e.target as Node; if (performance.now() - opened < 250) return; if (t !== props.anchor && !ref.current?.contains(t) && props.anchor && t.contains?.(props.anchor)) props.onClose(); };
    document.addEventListener('pointerdown', down, true);
    addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('pointerdown', down, true); removeEventListener('scroll', scroll, true); };
  }, [props.anchor]);
  return (
    <Portal>
      <div ref={ref} class={`popover glass strong ${props.class ?? ''}`} role={(props.role ?? 'menu') as 'menu'} aria-label={props.label} tabIndex={-1}
        style={{ left: `${pos?.left ?? -9999}px`, top: `${pos?.top ?? -9999}px` }}>
        {props.children}
      </div>
    </Portal>
  );
}
