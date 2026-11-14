// Editor de diagramas (mapa, flujo, diagrama): lienzo + barra flotante + deshacer exacto + modo texto.
// El documento es el texto de la nota: cada acción es una `Edit` que se aplica al texto y se escribe con
// `onText` (NoteStore, en el padre). Aquí no hay estado del documento, solo selección, diálogos e historial.
import type { JSX } from 'preact';
import type { ComponentType } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { Download, FileText, LayoutGrid, ListPlus, Eye, Redo2, Undo2 } from 'lucide-preact';
import { DiagramCanvas, type DiagramSelection } from './canvas';
import { layoutLayered, layoutTree } from './layout';
import { parseDiagram } from './parse';
import { History } from './history';
import { AskDialog, FloatBar, tx, type Ask } from './toolbar';
import type { DiagramDoc, DiagramKind, DiagramNode, Edit, Route, Shape } from './types';

export interface EditorProps {
  kind: DiagramKind;
  src: string;
  /** Escribe el cuerpo nuevo (la nota decide cómo: NoteStore). `type` = tecleo, `action` = una acción con deshacer propio. */
  onText: (body: string, kind?: 'type' | 'action') => void;
}

const CLOSE: Record<Shape, string> = { rect: ']', round: ')', diamond: '}', io: ']', note: '>' };
const OPEN: Record<Shape, string> = { rect: '[', round: '(', diamond: '{', io: '[/', note: '<<' };
const CLOSE2: Record<Shape, string> = { rect: ']', round: ')', diamond: '}', io: '/]', note: '>>' };

/** «+ Nodo» sin selección en un flujo: línea suelta al final (antes de la línea vacía final). */
function looseNode(doc: DiagramDoc, shape: Shape, text: string): Edit {
  const n = doc.lines.length;
  const at = n > 1 && doc.lines[n - 1]!.raw === '' ? n - 1 : n;
  const body = text.replace(/\s*[\r\n]+\s*/g, ' ').trim().replace(/\\/g, '\\\\').split(CLOSE[shape]).join('\\' + CLOSE[shape]);
  return { op: 'splice', at, remove: 0, insert: [OPEN[shape] + body + CLOSE2[shape]] };
}

/** «Ordenar»: acomodo automático sin posiciones fijadas, escrito como `move` por nodo. */
export function orderEdits(doc: DiagramDoc): Edit[] {
  const bare: DiagramDoc = { ...doc, nodes: doc.nodes.map((n) => { const c = { ...n }; delete c.x; delete c.y; return c; }) };
  const L = doc.kind === 'mapa' ? layoutTree(bare) : layoutLayered(bare, 'TB');
  const out: Edit[] = [];
  for (const n of doc.nodes) {
    const b = L.pos.get(n.id);
    if (b && !(doc.kind === 'mapa' && n.depth === 0)) out.push({ op: 'move', id: n.id, x: Math.round(b.x), y: Math.round(b.y) });
  }
  return out;
}

const hasKids = (doc: DiagramDoc, n: DiagramNode) =>
  doc.kind === 'mapa' ? doc.nodes.some((k) => k.parent === n.id) : doc.edges.some((e) => e.from === n.id || e.to === n.id);

export function DiagramEditor({ kind, src, onText }: EditorProps): JSX.Element {
  const parsed = useMemo(() => parseDiagram(src, kind), [src, kind]);
  const { doc } = parsed;
  const [asText, setAsText] = useState(false);
  const [sel, setSel] = useState<DiagramSelection>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const hist = useRef(new History());
  const [, bump] = useState(0);
  const cur = useRef(src);
  cur.current = src;
  const [Exp, setExp] = useState<ComponentType<{ doc: DiagramDoc; src: string; onClose: () => void }> | null>(null);
  const isMap = kind === 'mapa';

  const write = (next: string | null) => { if (next !== null && next !== cur.current) { cur.current = next; onText(next, 'action'); } bump((n) => n + 1); };
  const apply = (edits: Edit[]) => write(hist.current.apply(cur.current, kind, edits));
  const undo = () => write(hist.current.undo(cur.current, kind));
  const redo = () => write(hist.current.redo(cur.current, kind));

  const node = sel?.type === 'node' ? doc.nodes.find((n) => n.id === sel.id) : undefined;
  const edge = sel?.type === 'edge' ? doc.edges.find((e) => e.id === sel.id) : undefined;
  const nodeName = (n: DiagramNode) => n.text || n.id;

  const newText = tx('diag.nuevo_nodo', 'Nuevo nodo');
  const addChild = (n: DiagramNode) => setAsk({ t: 'text', title: tx('diag.hijo', 'Añadir hijo (Tab)'), initial: '', shapes: !isMap, ok: (text, shape) => apply([{ op: 'addChild', parent: n.id, text, ...(isMap ? {} : { shape }) }]) });
  const addSibling = (n: DiagramNode) => setAsk({ t: 'text', title: tx('diag.hermano', 'Añadir hermano (Intro)'), initial: '', shapes: !isMap, ok: (text, shape) => apply([{ op: 'addSibling', id: n.id, text, ...(isMap ? {} : { shape }) }]) });
  const rename = (n: DiagramNode) => setAsk({ t: 'text', title: tx('diag.renombrar', 'Renombrar (F2)'), initial: n.text, ok: (text) => apply([{ op: 'rename', id: n.id, text }]) });
  const remove = (n: DiagramNode) => {
    if (isMap && n.depth === 0) return;
    const go = () => apply([{ op: 'remove', id: n.id }]);
    if (hasKids(doc, n)) setAsk({ t: 'confirm', title: tx('diag.eliminar', 'Eliminar (Supr)'), body: tx('diag.confirmar_eliminar', 'Se eliminará «') + nodeName(n) + tx('diag.confirmar_eliminar_fin', '» con sus ramas. Puedes deshacerlo.'), ok: go });
    else go();
  };
  const connect = (n: DiagramNode) => setAsk({ t: 'pick', title: tx('diag.conectar', 'Conectar con…'), options: doc.nodes.filter((k) => k.id !== n.id).map((k) => [k.id, nodeName(k)]), ok: (to) => apply([{ op: 'connect', from: n.id, to }]) });
  const addFree = () => {
    if (node) return addChild(node);
    setAsk({ t: 'text', title: tx('diag.nuevo_nodo', newText), initial: '', shapes: true, ok: (text, shape) => apply([looseNode(doc, shape, text)]) });
  };

  const onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('textarea, input, select')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); return e.shiftKey ? redo() : undo(); }
    if (!node || el.dataset?.id !== node.id) return; // solo con el foco en el nodo seleccionado
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'Tab' && !e.shiftKey && !e.altKey) { stop(); addChild(node); }
    else if (e.key === 'Enter' && !(isMap && node.depth === 0)) { stop(); addSibling(node); }
    else if (e.key === 'F2') { stop(); rename(node); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { stop(); remove(node); }
  };
  const onDbl = (e: MouseEvent) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('.diag-node')?.dataset.id;
    const n = id ? doc.nodes.find((x) => x.id === id) : undefined;
    if (n) rename(n);
  };

  const canUndo = hist.current.canUndo(src), canRedo = hist.current.canRedo(src);
  const textBox = (
    <textarea class="input code" style={{ minHeight: '50dvh', width: '100%' }} value={src} aria-label={tx('diag.texto', 'Texto del diagrama')} data-user-content spellcheck={false}
      onInput={(e) => onText((e.target as HTMLTextAreaElement).value, 'type')} />
  );

  if (parsed.tooBig) {
    return (
      <div class="stack-s">
        <p class="diag-warn" role="status">{tx('diag.demasiados_editar', 'Más de 300 nodos: se edita solo como texto.')}</p>
        {textBox}
      </div>
    );
  }

  const focusNode = (id: string) => (e: Event) => {
    const el = (e.currentTarget as HTMLElement).closest('.diag-editor')?.querySelector<HTMLElement>(`.diag-node[data-id="${id}"]`);
    el?.focus();
  };

  return (
    <div class="stack-s diag-editor" onKeyDownCapture={asText ? undefined : onKey} onDblClick={asText ? undefined : onDbl}>
      <div class="row wrap glass" style={{ padding: '6px', borderRadius: '18px' }} role="toolbar" aria-label={tx('diag.herramientas', 'Herramientas del diagrama')}>
        <button type="button" class="btn icon ghost" aria-label={tx('bar.deshacer', 'Deshacer')} disabled={!canUndo || asText} onClick={undo}><Undo2 size={20} aria-hidden="true" /></button>
        <button type="button" class="btn icon ghost" aria-label={tx('bar.rehacer', 'Rehacer')} disabled={!canRedo || asText} onClick={redo}><Redo2 size={20} aria-hidden="true" /></button>
        {!isMap && <button type="button" class="btn icon ghost" aria-label={tx('diag.nuevo_nodo', 'Nuevo nodo')} disabled={asText} onClick={addFree}><ListPlus size={20} aria-hidden="true" /></button>}
        <button type="button" class="btn icon ghost" aria-label={tx('diag.ordenar', 'Ordenar')} disabled={asText || !doc.nodes.length} onClick={() => apply(orderEdits(doc))}><LayoutGrid size={20} aria-hidden="true" /></button>
        <button type="button" class="btn ghost" aria-pressed={asText} onClick={() => setAsText(!asText)}>
          {asText ? <Eye size={20} aria-hidden="true" /> : <FileText size={20} aria-hidden="true" />} {asText ? tx('diag.ver_diagrama', 'Ver diagrama') : tx('diag.ver_texto', 'Ver/editar como texto')}
        </button>
        <button type="button" class="btn ghost" disabled={!doc.nodes.length} onClick={() => void import('./export-ui').then((m) => setExp(() => m.ExportSheet))}>
          <Download size={20} aria-hidden="true" /> {tx('diag.exportar', 'Exportar')}
        </button>
      </div>
      {asText ? textBox : (
        <>
          <DiagramCanvas text={src} kind={kind} onEdit={(e) => apply([e])} onSelect={setSel} />
          <ul class="sr-only" role={isMap ? 'tree' : 'list'} aria-label={tx('diag.lista', 'Lista alternativa del diagrama')}>
            {doc.nodes.map((n) => isMap ? (
              <li key={n.id} role="treeitem" tabIndex={-1} aria-level={n.depth + 1} aria-selected={sel?.type === 'node' && sel.id === n.id}
                aria-expanded={hasKids(doc, n) ? !n.folded : undefined} onClick={focusNode(n.id)} data-user-content>{n.text}</li>
            ) : <li key={n.id} data-user-content>{n.text}</li>)}
            {!isMap && doc.edges.map((e) => <li key={e.id} data-user-content>{nodeName(doc.nodes.find((n) => n.id === e.from)!)} → {e.label ? e.label + ' → ' : ''}{nodeName(doc.nodes.find((n) => n.id === e.to)!)}</li>)}
          </ul>
          {node && <FloatBar node={{
            child: () => addChild(node), sibling: isMap && node.depth === 0 ? null : () => addSibling(node), rename: () => rename(node),
            remove: isMap && node.depth === 0 ? null : () => remove(node), folded: !!node.folded,
            fold: isMap && hasKids(doc, node) ? () => apply([{ op: 'fold', id: node.id, folded: !node.folded }]) : null,
            connect: isMap ? null : () => connect(node),
          }} />}
          {edge && <FloatBar edge={{
            edge, route: (r: Route) => apply([{ op: 'style', id: edge.id, route: r }]),
            label: () => setAsk({ t: 'text', title: tx('diag.etiqueta', 'Etiqueta de la flecha'), initial: edge.label ?? '', empty: true, ok: (label) => apply([{ op: 'label', id: edge.id, label }]) }),
            disconnect: () => { apply([{ op: 'disconnect', id: edge.id }]); setSel(null); },
          }} />}
        </>
      )}
      {Exp && <Exp doc={doc} src={src} onClose={() => setExp(null)} />}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
