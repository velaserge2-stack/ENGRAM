import { ACCENT_USES, type Settings } from './lib/settings';
import { accentVariant, readableOn, resolveColor } from './lib/palette';

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
  // acento: solo se activa en los usos elegidos (clases acc-*); lo demás sigue neutro
  const base = s.accent.color ? resolveColor(s.accent.color, mode === 'dark') : null;
  for (const u of ACCENT_USES) root.classList.toggle(`acc-${u}`, !!base && s.accent.usos.includes(u));
  if (base) {
    root.style.setProperty('--accent', accentVariant(base, mode).color);
    root.style.setProperty('--accent-fill', base);
    root.style.setProperty('--accent-fg', readableOn(base));
  } else for (const v of ['--accent', '--accent-fill', '--accent-fg']) root.style.removeProperty(v);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', mode === 'dark' ? '#000000' : '#f2f2f7'));
}

export function onSchemeChange(fn: () => void): () => void {
  darkMQ?.addEventListener('change', fn);
  return () => darkMQ?.removeEventListener('change', fn);
}

/**
 * Teléfono (Mejoras 2 · bloque B): una sola regla, que un iPad nunca cumple. Todo el CSS de móvil
 * cuelga de `html.is-phone` y todo el JS de `isPhone()`; iPad y web no cambian.
 */
export const PHONE_QUERY = '(max-width: 600px), (max-height: 500px) and (orientation: landscape)';
const phoneMQ = typeof matchMedia === 'function' ? matchMedia(PHONE_QUERY) : null;
export const isPhone = (): boolean => !!phoneMQ?.matches;

/** Mantiene `html.is-phone` al día (rotar, Split View) y avisa a quien escuche. */
export function trackPhone(fn?: (phone: boolean) => void): () => void {
  const on = () => (document.documentElement.classList.toggle('is-phone', isPhone()), fn?.(isPhone()));
  on();
  phoneMQ?.addEventListener('change', on);
  return () => phoneMQ?.removeEventListener('change', on);
}

/** Teclado en pantalla: expone su altura como --kb-inset (visualViewport) y `html.kb-open`. */
export function trackKeyboard(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const on = () => {
    const inset = Math.max(0, innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb-inset', `${inset}px`);
    document.documentElement.classList.toggle('kb-open', inset > 80);
  };
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
