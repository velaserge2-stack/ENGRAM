import { t } from '../i18n';
import { AlignCenterHorizontal, MoveDiagonal2, TextAlignEnd, TextAlignStart, TextWrap, Trash2 } from 'lucide-preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Align, Embed } from '../md/embed';
import { Portal, useLayer } from '../ui/overlay';

const SIZES: [string, number][] = [['S', 33], ['M', 50], ['L', 75], ['full', 100]];
const MIN = 80;

/**
 * Barra de una imagen en la vista de documento (Notas-Pro · A4): alineación, tamaño (S/M/L/completo,
 * flechas ±10 %, o el asa de la esquina con dedo o Pencil), «Texto al lado» y texto alternativo.
 * Cada acción reescribe el embed en el Markdown (un cambio; ⌘Z lo deshace).
 */
export function ImageBar(p: { img: HTMLImageElement; embed: Embed; onApply: (fn: (e: Embed) => Embed) => void; onTextBeside: () => void; onRemove?: () => void; onClose: () => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const [, setTick] = useState(0);
  const [alt, setAlt] = useState(p.embed.alt ?? '');
  useEffect(() => setAlt(p.embed.alt ?? ''), [p.embed.alt]);
  useLayer(p.onClose, { modal: false, el: () => bar.current });
  const box = () => p.img.closest('.md') as HTMLElement | null;
  const pct = () => Math.round((p.img.getBoundingClientRect().width / Math.max(1, box()?.clientWidth ?? 1)) * 100);
  const setW = (v: number, unit: 'px' | '%') => p.onApply((e) => ({ ...e, w: unit === '%' && v >= 100 ? { v: 100, unit } : { v, unit } }));
  const commitAlt = (v: string) => { if (v.trim() !== (p.embed.alt ?? '')) p.onApply((e) => ({ ...e, alt: v.trim() || null })); };
  const align = (a: Align) => p.onApply((e) => ({ ...e, align: e.align === a ? null : a }));

  // seguir a la imagen al desplazar o cambiar de tamaño la ventana
  useEffect(() => {
    let raf = 0;
    const re = () => (cancelAnimationFrame(raf), (raf = requestAnimationFrame(() => setTick((n) => n + 1))));
    const out = (e: PointerEvent) => { const n = e.target as Node; if (!bar.current?.contains(n) && !handle.current?.contains(n) && !p.img.contains(n)) p.onClose(); };
    addEventListener('scroll', re, true);
    addEventListener('resize', re);
    document.addEventListener('pointerdown', out, true);
    return () => { cancelAnimationFrame(raf); removeEventListener('scroll', re, true); removeEventListener('resize', re); document.removeEventListener('pointerdown', out, true); };
  }, [p.img]);

  const r = p.img.getBoundingClientRect();
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, M = 8;
    const top = r.top - h - 8 >= M ? r.top - h - 8 : Math.min(r.bottom + 8, innerHeight - h - M);
    const next = { left: Math.round(Math.min(Math.max(M, r.left + r.width / 2 - w / 2), innerWidth - w - M)), top: Math.round(Math.max(M, top)) };
    // solo si cambió: un objeto nuevo en cada render volvería a renderizar sin fin
    if (next.left !== pos.left || next.top !== pos.top) setPos(next);
  });

  // asa: arrastrar cambia el ancho en vivo; al soltar se escribe una sola vez
  const drag = useRef<{ x: number; w: number; max: number } | null>(null);
  const onDown = (e: PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: r.width, max: box()?.clientWidth ?? r.width };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const w = Math.round(Math.min(d.max, Math.max(MIN, d.w + (e.clientX - d.x))));
    p.img.style.width = `${w}px`;
    setTick((n) => n + 1);
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const w = Math.round(p.img.getBoundingClientRect().width);
    if (Math.abs(w - d.w) >= 2) setW(w >= d.max - 1 ? 100 : w, w >= d.max - 1 ? '%' : 'px');
  };

  const a = p.embed.align;
  return (
    <Portal>
      <div ref={bar} class="popover glass strong imgbar" role="toolbar" aria-label={t('imgbar.barra')} style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          if ((e.target as HTMLElement).tagName === 'INPUT') return;
          e.preventDefault();
          setW(Math.min(100, Math.max(10, pct() + (e.key === 'ArrowRight' ? 10 : -10))), '%');
        }}>
        <div class="row">
          <button type="button" class="btn icon small ghost" aria-label={t('imgbar.izquierda')} aria-pressed={a === 'izq'} onClick={() => align('izq')}><TextAlignStart size={18} /></button>
          <button type="button" class="btn icon small ghost" aria-label={t('imgbar.centro')} aria-pressed={a === 'centro'} onClick={() => align('centro')}><AlignCenterHorizontal size={18} /></button>
          <button type="button" class="btn icon small ghost" aria-label={t('imgbar.derecha')} aria-pressed={a === 'der'} onClick={() => align('der')}><TextAlignEnd size={18} /></button>
          <span class="imgbar-sep" aria-hidden="true" />
          {SIZES.map(([k, v]) => <button type="button" class="btn small ghost" aria-label={t(`imgbar.tam_${k}`)} aria-pressed={p.embed.w?.unit === '%' && p.embed.w.v === v} onClick={() => setW(v, '%')}>{k === 'full' ? '↔' : k}</button>)}
          <span class="imgbar-sep" aria-hidden="true" />
          <button type="button" class="btn icon small ghost" aria-label={t('imgbar.texto_al_lado')} disabled={a !== 'izq' && a !== 'der'} onClick={p.onTextBeside}><TextWrap size={18} /></button>
          {p.onRemove && <button type="button" class="btn icon small ghost" aria-label={t('imgbar.quitar')} onClick={p.onRemove}><Trash2 size={18} /></button>}
        </div>
        <label class="field">{t('imgbar.alt')}
          <input class="input" value={alt} placeholder={p.embed.name} onInput={(e) => setAlt((e.target as HTMLInputElement).value)}
            onBlur={(e) => commitAlt((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && commitAlt((e.target as HTMLInputElement).value)} />
        </label>
      </div>
      <button ref={handle} type="button" class="img-handle glass strong" aria-label={t('imgbar.asa')} style={{ left: `${r.right - 22}px`, top: `${r.bottom - 22}px` }}
        onPointerDown={onDown as never} onPointerMove={onMove as never} onPointerUp={onUp} onPointerCancel={onUp}
        onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') (e.preventDefault(), setW(Math.min(100, Math.max(10, pct() + (e.key === 'ArrowRight' ? 10 : -10))), '%')); }}>
        <MoveDiagonal2 size={18} />
      </button>
    </Portal>
  );
}
