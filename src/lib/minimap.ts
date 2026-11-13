/**
 * Minimapa del lienzo (Prompt 15). Puro, para probarlo.
 *
 * Los límites son la unión de los paneles visibles y del rectángulo de vista (más un margen), así
 * que el rectángulo de vista siempre cabe dentro. La escala ajusta esos límites al recuadro del
 * minimapa y los centra.
 */
import type { View } from './canvaszoom';

export interface Box { x: number; y: number; w: number; h: number }
/** Recuadro del minimapa en px CSS (el mismo que en el CSS de `.minimap`). */
export const MAP_W = 160, MAP_H = 110;
export interface MapFit { minX: number; minY: number; mk: number; ox: number; oy: number }

/** Rectángulo del mundo que se ve en un lienzo de `W × H` con la vista `v`. */
export const viewBox = (v: View, W: number, H: number): Box => ({ x: -v.x / v.k, y: -v.y / v.k, w: W / v.k, h: H / v.k });

/** Límites (paneles ∪ vista) con margen y escala para un minimapa de `MW × MH`. */
export function mapFit(panels: Box[], v: View, W: number, H: number, MW = MAP_W, MH = MAP_H): MapFit {
  const all = [...panels, viewBox(v, W, H)];
  let minX = Math.min(...all.map((b) => b.x)), minY = Math.min(...all.map((b) => b.y));
  let maxX = Math.max(...all.map((b) => b.x + b.w)), maxY = Math.max(...all.map((b) => b.y + b.h));
  // margen: 4 % de lo abarcado (el rectángulo de vista no toca el borde)
  const m = Math.max(maxX - minX, maxY - minY, 1) * 0.04;
  minX -= m; minY -= m; maxX += m; maxY += m;
  const mk = Math.min(MW / (maxX - minX), MH / (maxY - minY));
  return { minX, minY, mk, ox: (MW - (maxX - minX) * mk) / 2, oy: (MH - (maxY - minY) * mk) / 2 };
}

/** Mundo → minimapa (px dentro del recuadro). */
export const toMap = (f: MapFit, x: number, y: number) => ({ x: f.ox + (x - f.minX) * f.mk, y: f.oy + (y - f.minY) * f.mk });
/** Minimapa → mundo. */
export const toWorld = (f: MapFit, mx: number, my: number) => ({ x: f.minX + (mx - f.ox) / f.mk, y: f.minY + (my - f.oy) / f.mk });
/** Caja del mundo dibujada en el minimapa. */
export function mapBox(f: MapFit, b: Box): Box {
  const p = toMap(f, b.x, b.y);
  return { x: p.x, y: p.y, w: b.w * f.mk, h: b.h * f.mk };
}
/** La vista centrada en el punto del mundo (`wx`, `wy`), sin cambiar el zoom. */
export const centerOn = (v: View, wx: number, wy: number, W: number, H: number): View => ({ k: v.k, x: W / 2 - wx * v.k, y: H / 2 - wy * v.k });
