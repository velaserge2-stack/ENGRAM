// Montaje para e2e/mascot.mjs (lo sirve Vite; mismas instancias de Preact que la mascota).
import { render, h } from 'preact';
import { Mascot } from '../src/chat/mascot.tsx';
export const mount = (el, state, size) => render(h(Mascot, { state, size }), el);
