import { useEffect, useRef, useState } from 'preact/hooks';
import { Portal } from './overlay';

/**
 * Pulsación larga = menú contextual; pulsación larga y arrastrar = mover (Prompt 6 · A).
 * Solo Pointer Events. Los destinos son elementos con `data-drop="<clave>"`. Mientras se
 * arrastra con el dedo se bloquea el desplazamiento (touchmove no pasivo) y el clic que
 * sigue a soltar no cuenta.
 */
let armed = false;
/** ¿Hay una pulsación larga en curso? (para que otros gestos, como deslizar, no la tomen) */
export const pressArmed = () => armed;

export function usePressDrag<T>(o: { onMenu: (item: T, el: HTMLElement) => void; onDrop: (item: T, dest: string) => void; label: (item: T) => string }) {
  const [drag, setDrag] = useState<{ item: T; x: number; y: number; over: string | null } | null>(null);
  const cb = useRef(o);
  cb.current = o;
  const eat = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const start = (e: PointerEvent, item: T) => {
    if (e.button > 0) return;
    const el = e.currentTarget as HTMLElement;
    const p = { x: e.clientX, y: e.clientY, armed: false, dragging: false };
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { p.armed = true; armed = true; }, 450);
    const over = (x: number, y: number) => ((document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-drop]') as HTMLElement | null)?.dataset.drop ?? null;
    const move = (ev: PointerEvent) => {
      const d = Math.hypot(ev.clientX - p.x, ev.clientY - p.y);
      if (!p.armed) { if (d > 8) clearTimeout(timer.current); return; }
      if (d > 8 || p.dragging) { p.dragging = true; setDrag({ item, x: ev.clientX, y: ev.clientY, over: over(ev.clientX, ev.clientY) }); }
    };
    const touch = (ev: TouchEvent) => { if (p.armed) ev.preventDefault(); };
    const up = (ev: PointerEvent) => {
      clearTimeout(timer.current);
      armed = false;
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      removeEventListener('touchmove', touch);
      if (p.dragging || p.armed) { eat.current = true; setTimeout(() => { eat.current = false; }, 0); }
      if (p.dragging) {
        setDrag(null);
        const dest = ev.type === 'pointerup' ? over(ev.clientX, ev.clientY) : null;
        if (dest !== null) cb.current.onDrop(item, dest);
      } else if (p.armed && ev.type === 'pointerup') cb.current.onMenu(item, el);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    addEventListener('touchmove', touch, { passive: false });
  };

  /** Props para la fila arrastrable. */
  const bind = (item: T) => ({
    onPointerDown: (e: PointerEvent) => start(e, item),
    onContextMenu: (e: MouseEvent) => { e.preventDefault(); cb.current.onMenu(item, e.currentTarget as HTMLElement); },
    onClickCapture: (e: MouseEvent) => { if (eat.current) { eat.current = false; e.preventDefault(); e.stopPropagation(); } },
    onDragStart: (e: DragEvent) => e.preventDefault(),
  });
  const ghost = drag && <Portal><div class="drag-ghost glass strong" aria-hidden="true" style={{ left: `${drag.x + 12}px`, top: `${drag.y + 12}px` }} data-user-content>{o.label(drag.item)}</div></Portal>;
  return { drag, bind, start, ghost };
}
