/**
 * Anotaciones de PDF (Prompt 5 · C) en `docs/<nombre>.pdf.annots.json`, sin tocar el PDF.
 * Coordenadas normalizadas a la página (rectángulos en fracción del ancho y del alto; la tinta
 * en «anchos», como todo el motor de tinta) y la rotación de la página: sobreviven al zoom y a
 * la orientación. Si el PDF cambia (otra versión), la huella no coincide: se avisa y se conserva.
 */
import { emptyInk, type InkDoc, type Pt } from '../ink/model';
import { checksum } from '../vault/util';

export type MarkKind = 'highlight' | 'underline' | 'strike';
export type Rect = [number, number, number, number]; // x, y, w, h en fracción de la página
export interface Mark { id: string; kind: MarkKind; color: string; rects: Rect[]; text: string; ts: number }
export interface Sticky { id: string; x: number; y: number; text: string; ts: number }
export interface PageAnn { rot: number; ink: InkDoc; marks: Mark[]; notes: Sticky[] }
export interface Annots { v: 1; pdf: { size: number; hash: string } | null; pages: Record<string, PageAnn> }

export const annotsPath = (pdf: string) => `${pdf}.annots.json`;
export const legacyPath = (pdf: string) => `.app/annotations/${pdf.replace(/\//g, '__')}.json`;
export const emptyAnnots = (): Annots => ({ v: 1, pdf: null, pages: {} });
export const emptyPage = (rot = 0): PageAnn => ({ rot, ink: emptyInk(), marks: [], notes: [] });

/** Huella barata del PDF: tamaño + suma de los primeros 256 KB y los últimos 64 KB. */
export function fingerprint(bytes: Uint8Array): { size: number; hash: string } {
  const head = bytes.subarray(0, 256 * 1024), tail = bytes.subarray(Math.max(0, bytes.length - 64 * 1024));
  return { size: bytes.length, hash: `${checksum(head)}-${checksum(tail)}` };
}
export const samePdf = (a: Annots['pdf'], b: { size: number; hash: string }) => !a || (a.size === b.size && a.hash === b.hash);

export function parseAnnots(text: string): Annots {
  try {
    const a = JSON.parse(text) as Partial<Annots>;
    if (!a || typeof a !== 'object' || !a.pages || typeof a.pages !== 'object') return emptyAnnots();
    const pages: Record<string, PageAnn> = {};
    for (const [k, p] of Object.entries(a.pages)) pages[k] = { rot: Number(p?.rot) || 0, ink: p?.ink && Array.isArray(p.ink.strokes) ? p.ink : emptyInk(), marks: Array.isArray(p?.marks) ? p.marks : [], notes: Array.isArray(p?.notes) ? p.notes : [] };
    return { v: 1, pdf: a.pdf ?? null, pages };
  } catch {
    return emptyAnnots();
  }
}

/** Formato de la fase 9 (`.app/annotations/`): trazos y resaltados en porcentaje de la página. */
type Legacy = { pages?: Record<string, { strokes?: { pts: [number, number, number][]; w: number }[]; highlights?: { rects: [number, number, number, number][]; text: string }[] }> };
export function fromLegacy(text: string, aspect: (page: number) => number): Annots {
  const out = emptyAnnots();
  let l: Legacy;
  try { l = JSON.parse(text) as Legacy; } catch { return out; }
  for (const [k, p] of Object.entries(l.pages ?? {})) {
    const asp = aspect(Number(k)) || 1.3; // alto / ancho
    out.pages[k] = {
      ...emptyPage(),
      ink: { v: 1, strokes: (p.strokes ?? []).map((s, i) => ({ id: `l${k}-${i}`, tool: 'pen' as const, color: '#c4262e', size: s.w * 1.5, pts: s.pts.map(([x, y, pr]) => [x / 100, (y / 100) * asp, pr] as Pt) })) },
      marks: (p.highlights ?? []).map((h, i) => ({ id: `lh${k}-${i}`, kind: 'highlight' as const, color: '#ffd60a', rects: h.rects.map(([x, y, w, hh]) => [x / 100, y / 100, w / 100, hh / 100] as Rect), text: h.text, ts: 0 })),
    };
  }
  return out;
}

/** Una caja de carácter de la capa de texto, en fracción de la página. */
export interface CharBox { ch: string; x: number; y: number; w: number; h: number }

/**
 * Resaltador inteligente: de los caracteres que cubre el trazo (banda vertical y tramo
 * horizontal), toma las líneas reales de texto, ajusta a palabras completas y devuelve un
 * rectángulo por línea y el texto.
 */
export function snapToText(chars: CharBox[], band: { x0: number; x1: number; y0: number; y1: number }): { rects: Rect[]; text: string } {
  const hit = (c: CharBox) => c.y + c.h / 2 >= band.y0 && c.y + c.h / 2 <= band.y1;
  // líneas: caracteres con centro vertical parecido
  const lines: CharBox[][] = [];
  for (const c of chars.filter((c) => hit(c) && c.ch.length)) {
    const ln = lines.find((l) => Math.abs(l[0]!.y + l[0]!.h / 2 - (c.y + c.h / 2)) < Math.max(c.h, l[0]!.h) * 0.5);
    ln ? ln.push(c) : lines.push([c]);
  }
  const rects: Rect[] = [];
  const texts: string[] = [];
  for (const ln of lines.sort((a, b) => a[0]!.y - b[0]!.y)) {
    ln.sort((a, b) => a.x - b.x);
    let i0 = ln.findIndex((c) => c.x + c.w / 2 >= band.x0);
    let i1 = ln.length - 1 - [...ln].reverse().findIndex((c) => c.x + c.w / 2 <= band.x1);
    if (i0 < 0 || i1 < i0 || i1 >= ln.length) continue;
    // ajustar a palabras completas
    while (i0 > 0 && /\S/.test(ln[i0 - 1]!.ch) && /\S/.test(ln[i0]!.ch)) i0--;
    while (i1 < ln.length - 1 && /\S/.test(ln[i1 + 1]!.ch) && /\S/.test(ln[i1]!.ch)) i1++;
    const sel = ln.slice(i0, i1 + 1);
    const x = Math.min(...sel.map((c) => c.x)), y = Math.min(...sel.map((c) => c.y));
    rects.push([x, y, Math.max(...sel.map((c) => c.x + c.w)) - x, Math.max(...sel.map((c) => c.y + c.h)) - y]);
    texts.push(sel.map((c) => c.ch).join('').replace(/\s+/g, ' ').trim());
  }
  return { rects, text: texts.join(' ').trim() };
}

/** Resumen de resaltados en Markdown, por página (con enlace de vuelta a la página). */
export function marksToMarkdown(title: string, pdf: string, a: Annots, link: (page: number) => string): string {
  const out = [`# ${title}`, '', `Resaltados de \`${pdf}\``, ''];
  for (const k of Object.keys(a.pages).map(Number).sort((x, y) => x - y)) {
    const p = a.pages[k]!;
    const items = [...p.marks.filter((m) => m.text).map((m) => `> ${m.text}${m.kind !== 'highlight' ? ` _(${m.kind === 'underline' ? 'subrayado' : 'tachado'})_` : ''}`), ...p.notes.map((n) => `- 📝 ${n.text}`)];
    if (!items.length) continue;
    out.push(`## [Página ${k}](${link(k)})`, '', ...items.flatMap((x) => [x, '']));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
