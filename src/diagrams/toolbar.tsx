// Barra flotante y diálogos del editor de diagramas. Todo lo flotante va por `overlay.tsx`
// (portal + pila): la barra en un `Portal`, los diálogos en `Sheet`. Solo presentación: las acciones las decide el editor.
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Ban, ChevronsUpDown, CornerDownRight, GitBranch, Link2, Pencil, Plus, Ruler, Tag, Trash2, Unlink } from 'lucide-preact';
import { raw, t } from '../i18n';
import { Portal } from '../ui/overlay';
import { Sheet } from '../ui/kit';
import { SIZE_PRESETS, clampSize, type Size } from './handles';
import { blockPageZoom, fbarPlace } from './gestures';
import type { Backdrop, Color, DiagramEdge, DiagramNode, Edit, EdgeAttrs, EdgeEnd, FontSize, Route, Shape } from './types';

export const tx = (k: string, fb: string) => raw(k) ?? fb;

export const SHAPES: Shape[] = ['rect', 'round', 'diamond', 'io', 'note'];
export const shapeName = (s: Shape) => tx('diag.forma_' + s, { rect: 'Rectángulo', round: 'Redondo', diamond: 'Decisión', io: 'Entrada/salida', note: 'Nota' }[s]);
const ROUTES: Route[] = ['recta', 'curva', 'orto'];
const routeName = (r: Route) => tx('diag.trazo_' + r, { recta: 'Recto', curva: 'Curvo', orto: 'Ortogonal' }[r]);

export interface NodeActions {
  child: () => void; sibling: (() => void) | null; rename: () => void; remove: (() => void) | null;
  fold: (() => void) | null; folded: boolean; connect: (() => void) | null;
}
export interface EdgeActions {
  edge: DiagramEdge; route: (r: Route) => void; label: () => void; disconnect: () => void;
  /** Estilo (P22 §2.3): `all` = aplicar a todas las flechas del diagrama; `set` con `undefined` quita la clave. */
  style?: { all: boolean; setAll: (v: boolean) => void; set: (patch: { [K in keyof EdgeAttrs]?: EdgeAttrs[K] | undefined }) => void };
}
/** Estilo del nodo seleccionado (color, tamaño, letra). Cada método = UNA edición (un paso de historial). */
export interface NodeStyle {
  node: DiagramNode; min: Size; cur: Size; branch: boolean;
  setColor: (c: Color | undefined) => void; applyBranch: () => void;
  preset: (p: 's' | 'm' | 'l' | 'auto') => void; setSize: (w: number | undefined, h: number | undefined) => void;
  setFs: (f: FontSize) => void; setMaxw: (n: number | undefined) => void;
}

// --- Ediciones puras del estilo (las prueban tests/diagrams-p22-estilo*) ---
export const COLORS: Color[] = [1, 2, 3, 4, 5, 6, 7, 8];
const COLOR_KEYS = () => [t('diag.color_rojo'), t('diag.color_naranja'), t('diag.color_amarillo'), t('diag.color_verde'), t('diag.color_verde_azulado'), t('diag.color_azul'), t('diag.color_morado'), t('diag.color_rosa')];
export const colorName = (c: Color) => COLOR_KEYS()[c - 1]!;
/** Color 1–8, o quitar la clave (`undefined`). Varios ids = un solo paso. */
export const colorEdit = (ids: string[], c: Color | undefined): Edit => (c ? { op: 'attrs', ids, set: { color: c } } : { op: 'attrs', ids, unset: ['color'] });
/** S/M/L fijan un tamaño (nunca menor al mínimo medido); Automático borra `w`/`h`. */
export function presetEdit(id: string, p: 's' | 'm' | 'l' | 'auto', min: Size): Edit {
  if (p === 'auto') return { op: 'attrs', ids: [id], unset: ['w', 'h'] };
  const s = clampSize(SIZE_PRESETS[p].w, SIZE_PRESETS[p].h, min);
  return { op: 'attrs', ids: [id], set: { w: s.w, h: s.h } };
}
/** Ancho/alto tecleados: se suben al mínimo medido; vacío = quitar la clave. */
export function sizeFieldEdit(id: string, w: number | undefined, h: number | undefined, min: Size): Edit | null {
  const set: { w?: number; h?: number } = {}, unset: ('w' | 'h')[] = [];
  const s = clampSize(w ?? min.w, h ?? min.h, min);
  if (w === undefined) unset.push('w'); else set.w = s.w;
  if (h === undefined) unset.push('h'); else set.h = s.h;
  return Object.keys(set).length || unset.length ? { op: 'attrs', ids: [id], ...(Object.keys(set).length ? { set } : {}), ...(unset.length ? { unset } : {}) } : null;
}
export const fsEdit = (id: string, f: FontSize): Edit => (f === 'm' ? { op: 'attrs', ids: [id], unset: ['fs'] } : { op: 'attrs', ids: [id], set: { fs: f } });
export const maxwEdit = (id: string, n: number | undefined): Edit =>
  n === undefined || !Number.isFinite(n) ? { op: 'attrs', ids: [id], unset: ['maxw'] } : { op: 'attrs', ids: [id], set: { maxw: Math.min(600, Math.max(80, Math.round(n))) } };
/** Estilo de flecha: cada clave con valor se pone; con `undefined` se quita. */
export function edgeStyleEdit(ids: string[], patch: { [K in keyof EdgeAttrs]?: EdgeAttrs[K] | undefined }): Edit {
  const set: Record<string, unknown> = {}, unset: string[] = [];
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) unset.push(k); else set[k] = v; }
  return { op: 'edgeAttrs', ids, ...(Object.keys(set).length ? { set } : {}), ...(unset.length ? { unset } : {}) } as Edit;
}
export const BACKDROP_LIST: Backdrop[] = ['cristal', 'claro', 'gris', 'oscuro', 'cuadricula', 'puntos'];
export const backdropName = (b: Backdrop) => ({ cristal: t('diag.fondo_cristal'), claro: t('diag.fondo_claro'), gris: t('diag.fondo_gris'), oscuro: t('diag.fondo_oscuro'), cuadricula: t('diag.fondo_cuadricula'), puntos: t('diag.fondo_puntos') })[b];
const endName = (f: EdgeEnd) => ({ sin: t('diag.extremo_sin'), flecha: t('diag.extremo_flecha'), ambos: t('diag.extremo_ambos'), circulo: t('diag.extremo_circulo'), rombo: t('diag.extremo_rombo') })[f];
const ENDS: EdgeEnd[] = ['sin', 'flecha', 'ambos', 'circulo', 'rombo'];

const bar = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom) + var(--kb-inset,0px) + var(--notice-lift,0px) + 12px);z-index:var(--z-popover);display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px;border-radius:18px;max-width:calc(100vw - 16px);max-height:min(70dvh,calc(100dvh - var(--kb-inset,0px) - var(--notice-lift,0px) - 96px));overflow-y:auto';

const B = (p: { label: string; on: () => void; icon: JSX.Element; disabled?: boolean; pressed?: boolean }) => (
  <button type="button" class="btn icon ghost" aria-label={p.label} aria-pressed={p.pressed} disabled={p.disabled} onClick={p.on}>{p.icon}</button>
);

/** Muestras: «sin color» + 8 tonos; el círculo visible es chico, la zona táctil de 44 px (`.diag-sw`). El único color de la barra. */
export function Swatches(p: { value?: Color; label: string; onPick: (c: Color | undefined) => void }): JSX.Element {
  return (
    <div class="diag-frow" role="group" aria-label={p.label}>
      <button type="button" class="diag-sw diag-sw-none" aria-label={t('diag.sin_color')} aria-pressed={!p.value} onClick={() => p.onPick(undefined)}><span><Ban size={14} aria-hidden="true" /></span></button>
      {COLORS.map((c) => (
        <button type="button" key={c} class="diag-sw" data-c={c} aria-label={colorName(c)} aria-pressed={p.value === c} onClick={() => p.onPick(c)}>
          <span style={{ background: `var(--diag-c${c})` }} />
        </button>
      ))}
    </div>
  );
}

const SZ: ['s' | 'm' | 'l', string][] = [['s', 'diag.tam_pequeno'], ['m', 'diag.tam_mediano'], ['l', 'diag.tam_grande']];
const FS: [FontSize, string, string][] = [['s', 'S', 'diag.tam_pequeno'], ['m', 'M', 'diag.tam_mediano'], ['l', 'L', 'diag.tam_grande']];
const num = (el: EventTarget | null) => { const v = (el as HTMLInputElement).value.trim(); return v === '' ? undefined : Number(v); };
/** Campo numérico: se confirma al salir (blur) o con Intro, no a cada tecla (Preact en modo compat manda `onChange` por tecla). */
const commit = (go: (v: number | undefined) => void) => ({
  onBlur: (e: Event) => { const el = e.target as HTMLInputElement; if (el.value !== el.defaultValue) go(num(el)); },
  onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const el = e.target as HTMLInputElement; if (el.value !== el.defaultValue) go(num(el)); } },
});

function SizePanel({ st }: { st: NodeStyle }): JSX.Element {
  const n = st.node;
  return (
    <div class="diag-fpanel" role="group" aria-label={t('diag.tamano_cuadro')}>
      <div class="diag-frow">
        {SZ.map(([p, k]) => <button type="button" class="btn ghost" onClick={() => st.preset(p)}>{t(k)}</button>)}
        <button type="button" class="btn ghost" aria-pressed={n.w === undefined && n.h === undefined} onClick={() => st.preset('auto')}>{t('diag.tam_automatico')}</button>
      </div>
      <div class="diag-frow">
        <label class="diag-num">{t('diag.ancho')}
          <input type="number" class="input" inputMode="numeric" key={'w' + (n.w ?? 'a') + st.cur.w} defaultValue={String(n.w ?? st.cur.w)} min={st.min.w}
            {...commit((v) => st.setSize(v, n.h))} /></label>
        <label class="diag-num">{t('diag.alto')}
          <input type="number" class="input" inputMode="numeric" key={'h' + (n.h ?? 'a') + st.cur.h} defaultValue={String(n.h ?? st.cur.h)} min={st.min.h}
            {...commit((v) => st.setSize(n.w, v))} /></label>
        <label class="diag-num">{t('diag.ancho_maximo')}
          <input type="number" class="input" inputMode="numeric" key={'m' + (n.maxw ?? 'a')} defaultValue={String(n.maxw ?? 220)} min={80} max={600}
            {...commit(st.setMaxw)} /></label>
      </div>
      <div class="diag-frow" role="group" aria-label={t('diag.tamano_letra')}>
        {FS.map(([f, l, k]) => <button type="button" class="btn ghost" aria-label={`${t('diag.tamano_letra')}: ${t(k)}`} aria-pressed={(n.fs ?? 'm') === f} onClick={() => st.setFs(f)}>{l}</button>)}
      </div>
    </div>
  );
}

const WIDTHS = [1, 2, 3, 4];

/** Barra flotante del elemento seleccionado (nodo o flecha). */
export function FloatBar(p: { node?: NodeActions; style?: NodeStyle; edge?: EdgeActions }): JSX.Element {
  const n = p.node, e = p.edge, st = p.style;
  const [size, setSize] = useState(false);
  const es = e?.style;
  const box = useRef<HTMLDivElement>(null);
  // Zoom de la PÁGINA (pellizco fuera del lienzo): la barra se recoloca en la ventana visual, del mismo tamaño en pantalla.
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const el = box.current;
    if (!el) return;
    const unblock = blockPageZoom(el);
    if (!vv) return unblock;
    let raf = 0;
    const place = () => {
      raf = 0;
      const p = fbarPlace(vv);
      const s = el.style;
      if (!p) { if (s.cssText !== bar) s.cssText = bar; return; }
      s.left = p.left + 'px'; s.top = p.top + 'px'; s.bottom = 'auto'; s.transformOrigin = '50% 100%';
      s.transform = `translate(-50%, -100%) scale(${p.scale})`;
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(place); };
    vv.addEventListener('resize', on); vv.addEventListener('scroll', on);
    place();
    return () => { vv.removeEventListener('resize', on); vv.removeEventListener('scroll', on); if (raf) cancelAnimationFrame(raf); unblock(); };
  }, []);
  return (
    <Portal>
      <div ref={box} class="glass strong diag-fbar" role="toolbar" aria-label={tx('diag.barra', 'Edición del diagrama')} style={bar}>
        <div class="diag-frow">
          {n && <>
            <B label={tx('diag.hijo', 'Añadir hijo (Tab)')} on={n.child} icon={<CornerDownRight size={20} aria-hidden="true" />} />
            {n.sibling && <B label={tx('diag.hermano', 'Añadir hermano (Intro)')} on={n.sibling} icon={<Plus size={20} aria-hidden="true" />} />}
            <B label={tx('diag.renombrar', 'Renombrar (F2)')} on={n.rename} icon={<Pencil size={20} aria-hidden="true" />} />
            {n.fold && <B label={n.folded ? tx('diag.desplegar', 'Desplegar') : tx('diag.plegar', 'Plegar')} pressed={n.folded} on={n.fold} icon={<ChevronsUpDown size={20} aria-hidden="true" />} />}
            {n.connect && <B label={tx('diag.conectar', 'Conectar con…')} on={n.connect} icon={<Link2 size={20} aria-hidden="true" />} />}
            {st && <B label={t('diag.tamano_cuadro')} pressed={size} on={() => setSize(!size)} icon={<Ruler size={20} aria-hidden="true" />} />}
            {n.remove && <B label={tx('diag.eliminar', 'Eliminar (Supr)')} on={n.remove} icon={<Trash2 size={20} aria-hidden="true" />} />}
          </>}
          {e && <>
            {ROUTES.map((r) => <button type="button" class="btn ghost" aria-pressed={e.edge.route === r} onClick={() => e.route(r)}>{routeName(r)}</button>)}
            <B label={tx('diag.etiqueta', 'Etiqueta de la flecha')} on={e.label} icon={<Tag size={20} aria-hidden="true" />} />
            <B label={tx('diag.desconectar', 'Quitar la flecha')} on={e.disconnect} icon={<Unlink size={20} aria-hidden="true" />} />
          </>}
        </div>
        {st && <div class="diag-frow">
          <Swatches value={st.node.color} label={t('diag.color')} onPick={st.setColor} />
          {st.branch && <B label={t('diag.aplicar_rama')} on={st.applyBranch} icon={<GitBranch size={20} aria-hidden="true" />} />}
        </div>}
        {st && size && <SizePanel st={st} />}
        {e && es && <div class="diag-fpanel" role="group" aria-label={t('diag.flecha_estilo')}>
          <Swatches value={e.edge.color} label={t('diag.color')} onPick={(c) => es.set({ color: c })} />
          <div class="diag-frow" role="group" aria-label={t('diag.grosor')}>
            {WIDTHS.map((w) => <button type="button" class="btn ghost" aria-label={`${t('diag.grosor')} ${w}`} aria-pressed={(e.edge.w ?? 2) === w} onClick={() => es.set({ w: w === 2 ? undefined : w })}>{w}</button>)}
            <button type="button" class="btn ghost" aria-pressed={!!e.edge.dash} onClick={() => es.set({ dash: e.edge.dash ? undefined : true })}>{t('diag.punteado')}</button>
          </div>
          <div class="diag-frow" role="group" aria-label={t('diag.extremos')}>
            {ENDS.map((f) => <button type="button" class="btn ghost" aria-pressed={curEnd(e.edge) === f} onClick={() => es.set({ fin: f })}>{endName(f)}</button>)}
          </div>
          <label class="diag-frow diag-all"><input type="checkbox" checked={es.all} onChange={(ev) => es.setAll((ev.target as HTMLInputElement).checked)} /> {t('diag.todas_flechas')}</label>
        </div>}
      </div>
    </Portal>
  );
}

const curEnd = (e: DiagramEdge): EdgeEnd => e.fin ?? (e.arrow === 'none' ? 'sin' : e.arrow === 'both' ? 'ambos' : 'flecha');

/** Fondo del lienzo (sin selección): selector en la barra del editor. */
export function BackdropPicker(p: { value: Backdrop; onPick: (b: Backdrop) => void }): JSX.Element {
  return (
    <label class="diag-bd-pick">
      <span class="sr-only">{t('diag.fondo')}</span>
      <select class="input" aria-label={t('diag.fondo')} value={p.value} onChange={(e) => p.onPick((e.target as HTMLSelectElement).value as Backdrop)}>
        {BACKDROP_LIST.map((b) => <option value={b}>{backdropName(b)}</option>)}
      </select>
    </label>
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
