// Vista de solo lectura de un diagrama (CONTRATO §5-6): nodos HTML + un solo <svg> para los conectores.
// El texto del usuario entra siempre como texto de Preact (nunca HTML); `style` solo lleva números generados.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { t } from '../i18n';
import { parseDiagram, readBackdrop } from './parse';
import { layoutLayered, layoutTree, type SizeMap } from './layout';
import { clearMeasureCache, MAX_TEXT, measureDoc, type Measured } from './measure';
import { edgeGeometry, type EdgeGeo } from './edges';
import type { Backdrop, DiagramDoc, DiagramEdge, DiagramKind, DiagramNode, EdgeEnd, Layout } from './types';
import './diagram.css';

export interface DiagramViewProps { text: string; kind: DiagramKind; /** Fondo ya resuelto (frontmatter `fondo:` de la nota); si falta, se lee del texto. */ backdrop?: Backdrop }

export const MIN = 44; // objetivo táctil mínimo
const PAD = 24;
export const FONT_PX = { s: 13, m: 15, l: 18 } as const;
export const NODE_CLASS: Record<DiagramNode['shape'], string> = {
  rect: '', round: ' diag-round', diamond: ' diag-decision', io: ' diag-io', note: ' diag-note',
};

/** `**negrita**`, `*cursiva*` y `[[nota]]` como nodos de Preact; todo lo demás, texto. Sin recorte salvo el tope de seguridad (5000). */
export function inline(src: string): ComponentChildren[] {
  const s = src.length > MAX_TEXT ? src.slice(0, MAX_TEXT) + '…' : src;
  const out: ComponentChildren[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[\[([^\]]+)\]\]/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<em>{m[2]}</em>);
    else out.push(<span class="diag-wiki" data-wiki={m[3]} role="link" tabIndex={0}>{m[3]}</span>);
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

const plain = (s: string) => s.replace(/\*\*|\*|\[\[|\]\]/g, '');

export interface Model { doc: DiagramDoc; layout: Layout | null; tooBig: boolean; measured: Map<string, Measured>; backdrop: Backdrop }

/** Texto → documento, medidas reales y acomodo con esas medidas (vista y lienzo comparten esto). */
export function buildModel(text: string, kind: DiagramKind): Model {
  const r = parseDiagram(text, kind);
  const backdrop = readBackdrop(text);
  if (r.tooBig) return { doc: r.doc, layout: null, tooBig: true, measured: new Map(), backdrop };
  const measured = measureDoc(r.doc);
  const sizes: SizeMap = new Map();
  for (const [id, m] of measured) sizes.set(id, { w: m.w, h: m.h });
  const layout = kind === 'mapa' ? layoutTree(r.doc, 'horizontal', sizes) : layoutLayered(r.doc, 'TB', sizes);
  return { doc: r.doc, layout, tooBig: false, measured, backdrop };
}

/** Pide re-medir cuando las fuentes terminan de cargar (si el navegador lo informa y aún no estaban listas). */
export function useFontsTick(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const f = (typeof document !== 'undefined' ? (document as Document & { fonts?: { status?: string; ready?: Promise<unknown> } }).fonts : undefined);
    if (!f?.ready || f.status === 'loaded') return;
    let off = false;
    f.ready.then(() => { if (!off) { clearMeasureCache(); setN(1); } }, () => { /* sin fuentes: se queda la medida actual */ });
    return () => { off = true; };
  }, []);
  return n;
}

export const edgeEnds = (e: DiagramEdge): EdgeEnd => e.fin ?? (e.arrow === 'none' ? 'sin' : e.arrow === 'both' ? 'ambos' : 'flecha');
type PBox = { x: number; y: number; w: number; h: number };
const paintedBox = (b: PBox) => ({ x: b.x, y: b.y, w: b.w, h: Math.max(MIN, b.h) });
/** Geometría de una flecha entre dos nodos con la forma real de cada uno (misma función que la exportación). */
export function edgeGeo(e: DiagramEdge, a: PBox, ash: DiagramNode['shape'] | undefined, c: PBox, csh: DiagramNode['shape'] | undefined): EdgeGeo {
  return edgeGeometry({ ...paintedBox(a), shape: ash }, { ...paintedBox(c), shape: csh }, e.route ?? 'curva', { width: e.w ?? 2, ends: edgeEnds(e) });
}

export function nodeClass(n: DiagramNode, isMap: boolean, folded: boolean, extra = ''): string {
  const lvl = isMap ? (n.depth <= 0 ? ' diag-root' : n.depth === 1 ? ' diag-l1' : ' diag-l2') : ' diag-l1';
  return 'diag-node' + lvl + NODE_CLASS[isMap ? 'rect' : n.shape] + (n.color ? ` diag-c${n.color}` : '') + (folded ? ' diag-folded' : '') + extra;
}
export const nodeFont = (n: DiagramNode) => `${FONT_PX[n.fs ?? 'm']}px`;

/** Nodo: caja medida + texto del usuario sin recorte (el CSS del bloque B lo ajusta como el medidor). */
export function NodeText({ n }: { n: DiagramNode }): JSX.Element {
  return <span class="diag-text" data-user-content>{inline(n.text)}</span>;
}

interface EdgeGProps { e: DiagramEdge; geo: EdgeGeo; on?: boolean; ox?: number; oy?: number }
/** Flecha: línea que termina en la base de la punta + punta rellena del mismo color, opaca; zona de toque ancha invisible. */
export function EdgeG({ e, geo, on, ox, oy }: EdgeGProps): JSX.Element {
  const col = e.color ? `var(--diag-c${e.color})` : 'var(--diag-ink)';
  const w = e.w ?? 2;
  const line = `stroke:${col};stroke-opacity:1` + (e.dash ? `;stroke-dasharray:${w * 3} ${w * 2}` : '');
  const solid = `fill:${col};fill-opacity:1;stroke:${col};stroke-opacity:1;stroke-width:1px;stroke-linejoin:round`;
  return (
    <g class={'diag-eg' + (on ? ' diag-edge-sel' : '')} style={`--sw:${w}px`} data-edge={e.id} transform={ox !== undefined ? `translate(${ox} ${oy})` : undefined}>
      <path class="diag-edge-hit" data-hit={e.id} d={geo.d} />
      <path class="diag-edge" data-path={e.id} d={geo.d} style={line} />
      {geo.head && <path class="diag-head" data-head={e.id} d={geo.head.d} style={solid} />}
      {geo.tail && <path class="diag-head" data-tail={e.id} d={geo.tail.d} style={solid} />}
    </g>
  );
}

export const backdropClass = (b: Backdrop) => (b === 'cristal' ? '' : ` diag-bd-${b}`);

export function DiagramView({ text, kind, backdrop }: DiagramViewProps): JSX.Element {
  const tick = useFontsTick();
  const m = useMemo(() => buildModel(text, kind), [text, kind, tick]);
  if (m.tooBig || !m.layout) {
    return (
      <div class="diag-host-view">
        <p class="diag-warn" role="status">{t('diag.demasiados_nodos')}</p>
        <pre class="diag-src" data-user-content>{text}</pre>
      </div>
    );
  }
  const { doc, layout } = m;
  if (!doc.nodes.length) return <div class="diag-host-view" />;
  const isMap = kind === 'mapa';
  const b = layout.bounds;
  const W = Math.ceil(b.w + PAD * 2), H = Math.ceil(b.h + PAD * 2);
  const ox = PAD - b.x, oy = PAD - b.y; // del espacio del acomodo al lienzo
  const label = t(isMap ? 'diag.mapa' : 'diag.flujo');
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const shown = doc.nodes.filter((n) => layout.pos.has(n.id));
  const hasKids = new Set(doc.nodes.map((n) => n.parent).filter((p): p is string => !!p));

  const nodeEls = shown.map((n) => {
    const p = layout.pos.get(n.id)!;
    const w = Math.round(p.w), h = Math.max(MIN, Math.round(p.h));
    const cls = nodeClass(n, isMap, !!n.folded && hasKids.has(n.id));
    // Preact 11 no añade px a los números en style: cadenas explícitas (CLAUDE.md)
    const style = { width: `${w}px`, height: `${h}px`, fontSize: nodeFont(n), transform: `translate(${Math.round(p.x + ox - w / 2)}px, ${Math.round(p.y + oy - h / 2)}px)` };
    const a11y = isMap ? { role: 'treeitem' as const, 'aria-level': n.depth + 1, tabIndex: 0 } : {};
    return <div key={n.id} class={cls} style={style} {...a11y}><NodeText n={n} /></div>;
  });

  const pathEls: JSX.Element[] = [];
  const labelEls: JSX.Element[] = [];
  if (isMap) {
    for (const [id, d] of layout.paths) {
      const depth = byId.get(id)?.depth ?? 1;
      pathEls.push(<path key={id} class={'diag-edge diag-w' + Math.min(2, Math.max(1, 3 - depth))} d={d} transform={`translate(${ox} ${oy})`} />);
    }
  } else {
    for (const e of doc.edges) {
      const a = layout.pos.get(e.from), c = layout.pos.get(e.to);
      if (!a || !c) continue;
      const geo = edgeGeo(e, a, byId.get(e.from)?.shape, c, byId.get(e.to)?.shape);
      pathEls.push(<EdgeG key={e.id} e={e} geo={geo} ox={ox} oy={oy} />);
      if (e.label) {
        labelEls.push(<span key={e.id} class="diag-label" data-user-content
          style={{ transform: `translate(${Math.round(geo.labelAt.x + ox)}px, ${Math.round(geo.labelAt.y + oy)}px) translate(-50%, -50%)` }}>{inline(e.label)}</span>);
      }
    }
  }

  return (
    <div class="diag-host-view">
      <div class={'diag-canvas glass' + backdropClass(backdrop ?? m.backdrop)} role={isMap ? 'tree' : 'img'} aria-label={label}>
        <div class="diag-stage" style={{ width: `${W}px`, height: `${H}px` }} aria-hidden={isMap ? undefined : 'true'}>
          <svg class="diag-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
            {pathEls}
          </svg>
          {nodeEls}
          {labelEls}
        </div>
      </div>
      {!isMap && (
        <ul class="diag-alt" role="list" aria-label={t('diag.lista')}>
          {doc.edges.length
            ? doc.edges.map((e) => (
              <li key={e.id}>{plain(byId.get(e.from)?.text ?? '')}{e.arrow === 'none' ? ' — ' : e.arrow === 'both' ? ' ↔ ' : ' → '}{plain(byId.get(e.to)?.text ?? '')}{e.label ? ` (${plain(e.label)})` : ''}</li>))
            : doc.nodes.map((n) => <li key={n.id}>{plain(n.text)}</li>)}
        </ul>
      )}
    </div>
  );
}
