import { t } from '../i18n';
import { useEffect, useRef } from 'preact/hooks';
import { useApp } from '../state';
import { acquireMediaUrl, releaseMediaUrl } from './background';
import { resolveMedia } from '../data/ops';

/**
 * Prompt 14: los medios se cargan al acercarse a la pantalla (no todos al abrir una nota) y su
 * `blob:` se devuelve al desmontar. Un solo IntersectionObserver para toda la app; sin él
 * (navegador sin soporte), se cargan al montar como antes.
 */
const pending = new Map<Element, () => void>();
let io: IntersectionObserver | null = null;
function whenNear(el: Element, run: () => void) {
  if (!('IntersectionObserver' in window)) return run();
  io ??= new IntersectionObserver((es) => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      const f = pending.get(e.target);
      pending.delete(e.target);
      io!.unobserve(e.target);
      f?.();
    }
  }, { rootMargin: '1200px 0px' });
  pending.set(el, run);
  io.observe(el);
}
/** Carga ya todos los medios pendientes (imprimir o exportar a PDF ve la nota completa). */
export async function hydrateAllMedia(): Promise<void> {
  const all = [...pending.entries()];
  for (const [el, f] of all) (pending.delete(el), io?.unobserve(el), f());
  await Promise.all([...document.querySelectorAll<HTMLImageElement>('img[data-media]')].map((i) => (i.src ? i.decode().catch(() => {}) : null)));
}
if (typeof window !== 'undefined') addEventListener('beforeprint', () => void hydrateAllMedia());

/** HTML ya sanitizado + hidratación de medios (![[img]] → blob: URL de la bóveda). */
export function Html(props: { html: string; class?: string; tag?: 'div' | 'span' }) {
  const app = useApp();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const held: string[] = [];
    let alive = true;
    const nodes = [...el.querySelectorAll<HTMLElement>('[data-media]')];
    for (const m of nodes) {
      if (m.tagName === 'IMG') (m as HTMLImageElement).decoding = 'async';
      whenNear(m, async () => {
        const path = await resolveMedia(app.vault, m.dataset.media!);
        if (!alive) return;
        const url = path ? await acquireMediaUrl(app.vault, path) : null;
        if (path && url) held.push(path);
        if (!alive) return path && url ? void releaseMediaUrl(path) : undefined;
        if (url) (m as HTMLImageElement).src = url;
        else m.replaceWith(Object.assign(document.createElement('span'), { className: 'chip', textContent: t('md.falta_media', { media: m.dataset.media }) }));
      });
    }
    return () => {
      alive = false;
      for (const m of nodes) if (pending.delete(m)) io?.unobserve(m);
      for (const p of held.splice(0)) releaseMediaUrl(p);
    };
  }, [props.html]);
  const T = props.tag ?? 'div';
  return <T ref={ref as never} class={`md ${props.class ?? ''}`} data-user-content dangerouslySetInnerHTML={{ __html: props.html }} />;
}
