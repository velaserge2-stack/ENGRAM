import { locale, t } from '../i18n';
import { BookOpen, Download, FilePlus2, FolderInput, FolderOutput, Import, Pause as PauseIcon, Pencil, Settings2, Layers, Trash2, ListChecks, RotateCcw } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { inFolder, listTrash, purgeTrash, restoreTrash, trashDecks, trashPlan, withSubdecks, type TrashEntry } from '../data/decktrash';
import type { Deck } from '../data/collection';
import { createDeck, mediaRefs, resolveMedia, setDeckMeta, stateOp } from '../data/ops';
import { buildZip } from '../io/zip';
import { deliver } from '../io/share';
import { srsParams, studyLimits } from '../lib/settings';
import { deckCounts, newIntroducedToday, type Counts } from '../srs/queue';
import { go, href, useApp, useAsync } from '../state';
import { Empty, Num, PageTitle, Sheet } from '../ui/kit';
import { Popover, Portal } from '../ui/overlay';
import { type MoveItems, MoveDecksSheet, useMoveTo } from './move';
import { readTextOr } from '../vault/util';
import { APP_VERSION } from './backup';

export function deckEmoji(app: ReturnType<typeof useApp>, d: Deck): string {
  return (typeof d.data.emoji === 'string' && d.data.emoji) || app.settings.deckEmoji[d.path] || '';
}

interface Node {
  key: string;
  label: string;
  deck: Deck | null;
  children: Node[];
  counts: Counts;
}

function tree(decks: Deck[], counts: Map<string, Counts>): Node[] {
  const root: Node = { key: '', label: '', deck: null, children: [], counts: { new: 0, learning: 0, due: 0 } };
  for (const d of decks) {
    let cur = root;
    const parts = d.folder ? d.folder.split('/') : [];
    let key = '';
    for (const p of parts) {
      key = key ? `${key}/${p}` : p;
      let n = cur.children.find((c) => c.key === key && !c.deck);
      if (!n) cur.children.push((n = { key, label: p, deck: null, children: [], counts: { new: 0, learning: 0, due: 0 } }));
      cur = n;
    }
    cur.children.push({ key: d.path, label: d.name, deck: d, children: [], counts: counts.get(d.path)! });
  }
  const sum = (n: Node): Counts => {
    if (n.deck) return n.counts;
    n.counts = n.children.map(sum).reduce((a, b) => ({ new: a.new + b.new, learning: a.learning + b.learning, due: a.due + b.due }), { new: 0, learning: 0, due: 0 });
    return n.counts;
  };
  sum(root);
  return root.children;
}

/** Panel de mazos (Cristal §7.2): jerarquía ＋/－, fila seleccionada en píldora, engranaje, deslizar. */
export function DeckPanel(props: { title?: string; select?: { keys: Set<string>; toggle: (key: string) => void } }) {
  const app = useApp();
  const col = app.col;
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [swiped, setSwiped] = useState<string | null>(null);
  const [opts, setOpts] = useState<Deck | null>(null);
  const [creating, setCreating] = useState(false);
  const swipe = useRef<{ x: number; key: string } | null>(null);
  const [moving, setMoving] = useState<MoveItems | null>(null);
  const [menu, setMenu] = useState<{ n: Node; el: HTMLElement } | null>(null);
  const [drag, setDrag] = useState<{ n: Node; x: number; y: number; over: string | null } | null>(null);
  const press = useRef<{ x: number; y: number; n: Node; el: HTMLElement; armed: boolean; dragging: boolean; timer: ReturnType<typeof setTimeout> } | null>(null);
  const eatClick = useRef(false);
  const mover = useMoveTo();
  useEffect(() => () => { if (press.current) clearTimeout(press.current.timer); }, []);
  if (!col) return <section class="glass panel" aria-busy="true"><p class="t2">{t('decks.cargando_mazos')}</p></section>;
  const now = Date.now();
  const lim = studyLimits(app.settings);
  const intro = newIntroducedToday(col, now, lim);
  const counts = new Map(col.decks.map((d) => [d.path, deckCounts(col, d, now, lim, intro)]));
  const nodes = tree(col.decks, counts);

  const itemsOf = (n: Node): MoveItems => (n.deck ? { decks: [n.deck], folders: [] } : { decks: [], folders: [n.key] });
  const fullOf = (n: Node) => (n.deck ? n.deck.full : n.key);
  /** Pulsación larga = menú contextual; pulsación larga y arrastrar = mover (Pointer Events). */
  const startPress = (e: PointerEvent, n: Node) => {
    if (props.select || e.button > 0) return;
    const el = e.currentTarget as HTMLElement;
    const p = { x: e.clientX, y: e.clientY, n, el, armed: false, dragging: false, timer: setTimeout(() => { p.armed = true; }, 450) };
    press.current = p;
    const over = (x: number, y: number) => {
      const t = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-drop]') as HTMLElement | null;
      return t ? t.dataset.drop! : null;
    };
    const move = (ev: PointerEvent) => {
      const d = Math.hypot(ev.clientX - p.x, ev.clientY - p.y);
      if (!p.armed) { if (d > 8) clearTimeout(p.timer); return; }
      if (d > 8 || p.dragging) { p.dragging = true; setDrag({ n, x: ev.clientX, y: ev.clientY, over: over(ev.clientX, ev.clientY) }); }
    };
    const touch = (ev: TouchEvent) => { if (p.armed) ev.preventDefault(); };
    const up = (ev: PointerEvent) => {
      clearTimeout(p.timer);
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      removeEventListener('touchmove', touch);
      press.current = null;
      if (p.dragging || p.armed) setTimeout(() => { eatClick.current = false; }, 0); // el clic que sigue a soltar no cuenta
      if (p.dragging) {
        eatClick.current = true;
        setDrag(null);
        const dest = ev.type === 'pointerup' ? over(ev.clientX, ev.clientY) : null;
        const full = fullOf(n);
        if (dest !== null && dest !== full && !dest.startsWith(full + '/')) void mover.go(itemsOf(n), dest);
      } else if (p.armed && ev.type === 'pointerup') {
        eatClick.current = true;
        setMenu({ n, el: p.el });
      }
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    addEventListener('touchmove', touch, { passive: false });
  };

  const rows: preact.JSX.Element[] = [];
  const walk = (ns: Node[], depth: number) => {
    for (const n of ns) {
      const open = !closed.has(n.key);
      const isSel = sel === n.key;
      const studyKey = n.deck ? n.deck.path : `decks/${n.key}/`;
      rows.push(
        <tr
          key={n.key}
          class={`swipe-row${isSel ? ' sel' : ''}${drag?.over === fullOf(n) && drag.n !== n ? ' drop-over' : ''}${drag?.n === n ? ' dragging' : ''}`}
          data-drop={fullOf(n)}
          onDragStart={(e) => e.preventDefault()}
          onClickCapture={(e) => { if (eatClick.current) { eatClick.current = false; e.preventDefault(); e.stopPropagation(); } }}
          onClick={() => (props.select ? props.select.toggle(n.key) : setSel(isSel ? null : n.key))}
          onContextMenu={(e) => { if (props.select) return; e.preventDefault(); setMenu({ n, el: e.currentTarget as HTMLElement }); }}
          onPointerDown={(e) => { swipe.current = { x: e.clientX, key: n.key }; startPress(e, n); }}
          onPointerUp={(e) => {
            const s = swipe.current;
            swipe.current = null;
            if (s && s.key === n.key && Math.abs(e.clientX - s.x) > 50) setSwiped(e.clientX < s.x ? n.key : null);
          }}
        >
          <td>
            <div class="name" style={{ paddingLeft: `${depth * 22}px` }}>
              {props.select && <input type="checkbox" class="pick" checked={props.select.keys.has(n.key)} aria-label={t('decks.seleccionar_label', { label: n.label })} onClick={(e) => e.stopPropagation()} onChange={() => props.select!.toggle(n.key)} />}
              {n.deck ? <span style={{ width: '28px', textAlign: 'center' }} aria-hidden="true">{deckEmoji(app, n.deck) || '·'}</span> : (
                <button type="button" class="tog" aria-expanded={open} aria-label={t(open ? 'decks.contraer_label' : 'decks.expandir_label', { label: n.label })} onClick={(e) => (e.stopPropagation(), setClosed((s) => { const c = new Set(s); c.has(n.key) ? c.delete(n.key) : c.add(n.key); return c; }))}>
                  {open ? '－' : '＋'}
                </button>
              )}
              <a href={n.deck ? href('estudiar', ...n.deck.path.split('/')) : href('estudiar', ...studyKey.split('/').filter(Boolean), '')} onClick={(e) => e.stopPropagation()}>{n.label}</a>
              {isSel && n.deck && (
                <button type="button" class="btn icon small ghost" aria-label={t('decks.opciones_de_label', { label: n.label })} onClick={(e) => (e.stopPropagation(), setOpts(n.deck))}>
                  <Settings2 size={18} />
                </button>
              )}
            </div>
          </td>
          {swiped === n.key ? (
            <td colSpan={3}>
              <div class="row" style={{ justifyContent: 'flex-end' }}>
                <a class="btn small" href={href('estudiar', ...studyKey.split('/').filter(Boolean), ...(n.deck ? [] : ['']))}><BookOpen size={16} />{' '}{t('today.estudiar')}</a>
                <button type="button" class="btn small" onClick={(e) => (e.stopPropagation(), suspendAll(n))}><PauseIcon size={16} />{' '}{t('decks.suspender')}</button>
                <button type="button" class="btn small" onClick={(e) => (e.stopPropagation(), setSwiped(null), setMoving(itemsOf(n)))}><FolderOutput size={16} />{' '}{t('move.mover')}</button>
                {n.deck && <button type="button" class="btn small" onClick={(e) => (e.stopPropagation(), void exportDeck(n.deck!))}><Download size={16} />{' '}{t('deck.exportar')}</button>}
              </div>
            </td>
          ) : (
            <>
              <td><Num n={n.counts.new} /></td>
              <td><Num n={n.counts.learning} /></td>
              <td class={n.counts.due ? 'due-pos' : ''}><Num n={n.counts.due} strong /></td>
            </>
          )}
        </tr>,
      );
      if (!n.deck && open) walk(n.children, depth + 1);
    }
  };
  walk(nodes, 0);

  const suspendAll = async (n: Node) => {
    const decks = n.deck ? [n.deck] : col.decks.filter((d) => d.folder === n.key || d.folder.startsWith(n.key + '/'));
    const cids = decks.flatMap((d) => d.cards.map((c) => c.cid));
    if (!confirm(t('decks.suspender_n_tarjetas_de_label_puedes', { n: cids.length, label: n.label }))) return;
    await stateOp(app.vault, col, cids, 'suspend', srsParams(app.settings));
    setSwiped(null);
    app.refresh();
    app.toast(t('decks.n_tarjetas_suspendidas', { n: cids.length }));
  };

  const exportDeck = async (d: Deck) => {
    const text = await readTextOr(app.vault, d.path, '');
    const media = mediaRefs(text);
    if (!media.length) {
      const r = await deliver(new File([text], d.path.split('/').pop()!, { type: 'text/markdown' }));
      if (r !== 'cancelled') app.toast(t('decks.mazo_exportado'));
      return;
    }
    // con medios: .zip (se prepara y luego se entrega con un segundo toque)
    const files: { path: string; data: Uint8Array }[] = [{ path: d.path, data: new TextEncoder().encode(text) }];
    for (const m of media) {
      const p = await resolveMedia(app.vault, m);
      if (p) files.push({ path: p, data: await app.vault.read(p) });
    }
    const zip = await buildZip(files, APP_VERSION);
    setPendingFile(new File([zip as BlobPart], `${d.name}.zip`, { type: 'application/zip' }));
  };
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  return (
    <section class="glass panel" aria-label={t('decks.mazos')}>
      <div class="panel-h">
        <h2>{props.title ?? t('decks.mazos')}</h2>
        {drag ? <span class={`foot drop-top${drag.over === '' ? ' drop-over' : ''}`} data-drop="">⤒ {t('move.nivel_superior')}</span> : <span class="foot">{t('decks.desliza_una_fila_para_acciones_rapidas')}</span>}
      </div>
      {col.decks.length === 0 ? (
        <p class="t2" style={{ padding: '8px 4px 12px' }}>{t('decks.aun_no_hay_mazos_crea_uno')}{' '}<code>deck:</code>.</p>
      ) : (
        <table class="decks">
          <thead>
            <tr>
              <th scope="col">{t('deck.mazo')}</th>
              <th scope="col">{t('today.nuevas')}</th>
              <th scope="col">{t('today.aprendiendo')}</th>
              <th scope="col">{t('today.vencidas')}</th>
            </tr>
          </thead>
          <tbody>
            {rows}
          </tbody>
        </table>
      )}
      {drag && <Portal><div class="drag-ghost glass strong" aria-hidden="true" style={{ left: `${drag.x + 12}px`, top: `${drag.y + 12}px` }} data-user-content>{drag.n.label}</div></Portal>}
      {menu && (
        <Popover anchor={menu.el} onClose={() => setMenu(null)} label={t('move.acciones_de', { label: menu.n.label })} class="glass strong add-menu">
          <button type="button" role="menuitem" onClick={() => { const m = menu; setMenu(null); setMoving(itemsOf(m.n)); }}><FolderOutput size={18} />{' '}{t('move.mover_a')}</button>
          {menu.n.deck && <button type="button" role="menuitem" onClick={() => { const d = menu.n.deck; setMenu(null); setOpts(d); }}><Settings2 size={18} />{' '}{t('move.opciones')}</button>}
          <a role="menuitem" class="add-menu-item" href={menu.n.deck ? href('estudiar', ...menu.n.deck.path.split('/')) : href('estudiar', 'decks', ...menu.n.key.split('/'), '')} onClick={() => setMenu(null)}><BookOpen size={18} />{' '}{t('today.estudiar')}</a>
        </Popover>
      )}
      {moving && <MoveDecksSheet items={moving} onClose={() => setMoving(null)} />}
      {mover.sheet}
      <div class="footer-pills" style={{ marginTop: '14px' }}>
        <button type="button" class="btn" onClick={() => app.openSheet('import')}><FolderInput size={18} />{' '}{t('decks.importar_compartidos')}</button>
        <button type="button" class="btn" onClick={() => setCreating(true)}><FilePlus2 size={18} />{' '}{t('decks.crear_mazo')}</button>
        <button type="button" class="btn" onClick={() => app.openSheet('import')}><Import size={18} />{' '}{t('decks.importar_archivo')}</button>
      </div>
      {opts && <DeckOptions deck={opts} onClose={() => setOpts(null)} />}
      {creating && <CreateDeck onClose={() => setCreating(false)} />}
      {pendingFile && (
        <Sheet title={t('decks.exportar_mazo_con_medios')} onClose={() => setPendingFile(null)}>
          <div class="stack">
            <p>{t('decks.name_esta_listo', { name: pendingFile.name })}</p>
            <button type="button" class="btn primary" onClick={async () => { await deliver(pendingFile); setPendingFile(null); }}>{t('backup.guardar_en_archivos')}</button>
          </div>
        </Sheet>
      )}
    </section>
  );
}

function CreateDeck(props: { onClose: () => void }) {
  const app = useApp();
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const folders = [...new Set(app.col?.decks.map((d) => d.folder).filter(Boolean))];
  return (
    <Sheet title={t('decks.crear_mazo')} onClose={props.onClose}>
      <form class="stack" onSubmit={async (e) => {
        e.preventDefault();
        const p = await createDeck(app.vault, name, folder);
        app.changed();
        props.onClose();
        go('mazos', ...p.split('/'));
      }}>
        <label class="field">{t('decks.nombre_puedes_empezar_con_un_emoji')}<input class="input" required value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder={t('decks.cardiologia')} /></label>
        <label class="field">{t('decks.carpeta_opcional_para_submazos')}<input class="input" list="folders" value={folder} onInput={(e) => setFolder((e.target as HTMLInputElement).value)} placeholder={t('decks.medicina_interna')} />
          <datalist id="folders">{folders.map((f) => <option value={f} />)}</datalist>
        </label>
        <button class="btn primary" type="submit">{t('decks.crear')}</button>
      </form>
    </Sheet>
  );
}

export function DeckOptions(props: { deck: Deck; onClose: () => void }) {
  const app = useApp();
  const d = props.deck;
  const [name, setName] = useState(d.name);
  const [emoji, setEmoji] = useState(typeof d.data.emoji === 'string' ? d.data.emoji : '');
  const [npd, setNpd] = useState(d.newPerDay ?? app.settings.newPerDay);
  const [lang, setLang] = useState(typeof d.data.lang === 'string' ? d.data.lang : '');
  const [del, setDel] = useState(false);
  const [moving, setMoving] = useState(false);
  return (
    <Sheet title={t('decks.opciones_name', { name: d.name })} onClose={props.onClose}>
      <form class="stack" onSubmit={async (e) => {
        e.preventDefault();
        await setDeckMeta(app.vault, d.path, { deck: name, emoji: emoji || null, new_per_day: npd, lang: lang || null });
        app.changed();
        props.onClose();
      }}>
        <label class="field">{t('decks.nombre')}<input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
        <label class="field">{t('decks.emoji_el_unico_color_de_la')}<input class="input" value={emoji} maxLength={8} onInput={(e) => setEmoji((e.target as HTMLInputElement).value)} placeholder="🫀" /></label>
        <label class="field">{t('decks.nuevas_por_dia')}<input class="input" type="number" min={0} max={999} value={npd} onInput={(e) => setNpd(Number((e.target as HTMLInputElement).value))} /></label>
        <label class="field">{t('decks.idioma_de_lectura_en_voz_alta')}<input class="input" value={lang} onInput={(e) => setLang((e.target as HTMLInputElement).value)} placeholder={t('decks.es_mx_en_us')} /></label>
        <div class="row wrap">
          <button class="btn primary" type="submit">{t('calendar.guardar')}</button>
          <a class="btn" href={href('mazos', ...d.path.split('/'))} onClick={props.onClose}><Pencil size={16} />{' '}{t('decks.editar_tarjetas')}</a>
        </div>
        <p class="foot">{t('decks.se_guarda_en_el_frontmatter_del')}</p>
        <hr class="sep" />
        <button type="button" class="btn" onClick={() => setMoving(true)}><FolderOutput size={16} />{' '}{t('move.mover_a')}</button>
        <button type="button" class="btn danger" onClick={() => setDel(true)}><Trash2 size={16} />{' '}{t('decks.eliminar_mazo')}</button>
      </form>
      {del && app.col && <DeleteDecks decks={withSubdecks(app.col, d)} onClose={() => setDel(false)} onDone={props.onClose} />}
      {moving && app.col && <MoveDecksSheet items={{ decks: [d], folders: [] }} onClose={() => setMoving(false)} onDone={props.onClose} />}
    </Sheet>
  );
}

/** Confirmación con cifras (C8): nada se borra, todo va a la papelera de mazos. */
export function DeleteDecks(props: { decks: Deck[]; onClose: () => void; onDone?: () => void }) {
  const app = useApp();
  const col = app.col!;
  const plan = trashPlan(col, props.decks);
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={props.decks.length > 1 ? t('decks.eliminar_n_mazos', { n: props.decks.length }) : t('decks.eliminar_mazo_name', { name: props.decks[0]?.full ?? '' })} onClose={props.onClose}>
      <div class="stack">
        <p><b>{t('decks.se_moveran_a_la_papelera', { cards: plan.cards, reviews: plan.reviews })}</b></p>
        {props.decks.length > 1 && <ul class="plan-list" data-user-content>{props.decks.map((d) => <li>{deckEmoji(app, d)} {d.full} <span class="foot">· {t('decks.n_tarjetas', { n: d.cards.length })}</span></li>)}</ul>}
        <p class="foot">{t('decks.papelera_nota', { days: app.settings.deckTrashDays || '∞' })}</p>
        <div class="row wrap" style={{ justifyContent: 'flex-end' }}>
          <button type="button" class="btn" onClick={props.onClose}>{t('settings.cancelar')}</button>
          <button type="button" class="btn danger primary" disabled={busy || !props.decks.length} onClick={async () => {
            setBusy(true);
            await trashDecks(app.vault, col, props.decks);
            app.changed();
            app.toast(t('decks.movidos_a_la_papelera', { n: props.decks.length }));
            props.onClose();
            props.onDone?.();
          }}><Trash2 size={16} />{' '}{t('decks.mover_a_la_papelera')}</button>
        </div>
      </div>
    </Sheet>
  );
}

function DeckTrash(props: { onClose: () => void }) {
  const app = useApp();
  const { data: items } = useAsync(() => listTrash(app.vault), [app.version]);
  const days = app.settings.deckTrashDays;
  const left = (e: TrashEntry) => Math.max(0, Math.ceil(days - (Date.now() - e.deletedAt) / 86_400_000));
  return (
    <Sheet title={t('decks.papelera_de_mazos')} onClose={props.onClose}>
      <div class="stack">
        {!items?.length && <p class="t2">{t('decks.papelera_vacia')}</p>}
        {items?.map((e) => (
          <div class="glass inset panel stack-s" style={{ borderRadius: 'var(--r-inner)' }}>
            <b data-user-content>{e.decks.map((d) => d.name).join(', ')}</b>
            <span class="foot">{t('decks.n_tarjetas_n2_repasos', { n: e.cards, n2: e.reviews })} · {new Date(e.deletedAt).toLocaleDateString(locale())}{days ? ` · ${t('decks.se_vacia_en', { n: left(e) })}` : ''}</span>
            <div class="row wrap">
              <button type="button" class="btn small" onClick={async () => { const r = await restoreTrash(app.vault, e); app.changed(); app.toast(t('decks.restaurado', { n: r.length })); }}><RotateCcw size={14} />{' '}{t('decks.restaurar')}</button>
              <button type="button" class="btn small danger" onClick={async () => { if (!confirm(t('decks.confirm_definitivo'))) return; await purgeTrash(app.vault, e); app.changed(); }}><Trash2 size={14} />{' '}{t('decks.eliminar_definitivamente')}</button>
            </div>
          </div>
        ))}
        <label class="field">{t('decks.vaciar_automaticamente')}
          <select value={days} onChange={(e) => app.update({ deckTrashDays: Number((e.target as HTMLSelectElement).value) })}>
            {[7, 14, 30, 60, 90].map((d) => <option value={d}>{t('settings.d_dias', { d })}</option>)}
            <option value={0}>{t('decks.nunca')}</option>
          </select>
        </label>
        <p class="foot">{t('decks.historial_nota')}</p>
      </div>
    </Sheet>
  );
}

export function Decks() {
  const app = useApp();
  const col = app.col;
  const [picking, setPicking] = useState<Set<string> | null>(null);
  const [trash, setTrash] = useState(false);
  const [del, setDel] = useState<Deck[] | null>(null);
  const [moving, setMoving] = useState<MoveItems | null>(null);
  const { data: trashN } = useAsync(async () => (await listTrash(app.vault)).length, [app.version]);
  const toggle = (k: string) => setPicking((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  // selección → mazos (una carpeta se lleva todo lo que contiene; un mazo, sus submazos)
  const picked = (): Deck[] => {
    if (!col || !picking) return [];
    const m = new Map<string, Deck>();
    for (const k of picking) for (const d of col.decks.some((x) => x.path === k) ? withSubdecks(col, col.decks.find((x) => x.path === k)!) : inFolder(col, k)) m.set(d.path, d);
    return [...m.values()];
  };
  return (
    <>
      <PageTitle title={t('decks.mazos')} sub={col ? t('decks.n_mazos_size_tarjetas', { n: col.decks.length, size: col.byCid.size }) : undefined}>
        {picking ? (
          <>
            <button type="button" class="btn" onClick={() => setPicking(null)}>{t('settings.cancelar')}</button>
            <button type="button" class="btn" disabled={!picking.size} onClick={() => setMoving({ decks: col?.decks.filter((d) => picking.has(d.path)) ?? [], folders: [...picking].filter((k) => !col?.decks.some((d) => d.path === k)) })}><FolderOutput size={16} />{' '}{t('move.mover_n', { n: picking.size })}</button>
            <button type="button" class="btn danger primary" disabled={!picking.size} onClick={() => setDel(picked())}><Trash2 size={16} />{' '}{t('decks.eliminar_seleccion', { n: picking.size })}</button>
          </>
        ) : (
          <>
            {!!col?.decks.length && <button type="button" class="btn" onClick={() => setPicking(new Set())}><ListChecks size={18} />{' '}{t('decks.seleccionar')}</button>}
            <button type="button" class="btn" onClick={() => setTrash(true)} aria-label={t('decks.papelera_n', { n: trashN ?? 0 })}><Trash2 size={18} />{' '}{t('decks.papelera')}{trashN ? ` · ${trashN}` : ''}</button>
            <a class="btn primary" href="#/estudiar"><BookOpen size={18} />{' '}{t('decks.estudiar_todo')}</a>
          </>
        )}
      </PageTitle>
      {trash && <DeckTrash onClose={() => setTrash(false)} />}
      {del && <DeleteDecks decks={del} onClose={() => setDel(null)} onDone={() => setPicking(null)} />}
      {moving && <MoveDecksSheet items={moving} onClose={() => setMoving(null)} onDone={() => setPicking(null)} />}
      {col && col.decks.length === 0 ? (
        <Empty icon={<Layers size={44} />} title={t('decks.sin_mazos_todavia')} action={<button type="button" class="btn primary" onClick={() => app.openSheet('import')}>{t('decks.importar')}</button>}>{t('decks.un_mazo_es_un_archivo_md')}</Empty>
      ) : (
        <div class="stack">
          <DeckPanel select={picking ? { keys: picking, toggle } : undefined} />
          {col && col.decks.some((d) => d.errors.length) && (
            <section class="glass panel">
              <h2 style={{ fontSize: 'var(--t-3)', marginBottom: '8px' }}>{t('decks.tarjetas_con_errores_no_entran_al')}</h2>
              {col.decks.filter((d) => d.errors.length).map((d) => (
                <div class="stack-s" style={{ marginBottom: '10px' }}>
                  <a href={href('mazos', ...d.path.split('/'))}><b>{d.full}</b></a>
                  {d.errors.slice(0, 8).map((e) => <div class="err">⚠ {e}</div>)}
                </div>
              ))}
            </section>
          )}
          {col && col.archived.length > 0 && (
            <section class="glass panel">
              <h2 style={{ fontSize: 'var(--t-3)' }}>{t('decks.archivadas')}</h2>
              <p class="t2 note">{t('decks.n_tarjetas_cuyo_id_ya_no', { n: col.archived.length })}</p>
            </section>
          )}
        </div>
      )}
    </>
  );
}
