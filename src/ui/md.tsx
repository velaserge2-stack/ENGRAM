import { t } from '../i18n';
import { useEffect, useRef } from 'preact/hooks';
import { useApp } from '../state';
import { acquireMediaUrl, releaseMediaUrl } from './background';
import { resolveMedia } from '../data/ops';
import { dimsOf, loadDims, mediaThumbUrl, releaseThumb } from '../notes/thumbs';

/**
 * Prompt 14: los medios se cargan al acercarse a la pantalla (no todos al abrir una nota) y su
 * `blob:` se devuelve al desmontar. Un solo IntersectionObserver para toda la app; sin él
 * (navegador sin soporte), se cargan al montar como antes.
 * Notas-Pro · A1: las imágenes muestran su miniatura (`mediaThumbUrl`, caché `.app/thumbs/`),
 * con el alto reservado si ya se conoce su proporción; el audio usa el préstamo de URL.
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

/** Reserva el alto con la proporción (y, sin `|ancho`, el ancho natural acotado): el desplazamiento no salta. */
function reserve(m: HTMLElement, d: { w: number; h: number }) {
  m.style.aspectRatio = `${d.w} / ${d.h}`;
  if (!m.hasAttribute('width')) m.style.width = `min(100%, ${d.w}px)`;
}
const missingChip = (name: string) => Object.assign(document.createElement('span'), { className: 'chip', textContent: t('md.falta_media', { media: name }) });

/** HTML ya sanitizado + hidratación de medios (![[img]] → blob: URL de la bóveda). */
export function Html(props: { html: string; class?: string; tag?: 'div' | 'span' }) {
  const app = useApp();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const thumbs: string[] = [];
    const loans: string[] = [];
    const nodes = [...el.querySelectorAll<HTMLElement>('[data-media]')];
    const image = async (m: HTMLImageElement) => {
      const path = await resolveMedia(app.vault, m.dataset.media!);
      if (!alive) return;
      if (!path) return m.replaceWith(missingChip(m.dataset.media!));
      thumbs.push(path);
      const r = await mediaThumbUrl(app.vault, path);
      if (!alive) return;
      if (!r) return m.replaceWith(missingChip(m.dataset.media!));
      if (r.missing) {
        // el navegador no sabe mostrar este formato (HEIC fuera de Safari…): no es un error
        return m.replaceWith(Object.assign(document.createElement('a'), { className: 'chip media-ph', href: r.url, download: r.name, textContent: `${r.name} · ${t('notes.abrir_original')}` }));
      }
      m.src = r.url;
      if (r.w) reserve(m, r);
      if (r.heavy) m.dataset.heavy = '1';
    };
    const audio = async (m: HTMLElement) => {
      const path = await resolveMedia(app.vault, m.dataset.media!);
      if (!alive) return;
      const url = path ? await acquireMediaUrl(app.vault, path) : null;
      if (path && url) loans.push(path);
      if (!alive) return path && url ? void releaseMediaUrl(path) : undefined;
      if (url) (m as HTMLAudioElement).src = url;
      else m.replaceWith(missingChip(m.dataset.media!));
    };
    // primero las proporciones guardadas (una lectura pequeña, una sola vez), luego carga perezosa
    void loadDims(app.vault).then(() => {
      if (!alive) return;
      for (const m of nodes) {
        if (m.tagName === 'IMG') {
          (m as HTMLImageElement).decoding = 'async';
          const name = m.dataset.media!;
          const d = dimsOf.get(name.includes('/') ? name : `media/${name}`);
          if (d) reserve(m, d);
          whenNear(m, () => void image(m as HTMLImageElement));
        } else whenNear(m, () => void audio(m));
      }
    });
    return () => {
      alive = false;
      for (const m of nodes) if (pending.delete(m)) io?.unobserve(m);
      thumbs.splice(0).forEach(releaseThumb);
      loans.splice(0).forEach(releaseMediaUrl);
    };
  }, [props.html]);
  const T = props.tag ?? 'div';
  return <T ref={ref as never} class={`md ${props.class ?? ''}`} data-user-content dangerouslySetInnerHTML={{ __html: props.html }} />;
}
