// Vista de solo lectura de un diagrama (CONTRATO §5-6): nodos HTML + un solo <svg> para los conectores.
// El texto del usuario entra siempre como texto de Preact (nunca HTML); `style` solo lleva números generados.
import { useMemo } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { t } from '../i18n';
import { parseDiagram } from './parse';
import { layoutLayered, layoutTree } from './layout';
import type { DiagramDoc, DiagramKind, DiagramNode, Layout } from './types';
import './diagram.css';

export interface DiagramViewProps { text: string; kind: DiagramKind }

const MIN = 44; // objetivo táctil mínimo
const PAD = 24;
const MAX_TEXT = 200;
const NODE_CLASS: Record<DiagramNode['shape'], string> = {
  rect: '', round: ' diag-round', diamond: ' diag-decision', io: ' diag-io', note: ' diag-note',
};

/** `**negrita**`, `*cursiva*` y `[[nota]]` como nodos de Preact; todo lo demás, texto. */
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

interface Model { doc: DiagramDoc; layout: Layout | null; tooBig: boolean }

function build(text: string, kind: DiagramKind): Model {
  const r = parseDiagram(text, kind);
  if (r.tooBig) return { doc: r.doc, layout: null, tooBig: true };
  const layout = kind === 'mapa' ? layoutTree(r.doc) : layoutLayered(r.doc, 'TB');
  return { doc: r.doc, layout, tooBig: false };
}

export function DiagramView({ text, kind }: DiagramViewProps): JSX.Element {
  const m = useMemo(() => build(text, kind), [text, kind]);
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
    const lvl = isMap ? (n.depth <= 0 ? ' diag-root' : n.depth === 1 ? ' diag-l1' : ' diag-l2') : ' diag-l1';
    const cls = 'diag-node' + lvl + NODE_CLASS[n.shape] + (n.folded && hasKids.has(n.id) ? ' diag-folded' : '');
    const style = { width: w, height: h, transform: `translate(${Math.round(p.x + ox - w / 2)}px, ${Math.round(p.y + oy - h / 2)}px)` };
    const a11y = isMap ? { role: 'treeitem' as const, 'aria-level': n.depth + 1, tabIndex: 0 } : {};
    return <div key={n.id} class={cls} style={style} data-user-content {...a11y}><span class="diag-text">{inline(n.text)}</span></div>;
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
      const d = layout.paths.get(e.id);
      if (!d) continue;
      pathEls.push(<path key={e.id} class="diag-edge diag-w2" d={d} transform={`translate(${ox} ${oy})`}
        marker-end={e.arrow !== 'none' ? 'url(#diag-arrow)' : undefined} marker-start={e.arrow === 'both' ? 'url(#diag-arrow)' : undefined} />);
      const a = layout.pos.get(e.from), c = layout.pos.get(e.to);
      if (e.label && a && c) {
        labelEls.push(<span key={e.id} class="diag-label" data-user-content
          style={{ transform: `translate(${Math.round((a.x + c.x) / 2 + ox)}px, ${Math.round((a.y + c.y) / 2 + oy)}px) translate(-50%, -50%)` }}>{inline(e.label)}</span>);
      }
    }
  }

  return (
    <div class="diag-host-view">
      <div class="diag-canvas glass" role={isMap ? 'tree' : 'img'} aria-label={label}>
        <div class="diag-stage" style={{ width: W, height: H }} aria-hidden={isMap ? undefined : 'true'}>
          <svg class="diag-svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
            <defs>
              <marker id="diag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" class="diag-head" />
              </marker>
            </defs>
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
