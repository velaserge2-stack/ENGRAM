// Medición de nodos (CONTRATO §P22.3): ajuste de línea y tamaño de caja. Puro salvo el medidor por defecto (canvas).
import type { DiagramDoc, DiagramNode, Shape } from './types';

export type Measurer = (text: string, font: string) => number;
export interface MeasureIn { text: string; shape: Shape; fontSize: number; maxW: number; manualW?: number; manualH?: number }
export interface Measured { w: number; h: number; lines: string[] }
export type { SizeMap } from './layout';

export const MAX_TEXT = 5000;
export const DEFAULT_MAXW = 220;
const FONT = 'system-ui, -apple-system, sans-serif';
const PAD_X = 12, PAD_Y = 8, LINE_H = 1.3, SQ2 = Math.SQRT2;
const FS = { s: 13, m: 15, l: 18 } as const;
const CACHE_MAX = 500;

type St = '' | 'b' | 'i' | 'bi';
const fontOf = (px: number, st: St) => `${st.includes('i') ? 'italic ' : ''}${st.includes('b') ? '700 ' : '400 '}${px}px ${FONT}`;

/** Estimación determinista (sin canvas): caracteres anchos (CJK, emoji) = 1 em; el resto 0,55 em. */
const wide = (c: number) => (c >= 0x2e80 && c <= 0xffef) || c >= 0x1f000;
const estimate: Measurer = (text, font) => {
  const px = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '15');
  let n = 0;
  for (const ch of text) n += wide(ch.codePointAt(0)!) ? 1 : 0.55;
  return n * px * (/(^|\s)700\s/.test(font) ? 1.06 : 1);
};

let injected: Measurer | null = null;
let canvasM: Measurer | null | undefined;
const cache = new Map<string, Measured>();

function defaultMeasurer(): Measurer {
  if (canvasM === undefined) {
    canvasM = null;
    try {
      const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : typeof document !== 'undefined' ? document.createElement('canvas') : null;
      const ctx = c?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
      if (ctx && typeof ctx.measureText === 'function') {
        ctx.font = '15px sans-serif';
        if (ctx.measureText('mmmm').width > 0) canvasM = (t, f) => { ctx.font = f; return ctx.measureText(t).width; };
      }
    } catch { canvasM = null; }
  }
  return canvasM ?? estimate;
}

export function setMeasurer(m: Measurer | null): void { injected = m; cache.clear(); }
export function clearMeasureCache(): void { cache.clear(); }

interface Piece { t: string; st: St }
/** Quita `[[ ]]` y separa por `**`/`*` (alternan negrita/cursiva). */
function pieces(text: string): Piece[] {
  const out: Piece[] = [];
  let b = false, i = false;
  for (const part of text.replace(/\[\[|\]\]/g, '').split(/(\*\*|\*)/)) {
    if (part === '**') b = !b; else if (part === '*') i = !i;
    else if (part) out.push({ t: part, st: ((b ? 'b' : '') + (i ? 'i' : '')) as St });
  }
  return out;
}

function wrap(text: string, px: number, area: number, m: Measurer): { lines: string[]; widest: number } {
  const lines: string[] = [];
  let widest = 0;
  const wOf = (ps: Piece[]) => ps.reduce((a, p) => a + m(p.t, fontOf(px, p.st)), 0);
  const space = m(' ', fontOf(px, ''));
  for (const para of text.split(/\r?\n/)) {
    // Palabras: listas de caracteres con estilo.
    const words: Piece[][] = [[]];
    for (const p of pieces(para)) {
      p.t.split(/(\s+)/).forEach((tok, k) => {
        if (k % 2 === 1) words.push([]); else if (tok) words[words.length - 1]!.push({ t: tok, st: p.st });
      });
    }
    let cur: Piece[] = [], curW = 0;
    const flush = () => {
      lines.push(cur.map(p => p.t).join('')); widest = Math.max(widest, curW); cur = []; curW = 0;
    };
    for (const w of words) {
      if (!w.length) continue;
      const ww = wOf(w);
      if (cur.length && curW + space + ww > area) flush();
      if (ww <= area) { if (cur.length) { cur.push({ t: ' ', st: '' }); curW += space; } cur.push(...w); curW += ww; continue; }
      // Palabra más ancha que el área: corte por caracteres.
      for (const p of w) for (const ch of p.t) {
        const cw = m(ch, fontOf(px, p.st));
        if (cur.length && curW + cw > area) flush();
        cur.push({ t: ch, st: p.st }); curW += cw;
      }
    }
    if (cur.length || !lines.length) flush();
  }
  return { lines, widest };
}

export function measureNode(i: MeasureIn, m?: Measurer): Measured {
  const meter = m ?? injected ?? defaultMeasurer();
  const text = i.text.length > MAX_TEXT ? i.text.slice(0, MAX_TEXT) : i.text;
  const key = m ? '' : `${i.fontSize}|${i.maxW}|${i.shape}|${text}`;
  let res = key ? cache.get(key) : undefined;
  if (res) { cache.delete(key); cache.set(key, res); }
  else {
    const side = i.shape === 'io' || i.shape === 'round' ? 16 : 0;
    const dia = i.shape === 'diamond';
    const area = Math.max(i.fontSize, (dia ? i.maxW / SQ2 : i.maxW) - 2 * PAD_X - side);
    const { lines, widest } = wrap(text, i.fontSize, area, meter);
    let w = widest + 2 * PAD_X + side, h = lines.length * LINE_H * i.fontSize + 2 * PAD_Y;
    if (dia) { w *= SQ2; h *= SQ2; }
    res = { w: Math.ceil(Math.max(w, 56)), h: Math.ceil(Math.max(h, 36)), lines };
    if (key) { cache.set(key, res); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!); }
  }
  const w = Math.max(res.w, i.manualW ?? 0), h = Math.max(res.h, i.manualH ?? 0);
  return { w, h, lines: res.lines };
}

type Attrs = Partial<{ fs: 's' | 'm' | 'l'; maxw: number; w: number; h: number }>;
export function measureDoc(doc: DiagramDoc, m?: Measurer): Map<string, Measured> {
  const out = new Map<string, Measured>();
  for (const n of doc.nodes) {
    const a = n as DiagramNode & Attrs;
    out.set(n.id, measureNode({ text: n.text, shape: doc.kind === 'mapa' ? 'rect' : n.shape, fontSize: FS[a.fs ?? 'm'] ?? 15, maxW: a.maxw ?? DEFAULT_MAXW, manualW: a.w, manualH: a.h }, m));
  }
  return out;
}
