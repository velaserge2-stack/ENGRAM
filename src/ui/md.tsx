import { useEffect, useRef } from 'preact/hooks';
import { useApp } from '../state';
import { mediaUrl } from './background';
import { resolveMedia } from '../data/ops';

/** HTML ya sanitizado + hidratación de medios (![[img]] → blob: URL de la bóveda). */
export function Html(props: { html: string; class?: string; tag?: 'div' | 'span' }) {
  const app = useApp();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.querySelectorAll<HTMLElement>('[data-media]').forEach(async (m) => {
      const path = await resolveMedia(app.vault, m.dataset.media!);
      const url = path ? await mediaUrl(app.vault, path) : null;
      if (url) (m as HTMLImageElement).src = url;
      else m.replaceWith(Object.assign(document.createElement('span'), { className: 'chip', textContent: `Falta ${m.dataset.media}` }));
    });
  }, [props.html]);
  const T = props.tag ?? 'div';
  return <T ref={ref as never} class={`md ${props.class ?? ''}`} data-user-content dangerouslySetInnerHTML={{ __html: props.html }} />;
}
