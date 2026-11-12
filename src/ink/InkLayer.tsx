import { t } from '../i18n';
import { Eraser, GripVertical, Highlighter, Lasso, PenLine, Redo2, Ruler, Undo2 } from 'lucide-preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useKeyScope } from '../ui/keys';
import { acceptPointer, eraseArea, eraseStrokes, type FingerMode, type History, INK_COLORS, type InkDoc, lassoSelect, moveStrokes, outline, type Pt, SIZES, type Stroke, straighten, strokeId, type Tool } from './model';

export interface InkTools { tool: Tool; color: string; size: number; eraser: 'stroke' | 'area'; ruler: boolean }
export const defaultTools = (): InkTools => ({ tool: 'pen', color: INK_COLORS[0]!, size: SIZES[1]!, eraser: 'stroke', ruler: false });

/** Dibuja la tinta en un contexto 2D (también para exportar como imagen). */
export function paintInk(ctx: CanvasRenderingContext2D, doc: InkDoc, w: number, skip?: Set<string>) {
  const draw = (s: Stroke) => {
    const poly = outline(s, w);
    if (!poly.length) return;
    ctx.beginPath();
    ctx.moveTo(poly[0]![0], poly[0]![1]);
    for (const [x, y] of poly) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
  };
  // el resaltador va debajo y translúcido (multiplicar: no tapa el texto)
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.globalCompositeOperation = 'multiply';
  for (const s of doc.strokes) if (s.tool === 'highlighter' && !skip?.has(s.id)) draw(s);
  ctx.restore();
  for (const s of doc.strokes) if (s.tool === 'pen' && !skip?.has(s.id)) draw(s);
}

/**
 * Capa de tinta (Prompt 5 · B): Pointer Events con presión e inclinación, eventos agrupados
 * (getCoalescedEvents) para trazos suaves, rechazo de palma y renderizado incremental en un
 * lienzo propio (el trazo en curso va en su capa; al soltar se integra en la base).
 * `touch-action: none` solo con «el dedo dibuja»; si no, el dedo desplaza y hace zoom y en iOS
 * se cancela el desplazamiento solo cuando el toque es del Pencil (touchType «stylus»).
 */
export function InkLayer(p: { doc: InkDoc; onChange: (d: InkDoc) => void; history: History; width: number; height: number; active: boolean; tools: InkTools; finger: FingerMode; label: string }) {
  const base = useRef<HTMLCanvasElement>(null);
  const live = useRef<HTMLCanvasElement>(null);
  const cur = useRef<{ id: number; type: string; pts: Pt[]; lasso?: [number, number][]; moving?: { from: [number, number]; ids: Set<string>; doc: InkDoc }; erasing?: InkDoc } | null>(null);
  const lastPen = useRef(0);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
  const W = p.width;

  const repaint = (doc = p.doc, skip?: Set<string>) => {
    const c = base.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    paintInk(ctx, doc, W, skip);
  };
  useLayoutEffect(() => {
    for (const c of [base.current, live.current]) if (c) (c.width = Math.round(p.width * dpr), c.height = Math.round(p.height * dpr));
    repaint();
  }, [p.width, p.height, p.doc]);

  // iOS: que el Pencil no desplace la página, sin quitarle al dedo el desplazamiento y el zoom
  useEffect(() => {
    const c = live.current;
    if (!c) return;
    const onTouch = (e: TouchEvent) => { if (p.active && [...e.touches].some((x) => (x as Touch & { touchType?: string }).touchType === 'stylus')) e.preventDefault(); };
    c.addEventListener('touchstart', onTouch, { passive: false });
    c.addEventListener('touchmove', onTouch, { passive: false });
    return () => (c.removeEventListener('touchstart', onTouch), c.removeEventListener('touchmove', onTouch));
  }, [p.active]);

  const norm = (e: PointerEvent): Pt => {
    const r = live.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, ((e.clientY - r.top) / r.width), e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5];
  };
  const drawLive = (hover?: Pt) => {
    const c = live.current!;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const s = cur.current;
    const tl = p.tools;
    if (s && (tl.tool === 'pen' || tl.tool === 'highlighter') && s.pts.length) {
      const st: Stroke = { id: 'live', tool: tl.tool, color: tl.color, size: tl.size, pts: tl.ruler ? straighten(s.pts) : s.pts, simulated: s.type !== 'pen' };
      ctx.save();
      if (tl.tool === 'highlighter') (ctx.globalAlpha = 0.35, (ctx.globalCompositeOperation = 'multiply'));
      paintInk(ctx, { v: 1, strokes: [{ ...st, tool: 'pen' }] }, W);
      ctx.restore();
    }
    if (s?.lasso?.length) {
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(128,128,128,.9)';
      ctx.beginPath();
      s.lasso.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * W) : ctx.moveTo(x * W, y * W)));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // selección del lazo: recuadro
    if (sel.size && !s?.lasso) {
      const pts = p.doc.strokes.filter((x) => sel.has(x.id)).flatMap((x) => x.pts);
      if (pts.length) {
        const xs = pts.map((q) => q[0] * W), ys = pts.map((q) => q[1] * W);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(128,128,128,.9)';
        ctx.strokeRect(Math.min(...xs) - 6, Math.min(...ys) - 6, Math.max(...xs) - Math.min(...xs) + 12, Math.max(...ys) - Math.min(...ys) + 12);
        ctx.setLineDash([]);
      }
    }
    // vista previa del cursor con el hover del Pencil (si el dispositivo lo da)
    if (hover) {
      ctx.strokeStyle = 'rgba(128,128,128,.8)';
      ctx.beginPath();
      ctx.arc(hover[0] * W, hover[1] * W, tl.tool === 'eraser' ? 12 : Math.max(2, tl.size * (W / 600) * (tl.tool === 'highlighter' ? 2 : 0.5)), 0, Math.PI * 2);
      ctx.stroke();
    }
  };
  useEffect(() => { if (live.current) drawLive(); }, [sel, p.doc]);
  useEffect(() => setSel(new Set()), [p.tools.tool]);
  // Prompt 11: al desmontarse, lienzos a tamaño 0 (Safari no libera su memoria si no)
  useEffect(() => () => { for (const c of [base.current, live.current]) if (c) c.width = c.height = 0; }, []);

  const ER = 12 / Math.max(1, W); // radio del borrador: 12 px de pantalla
  const commit = (d: InkDoc) => { if (d !== p.doc) (p.history.push(d), p.onChange(d)); };
  const style = {
    touchAction: !p.active ? 'auto' : p.finger === 'draw' ? 'none' : p.finger === 'scroll' ? 'pan-x pan-y' : 'pan-x pan-y pinch-zoom',
    pointerEvents: p.active ? 'auto' : 'none',
    cursor: p.active ? (p.tools.tool === 'eraser' ? 'cell' : 'crosshair') : 'default',
  };
  return (
    <div class="ink-layer" style={{ width: `${p.width}px`, height: `${p.height}px` }} data-user-content>
      <canvas ref={base} class="ink-base" style={{ width: `${p.width}px`, height: `${p.height}px` }} aria-hidden="true" />
      <canvas ref={live} class="ink-live" style={{ width: `${p.width}px`, height: `${p.height}px`, ...style }} role="img" aria-label={p.label}
        onPointerDown={(e) => {
          if (!p.active || !acceptPointer(e.pointerType, p.finger, lastPen.current, Date.now(), cur.current?.type === 'pen')) return;
          if (cur.current) return; // un solo trazo a la vez (la palma no abre un segundo)
          e.preventDefault();
          try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* puntero sintético o ya liberado */ }
          const pt = norm(e as PointerEvent);
          const tool = p.tools.tool;
          if (tool === 'lasso') {
            const pts = p.doc.strokes.filter((x) => sel.has(x.id)).flatMap((x) => x.pts);
            const inside = pts.length && pt[0] >= Math.min(...pts.map((q) => q[0])) - 0.02 && pt[0] <= Math.max(...pts.map((q) => q[0])) + 0.02 && pt[1] >= Math.min(...pts.map((q) => q[1])) - 0.02 && pt[1] <= Math.max(...pts.map((q) => q[1])) + 0.02;
            cur.current = inside ? { id: e.pointerId, type: e.pointerType, pts: [], moving: { from: [pt[0], pt[1]], ids: sel, doc: p.doc } } : { id: e.pointerId, type: e.pointerType, pts: [], lasso: [[pt[0], pt[1]]] };
            if (!inside) setSel(new Set());
          } else if (tool === 'eraser') {
            cur.current = { id: e.pointerId, type: e.pointerType, pts: [pt], erasing: p.doc };
            const d = p.tools.eraser === 'area' ? eraseArea(p.doc, [pt[0], pt[1]], ER) : eraseStrokes(p.doc, [pt[0], pt[1]], ER);
            cur.current.erasing = d;
            repaint(d);
          } else cur.current = { id: e.pointerId, type: e.pointerType, pts: [pt] };
          drawLive();
        }}
        onPointerMove={(e) => {
          const s = cur.current;
          if (!s) {
            if (p.active && e.pointerType === 'pen' && e.buttons === 0) drawLive(norm(e as PointerEvent)); // hover del Pencil
            return;
          }
          if (e.pointerId !== s.id) return;
          const evs = ((e as PointerEvent).getCoalescedEvents?.() ?? []).length ? (e as PointerEvent).getCoalescedEvents() : [e as PointerEvent];
          for (const ev of evs) {
            const pt = norm(ev);
            if (s.lasso) s.lasso.push([pt[0], pt[1]]);
            else if (s.moving) { const d = moveStrokes(s.moving.doc, s.moving.ids, pt[0] - s.moving.from[0], pt[1] - s.moving.from[1]); s.erasing = d; repaint(d); }
            else if (s.erasing) {
              // recorrer el tramo desde el punto anterior: un movimiento rápido no se salta trazos
              const prev = s.pts[s.pts.length - 1] ?? pt;
              const n = Math.max(1, Math.ceil(Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) / (ER / 2)));
              for (let k = 1; k <= n; k++) {
                const q: [number, number] = [prev[0] + ((pt[0] - prev[0]) * k) / n, prev[1] + ((pt[1] - prev[1]) * k) / n];
                s.erasing = p.tools.eraser === 'area' ? eraseArea(s.erasing, q, ER) : eraseStrokes(s.erasing, q, ER);
              }
              s.pts.push(pt);
            }
            else s.pts.push(pt);
          }
          if (s.erasing && !s.moving) repaint(s.erasing);
          requestAnimationFrame(() => drawLive());
        }}
        onPointerUp={(e) => {
          const s = cur.current;
          if (!s || e.pointerId !== s.id) return;
          cur.current = null;
          if (s.type === 'pen') lastPen.current = Date.now();
          const tl = p.tools;
          if (s.lasso) setSel(lassoSelect(p.doc, s.lasso));
          else if (s.erasing) commit(s.erasing);
          else if ((tl.tool === 'pen' || tl.tool === 'highlighter') && s.pts.length > 1) commit({ ...p.doc, strokes: [...p.doc.strokes, { id: strokeId(), tool: tl.tool, color: tl.color, size: tl.size, pts: tl.ruler ? straighten(s.pts) : s.pts, ...(s.type === 'pen' ? {} : { simulated: true }) }] });
          drawLive();
        }}
        onPointerCancel={() => { cur.current = null; repaint(); drawLive(); }}
        onPointerLeave={(e) => { if (!cur.current && e.pointerType === 'pen') drawLive(); }} />
    </div>
  );
}


/** Barra flotante de vidrio, movible, con atajos (P, H, E, ⌘Z / ⇧⌘Z). */
export function InkToolbar(p: { tools: InkTools; set: (t: InkTools) => void; onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean; extra?: preact.ComponentChildren }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const tl = p.tools;
  // P bolígrafo, H resaltador, E borrador, ⌘Z / ⇧⌘Z (configurables en Ajustes → Atajos)
  useKeyScope('ink', (id) => {
    if (id === 'ink.undo') p.onUndo();
    else if (id === 'ink.redo') p.onRedo();
    else p.set({ ...tl, tool: ({ 'ink.pen': 'pen', 'ink.highlighter': 'highlighter', 'ink.eraser': 'eraser' } as Record<string, Tool>)[id]! });
  });
  const btn = (tool: Tool, icon: preact.JSX.Element, label: string) => <button type="button" class="btn icon small" aria-label={label} aria-pressed={tl.tool === tool} onClick={() => p.set({ ...tl, tool })}>{icon}</button>;
  return (
    <div ref={ref} class="ink-toolbar glass strong" role="toolbar" aria-label={t('ink.herramientas')} style={pos ? { left: `${pos.x}px`, top: `${pos.y}px`, position: 'fixed' } : undefined}>
      <span class="ink-grip" aria-hidden="true" onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); const r = ref.current!.getBoundingClientRect(); drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }; }}
        onPointerMove={(e) => { if (!drag.current) return; const r = ref.current!.getBoundingClientRect(); setPos({ x: Math.max(4, Math.min(innerWidth - r.width - 4, e.clientX - drag.current.dx)), y: Math.max(4, Math.min(innerHeight - r.height - 4, e.clientY - drag.current.dy)) }); }}
        onPointerUp={() => (drag.current = null)}><GripVertical size={16} /></span>
      {btn('pen', <PenLine size={18} />, t('ink.boligrafo'))}
      {btn('highlighter', <Highlighter size={18} />, t('ink.resaltador'))}
      {btn('eraser', <Eraser size={18} />, t('ink.borrador'))}
      {btn('lasso', <Lasso size={18} />, t('ink.lazo'))}
      {tl.tool === 'eraser' && <button type="button" class="btn small" aria-pressed={tl.eraser === 'area'} onClick={() => p.set({ ...tl, eraser: tl.eraser === 'area' ? 'stroke' : 'area' })}>{tl.eraser === 'area' ? t('ink.por_area') : t('ink.por_trazo')}</button>}
      <button type="button" class="btn icon small" aria-label={t('ink.regla')} aria-pressed={tl.ruler} onClick={() => p.set({ ...tl, ruler: !tl.ruler })}><Ruler size={18} /></button>
      <span class="ink-colors" role="radiogroup" aria-label={t('ink.color')} data-user-content>
        {INK_COLORS.map((c) => <button type="button" role="radio" aria-checked={tl.color === c} aria-label={t('ink.color_x', { c })} class="ink-swatch" style={{ background: c }} onClick={() => p.set({ ...tl, color: c })} />)}
      </span>
      <span class="ink-sizes" role="radiogroup" aria-label={t('ink.grosor')}>
        {SIZES.map((s) => <button type="button" role="radio" aria-checked={tl.size === s} aria-label={t('ink.grosor_x', { s })} class="btn icon small" onClick={() => p.set({ ...tl, size: s })}><i class="ink-dot" style={{ width: `${s + 4}px`, height: `${s + 4}px` }} /></button>)}
      </span>
      <button type="button" class="btn icon small" aria-label={t('ink.deshacer')} disabled={!p.canUndo} onClick={p.onUndo}><Undo2 size={18} /></button>
      <button type="button" class="btn icon small" aria-label={t('ink.rehacer')} disabled={!p.canRedo} onClick={p.onRedo}><Redo2 size={18} /></button>
      {p.extra}
    </div>
  );
}
