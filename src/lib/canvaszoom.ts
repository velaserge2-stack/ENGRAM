/**
 * Zoom del lienzo infinito (Prompt 7 · 1). Puro, para probarlo.
 *
 * Límites: 0.1 (antes 0.2) a 3. Con 0.1 un lienzo de ~10 000 px de ancho cabe en la
 * pantalla de un iPad (≈ 1 000 px) y los paneles siguen distinguibles como rectángulos
 * (un panel de 480 px queda en 48 px, el tamaño de un objetivo táctil); por debajo serían
 * puntos sin utilidad y el navegador tendría que componer demasiados paneles a la vez.
 *
 * Resistencia: en el último tramo antes de cada tope el factor se amortigua, para que se
 * note el límite sin que el gesto "se escape". El ancla (punto medio de los dedos o el
 * puntero) se calcula con el factor REAL aplicado, así el contenido no se desliza en el tope.
 */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 3;
export interface View { x: number; y: number; k: number }

export const clampZoom = (k: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));

/** Factor amortiguado cerca de los topes (zona: de 0.1 a 0.2 y de 2 a 3). */
export function resist(k: number, f: number): number {
  if (f < 1 && k < ZOOM_MIN * 2) return f ** Math.max(0.15, (k - ZOOM_MIN) / ZOOM_MIN);
  if (f > 1 && k > ZOOM_MAX / 1.5) return f ** Math.max(0.15, (ZOOM_MAX - k) / (ZOOM_MAX - ZOOM_MAX / 1.5));
  return f;
}

/** Aplica un factor anclado en (cx, cy) (coordenadas del contenedor). */
export function zoomAt(v: View, f: number, cx: number, cy: number): View {
  if (!Number.isFinite(f) || f <= 0) return v;
  const k = clampZoom(v.k * resist(v.k, f));
  const r = k / v.k;
  if (r === 1) return v;
  return { k, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r };
}

/**
 * Culling por ventana visible (Prompt 11 · 5). Un panel está «en pantalla» si su rectángulo del
 * mundo se cruza con la vista (más un margen en px de pantalla). Solo esos pueden montar su
 * contenido; de ellos, a lo sumo `max` despiertos, con prioridad para el que tiene el foco y
 * luego los más recientes (el orden de `panels`).
 */
export interface WorldRect { id: string; x: number; y: number; w: number; h: number }
export function onScreen(r: WorldRect, v: View, W: number, H: number, margin = 200): boolean {
  const x = r.x * v.k + v.x, y = r.y * v.k + v.y;
  return x < W + margin && x + r.w * v.k > -margin && y < H + margin && y + r.h * v.k > -margin;
}
export function awakePanels(panels: WorldRect[], v: View, W: number, H: number, focus: string | null, max: number, margin = 200): Set<string> {
  const vis = panels.filter((r) => onScreen(r, v, W, H, margin));
  const order = [...vis.filter((r) => r.id !== focus), ...vis.filter((r) => r.id === focus)];
  return new Set(order.slice(-max).map((r) => r.id));
}
/** Por debajo de este zoom los paneles se dibujan como tarjeta ligera (icono y título). */
export const LITE_ZOOM = 0.35;
