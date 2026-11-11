import { locale, t as tr } from '../i18n';
import { Search, Maximize2, Minimize2, PanelLeft, PanelRight, Bookmark, ClipboardCopy, ClipboardPaste, Code, FilePlus2, FileText, Folder, FolderOutput, History, Import, Link2, ListChecks, ListTree, MoveRight, Network, Share, Sparkles, Star, Trash2 } from 'lucide-preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { normalizeAnswer, parseDeck } from '../cards/parse';
import { appendCard } from '../data/ops';
import { deliver } from '../io/share';
import { buildZip } from '../io/zip';
import { addDays, dayKey } from '../lib/days';
import { type Frontmatter, parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter';
import { renderMarkdown } from '../md/render';
import { compatibleMarkdown, htmlToMarkdown, markdownToDocx } from '../notes/io';
import { saveImage } from '../notes/images';
import { buildPrompt, buildTree, coverage, DAILY, linkIndex, listNotes, newNoteText, type NoteMeta, noteMeta, notePath, outline, paragraphs, parseAiResponse, readVersion, restore, snapshot, TEMPLATES, trash, trashList, unlinkedMentions, versions, withOrigin } from '../notes/model';
import { go, href, useApp, useAsync } from '../state';
import { Empty, PageTitle, Segmented, Sheet } from '../ui/kit';
import { Html } from '../ui/md';
import { readTextOr } from '../vault/util';
import { mediaRefs, resolveMedia } from '../data/ops';
import { NotePreview } from './deck';
import { search as searchCards } from '../lib/query';
import { Graph } from './graph';
import { APP_VERSION } from './backup';
import { LinkedEvents } from '../ui/links';
import { modalOpen, Popover } from '../ui/overlay';
import { FindBar, pendingFind } from '../notes/find';
import { notesIndex } from '../notes/search-client';
import { noteStore, onNoteSaved } from '../notes/store';
import { createDrawing, DRAW_RE, DrawingBlock } from '../ink/DrawingBlock';
import { pressArmed, usePressDrag } from '../ui/pressdrag';
import { MoveNotesSheet, type NoteItems, useNoteMover } from './notemove';

// tras cada guardado (venga de la pestaña o de un panel): historial de versiones e índice de búsqueda
onNoteSaved(async (vault, path, text) => { await snapshot(vault, path, text); void notesIndex.upsert(path, text); });
import type { Filters, Result } from '../notes/search-core';

const BOOKMARKS = '.app/bookmarks.json';

/** Preferencias de la vista de notas (por usuario y dispositivo: localStorage, no la bóveda). */
type LineWidth = 'comodo' | 'ancho' | 'completo';
interface NotesUI { explorer: boolean; inspector: boolean; explorerW: number; width: LineWidth }
const UI_KEY = 'engrama.notesUI';
const LINE: Record<LineWidth, string> = { comodo: '68ch', ancho: '120ch', completo: 'none' };

function useNotesUI(): [NotesUI, (p: Partial<NotesUI>) => void] {
  const narrow = typeof innerWidth === 'number' && innerWidth < 760;
  const [ui, setUi] = useState<NotesUI>(() => {
    const def: NotesUI = { explorer: !narrow, inspector: !narrow && innerWidth >= 1100, explorerW: 260, width: 'ancho' };
    try {
      return { ...def, ...(JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') as Partial<NotesUI>) };
    } catch {
      return def;
    }
  });
  const set = (p: Partial<NotesUI>) => setUi((u) => {
    const n = { ...u, ...p, explorerW: Math.min(480, Math.max(200, p.explorerW ?? u.explorerW)) };
    try { localStorage.setItem(UI_KEY, JSON.stringify(n)); } catch { /* sin almacenamiento: solo esta sesión */ }
    return n;
  });
  return [ui, set];
}

function useWidth() {
  const [w, setW] = useState(innerWidth);
  useEffect(() => {
    const on = () => setW(innerWidth);
    addEventListener('resize', on);
    return () => removeEventListener('resize', on);
  }, []);
  return w;
}

/** Pantalla completa de notas: solo una clase en <body>; el editor no se vuelve a montar. */
function setNotesFull(on: boolean) {
  document.body.classList.toggle('notes-full', on);
}

function useNotes() {
  const app = useApp();
  return useAsync(async () => {
    const notes = await listNotes(app.vault);
    const { idx, texts } = await linkIndex(app.vault, notes);
    let bookmarks: string[] = [];
    try {
      bookmarks = JSON.parse(await readTextOr(app.vault, BOOKMARKS, '[]')) as string[];
    } catch {
      bookmarks = [];
    }
    return { notes, idx, texts, bookmarks };
  }, [app.version]);
}

export function Notes(props: { route: string[] }) {
  const app = useApp();
  const [first, ...rest] = props.route;
  const { data } = useNotes();
  const s = app.settings;
  // rutas especiales: crear nota nueva o abrir la diaria
  useEffect(() => {
    if (first === '+diaria') {
      const day = rest[0] || dayKey(Date.now(), s.timeZone, s.dayStartHour);
      const path = notePath(DAILY, '', day);
      void (async () => {
        if (!(await app.vault.exists(path))) await app.vault.write(path, newNoteText(DAILY, '', day, 'Nota diaria', [], new Date(day + 'T12:00:00')));
        app.changed();
        location.replace(href('notas', ...path.split('/').slice(1)));
      })();
    }
  }, [first]);
  const [creating, setCreating] = useState(first === '+nueva');
  const path = first && !first.startsWith('+') ? `notes/${props.route.join('/')}` : null;
  const resolved = useMemo(() => {
    if (!path || !data) return path;
    if (data.notes.some((n) => n.path === path)) return path;
    // [[wikilink]] por título
    const t = data.idx.titles.get(decodeURIComponent(props.route.join('/')).toLowerCase().replace(/\.md$/, ''));
    return t ?? path;
  }, [path, data]);
  const [ui, setUi] = useNotesUI();
  const width = useWidth();
  const overlay = width < 1100;
  const narrow = width < 760;
  const drag = useRef<{ x: number; w: number } | null>(null);
  const swipe = useRef<{ x: number; y: number; inTree: boolean; inInsp: boolean } | null>(null);
  useEffect(() => () => setNotesFull(false), []);
  const cols = [ui.explorer && !narrow ? `${ui.explorerW}px 10px` : '', 'minmax(0, 1fr)', resolved && ui.inspector && !overlay ? '280px' : ''].filter(Boolean).join(' ');
  // buscador (D11): el índice es una caché que se reconstruye desde los archivos
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Filters>({});
  const [results, setResults] = useState<Result[] | null>(null);
  useEffect(() => { if (data) void notesIndex.reset(data.texts); }, [data]);
  useEffect(() => {
    if (!q.trim()) return setResults(null);
    let alive = true;
    const tm = setTimeout(() => void notesIndex.query(q, filters).then((r) => alive && setResults(r)), 120);
    return () => { alive = false; clearTimeout(tm); };
  }, [q, filters, data]);
  return (
    <>
      <NotesSearchBar q={q} setQ={setQ} filters={filters} setFilters={setFilters} data={data} />
      {results ? <SearchResults results={results} q={q} onOpen={(r) => { pendingFind.path = r.id; pendingFind.q = q; setQ(''); go('notas', ...r.id.split('/').slice(1)); }} /> : (
      <div class="notes" style={{ gridTemplateColumns: cols }}
        onPointerDown={(e) => {
          const t = e.target as HTMLElement;
          if (t.closest('textarea, input, .divider, [contenteditable]')) return;
          swipe.current = { x: e.clientX, y: e.clientY, inTree: !!t.closest('.tree'), inInsp: !!t.closest('.insp') };
        }}
        onPointerUp={(e) => {
          const s0 = swipe.current;
          swipe.current = null;
          if (!s0 || pressArmed()) return;
          const dx = e.clientX - s0.x;
          if (Math.abs(dx) < 80 || Math.abs(e.clientY - s0.y) > 40) return;
          // deslizar: ocultar el panel en el que empezó, o mostrarlo desde el borde
          if (dx < 0 && s0.inTree) setUi({ explorer: false });
          else if (dx > 0 && s0.inInsp) setUi({ inspector: false });
          else if (dx > 0 && s0.x < 40) setUi({ explorer: true });
          else if (dx < 0 && s0.x > innerWidth - 40) setUi({ inspector: true });
        }}>
        {ui.explorer && (
          <div class={narrow ? 'tree-over' : ''} style={{ minWidth: 0 }}>
            <NoteTree data={data} current={resolved} onNew={() => setCreating(true)} />
          </div>
        )}
        {ui.explorer && !narrow && (
          <div class="divider" role="separator" aria-orientation="vertical" aria-label={tr('notes.ancho_del_explorador')} tabIndex={0}
            onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, w: ui.explorerW }; }}
            onPointerMove={(e) => drag.current && setUi({ explorerW: drag.current.w + e.clientX - drag.current.x })}
            onPointerUp={() => (drag.current = null)}
            onKeyDown={(e) => (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && setUi({ explorerW: ui.explorerW + (e.key === 'ArrowLeft' ? -20 : 20) })} />
        )}
        {resolved ? <NoteEditor key={resolved} path={resolved} data={data} ui={ui} setUi={setUi} overlay={overlay} /> : <NotesHome data={data} onNew={() => setCreating(true)} ui={ui} setUi={setUi} />}
      </div>)}
      {creating && data && <NewNote notes={data.notes} onClose={() => setCreating(false)} />}
    </>
  );
}

type NotesData = ReturnType<typeof useNotes>['data'];

/**
 * La misma nota como panel del lienzo (E14): el editor completo («/», imágenes, enlaces,
 * «Buscar en esta nota») sobre el mismo documento que la pestaña Notas.
 */
export function NotePanel(props: { path: string }) {
  const { data } = useNotes();
  const [ui, setUi] = useState<NotesUI>({ explorer: false, inspector: false, explorerW: 260, width: 'completo' });
  return <div class="note-panel"><NoteEditor path={props.path} data={data} ui={ui} setUi={(p) => setUi((u) => ({ ...u, ...p }))} overlay embedded /></div>;
}

/** «＋ Nueva nota» desde un panel: crea la nota de verdad (en la materia y tema elegidos) y la devuelve. */
export function NewNotePanel(props: { onCreated: (path: string) => void; onClose: () => void }) {
  const { data } = useNotes();
  return data ? <NewNote notes={data.notes} onClose={props.onClose} onCreated={props.onCreated} /> : null;
}

/** Barra de búsqueda siempre visible en Notas (también en teléfono), con filtros. */
function NotesSearchBar(p: { q: string; setQ: (q: string) => void; filters: Filters; setFilters: (f: Filters) => void; data: NotesData }) {
  const materias = [...new Set(p.data?.notes.map((n) => n.materia).filter((m) => m && m !== DAILY) ?? [])];
  const temas = [...new Set(p.data?.notes.filter((n) => !p.filters.materia || n.materia === p.filters.materia).map((n) => n.tema).filter(Boolean) ?? [])];
  const since = p.filters.since ? (Date.now() - p.filters.since < 8 * 86_400_000 ? '7' : '30') : 'todo';
  return (
    <div class="notes-search glass row wrap" role="search">
      <Search size={18} aria-hidden="true" />
      <input class="input grow" type="search" value={p.q} placeholder={tr('find.buscar_en_notas')} aria-label={tr('find.buscar_en_notas')} onInput={(e) => p.setQ((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Escape' && p.setQ('')} />
      {p.q.trim() && (
        <>
          <select aria-label={tr('inbox.materia')} value={p.filters.materia ?? ''} onChange={(e) => p.setFilters({ ...p.filters, materia: (e.target as HTMLSelectElement).value || undefined, tema: undefined })}><option value="">{tr('notes.todas_las_materias')}</option>{materias.map((m) => <option>{m}</option>)}</select>
          <select aria-label={tr('find.tema')} value={p.filters.tema ?? ''} onChange={(e) => p.setFilters({ ...p.filters, tema: (e.target as HTMLSelectElement).value || undefined })}><option value="">{tr('find.todos_los_temas')}</option>{temas.map((m) => <option>{m}</option>)}</select>
          <Segmented label={tr('exams.fecha')} value={since} onChange={(v) => p.setFilters({ ...p.filters, since: v === 'todo' ? undefined : Date.now() - Number(v) * 86_400_000 })} options={[['todo', tr('notes.todo')], ['7', tr('notes.7_dias')], ['30', tr('notes.30_dias')]]} />
        </>
      )}
    </div>
  );
}

function SearchResults(p: { results: Result[]; q: string; onOpen: (r: Result) => void }) {
  return (
    <section class="glass panel stack-s" aria-label={tr('find.resultados')}>
      <p class="foot" aria-live="polite">{tr('find.n_resultados', { n: p.results.length })}</p>
      {!p.results.length && <p class="t2">{tr('find.sin_resultados_notas')}</p>}
      {p.results.map((r) => (
        <button type="button" class="search-hit" onClick={() => p.onOpen(r)}>
          <span class="row"><b class="grow ellipsis" data-user-content>{r.title}</b><span class="foot">{r.materia}{r.tema ? ` › ${r.tema}` : ''}{r.fecha ? ` · ${r.fecha}` : ''}</span></span>
          <span class="note t2" data-user-content>{r.parts.map((x) => (x.hit ? <mark class="hit">{x.t}</mark> : x.t))}</span>
          {r.thumb && <Html class="search-thumb" html={renderMarkdown(`![[${r.thumb}]]`)} />}
        </button>
      ))}
    </section>
  );
}

function NoteTree(props: { data: NotesData; current: string | null; onNew: () => void }) {
  const app = useApp();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [trashOpen, setTrashOpen] = useState(false);
  // mover (Prompt 6 · A2): menú contextual, arrastrar y soltar, selección múltiple
  const [picking, setPicking] = useState<Set<string> | null>(null);
  const [moving, setMoving] = useState<NoteItems | null>(null);
  const [menu, setMenu] = useState<{ item: string; el: HTMLElement } | null>(null);
  const mover = useNoteMover(props.current);
  const itemsOf = (k: string): NoteItems => (k.startsWith('notes/') ? { notes: [k], folders: [] } : { notes: [], folders: [k] });
  const pd = usePressDrag<string>({
    label: (k) => k.split('/').pop()!.replace(/\.md$/, ''),
    onMenu: (item, el) => setMenu({ item, el }),
    onDrop: (k, dest) => {
      // una nota cae en un tema; un tema cae en una materia
      if (k.startsWith('notes/') ? dest.includes('/') : !dest.includes('/') && !k.startsWith(dest + '/')) void mover.go(itemsOf(k), dest);
    },
  });
  const over = (k: string) => (pd.drag && pd.drag.over === k && pd.drag.item !== k ? ' drop-over' : '');
  if (!props.data) return <aside class="glass panel tree"><p class="t2">{tr('deck.cargando')}</p></aside>;
  const { tree, loose, daily } = buildTree(props.data.notes);
  const tog = (k: string) => setClosed((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const link = (n: NoteMeta, lvl: number) => picking ? (
    <label class={`lvl${lvl} pick-row`}><input type="checkbox" class="pick" checked={picking.has(n.path)} onChange={() => setPicking((s) => { const x = new Set(s); x.has(n.path) ? x.delete(n.path) : x.add(n.path); return x; })} /><FileText size={16} /> <span class="ellipsis">{n.title}</span></label>
  ) : (
    <a class={`lvl${lvl}${pd.drag?.item === n.path ? ' dragging' : ''}`} href={href('notas', ...n.path.split('/').slice(1))} aria-current={props.current === n.path ? 'page' : undefined} {...pd.bind(n.path)}><FileText size={16} /> <span class="ellipsis">{n.title}</span></a>
  );
  return (
    <aside class="glass panel tree stack-s" aria-label={tr('notes.materias_y_notas')}>
      <div class="row wrap"><b class="grow">{tr('notes.materias')}</b>
        {picking ? (
          <>
            <button type="button" class="btn small" onClick={() => setPicking(null)}>{tr('settings.cancelar')}</button>
            <button type="button" class="btn small primary" disabled={!picking.size} onClick={() => setMoving({ notes: [...picking], folders: [] })}><FolderOutput size={16} />{' '}{tr('move.mover_n', { n: picking.size })}</button>
          </>
        ) : (
          <>
            <button type="button" class="btn small icon" aria-label={tr('notemove.seleccionar_notas')} onClick={() => setPicking(new Set())}><ListChecks size={16} /></button>
            <button type="button" class="btn small" onClick={props.onNew}><FilePlus2 size={16} />{' '}{tr('notes.nota')}</button>
          </>
        )}
      </div>
      {props.data.bookmarks.length > 0 && (
        <div><div class="foot">{tr('notes.marcadores')}</div>{props.data.bookmarks.filter((b) => props.data!.notes.some((n) => n.path === b)).map((b) => link(noteMeta(b), 0))}</div>
      )}
      {tree.map((m) => (
        <div>
          <button type="button" class={`ti${over(m.materia)}`} data-drop={m.materia} aria-expanded={!closed.has(m.materia)} onClick={() => tog(m.materia)}><Folder size={16} /> <b>{m.materia}</b></button>
          {!closed.has(m.materia) && m.temas.map((t) => (
            <div>
              <button type="button" class={`ti lvl1${over(m.materia + '/' + t.tema)}${pd.drag?.item === m.materia + '/' + t.tema ? ' dragging' : ''}`} data-drop={m.materia + '/' + t.tema} aria-expanded={!closed.has(m.materia + '/' + t.tema)} onClick={() => tog(m.materia + '/' + t.tema)} {...(picking ? {} : pd.bind(m.materia + '/' + t.tema))}><ListTree size={16} /> {t.tema}</button>
              {!closed.has(m.materia + '/' + t.tema) && t.notes.map((n) => link(n, 2))}
            </div>
          ))}
        </div>
      ))}
      <div>
        <button type="button" class="ti" onClick={() => tog('__diario')}><Folder size={16} /> <b>{tr('calendar.diario')}</b> <span class="foot">{daily.length}</span></button>
        <a class="lvl1" href={href('notas', '+diaria')}>{tr('notes.hoy')}</a>
        {!closed.has('__diario') && daily.slice(0, 14).map((n) => link(n, 1))}
      </div>
      {loose.length > 0 && (
        <div>
          <button type="button" class="ti" onClick={() => tog('__loose')}><Folder size={16} /> <b>{tr('notes.sin_clasificar')}</b> <span class="foot">{loose.length}</span></button>
          {closed.has('__loose') ? null : loose.map((n) => link(n, 1))}
          <p class="foot">{tr('notes.notas_fuera_de_materia_tema_abrelas')}</p>
        </div>
      )}
      <button type="button" class="ti" onClick={() => setTrashOpen(true)}><Trash2 size={16} />{' '}{tr('notes.papelera')}</button>
      {trashOpen && <TrashSheet onClose={() => setTrashOpen(false)} />}
      {pd.ghost}
      {menu && (
        <Popover anchor={menu.el} onClose={() => setMenu(null)} label={tr('move.acciones_de', { label: menu.item.split('/').pop()!.replace(/\.md$/, '') })} class="glass strong add-menu">
          <button type="button" role="menuitem" onClick={() => { const m = menu; setMenu(null); setMoving(itemsOf(m.item)); }}><FolderOutput size={18} />{' '}{tr('move.mover_a')}</button>
          {menu.item.startsWith('notes/') && <a role="menuitem" class="add-menu-item" href={href('notas', ...menu.item.split('/').slice(1))} onClick={() => setMenu(null)}><FileText size={18} />{' '}{tr('notemove.abrir')}</a>}
        </Popover>
      )}
      {moving && <MoveNotesSheet items={moving} all={props.data.notes.map((n) => n.path)} current={props.current} onClose={() => setMoving(null)} onDone={() => setPicking(null)} />}
      {mover.sheet}
      {app.settings.showGraph && <a href={href('notas')} class="foot">{tr('notes.ver_grafo_en_la_vista_general')}</a>}
    </aside>
  );
}

function TrashSheet(props: { onClose: () => void }) {
  const app = useApp();
  const { data } = useAsync(() => trashList(app.vault), [app.version]);
  return (
    <Sheet title={tr('notes.papelera')} onClose={props.onClose}>
      {!data?.length ? <p class="t2">{tr('notes.vacia')}</p> : data.map((t) => (
        <div class="row-i"><div class="k">{t.path}<small>{new Date(t.ts).toLocaleString(locale())}</small></div>
          <button type="button" class="btn small" onClick={async () => { const p = await restore(app.vault, t.stored, t.path); app.changed(); app.toast(tr('notes.restaurada_en', { p })); }}>{tr('notes.restaurar')}</button>
        </div>
      ))}
    </Sheet>
  );
}

function NotesHome(props: { data: NotesData; onNew: () => void; ui: NotesUI; setUi: (p: Partial<NotesUI>) => void }) {
  const app = useApp();
  const [materia, setMateria] = useState('');
  const [since, setSince] = useState<'todo' | '7' | '30'>('todo');
  const [tag, setTag] = useState('');
  if (!props.data) return <p class="t2">{tr('deck.cargando')}</p>;
  const { notes, texts } = props.data;
  const now = Date.now();
  const rows = notes.filter((n) => n.materia !== DAILY).map((n) => {
    const fm = parseFrontmatter(texts.get(n.path) ?? '').data;
    return { n, fecha: typeof fm.fecha === 'string' ? fm.fecha : '', tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [] };
  }).filter((r) => (!materia || r.n.materia === materia) && (!tag || r.tags.includes(tag)) && (since === 'todo' || (r.fecha && Date.parse(r.fecha) > now - Number(since) * 86_400_000)))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  const materias = [...new Set(notes.map((n) => n.materia).filter((m) => m && m !== DAILY))];
  return (
    <section class="stack">
      <PageTitle title={tr('notes.notas')} sub={tr('notes.n_notas_materia_tema_notas', { n: notes.length })}>
        <button type="button" class="btn icon" aria-label={props.ui.explorer ? tr('notes.ocultar_explorador') : tr('notes.mostrar_explorador')} aria-pressed={props.ui.explorer} onClick={() => props.setUi({ explorer: !props.ui.explorer })}><PanelLeft size={18} /></button>
        <button type="button" class="btn" onClick={() => app.openSheet('import')}><Import size={18} />{' '}{tr('decks.importar')}</button>
        <button type="button" class="btn primary" onClick={props.onNew}><FilePlus2 size={18} />{' '}{tr('notes.nueva_nota')}</button>
      </PageTitle>
      {notes.length === 0 ? (
        <Empty icon={<FileText size={44} />} title={tr('notes.aun_no_hay_notas')} action={<button type="button" class="btn primary" onClick={props.onNew}>{tr('notes.crear_la_primera')}</button>}>{tr('notes.cada_nota_pertenece_a_una_clase')}</Empty>
      ) : (
        <section class="glass panel stack-s">
          <div class="row wrap">
            <h2 style={{ fontSize: 'var(--t-3)' }} class="grow">{tr('notes.todo')}</h2>
            <select aria-label={tr('inbox.materia')} value={materia} onChange={(e) => setMateria((e.target as HTMLSelectElement).value)}><option value="">{tr('notes.todas_las_materias')}</option>{materias.map((m) => <option>{m}</option>)}</select>
            <select aria-label={tr('notes.etiqueta')} value={tag} onChange={(e) => setTag((e.target as HTMLSelectElement).value)}><option value="">{tr('notes.todas_las_etiquetas')}</option>{app.settings.tagList.map((t) => <option>{t}</option>)}</select>
            <Segmented label={tr('exams.fecha')} value={since} onChange={setSince} options={[['todo', tr('notes.todo')], ['7', tr('notes.7_dias')], ['30', tr('notes.30_dias')]]} />
          </div>
          {rows.map((r) => <a class="kv" href={href('notas', ...r.n.path.split('/').slice(1))} style={{ textDecoration: 'none', minHeight: '44px', alignItems: 'center' }}><span class="k ellipsis"><b style={{ color: 'var(--t1)' }}>{r.n.title}</b> · {r.n.materia}{r.n.tema ? ` › ${r.n.tema}` : ''}</span><span class="v">{r.fecha}</span></a>)}
        </section>
      )}
      {app.settings.showGraph && notes.length > 0 && <section class="glass panel"><h2 style={{ fontSize: 'var(--t-3)' }}>{tr('notes.grafo')}</h2><Graph notes={notes} idx={props.data.idx} texts={props.data.texts} /></section>}
    </section>
  );
}

function NewNote(props: { notes: NoteMeta[]; onClose: () => void; initial?: { materia?: string; tema?: string; title?: string }; onCreated?: (path: string) => void }) {
  const app = useApp();
  const tree = buildTree(props.notes).tree;
  const [materia, setMateria] = useState(props.initial?.materia ?? tree[0]?.materia ?? '');
  const [tema, setTema] = useState(props.initial?.tema ?? '');
  const [title, setTitle] = useState(props.initial?.title ?? '');
  const [tpl, setTpl] = useState('Clase');
  const temas = tree.find((m) => m.materia === materia)?.temas.map((t) => t.tema) ?? [];
  return (
    <Sheet title={tr('notes.nueva_nota')} onClose={props.onClose}>
      <form class="stack" onSubmit={async (e) => {
        e.preventDefault();
        let path = notePath(materia, tema, title);
        for (let i = 2; await app.vault.exists(path); i++) path = notePath(materia, tema, `${title} (${i})`);
        await app.vault.write(path, newNoteText(materia, tema, title, tpl));
        app.changed();
        props.onClose();
        if (props.onCreated) props.onCreated(path);
        else go('notas', ...path.split('/').slice(1));
      }}>
        <label class="field">{tr('inbox.materia')}<input class="input" list="materias" required value={materia} onInput={(e) => setMateria((e.target as HTMLInputElement).value)} placeholder={tr('notes.cardiologia')} /><datalist id="materias">{tree.map((m) => <option value={m.materia} />)}</datalist></label>
        <label class="field">{tr('inbox.tema_o_clase')}<input class="input" list="temas" required value={tema} onInput={(e) => setTema((e.target as HTMLInputElement).value)} placeholder="ECG" /><datalist id="temas">{temas.map((t) => <option value={t} />)}</datalist></label>
        <label class="field">{tr('calendar.titulo')}<input class="input" required value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} placeholder={tr('notes.clase_3_bloqueos_av')} /></label>
        <fieldset class="field" style={{ border: 0, padding: 0 }}><legend>{tr('notes.plantilla')}</legend>
          <div class="bg-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
            {Object.keys(TEMPLATES).filter((t) => t !== 'Nota diaria').map((t) => (
              <button type="button" aria-pressed={tpl === t} onClick={() => setTpl(t)} style={{ aspectRatio: 'auto', padding: '10px', textAlign: 'left', minHeight: '92px' }}>
                <b>{tr(`tpl.${t.toLowerCase().replace('í', 'i').replace(/[^a-z]/g, '_')}`)}</b><div class="foot" style={{ whiteSpace: 'pre-line' }}>{TEMPLATES[t]!.match(/^## .*/gm)?.slice(0, 3).map((x) => x.slice(3)).join('\n')}</div>
              </button>
            ))}
          </div>
        </fieldset>
        <button class="btn primary" type="submit">{tr('decks.crear')}</button>
      </form>
    </Sheet>
  );
}

/** Mini-Dataview: bloque ```query``` que lista notas o tarjetas. */
function expandQueries(body: string, data: NonNullable<NotesData>, col: ReturnType<typeof useApp>['col']): string {
  return body.replace(/```query\n([\s\S]*?)```/g, (_, q: string) => {
    const query = q.trim();
    if (/deck:|is:|due:/.test(query) && col) {
      const r = searchCards(col, query).slice(0, 30);
      return tr('notes.info_n_tarjetas_query_p', { n: r.length, query: query, p: r.map((x) => `> - ${x.front.slice(0, 80)} _(${x.deck})_`).join('\n') });
    }
    const tag = /tag:(\S+)/.exec(query)?.[1];
    const mat = /materia:(\S+)/.exec(query)?.[1];
    const res = data.notes.filter((n) => {
      const fm = parseFrontmatter(data.texts.get(n.path) ?? '').data;
      const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : [];
      return (!tag || tags.includes(tag)) && (!mat || normalizeAnswer(n.materia) === normalizeAnswer(mat));
    });
    return tr('notes.info_n_notas_query_p', { n: res.length, query: query, p: res.map((n) => `> - [[${n.title}]]`).join('\n') });
  });
}

/** Bloques del cuerpo (párrafos), respetando bloques de código. */
function splitBlocks(body: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fence = false;
  for (const l of body.split('\n')) {
    if (/^```/.test(l)) fence = !fence;
    if (!fence && l.trim() === '') {
      if (cur.length) out.push(cur.join('\n'));
      cur = [];
    } else cur.push(l);
  }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}

const SLASH = (): [string, string, string][] => ([
  ['h1', tr('calendar.titulo'), '# '], ['h2', tr('notes.subtitulo'), '## '], ['ul', tr('deck.lista'), '- '], ['ol', tr('notes.lista_numerada'), '1. '], ['task', tr('notes.tarea'), '- [ ] '],
  ['table', tr('notes.tabla'), tr('notes.columna_columna')], ['quote', tr('notes.cita'), '> '], ['callout', tr('notes.callout'), tr('notes.note_titulo')],
  ['img', tr('deck.imagen'), ''], ['draw', tr('draw.dibujo_manuscrito'), ''], ['notebook', tr('draw.pagina_cuaderno'), ''], ['card', tr('notes.tarjeta_de_estudio'), ''], ['code', tr('notes.codigo'), '```\n\n```'], ['link', tr('notes.enlace_a_nota'), '[['],
]);

function NoteEditor(props: { path: string; data: NotesData; ui: NotesUI; setUi: (p: Partial<NotesUI>) => void; overlay: boolean; embedded?: boolean }) {
  const app = useApp();
  // un solo documento en memoria por nota (NoteStore): la pestaña y los paneles lo comparten
  const [text, setText] = useState<string | null>(() => noteStore.peek(props.path));
  const [mode, setMode] = useState<'doc' | 'md'>('doc');
  const [editing, setEditing] = useState<number | null>(null);
  const [tab, setTab] = useState<'outline' | 'links' | 'props' | 'graph' | 'cards' | 'events'>('outline');
  const [sheet, setSheet] = useState<'share' | 'history' | 'move' | 'prompt' | 'card' | null>(null);
  const [cardSeed, setCardSeed] = useState<{ text: string; kind: 'cloze' | 'basic'; para: number } | null>(null);
  const saver = { flush: () => noteStore.flush(props.path) };
  const [find, setFind] = useState<string | null>(() => (pendingFind.path === props.path ? ((pendingFind.path = null), pendingFind.q) : null));
  const docRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // ⌘F / Ctrl+F dentro de una nota: buscar en esta nota
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && !modalOpen()) (e.preventDefault(), setMode('doc'), setEditing(null), setFind((f) => f ?? '')); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    let alive = true;
    const un = noteStore.subscribe(app.vault, props.path, (t) => alive && setText(t));
    void noteStore.load(app.vault, props.path).then((t) => alive && setText(t));
    return () => { alive = false; un(); };
  }, [props.path]);
  useEffect(() => { void noteStore.refresh(app.vault, props.path); }, [app.version]);
  if (text === null) return <p class="t2">{tr('deck.cargando')}</p>;
  const doc = parseFrontmatter(text);
  const meta = noteMeta(props.path);
  const set = (t: string) => noteStore.set(app.vault, props.path, t);
  const setBody = (body: string) => set(stringifyFrontmatter(doc.data, body));
  const setFm = (fm: Frontmatter) => set(stringifyFrontmatter(fm, doc.body));
  const blocks = splitBlocks(doc.body);
  const cards = app.col ? [...app.col.byCid.values()].map((x) => ({ front: x.ref.note.front, back: x.ref.note.back, src: x.ref.note.src })) : [];
  const cov = coverage(doc.body, cards, props.path);
  const bookmarked = props.data?.bookmarks.includes(props.path);
  const insp = props.ui.inspector;
  const [full, setFull] = useState(() => document.body.classList.contains('notes-full'));
  const toggleFull = (on: boolean) => (setNotesFull(on), setFull(on));
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !modalOpen() && !document.querySelector('.scrim') && toggleFull(false);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [full]);
  // los botones de vista no quitan el foco al editor (se conserva el cursor y el bloque abierto)
  const keep = { onPointerDown: (e: PointerEvent) => e.preventDefault(), onMouseDown: (e: MouseEvent) => e.preventDefault() };
  return (
    <>
      <section class="stack-s" style={{ minWidth: 0 }}>
        <div class="row wrap glass panel" style={{ justifyContent: 'space-between' }}>
          <div>
            <div class="foot">{meta.materia}{meta.tema ? ` › ${meta.tema}` : ''}</div>
            <h1 style={{ fontSize: 'var(--t-1)', fontWeight: 700 }}>{meta.title}</h1>
            <div class="foot">{tr('calendar.cards_tarjetas', { cards: cov.cards })}{' '}{cov.total ? tr('notes.p_de_parrafos_cubiertos', { p: Math.round((cov.covered.length / cov.total) * 100) }) : tr('notes.sin_parrafos')}</div>
          </div>
          <div class="row wrap">
            {!props.embedded && <button type="button" class="btn icon" {...keep} aria-label={props.ui.explorer ? tr('notes.ocultar_explorador') : tr('notes.mostrar_explorador')} aria-pressed={props.ui.explorer} onClick={() => props.setUi({ explorer: !props.ui.explorer })}><PanelLeft size={18} /></button>}
            <button type="button" class="btn icon" {...keep} aria-label={insp ? tr('notes.ocultar_inspector') : tr('notes.mostrar_inspector')} aria-pressed={insp} onClick={() => props.setUi({ inspector: !insp })}><PanelRight size={18} /></button>
            <div {...keep}><Segmented label={tr('notes.ancho_de_linea')} value={props.ui.width} onChange={(w) => props.setUi({ width: w })} options={[['comodo', tr('notes.comodo')], ['ancho', tr('notes.ancho')], ['completo', tr('notes.completo')]]} /></div>
            {!props.embedded && <button type="button" class="btn icon" {...keep} aria-label={full ? tr('notes.salir_de_pantalla_completa') : tr('notes.pantalla_completa_de_notas')} aria-pressed={full} onClick={() => toggleFull(!full)}>{full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>}
            <Segmented label={tr('calendar.vista')} value={mode} onChange={(m) => (setMode(m), setEditing(null))} options={[['doc', tr('notes.documento')], ['md', tr('deck.ver_markdown')]]} />
            <button type="button" class="btn icon" aria-label={bookmarked ? tr('notes.quitar_marcador') : tr('notes.marcar')} aria-pressed={bookmarked} onClick={async () => { const b = props.data?.bookmarks ?? []; await app.vault.write(BOOKMARKS, JSON.stringify(bookmarked ? b.filter((x) => x !== props.path) : [...b, props.path])); app.changed(); }}>{bookmarked ? <Star size={18} fill="currentColor" /> : <Bookmark size={18} />}</button>
            <button type="button" class="btn icon" aria-label={tr('find.buscar_en_esta_nota')} aria-pressed={find !== null} onClick={() => (setMode('doc'), setEditing(null), setFind(find === null ? '' : null))}><Search size={18} /></button>
            <button type="button" class="btn icon" aria-label={tr('notes.crear_tarjetas_con_ia_copiar_prompt')} onClick={() => setSheet('prompt')}><Sparkles size={18} /></button>
            <button type="button" class="btn icon" aria-label={tr('notes.historial_de_versiones')} onClick={() => setSheet('history')}><History size={18} /></button>
            <button type="button" class="btn icon" aria-label={tr('notes.mover_a_otra_materia_o_tema')} onClick={() => setSheet('move')}><MoveRight size={18} /></button>
            <button type="button" class="btn icon" aria-label={tr('notes.compartir_o_exportar')} onClick={() => setSheet('share')}><Share size={18} /></button>
            <button type="button" class="btn icon" aria-label={tr('notes.enviar_a_la_papelera')} onClick={async () => { if (!confirm(tr('notes.confirm_papelera'))) return; await saver.flush(); await trash(app.vault, props.path); await noteStore.forget(props.path); app.changed(); if (!props.embedded) go('notas'); }}><Trash2 size={18} /></button>
          </div>
        </div>
        {find !== null && <FindBar root={() => docRef.current} initial={find} dep={text + mode} onClose={() => setFind(null)} />}
        <article class="glass strong doc" ref={docRef} onPaste={(e) => void onPaste(e as ClipboardEvent)}>
          <div class="print-only"><h1>{meta.title}</h1></div>
          <div class="doc-inner" style={{ maxWidth: LINE[props.ui.width] }}>
          {mode === 'md' ? (
            <textarea class="input code" style={{ minHeight: '70dvh', width: '100%', border: 0, background: 'transparent' }} value={text} onInput={(e) => set((e.target as HTMLTextAreaElement).value)} aria-label={tr('notes.markdown_de_la_nota')} spellcheck />
          ) : (
            <div class="stack-s">
              {/* «＋ Escribe…» abre un bloque vacío al final (en la misma lista, para no perder el foco) */}
              {(editing === blocks.length ? [...blocks, ''] : blocks).map((b, i) => (editing === i ? (
                <BlockInput key={i} value={b} notes={props.data?.notes ?? []} onChange={(v) => setBody([...blocks.slice(0, i), v, ...blocks.slice(i + 1)].join('\n\n'))}
                  onDone={() => setEditing(null)} onSplit={(a, rest) => { setBody([...blocks.slice(0, i), a, rest, ...blocks.slice(i + 1)].join('\n\n')); setEditing(i + 1); }}
                  onCard={(sel, kind) => { setCardSeed({ text: sel, kind, para: i }); setSheet('card'); }}
                  onImage={async (f) => { const name = await saveImage(app.vault, f, f.name); setBody([...blocks.slice(0, i + 1), `![[${name}]]`, ...blocks.slice(i + 1)].join('\n\n')); }}
                  onSlashCard={() => { setCardSeed({ text: '', kind: 'basic', para: i }); setSheet('card'); }}
                  onDraw={async (notebook) => { const id = await createDrawing(app.vault, notebook ? 'rayado' : undefined); /* texto vigente (el «/dibujo» ya se quitó) */ const all = splitBlocks(parseFrontmatter(noteStore.peek(props.path) ?? text).body); setBody([...all.slice(0, i + 1), `![[${id}.png]]`, ...all.slice(i + 1)].join('\n\n')); setEditing(null); }} />
              ) : DRAW_RE.test(b.trim()) ? (
                <DrawingBlock key={`d${i}`} id={DRAW_RE.exec(b.trim())![1]!} />
              ) : (
                <div key={i} role="button" tabIndex={0} onClick={(e) => { if ((e.target as HTMLElement).closest('a, summary, audio, input')) return; setEditing(i); }} onKeyDown={(e) => e.key === 'Enter' && setEditing(i)} style={{ cursor: 'text', borderRadius: '10px' }} aria-label={tr('notes.editar_bloque')}>
                  <Html html={renderMarkdown(props.data ? expandQueries(b, props.data, app.col) : b)} />
                </div>
              )))}
              <button type="button" class="btn ghost" style={{ justifySelf: 'start' }} onClick={() => setEditing(blocks.length)}>{tr('notes.escribe_o_usa_para_insertar')}</button>
            </div>
          )}
          </div>
        </article>
      </section>
      {full && <button type="button" class="btn glass strong notes-exit" {...keep} onClick={() => toggleFull(false)}><Minimize2 size={18} />{' '}{tr('notes.salir_de_pantalla_completa')}</button>}
      {insp && (
        <aside class={`glass panel insp stack-s${props.overlay ? ' insp-over strong' : ''}`} aria-label={tr('notes.inspector')}>
          {props.overlay && <button type="button" class="btn small" style={{ justifySelf: 'end' }} {...keep} onClick={() => props.setUi({ inspector: false })}>{tr('notes.cerrar_inspector')}</button>}
          <div class="seg" role="tablist" aria-label={tr('notes.panel')}>
            {([['outline', tr('notes.esquema')], ...(app.settings.showBacklinks ? [['links', tr('notes.enlaces')]] : []), ['props', tr('notes.propiedades')], ['cards', tr('heatmap.tarjetas')], ['events', tr('notes.eventos')], ...(app.settings.showGraph ? [['graph', tr('notes.grafo')]] : [])] as [typeof tab, string][]).map(([k, l]) => <button type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          {tab === 'outline' && (outline(doc.body).map((h) => <div style={{ paddingLeft: `${(h.level - 1) * 12}px` }} class="note">{h.text}</div>) || null)}
          {tab === 'outline' && !outline(doc.body).length && <p class="t2 note">{tr('notes.sin_titulos')}</p>}
          {tab === 'links' && props.data && <Links path={props.path} title={meta.title} data={props.data} />}
          {tab === 'props' && <Properties fm={doc.data} onChange={setFm} />}
          {tab === 'events' && <><b class="note">{tr('notes.eventos_vinculados')}</b><LinkedEvents path={props.path} /></>}
          {tab === 'graph' && props.data && <Graph notes={props.data.notes} idx={props.data.idx} texts={props.data.texts} focus={props.path} />}
          {tab === 'cards' && (
            <div class="stack-s">
              <p class="note">{tr('notes.cards_tarjetas_vienen_de_esta_nota', { cards: cov.cards })}</p>
              {cov.uncovered.length > 0 && <><b class="note">{tr('notes.parrafos_sin_cubrir')}</b>{cov.uncovered.slice(0, 8).map((p) => <button type="button" class="opt note" style={{ fontSize: 'var(--t-note)' }} onClick={() => { setCardSeed({ text: p.text, kind: 'basic', para: p.idx }); setSheet('card'); }}>{p.text.slice(0, 120)}…</button>)}</>}
              <button type="button" class="btn small" onClick={() => setSheet('prompt')}><ClipboardCopy size={16} />{' '}{tr('notes.copiar_prompt')}</button>
            </div>
          )}
        </aside>
      )}
      {sheet === 'share' && <ShareNote path={props.path} title={meta.title} text={text} onClose={() => setSheet(null)} />}
      {sheet === 'history' && <HistorySheet path={props.path} onRestore={(t) => (set(t), setSheet(null))} onClose={() => setSheet(null)} />}
      {sheet === 'move' && props.data && <MoveNotesSheet items={{ notes: [props.path], folders: [] }} all={props.data.notes.map((n) => n.path)} current={props.embedded ? null : props.path} onClose={() => setSheet(null)} />}
      {sheet === 'prompt' && <PromptSheet path={props.path} title={meta.title} body={doc.body} onClose={() => setSheet(null)} />}
      {sheet === 'card' && cardSeed && <CardFromNote seed={cardSeed} path={props.path} paraIdx={paragraphs(doc.body).find((p) => p.text.includes(cardSeed.text.slice(0, 40)))?.idx ?? cardSeed.para} onClose={() => setSheet(null)} />}
    </>
  );

  async function onPaste(e: ClipboardEvent) {
    const dt = e.clipboardData;
    if (!dt) return;
    const img = [...dt.files].find((f) => f.type.startsWith('image/'));
    const html = dt.getData('text/html');
    const plain = dt.getData('text/plain');
    if (img) {
      e.preventDefault();
      const name = await saveImage(app.vault, img, 'pegado');
      insertAtCursor(`![[${name}]]`);
    } else if (html && /<(p|table|h\d|ul|ol|b|strong|span)[\s>]/i.test(html) && /mso-|Word|Pages|docs-internal/i.test(html + plain) || (html && html.length > plain.length * 3 && /<table/i.test(html))) {
      e.preventDefault();
      insertAtCursor(await htmlToMarkdown(html));
      app.toast(tr('notes.pegado_desde_documento_formato_convertido_'));
    } else if (/^https?:\/\/\S+$/.test(plain.trim())) {
      e.preventDefault();
      const url = plain.trim();
      const title = prompt(tr('notes.titulo_enlace_prompt'), new URL(url).hostname) ?? url;
      insertAtCursor(`[${title}](${url})`);
    }
  }
  function insertAtCursor(s: string) {
    const ta = document.activeElement as HTMLTextAreaElement | null;
    if (ta?.tagName === 'TEXTAREA') {
      const [a, b] = [ta.selectionStart, ta.selectionEnd];
      ta.setRangeText(s, a, b, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    } else setBody(doc.body.replace(/\s*$/, '') + '\n\n' + s);
  }
}

function BlockInput(p: { value: string; notes: NoteMeta[]; onChange: (v: string) => void; onDone: () => void; onSplit: (a: string, b: string) => void; onCard: (sel: string, kind: 'cloze' | 'basic') => void; onImage: (f: File) => void; onSlashCard: () => void; onDraw: (notebook: boolean) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [sel, setSel] = useState('');
  const [slash, setSlash] = useState<number | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pick, setPick] = useState(0);
  const imgInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.focus();
    t.style.height = 'auto';
    t.style.height = `${t.scrollHeight + 4}px`;
  }, []);
  const grow = () => { const t = ref.current!; t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 4}px`; };
  const wrap = (a: string, b = a) => {
    const t = ref.current!;
    const [s, e] = [t.selectionStart, t.selectionEnd];
    const v = t.value.slice(0, s) + a + t.value.slice(s, e) + b + t.value.slice(e);
    p.onChange(v);
    requestAnimationFrame(() => t.setSelectionRange(s + a.length, e + a.length));
  };
  const onInput = () => {
    const t = ref.current!;
    p.onChange(t.value);
    grow();
    const before = t.value.slice(0, t.selectionStart);
    const sl = /(^|\n)\/(\w*)$/.exec(before);
    setSlash(sl ? before.length - sl[0].length + sl[1]!.length : null);
    const wl = /\[\[([^\]\n]*)$/.exec(before);
    setLink(wl ? wl[1]! : null);
    setPick(0);
  };
  const slashItems = slash !== null ? SLASH().filter(([, l]) => normalizeAnswer(l).startsWith(normalizeAnswer(ref.current!.value.slice(slash + 1, ref.current!.selectionStart)))) : [];
  const linkItems = link !== null ? p.notes.filter((n) => normalizeAnswer(n.title).includes(normalizeAnswer(link))).slice(0, 8) : [];
  const applySlash = (k: string) => {
    const t = ref.current!;
    const item = SLASH().find((x) => x[0] === k)!;
    const v = t.value.slice(0, slash!) + item[2] + t.value.slice(t.selectionStart);
    setSlash(null);
    p.onChange(v);
    if (k === 'img') imgInput.current?.click();
    if (k === 'card') p.onSlashCard();
    if (k === 'draw' || k === 'notebook') p.onDraw(k === 'notebook');
    requestAnimationFrame(() => (t.focus(), t.setSelectionRange(slash! + item[2].length, slash! + item[2].length)));
  };
  const applyLink = (title: string) => {
    const t = ref.current!;
    const start = t.value.slice(0, t.selectionStart).lastIndexOf('[[');
    const v = t.value.slice(0, start) + `[[${title}]]` + t.value.slice(t.selectionStart);
    setLink(null);
    p.onChange(v);
  };
  return (
    <div style={{ position: 'relative' }}>
      {sel && (
        <div class="row wrap glass" style={{ padding: '4px', borderRadius: '14px', marginBottom: '6px' }} role="toolbar" aria-label={tr('notes.formato')}>
          <button type="button" class="btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('**')}><b>N</b></button>
          <button type="button" class="btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('==')}>{tr('notes.resaltar')}</button>
          <select aria-label={tr('notes.color_2')} onChange={(e) => { const c = (e.target as HTMLSelectElement).value; if (c) wrap('[', `]{.${c}}`); (e.target as HTMLSelectElement).value = ''; }}><option value="">{tr('notes.color')}</option>{['azul', 'verde', 'naranja', 'rojo', 'morado', 'turquesa', 'rosa', 'amarillo'].map((c) => <option value={c}>{c}</option>)}</select>
          <button type="button" class="btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('[[', ']]')}><Link2 size={14} />{' '}{tr('notes.enlazar_a_nota')}</button>
          <button type="button" class="btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => p.onCard(sel, 'cloze')}>{tr('notes.crear_cloze')}</button>
          <button type="button" class="btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => p.onCard(sel, 'basic')}>{tr('notes.crear_basica')}</button>
        </div>
      )}
      <textarea ref={ref} class="input" style={{ width: '100%', minHeight: '44px', fontSize: '1.0625rem', lineHeight: 1.5, background: 'var(--fill-2)' }} value={p.value}
        onInput={onInput} onBlur={() => setTimeout(() => !ref.current?.matches(':focus') && slash === null && link === null && p.onDone(), 200)}
        onSelect={() => { const t = ref.current!; setSel(t.value.slice(t.selectionStart, t.selectionEnd)); }}
        onKeyDown={(e) => {
          const items = slash !== null ? slashItems.length : link !== null ? linkItems.length + 1 : 0;
          if (items && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) return e.preventDefault(), setPick((x) => (x + (e.key === 'ArrowDown' ? 1 : items - 1)) % items);
          if (items && e.key === 'Enter') { e.preventDefault(); if (slash !== null) applySlash(slashItems[pick]![0]); else applyLink(linkItems[pick]?.title ?? link!); return; }
          if (e.key === 'Escape') return setSlash(null), setLink(null), p.onDone();
          const t = ref.current!;
          if (e.key === 'Enter' && !e.shiftKey && t.value.slice(0, t.selectionStart).endsWith('\n') && !/^(\||```|-|\d+\.|>)/m.test(t.value.split('\n').pop() ?? '')) {
            e.preventDefault();
            p.onSplit(t.value.slice(0, t.selectionStart).replace(/\n$/, ''), t.value.slice(t.selectionStart) || '');
          }
        }} aria-label={tr('notes.editar_bloque_escribe_para_insertar')} />
      {slash !== null && slashItems.length > 0 && (
        <Popover anchor={ref.current} onClose={() => setSlash(null)} role="listbox" class="slash" label={tr('notes.editar_bloque_escribe_para_insertar')}>{slashItems.map(([k, l], i) => <button type="button" role="option" class={i === pick ? 'on' : ''} aria-selected={i === pick} onMouseDown={(e) => e.preventDefault()} onClick={() => applySlash(k)}>{k === 'code' ? <Code size={16} /> : null}{l}</button>)}</Popover>
      )}
      {link !== null && (
        <Popover anchor={ref.current} onClose={() => setLink(null)} role="listbox" class="slash" label={tr('notes.enlazar_a_nota')}>
          {linkItems.map((n, i) => <button type="button" role="option" class={i === pick ? 'on' : ''} aria-selected={i === pick} onMouseDown={(e) => e.preventDefault()} onClick={() => applyLink(n.title)}>{n.title} <span class="foot">{n.materia}</span></button>)}
          <button type="button" role="option" class={pick === linkItems.length ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => applyLink(link || tr('notes.nueva_nota'))}>{tr('notes.crear_nota')}{link || tr('notes.nueva_nota')}»</button>
        </Popover>
      )}
      <input ref={imgInput} type="file" accept="image/*" hidden onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) p.onImage(f); }} />
    </div>
  );
}

function Links(p: { path: string; title: string; data: NonNullable<NotesData> }) {
  const back = p.data.idx.backlinks.get(p.path) ?? [];
  const unlinked = unlinkedMentions(p.title, p.path, p.data.texts);
  const l = (x: string) => <a class="note" style={{ display: 'block', minHeight: '32px' }} href={href('notas', ...x.split('/').slice(1))}>{noteMeta(x).title}</a>;
  return (
    <div class="stack-s">
      <b class="note">{tr('notes.enlaces_entrantes_n', { n: back.length })}</b>{back.map(l)}
      <b class="note">{tr('notes.menciones_sin_enlazar_n', { n: unlinked.length })}</b>{unlinked.map(l)}
    </div>
  );
}

function Properties(p: { fm: Frontmatter; onChange: (fm: Frontmatter) => void }) {
  const app = useApp();
  const tags = Array.isArray(p.fm.tags) ? p.fm.tags.map(String) : [];
  const decks = Array.isArray(p.fm.mazos) ? p.fm.mazos.map(String) : [];
  const set = (k: string, v: Frontmatter[string] | null) => { const n = { ...p.fm }; if (v === null || v === '') delete n[k]; else n[k] = v; p.onChange(n); };
  return (
    <div class="stack-s">
      <label class="field">{tr('exams.fecha')}<input class="input" type="date" value={typeof p.fm.fecha === 'string' ? p.fm.fecha : ''} onChange={(e) => set('fecha', (e.target as HTMLInputElement).value)} /></label>
      <div class="field">{tr('deck.etiquetas')}<div class="row wrap">{tags.map((t) => <button type="button" class="chip" onClick={() => set('tags', tags.filter((x) => x !== t))} aria-label={tr('notes.quitar_t', { t: t })}>#{t} ✕</button>)}</div>
        <select aria-label={tr('notes.anadir_etiqueta')} value="" onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) set('tags', [...tags, v]); }}><option value="">{tr('notes.anadir')}</option>{app.settings.tagList.filter((t) => !tags.includes(t)).map((t) => <option>{t}</option>)}</select>
        {!app.settings.tagList.length && <span class="foot">{tr('notes.crea_etiquetas_en_ajustes_notas_lista')}</span>}
      </div>
      <div class="field">{tr('notes.mazos_relacionados')}<div class="row wrap">{decks.map((d) => <button type="button" class="chip" onClick={() => set('mazos', decks.filter((x) => x !== d))}>{d} ✕</button>)}</div>
        <select aria-label={tr('notes.anadir_mazo')} value="" onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) set('mazos', [...decks, v]); }}><option value="">{tr('notes.anadir')}</option>{app.col?.decks.map((d) => <option>{d.full}</option>)}</select>
      </div>
      {Object.entries(p.fm).filter(([k]) => !['fecha', 'tags', 'mazos', 'materia', 'tema', 'id'].includes(k)).map(([k, v]) => (
        <label class="field">{k}<input class="input" value={Array.isArray(v) ? v.join(', ') : String(v ?? '')} onChange={(e) => set(k, (e.target as HTMLInputElement).value)} /></label>
      ))}
    </div>
  );
}

function ShareNote(p: { path: string; title: string; text: string; onClose: () => void }) {
  const app = useApp();
  const [links, setLinks] = useState(false);
  const [colors, setColors] = useState<'keep' | 'html' | 'plain'>('keep');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const prep = async (kind: 'md' | 'docx') => {
    setBusy(true);
    try {
      const md = compatibleMarkdown(p.text, { links, colors });
      if (kind === 'docx') {
        const blob = await markdownToDocx(p.text, p.title, async (n) => { const r = await resolveMedia(app.vault, n); return r ? app.vault.read(r) : null; });
        return setFile(new File([blob], `${p.title}.docx`, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      }
      const media = mediaRefs(p.text);
      if (!media.length) return setFile(new File([md], `${p.title}.md`, { type: 'text/markdown' }));
      const files: { path: string; data: Uint8Array }[] = [{ path: `${p.title}.md`, data: new TextEncoder().encode(md) }];
      for (const m of media) { const r = await resolveMedia(app.vault, m); if (r) files.push({ path: r, data: await app.vault.read(r) }); }
      setFile(new File([(await buildZip(files, APP_VERSION)) as BlobPart], `${p.title}.zip`, { type: 'application/zip' }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={tr('notes.compartir_nota')} onClose={p.onClose}>
      <div class="stack">
        <label class="row"><input type="checkbox" checked={links} onChange={(e) => setLinks((e.target as HTMLInputElement).checked)} />{' '}{tr('notes.enlaces_compatibles_convertir_wikilinks_a_')}</label>
        <Segmented label={tr('notes.colores')} value={colors} onChange={setColors} options={[['keep', tr('notes.conservar_color')], ['html', tr('notes.como_html')], ['plain', tr('calendar.quitar')]]} />
        <div class="row wrap">
          <button type="button" class="btn" disabled={busy} onClick={() => prep('md')}>{tr('notes.preparar_md')}{mediaRefs(p.text).length ? tr('notes.zip_con_medios') : ''}</button>
          <button type="button" class="btn" disabled={busy} onClick={() => prep('docx')}>{tr('notes.preparar_docx')}</button>
          <button type="button" class="btn" onClick={() => { p.onClose(); setTimeout(() => window.print(), 300); }}>{tr('notes.pdf_imprimir')}</button>
        </div>
        {file && <button type="button" class="btn primary" onClick={async () => { const r = await deliver(file); if (r !== 'cancelled') (app.toast(tr('notes.nota_exportada')), p.onClose()); }}><Share size={18} />{' '}{tr('notes.guardar_name', { name: file.name })}</button>}
        <p class="foot">{tr('notes.pdf_en_la_vista_de_impresion')}</p>
      </div>
    </Sheet>
  );
}

function HistorySheet(p: { path: string; onRestore: (t: string) => void; onClose: () => void }) {
  const app = useApp();
  const { data } = useAsync(() => versions(app.vault, p.path), [p.path]);
  const [view, setView] = useState<{ ts: number; text: string } | null>(null);
  return (
    <Sheet title={tr('notes.historial_de_versiones')} onClose={p.onClose} wide>
      <div class="grid phone-stack" style={{ gridTemplateColumns: '220px minmax(0,1fr)' }}>
        <div class="stack-s">{data?.length ? data.map((ts) => <button type="button" class={`btn small${view?.ts === ts ? ' primary' : ''}`} onClick={async () => setView({ ts, text: await readVersion(app.vault, p.path, ts) })}>{new Date(ts).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' })}</button>) : <p class="t2">{tr('notes.sin_instantaneas_aun_se_guardan_cada')}</p>}</div>
        <div class="stack-s">{view && (<><pre class="preview">{view.text}</pre><button type="button" class="btn primary" onClick={() => p.onRestore(view.text)}>{tr('notes.restaurar_esta_version')}</button></>)}</div>
      </div>
    </Sheet>
  );
}

/** Tarjetas desde notas — modo B "Copiar prompt": se copia, se pega la respuesta y se revisa una por una. */
export function PromptSheet(p: { path: string; title: string; body: string; onClose: () => void; onAccepted?: (n: number) => void }) {
  const app = useApp();
  const [resp, setResp] = useState('');
  const [items, setItems] = useState<{ block: string; ok: boolean; errors: string[]; state: 'pending' | 'accepted' | 'discarded' }[] | null>(null);
  const [deck, setDeck] = useState(app.col?.decks[0]?.path ?? '');
  const copy = async () => {
    const t = buildPrompt(p.title, p.body);
    try {
      await navigator.clipboard.writeText(t);
      app.toast(tr('notes.prompt_copiado_pegalo_en_tu_herramienta'));
    } catch {
      setResp(t);
      app.toast(tr('notes.no_se_pudo_copiar_selecciona_el'));
    }
  };
  return (
    <Sheet title={tr('notes.tarjetas_desde_la_nota')} onClose={p.onClose} wide>
      <div class="stack">
        <ol class="note" style={{ margin: 0 }}>
          <li>{tr('notes.copia_el_prompt_y_pegalo_en')}</li>
          <li>{tr('notes.pega_aqui_la_respuesta_la_app')}</li>
          <li>{tr('notes.revisa_cada_tarjeta_aceptar_editar_o')}{' '}<b>{tr('notes.nada_se_agrega_sin_tu_revision')}</b>{' '}{tr('notes.contenido_medico_puede_haber_errores')}</li>
        </ol>
        <div class="row wrap">
          <button type="button" class="btn primary" onClick={copy}><ClipboardCopy size={18} />{' '}{tr('notes.copiar_prompt')}</button>
          <button type="button" class="btn" onClick={async () => { try { setResp(await navigator.clipboard.readText()); } catch { app.toast(tr('notes.pega_con_cmd_v')); } }}><ClipboardPaste size={18} />{' '}{tr('notes.pegar_respuesta')}</button>
        </div>
        <textarea class="input code" style={{ minHeight: '18dvh' }} value={resp} onInput={(e) => setResp((e.target as HTMLTextAreaElement).value)} placeholder={'Q:: …\nA:: …\n\nCloze: …{{c1::…}}'} aria-label={tr('notes.respuesta_de_la_ia')} />
        <button type="button" class="btn" disabled={!resp.trim()} onClick={() => setItems(parseAiResponse(resp).map((x) => ({ ...x, state: 'pending' as const })))}>{tr('notes.validar_y_revisar')}</button>
        {items && (
          <>
            <label class="field">{tr('notes.mazo_de_destino')}<select value={deck} onChange={(e) => setDeck((e.target as HTMLSelectElement).value)}>{app.col?.decks.map((d) => <option value={d.path}>{d.full}</option>)}</select></label>
            {items.map((it, i) => {
              const n = parseDeck(it.block + ' ^vista').notes[0];
              return (
                <div class="inset stack-s" style={{ padding: '10px', borderRadius: 'var(--r-row)', opacity: it.state === 'discarded' ? 0.38 : 1 }}>
                  <span class="chip">{tr('notes.origen_ia')}</span>
                  {n && <NotePreview note={n} />}
                  <textarea class="input code" rows={3} value={it.block} onInput={(e) => setItems(items.map((x, k) => (k === i ? { ...x, block: (e.target as HTMLTextAreaElement).value, ok: !parseDeck((e.target as HTMLTextAreaElement).value + ' ^v').notes[0]?.errors.length } : x)))} aria-label={tr('notes.editar_tarjeta')} />
                  <div class="row">
                    <button type="button" class="btn small primary" disabled={!it.ok || it.state !== 'pending' || !deck} onClick={async () => { await appendCard(app.vault, deck, withOrigin(it.block, p.path, true), app.col); setItems(items.map((x, k) => (k === i ? { ...x, state: 'accepted' } : x))); }}>{it.state === 'accepted' ? tr('notes.aceptada') : tr('notes.aceptar')}</button>
                    <button type="button" class="btn small" disabled={it.state !== 'pending'} onClick={() => setItems(items.map((x, k) => (k === i ? { ...x, state: 'discarded' } : x)))}>{tr('notes.descartar')}</button>
                  </div>
                </div>
              );
            })}
            <button type="button" class="btn primary" onClick={() => { const n = items.filter((x) => x.state === 'accepted').length; app.changed(); p.onAccepted?.(n); p.onClose(); }}>{tr('notes.listo_n_aceptadas', { n: items.filter((x) => x.state === 'accepted').length })}</button>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Modo A: seleccionar texto → cloze o básica → elegir mazo (src apunta al párrafo). */
function CardFromNote(p: { seed: { text: string; kind: 'cloze' | 'basic' }; path: string; paraIdx: number; onClose: () => void }) {
  const app = useApp();
  const [deck, setDeck] = useState(app.col?.decks[0]?.path ?? '');
  const [front, setFront] = useState(p.seed.kind === 'cloze' ? `{{c1::${p.seed.text}}}` : p.seed.text);
  const [back, setBack] = useState('');
  const block = p.seed.kind === 'cloze' ? tr('deck.cloze_p', { p: front.replace(/\n\s*\n/g, '\n') }) : `Q:: ${front.replace(/\n\s*\n/g, '\n')}\nA:: ${back.replace(/\n\s*\n/g, '\n')}`;
  const n = parseDeck(block + ' ^vista').notes[0];
  return (
    <Sheet title={p.seed.kind === 'cloze' ? tr('notes.crear_cloze') : tr('notes.crear_basica')} onClose={p.onClose}>
      <form class="stack" onSubmit={async (e) => { e.preventDefault(); await appendCard(app.vault, deck, withOrigin(block, `${p.path}#p${p.paraIdx}`, false), app.col); app.changed(); app.toast(tr('notes.tarjeta_creada_origen')); p.onClose(); }}>
        <label class="field">{tr('deck.mazo')}<select value={deck} onChange={(e) => setDeck((e.target as HTMLSelectElement).value)}>{app.col?.decks.map((d) => <option value={d.path}>{d.full}</option>)}</select></label>
        <label class="field">{p.seed.kind === 'cloze' ? tr('notes.texto_amplia_el_contexto_alrededor_del') : tr('deck.pregunta')}<textarea class="input" rows={3} value={front} onInput={(e) => setFront((e.target as HTMLTextAreaElement).value)} /></label>
        {p.seed.kind === 'basic' && <label class="field">{tr('deck.respuesta')}<textarea class="input" rows={2} required value={back} onInput={(e) => setBack((e.target as HTMLTextAreaElement).value)} /></label>}
        {n && <NotePreview note={n} />}
        <button class="btn primary" type="submit" disabled={!deck || !!n?.errors.length}>{tr('notes.anadir_2')}</button>
      </form>
    </Sheet>
  );
}

export { addDays };
