import type { Settings } from './lib/settings';

const darkMQ = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function resolvedMode(s: Settings): 'dark' | 'light' {
  return s.glassMode === 'auto' ? (darkMQ?.matches === false ? 'light' : 'dark') : s.glassMode;
}

/** Aplica el tema Cristal como tokens CSS (vista previa en vivo, sin recargar). */
export function applyTheme(s: Settings): void {
  const root = document.documentElement;
  const mode = resolvedMode(s);
  root.dataset.glass = mode;
  root.style.setProperty('--text-scale', String(s.textScale));
  root.style.setProperty('--k', String(s.glass / 100));
  root.classList.toggle('light-mode', s.lightMode);
  root.classList.toggle('semantic', s.semanticColor);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', mode === 'dark' ? '#000000' : '#f2f2f7'));
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

/** Mide fotogramas al desplazar; si son lentos, sugiere el modo ligero. */
export function watchFrames(onSlow: () => void): void {
  let frames = 0;
  let t0 = 0;
  let measuring = false;
  let reported = false;
  const loop = (t: number) => {
    if (!t0) t0 = t;
    frames++;
    if (t - t0 < 1000) requestAnimationFrame(loop);
    else {
      measuring = false;
      if (frames < 40 && !reported) ((reported = true), onSlow());
    }
  };
  addEventListener(
    'scroll',
    () => {
      if (measuring || reported) return;
      measuring = true;
      frames = 0;
      t0 = 0;
      requestAnimationFrame(loop);
    },
    { passive: true, capture: true },
  );
}
