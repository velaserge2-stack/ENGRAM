import { t } from '../i18n';
import { Eraser, GripVertical, Highlighter, Lasso, PenLine, Redo2, Ruler, ScanText, Undo2 } from 'lucide-preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useKeyScope } from '../ui/keys';
import { acceptPointer, eraseArea, eraseStrokes, type FingerMode, type History, INK_COLORS, type InkDoc, isFreeMarker, lassoSelect, liveSegments, MARKER_ALPHAS, moveStrokes, newStroke, outline, type Pt, SIZES, type Stroke, straighten, strokeAlpha, strokeId, type Tool, wideWidth } from './model';

export interface InkTools { tool: Tool; color: string; size: number; eraser: 'stroke' | 'area'; ruler: boolean; alpha: number }
export const defaultTools = (): InkTools => ({ tool: 'pen', color: INK_COLORS[0]!, size: SIZES[1]!, eraser: 'stroke', ruler: false, alpha: MARKER_ALPHAS[1]! });
const COLOR_NAMES = ['negro', 'azul', 'rojo', 'verde', 'morado', 'naranja', 'amarillo', 'rosa'] as const;

/**
 * Dibuja la tinta en un contexto 2D (también para exportar como imagen). `part` reparte la tinta
 * entre dos lienzos: «marker» (el marcador libre, que en el visor de PDF se mezcla con la página
 * por CSS `multiply`) y «rest» (bolígrafo y resaltador inteligente); «all» es todo en uno.
 */
export function paintInk(ctx: CanvasRenderingContext2D, doc: InkDoc, w: number, skip?: Set<string>, part: 'all' | 'marker' | 'rest' = 'all') {
  const draw = (s: Stroke) => {
    const poly = outline(s, w);
    if (!poly.length) return;
    ctx.beginPath();
    ctx.moveTo(poly[0]![0], poly[0]![1]);
    for (const [x, y] of poly) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.globalAlpha = strokeAlpha(s);
    ctx.fill();
  };
  const want = (s: Stroke, hl: boolean) => (s.tool === 'highlighter') === hl && !skip?.has(s.id) && (part === 'all' || (part === 'marker') === isFreeMarker(s));
  // el resaltador y el marcador van debajo y translúcidos (multiplicar: no tapa el texto)
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  for (const s of doc.strokes) if (want(s, true)) draw(s);
  ctx.restore();
  ctx.save();
  for (const s of doc.strokes) if (want(s, false)) draw(s);
  ctx.restore();
}

/**
 * Capa de tinta (Prompt 5 · B): Pointer Events con presión e inclinación, eventos agrupados
 * (getCoalescedEvents) para trazos suaves, rechazo de palma y renderizado incremental en un
 * lienzo propio (el trazo en curso va en su capa; al soltar se integra en la base).
 * `touch-action: none` solo con «el dedo dibuja»; si no, el dedo desplaza y hace zoom y en iOS
 * se cancela el desplazamiento solo cuando el toque es del Pencil (touchType «stylus»).
 */
export function InkLayer(p: { doc: InkDoc; onChange: (d: InkDoc) => void; history: History; width: number; height: number; active: boolean; tools: InkTools; finger: FingerMode; label: string; lowRes?: boolean }) {
  const mk = useRef<HTMLCanvasElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const live = useRef<HTMLCanvasElement>(null);
  const cur = useRef<{ id: number; type: string; pts: Pt[]; drawn: number; lasso?: [number, number][]; moving?: { from: [number, number]; ids: Set<string>; doc: InkDoc }; erasing?: InkDoc } | null>(null);
  const lastPen = useRef(0);
  const raf = useRef(0);
  const hover = useRef<Pt | null>(null);
  const rect = useRef<{ r: DOMRect; at: number } | null>(null); // se mide al empezar el trazo, no por punto
  const settle = useRef(0);
  const paintDoc = useRef<InkDoc | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  // páginas lejanas (`lowRes`): densidad ≤ 1,5 para ahorrar memoria
  const dpr = Math.min(p.lowRes ? 1.5 : 2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
  const W = p.width;

  const repaint = (doc = p.doc, skip?: Set<string>) => {
    for (const [c, part] of [[mk.current, 'marker'], [base.current, 'rest']] as const) {
      if (!c) continue;
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      paintInk(ctx, doc, W, skip, part);
    }
  };
  // el tamaño solo se toca si cambia (asignar width/height borra el lienzo y es caro)
  useLayoutEffect(() => {
    for (const c of [mk.current, base.current, live.current]) {
      const cw = Math.round(p.width * dpr), ch = Math.round(p.height * dpr);
      if (c && (c.width !== cw || c.height !== ch)) (c.width = cw, c.height = ch);
    }
    repaint();
    if (!cur.current) { clearTimeout(settle.current); drawLive(); } // el trazo recién soltado ya está en la base
  }, [p.width, p.height, p.doc, dpr]);

  // iOS: que el Pencil no desplace la página, sin quitarle al dedo el desplazamiento y el zoom
  useEffect(() => {
    const c = live.current;
    if (!c) return;
    const onTouch = (e: TouchEvent) => { if (p.active && [...e.touches].some((x) => (x as Touch & { touchType?: string }).touchType === 'stylus')) e.preventDefault(); };
    c.addEventListener('touchstart', onTouch, { passive: false });
    c.addEventListener('touchmove', onTouch, { passive: false });
    return () => (c.removeEventListener('touchstart', onTouch), c.removeEventListener('touchmove', onTouch));
  }, [p.active]);

  const norm = (e: PointerEvent, fresh = false): Pt => {
    // el rectángulo se mide al empezar (o, con el hover del Pencil, cada 300 ms: la página puede moverse)
    if (!rect.current || (fresh && Date.now() - rect.current.at > 300)) rect.current = { r: live.current!.getBoundingClientRect(), at: Date.now() };
    const r = rect.current.r;
    return [(e.clientX - r.left) / r.width, ((e.clientY - r.top) / r.width), e.pointerType === 'pen' ? (e.pressure || 0.5) : 0.5];
  };
  /** Marcador y resaltador: trazo ancho de ancho fijo, pintado incremental y opaco; la opacidad la pone el CSS del lienzo. */
  const wide = (tl: InkTools) => tl.tool === 'marker' || tl.tool === 'highlighter';
  const liveStyle = (on: boolean) => {
    const c = live.current!;
    const a = p.tools.tool === 'marker' ? p.tools.alpha : 0.35;
    c.style.opacity = on ? String(a) : '';
    c.classList.toggle('mk', on);
  };
  const drawLive = () => {
    const c = live.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const s = cur.current;
    const tl = p.tools;
    const stroking = !!s && (tl.tool === 'pen' || tl.tool === 'highlighter' || tl.tool === 'marker') && s.pts.length > 0;
    liveStyle(stroking && tl.tool !== 'pen');
    if (stroking) {
      const pts = tl.ruler ? straighten(s!.pts) : s!.pts;
      if (wide(tl)) { s!.drawn = 0; drawWide(ctx, pts, s!); }
      else { const st = newStroke('pen', 'live', tl.color, tl.size, pts, s!.type !== 'pen', 1); if (st) paintInk(ctx, { v: 1, strokes: [st] }, W); } // el bolígrafo: contorno completo
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
    const h = hover.current;
    if (h && !s) {
      ctx.strokeStyle = 'rgba(128,128,128,.8)';
      ctx.beginPath();
      ctx.arc(h[0] * W, h[1] * W, tl.tool === 'eraser' ? 12 : Math.max(2, tl.size * (W / 600) * (tl.tool === 'highlighter' || tl.tool === 'marker' ? 2 : 0.5)), 0, Math.PI * 2);
      ctx.stroke();
    }
  };
  /** Pinta solo los tramos nuevos del trazo ancho (sin borrar): un segmento y un disco de unión por punto. */
  const drawWide = (ctx: CanvasRenderingContext2D, pts: Pt[], s: { drawn: number }) => {
    const w = wideWidth(p.tools.size, W);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = ctx.fillStyle = p.tools.color;
    ctx.lineWidth = w;
    ctx.lineCap = 'butt';
    for (const g of liveSegments(pts, s.drawn)) {
      ctx.beginPath();
      ctx.moveTo(g.a[0] * W, g.a[1] * W);
      ctx.lineTo(g.b[0] * W, g.b[1] * W);
      ctx.stroke();
      if (g.join) (ctx.beginPath(), ctx.arc(g.a[0] * W, g.a[1] * W, w / 2, 0, Math.PI * 2), ctx.fill());
    }
    ctx.restore();
    s.drawn = pts.length;
  };
  // un solo requestAnimationFrame por fotograma: los eventos solo anotan y piden pintar
  const schedule = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const s = cur.current;
      if (paintDoc.current) (repaint(paintDoc.current), (paintDoc.current = null));
      if (s && !s.lasso && !s.erasing && !s.moving && wide(p.tools) && !p.tools.ruler && s.drawn > 0) drawWide(live.current!.getContext('2d')!, s.pts, s);
      else drawLive();
    });
  };
  useEffect(() => { if (live.current) drawLive(); }, [sel, p.tools.tool, p.tools.alpha]);
  useEffect(() => setSel(new Set()), [p.tools.tool]);
  // Prompt 11: al desmontarse, lienzos a tamaño 0 (Safari no libera su memoria si no)
  useEffect(() => () => { cancelAnimationFrame(raf.current); clearTimeout(settle.current); for (const c of [mk.current, base.current, live.current]) if (c) c.width = c.height = 0; }, []);

  const ER = 12 / Math.max(1, W); // radio del borrador: 12 px de pantalla
  const commit = (d: InkDoc) => { if (d !== p.doc) (p.history.push(d), p.onChange(d)); };
  const style = {
    touchAction: !p.active ? 'auto' : p.finger === 'draw' ? 'none' : p.finger === 'scroll' ? 'pan-x pan-y' : 'pan-x pan-y pinch-zoom',
    pointerEvents: p.active ? 'auto' : 'none',
    cursor: p.active ? (p.tools.tool === 'eraser' ? 'cell' : 'crosshair') : 'default',
  };
  const box = { width: `${p.width}px`, height: `${p.height}px` };
  return (
    <div class="ink-layer" style={box} data-user-content>
      <canvas ref={mk} class="ink-mk" style={box} aria-hidden="true" />
      <canvas ref={base} class="ink-base" style={box} aria-hidden="true" />
      <canvas ref={live} class="ink-live" style={{ ...box, ...style }} role="img" aria-label={p.label}
        onPointerEnter={() => { rect.current = null; }}
        onPointerDown={(e) => {
          if (!p.active || !acceptPointer(e.pointerType, p.finger, lastPen.current, Date.now(), cur.current?.type === 'pen')) return;
          if (cur.current) return; // un solo trazo a la vez (la palma no abre un segundo)
          e.preventDefault();
          try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch { /* puntero sintético o ya liberado */ }
          clearTimeout(settle.current);
          rect.current = null;
          hover.current = null;
          const pt = norm(e as PointerEvent);
          const tool = p.tools.tool;
          if (tool === 'lasso') {
            const pts = p.doc.strokes.filter((x) => sel.has(x.id)).flatMap((x) => x.pts);
            const inside = pts.length && pt[0] >= Math.min(...pts.map((q) => q[0])) - 0.02 && pt[0] <= Math.max(...pts.map((q) => q[0])) + 0.02 && pt[1] >= Math.min(...pts.map((q) => q[1])) - 0.02 && pt[1] <= Math.max(...pts.map((q) => q[1])) + 0.02;
            cur.current = inside ? { id: e.pointerId, type: e.pointerType, pts: [], drawn: 0, moving: { from: [pt[0], pt[1]], ids: sel, doc: p.doc } } : { id: e.pointerId, type: e.pointerType, pts: [], drawn: 0, lasso: [[pt[0], pt[1]]] };
            if (!inside) setSel(new Set());
          } else if (tool === 'eraser') {
            cur.current = { id: e.pointerId, type: e.pointerType, pts: [pt], drawn: 0, erasing: p.doc };
            const d = p.tools.eraser === 'area' ? eraseArea(p.doc, [pt[0], pt[1]], ER) : eraseStrokes(p.doc, [pt[0], pt[1]], ER);
            cur.current.erasing = d;
            repaint(d);
          } else cur.current = { id: e.pointerId, type: e.pointerType, pts: [pt], drawn: 0 };
          drawLive();
        }}
        onPointerMove={(e) => {
          const s = cur.current;
          if (!s) {
            if (p.active && e.pointerType === 'pen' && e.buttons === 0) { hover.current = norm(e as PointerEvent, true); schedule(); } // hover del Pencil
            return;
          }
          if (e.pointerId !== s.id) return;
          const co = (e as PointerEvent).getCoalescedEvents?.() ?? [];
          for (const ev of co.length ? co : [e as PointerEvent]) {
            const pt = norm(ev);
            if (s.lasso) s.lasso.push([pt[0], pt[1]]);
            else if (s.moving) { const d = moveStrokes(s.moving.doc, s.moving.ids, pt[0] - s.moving.from[0], pt[1] - s.moving.from[1]); s.erasing = d; }
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
          if (s.erasing) paintDoc.current = s.erasing;
          schedule();
        }}
        onPointerUp={(e) => {
          const s = cur.current;
          if (!s || e.pointerId !== s.id) return;
          cur.current = null;
          if (s.type === 'pen') lastPen.current = Date.now();
          const tl = p.tools;
          if (s.lasso) setSel(lassoSelect(p.doc, s.lasso));
          else if (s.erasing) commit(s.erasing);
          else if (s.pts.length > 1) {
            const st = newStroke(tl.tool, strokeId(), tl.color, tl.size, tl.ruler ? straighten(s.pts) : s.pts, s.type !== 'pen', tl.alpha);
            if (st) commit({ ...p.doc, strokes: [...p.doc.strokes, st] });
          }
          // el trazo en curso sigue en pantalla hasta que la base lo incluya (sin parpadeo); si el
          // documento no cambia (p. ej. el resaltador se volvió marca), se limpia poco después
          if (s.pts.length > 1 && !s.lasso && !s.erasing) settle.current = window.setTimeout(() => { if (!cur.current) drawLive(); }, 150);
          else drawLive();
        }}
        onPointerCancel={() => { cur.current = null; paintDoc.current = null; repaint(); drawLive(); }}
        onPointerLeave={(e) => { if (!cur.current && e.pointerType === 'pen') { hover.current = null; schedule(); } }} />
    </div>
  );
}


/** Vista previa del grosor: el trazo de la herramienta activa (ancho y opacidad reales, a escala). */
const StrokePreview = (p: { size: number; wide: boolean; alpha: number }) => (
  <svg class="ink-prev" width="30" height="22" viewBox="0 0 30 22" aria-hidden="true"><line x1="4" y1="11" x2="26" y2="11" stroke="currentColor" stroke-width={p.wide ? 4 + p.size * 1.4 : p.size + 1} stroke-linecap={p.wide ? 'butt' : 'round'} opacity={p.wide ? p.alpha : 1} /></svg>
);

/** Barra flotante de vidrio, movible, con atajos (P bolígrafo, M marcador, H resaltador inteligente, E borrador, ⌘Z / ⇧⌘Z). */
export function InkToolbar(p: { tools: InkTools; set: (t: InkTools) => void; onUndo: () => void; onRedo: () => void; canUndo: boolean; canRedo: boolean; extra?: preact.ComponentChildren }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const tl = p.tools;
  const isWide = tl.tool === 'marker' || tl.tool === 'highlighter';
  // atajos configurables en Ajustes → Atajos
  useKeyScope('ink', (id) => {
    if (id === 'ink.undo') p.onUndo();
    else if (id === 'ink.redo') p.onRedo();
    else p.set({ ...tl, tool: ({ 'ink.pen': 'pen', 'ink.marker': 'marker', 'ink.highlighter': 'highlighter', 'ink.eraser': 'eraser' } as Record<string, Tool>)[id]! });
  });
  const btn = (tool: Tool, icon: preact.JSX.Element, label: string) => <button type="button" class="btn icon small ink-tool" aria-label={label} aria-pressed={tl.tool === tool} onClick={() => p.set({ ...tl, tool })}>{icon}</button>;
  return (
    <div ref={ref} class="ink-toolbar glass strong" role="toolbar" aria-label={t('ink.herramientas')} style={pos ? { left: `${pos.x}px`, top: `${pos.y}px`, position: 'fixed' } : undefined}>
      <span class="ink-grip" aria-hidden="true" onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); const r = ref.current!.getBoundingClientRect(); drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }; }}
        onPointerMove={(e) => { if (!drag.current) return; const r = ref.current!.getBoundingClientRect(); setPos({ x: Math.max(4, Math.min(innerWidth - r.width - 4, e.clientX - drag.current.dx)), y: Math.max(4, Math.min(innerHeight - r.height - 4, e.clientY - drag.current.dy)) }); }}
        onPointerUp={() => (drag.current = null)}><GripVertical size={16} /></span>
      {btn('pen', <PenLine size={20} />, t('ink.boligrafo'))}
      {btn('marker', <Highlighter size={20} />, t('ink2.marcador'))}
      {btn('highlighter', <ScanText size={20} />, t('ink.resaltador'))}
      {btn('eraser', <Eraser size={20} />, t('ink.borrador'))}
      {btn('lasso', <Lasso size={20} />, t('ink.lazo'))}
      {tl.tool === 'eraser' && <button type="button" class="btn small" aria-pressed={tl.eraser === 'area'} onClick={() => p.set({ ...tl, eraser: tl.eraser === 'area' ? 'stroke' : 'area' })}>{tl.eraser === 'area' ? t('ink.por_area') : t('ink.por_trazo')}</button>}
      <button type="button" class="btn icon small" aria-label={t('ink.regla')} aria-pressed={tl.ruler} onClick={() => p.set({ ...tl, ruler: !tl.ruler })}><Ruler size={20} /></button>
      <span class="ink-sep" aria-hidden="true" />
      <span class="ink-colors" role="radiogroup" aria-label={t('ink.color')} data-user-content>
        {INK_COLORS.map((c, i) => <button type="button" role="radio" aria-checked={tl.color === c} aria-label={t('ink.color_x', { c: t(`ink2.c_${COLOR_NAMES[i]}`) })} class="ink-swatch" onClick={() => p.set({ ...tl, color: c })}><i class="ink-chip" style={{ background: c }} /></button>)}
      </span>
      <span class="ink-sep" aria-hidden="true" />
      <span class="ink-sizes" role="radiogroup" aria-label={t('ink.grosor')}>
        {SIZES.map((s) => <button type="button" role="radio" aria-checked={tl.size === s} aria-label={t('ink.grosor_x', { s })} class="btn icon small" onClick={() => p.set({ ...tl, size: s })}><StrokePreview size={s} wide={isWide} alpha={tl.tool === 'marker' ? tl.alpha : 0.35} /></button>)}
      </span>
      {tl.tool === 'marker' && (
        <span class="ink-alphas" role="radiogroup" aria-label={t('ink2.opacidad')}>
          {MARKER_ALPHAS.map((a) => <button type="button" role="radio" aria-checked={tl.alpha === a} aria-label={t('ink2.opacidad_x', { n: Math.round(a * 100) })} class="btn small" onClick={() => p.set({ ...tl, alpha: a })}>{Math.round(a * 100)}%</button>)}
        </span>
      )}
      <span class="ink-sep" aria-hidden="true" />
      <button type="button" class="btn icon small" aria-label={t('ink.deshacer')} disabled={!p.canUndo} onClick={p.onUndo}><Undo2 size={20} /></button>
      <button type="button" class="btn icon small" aria-label={t('ink.rehacer')} disabled={!p.canRedo} onClick={p.onRedo}><Redo2 size={20} /></button>
      {p.extra}
    </div>
  );
}
