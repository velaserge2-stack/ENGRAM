import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Portal } from './overlay';

/**
 * Tooltip único para toda la app (sin `title` nativo). Lo muestra cualquier botón o enlace solo
 * con icono (tiene `aria-label` y ningún texto visible) o con `data-tip`; el texto es el mismo que
 * lee VoiceOver, así que ya está traducido. Aparece tras 400 ms con el puntero, al instante con el
 * foco del teclado y con una pulsación larga (500 ms) en táctil, que entonces no dispara la acción.
 */
const SEL = 'button, a[href], [role="button"], [data-tip]';
const HOVER_MS = 400, PRESS_MS = 500;

function tipFor(el: Element | null): { el: HTMLElement; text: string } | null {
  const t = el?.closest<HTMLElement>(SEL);
  if (!t || t.closest('.tooltip')) return null;
  const tip = t.dataset.tip;
  if (tip) return { el: t, text: tip };
  const label = t.getAttribute('aria-label');
  if (!label || t.textContent?.trim()) return null; // tiene texto visible: no hace falta
  return { el: t, text: label };
}

export function TooltipLayer() {
  const [cur, setCur] = useState<{ el: HTMLElement; text: string } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const press = useRef<{ x: number; y: number; el: HTMLElement } | null>(null);
  const swallow = useRef(false);
  const curRef = useRef(cur);
  curRef.current = cur;

  useEffect(() => {
    const clear = () => clearTimeout(timer.current);
    const hide = () => (clear(), setCur(null));
    const over = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const t = tipFor(e.target as Element);
      clear();
      if (!t) return setCur(null);
      timer.current = setTimeout(() => setCur(t), HOVER_MS);
    };
    const out = (e: PointerEvent) => { if (e.pointerType === 'mouse' && !tipFor(e.relatedTarget as Element)) hide(); };
    const focus = (e: FocusEvent) => {
      const t = tipFor(e.target as Element);
      if (t && t.el.matches(':focus-visible')) (clear(), setCur(t));
    };
    const down = (e: PointerEvent) => {
      const t = tipFor(e.target as Element);
      if (!t || curRef.current?.el !== t.el) hide();
      if (e.pointerType === 'mouse' || !t || t.el.closest('.tray-sq')) return; // los cuadritos ya usan la pulsación larga para su menú
      press.current = { x: e.clientX, y: e.clientY, el: t.el };
      timer.current = setTimeout(() => { press.current = null; swallow.current = true; setCur(t); }, PRESS_MS);
    };
    const move = (e: PointerEvent) => { const p = press.current; if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) ((press.current = null), clear()); };
    const up = () => { if (press.current) ((press.current = null), clear()); };
    // la pulsación larga muestra la ayuda: el clic que la sigue no ejecuta la acción
    const click = (e: MouseEvent) => { if (swallow.current) (e.preventDefault(), e.stopPropagation(), (swallow.current = false)); };
    const ctx = (e: Event) => { if (swallow.current || press.current) e.preventDefault(); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('click', click, true);
    document.addEventListener('contextmenu', ctx, true);
    document.addEventListener('keydown', key);
    addEventListener('scroll', hide, true);
    addEventListener('hashchange', hide);
    return () => {
      clear();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('contextmenu', ctx, true);
      document.removeEventListener('keydown', key);
      removeEventListener('scroll', hide, true);
      removeEventListener('hashchange', hide);
    };
  }, []);

  // un toque suelto (sin pulsación larga) no debe dejar el clic «tragado»
  useEffect(() => { if (!cur) swallow.current = false; }, [cur]);

  useLayoutEffect(() => {
    if (!cur || !box.current) return setPos(null);
    if (!cur.el.isConnected) return setCur(null);
    const r = cur.el.getBoundingClientRect(), w = box.current.offsetWidth, h = box.current.offsetHeight, M = 8;
    const below = r.top - h - 8 < M;
    setPos({ left: Math.min(Math.max(M, r.left + r.width / 2 - w / 2), innerWidth - w - M), top: below ? Math.min(r.bottom + 8, innerHeight - h - M) : r.top - h - 8, below });
  }, [cur]);

  if (!cur) return null;
  return (
    <Portal>
      <div ref={box} class={`tooltip glass strong${pos?.below ? ' below' : ''}`} aria-hidden="true" style={{ left: `${pos?.left ?? -9999}px`, top: `${pos?.top ?? -9999}px` }}>
        {cur.text}
      </div>
    </Portal>
  );
}
