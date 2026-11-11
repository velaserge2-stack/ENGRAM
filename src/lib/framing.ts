/**
 * Encuadre de fondos propios (Mejoras 2 · C9): posición (0–100 % en cada eje, como
 * `object-position`) y acercamiento (1–3×, escalado desde ese mismo punto). Se guarda por
 * fondo en `.app/fondos.json`. La misma cuenta sirve para el CSS, para la muestra del
 * guardián de legibilidad y para la miniatura: lo que se mide es lo que se ve.
 */
export const FRAMING_PATH = '.app/fondos.json';

export interface Framing { x: number; y: number; zoom: number }
export const DEFAULT_FRAMING: Framing = { x: 50, y: 50, zoom: 1 };

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function normFraming(f: Partial<Framing> | null | undefined): Framing {
  const r = (v: number, k: number) => Math.round(v * k) / k;
  return { x: r(clamp(f?.x, 0, 100, 50), 10), y: r(clamp(f?.y, 0, 100, 50), 10), zoom: r(clamp(f?.zoom, 1, 3, 1), 100) };
}

export function parseFramings(text: string): Record<string, Framing> {
  try {
    const raw = JSON.parse(text) as Record<string, Partial<Framing>>;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, normFraming(v)]));
  } catch {
    return {};
  }
}

export const isDefault = (f: Framing) => f.x === 50 && f.y === 50 && f.zoom === 1;

/** Rectángulo donde dibujar una imagen `iw×ih` en una caja `w×h` (cover + posición + zoom). */
export function framedRect(iw: number, ih: number, w: number, h: number, f: Framing = DEFAULT_FRAMING): { x: number; y: number; w: number; h: number } {
  const s = Math.max(w / iw, h / ih);
  const dw = iw * s, dh = ih * s;
  const ox = (w - dw) * (f.x / 100), oy = (h - dh) * (f.y / 100);
  const px = w * (f.x / 100), py = h * (f.y / 100); // origen del zoom (transform-origin)
  return { x: px + (ox - px) * f.zoom, y: py + (oy - py) * f.zoom, w: dw * f.zoom, h: dh * f.zoom };
}

/** Valores CSS equivalentes (para `.bg-layer > img`). */
export function framingStyle(f: Framing): Record<string, string> {
  return { '--bg-pos': `${f.x}% ${f.y}%`, '--bg-zoom': String(f.zoom) };
}
