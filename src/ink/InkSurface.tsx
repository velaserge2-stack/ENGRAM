import { useMemo, useRef, useState } from 'preact/hooks';
import { useApp } from '../state';
import { defaultTools, InkLayer, InkToolbar, type InkTools } from './InkLayer';
import { History, type InkDoc } from './model';

/** Herramientas compartidas en la sesión (la misma pluma en PDF y notas). */
let lastTools: InkTools | null = null;
export function useInkTools(): [InkTools, (t: InkTools) => void] {
  const [tools, setTools] = useState<InkTools>(() => lastTools ?? defaultTools());
  return [tools, (t) => ((lastTools = t), setTools(t))];
}

/**
 * Superficie de tinta lista para usar: documento, deshacer/rehacer de la sesión, barra de
 * herramientas y capa. `onChange` recibe cada versión (el que la usa decide cómo guardar).
 */
export function InkSurface(p: { doc: InkDoc; onChange: (d: InkDoc) => void; width: number; height: number; label: string; toolbar?: boolean; extra?: preact.ComponentChildren }) {
  const app = useApp();
  const [tools, setTools] = useInkTools();
  const hist = useMemo(() => new History(p.doc), []);
  const [, force] = useState(0);
  const docRef = useRef(p.doc);
  docRef.current = p.doc;
  const change = (d: InkDoc) => (p.onChange(d), force((n) => n + 1));
  return (
    <>
      {p.toolbar !== false && <InkToolbar tools={tools} set={setTools} canUndo={hist.canUndo} canRedo={hist.canRedo} onUndo={() => change(hist.undo())} onRedo={() => change(hist.redo())} extra={p.extra} />}
      <div class="ink-host" style={{ position: 'relative', width: `${p.width}px`, height: `${p.height}px` }}>
        <InkLayer doc={p.doc} onChange={change} history={hist} width={p.width} height={p.height} active tools={tools} finger={app.settings.inkFinger} label={p.label} />
      </div>
    </>
  );
}
