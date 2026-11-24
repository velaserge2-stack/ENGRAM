import { useEffect, useMemo, useReducer } from 'preact/hooks';
import { getStatus, messages, subscribe } from './history';
import './mascot.css';

/** Nombre fijo de la mascota (no se traduce). */
export const MASCOT_NAME = 'GREX';

export type MascotState = 'idle' | 'listening' | 'thinking' | 'responding' | 'error';

/** Estado de la mascota: error si el turno falló · responding con texto en curso · thinking sin texto aún · listening con foco o texto en el campo · idle. */
export function mascotState(typing: boolean, msgs = messages(), st = getStatus()): MascotState {
  const last = msgs[msgs.length - 1];
  if (!st.busy && last?.role === 'error') return 'error';
  if (st.busy) return last?.role === 'assistant' && last.text ? 'responding' : 'thinking';
  return typing ? 'listening' : 'idle';
}
/** Se actualiza con el historial (turnos aunque el panel esté cerrado). */
export function useMascotState(typing = false): MascotState {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribe(bump as () => void), []);
  return mascotState(typing);
}

// Las animaciones se pausan con la pestaña oculta (clase en <html>; la lee mascot.css).
if (typeof document !== 'undefined' && 'hidden' in document) {
  const sync = () => document.documentElement.classList.toggle('mascot-hidden', document.hidden);
  document.addEventListener('visibilitychange', sync);
  sync();
}

let uid = 0;
/** GREX: cuadrado de esquinas muy redondeadas (decorativa: el botón que la contiene pone el aria-label). Colores y movimiento en mascot.css. */
export function Mascot(p: { state?: MascotState; size?: number | undefined }) {
  const size = p.size ?? 44;
  // parpadeo lento, cada 4–6 s con desfase propio; id propio para el degradado
  const own = useMemo(() => ({ id: `mg${++uid}`, blink: { '--blink': `${(4 + Math.random() * 2).toFixed(2)}s`, '--blink-delay': `${(Math.random() * 3).toFixed(2)}s` } }), []);
  return (
    <svg class="mascot" data-state={p.state ?? 'idle'} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false" style={own.blink}>
      <defs><linearGradient id={own.id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="g0" /><stop offset="1" class="g1" /></linearGradient></defs>
      <ellipse class="shadow" cx="32" cy="60.5" rx="16" ry="2.2" />
      <g class="body">
        <rect class="face" x="6" y="7" width="52" height="50" rx="20" fill={`url(#${own.id})`} />
        <g class="eyes">
          <g class="blink"><ellipse class="feat" cx="24" cy="30" rx="3.1" ry="4.1" /><ellipse class="feat" cx="40" cy="30" rx="3.1" ry="4.1" /><circle class="shine" cx="25.2" cy="28.4" r="1.15" /><circle class="shine" cx="41.2" cy="28.4" r="1.15" /></g>
        </g>
        <g class="sad"><path d="M20.5 32q3.5-5 7 0M36.5 32q3.5-5 7 0" /></g>
        <ellipse class="cheek" cx="16.5" cy="38.5" rx="4" ry="2.5" /><ellipse class="cheek" cx="47.5" cy="38.5" rx="4" ry="2.5" />
        <path class="smile" d="M28.5 38.6q3.5 3.4 7 0" />
        <ellipse class="talk" cx="32" cy="40" rx="3" ry="2.4" />
        <path class="frown" d="M29.5 42.5q2.5-2.2 5 0" />
      </g>
      <g class="dots"><circle cx="48" cy="6" r="1.8" /><circle cx="53" cy="4" r="2.1" /><circle cx="59" cy="2.5" r="2.4" /></g>
    </svg>
  );
}
