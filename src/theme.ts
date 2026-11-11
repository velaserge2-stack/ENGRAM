import type { Settings } from './lib/settings';
import { COLOR_NAMES, fillFor, PALETTE, readableOn, resolveColor } from './lib/palette';

const darkMQ = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function isDark(s: Settings): boolean {
  return s.theme === 'dark' || (s.theme === 'auto' && !!darkMQ?.matches);
}

/** Aplica ajustes visuales como variables CSS (vista previa en vivo, sin recargar). */
export function applyTheme(s: Settings): void {
  const root = document.documentElement;
  const dark = isDark(s);
  if (s.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = s.theme;
  root.style.setProperty('--text-scale', String(s.textScale));
  root.style.setProperty('--glass-k', String(s.glass / 100));
  for (const n of COLOR_NAMES) {
    const c = PALETTE[n][dark ? 1 : 0];
    root.style.setProperty(`--c-${n}`, c);
    root.style.setProperty(`--on-${n}`, readableOn(c));
  }
  const accent = resolveColor(s.accent, dark);
  const fill = fillFor(accent);
  root.style.setProperty('--accent', accent);
  // rellenos con texto (botón primario, selección): variante con contraste AA
  root.style.setProperty('--accent-fill', fill.bg);
  root.style.setProperty('--on-accent', fill.fg);
  root.style.setProperty('--heat', accent);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#000000' : '#f2f2f7'));
}

export function onSchemeChange(fn: () => void): () => void {
  darkMQ?.addEventListener('change', fn);
  return () => darkMQ?.removeEventListener('change', fn);
}

/** Teclado en pantalla: expone su altura como --kb-inset (visualViewport). */
export function trackKeyboard(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const on = () => document.documentElement.style.setProperty('--kb-inset', `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`);
  vv.addEventListener('resize', on);
  vv.addEventListener('scroll', on);
}
