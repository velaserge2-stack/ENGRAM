// Geometría de aristas (CONTRATO §P22.4): una sola función para pantalla y exportación. Pura.
import type { Route, Shape } from './types';

/** Declarado aquí hasta que `types.ts` exporte `EdgeEnd` (§P22.2). */
export type EdgeEnd = 'sin' | 'flecha' | 'ambos' | 'circulo' | 'rombo';

type Box = { x: number; y: number; w: number; h: number; shape?: Shape }; // x,y = centro
type P = { x: number; y: number };
export interface EdgeGeo { d: string; head?: { d: string }; tail?: { d: string }; labelAt: P }

const n1 = (n: number) => String(Math.round(n * 10) / 10);
const pt = (p: P) => `${n1(p.x)} ${n1(p.y)}`;
const add = (p: P, v: P, k: number): P => ({ x: p.x + v.x * k, y: p.y + v.y * k });
const unit = (a: P, b: P): P => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy); return l < 1e-9 ? { x: 1, y: 0 } : { x: dx / l, y: dy / l }; };

/** ¿`p` (relativo al centro) cae dentro de la forma real? */
function inside(b: Box, p: P): boolean {
  const hw = b.w / 2, hh = b.h / 2;
  if (b.shape === 'diamond') return Math.abs(p.x) / hw + Math.abs(p.y) / hh <= 1;
  if (b.shape === 'round') {
    const r = hh, cx = Math.max(0, Math.abs(p.x) - (hw - r));
    return Math.abs(p.x) <= hw && cx * cx + p.y * p.y <= r * r;
  }
  return Math.abs(p.x) <= hw && Math.abs(p.y) <= hh;
}
/** Punto del borde real en la dirección `u` desde el centro (bisección). */
function border(b: Box, u: P): P {
  let lo = 0, hi = b.w + b.h;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (inside(b, { x: u.x * m, y: u.y * m })) lo = m; else hi = m; }
  return { x: b.x + u.x * lo, y: b.y + u.y * lo };
}

/** Punta rellena: tip = vértice, dir = sentido de avance de la línea, len = largo. Devuelve el `d`. */
function headPath(kind: EdgeEnd, tip: P, dir: P, len: number): string {
  const nrm = { x: -dir.y, y: dir.x }, base = add(tip, dir, -len);
  if (kind === 'circulo') {
    const c = add(tip, dir, -len / 2), r = len / 2;
    return Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6; return `${i ? 'L' : 'M'} ${pt({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r })}`; }).join(' ') + ' Z';
  }
  const half = len * (kind === 'rombo' ? 0.3 : 0.4);
  const mid = kind === 'rombo' ? add(tip, dir, -len / 2) : base;
  const pts = kind === 'rombo' ? [tip, add(mid, nrm, half), base, add(mid, nrm, -half)] : [tip, add(base, nrm, half), add(base, nrm, -half)];
  return pts.map((p, i) => `${i ? 'L' : 'M'} ${pt(p)}`).join(' ') + ' Z';
}

export function edgeGeometry(from: Box, to: Box, route: Route, opts: { width: number; ends: EdgeEnd; gap?: number }): EdgeGeo {
  const gap = opts.gap ?? 4;
  const hasHead = opts.ends !== 'sin', hasTail = opts.ends === 'ambos';
  const kind: EdgeEnd = opts.ends === 'ambos' ? 'flecha' : opts.ends;
  const dx = to.x - from.x, dy = to.y - from.y;
  const sepX = Math.abs(dx) - (from.w + to.w) / 2, sepY = Math.abs(dy) - (from.h + to.h) / 2;
  const vert = sepY >= sepX;
  // Anclas S (origen) y E (destino) con hueco, y normales salientes ns (en S) y ne (en E).
  let S: P, E: P, ns: P, ne: P;
  if (route === 'recta') {
    const u = unit(from, to);
    ns = u; ne = { x: -u.x, y: -u.y };
    S = add(border(from, u), u, gap); E = add(border(to, ne), ne, gap);
  } else {
    const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
    ns = vert ? { x: 0, y: sy } : { x: sx, y: 0 }; ne = { x: -ns.x, y: -ns.y };
    S = add({ x: from.x + ns.x * from.w / 2, y: from.y + ns.y * from.h / 2 }, ns, gap);
    E = add({ x: to.x + ne.x * to.w / 2, y: to.y + ne.y * to.h / 2 }, ne, gap);
  }
  const dist = Math.hypot(E.x - S.x, E.y - S.y);
  const L0 = Math.max(10, 5 * opts.width);
  const L = Math.max(4, Math.min(L0, dist / ((hasHead ? 1 : 0) + (hasTail ? 1 : 0) + 0.5)));
  const B = hasHead ? add(E, ne, L) : E;          // base de la punta final: la línea termina aquí
  const A = hasTail ? add(S, ns, L) : S;          // base de la punta inicial
  let d: string, labelAt: P;
  if (route === 'recta') {
    d = `M ${pt(A)} L ${pt(B)}`; labelAt = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  } else if (route === 'curva') {
    const k = Math.max(20, Math.hypot(B.x - A.x, B.y - A.y) * 0.4);
    const c1 = add(A, ns, k), c2 = add(B, ne, k);
    d = `M ${pt(A)} C ${pt(c1)} ${pt(c2)} ${pt(B)}`;
    labelAt = { x: (A.x + 3 * c1.x + 3 * c2.x + B.x) / 8, y: (A.y + 3 * c1.y + 3 * c2.y + B.y) / 8 };
  } else {
    const m = vert ? (A.y + B.y) / 2 : (A.x + B.x) / 2;
    const pts: P[] = vert ? [A, { x: A.x, y: m }, { x: B.x, y: m }, B] : [A, { x: m, y: A.y }, { x: m, y: B.y }, B];
    d = `M ${pt(pts[0]!)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i - 1]!, c = pts[i]!, q = pts[i + 1]!;
      const r = Math.min(8, Math.hypot(c.x - p.x, c.y - p.y) / 2, Math.hypot(q.x - c.x, q.y - c.y) / 2);
      d += ` L ${pt(add(c, unit(c, p), r))} Q ${pt(c)} ${pt(add(c, unit(c, q), r))}`;
    }
    d += ` L ${pt(B)}`;
    labelAt = vert ? { x: (A.x + B.x) / 2, y: m } : { x: m, y: (A.y + B.y) / 2 };
  }
  const out: EdgeGeo = { d, labelAt };
  if (hasHead) out.head = { d: headPath(kind, E, { x: -ne.x, y: -ne.y }, L) };
  if (hasTail) out.tail = { d: headPath('flecha', S, { x: -ns.x, y: -ns.y }, L) };
  return out;
}
