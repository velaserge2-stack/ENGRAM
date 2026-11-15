// Editor de diagramas (mapa, flujo, diagrama): lienzo + barra flotante + deshacer exacto + modo texto.
// El documento es el texto de la nota: cada acción es una `Edit` que se aplica al texto y se escribe con
// `onText` (NoteStore, en el padre). Aquí no hay estado del documento, solo selección, diálogos e historial.
// Crear, renombrar y etiquetar se hacen en el sitio dentro del lienzo (§P22.6), sin cuadro modal: la barra solo
// se lo pide al lienzo (`CanvasControl`). Quedan como hoja la confirmación de eliminar y «Conectar con…».
import type { JSX } from 'preact';
import type { ComponentType } from 'preact';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Download, FileText, LayoutGrid, ListPlus, Eye, Redo2, Undo2 } from 'lucide-preact';
import { DiagramCanvas, type CanvasControl, type DiagramSelection } from './canvas';
import { layoutLayered, layoutTree } from './layout';
import { parseDiagram, readBackdrop } from './parse';
import { History } from './history';
import { fillHeight } from './gestures';
import { AskDialog, BackdropPicker, FloatBar, colorEdit, edgeStyleEdit, fsEdit, maxwEdit, presetEdit, sizeFieldEdit, tx, type Ask } from './toolbar';
import { keyResize, nodeMin, sizeEdit } from './handles';
import { measureDoc } from './measure';
import type { Backdrop, DiagramDoc, DiagramKind, DiagramNode, Edit, Route } from './types';

export interface EditorProps {
  kind: DiagramKind;
  src: string;
  /** Escribe el cuerpo nuevo (la nota decide cómo: NoteStore). `type` = tecleo, `action` = una acción con deshacer propio. */
  onText: (body: string, kind?: 'type' | 'action') => void;
  /** Nota de diagrama completa: el lienzo ocupa el alto que queda de la ventana (se mide del DOM). */
  fill?: boolean;
  /** Bloque o embed: alto fijo del lienzo (px). */
  height?: number;
  /** Fondo resuelto por quien guarda (frontmatter `fondo:` de una nota de diagrama). Con `onBackdrop` el selector lo escribe allí en vez de en el bloque (`# fondo:`). */
  backdrop?: Backdrop;
  onBackdrop?: (b: Backdrop) => void;
  /** Título de la nota (encabezado por defecto del PDF). */
  title?: string;
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

export function DiagramEditor({ kind, src, onText, fill, height, backdrop, onBackdrop, title }: EditorProps): JSX.Element {
  const parsed = useMemo(() => parseDiagram(src, kind), [src, kind]);
  const { doc } = parsed;
  const [asText, setAsText] = useState(false);
  const [sel, setSel] = useState<DiagramSelection>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const hist = useRef(new History());
  const [, bump] = useState(0);
  const cur = useRef(src);
  cur.current = src;
  const [Exp, setExp] = useState<ComponentType<{ doc: DiagramDoc; src: string; onClose: () => void; title?: string; backdrop?: Backdrop }> | null>(null);
  const isMap = kind === 'mapa';
  const root = useRef<HTMLDivElement>(null);
  const ctl = useRef<CanvasControl | null>(null);
  // alto del lienzo en nota completa: ventana − borde superior del tablero; sin re-render (variable CSS)
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    if (!fill) { if (height) el.style.setProperty('--diag-h', height + 'px'); else el.style.removeProperty('--diag-h'); return; }
    const measure = () => {
      // alto útil = ventana − barra superior fija − barra de herramientas del editor (el tablero se alcanza desplazando la nota)
      const bar = document.querySelector<HTMLElement>('.topbar')?.getBoundingClientRect().bottom ?? 72;
      const tools = el.querySelector<HTMLElement>('[role="toolbar"]')?.offsetHeight ?? 52;
      el.style.setProperty('--diag-h', fillHeight(innerHeight, Math.max(0, bar) + tools + 20, 16) + 'px');
    };
    measure();
    const t = setTimeout(measure, 200); // tras cargar fuentes e imágenes del encabezado
    addEventListener('resize', measure);
    return () => { clearTimeout(t); removeEventListener('resize', measure); };
  }, [fill, height, asText]);

  const write = (next: string | null) => { if (next !== null && next !== cur.current) { cur.current = next; onText(next, 'action'); } bump((n) => n + 1); };
  const apply = (edits: Edit[]) => write(hist.current.apply(cur.current, kind, edits));
  const undo = () => write(hist.current.undo(cur.current, kind));
  const redo = () => write(hist.current.redo(cur.current, kind));

  const node = sel?.type === 'node' ? doc.nodes.find((n) => n.id === sel.id) : undefined;
  const edge = sel?.type === 'edge' ? doc.edges.find((e) => e.id === sel.id) : undefined;
  const [allEdges, setAllEdges] = useState(false);
  const branchOf = (n: DiagramNode) => {
    const ids = [n.id];
    for (const k of doc.nodes) if (k.parent && ids.includes(k.parent) && !ids.includes(k.id)) ids.push(k.id);
    return ids;
  };
  const nodeName = (n: DiagramNode) => n.text || n.id;

  // En el sitio (sin modal): el nodo nuevo aparece ya colocado, en edición, y entra al archivo al confirmar.
  const addChild = (n: DiagramNode) => ctl.current?.addChild(n.id);
  const addSibling = (n: DiagramNode) => ctl.current?.addSibling(n.id);
  const rename = (n: DiagramNode) => ctl.current?.edit(n.id);
  const remove = (n: DiagramNode) => {
    if (isMap && n.depth === 0) return;
    const go = () => apply([{ op: 'remove', id: n.id }]);
    if (hasKids(doc, n)) setAsk({ t: 'confirm', title: tx('diag.eliminar', 'Eliminar (Supr)'), body: tx('diag.confirmar_eliminar', 'Se eliminará «') + nodeName(n) + tx('diag.confirmar_eliminar_fin', '» con sus ramas. Puedes deshacerlo.'), ok: go });
    else go();
  };
  const connect = (n: DiagramNode) => setAsk({ t: 'pick', title: tx('diag.conectar', 'Conectar con…'), options: doc.nodes.filter((k) => k.id !== n.id).map((k) => [k.id, nodeName(k)]), ok: (to) => apply([{ op: 'connect', from: n.id, to }]) });
  const addFree = () => (node ? addChild(node) : ctl.current?.addFree());

  const onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.closest('textarea, input, select')) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); return e.shiftKey ? redo() : undo(); }
    if (!node || el.dataset?.id !== node.id) return; // solo con el foco en el nodo seleccionado
    if (e.altKey && e.key.startsWith('Arrow')) { // ⌥+flechas: tamaño del cuadro (8 px), no mover
      const cur = measureDoc(doc).get(node.id), r = cur && keyResize(cur, nodeMin(node, kind), e.key);
      e.preventDefault(); e.stopPropagation();
      if (r) apply([sizeEdit(node.id, e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? { w: r.w } : { h: r.h })]);
      return;
    }
    // Tab (hijo), Intro (editar / hermano al encadenar) y F2 (editar) los atiende el lienzo, en el sitio.
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); remove(node); }
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
    <div ref={root} class={`stack-s diag-editor${fill ? ' diag-fill' : height ? ' diag-sized' : ''}`} onKeyDownCapture={asText ? undefined : onKey}>
      <div class="row wrap glass" style={{ padding: '6px', borderRadius: '18px' }} role="toolbar" aria-label={tx('diag.herramientas', 'Herramientas del diagrama')}>
        <button type="button" class="btn icon ghost" aria-label={tx('bar.deshacer', 'Deshacer')} disabled={!canUndo || asText} onClick={undo}><Undo2 size={20} aria-hidden="true" /></button>
        <button type="button" class="btn icon ghost" aria-label={tx('bar.rehacer', 'Rehacer')} disabled={!canRedo || asText} onClick={redo}><Redo2 size={20} aria-hidden="true" /></button>
        {!isMap && <button type="button" class="btn icon ghost" aria-label={tx('diag.nuevo_nodo', 'Nuevo nodo')} disabled={asText} onClick={addFree}><ListPlus size={20} aria-hidden="true" /></button>}
        <button type="button" class="btn icon ghost" aria-label={tx('diag.ordenar', 'Ordenar')} disabled={asText || !doc.nodes.length} onClick={() => apply(orderEdits(doc))}><LayoutGrid size={20} aria-hidden="true" /></button>
        {!asText && <BackdropPicker value={backdrop ?? readBackdrop(src)} onPick={(b) => (onBackdrop ? onBackdrop(b) : apply([{ op: 'backdrop', value: b === 'cristal' ? undefined : b }]))} />}
        <button type="button" class="btn ghost" aria-pressed={asText} onClick={() => setAsText(!asText)}>
          {asText ? <Eye size={20} aria-hidden="true" /> : <FileText size={20} aria-hidden="true" />} {asText ? tx('diag.ver_diagrama', 'Ver diagrama') : tx('diag.ver_texto', 'Ver/editar como texto')}
        </button>
        <button type="button" class="btn ghost" disabled={!doc.nodes.length} onClick={() => void import('./export-ui').then((m) => setExp(() => m.ExportSheet))}>
          <Download size={20} aria-hidden="true" /> {tx('diag.exportar', 'Exportar')}
        </button>
      </div>
      {asText ? textBox : (
        <>
          <DiagramCanvas text={src} kind={kind} onEdit={(e) => apply([e])} onEdits={apply} onSelect={setSel} control={ctl} {...(backdrop ? { backdrop } : {})} />
          <ul class="sr-only" role={isMap ? 'tree' : 'list'} aria-label={tx('diag.lista', 'Lista alternativa del diagrama')}>
            {doc.nodes.map((n) => isMap ? (
              <li key={n.id} role="treeitem" tabIndex={-1} aria-level={n.depth + 1} aria-selected={sel?.type === 'node' && sel.id === n.id}
                aria-expanded={hasKids(doc, n) ? !n.folded : undefined} onClick={focusNode(n.id)} data-user-content>{n.text}</li>
            ) : <li key={n.id} data-user-content>{n.text}</li>)}
            {!isMap && doc.edges.map((e) => <li key={e.id} data-user-content>{nodeName(doc.nodes.find((n) => n.id === e.from)!)} → {e.label ? e.label + ' → ' : ''}{nodeName(doc.nodes.find((n) => n.id === e.to)!)}</li>)}
          </ul>
          {node && <FloatBar style={{
            node, min: nodeMin(node, kind), cur: measureDoc(doc).get(node.id) ?? nodeMin(node, kind), branch: isMap && hasKids(doc, node),
            setColor: (c) => apply([colorEdit([node.id], c)]), applyBranch: () => apply([colorEdit(branchOf(node), node.color)]),
            preset: (pr) => apply([presetEdit(node.id, pr, nodeMin(node, kind))]),
            setSize: (w, h) => { const ed = sizeFieldEdit(node.id, w, h, nodeMin(node, kind)); if (ed) apply([ed]); },
            setFs: (f) => apply([fsEdit(node.id, f)]), setMaxw: (v) => apply([maxwEdit(node.id, v)]),
          }} node={{
            child: () => addChild(node), sibling: isMap && node.depth === 0 ? null : () => addSibling(node), rename: () => rename(node),
            remove: isMap && node.depth === 0 ? null : () => remove(node), folded: !!node.folded,
            fold: isMap && hasKids(doc, node) ? () => apply([{ op: 'fold', id: node.id, folded: !node.folded }]) : null,
            connect: isMap ? null : () => connect(node),
          }} />}
          {edge && <FloatBar edge={{
            edge, route: (r: Route) => apply([{ op: 'style', id: edge.id, route: r }]),
            label: () => ctl.current?.editLabel(edge.id),
            style: { all: allEdges, setAll: setAllEdges, set: (patch) => apply([edgeStyleEdit(allEdges ? doc.edges.map((x) => x.id) : [edge.id], patch)]) },
            disconnect: () => { apply([{ op: 'disconnect', id: edge.id }]); setSel(null); },
          }} />}
        </>
      )}
      {Exp && <Exp doc={doc} src={src} onClose={() => setExp(null)} backdrop={backdrop ?? readBackdrop(src)} {...(title ? { title } : {})} />}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
