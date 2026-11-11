import { t } from '../i18n';
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
  if (!col) return <section class="glass panel" aria-busy="true"><p class="t2">{t('decks.cargando_mazos')}</p></section>;
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
        <span class="foot">{t('decks.desliza_una_fila_para_acciones_rapidas')}</span>
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
          <tbody>{rows}</tbody>
        </table>
      )}
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

function DeckOptions(props: { deck: Deck; onClose: () => void }) {
  const app = useApp();
  const d = props.deck;
  const [name, setName] = useState(d.name);
  const [emoji, setEmoji] = useState(typeof d.data.emoji === 'string' ? d.data.emoji : '');
  const [npd, setNpd] = useState(d.newPerDay ?? app.settings.newPerDay);
  const [lang, setLang] = useState(typeof d.data.lang === 'string' ? d.data.lang : '');
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
      </form>
    </Sheet>
  );
}

export function Decks() {
  const app = useApp();
  const col = app.col;
  return (
    <>
      <PageTitle title={t('decks.mazos')} sub={col ? t('decks.n_mazos_size_tarjetas', { n: col.decks.length, size: col.byCid.size }) : undefined}>
        <a class="btn primary" href="#/estudiar"><BookOpen size={18} />{' '}{t('decks.estudiar_todo')}</a>
      </PageTitle>
      {col && col.decks.length === 0 ? (
        <Empty icon={<Layers size={44} />} title={t('decks.sin_mazos_todavia')} action={<button type="button" class="btn primary" onClick={() => app.openSheet('import')}>{t('decks.importar')}</button>}>{t('decks.un_mazo_es_un_archivo_md')}</Empty>
      ) : (
        <div class="stack">
          <DeckPanel />
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
