import { useMemo } from 'preact/hooks';
import './mascot.css';

/**
 * Nombres propuestos para la mascota (solo constante, sin UI; originales y cortos, iguales en es/en/fr):
 * «Moti», «Nubi», «Tico».
 */
export const MASCOT_NAMES = ['Moti', 'Nubi', 'Tico'] as const;

export type MascotState = 'idle' | 'listening' | 'thinking' | 'responding' | 'error';

// Las animaciones se pausan con la pestaña oculta (clase en <html>; la lee mascot.css).
if (typeof document !== 'undefined' && 'hidden' in document) {
  const sync = () => document.documentElement.classList.toggle('mascot-hidden', document.hidden);
  document.addEventListener('visibilitychange', sync);
  sync();
}

/** Mascota SVG del Asistente (decorativa: el botón que la contiene pone el aria-label). */
export function Mascot(p: { state?: MascotState; size?: number | undefined }) {
  const size = p.size ?? 44;
  // parpadeo lento, cada 4–6 s con desfase propio
  const blink = useMemo(() => ({ '--blink': `${(4 + Math.random() * 2).toFixed(2)}s`, '--blink-delay': `${(Math.random() * 3).toFixed(2)}s` }), []);
  return (
    <svg class="mascot" data-state={p.state ?? 'idle'} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" style={blink}>
      <g class="body">
        <path class="head" d="M32 7c14 0 24 9 24 24 0 15-9 26-24 26S8 46 8 31C8 16 18 7 32 7z" />
        <g class="eyes">
          <ellipse class="eye" cx="23" cy="29" rx="3" ry="3.4" />
          <ellipse class="eye" cx="41" cy="29" rx="3" ry="3.4" />
        </g>
        <path class="brow" d="M17 24l9-2M47 24l-9-2" />
        <path class="mouth mouth-smile" d="M26 40q6 5 12 0" />
        <ellipse class="mouth mouth-o" cx="32" cy="41" rx="2.4" ry="2.8" />
        <path class="mouth mouth-flat" d="M27 41h10" />
        <ellipse class="mouth-open" cx="32" cy="41" rx="4.5" ry="4" />
        <path class="mouth mouth-sad" d="M26 43q6-5 12 0" />
      </g>
    </svg>
  );
}
