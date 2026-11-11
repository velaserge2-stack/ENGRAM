import { BookOpen, Download, FilePlus2, FolderInput, Import, Pause as PauseIcon, Pencil, Settings2, Layers } from 'lucide-preact';
import { useRef, useState } from 'preact/hooks';
import type { Deck } from '../data/collection';
import { createDeck, mediaRefs, resolveMedia, setDeckMeta, stateOp } from '../data/ops';
import { buildZip } from '../io/zip';
import { deliver } from '../io/share';
import { srsParams, studyLimits } from '../lib/settings';
import { deckCounts, newIntroducedToday, type Counts } from '../srs/queue';
import { go, href, useApp } from '../state';
import { Empty, Num, PageTitle, Sheet } from '../ui/kit';
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
export function DeckPanel(props: { title?: string }) {
  const app = useApp();
  const col = app.col;
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [swiped, setSwiped] = useState<string | null>(null);
  const [opts, setOpts] = useState<Deck | null>(null);
  const [creating, setCreating] = useState(false);
  const swipe = useRef<{ x: number; key: string } | null>(null);
  if (!col) return <section class="glass panel" aria-busy="true"><p class="t2">Cargando mazos…</p></section>;
  const now = Date.now();
  const lim = studyLimits(app.settings);
  const intro = newIntroducedToday(col, now, lim);
  const counts = new Map(col.decks.map((d) => [d.path, deckCounts(col, d, now, lim, intro)]));
  const nodes = tree(col.decks, counts);

  const rows: preact.JSX.Element[] = [];
  const walk = (ns: Node[], depth: number) => {
    for (const n of ns) {
      const open = !closed.has(n.key);
      const isSel = sel === n.key;
      const studyKey = n.deck ? n.deck.path : `decks/${n.key}/`;
      rows.push(
        <tr
          key={n.key}
          class={`swipe-row${isSel ? ' sel' : ''}`}
          onClick={() => setSel(isSel ? null : n.key)}
          onPointerDown={(e) => (swipe.current = { x: e.clientX, key: n.key })}
          onPointerUp={(e) => {
            const s = swipe.current;
            swipe.current = null;
            if (s && s.key === n.key && Math.abs(e.clientX - s.x) > 50) setSwiped(e.clientX < s.x ? n.key : null);
          }}
        >
          <td>
            <div class="name" style={{ paddingLeft: `${depth * 22}px` }}>
              {n.deck ? <span style={{ width: '28px', textAlign: 'center' }} aria-hidden="true">{deckEmoji(app, n.deck) || '·'}</span> : (
                <button type="button" class="tog" aria-expanded={open} aria-label={`${open ? 'Contraer' : 'Expandir'} ${n.label}`} onClick={(e) => (e.stopPropagation(), setClosed((s) => { const c = new Set(s); c.has(n.key) ? c.delete(n.key) : c.add(n.key); return c; }))}>
                  {open ? '－' : '＋'}
                </button>
              )}
              <a href={n.deck ? href('estudiar', ...n.deck.path.split('/')) : href('estudiar', ...studyKey.split('/').filter(Boolean), '')} onClick={(e) => e.stopPropagation()}>{n.label}</a>
              {isSel && n.deck && (
                <button type="button" class="btn icon small ghost" aria-label={`Opciones de ${n.label}`} onClick={(e) => (e.stopPropagation(), setOpts(n.deck))}>
                  <Settings2 size={18} />
                </button>
              )}
            </div>
          </td>
          {swiped === n.key ? (
            <td colSpan={3}>
              <div class="row" style={{ justifyContent: 'flex-end' }}>
                <a class="btn small" href={href('estudiar', ...studyKey.split('/').filter(Boolean), ...(n.deck ? [] : ['']))}><BookOpen size={16} /> Estudiar</a>
                <button type="button" class="btn small" onClick={(e) => (e.stopPropagation(), suspendAll(n))}><PauseIcon size={16} /> Suspender</button>
                {n.deck && <button type="button" class="btn small" onClick={(e) => (e.stopPropagation(), void exportDeck(n.deck!))}><Download size={16} /> Exportar</button>}
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
    if (!confirm(`¿Suspender ${cids.length} tarjetas de "${n.label}"? Puedes reactivarlas en Explorar.`)) return;
    await stateOp(app.vault, col, cids, 'suspend', srsParams(app.settings));
    setSwiped(null);
    app.refresh();
    app.toast(`${cids.length} tarjetas suspendidas`);
  };

  const exportDeck = async (d: Deck) => {
    const text = await readTextOr(app.vault, d.path, '');
    const media = mediaRefs(text);
    if (!media.length) {
      const r = await deliver(new File([text], d.path.split('/').pop()!, { type: 'text/markdown' }));
      if (r !== 'cancelled') app.toast('Mazo exportado');
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
    <section class="glass panel" aria-label="Mazos">
      <div class="panel-h">
        <h2>{props.title ?? 'Mazos'}</h2>
        <span class="foot">Desliza una fila para acciones rápidas</span>
      </div>
      {col.decks.length === 0 ? (
        <p class="t2" style={{ padding: '8px 4px 12px' }}>Aún no hay mazos. Crea uno o importa un archivo .md con frontmatter <code>deck:</code>.</p>
      ) : (
        <table class="decks">
          <thead>
            <tr>
              <th scope="col">Mazo</th>
              <th scope="col">Nuevas</th>
              <th scope="col">Aprendiendo</th>
              <th scope="col">Vencidas</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      )}
      <div class="footer-pills" style={{ marginTop: '14px' }}>
        <button type="button" class="btn" onClick={() => app.openSheet('import')}><FolderInput size={18} /> Importar compartidos</button>
        <button type="button" class="btn" onClick={() => setCreating(true)}><FilePlus2 size={18} /> Crear mazo</button>
        <button type="button" class="btn" onClick={() => app.openSheet('import')}><Import size={18} /> Importar archivo</button>
      </div>
      {opts && <DeckOptions deck={opts} onClose={() => setOpts(null)} />}
      {creating && <CreateDeck onClose={() => setCreating(false)} />}
      {pendingFile && (
        <Sheet title="Exportar mazo con medios" onClose={() => setPendingFile(null)}>
          <div class="stack">
            <p>{pendingFile.name} está listo.</p>
            <button type="button" class="btn primary" onClick={async () => { await deliver(pendingFile); setPendingFile(null); }}>Guardar en Archivos</button>
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
    <Sheet title="Crear mazo" onClose={props.onClose}>
      <form class="stack" onSubmit={async (e) => {
        e.preventDefault();
        const p = await createDeck(app.vault, name, folder);
        app.changed();
        props.onClose();
        go('mazos', ...p.split('/'));
      }}>
        <label class="field">Nombre (puedes empezar con un emoji)<input class="input" required value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="🫀 Cardiología" /></label>
        <label class="field">Carpeta (opcional, para submazos)
          <input class="input" list="folders" value={folder} onInput={(e) => setFolder((e.target as HTMLInputElement).value)} placeholder="Medicina interna" />
          <datalist id="folders">{folders.map((f) => <option value={f} />)}</datalist>
        </label>
        <button class="btn primary" type="submit">Crear</button>
      </form>
    </Sheet>
  );
}

function DeckOptions(props: { deck: Deck; onClose: () => void }) {
  const app = useApp();
  const d = props.deck;
  const [name, setName] = useState(d.name);
  const [emoji, setEmoji] = useState(typeof d.data.emoji === 'string' ? d.data.emoji : '');
  const [npd, setNpd] = useState(d.newPerDay ?? app.settings.newPerDay);
  const [lang, setLang] = useState(typeof d.data.lang === 'string' ? d.data.lang : '');
  return (
    <Sheet title={`Opciones · ${d.name}`} onClose={props.onClose}>
      <form class="stack" onSubmit={async (e) => {
        e.preventDefault();
        await setDeckMeta(app.vault, d.path, { deck: name, emoji: emoji || null, new_per_day: npd, lang: lang || null });
        app.changed();
        props.onClose();
      }}>
        <label class="field">Nombre<input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
        <label class="field">Emoji (el único color de la interfaz)<input class="input" value={emoji} maxLength={8} onInput={(e) => setEmoji((e.target as HTMLInputElement).value)} placeholder="🫀" /></label>
        <label class="field">Nuevas por día<input class="input" type="number" min={0} max={999} value={npd} onInput={(e) => setNpd(Number((e.target as HTMLInputElement).value))} /></label>
        <label class="field">Idioma de lectura en voz alta<input class="input" value={lang} onInput={(e) => setLang((e.target as HTMLInputElement).value)} placeholder="es-MX, en-US…" /></label>
        <div class="row wrap">
          <button class="btn primary" type="submit">Guardar</button>
          <a class="btn" href={href('mazos', ...d.path.split('/'))} onClick={props.onClose}><Pencil size={16} /> Editar tarjetas</a>
        </div>
        <p class="foot">Se guarda en el frontmatter del archivo, así viaja con él.</p>
      </form>
    </Sheet>
  );
}

export function Decks() {
  const app = useApp();
  const col = app.col;
  return (
    <>
      <PageTitle title="Mazos" sub={col ? `${col.decks.length} mazos · ${col.byCid.size} tarjetas` : undefined}>
        <a class="btn primary" href="#/estudiar"><BookOpen size={18} /> Estudiar todo</a>
      </PageTitle>
      {col && col.decks.length === 0 ? (
        <Empty icon={<Layers size={44} />} title="Sin mazos todavía" action={<button type="button" class="btn primary" onClick={() => app.openSheet('import')}>Importar</button>}>
          Un mazo es un archivo .md en la carpeta decks/. Crea uno, impórtalo desde Archivos o carga la bóveda de ejemplo en Ajustes.
        </Empty>
      ) : (
        <div class="stack">
          <DeckPanel />
          {col && col.decks.some((d) => d.errors.length) && (
            <section class="glass panel">
              <h2 style={{ fontSize: 'var(--t-3)', marginBottom: '8px' }}>Tarjetas con errores (no entran al estudio)</h2>
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
              <h2 style={{ fontSize: 'var(--t-3)' }}>Archivadas</h2>
              <p class="t2 note">{col.archived.length} tarjetas cuyo ID ya no está en ningún mazo. Su historial se conserva; se ocultan a los 30 días. Si vuelves a pegar el bloque con su ID, recuperan su programación.</p>
            </section>
          )}
        </div>
      )}
    </>
  );
}
