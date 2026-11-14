import { t } from '../i18n';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { findHits } from './search';

/** Petición de abrir una nota en una coincidencia (desde los resultados del buscador). */
export const pendingFind: { path: string | null; q: string } = { path: null, q: '' };

type HL = { set(name: string, h: unknown): void; delete(name: string): void };
const highlights = (): HL | null => (typeof CSS !== 'undefined' && 'highlights' in CSS && typeof (globalThis as { Highlight?: unknown }).Highlight === 'function' ? (CSS as unknown as { highlights: HL }).highlights : null);
const Highlight = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;

/** Rangos del DOM que coinciden con la consulta (texto visible de la nota renderizada). */
function rangesIn(root: HTMLElement, q: string): Range[] {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let all = '';
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => ((n.parentElement?.closest('textarea, input, button, .find-bar')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) (nodes.push(n), starts.push(all.length), (all += n.data));
  // el último nodo que empieza en `pos` o antes (búsqueda binaria; antes se recorría hacia atrás desde el
  // final en cada coincidencia: 1.2 s de 2.1 s al buscar en una nota de 5 MB, Prompt 21 · cuello #10)
  const at = (pos: number): [Text, number] => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return [nodes[lo]!, pos - starts[lo]!];
  };
  return findHits(all, q).map((h) => {
    const r = document.createRange();
    const [a, ao] = at(h.start);
    const [b, bo] = at(h.end - 1);
    r.setStart(a, ao);
    r.setEnd(b, bo + 1);
    return r;
  });
}

/**
 * Lleva la coincidencia a la vista. Prompt 14: las notas grandes pintan por tramos
 * (`content-visibility`), y el desplazamiento suave se calcula con alturas estimadas de lo que aún
 * no se pintó; al llegar, si la coincidencia quedó fuera de su contenedor, se recoloca.
 */
function reveal(el: HTMLElement) {
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  let sc: HTMLElement | null = el.parentElement;
  while (sc && !(sc.scrollHeight > sc.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
  // ~1 s vigilando: los tramos que se pintan al llegar pueden volver a mover la coincidencia
  let frames = 0, moves = 0;
  const fix = () => {
    if (!el.isConnected || frames++ > 60) return;
    const r = el.getBoundingClientRect(), box = sc?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
    if ((r.top < box.top || r.bottom > box.bottom) && moves++ < 6) el.scrollIntoView({ block: 'center' });
    requestAnimationFrame(fix);
  };
  setTimeout(fix, 700);
}

/**
 * «Buscar en esta nota» (D11): siguiente/anterior y contador. Resalta con la CSS Custom
 * Highlight API (Safari 17.2+); si no existe, selecciona la coincidencia actual.
 */
export function FindBar(props: { root: () => HTMLElement | null; initial: string; dep: unknown; onClose: () => void }) {
  const [q, setQ] = useState(props.initial);
  const [i, setI] = useState(0);
  const [n, setN] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!props.initial) input.current?.focus(); }, []);
  useEffect(() => {
    const root = props.root();
    const hl = highlights();
    if (!root || !q.trim()) { setN(0); hl?.delete('engrama-find'); hl?.delete('engrama-find-cur'); return; }
    const rs = rangesIn(root, q);
    setN(rs.length);
    const cur = rs.length ? rs[((i % rs.length) + rs.length) % rs.length]! : null;
    if (hl && Highlight) {
      hl.set('engrama-find', new Highlight(...rs));
      if (cur) hl.set('engrama-find-cur', new Highlight(cur)); else hl.delete('engrama-find-cur');
    } else if (cur && document.activeElement !== input.current) {
      const sel = getSelection();
      sel?.removeAllRanges();
      sel?.addRange(cur);
    }
    const el = cur?.startContainer.parentElement;
    if (el) reveal(el);
  }, [q, i, props.dep]);
  useEffect(() => () => { highlights()?.delete('engrama-find'); highlights()?.delete('engrama-find-cur'); }, []);
  const go = (d: number) => setI((x) => (n ? (((x + d) % n) + n) % n : 0));
  return (
    <div class="find-bar glass row" role="search" aria-label={t('find.buscar_en_esta_nota')}>
      <Search size={16} aria-hidden="true" />
      <input ref={input} class="input grow" type="search" value={q} aria-label={t('find.buscar_en_esta_nota')} placeholder={t('find.buscar_en_esta_nota')}
        onInput={(e) => (setQ((e.target as HTMLInputElement).value), setI(0))}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.preventDefault(), go(e.shiftKey ? -1 : 1)); else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), props.onClose()); }} />
      <span class="foot num" aria-live="polite">{n ? t('find.i_de_n', { i: (((i % n) + n) % n) + 1, n }) : q.trim() ? t('find.sin_resultados') : ''}</span>
      <button type="button" class="btn icon small" aria-label={t('find.anterior')} disabled={!n} onClick={() => go(-1)}><ChevronUp size={18} /></button>
      <button type="button" class="btn icon small" aria-label={t('find.siguiente')} disabled={!n} onClick={() => go(1)}><ChevronDown size={18} /></button>
      <button type="button" class="btn icon small" aria-label={t('design.cerrar')} onClick={props.onClose}><X size={18} /></button>
    </div>
  );
}
