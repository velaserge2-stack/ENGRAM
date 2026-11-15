// Exportar un diagrama (CONTRATO §5-6): SVG autocontenido y PNG, siempre en TEMA CLARO FIJO con colores concretos.
// Sin HTML (el texto se escapa), sin <script>, sin href externos. `diagramToSvg` es puro; el PNG usa DOM solo al llamarlo.
import type { DiagramDoc, Layout, Shape } from './types';

const PAD = 24, MAX_TEXT = 200, LINE_H = 16, CHAR_W = 7;
const C = { bg: '#ffffff', fill: '#f4f4f5', stroke: '#52525b', text: '#18181b' } as const;
const FONT = "-apple-system, 'Helvetica Neue', Arial, sans-serif";

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const plain = (s: string) => {
  const p = s.replace(/\*\*|\*|\[\[|\]\]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  return p.length > MAX_TEXT ? p.slice(0, MAX_TEXT) + '…' : p;
};

/** Parte el texto en líneas de a lo sumo `max` caracteres (por palabras; corta las palabras largas). */
function wrap(s: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (let w of s.split(/\s+/).filter(Boolean)) {
    while (w.length > max) { if (cur) { out.push(cur); cur = ''; } out.push(w.slice(0, max)); w = w.slice(max); }
    if (!cur) cur = w; else if ((cur + ' ' + w).length <= max) cur += ' ' + w; else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

function shapeEl(shape: Shape, x: number, y: number, w: number, h: number): string {
  const st = `fill="${C.fill}" stroke="${C.stroke}" stroke-width="1.5"`;
  if (shape === 'diamond') return `<polygon points="${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}" ${st}/>`;
  if (shape === 'io') return `<polygon points="${x + 12},${y} ${x + w},${y} ${x + w - 12},${y + h} ${x},${y + h}" ${st}/>`;
  const rx = shape === 'round' ? h / 2 : shape === 'note' ? 2 : 8;
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" ${st}${shape === 'note' ? ' stroke-dasharray="4 3"' : ''}/>`;
}

export interface SvgSize { width: number; height: number }

/** Tamaño del SVG que producirá `diagramToSvg` (límites del acomodo + margen). */
export function svgSize(layout: Layout): SvgSize {
  const b = layout.bounds;
  return { width: Math.max(1, Math.ceil(b.w + PAD * 2)), height: Math.max(1, Math.ceil(b.h + PAD * 2)) };
}

export function diagramToSvg(doc: DiagramDoc, layout: Layout): string {
  const { width: W, height: H } = svgSize(layout);
  const ox = PAD - layout.bounds.x, oy = PAD - layout.bounds.y;
  const num = (n: number) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : 0);
  const isMap = doc.kind === 'mapa';
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const edges: string[] = [], nodes: string[] = [], labels: string[] = [];

  if (isMap) {
    for (const [id, d] of layout.paths) {
      const depth = byId.get(id)?.depth ?? 1;
      edges.push(`<path d="${esc(d)}" transform="translate(${num(ox)} ${num(oy)})" fill="none" stroke="${C.stroke}" stroke-width="${depth <= 1 ? 2 : 1.5}"/>`);
    }
  } else {
    for (const e of doc.edges) {
      const d = layout.paths.get(e.id);
      if (!d) continue;
      const m = (e.arrow !== 'none' ? ' marker-end="url(#a)"' : '') + (e.arrow === 'both' ? ' marker-start="url(#a)"' : '');
      edges.push(`<path d="${esc(d)}" transform="translate(${num(ox)} ${num(oy)})" fill="none" stroke="${C.stroke}" stroke-width="1.5"${m}/>`);
      const a = layout.pos.get(e.from), c = layout.pos.get(e.to);
      if (e.label && a && c) {
        labels.push(`<text x="${num((a.x + c.x) / 2 + ox)}" y="${num((a.y + c.y) / 2 + oy)}" text-anchor="middle" dominant-baseline="central" font-size="12" fill="${C.text}" stroke="${C.bg}" stroke-width="4" paint-order="stroke">${esc(plain(e.label))}</text>`);
      }
    }
  }

  for (const n of doc.nodes) {
    const p = layout.pos.get(n.id);
    if (!p) continue;
    const w = Math.round(p.w), h = Math.round(p.h);
    const x = num(p.x + ox - w / 2), y = num(p.y + oy - h / 2);
    const lines = wrap(plain(n.text), Math.max(4, Math.floor((w - 24) / CHAR_W)));
    const cy = y + h / 2, y0 = cy - ((lines.length - 1) * LINE_H) / 2;
    const bold = isMap && n.depth <= 0 ? ' font-weight="700"' : '';
    const tspans = lines.map((l, i) => `<tspan x="${num(x + w / 2)}" y="${num(y0 + i * LINE_H)}">${esc(l)}</tspan>`).join('');
    nodes.push(`<g>${shapeEl(n.shape, x, y, w, h)}<text text-anchor="middle" dominant-baseline="central" font-size="13"${bold} fill="${C.text}">${tspans}</text></g>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${esc(FONT)}">`
    + `<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${C.stroke}"/></marker></defs>`
    + `<rect width="${W}" height="${H}" fill="${C.bg}"/>${edges.join('')}${nodes.join('')}${labels.join('')}</svg>`;
}

/** Dimensiones del PNG: el lado mayor no pasa de `maxSide`; escala hasta 2× para buena resolución. */
export function pngSize(w: number, h: number, maxSide: number): { width: number; height: number; scale: number } {
  const scale = Math.min(2, maxSide / Math.max(w, h, 1));
  return { width: Math.max(1, Math.floor(w * scale)), height: Math.max(1, Math.floor(h * scale)), scale };
}

/** Rasteriza el SVG a PNG. Devuelve `null` si el navegador no puede (quien llama muestra el texto fuente con aviso). */
export async function diagramToPngBlob(svg: string, opts: { maxSide?: number } = {}): Promise<Blob | null> {
  try {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
    const m = /<svg[^>]*\swidth="(\d+)"[^>]*\sheight="(\d+)"/.exec(svg);
    if (!m) return null;
    const { width, height } = pngSize(+m[1]!, +m[2]!, opts.maxSide ?? 2048);
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
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    if (canvas instanceof HTMLCanvasElement) return await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), 'image/png'));
    return await canvas.convertToBlob({ type: 'image/png' });
  } catch { return null; }
}
