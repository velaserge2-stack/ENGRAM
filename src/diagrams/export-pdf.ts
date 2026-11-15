// PDF de un diagrama (CONTRATO §P22.5). Misma escena que SVG/PNG (`buildScene`): medidas de pantalla y `edgeGeometry`.
// Vectorial por defecto (formas, aristas, puntas rellenas y texto seleccionable en Helvetica). Raster de respaldo
// (PNG por mosaicos ≤ 16 M px) si algún texto no cabe en WinAnsi o si la vectorial falla. pdf-lib se carga con import().
// Este módulo no traduce: título y fecha llegan ya traducidos.
import { buildScene, CANVAS_MAX_PX, CANVAS_MAX_SIDE, gridPath, lineH, sceneToSvg, svgToPng, type Scene, type TextStyle } from './export';
import type { Measured } from './measure';
import type { Backdrop, DiagramDoc, Layout } from './types';

export interface PdfOpts {
  page: 'ajustar' | 'a4' | 'carta'; fit: 'una' | 'varias'; margin: number /* pt */; title?: string; date?: string;
  backdrop?: Backdrop;
  /** Pruebas / forzar: pinta un SVG a PNG de `w×h` px. Por defecto, canvas del navegador. */
  render?: (svg: string, w: number, h: number) => Promise<Uint8Array>;
  forceRaster?: boolean;
}
export interface PdfResult { blob: Blob; mode: 'vector' | 'raster'; pages: number }
export type PdfErrorCode = 'paginas' | 'tamano' | 'fallo';
export class PdfExportError extends Error {
  constructor(readonly code: PdfErrorCode, readonly detail?: string) { super(`pdf:${code}`); this.name = 'PdfExportError'; }
}

export const MAX_SIDE = 14_400; // pt, límite de PDF
export const MAX_PAGES = 50;
export const MAX_BYTES = 50 * 1024 * 1024;
export const OVERLAP = 18; // pt de solapamiento entre páginas en «varias»
const SIZES = { a4: [595.28, 841.89], carta: [612, 792] } as const;
const RASTER_BUDGET = 64_000_000; // px totales en raster
type R = { x: number; y: number; w: number; h: number };

export interface PagePlan { w: number; h: number; region: R; at: { x: number; y: number } } // region en px del diagrama; at = esquina sup. izq. (pt desde arriba)
export interface Plan { s: number; header: number; margin: number; pages: PagePlan[]; grid: { cols: number; rows: number } }

const headerH = (o: Pick<PdfOpts, 'title' | 'date'>) => (o.title ? 22 : 0) + (o.date ? 14 : 0) + (o.title || o.date ? 6 : 0);

/** Páginas y escala (pt por px del diagrama). Lanza `paginas` si pasa de MAX_PAGES. Pura. */
export function planPages(b: R, o: Pick<PdfOpts, 'page' | 'fit' | 'margin' | 'title' | 'date'>): Plan {
  const hdr = headerH(o);
  let m = Math.max(0, Math.min(144, Number.isFinite(o.margin) ? o.margin : 36));
  if (o.page === 'ajustar') {
    const s = Math.min(1, (MAX_SIDE - 2 * m) / b.w, (MAX_SIDE - 2 * m - hdr) / b.h);
    return { s, header: hdr, margin: m, grid: { cols: 1, rows: 1 }, pages: [{ w: b.w * s + 2 * m, h: b.h * s + 2 * m + hdr, region: b, at: { x: m, y: m + hdr } }] };
  }
  const [pw0, ph0] = SIZES[o.page];
  m = Math.min(m, pw0 / 4);
  const orient = (land: boolean) => {
    const pw = land ? ph0 : pw0, ph = land ? pw0 : ph0, aw = pw - 2 * m, ah = ph - 2 * m - hdr;
    if (o.fit === 'una') {
      const s = Math.min(1, aw / b.w, ah / b.h);
      return { s, pw, ph, cols: 1, rows: 1, aw, ah };
    }
    const s = 1, cols = Math.max(1, Math.ceil((b.w * s - OVERLAP) / (aw - OVERLAP))), rows = Math.max(1, Math.ceil((b.h * s - OVERLAP) / (ah - OVERLAP)));
    return { s, pw, ph, cols, rows, aw, ah };
  };
  const land = b.w > b.h;
  let c = orient(land);
  if (o.fit === 'varias') { const alt = orient(!land); if (alt.cols * alt.rows < c.cols * c.rows) c = alt; }
  const n = c.cols * c.rows;
  if (n > MAX_PAGES) throw new PdfExportError('paginas', String(n));
  const pages: PagePlan[] = [];
  const stepX = (c.aw - OVERLAP) / c.s, stepY = (c.ah - OVERLAP) / c.s;
  for (let r = 0; r < c.rows; r++) for (let k = 0; k < c.cols; k++) {
    const x = b.x + k * stepX, y = b.y + r * stepY;
    const region = c.cols * c.rows === 1 ? b : { x, y, w: Math.min(c.aw / c.s, b.x + b.w - x), h: Math.min(c.ah / c.s, b.y + b.h - y) };
    const dx = n === 1 ? Math.max(0, (c.aw - b.w * c.s) / 2) : 0;
    pages.push({ w: c.pw, h: c.ph, region, at: { x: m + dx, y: m + hdr } });
  }
  return { s: c.s, header: hdr, margin: m, pages, grid: { cols: c.cols, rows: c.rows } };
}

/** Divide `w×h` px en mosaicos con área ≤ `maxPx` y lado ≤ `maxSide`. Pura. */
export function planTiles(w: number, h: number, maxPx = CANVAS_MAX_PX, maxSide = CANVAS_MAX_SIDE): R[] {
  let cols = Math.max(1, Math.ceil(w / maxSide)), rows = Math.max(1, Math.ceil(h / maxSide));
  while (Math.ceil(w / cols) * Math.ceil(h / rows) > maxPx) { if (w / cols >= h / rows) cols++; else rows++; }
  const tw = Math.ceil(w / cols), th = Math.ceil(h / rows), out: R[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: c * tw, y: r * th, w: Math.min(tw, w - c * tw), h: Math.min(th, h - r * th) });
  return out;
}

/** Regla de ajuste: la línea va a `fs` salvo que en Helvetica mida más que su caja; entonces se reduce ESA línea. */
export function fitLineSize(widthAtFs: number, fs: number, avail: number): number {
  return widthAtFs > avail && widthAtFs > 0 ? Math.max(3, fs * (avail / widthAtFs)) : fs;
}

const hexRgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] as const; };
const hits = (a: R, b: R) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function texts(sc: Scene, o: PdfOpts): string[] {
  return [...sc.nodes.flatMap((n) => n.lines), ...sc.edges.flatMap((e) => (e.label ? [e.label] : [])), o.title ?? '', o.date ?? ''];
}

async function defaultRender(svg: string, w: number, h: number): Promise<Uint8Array> {
  const b = await svgToPng(svg, w, h);
  if (!b) throw new Error('canvas');
  return new Uint8Array(await b.arrayBuffer());
}

export async function exportPdf(doc: DiagramDoc, layout: Layout, measured: Map<string, Measured>, opts: PdfOpts): Promise<PdfResult> {
  const lib = await import('pdf-lib');
  const { PDFDocument, StandardFonts, rgb, LineCapStyle, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = lib;
  const sc = buildScene(doc, layout, measured, opts.backdrop);
  const plan = planPages(sc.bounds, opts);
  const col = (hex: string) => { const [r, g, b] = hexRgb(hex); return rgb(r, g, b); };

  const build = async (mode: 'vector' | 'raster') => {
    const pdf = await PDFDocument.create();
    pdf.setTitle(opts.title ?? 'Diagrama'); pdf.setProducer('Engrama'); pdf.setCreator('Engrama');
    const F: Record<TextStyle, Awaited<ReturnType<typeof pdf.embedFont>>> = {
      '': await pdf.embedFont(StandardFonts.Helvetica), b: await pdf.embedFont(StandardFonts.HelveticaBold),
      i: await pdf.embedFont(StandardFonts.HelveticaOblique), bi: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    };
    const encodable = (s: string) => { try { F[''].encodeText(s); return true; } catch { return false; } };
    if (mode === 'vector' && !texts(sc, opts).every(encodable)) return null; // → raster
    const safe = (s: string) => (encodable(s) ? s : [...s].filter(encodable).join('')); // título/fecha en raster
    const { s } = plan;
    let ppp = 2; // px de imagen por pt
    if (mode === 'raster') {
      const area = sc.bounds.w * sc.bounds.h * s * s;
      if (area * 9 <= 8_000_000) ppp = 3;
      else if (area * 4 > RASTER_BUDGET) ppp = Math.max(0.5, Math.sqrt(RASTER_BUDGET / area));
    }
    const n = plan.pages.length;
    for (const [i, pp] of plan.pages.entries()) {
      const page = pdf.addPage([pp.w, pp.h]);
      const { region: rg, at } = pp, H = pp.h;
      const ox = at.x - rg.x * s, oy = H - at.y + rg.y * s; // origen del diagrama (para drawSvgPath, y hacia abajo)
      const px = (x: number) => ox + x * s, py = (y: number) => oy - y * s;
      const cw = rg.w * s, ch = rg.h * s;
      // Encabezado
      if (opts.title) page.drawText(safe(opts.title), { x: plan.margin, y: H - plan.margin - 16, size: 16, font: F.b, color: col('#18181b') });
      if (opts.date) page.drawText(safe(opts.date), { x: plan.margin, y: H - plan.margin - (opts.title ? 22 : 0) - 10, size: 10, font: F[''], color: col('#52525b') });
      if (n > 1) {
        // Marcas de corte en las esquinas del área y número de página.
        const k = Math.min(10, plan.margin - 2), g = col('#a1a1aa');
        if (k > 2) for (const [cx, cy, sx, sy] of [[at.x, H - at.y, -1, 1], [at.x + cw, H - at.y, 1, 1], [at.x, H - at.y - ch, -1, -1], [at.x + cw, H - at.y - ch, 1, -1]] as const) {
          page.drawLine({ start: { x: cx + sx * 2, y: cy }, end: { x: cx + sx * (2 + k), y: cy }, thickness: 0.5, color: g });
          page.drawLine({ start: { x: cx, y: cy + sy * 2 }, end: { x: cx, y: cy + sy * (2 + k) }, thickness: 0.5, color: g });
        }
        page.drawText(`${i + 1}/${n}`, { x: pp.w - plan.margin - 24, y: Math.max(4, plan.margin / 2 - 3), size: 8, font: F[''], color: g });
      }
      if (mode === 'raster') {
        const k = ppp * s; // px de imagen por px del diagrama
        const W = Math.max(1, Math.ceil(rg.w * k)), Hh = Math.max(1, Math.ceil(rg.h * k));
        for (const t of planTiles(W, Hh)) {
          const view = { x: rg.x + t.x / k, y: rg.y + t.y / k, w: t.w / k, h: t.h / k };
          const png = await (opts.render ?? defaultRender)(sceneToSvg(sc, view, { width: t.w, height: t.h }), t.w, t.h);
          const img = await pdf.embedPng(png);
          page.drawImage(img, { x: px(view.x), y: py(view.y + view.h), width: view.w * s, height: view.h * s });
        }
        continue;
      }
      page.pushOperators(pushGraphicsState(), rectangle(at.x, H - at.y - ch, cw, ch), clip(), endPath());
      page.drawRectangle({ x: at.x, y: H - at.y - ch, width: cw, height: ch, color: col(sc.bg) });
      const o = { x: ox, y: oy, scale: s };
      if (sc.grid === 'lineas') page.drawSvgPath(gridPath('lineas', rg), { ...o, borderColor: col(sc.gridColor), borderWidth: 1 });
      if (sc.grid === 'puntos') page.drawSvgPath(gridPath('puntos', rg), { ...o, color: col(sc.gridColor) });
      for (const e of sc.edges) {
        if (!hits(e.box, rg)) continue;
        page.drawSvgPath(e.d, { ...o, borderColor: col(e.color), borderWidth: e.width, borderLineCap: LineCapStyle.Round, ...(e.dash ? { borderDashArray: e.dash } : {}) });
        if (e.head) page.drawSvgPath(e.head, { ...o, color: col(e.color) });
        if (e.tail) page.drawSvgPath(e.tail, { ...o, color: col(e.color) });
      }
      for (const nd of sc.nodes) {
        if (!hits(nd, rg)) continue;
        page.drawSvgPath(nd.d, { ...o, ...(nd.fill ? { color: col(nd.fill) } : {}), borderColor: col(nd.stroke), borderWidth: nd.strokeW, ...(nd.dash ? { borderDashArray: nd.dash } : {}) });
        const font = F[nd.style], lh = lineH(nd.fontSize), fs = nd.fontSize * s, avail = nd.textW * s;
        const y0 = nd.y + nd.h / 2 - (nd.lines.length * lh) / 2;
        nd.lines.forEach((line, j) => {
          if (!line.trim()) return;
          const size = fitLineSize(font.widthOfTextAtSize(line, fs), fs, avail);
          const w = font.widthOfTextAtSize(line, size);
          page.drawText(line, { x: px(nd.x + nd.w / 2) - w / 2, y: py(y0 + lh * (j + 0.5)) - 0.35 * size, size, font, color: col(nd.ink) });
        });
      }
      for (const e of sc.edges) {
        if (!e.label || !e.labelAt || !hits(e.box, rg)) continue;
        const size = 12 * s, w = F[''].widthOfTextAtSize(e.label, size), cx = px(e.labelAt.x), cy = py(e.labelAt.y);
        page.drawRectangle({ x: cx - w / 2 - 2 * s, y: cy - size * 0.6, width: w + 4 * s, height: size * 1.2, color: col(sc.bg) });
        page.drawText(e.label, { x: cx - w / 2, y: cy - 0.35 * size, size, font: F[''], color: col(sc.labelInk) });
      }
      page.pushOperators(popGraphicsState());
    }
    const bytes = await pdf.save();
    if (bytes.byteLength > MAX_BYTES) throw new PdfExportError('tamano', String(bytes.byteLength));
    return { blob: new Blob([bytes as BlobPart], { type: 'application/pdf' }), mode, pages: n };
  };

  if (!opts.forceRaster) {
    try { const r = await build('vector'); if (r) return r; }
    catch (e) { if (e instanceof PdfExportError) throw e; }
  }
  try { return (await build('raster'))!; }
  catch (e) { throw e instanceof PdfExportError ? e : new PdfExportError('fallo', String((e as Error)?.message ?? e)); }
}
