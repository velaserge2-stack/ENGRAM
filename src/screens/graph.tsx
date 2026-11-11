import { t } from '../i18n';
/** Grafo de notas: fuerza simple en <canvas> (sin dependencias), zoom con dos dedos o rueda. */
import { useEffect, useRef } from 'preact/hooks';
import type { LinkIndex, NoteMeta } from '../notes/model';
import { href } from '../state';

export function Graph(p: { notes: NoteMeta[]; idx: LinkIndex; texts: Map<string, string>; focus?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = c.clientWidth;
    const H = c.clientHeight;
    c.width = W * dpr;
    c.height = H * dpr;
    let edges: [string, string][] = [];
    for (const [to, froms] of p.idx.backlinks) for (const f of froms) edges.push([f, to]);
    let ids = p.notes.map((n) => n.path);
    if (p.focus) {
      const near = new Set([p.focus, ...edges.filter((e) => e.includes(p.focus!)).flat()]);
      ids = ids.filter((i) => near.has(i));
      edges = edges.filter(([a, b]) => near.has(a) && near.has(b));
    }
    const pos = new Map(ids.map((id, i) => [id, { x: W / 2 + Math.cos(i) * 80 * Math.sqrt(i + 1), y: H / 2 + Math.sin(i) * 80 * Math.sqrt(i + 1), vx: 0, vy: 0 }]));
    let scale = 1, ox = 0, oy = 0, raf = 0, iter = 0;
    const style = getComputedStyle(c);
    const t1 = style.getPropertyValue('--t1') || '#fff';
    const t3 = style.getPropertyValue('--t3') || '#888';
    const step = () => {
      for (const a of pos.values()) for (const b of pos.values()) {
        if (a === b) continue;
        const dx = a.x - b.x, dy = a.y - b.y, d2 = Math.max(30, dx * dx + dy * dy);
        a.vx += (dx / d2) * 300; a.vy += (dy / d2) * 300;
      }
      for (const [s, t] of edges) {
        const a = pos.get(s)!, b = pos.get(t)!;
        const dx = b.x - a.x, dy = b.y - a.y;
        a.vx += dx * 0.01; a.vy += dy * 0.01; b.vx -= dx * 0.01; b.vy -= dy * 0.01;
      }
      for (const n of pos.values()) {
        n.vx += (W / 2 - n.x) * 0.002; n.vy += (H / 2 - n.y) * 0.002;
        n.x += n.vx *= 0.6; n.y += n.vy *= 0.6;
      }
    };
    const draw = () => {
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
      ctx.clearRect(-ox / scale, -oy / scale, W / scale, H / scale);
      ctx.strokeStyle = t3; ctx.lineWidth = 1;
      for (const [s, t] of edges) { const a = pos.get(s)!, b = pos.get(t)!; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      ctx.fillStyle = t1; ctx.font = '11px "Helvetica Neue", Helvetica, sans-serif';
      for (const [id, n] of pos) {
        ctx.beginPath(); ctx.arc(n.x, n.y, id === p.focus ? 6 : 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillText(id.split('/').pop()!.replace(/\.md$/, '').slice(0, 24), n.x + 7, n.y + 4);
      }
    };
    const loop = () => { if (iter++ < 300) step(); draw(); raf = requestAnimationFrame(loop); };
    loop();
    // zoom/paneo con Pointer Events (dos dedos) y rueda
    const pts = new Map<number, { x: number; y: number }>();
    let last: { d: number; cx: number; cy: number } | null = null;
    const down = (e: PointerEvent) => { c.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); };
    const move = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId)!;
      pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pts.size === 1) { ox += e.offsetX - prev.x; oy += e.offsetY - prev.y; }
      else {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        const cx = (a!.x + b!.x) / 2, cy = (a!.y + b!.y) / 2;
        if (last) { const k = d / last.d; ox = cx - (cx - ox) * k; oy = cy - (cy - oy) * k; scale *= k; }
        last = { d, cx, cy };
      }
    };
    const up = (e: PointerEvent) => {
      const start = pts.get(e.pointerId);
      pts.delete(e.pointerId);
      last = null;
      if (start && pts.size === 0) {
        const x = (e.offsetX - ox) / scale, y = (e.offsetY - oy) / scale;
        for (const [id, n] of pos) if (Math.hypot(n.x - x, n.y - y) < 9) location.hash = href('notas', ...id.split('/').slice(1));
      }
    };
    const wheel = (e: WheelEvent) => { e.preventDefault(); const k = Math.exp(-e.deltaY / 400); ox = e.offsetX - (e.offsetX - ox) * k; oy = e.offsetY - (e.offsetY - oy) * k; scale *= k; };
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); c.addEventListener('wheel', wheel, { passive: false });
    return () => { cancelAnimationFrame(raf); c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('wheel', wheel); };
  }, [p.notes, p.focus]);
  return <canvas ref={ref} style={{ width: '100%', height: p.focus ? '240px' : '420px', touchAction: 'none', display: 'block' }} role="img" aria-label={t('graph.grafo_de_enlaces_entre_notas')} />;
}
