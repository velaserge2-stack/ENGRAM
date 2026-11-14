/**
 * Mosaico «Sticky notes» de Hoy (Prompt 19 · 3). Add-on `sticky-notes`, apagado por defecto: este
 * archivo solo se carga con `import()` cuando está activo. Cada sticky es `notes/Stickies/<id>.md`,
 * escrita por `noteStore` (el mismo documento que abre Notas; guardado con SafeVault).
 * Un solo `backdrop-filter` (el del mosaico): las stickies son papel sin desenfoque propio.
 * El color de una sticky es contenido del usuario (paleta de Notas, neutra por defecto) y solo
 * pinta el papel; el asa y el menú quedan neutros.
 */
import { t, tn } from '../i18n';
import { Archive, ArchiveRestore, ExternalLink, FileText, GripVertical, MoreHorizontal, Pin, PinOff, Plus, Trash2 } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../state';
import { Popover } from '../ui/overlay';
import { COLOR_LABEL } from '../lib/palette';
import { Html } from '../ui/md';
import { renderMarkdownCached } from '../md/render';
import { noteStore } from '../notes/store';
import { restore, safeSegment, trash } from '../notes/model';
import { readTextOr, walk } from '../vault/util';
import { asNote, newStickyPath, parseSticky, reorder, serializeSticky, sortStickies, STICKY_COLORS, STICKY_DIR, stickyTitle, type Sticky, type StickyColor } from './model';

const PAGE = 50;

export function StickiesTile() {
  const app = useApp();
  const [items, setItems] = useState<Sticky[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ path: string; el: HTMLElement } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);

  // las stickies del disco (o del documento abierto en Notas, si ya está en memoria)
  useEffect(() => {
    let alive = true;
    void walk(app.vault, STICKY_DIR).then(async (fs) => {
      const out: Sticky[] = [];
      for (const f of fs) if (f.path.endsWith('.md')) { const txt = noteStore.peek(f.path) ?? (await readTextOr(app.vault, f.path, '').catch(() => null)); if (txt !== null) out.push(parseSticky(f.path, txt)); /* ilegible: no se muestra (así no se reescribe sin cuerpo) */ }
      if (alive) setItems(out);
    }, () => alive && setItems([]));
    return () => void (alive = false);
  }, [app.version, app.notesVersion]);

  const all = sortStickies(items ?? []);
  const live = all.filter((s) => !s.archived);
  const archived = all.filter((s) => s.archived);
  const list = (showArchived ? archived : live).slice(0, limit);

  const save = (s: Sticky) => {
    noteStore.set(app.vault, s.path, serializeSticky(s));
    setItems((xs) => (xs ?? []).some((x) => x.path === s.path) ? (xs ?? []).map((x) => (x.path === s.path ? s : x)) : [...(xs ?? []), s]);
  };
  const add = () => {
    const known = new Set((items ?? []).map((x) => x.path));
    const path = newStickyPath(Date.now(), (p) => known.has(p));
    const top = live.filter((s) => !s.pinned)[0]?.order ?? 10;
    // la nueva va arriba (antes de la primera no fijada)
    save({ path, body: '', order: top - 10, color: null, pinned: false, archived: false, rest: {} });
    setShowArchived(false);
    setEditing(path);
  };
  const remove = async (s: Sticky) => {
    await noteStore.flush(s.path);
    const stored = await trash(app.vault, s.path);
    await noteStore.forget(s.path);
    setItems((xs) => (xs ?? []).filter((x) => x.path !== s.path));
    app.toast(t('stickies.eliminada'), { label: t('stickies.deshacer'), run: () => void restore(app.vault, stored, s.path).then(() => app.changed('notes')) });
  };
  const toNote = async (s: Sticky) => {
    await noteStore.flush(s.path);
    const base = `notes/${safeSegment(stickyTitle(s.body, t('stickies.sticky')))}`;
    let target = `${base}.md`;
    for (let i = 2; await app.vault.exists(target); i++) target = `${base} (${i}).md`;
    await app.vault.move(s.path, target);
    await app.vault.write(target, asNote(s));
    await noteStore.forget(s.path);
    app.changed('notes'); // sticky → nota: solo notes/
    app.toast(t('stickies.convertida'), { label: t('stickies.abrir'), run: () => (location.hash = `#/notas/${encodeURI(target.slice(6))}`) });
  };
  const open = (s: Sticky) => (location.hash = `#/notas/${encodeURI(s.path.slice(6))}`);

  // arrastrar desde el asa (Pointer Events con captura) entre las visibles
  const startDrag = (e: PointerEvent, i: number) => ((e.currentTarget as HTMLElement).setPointerCapture(e.pointerId), setDrag({ from: i, over: i }));
  const moveDrag = (e: PointerEvent) => {
    if (!drag) return;
    const el = document.elementsFromPoint(e.clientX, e.clientY).map((x) => (x as HTMLElement).closest?.('[data-k]')).find(Boolean) as HTMLElement | undefined;
    const over = el ? Number(el.dataset.k) : drag.over;
    if (over !== drag.over) setDrag({ ...drag, over });
  };
  const endDrag = () => {
    if (drag && drag.from !== drag.over && list[drag.from]!.pinned === list[drag.over]!.pinned) for (const s of reorder(list, drag.from, drag.over)) save(s);
    setDrag(null);
  };
  const keyMove = (e: KeyboardEvent, i: number) => {
    if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const j = i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
    if (list[j] && list[j]!.pinned === list[i]!.pinned) for (const s of reorder(list, i, j)) save(s);
  };

  const cur = menu ? all.find((s) => s.path === menu.path) : null;
  return (
    <section class="glass panel stickies" aria-label={t('stickies.titulo')}>
      <div class="panel-h wrap">
        <h2>{t('stickies.titulo')}</h2>
        <div class="row wrap">
          {archived.length > 0 && <button type="button" class="btn" aria-pressed={showArchived} onClick={() => (setShowArchived(!showArchived), setLimit(PAGE))}>{tn('stickies.archivadas_n', archived.length)}</button>}
          <button type="button" class="btn primary" onClick={add}><Plus size={18} /> {t('stickies.nueva')}</button>
        </div>
      </div>
      {items && !list.length && <p class="foot">{showArchived ? t('stickies.sin_archivadas') : t('stickies.vacio')}</p>}
      <ul class="sticky-grid">
        {list.map((s, i) => (
          <li key={s.path} data-k={i} class={`sticky${drag?.from === i ? ' dragging' : ''}${drag && drag.over === i && drag.from !== i ? ' drop' : ''}`} onKeyDown={(e) => keyMove(e, i)}>
            <div class="sticky-bar">
              <button type="button" class="btn icon ghost grip" aria-label={t('stickies.mover')} onPointerDown={(e) => startDrag(e, i)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}><GripVertical size={16} /></button>
              {s.pinned && <span class="t3" aria-label={t('stickies.fijada')} role="img"><Pin size={14} /></span>}
              <button type="button" class="btn icon ghost" aria-label={t('stickies.mas')} aria-haspopup="menu" onClick={(e) => setMenu({ path: s.path, el: e.currentTarget as HTMLElement })}><MoreHorizontal size={18} /></button>
            </div>
            <div class="sticky-paper" data-color={s.color ?? undefined} data-user-content>
              {editing === s.path ? (
                <Editor value={s.body} onChange={(body) => save({ ...s, body })} onDone={() => setEditing(null)} />
              ) : (
                <div class="sticky-view" role="button" tabIndex={0} aria-label={t('stickies.editar')}
                  onClick={(e) => !(e.target as HTMLElement).closest('a') && setEditing(s.path)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), setEditing(s.path))}>
                  {s.body.trim() ? <Html html={renderMarkdownCached(s.body)} /> : <p class="t3">{t('stickies.toca_para_escribir')}</p>}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {(showArchived ? archived : live).length > limit && <div class="row" style={{ justifyContent: 'center' }}><button type="button" class="btn small" onClick={() => setLimit(limit + PAGE)}>{t('stickies.mostrar_mas', { n: (showArchived ? archived : live).length - limit })}</button></div>}
      {menu && cur && (
        <Popover anchor={menu.el} onClose={() => setMenu(null)} label={t('stickies.mas')}>
          <div class="stack-s sticky-menu">
            <button type="button" class="btn" role="menuitem" onClick={() => (save({ ...cur, pinned: !cur.pinned }), setMenu(null))}>{cur.pinned ? <PinOff size={16} /> : <Pin size={16} />} {cur.pinned ? t('stickies.desfijar') : t('stickies.fijar')}</button>
            <div class="sticky-swatches" role="radiogroup" aria-label={t('stickies.color')} data-user-content>
              {[null, ...STICKY_COLORS].map((c) => (
                <button type="button" role="radio" aria-checked={cur.color === c} class="swatch" data-color={c ?? 'neutro'} aria-label={c ? COLOR_LABEL[c] ?? c : t('bar.sin_color')} onClick={() => save({ ...cur, color: c as StickyColor | null })} />
              ))}
            </div>
            <button type="button" class="btn" role="menuitem" onClick={() => (save({ ...cur, archived: !cur.archived }), setMenu(null))}>{cur.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />} {cur.archived ? t('stickies.desarchivar') : t('stickies.archivar')}</button>
            <button type="button" class="btn" role="menuitem" onClick={() => (setMenu(null), open(cur))}><ExternalLink size={16} /> {t('stickies.abrir_en_notas')}</button>
            <button type="button" class="btn" role="menuitem" onClick={() => (setMenu(null), void toNote(cur))}><FileText size={16} /> {t('stickies.convertir')}</button>
            <button type="button" class="btn" role="menuitem" onClick={() => (setMenu(null), void remove(cur))}><Trash2 size={16} /> {t('stickies.eliminar')}</button>
          </div>
        </Popover>
      )}
    </section>
  );
}

/** Edición en el sitio: un textarea que crece (con tope y desplazamiento interno). */
function Editor(p: { value: string; onChange: (v: string) => void; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const grow = () => { const el = ref.current; if (el) (el.style.height = 'auto', (el.style.height = `${Math.min(320, el.scrollHeight + 2)}px`)); };
  useEffect(() => { grow(); ref.current?.focus(); }, []);
  return (
    <textarea ref={ref} class="sticky-edit" value={p.value} aria-label={t('stickies.texto')} placeholder={t('stickies.toca_para_escribir')}
      onInput={(e) => (p.onChange((e.target as HTMLTextAreaElement).value), grow())}
      onBlur={p.onDone} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), ref.current?.blur())} />
  );
}
