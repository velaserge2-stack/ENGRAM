import { t } from '../i18n';
import { Minus, PenLine, Plus, X } from 'lucide-preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useApp } from '../state';
import { forgetMediaUrl } from '../ui/background';
import { readTextOr } from '../vault/util';
import type { VaultAdapter } from '../vault/types';
import { InkLayer, InkToolbar, paintInk } from './InkLayer';
import { useInkTools } from './InkSurface';
import { History, type InkDoc, inkHeight, parseInk } from './model';

/**
 * Notas manuscritas (Prompt 5 · D). Un dibujo vive en `media/dibujo-<id>.ink.json` (trazos
 * vectoriales) y `media/dibujo-<id>.png` (miniatura para vistas previas, búsqueda y exportar).
 * La nota guarda una referencia legible: `![[dibujo-<id>.png]]`. Sin la app, el .md sigue
 * mostrando la imagen.
 */
export const DRAW_RE = /^!\[\[(dibujo-[\w-]+)\.png\]\]$/;
export type Paper = 'liso' | 'rayado' | 'cuadricula' | 'puntos';
export interface Drawing extends InkDoc { h: number; paper?: Paper; pages?: number }
export const PAGE_H = Math.SQRT2; // proporción A4 (alto / ancho)
const jsonPath = (id: string) => `media/${id}.ink.json`;
const pngPath = (id: string) => `media/${id}.png`;

export function parseDrawing(text: string): Drawing {
  const ink = parseInk(text);
  let extra: Partial<Drawing> = {};
  try { extra = JSON.parse(text) as Partial<Drawing>; } catch { /* vacío */ }
  const paper = (['liso', 'rayado', 'cuadricula', 'puntos'] as const).includes(extra.paper as Paper) ? extra.paper : undefined;
  return { ...ink, h: typeof extra.h === 'number' && extra.h > 0 ? extra.h : 0.4, ...(paper ? { paper } : {}), ...(extra.pages ? { pages: Math.max(1, Math.round(extra.pages)) } : {}) };
}

/** Alto (en anchos): el cuaderno por páginas; el bloque crece hacia abajo con lo escrito. */
export function drawingHeight(d: Drawing): number {
  if (d.paper) return (d.pages ?? 1) * PAGE_H;
  return Math.max(d.h, inkHeight(d) + 0.12);
}

/** Crea un dibujo vacío (y su miniatura) y devuelve su id. */
export async function createDrawing(vault: VaultAdapter, notebook?: Paper): Promise<string> {
  const id = `dibujo-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const d: Drawing = { v: 1, strokes: [], h: notebook ? PAGE_H : 0.4, ...(notebook ? { paper: notebook, pages: 1 } : {}) };
  await vault.write(jsonPath(id), JSON.stringify(d));
  await vault.write(pngPath(id), await renderPng(d, 600));
  return id;
}

function paintPaper(ctx: CanvasRenderingContext2D, d: Drawing, W: number, H: number) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  if (!d.paper || d.paper === 'liso') return;
  ctx.strokeStyle = 'rgba(0,0,0,.14)';
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  const step = W / 24;
  if (d.paper === 'rayado') for (let y = step * 2; y < H; y += step) (ctx.beginPath(), ctx.moveTo(0, y), ctx.lineTo(W, y), ctx.stroke());
  if (d.paper === 'cuadricula') {
    for (let y = step; y < H; y += step) (ctx.beginPath(), ctx.moveTo(0, y), ctx.lineTo(W, y), ctx.stroke());
    for (let x = step; x < W; x += step) (ctx.beginPath(), ctx.moveTo(x, 0), ctx.lineTo(x, H), ctx.stroke());
  }
  if (d.paper === 'puntos') for (let y = step; y < H; y += step) for (let x = step; x < W; x += step) (ctx.beginPath(), ctx.arc(x, y, 1.2, 0, Math.PI * 2), ctx.fill());
  if (d.pages && d.pages > 1) { ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.setLineDash([6, 6]); for (let k = 1; k < d.pages; k++) (ctx.beginPath(), ctx.moveTo(0, k * PAGE_H * W), ctx.lineTo(W, k * PAGE_H * W), ctx.stroke()); ctx.setLineDash([]); }
}

/** PNG del dibujo (fondo blanco, papel y tinta) para vistas previas y exportar. */
async function renderPng(d: Drawing, W = 1000): Promise<Uint8Array> {
  const H = Math.max(40, Math.round(drawingHeight(d) * W));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  paintPaper(ctx, d, W, H);
  paintInk(ctx, d, W);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Bloque de dibujo dentro de la nota: se escribe ahí mismo con el Pencil (el dedo sigue
 * desplazando la nota), crece hacia abajo y se puede redimensionar. Guarda el JSON y regenera
 * la miniatura con una pausa (un solo guardado aunque esté abierto en la pestaña y en un panel).
 */
export function DrawingBlock(p: { id: string }) {
  const app = useApp();
  const host = useRef<HTMLDivElement>(null);
  const [d, setD] = useState<Drawing | null>(null);
  const [w, setW] = useState(600);
  const [zoom, setZoom] = useState(1);
  const [tools, setTools] = useInkTools();
  const [open, setOpen] = useState(false);
  const hist = useMemo(() => new History({ v: 1, strokes: [] }), [p.id]);
  const saveT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<Drawing | null>(null);
  const [, bump] = useState(0);
  const resize = useRef<{ y: number; h: number } | null>(null);
  useEffect(() => {
    void readTextOr(app.vault, jsonPath(p.id), '').then((t) => { const x = parseDrawing(t); hist.doc = x; latest.current = x; setD(x); });
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e!.contentRect.width))));
    if (host.current) ro.observe(host.current);
    return () => { ro.disconnect(); if (saveT.current) (clearTimeout(saveT.current), void flush()); };
  }, [p.id]);
  const flush = async () => {
    const x = latest.current;
    if (!x) return;
    await app.vault.write(jsonPath(p.id), JSON.stringify(x));
    await app.vault.write(pngPath(p.id), await renderPng(x));
    forgetMediaUrl(pngPath(p.id));
  };
  const update = (x: Drawing) => {
    latest.current = x;
    setD(x);
    clearTimeout(saveT.current);
    saveT.current = setTimeout(() => ((saveT.current = undefined), void flush()), 700);
  };
  if (!d) return <div class="drawing-block" ref={host}><p class="t2 note">{t('deck.cargando')}</p></div>;
  const W = Math.round(w * zoom);
  const H = Math.round(drawingHeight(d) * W);
  return (
    <div class={`drawing-block${d.paper ? ' notebook' : ''}`} ref={host} onPointerDown={() => !open && setOpen(true)}>
      {open && (
        <InkToolbar tools={tools} set={setTools} canUndo={hist.canUndo} canRedo={hist.canRedo} onUndo={() => (update({ ...d, ...hist.undo() }), bump((n) => n + 1))} onRedo={() => (update({ ...d, ...hist.redo() }), bump((n) => n + 1))}
          extra={<>
            {d.paper && <>
              <select aria-label={t('draw.papel')} value={d.paper} onChange={(e) => update({ ...d, paper: (e.target as HTMLSelectElement).value as Paper })}>{(['liso', 'rayado', 'cuadricula', 'puntos'] as const).map((x) => <option value={x}>{t(`draw.p_${x}`)}</option>)}</select>
              <button type="button" class="btn small" onClick={() => update({ ...d, pages: (d.pages ?? 1) + 1 })}><Plus size={14} />{' '}{t('draw.pagina')}</button>
              <button type="button" class="btn icon small" aria-label={t('pdf.alejar')} onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><Minus size={14} /></button>
              <button type="button" class="btn icon small" aria-label={t('pdf.acercar')} onClick={() => setZoom((z) => Math.min(3, z + 0.25))}><Plus size={14} /></button>
            </>}
            <button type="button" class="btn icon small" aria-label={t('draw.cerrar_herramientas')} onClick={(e) => (e.stopPropagation(), setOpen(false))}><X size={14} /></button>
          </>} />
      )}
      {!open && <span class="drawing-hint foot" aria-hidden="true"><PenLine size={12} /> {t('draw.escribe_con_pencil')}</span>}
      <div class={`drawing-surface paper-${d.paper ?? 'liso'}`} style={{ width: `${W}px`, height: `${H}px`, '--step': `${W / 24}px`, '--pageh': `${PAGE_H * W}px` }}>
        <InkLayer doc={d} onChange={(x) => update({ ...d, ...x })} history={hist} width={W} height={H} active tools={tools} finger={app.settings.inkFinger} label={t('draw.dibujo')} />
      </div>
      {!d.paper && (
        <div class="drawing-resize" role="separator" aria-orientation="horizontal" aria-label={t('draw.cambiar_alto')} tabIndex={0}
          onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); resize.current = { y: e.clientY, h: drawingHeight(d) }; }}
          onPointerMove={(e) => { const r = resize.current; if (!r) return; update({ ...d, h: Math.max(inkHeight(d) + 0.05, Math.max(0.15, r.h + (e.clientY - r.y) / W)) }); }}
          onPointerUp={() => (resize.current = null)}
          onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') update({ ...d, h: Math.max(0.15, drawingHeight(d) + (e.key === 'ArrowDown' ? 0.05 : -0.05)) }); }} />
      )}
    </div>
  );
}
