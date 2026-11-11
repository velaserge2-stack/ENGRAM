/** Editor de oclusión de imagen (SPEC §9 add-on 3): rectángulos con dedo o Apple Pencil. */
import { Trash2 } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Rect } from '../cards/parse';

export function OcclusionEditor(props: { url: string; rects: Rect[]; onChange: (r: Rect[]) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const pct = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)), y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)) };
  };
  useEffect(() => setDraft(null), [props.url]);
  const round = (v: number) => Math.round(v * 10) / 10;
  return (
    <div class="stack-s">
      <div
        ref={box}
        style={{ position: 'relative', touchAction: 'none', userSelect: 'none', display: 'inline-block', maxWidth: '100%' }}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          start.current = pct(e);
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const p = pct(e);
          const s = start.current;
          setDraft({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
        }}
        onPointerUp={() => {
          if (draft && draft.w > 1 && draft.h > 1) props.onChange([...props.rects, { x: round(draft.x), y: round(draft.y), w: round(draft.w), h: round(draft.h) }]);
          start.current = null;
          setDraft(null);
        }}
        aria-label="Dibuja rectángulos sobre la imagen para ocultar zonas"
      >
        <img src={props.url} alt="" style={{ maxWidth: '100%', display: 'block', borderRadius: '10px', pointerEvents: 'none' }} draggable={false} />
        {[...props.rects, ...(draft ? [draft] : [])].map((r, i) => (
          <div key={i} style={{ position: 'absolute', left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%`, background: 'rgba(17,17,17,.75)', border: '2px solid #fff', borderRadius: '6px', color: '#fff', fontSize: '12px', fontWeight: 700, display: 'grid', placeItems: 'center' }}>{i < props.rects.length ? i + 1 : ''}</div>
        ))}
      </div>
      <div class="row wrap">
        {props.rects.map((_, i) => (
          <button type="button" class="btn small" onClick={() => props.onChange(props.rects.filter((_, k) => k !== i))}><Trash2 size={14} /> Zona {i + 1}</button>
        ))}
      </div>
    </div>
  );
}
