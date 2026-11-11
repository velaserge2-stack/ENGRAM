import { Bookmark, ClipboardCopy, ClipboardPaste, Code, FilePlus2, FileText, Folder, History, Import, Link2, ListTree, MoveRight, Network, Share, Sparkles, Star, Trash2 } from 'lucide-preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { normalizeAnswer, parseDeck } from '../cards/parse';
import { appendCard } from '../data/ops';
import { deliver } from '../io/share';
import { buildZip } from '../io/zip';
import { createAutosave } from '../lib/autosave';
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

const BOOKMARKS = '.app/bookmarks.json';

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
  return (
    <>
      <div class={`notes${resolved && (s.showBacklinks || true) ? '' : ' no-insp'}`}>
        <NoteTree data={data} current={resolved} onNew={() => setCreating(true)} />
        {resolved ? <NoteEditor key={resolved} path={resolved} data={data} /> : <NotesHome data={data} onNew={() => setCreating(true)} />}
      </div>
      {creating && data && <NewNote notes={data.notes} onClose={() => setCreating(false)} />}
    </>
  );
}

type NotesData = ReturnType<typeof useNotes>['data'];

function NoteTree(props: { data: NotesData; current: string | null; onNew: () => void }) {
  const app = useApp();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [trashOpen, setTrashOpen] = useState(false);
  if (!props.data) return <aside class="glass panel tree"><p class="t2">Cargando…</p></aside>;
  const { tree, loose, daily } = buildTree(props.data.notes);
  const tog = (k: string) => setClosed((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const link = (n: NoteMeta, lvl: number) => (
    <a class={`lvl${lvl}`} href={href('notas', ...n.path.split('/').slice(1))} aria-current={props.current === n.path ? 'page' : undefined}><FileText size={16} /> <span class="ellipsis">{n.title}</span></a>
  );
  return (
    <aside class="glass panel tree stack-s" aria-label="Materias y notas">
      <div class="row"><b class="grow">Materias</b><button type="button" class="btn small" onClick={props.onNew}><FilePlus2 size={16} /> Nota</button></div>
      {props.data.bookmarks.length > 0 && (
        <div><div class="foot">Marcadores</div>{props.data.bookmarks.filter((b) => props.data!.notes.some((n) => n.path === b)).map((b) => link(noteMeta(b), 0))}</div>
      )}
      {tree.map((m) => (
        <div>
          <button type="button" class="ti" aria-expanded={!closed.has(m.materia)} onClick={() => tog(m.materia)}><Folder size={16} /> <b>{m.materia}</b></button>
          {!closed.has(m.materia) && m.temas.map((t) => (
            <div>
              <button type="button" class="ti lvl1" aria-expanded={!closed.has(m.materia + '/' + t.tema)} onClick={() => tog(m.materia + '/' + t.tema)}><ListTree size={16} /> {t.tema}</button>
              {!closed.has(m.materia + '/' + t.tema) && t.notes.map((n) => link(n, 2))}
            </div>
          ))}
        </div>
      ))}
      <div>
        <button type="button" class="ti" onClick={() => tog('__diario')}><Folder size={16} /> <b>Diario</b> <span class="foot">{daily.length}</span></button>
        <a class="lvl1" href={href('notas', '+diaria')}>＋ Hoy</a>
        {!closed.has('__diario') && daily.slice(0, 14).map((n) => link(n, 1))}
      </div>
      {loose.length > 0 && (
        <div>
          <button type="button" class="ti" onClick={() => tog('__loose')}><Folder size={16} /> <b>Sin clasificar</b> <span class="foot">{loose.length}</span></button>
          {closed.has('__loose') ? null : loose.map((n) => link(n, 1))}
          <p class="foot">Notas fuera de Materia → Tema. Ábrelas y usa «Mover», o envíalas a la Bandeja.</p>
        </div>
      )}
      <button type="button" class="ti" onClick={() => setTrashOpen(true)}><Trash2 size={16} /> Papelera</button>
      {trashOpen && <TrashSheet onClose={() => setTrashOpen(false)} />}
      {app.settings.showGraph && <a href={href('notas')} class="foot">Ver grafo en la vista general</a>}
    </aside>
  );
}

function TrashSheet(props: { onClose: () => void }) {
  const app = useApp();
  const { data } = useAsync(() => trashList(app.vault), [app.version]);
  return (
    <Sheet title="Papelera" onClose={props.onClose}>
      {!data?.length ? <p class="t2">Vacía.</p> : data.map((t) => (
        <div class="row-i"><div class="k">{t.path}<small>{new Date(t.ts).toLocaleString('es-MX')}</small></div>
          <button type="button" class="btn small" onClick={async () => { const p = await restore(app.vault, t.stored, t.path); app.changed(); app.toast(`Restaurada en ${p}`); }}>Restaurar</button>
        </div>
      ))}
    </Sheet>
  );
}

function NotesHome(props: { data: NotesData; onNew: () => void }) {
  const app = useApp();
  const [materia, setMateria] = useState('');
  const [since, setSince] = useState<'todo' | '7' | '30'>('todo');
  const [tag, setTag] = useState('');
  if (!props.data) return <p class="t2">Cargando…</p>;
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
      <PageTitle title="Notas" sub={`${notes.length} notas · Materia → Tema → Notas`}>
        <button type="button" class="btn" onClick={() => app.openSheet('import')}><Import size={18} /> Importar</button>
        <button type="button" class="btn primary" onClick={props.onNew}><FilePlus2 size={18} /> Nueva nota</button>
      </PageTitle>
      {notes.length === 0 ? (
        <Empty icon={<FileText size={44} />} title="Aún no hay notas" action={<button type="button" class="btn primary" onClick={props.onNew}>Crear la primera</button>}>
          Cada nota pertenece a una clase dentro de una materia. Elige una plantilla (Clase, Resumen, Caso clínico…) y se rellena sola.
        </Empty>
      ) : (
        <section class="glass panel stack-s">
          <div class="row wrap">
            <h2 style={{ fontSize: 'var(--t-3)' }} class="grow">Todo</h2>
            <select aria-label="Materia" value={materia} onChange={(e) => setMateria((e.target as HTMLSelectElement).value)}><option value="">Todas las materias</option>{materias.map((m) => <option>{m}</option>)}</select>
            <select aria-label="Etiqueta" value={tag} onChange={(e) => setTag((e.target as HTMLSelectElement).value)}><option value="">Todas las etiquetas</option>{app.settings.tagList.map((t) => <option>{t}</option>)}</select>
            <Segmented label="Fecha" value={since} onChange={setSince} options={[['todo', 'Todo'], ['7', '7 días'], ['30', '30 días']]} />
          </div>
          {rows.map((r) => <a class="kv" href={href('notas', ...r.n.path.split('/').slice(1))} style={{ textDecoration: 'none', minHeight: '44px', alignItems: 'center' }}><span class="k ellipsis"><b style={{ color: 'var(--t1)' }}>{r.n.title}</b> · {r.n.materia}{r.n.tema ? ` › ${r.n.tema}` : ''}</span><span class="v">{r.fecha}</span></a>)}
        </section>
      )}
      {app.settings.showGraph && notes.length > 0 && <section class="glass panel"><h2 style={{ fontSize: 'var(--t-3)' }}>Grafo</h2><Graph notes={notes} idx={props.data.idx} texts={props.data.texts} /></section>}
    </section>
  );
}

function NewNote(props: { notes: NoteMeta[]; onClose: () => void; initial?: { materia?: string; tema?: string; title?: string } }) {
  const app = useApp();
  const tree = buildTree(props.notes).tree;
  const [materia, setMateria] = useState(props.initial?.materia ?? tree[0]?.materia ?? '');
  const [tema, setTema] = useState(props.initial?.tema ?? '');
  const [title, setTitle] = useState(props.initial?.title ?? '');
  const [tpl, setTpl] = useState('Clase');
  const temas = tree.find((m) => m.materia === materia)?.temas.map((t) => t.tema) ?? [];
  return (
    <Sheet title="Nueva nota" onClose={props.onClose}>
      <form class="stack" onSubmit={async (e) => {
        e.preventDefault();
        let path = notePath(materia, tema, title);
        for (let i = 2; await app.vault.exists(path); i++) path = notePath(materia, tema, `${title} (${i})`);
        await app.vault.write(path, newNoteText(materia, tema, title, tpl));
        app.changed();
        props.onClose();
        go('notas', ...path.split('/').slice(1));
      }}>
        <label class="field">Materia<input class="input" list="materias" required value={materia} onInput={(e) => setMateria((e.target as HTMLInputElement).value)} placeholder="Cardiología" /><datalist id="materias">{tree.map((m) => <option value={m.materia} />)}</datalist></label>
        <label class="field">Tema o clase<input class="input" list="temas" required value={tema} onInput={(e) => setTema((e.target as HTMLInputElement).value)} placeholder="ECG" /><datalist id="temas">{temas.map((t) => <option value={t} />)}</datalist></label>
        <label class="field">Título<input class="input" required value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} placeholder="Clase 3 · Bloqueos AV" /></label>
        <fieldset class="field" style={{ border: 0, padding: 0 }}><legend>Plantilla</legend>
          <div class="bg-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))' }}>
            {Object.keys(TEMPLATES).filter((t) => t !== 'Nota diaria').map((t) => (
              <button type="button" aria-pressed={tpl === t} onClick={() => setTpl(t)} style={{ aspectRatio: 'auto', padding: '10px', textAlign: 'left', minHeight: '92px' }}>
                <b>{t}</b><div class="foot" style={{ whiteSpace: 'pre-line' }}>{TEMPLATES[t]!.match(/^## .*/gm)?.slice(0, 3).map((x) => x.slice(3)).join('\n')}</div>
              </button>
            ))}
          </div>
        </fieldset>
        <button class="btn primary" type="submit">Crear</button>
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
      return `> [!info] ${r.length} tarjetas · \`${query}\`\n${r.map((x) => `> - ${x.front.slice(0, 80)} _(${x.deck})_`).join('\n')}\n`;
    }
    const tag = /tag:(\S+)/.exec(query)?.[1];
    const mat = /materia:(\S+)/.exec(query)?.[1];
    const res = data.notes.filter((n) => {
      const fm = parseFrontmatter(data.texts.get(n.path) ?? '').data;
      const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : [];
      return (!tag || tags.includes(tag)) && (!mat || normalizeAnswer(n.materia) === normalizeAnswer(mat));
    });
    return `> [!info] ${res.length} notas · \`${query}\`\n${res.map((n) => `> - [[${n.title}]]`).join('\n')}\n`;
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

const SLASH: [string, string, string][] = [
  ['h1', 'Título', '# '], ['h2', 'Subtítulo', '## '], ['ul', 'Lista', '- '], ['ol', 'Lista numerada', '1. '], ['task', 'Tarea', '- [ ] '],
  ['table', 'Tabla', '| Columna | Columna |\n|---|---|\n|  |  |'], ['quote', 'Cita', '> '], ['callout', 'Callout', '> [!note] Título\n> '],
  ['img', 'Imagen', ''], ['card', 'Tarjeta de estudio', ''], ['code', 'Código', '```\n\n```'], ['link', 'Enlace a nota', '[['],
];

function NoteEditor(props: { path: string; data: NotesData }) {
  const app = useApp();
  const [text, setText] = useState<string | null>(null);
  const [mode, setMode] = useState<'doc' | 'md'>('doc');
  const [editing, setEditing] = useState<number | null>(null);
  const [tab, setTab] = useState<'outline' | 'links' | 'props' | 'graph' | 'cards' | 'events'>('outline');
  const [sheet, setSheet] = useState<'share' | 'history' | 'move' | 'prompt' | 'card' | null>(null);
  const [cardSeed, setCardSeed] = useState<{ text: string; kind: 'cloze' | 'basic'; para: number } | null>(null);
  const saver = useMemo(() => createAutosave(async (t: string) => {
    await app.vault.write(props.path, t);
    await snapshot(app.vault, props.path, t);
  }), [props.path]);
  useEffect(() => {
    void readTextOr(app.vault, props.path, '').then(setText);
    return () => { void saver.flush(); saver.dispose(); };
  }, [props.path]);
  if (text === null) return <p class="t2">Cargando…</p>;
  const doc = parseFrontmatter(text);
  const meta = noteMeta(props.path);
  const set = (t: string) => { setText(t); saver.schedule(t); };
  const setBody = (body: string) => set(stringifyFrontmatter(doc.data, body));
  const setFm = (fm: Frontmatter) => set(stringifyFrontmatter(fm, doc.body));
  const blocks = splitBlocks(doc.body);
  const cards = app.col ? [...app.col.byCid.values()].map((x) => ({ front: x.ref.note.front, back: x.ref.note.back, src: x.ref.note.src })) : [];
  const cov = coverage(doc.body, cards, props.path);
  const bookmarked = props.data?.bookmarks.includes(props.path);
  const insp = !(window.innerWidth < 1100);
  return (
    <>
      <section class="stack-s" style={{ minWidth: 0 }}>
        <div class="row wrap glass panel" style={{ justifyContent: 'space-between' }}>
          <div>
            <div class="foot">{meta.materia}{meta.tema ? ` › ${meta.tema}` : ''}</div>
            <h1 style={{ fontSize: 'var(--t-1)', fontWeight: 700 }}>{meta.title}</h1>
            <div class="foot">{cov.cards} tarjetas · {cov.total ? `${Math.round((cov.covered.length / cov.total) * 100)} % de párrafos cubiertos` : 'sin párrafos'}</div>
          </div>
          <div class="row wrap">
            <Segmented label="Vista" value={mode} onChange={(m) => (setMode(m), setEditing(null))} options={[['doc', 'Documento'], ['md', 'Ver Markdown']]} />
            <button type="button" class="btn icon" aria-label={bookmarked ? 'Quitar marcador' : 'Marcar'} aria-pressed={bookmarked} onClick={async () => { const b = props.data?.bookmarks ?? []; await app.vault.write(BOOKMARKS, JSON.stringify(bookmarked ? b.filter((x) => x !== props.path) : [...b, props.path])); app.changed(); }}>{bookmarked ? <Star size={18} fill="currentColor" /> : <Bookmark size={18} />}</button>
            <button type="button" class="btn icon" aria-label="Crear tarjetas con IA (copiar prompt)" title="Tarjetas desde la nota" onClick={() => setSheet('prompt')}><Sparkles size={18} /></button>
            <button type="button" class="btn icon" aria-label="Historial de versiones" onClick={() => setSheet('history')}><History size={18} /></button>
            <button type="button" class="btn icon" aria-label="Mover a otra materia o tema" onClick={() => setSheet('move')}><MoveRight size={18} /></button>
            <button type="button" class="btn icon" aria-label="Compartir o exportar" onClick={() => setSheet('share')}><Share size={18} /></button>
            <button type="button" class="btn icon" aria-label="Enviar a la papelera" onClick={async () => { if (!confirm('¿Enviar la nota a la papelera? Puedes restaurarla.')) return; await saver.flush(); await trash(app.vault, props.path); app.changed(); go('notas'); }}><Trash2 size={18} /></button>
          </div>
        </div>
        <article class="glass strong doc" onPaste={(e) => void onPaste(e as ClipboardEvent)}>
          <div class="print-only"><h1>{meta.title}</h1></div>
          {mode === 'md' ? (
            <textarea class="input code" style={{ minHeight: '70dvh', width: '100%', border: 0, background: 'transparent' }} value={text} onInput={(e) => set((e.target as HTMLTextAreaElement).value)} aria-label="Markdown de la nota" spellcheck />
          ) : (
            <div class="stack-s">
              {blocks.map((b, i) => (editing === i ? (
                <BlockInput key={i} value={b} notes={props.data?.notes ?? []} onChange={(v) => setBody([...blocks.slice(0, i), v, ...blocks.slice(i + 1)].join('\n\n'))}
                  onDone={() => setEditing(null)} onSplit={(a, rest) => { setBody([...blocks.slice(0, i), a, rest, ...blocks.slice(i + 1)].join('\n\n')); setEditing(i + 1); }}
                  onCard={(sel, kind) => { setCardSeed({ text: sel, kind, para: i }); setSheet('card'); }}
                  onImage={async (f) => { const name = await saveImage(app.vault, f, f.name); setBody([...blocks.slice(0, i + 1), `![[${name}]]`, ...blocks.slice(i + 1)].join('\n\n')); }}
                  onSlashCard={() => { setCardSeed({ text: '', kind: 'basic', para: i }); setSheet('card'); }} />
              ) : (
                <div key={i} role="button" tabIndex={0} onClick={(e) => { if ((e.target as HTMLElement).closest('a, summary, audio, input')) return; setEditing(i); }} onKeyDown={(e) => e.key === 'Enter' && setEditing(i)} style={{ cursor: 'text', borderRadius: '10px' }} aria-label="Editar bloque">
                  <Html html={renderMarkdown(props.data ? expandQueries(b, props.data, app.col) : b)} />
                </div>
              )))}
              <button type="button" class="btn ghost" style={{ justifySelf: 'start' }} onClick={() => { setBody(doc.body.replace(/\s*$/, '') + '\n\n'); setEditing(blocks.length); }}>＋ Escribe o usa «/» para insertar…</button>
            </div>
          )}
        </article>
      </section>
      {insp && (
        <aside class="glass panel insp stack-s" aria-label="Inspector">
          <div class="seg" role="tablist" aria-label="Panel">
            {([['outline', 'Esquema'], ...(app.settings.showBacklinks ? [['links', 'Enlaces']] : []), ['props', 'Propiedades'], ['cards', 'Tarjetas'], ['events', 'Eventos'], ...(app.settings.showGraph ? [['graph', 'Grafo']] : [])] as [typeof tab, string][]).map(([k, l]) => <button type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          {tab === 'outline' && (outline(doc.body).map((h) => <div style={{ paddingLeft: `${(h.level - 1) * 12}px` }} class="note">{h.text}</div>) || null)}
          {tab === 'outline' && !outline(doc.body).length && <p class="t2 note">Sin títulos.</p>}
          {tab === 'links' && props.data && <Links path={props.path} title={meta.title} data={props.data} />}
          {tab === 'props' && <Properties fm={doc.data} onChange={setFm} />}
          {tab === 'events' && <><b class="note">Eventos vinculados</b><LinkedEvents path={props.path} /></>}
          {tab === 'graph' && props.data && <Graph notes={props.data.notes} idx={props.data.idx} texts={props.data.texts} focus={props.path} />}
          {tab === 'cards' && (
            <div class="stack-s">
              <p class="note">{cov.cards} tarjetas vienen de esta nota.</p>
              {cov.uncovered.length > 0 && <><b class="note">Párrafos sin cubrir</b>{cov.uncovered.slice(0, 8).map((p) => <button type="button" class="opt note" style={{ fontSize: 'var(--t-note)' }} onClick={() => { setCardSeed({ text: p.text, kind: 'basic', para: p.idx }); setSheet('card'); }}>{p.text.slice(0, 120)}…</button>)}</>}
              <button type="button" class="btn small" onClick={() => setSheet('prompt')}><ClipboardCopy size={16} /> Copiar prompt</button>
            </div>
          )}
        </aside>
      )}
      {sheet === 'share' && <ShareNote path={props.path} title={meta.title} text={text} onClose={() => setSheet(null)} />}
      {sheet === 'history' && <HistorySheet path={props.path} onRestore={(t) => (set(t), setSheet(null))} onClose={() => setSheet(null)} />}
      {sheet === 'move' && props.data && <MoveNote path={props.path} notes={props.data.notes} onClose={() => setSheet(null)} onBeforeMove={() => saver.flush()} />}
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
      app.toast('Pegado desde documento: formato convertido a Markdown');
    } else if (/^https?:\/\/\S+$/.test(plain.trim())) {
      e.preventDefault();
      const url = plain.trim();
      const title = prompt('Título del enlace (sin conexión no se puede leer la página):', new URL(url).hostname) ?? url;
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

function BlockInput(p: { value: string; notes: NoteMeta[]; onChange: (v: string) => void; onDone: () => void; onSplit: (a: string, b: string) => void; onCard: (sel: string, kind: 'cloze' | 'basic') => void; onImage: (f: File) => void; onSlashCard: () => void }) {
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
  const slashItems = slash !== null ? SLASH.filter(([, l]) => normalizeAnswer(l).startsWith(normalizeAnswer(ref.current!.value.slice(slash + 1, ref.current!.selectionStart)))) : [];
  const linkItems = link !== null ? p.notes.filter((n) => normalizeAnswer(n.title).includes(normalizeAnswer(link))).slice(0, 8) : [];
  const applySlash = (k: string) => {
    const t = ref.current!;
    const item = SLASH.find((x) => x[0] === k)!;
    const v = t.value.slice(0, slash!) + item[2] + t.value.slice(t.selectionStart);
    setSlash(null);
    p.onChange(v);
    if (k === 'img') imgInput.current?.click();
    if (k === 'card') p.onSlashCard();
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
        <div class="row wrap glass" style={{ padding: '4px', borderRadius: '14px', marginBottom: '6px' }} role="toolbar" aria-label="Formato">
          <button type="button" class="btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('**')}><b>N</b></button>
          <button type="button" class="btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('==')}>Resaltar</button>
          <select aria-label="Color" onChange={(e) => { const c = (e.target as HTMLSelectElement).value; if (c) wrap('[', `]{.${c}}`); (e.target as HTMLSelectElement).value = ''; }}><option value="">Color…</option>{['azul', 'verde', 'naranja', 'rojo', 'morado', 'turquesa', 'rosa', 'amarillo'].map((c) => <option value={c}>{c}</option>)}</select>
          <button type="button" class="btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => wrap('[[', ']]')}><Link2 size={14} /> Enlazar a nota…</button>
          <button type="button" class="btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => p.onCard(sel, 'cloze')}>Crear cloze</button>
          <button type="button" class="btn small" onMouseDown={(e) => e.preventDefault()} onClick={() => p.onCard(sel, 'basic')}>Crear básica</button>
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
        }} aria-label="Editar bloque (escribe / para insertar)" />
      {slash !== null && slashItems.length > 0 && (
        <div class="slash glass strong" role="listbox">{slashItems.map(([k, l], i) => <button type="button" role="option" class={i === pick ? 'on' : ''} aria-selected={i === pick} onMouseDown={(e) => e.preventDefault()} onClick={() => applySlash(k)}>{k === 'code' ? <Code size={16} /> : null}{l}</button>)}</div>
      )}
      {link !== null && (
        <div class="slash glass strong" role="listbox">
          {linkItems.map((n, i) => <button type="button" role="option" class={i === pick ? 'on' : ''} aria-selected={i === pick} onMouseDown={(e) => e.preventDefault()} onClick={() => applyLink(n.title)}>{n.title} <span class="foot">{n.materia}</span></button>)}
          <button type="button" role="option" class={pick === linkItems.length ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => applyLink(link || 'Nueva nota')}>＋ Crear nota «{link || 'Nueva nota'}»</button>
        </div>
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
      <b class="note">Enlaces entrantes ({back.length})</b>{back.map(l)}
      <b class="note">Menciones sin enlazar ({unlinked.length})</b>{unlinked.map(l)}
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
      <label class="field">Fecha<input class="input" type="date" value={typeof p.fm.fecha === 'string' ? p.fm.fecha : ''} onChange={(e) => set('fecha', (e.target as HTMLInputElement).value)} /></label>
      <div class="field">Etiquetas
        <div class="row wrap">{tags.map((t) => <button type="button" class="chip" onClick={() => set('tags', tags.filter((x) => x !== t))} aria-label={`Quitar ${t}`}>#{t} ✕</button>)}</div>
        <select aria-label="Añadir etiqueta" value="" onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) set('tags', [...tags, v]); }}><option value="">Añadir…</option>{app.settings.tagList.filter((t) => !tags.includes(t)).map((t) => <option>{t}</option>)}</select>
        {!app.settings.tagList.length && <span class="foot">Crea etiquetas en Ajustes → Notas (lista controlada).</span>}
      </div>
      <div class="field">Mazos relacionados
        <div class="row wrap">{decks.map((d) => <button type="button" class="chip" onClick={() => set('mazos', decks.filter((x) => x !== d))}>{d} ✕</button>)}</div>
        <select aria-label="Añadir mazo" value="" onChange={(e) => { const v = (e.target as HTMLSelectElement).value; if (v) set('mazos', [...decks, v]); }}><option value="">Añadir…</option>{app.col?.decks.map((d) => <option>{d.full}</option>)}</select>
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
    <Sheet title="Compartir nota" onClose={p.onClose}>
      <div class="stack">
        <label class="row"><input type="checkbox" checked={links} onChange={(e) => setLinks((e.target as HTMLInputElement).checked)} /> Enlaces compatibles (convertir [[wikilinks]] a enlaces Markdown estándar)</label>
        <Segmented label="Colores" value={colors} onChange={setColors} options={[['keep', 'Conservar {.color}'], ['html', 'Como HTML'], ['plain', 'Quitar']]} />
        <div class="row wrap">
          <button type="button" class="btn" disabled={busy} onClick={() => prep('md')}>Preparar .md{mediaRefs(p.text).length ? ' (.zip con medios)' : ''}</button>
          <button type="button" class="btn" disabled={busy} onClick={() => prep('docx')}>Preparar .docx</button>
          <button type="button" class="btn" onClick={() => { p.onClose(); setTimeout(() => window.print(), 300); }}>PDF (imprimir)</button>
        </div>
        {file && <button type="button" class="btn primary" onClick={async () => { const r = await deliver(file); if (r !== 'cancelled') (app.toast('Nota exportada'), p.onClose()); }}><Share size={18} /> Guardar {file.name}</button>}
        <p class="foot">PDF: en la vista de impresión de Safari toca Compartir → «Guardar en Archivos». El texto queda seleccionable.</p>
      </div>
    </Sheet>
  );
}

function HistorySheet(p: { path: string; onRestore: (t: string) => void; onClose: () => void }) {
  const app = useApp();
  const { data } = useAsync(() => versions(app.vault, p.path), [p.path]);
  const [view, setView] = useState<{ ts: number; text: string } | null>(null);
  return (
    <Sheet title="Historial de versiones" onClose={p.onClose} wide>
      <div class="grid" style={{ gridTemplateColumns: '220px minmax(0,1fr)' }}>
        <div class="stack-s">{data?.length ? data.map((ts) => <button type="button" class={`btn small${view?.ts === ts ? ' primary' : ''}`} onClick={async () => setView({ ts, text: await readVersion(app.vault, p.path, ts) })}>{new Date(ts).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</button>) : <p class="t2">Sin instantáneas aún (se guardan cada 5 min de edición).</p>}</div>
        <div class="stack-s">{view && (<><pre class="preview">{view.text}</pre><button type="button" class="btn primary" onClick={() => p.onRestore(view.text)}>Restaurar esta versión</button></>)}</div>
      </div>
    </Sheet>
  );
}

function MoveNote(p: { path: string; notes: NoteMeta[]; onClose: () => void; onBeforeMove: () => Promise<void> }) {
  const app = useApp();
  const m = noteMeta(p.path);
  const [materia, setMateria] = useState(m.structured ? m.materia : '');
  const [tema, setTema] = useState(m.tema);
  const [title, setTitle] = useState(m.title);
  const tree = buildTree(p.notes).tree;
  return (
    <Sheet title="Mover nota" onClose={p.onClose}>
      <form class="stack" onSubmit={async (e) => {
        e.preventDefault();
        await p.onBeforeMove();
        const to = notePath(materia, tema, title);
        if (to !== p.path) {
          if (await app.vault.exists(to)) return app.toast('Ya existe una nota con ese nombre ahí');
          await app.vault.move(p.path, to);
          const t = await readTextOr(app.vault, to, '');
          const d = parseFrontmatter(t);
          if (materia !== DAILY) await app.vault.write(to, stringifyFrontmatter({ ...d.data, materia, tema }, d.body));
        }
        app.changed();
        p.onClose();
        go('notas', ...to.split('/').slice(1));
      }}>
        <label class="field">Materia<input class="input" list="mv-m" required value={materia} onInput={(e) => setMateria((e.target as HTMLInputElement).value)} /><datalist id="mv-m">{tree.map((x) => <option value={x.materia} />)}</datalist></label>
        <label class="field">Tema<input class="input" list="mv-t" required value={tema} onInput={(e) => setTema((e.target as HTMLInputElement).value)} /><datalist id="mv-t">{tree.find((x) => x.materia === materia)?.temas.map((t) => <option value={t.tema} />)}</datalist></label>
        <label class="field">Título<input class="input" required value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></label>
        <button class="btn primary" type="submit">Mover</button>
      </form>
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
      app.toast('Prompt copiado: pégalo en tu herramienta de IA');
    } catch {
      setResp(t);
      app.toast('No se pudo copiar; selecciona el texto y cópialo');
    }
  };
  return (
    <Sheet title="Tarjetas desde la nota" onClose={p.onClose} wide>
      <div class="stack">
        <ol class="note" style={{ margin: 0 }}>
          <li>Copia el prompt y pégalo en la herramienta de IA que ya uses.</li>
          <li>Pega aquí la respuesta: la app valida el formato.</li>
          <li>Revisa cada tarjeta: aceptar, editar o descartar. <b>Nada se agrega sin tu revisión</b> (contenido médico: puede haber errores).</li>
        </ol>
        <div class="row wrap">
          <button type="button" class="btn primary" onClick={copy}><ClipboardCopy size={18} /> Copiar prompt</button>
          <button type="button" class="btn" onClick={async () => { try { setResp(await navigator.clipboard.readText()); } catch { app.toast('Pega con ⌘V en el cuadro'); } }}><ClipboardPaste size={18} /> Pegar respuesta</button>
        </div>
        <textarea class="input code" style={{ minHeight: '18dvh' }} value={resp} onInput={(e) => setResp((e.target as HTMLTextAreaElement).value)} placeholder={'Q:: …\nA:: …\n\nCloze: …{{c1::…}}'} aria-label="Respuesta de la IA" />
        <button type="button" class="btn" disabled={!resp.trim()} onClick={() => setItems(parseAiResponse(resp).map((x) => ({ ...x, state: 'pending' as const })))}>Validar y revisar</button>
        {items && (
          <>
            <label class="field">Mazo de destino<select value={deck} onChange={(e) => setDeck((e.target as HTMLSelectElement).value)}>{app.col?.decks.map((d) => <option value={d.path}>{d.full}</option>)}</select></label>
            {items.map((it, i) => {
              const n = parseDeck(it.block + ' ^vista').notes[0];
              return (
                <div class="inset stack-s" style={{ padding: '10px', borderRadius: 'var(--r-row)', opacity: it.state === 'discarded' ? 0.38 : 1 }}>
                  <span class="chip">origen: IA</span>
                  {n && <NotePreview note={n} />}
                  <textarea class="input code" rows={3} value={it.block} onInput={(e) => setItems(items.map((x, k) => (k === i ? { ...x, block: (e.target as HTMLTextAreaElement).value, ok: !parseDeck((e.target as HTMLTextAreaElement).value + ' ^v').notes[0]?.errors.length } : x)))} aria-label="Editar tarjeta" />
                  <div class="row">
                    <button type="button" class="btn small primary" disabled={!it.ok || it.state !== 'pending' || !deck} onClick={async () => { await appendCard(app.vault, deck, withOrigin(it.block, p.path, true), app.col); setItems(items.map((x, k) => (k === i ? { ...x, state: 'accepted' } : x))); }}>{it.state === 'accepted' ? '✓ Aceptada' : 'Aceptar'}</button>
                    <button type="button" class="btn small" disabled={it.state !== 'pending'} onClick={() => setItems(items.map((x, k) => (k === i ? { ...x, state: 'discarded' } : x)))}>Descartar</button>
                  </div>
                </div>
              );
            })}
            <button type="button" class="btn primary" onClick={() => { const n = items.filter((x) => x.state === 'accepted').length; app.changed(); p.onAccepted?.(n); p.onClose(); }}>Listo ({items.filter((x) => x.state === 'accepted').length} aceptadas)</button>
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
  const block = p.seed.kind === 'cloze' ? `Cloze: ${front.replace(/\n\s*\n/g, '\n')}` : `Q:: ${front.replace(/\n\s*\n/g, '\n')}\nA:: ${back.replace(/\n\s*\n/g, '\n')}`;
  const n = parseDeck(block + ' ^vista').notes[0];
  return (
    <Sheet title={p.seed.kind === 'cloze' ? 'Crear cloze' : 'Crear básica'} onClose={p.onClose}>
      <form class="stack" onSubmit={async (e) => { e.preventDefault(); await appendCard(app.vault, deck, withOrigin(block, `${p.path}#p${p.paraIdx}`, false), app.col); app.changed(); app.toast('Tarjeta creada con su origen'); p.onClose(); }}>
        <label class="field">Mazo<select value={deck} onChange={(e) => setDeck((e.target as HTMLSelectElement).value)}>{app.col?.decks.map((d) => <option value={d.path}>{d.full}</option>)}</select></label>
        <label class="field">{p.seed.kind === 'cloze' ? 'Texto (amplía el contexto alrededor del hueco)' : 'Pregunta'}<textarea class="input" rows={3} value={front} onInput={(e) => setFront((e.target as HTMLTextAreaElement).value)} /></label>
        {p.seed.kind === 'basic' && <label class="field">Respuesta<textarea class="input" rows={2} required value={back} onInput={(e) => setBack((e.target as HTMLTextAreaElement).value)} /></label>}
        {n && <NotePreview note={n} />}
        <button class="btn primary" type="submit" disabled={!deck || !!n?.errors.length}>Añadir</button>
      </form>
    </Sheet>
  );
}

export { addDays };
