// Barra flotante y diálogos del editor de diagramas. Todo lo flotante va por `overlay.tsx`
// (portal + pila): la barra en un `Portal`, los diálogos en `Sheet`. Solo presentación: las acciones las decide el editor.
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ChevronsUpDown, CornerDownRight, Link2, Pencil, Plus, Tag, Trash2, Unlink } from 'lucide-preact';
import { raw } from '../i18n';
import { Portal } from '../ui/overlay';
import { Sheet } from '../ui/kit';
import type { DiagramEdge, Route, Shape } from './types';

export const tx = (k: string, fb: string) => raw(k) ?? fb;

export const SHAPES: Shape[] = ['rect', 'round', 'diamond', 'io', 'note'];
export const shapeName = (s: Shape) => tx('diag.forma_' + s, { rect: 'Rectángulo', round: 'Redondo', diamond: 'Decisión', io: 'Entrada/salida', note: 'Nota' }[s]);
const ROUTES: Route[] = ['recta', 'curva', 'orto'];
const routeName = (r: Route) => tx('diag.trazo_' + r, { recta: 'Recto', curva: 'Curvo', orto: 'Ortogonal' }[r]);

export interface NodeActions {
  child: () => void; sibling: (() => void) | null; rename: () => void; remove: (() => void) | null;
  fold: (() => void) | null; folded: boolean; connect: (() => void) | null;
}
export interface EdgeActions { edge: DiagramEdge; route: (r: Route) => void; label: () => void; disconnect: () => void }

const bar = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom) + 12px);z-index:var(--z-popover);display:flex;align-items:center;gap:4px;padding:6px;border-radius:18px;max-width:calc(100vw - 16px);overflow-x:auto';

const B = (p: { label: string; on: () => void; icon: JSX.Element; disabled?: boolean; pressed?: boolean }) => (
  <button type="button" class="btn icon ghost" aria-label={p.label} aria-pressed={p.pressed} disabled={p.disabled} onClick={p.on}>{p.icon}</button>
);

/** Barra flotante del elemento seleccionado (nodo o flecha). */
export function FloatBar(p: { node?: NodeActions; edge?: EdgeActions }): JSX.Element {
  const n = p.node, e = p.edge;
  return (
    <Portal>
      <div class="glass strong diag-fbar" role="toolbar" aria-label={tx('diag.barra', 'Edición del diagrama')} style={bar}>
        {n && <>
          <B label={tx('diag.hijo', 'Añadir hijo (Tab)')} on={n.child} icon={<CornerDownRight size={20} aria-hidden="true" />} />
          {n.sibling && <B label={tx('diag.hermano', 'Añadir hermano (Intro)')} on={n.sibling} icon={<Plus size={20} aria-hidden="true" />} />}
          <B label={tx('diag.renombrar', 'Renombrar (F2)')} on={n.rename} icon={<Pencil size={20} aria-hidden="true" />} />
          {n.fold && <B label={n.folded ? tx('diag.desplegar', 'Desplegar') : tx('diag.plegar', 'Plegar')} pressed={n.folded} on={n.fold} icon={<ChevronsUpDown size={20} aria-hidden="true" />} />}
          {n.connect && <B label={tx('diag.conectar', 'Conectar con…')} on={n.connect} icon={<Link2 size={20} aria-hidden="true" />} />}
          {n.remove && <B label={tx('diag.eliminar', 'Eliminar (Supr)')} on={n.remove} icon={<Trash2 size={20} aria-hidden="true" />} />}
        </>}
        {e && <>
          {ROUTES.map((r) => <button type="button" class="btn ghost" aria-pressed={e.edge.route === r} onClick={() => e.route(r)}>{routeName(r)}</button>)}
          <B label={tx('diag.etiqueta', 'Etiqueta de la flecha')} on={e.label} icon={<Tag size={20} aria-hidden="true" />} />
          <B label={tx('diag.desconectar', 'Quitar la flecha')} on={e.disconnect} icon={<Unlink size={20} aria-hidden="true" />} />
        </>}
      </div>
    </Portal>
  );
}

export type Ask =
  | { t: 'text'; title: string; initial: string; shapes?: boolean; empty?: boolean; ok: (text: string, shape: Shape) => void }
  | { t: 'confirm'; title: string; body: string; ok: () => void }
  | { t: 'pick'; title: string; options: [string, string][]; ok: (id: string) => void };

/** Diálogo (hoja modal) para pedir un texto, confirmar o elegir un nodo. */
export function AskDialog(p: { ask: Ask; onClose: () => void }): JSX.Element {
  const a = p.ask;
  const [v, setV] = useState(a.t === 'text' ? a.initial : a.t === 'pick' ? (a.options[0]?.[0] ?? '') : '');
  const [shape, setShape] = useState<Shape>('rect');
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => { const el = first.current; if (el) { const id = setTimeout(() => { el.focus(); el.select(); }, 60); return () => clearTimeout(id); } }, []);
  const submit = (e: Event) => {
    e.preventDefault();
    if (a.t === 'text') { if (!v.trim() && !a.empty) return; a.ok(v, shape); }
    else if (a.t === 'confirm') a.ok();
    else if (v) a.ok(v);
    p.onClose();
  };
  return (
    <Sheet title={a.title} onClose={p.onClose}>
      <form class="stack-s" onSubmit={submit}>
        {a.t === 'confirm' && <p>{a.body}</p>}
        {a.t === 'text' && <input ref={first} class="input" value={v} aria-label={a.title} data-user-content onInput={(e) => setV((e.target as HTMLInputElement).value)} />}
        {a.t === 'text' && a.shapes && (
          <label class="field">{tx('diag.forma', 'Forma')}
            <select value={shape} onChange={(e) => setShape((e.target as HTMLSelectElement).value as Shape)}>{SHAPES.map((s) => <option value={s}>{shapeName(s)}</option>)}</select>
          </label>
        )}
        {a.t === 'pick' && (
          <select aria-label={a.title} value={v} data-user-content onChange={(e) => setV((e.target as HTMLSelectElement).value)}>{a.options.map(([id, l]) => <option value={id}>{l}</option>)}</select>
        )}
        <div class="row">
          <button type="button" class="btn" onClick={p.onClose}>{tx('diag.cancelar', 'Cancelar')}</button>
          <button type="submit" class="btn primary">{tx('diag.aceptar', 'Aceptar')}</button>
        </div>
      </form>
    </Sheet>
  );
}
