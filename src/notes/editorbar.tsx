import { t } from '../i18n';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowUp, Bold, ChevronDown, ChevronUp, Code, Combine, Copy, Highlighter, ImagePlus, IndentDecrease,
  IndentIncrease, Italic, Link2, List, ListChecks, ListOrdered, Minus, MoreHorizontal, Palette, Redo2, RemoveFormatting, Strikethrough, Table, Trash2, Type, Underline, Undo2, CalendarDays,
} from 'lucide-preact';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { keysOf, showKey } from '../lib/keys';
import { COLOR_LABEL } from '../lib/palette';
import { keymap } from '../ui/keys';
import { Popover } from '../ui/overlay';
import { ALIGNS, COLORS, SIZES, type Align, type ListKind, type Mark, type Style } from './format';

/** Estado de la barra según el bloque y la selección (lo calcula el editor). */
export interface BarState {
  text: boolean; // hay un bloque en edición (botones de texto)
  block: boolean; // hay un bloque objetivo (botones de bloque)
  marks: Set<Mark>;
  style: Style | null;
  align: Align | null;
  list: ListKind | null;
  table: boolean;
  undo: boolean;
  redo: boolean;
}
export type Action =
  | { k: 'mark'; m: Mark } | { k: 'style'; v: Style } | { k: 'align'; v: Align | null } | { k: 'list'; v: ListKind } | { k: 'indent'; v: 1 | -1 }
  | { k: 'color'; v: string | null } | { k: 'size'; v: string | null } | { k: 'clear' } | { k: 'undo' } | { k: 'redo' }
  | { k: 'table'; cols: number; rows: number } | { k: 'tableOp'; v: 'addRow' | 'delRow' | 'addCol' | 'delCol' | 'fit' | '' | 'l' | 'c' | 'r' }
  | { k: 'link'; v: string } | { k: 'hr' } | { k: 'date' } | { k: 'image'; f: File } | { k: 'move'; v: 1 | -1; section: boolean }
  | { k: 'dup' } | { k: 'del' } | { k: 'merge' } | { k: 'slash'; v: string };

/** Tooltip/aria con el atajo actual (configurable en Ajustes → Atajos). */
const lab = (key: string, id?: string) => { const k = id ? keysOf(keymap.cfg, id)[0] : null; return k ? `${t(key)} (${showKey(k)})` : t(key); };
/** Los botones no roban el foco al bloque que se edita (se conserva el cursor y la selección). */
const keep = { onMouseDown: (e: MouseEvent) => e.preventDefault(), onPointerDown: (e: PointerEvent) => (e.pointerType === 'mouse' || e.pointerType === 'pen' || e.pointerType === 'touch') && (e.target as HTMLElement).tagName !== 'SELECT' && e.preventDefault() };

function B(p: { label: string; on?: boolean; off?: boolean; onClick: (e: MouseEvent) => void; children: ComponentChildren }) {
  return <button type="button" class="btn icon small ghost" aria-label={p.label} aria-pressed={p.on === undefined ? undefined : p.on} disabled={p.off} tabIndex={-1} {...keep} onClick={p.onClick}>{p.children}</button>;
}
const Sep = () => <span class="eb-sep" aria-hidden="true" />;

export function EditorBar(p: { s: BarState; folded: boolean; onFold: (v: boolean) => void; run: (a: Action) => void; slash: [string, string][]; notes: { title: string }[] }) {
  const bar = useRef<HTMLDivElement>(null);
  const [pop, setPop] = useState<{ kind: 'color' | 'size' | 'table' | 'link' | 'more'; el: HTMLElement } | null>(null);
  const img = useRef<HTMLInputElement>(null);
  const { s } = p;
  const open = (kind: NonNullable<typeof pop>['kind']) => (e: Event) => setPop(pop?.kind === kind ? null : { kind, el: e.currentTarget as HTMLElement });

  // con el teclado virtual abierto, la barra sigue a la parte visible (iPad/iPhone)
  useEffect(() => {
    const vv = window.visualViewport;
    const el = bar.current;
    if (!vv || !el) return;
    const on = () => el.style.setProperty('--vv-top', `${Math.max(0, vv.offsetTop)}px`);
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    on();
    return () => (vv.removeEventListener('resize', on), vv.removeEventListener('scroll', on));
  }, []);

  // un solo tab-stop: las flechas recorren los botones habilitados
  const onKey = (e: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || (e.target as HTMLElement).tagName === 'SELECT') return;
    const items = [...bar.current!.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled])')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
    e.preventDefault();
    items.forEach((x, k) => (x.tabIndex = k === j ? 0 : -1));
    items[j]?.focus();
  };
  useEffect(() => {
    // al menos uno enfocable con Tab
    const items = [...(bar.current?.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled])') ?? [])];
    if (items.length && !items.some((x) => x.tabIndex === 0)) items[0]!.tabIndex = 0;
  });

  const mk = (m: Mark, key: string, id: string | undefined, icon: JSX.Element) => <B label={lab(key, id)} on={s.marks.has(m)} off={!s.text} onClick={() => p.run({ k: 'mark', m })}>{icon}</B>;
  const fold = <button type="button" class="btn icon small ghost eb-fold" aria-label={lab(p.folded ? 'bar.desplegar' : 'bar.plegar', 'editor.fold')} aria-expanded={!p.folded} {...keep} onClick={() => p.onFold(!p.folded)}>{p.folded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}</button>;
  const history = <>
    <B label={lab('bar.deshacer', 'editor.undo')} off={!s.undo} onClick={() => p.run({ k: 'undo' })}><Undo2 size={18} /></B>
    <B label={lab('bar.rehacer', 'editor.redo')} off={!s.redo} onClick={() => p.run({ k: 'redo' })}><Redo2 size={18} /></B>
  </>;

  return (
    <div ref={bar} class={`editorbar glass strong${p.folded ? ' folded' : ''}`} role="toolbar" aria-label={t('bar.barra')} onKeyDown={onKey}>
      <div class="eb-scroll">
        {history}
        <Sep />
        {mk('**', 'bar.negrita', 'editor.bold', <Bold size={18} />)}
        {!p.folded && <>
          {mk('*', 'bar.cursiva', 'editor.italic', <Italic size={18} />)}
          {mk('++', 'bar.subrayado', 'editor.underline', <Underline size={18} />)}
          {mk('~~', 'bar.tachado', 'editor.strike', <Strikethrough size={18} />)}
          {mk('`', 'bar.codigo_linea', undefined, <Code size={18} />)}
          {mk('==', 'bar.resaltar', 'editor.highlight', <Highlighter size={18} />)}
          <B label={t('bar.color')} off={!s.text} onClick={open('color')}><Palette size={18} /></B>
          <B label={t('bar.tamano')} off={!s.text} onClick={open('size')}><Type size={18} /></B>
          <B label={t('bar.quitar_formato')} off={!s.text} onClick={() => p.run({ k: 'clear' })}><RemoveFormatting size={18} /></B>
          <Sep />
          <select class="input eb-select" aria-label={t('bar.estilo')} disabled={!s.block} value={s.style ?? 'p'} tabIndex={-1} onChange={(e) => p.run({ k: 'style', v: (e.target as HTMLSelectElement).value as Style })}>
            {(['p', 'h1', 'h2', 'h3', 'quote', 'code', 'callout'] as Style[]).map((v) => <option value={v}>{t(`bar.st_${v}`)}</option>)}
          </select>
          <Sep />
          <B label={t('bar.al_izq')} on={s.block && !s.align} off={!s.block} onClick={() => p.run({ k: 'align', v: null })}><AlignLeft size={18} /></B>
          {ALIGNS.map((a) => <B label={t(`bar.al_${a}`)} on={s.align === a} off={!s.block} onClick={() => p.run({ k: 'align', v: a })}>{a === 'centro' ? <AlignCenter size={18} /> : a === 'der' ? <AlignRight size={18} /> : <AlignJustify size={18} />}</B>)}
          <Sep />
          <B label={t('bar.vinetas')} on={s.list === 'ul'} off={!s.block} onClick={() => p.run({ k: 'list', v: 'ul' })}><List size={18} /></B>
          <B label={t('bar.numerada')} on={s.list === 'ol'} off={!s.block} onClick={() => p.run({ k: 'list', v: 'ol' })}><ListOrdered size={18} /></B>
          <B label={t('bar.tareas')} on={s.list === 'task'} off={!s.block} onClick={() => p.run({ k: 'list', v: 'task' })}><ListChecks size={18} /></B>
          <B label={t('bar.sangria_menos')} off={!s.text} onClick={() => p.run({ k: 'indent', v: -1 })}><IndentDecrease size={18} /></B>
          <B label={t('bar.sangria_mas')} off={!s.text} onClick={() => p.run({ k: 'indent', v: 1 })}><IndentIncrease size={18} /></B>
          <Sep />
          <B label={t('bar.tabla')} onClick={open('table')}><Table size={18} /></B>
          {s.table && <>
            <B label={t('bar.t_fila')} onClick={() => p.run({ k: 'tableOp', v: 'addRow' })}><span class="eb-txt">+F</span></B>
            <B label={t('bar.t_col')} onClick={() => p.run({ k: 'tableOp', v: 'addCol' })}><span class="eb-txt">+C</span></B>
            <B label={t('bar.t_sin_fila')} onClick={() => p.run({ k: 'tableOp', v: 'delRow' })}><span class="eb-txt">−F</span></B>
            <B label={t('bar.t_sin_col')} onClick={() => p.run({ k: 'tableOp', v: 'delCol' })}><span class="eb-txt">−C</span></B>
            {(['l', 'c', 'r'] as const).map((a) => <B label={t(`bar.t_al_${a}`)} onClick={() => p.run({ k: 'tableOp', v: a })}><span class="eb-txt">{a === 'l' ? '⇤' : a === 'c' ? '↔' : '⇥'}</span></B>)}
            <B label={t('bar.t_ajustar')} onClick={() => p.run({ k: 'tableOp', v: 'fit' })}><span class="eb-txt">⇹</span></B>
          </>}
          <B label={t('bar.imagen')} onClick={() => img.current?.click()}><ImagePlus size={18} /></B>
          <B label={lab('bar.enlace', 'editor.link')} off={!s.text} onClick={open('link')}><Link2 size={18} /></B>
          <B label={t('bar.divisoria')} onClick={() => p.run({ k: 'hr' })}><Minus size={18} /></B>
          <B label={t('bar.fecha')} onClick={() => p.run({ k: 'date' })}><CalendarDays size={18} /></B>
          <Sep />
          <B label={lab('bar.subir', 'editor.up')} off={!s.block} onClick={() => p.run({ k: 'move', v: -1, section: false })}><ArrowUp size={18} /></B>
          <B label={lab('bar.bajar', 'editor.down')} off={!s.block} onClick={() => p.run({ k: 'move', v: 1, section: false })}><ArrowDown size={18} /></B>
          <B label={t('bar.duplicar')} off={!s.block} onClick={() => p.run({ k: 'dup' })}><Copy size={18} /></B>
          <B label={t('bar.combinar')} off={!s.block} onClick={() => p.run({ k: 'merge' })}><Combine size={18} /></B>
          <B label={t('bar.eliminar_bloque')} off={!s.block} onClick={() => p.run({ k: 'del' })}><Trash2 size={18} /></B>
        </>}
      </div>
      <div class="eb-end">
        {!p.folded && <B label={t('bar.mas')} onClick={open('more')}><MoreHorizontal size={18} /></B>}
        {fold}
      </div>
      <input ref={img} type="file" accept="image/*" hidden onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) p.run({ k: 'image', f }); (e.target as HTMLInputElement).value = ''; }} />
      {pop && (
        <Popover anchor={pop.el} onClose={() => setPop(null)} label={t(`bar.${pop.kind === 'more' ? 'mas' : pop.kind === 'size' ? 'tamano' : pop.kind === 'table' ? 'tabla' : pop.kind === 'link' ? 'enlace' : 'color'}`)} class="eb-pop">
          {pop.kind === 'color' && <Opts items={[['', t('bar.sin_color')], ...COLORS.map((c) => [c, COLOR_LABEL[c] ?? c] as [string, string])]} pick={(v) => (p.run({ k: 'color', v: v || null }), setPop(null))} />}
          {pop.kind === 'size' && <Opts items={[['', t('bar.normal')], ...SIZES.map((c) => [c, t(`bar.sz_${c}`)] as [string, string])]} pick={(v) => (p.run({ k: 'size', v: v || null }), setPop(null))} />}
          {pop.kind === 'table' && <TablePick pick={(cols, rows) => (p.run({ k: 'table', cols, rows }), setPop(null))} />}
          {pop.kind === 'link' && <LinkPick notes={p.notes} pick={(v) => (p.run({ k: 'link', v }), setPop(null))} />}
          {pop.kind === 'more' && <Opts items={[...p.slash, ['moveSection', t('bar.mover_seccion_arriba')], ['moveSectionDown', t('bar.mover_seccion_abajo')]]} pick={(v) => (v === 'moveSection' || v === 'moveSectionDown' ? p.run({ k: 'move', v: v === 'moveSection' ? -1 : 1, section: true }) : p.run({ k: 'slash', v }), setPop(null))} />}
        </Popover>
      )}
    </div>
  );
}

function Opts(p: { items: [string, string][]; pick: (v: string) => void }) {
  return <div class="slash">{p.items.map(([v, l]) => <button type="button" role="menuitem" {...keep} onClick={() => p.pick(v)}>{l}</button>)}</div>;
}

/** Rejilla de hasta 6×6: al pasar o tocar se elige columnas × filas. */
function TablePick(p: { pick: (cols: number, rows: number) => void }) {
  const [h, setH] = useState<[number, number]>([3, 3]);
  return (
    <div class="eb-grid-wrap">
      <div class="eb-grid" role="grid" aria-label={t('bar.tabla')}>
        {Array.from({ length: 6 }, (_, r) => Array.from({ length: 6 }, (_, c) => (
          <button type="button" class={c < h[0] && r < h[1] ? 'on' : ''} aria-label={t('bar.tabla_n', { c: c + 1, r: r + 1 })} {...keep} onPointerEnter={() => setH([c + 1, r + 1])} onFocus={() => setH([c + 1, r + 1])} onClick={() => p.pick(c + 1, r + 1)} />
        )))}
      </div>
      <span class="foot">{t('bar.tabla_n', { c: h[0], r: h[1] })}</span>
    </div>
  );
}

/** Enlace: una URL (http/https) o el título de una nota → `[texto](url)` o `[[nota]]`. */
function LinkPick(p: { notes: { title: string }[]; pick: (v: string) => void }) {
  const [v, setV] = useState('');
  const hits = v.trim() && !/^https?:\/\//i.test(v) ? p.notes.filter((n) => n.title.toLowerCase().includes(v.trim().toLowerCase())).slice(0, 6) : [];
  return (
    <div class="stack-s" style={{ padding: '6px', minWidth: '260px' }}>
      <input class="input" autoFocus value={v} placeholder={t('bar.enlace_ph')} aria-label={t('bar.enlace')} onInput={(e) => setV((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && v.trim() && p.pick(v.trim())} />
      <div class="slash">{hits.map((n) => <button type="button" onClick={() => p.pick(n.title)}>{n.title}</button>)}</div>
    </div>
  );
}
