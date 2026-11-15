// Exportar un diagrama (CONTRATO §5-6, §P22.3-5): una sola «escena» con colores concretos (hex, papel claro;
// fondo `oscuro` → paleta oscura) que pintan SVG, PNG y PDF. Tamaños y líneas = `measureDoc` (lo mismo que la
// pantalla); aristas = `edgeGeometry`. Sin recortes «…». El texto se escapa siempre: sin HTML, sin <script>, sin href.
import { edgeGeometry } from './edges';
import { layoutLayered, layoutTree } from './layout';
import { measureDoc, type Measured } from './measure';
import { inkOn, PALETTE_DARK, PALETTE_LIGHT } from './palette';
import type { Backdrop, DiagramDoc, Dir, EdgeEnd, Layout, Shape } from './types';

const PAD = 24, GRID = 24, PAD_X = 12, LABEL_FS = 12;
const FS = { s: 13, m: 15, l: 18 } as const;
export const SVG_FONT = "system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";

export type TextStyle = '' | 'b' | 'i' | 'bi';
export interface SceneNode {
  id: string; shape: Shape; d: string; x: number; y: number; w: number; h: number; // x,y = esquina superior izquierda
  fill: string | null; stroke: string; strokeW: number; dash?: number[]; ink: string;
  lines: string[]; fontSize: number; style: TextStyle; textW: number; // textW = ancho útil para el texto (px)
}
export interface SceneEdge {
  d: string; head?: string; tail?: string; color: string; width: number; dash?: number[];
  label?: string; labelAt?: { x: number; y: number }; box: { x: number; y: number; w: number; h: number };
}
export interface Scene {
  bounds: { x: number; y: number; w: number; h: number }; // área a pintar (acomodo + margen PAD)
  bg: string; grid?: 'lineas' | 'puntos'; gridColor: string; labelInk: string;
  nodes: SceneNode[]; edges: SceneEdge[];
}
export interface ExportOpts { backdrop?: Backdrop; dir?: Dir; mode?: 'horizontal' | 'radial' }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, ' ');
const plain = (s: string) => clean(s.replace(/\*\*|\*|\[\[|\]\]/g, ''));
const num = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);

/** Acomodo con los tamaños medidos: lo mismo que pinta la pantalla. */
export function exportLayout(doc: DiagramDoc, o: ExportOpts = {}): { layout: Layout; measured: Map<string, Measured> } {
  const measured = measureDoc(doc);
  const sizes = new Map([...measured].map(([id, m]) => [id, { w: m.w, h: m.h }]));
  const layout = doc.kind === 'mapa' ? layoutTree(doc, o.mode, sizes) : layoutLayered(doc, o.dir ?? 'TB', sizes);
  return { layout, measured };
}

/** Estilo de todo el nodo: `**texto**` = negrita, `*texto*` = cursiva (mezclas = normal). */
function styleOf(text: string): TextStyle {
  const t = text.replace(/\[\[|\]\]/g, '').trim();
  if (/^\*\*\*[^*]+\*\*\*$/.test(t)) return 'bi';
  if (/^\*\*[^*]+\*\*$/.test(t)) return 'b';
  if (/^\*[^*]+\*$/.test(t)) return 'i';
  return '';
}

/** Contorno de la forma como `d` de SVG en coordenadas absolutas (solo M, L, C, Z: también lo lee pdf-lib). */
export function shapePath(shape: Shape, x: number, y: number, w: number, h: number): string {
  const P = (a: number, b: number) => `${num(a)} ${num(b)}`;
  if (shape === 'diamond') return `M ${P(x + w / 2, y)} L ${P(x + w, y + h / 2)} L ${P(x + w / 2, y + h)} L ${P(x, y + h / 2)} Z`;
  if (shape === 'io') { const k = Math.min(12, w / 4); return `M ${P(x + k, y)} L ${P(x + w, y)} L ${P(x + w - k, y + h)} L ${P(x, y + h)} Z`; }
  const r = Math.min(shape === 'round' ? h / 2 : shape === 'note' ? 2 : 8, w / 2, h / 2), c = r * 0.4477; // 1 − κ
  return `M ${P(x + r, y)} L ${P(x + w - r, y)} C ${P(x + w - c, y)} ${P(x + w, y + c)} ${P(x + w, y + r)}`
    + ` L ${P(x + w, y + h - r)} C ${P(x + w, y + h - c)} ${P(x + w - c, y + h)} ${P(x + w - r, y + h)}`
    + ` L ${P(x + r, y + h)} C ${P(x + c, y + h)} ${P(x, y + h - c)} ${P(x, y + h - r)}`
    + ` L ${P(x, y + r)} C ${P(x, y + c)} ${P(x + c, y)} ${P(x + r, y)} Z`;
}

/** Escena de exportación: geometría y colores concretos, independiente del destino (SVG, PNG, PDF). */
export function buildScene(doc: DiagramDoc, layout: Layout, measured?: Map<string, Measured>, backdrop: Backdrop = 'claro'): Scene {
  const ms = measured ?? measureDoc(doc);
  const dark = backdrop === 'oscuro';
  const pal = dark ? PALETTE_DARK : PALETTE_LIGHT;
  const C = dark
    ? { bg: '#1c1c1e', fill: '#2c2c2e', stroke: '#a1a1aa', text: '#f4f4f5', ink: '#e5e5e5', note: '#d4d4d8', root: '#f4f4f5', grid: '#3a3a3c' }
    : { bg: backdrop === 'gris' ? '#f2f2f3' : '#ffffff', fill: '#f4f4f5', stroke: '#71717a', text: '#18181b', ink: '#1a1a1a', note: '#3f3f46', root: '#18181b', grid: '#e4e4e7' };
  const isMap = doc.kind === 'mapa';
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const nodes: SceneNode[] = [], edges: SceneEdge[] = [];

  for (const n of doc.nodes) {
    const p = layout.pos.get(n.id);
    if (!p) continue;
    const m = ms.get(n.id);
    const shape: Shape = isMap ? 'rect' : n.shape;
    const w = p.w, h = p.h, x = p.x - w / 2, y = p.y - h / 2;
    const hex = n.color ? pal[n.color - 1] : undefined;
    const root = isMap && n.depth <= 0 && !hex;
    const fill = hex ?? (root ? C.root : shape === 'note' ? null : C.fill);
    const side = shape === 'io' || shape === 'round' ? 16 : 0;
    nodes.push({
      id: n.id, shape, d: shapePath(shape, x, y, w, h), x, y, w, h,
      fill, stroke: hex ?? (root ? C.root : C.stroke), strokeW: 1.5, ...(shape === 'note' ? { dash: [4, 3] } : {}),
      ink: (hex || root) && fill ? inkOn(fill) : fill ? C.text : C.note,
      lines: (m?.lines ?? [plain(n.text)]).map(clean), fontSize: FS[n.fs ?? 'm'] ?? 15, style: styleOf(n.text),
      textW: Math.max(1, (shape === 'diamond' ? w / Math.SQRT2 : w) - 2 * PAD_X - side),
    });
  }

  const boxOf = (id: string) => { const p = layout.pos.get(id); const n = byId.get(id); return p && { ...p, shape: isMap ? 'rect' as Shape : n?.shape }; };
  const ebox = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => {
    const x0 = Math.min(a.x - a.w / 2, b.x - b.w / 2), y0 = Math.min(a.y - a.h / 2, b.y - b.h / 2);
    return { x: x0 - 40, y: y0 - 40, w: Math.max(a.x + a.w / 2, b.x + b.w / 2) - x0 + 80, h: Math.max(a.y + a.h / 2, b.y + b.h / 2) - y0 + 80 };
  };
  if (isMap) {
    for (const n of doc.nodes) {
      const a = n.parent ? boxOf(n.parent) : undefined, b = boxOf(n.id);
      if (!a || !b) continue;
      const width = n.depth <= 1 ? 2 : 1.5;
      edges.push({ d: edgeGeometry(a, b, 'curva', { width, ends: 'sin' }).d, color: C.ink, width, box: ebox(a, b) });
    }
  } else {
    for (const e of doc.edges) {
      const a = boxOf(e.from), b = boxOf(e.to);
      if (!a || !b) continue;
      const width = e.w ?? 1.5;
      const ends: EdgeEnd = e.fin ?? (e.arrow === 'none' ? 'sin' : e.arrow === 'both' ? 'ambos' : 'flecha');
      const g = edgeGeometry(a, b, e.route ?? 'curva', { width, ends });
      const label = e.label ? plain(e.label).trim() : '';
      edges.push({
        d: g.d, ...(g.head ? { head: g.head.d } : {}), ...(g.tail ? { tail: g.tail.d } : {}),
        color: e.color ? pal[e.color - 1]! : C.ink, width, ...(e.dash ? { dash: [6, 4] } : {}),
        ...(label ? { label, labelAt: g.labelAt } : {}), box: ebox(a, b),
      });
    }
  }
  const b = layout.bounds;
  return {
    bounds: { x: b.x - PAD, y: b.y - PAD, w: Math.max(1, b.w + PAD * 2), h: Math.max(1, b.h + PAD * 2) },
    bg: C.bg, gridColor: C.grid, labelInk: C.text, nodes, edges,
    ...(backdrop === 'cuadricula' ? { grid: 'lineas' as const } : backdrop === 'puntos' ? { grid: 'puntos' as const } : {}),
  };
}

/** Cuadrícula o puntos (cada 24 px, alineados a 0) dentro de `r`, como un solo `d`. */
export function gridPath(kind: 'lineas' | 'puntos', r: { x: number; y: number; w: number; h: number }): string {
  const out: string[] = [];
  const x0 = Math.ceil(r.x / GRID) * GRID, y0 = Math.ceil(r.y / GRID) * GRID;
  if (kind === 'lineas') {
    for (let x = x0; x <= r.x + r.w; x += GRID) out.push(`M ${num(x)} ${num(r.y)} L ${num(x)} ${num(r.y + r.h)}`);
    for (let y = y0; y <= r.y + r.h; y += GRID) out.push(`M ${num(r.x)} ${num(y)} L ${num(r.x + r.w)} ${num(y)}`);
  } else {
    for (let x = x0; x <= r.x + r.w; x += GRID) for (let y = y0; y <= r.y + r.h; y += GRID) out.push(`M ${x - 1} ${y - 1} L ${x + 1} ${y - 1} L ${x + 1} ${y + 1} L ${x - 1} ${y + 1} Z`);
  }
  return out.join(' ');
}

const fontAttrs = (st: TextStyle) => (st.includes('b') ? ' font-weight="700"' : '') + (st.includes('i') ? ' font-style="italic"' : '');
export const lineH = (fs: number) => 1.3 * fs;

/** SVG de la escena. `view` = recorte en coordenadas del diagrama (mosaicos del PDF raster); `width/height` en px. */
export function sceneToSvg(sc: Scene, view = sc.bounds, size?: { width: number; height: number }): string {
  const W = Math.max(1, Math.ceil(size?.width ?? view.w)), H = Math.max(1, Math.ceil(size?.height ?? view.h));
  const parts: string[] = [`<rect x="${num(view.x)}" y="${num(view.y)}" width="${num(view.w)}" height="${num(view.h)}" fill="${sc.bg}"/>`];
  if (sc.grid) parts.push(sc.grid === 'lineas'
    ? `<path d="${gridPath('lineas', view)}" fill="none" stroke="${sc.gridColor}" stroke-width="1"/>`
    : `<path d="${gridPath('puntos', view)}" fill="${sc.gridColor}"/>`);
  for (const e of sc.edges) {
    const dash = e.dash ? ` stroke-dasharray="${e.dash.join(' ')}"` : '';
    parts.push(`<path d="${esc(e.d)}" fill="none" stroke="${e.color}" stroke-width="${e.width}" stroke-linecap="round" stroke-linejoin="round"${dash}/>`);
    if (e.head) parts.push(`<path d="${esc(e.head)}" fill="${e.color}"/>`);
    if (e.tail) parts.push(`<path d="${esc(e.tail)}" fill="${e.color}"/>`);
  }
  for (const n of sc.nodes) {
    const lh = lineH(n.fontSize), cx = n.x + n.w / 2, y0 = n.y + n.h / 2 - (n.lines.length * lh) / 2;
    const tspans = n.lines.map((l, i) => `<tspan x="${num(cx)}" y="${num(y0 + lh * (i + 0.5))}">${esc(l)}</tspan>`).join('');
    const dash = n.dash ? ` stroke-dasharray="${n.dash.join(' ')}"` : '';
    parts.push(`<g><path d="${n.d}" fill="${n.fill ?? 'none'}" stroke="${n.stroke}" stroke-width="${n.strokeW}"${dash}/>`
      + `<text text-anchor="middle" dominant-baseline="central" font-size="${n.fontSize}"${fontAttrs(n.style)} fill="${n.ink}">${tspans}</text></g>`);
  }
  for (const e of sc.edges) {
    if (!e.label || !e.labelAt) continue;
    parts.push(`<text x="${num(e.labelAt.x)}" y="${num(e.labelAt.y)}" text-anchor="middle" dominant-baseline="central" font-size="${LABEL_FS}" fill="${sc.labelInk}" stroke="${sc.bg}" stroke-width="4" paint-order="stroke">${esc(e.label)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${num(view.x)} ${num(view.y)} ${num(view.w)} ${num(view.h)}" font-family="${esc(SVG_FONT)}">${parts.join('')}</svg>`;
}

export interface SvgSize { width: number; height: number }

/** Tamaño del SVG que producirá `diagramToSvg` (límites del acomodo + margen). */
export function svgSize(layout: Layout): SvgSize {
  const b = layout.bounds;
  return { width: Math.max(1, Math.ceil(b.w + PAD * 2)), height: Math.max(1, Math.ceil(b.h + PAD * 2)) };
}

/** SVG autocontenido. Sin `layout`/`measured` los calcula con `exportLayout` (lo mismo que la pantalla). */
export function diagramToSvg(doc: DiagramDoc, layout?: Layout, measured?: Map<string, Measured>, opts: ExportOpts = {}): string {
  if (!layout) ({ layout, measured } = exportLayout(doc, opts));
  return sceneToSvg(buildScene(doc, layout, measured, opts.backdrop));
}

export const CANVAS_MAX_PX = 16_000_000; // Safari: ~16,7 M px por canvas
export const CANVAS_MAX_SIDE = 8192;

/** Dimensiones del PNG: el lado mayor no pasa de `maxSide` ni el área de 16 M px; escala hasta 2×. */
export function pngSize(w: number, h: number, maxSide: number): { width: number; height: number; scale: number } {
  const scale = Math.min(2, maxSide / Math.max(w, h, 1), Math.sqrt(CANVAS_MAX_PX / Math.max(1, w * h)));
  return { width: Math.max(1, Math.floor(w * scale)), height: Math.max(1, Math.floor(h * scale)), scale };
}

/** Pinta un SVG en un canvas de `width×height` y devuelve el PNG (o `null` si el navegador no puede). */
export async function svgToPng(svg: string, width: number, height: number, bg = '#ffffff'): Promise<Blob | null> {
  try {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
    const img = new Image();
    img.decoding = 'async';
    const loaded = new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('img')); });
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await loaded;
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    if ('OffscreenCanvas' in window) canvas = new OffscreenCanvas(width, height);
    else { canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; }
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    if (canvas instanceof HTMLCanvasElement) return await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/png'));
    return await canvas.convertToBlob({ type: 'image/png' });
  } catch { return null; }
}

/** Rasteriza el SVG a PNG. Devuelve `null` si el navegador no puede (quien llama muestra el texto fuente con aviso). */
export async function diagramToPngBlob(svg: string, opts: { maxSide?: number } = {}): Promise<Blob | null> {
  const m = /<svg[^>]*\swidth="(\d+)"[^>]*\sheight="(\d+)"/.exec(svg);
  if (!m) return null;
  const { width, height } = pngSize(+m[1]!, +m[2]!, opts.maxSide ?? 2048);
  return svgToPng(svg, width, height, /<rect [^>]*fill="(#[0-9a-f]{6})"/.exec(svg)?.[1] ?? '#ffffff');
}
