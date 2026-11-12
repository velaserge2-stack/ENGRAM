import { t } from '../i18n';
import { useEffect, useRef } from 'preact/hooks';
import { useApp } from '../state';
import { mediaUrl } from './background';
import { resolveMedia } from '../data/ops';
import { dimsOf, loadDims, mediaThumbUrl, releaseThumb } from '../notes/thumbs';

/** Reserva el alto con la proporción (y, sin `|ancho`, el ancho natural acotado): el desplazamiento no salta. */
function reserve(m: HTMLElement, d: { w: number; h: number }) {
  m.style.aspectRatio = `${d.w} / ${d.h}`;
  if (!m.hasAttribute('width')) m.style.width = `min(100%, ${d.w}px)`;
}

const missingChip = (name: string) => Object.assign(document.createElement('span'), { className: 'chip', textContent: t('md.falta_media', { media: name }) });

/**
 * HTML ya sanitizado + hidratación de medios (![[img]] → blob: URL de la bóveda). Las imágenes
 * cargan su miniatura solo al acercarse a la pantalla y la sueltan al desmontarse (Notas-Pro · A1).
 */
export function Html(props: { html: string; class?: string; tag?: 'div' | 'span' }) {
  const app = useApp();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const held: string[] = [];
    const show = async (m: HTMLImageElement) => {
      const path = await resolveMedia(app.vault, m.dataset.media!);
      if (!alive) return;
      if (!path) return m.replaceWith(missingChip(m.dataset.media!));
      held.push(path);
      const r = await mediaThumbUrl(app.vault, path);
      if (!alive) return;
      if (!r) return m.replaceWith(missingChip(m.dataset.media!));
      if (r.missing) {
        // el navegador no sabe mostrar este formato (HEIC fuera de Safari…): no es un error
        const a = Object.assign(document.createElement('a'), { className: 'chip media-ph', href: r.url, download: r.name, textContent: `${r.name} · ${t('notes.abrir_original')}` });
        return m.replaceWith(a);
      }
      m.src = r.url;
      if (r.w) reserve(m, r);
      if (r.heavy) m.dataset.heavy = '1';
    };
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) (io!.unobserve(e.target), void show(e.target as HTMLImageElement)); }, { rootMargin: '800px 0px' }) : null;
    const imgs = [...el.querySelectorAll<HTMLImageElement>('img[data-media]')];
    // primero las proporciones guardadas (una lectura pequeña, una sola vez), luego carga perezosa
    if (imgs.length) void loadDims(app.vault).then(() => {
      if (!alive) return;
      for (const m of imgs) {
        const name = m.dataset.media!;
        const d = dimsOf.get(name.includes('/') ? name : `media/${name}`);
        if (d) reserve(m, d);
        if (io) io.observe(m);
        else void show(m);
      }
    });
    el.querySelectorAll<HTMLElement>('audio[data-media]').forEach(async (m) => {
      const path = await resolveMedia(app.vault, m.dataset.media!);
      const url = path ? await mediaUrl(app.vault, path) : null;
      if (url) (m as HTMLAudioElement).src = url;
      else m.replaceWith(missingChip(m.dataset.media!));
    });
    return () => { alive = false; io?.disconnect(); held.forEach(releaseThumb); };
  }, [props.html]);
  const T = props.tag ?? 'div';
  return <T ref={ref as never} class={`md ${props.class ?? ''}`} data-user-content dangerouslySetInnerHTML={{ __html: props.html }} />;
}
