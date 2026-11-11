import { locale, t } from '../i18n';
import { ArrowDownUp, Pencil } from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import { stateOp } from '../data/ops';
import { srsParams } from '../lib/settings';
import { type Row, search } from '../lib/query';
import { renderCloze, renderMarkdown } from '../md/render';
import { RATING_LABEL } from '../srs/engine';
import { useApp } from '../state';
import { PageTitle } from '../ui/kit';
import { Html } from '../ui/md';
import { NotePreview } from './deck';
import { EditNote } from './study';

const STATE = () => ([t('explorar.nueva'), t('today.aprendiendo'), t('explorar.repaso'), t('explorar.reaprendiendo')]);
type Key = 'front' | 'deck' | 'due' | 'lapses' | 'stability' | 'difficulty' | 'reps';

/** Navegador avanzado (SPEC §9 add-on 6): consultas, columnas ordenables, edición por lotes y vista previa. */
export function Explorar(props: { q?: string }) {
  const app = useApp();
  const col = app.col;
  const [q, setQ] = useState(props.q ?? '');
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: 'due', dir: 1 });
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [cur, setCur] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const res = useMemo(() => {
    if (!col) return [];
    const r = search(col, q, Date.now(), app.settings.leechThreshold);
    return r.sort((a, b) => {
      const x = a[sort.k] as string | number;
      const y = b[sort.k] as string | number;
      return (typeof x === 'string' ? x.localeCompare(y as string, 'es') : x - (y as number)) * sort.dir;
    });
  }, [col, q, sort, app.tick]);
  if (!col) return <p class="t2">{t('deck.cargando')}</p>;
  const th = (k: Key, label: string) => (
    <th scope="col"><button type="button" class="link" style={{ minHeight: '32px', textDecoration: sort.k === k ? 'underline' : 'none' }} onClick={() => setSort({ k, dir: sort.k === k ? (-sort.dir as 1 | -1) : 1 })} aria-sort={sort.k === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>{label}{sort.k === k && <ArrowDownUp size={12} />}</button></th>
  );
  const batch = async (op: 'suspend' | 'unsuspend' | 'forget') => {
    if (op === 'forget' && !confirm(t('explorar.reiniciar_size_tarjetas_vuelven_a_ser', { size: sel.size }))) return;
    await stateOp(app.vault, col, [...sel], op, srsParams(app.settings));
    app.refresh();
    app.toast(t('explorar.size_tarjetas_actualizadas', { size: sel.size }));
    setSel(new Set());
  };
  const c = cur ? col.byCid.get(cur) : null;
  const hist = cur ? col.log.filter((e) => e.id === cur && e.rating) : [];
  const row = (r: Row) => (
    <tr key={r.cid} class={cur === r.cid ? 'warn' : ''} onClick={() => setCur(r.cid)} style={{ cursor: 'pointer' }}>
      <td><input type="checkbox" aria-label={t('explorar.seleccionar')} checked={sel.has(r.cid)} onClick={(e) => e.stopPropagation()} onChange={(e) => setSel((s) => { const n = new Set(s); (e.target as HTMLInputElement).checked ? n.add(r.cid) : n.delete(r.cid); return n; })} /></td>
      <td style={{ maxWidth: '320px' }} class="ellipsis">{r.suspended ? '⏸ ' : ''}{r.front}</td>
      <td class="ellipsis">{r.deck}</td>
      <td>{STATE()[r.state]}</td>
      <td class="num">{r.state === 0 ? '—' : new Date(r.due).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}</td>
      <td class="num">{r.lapses}</td>
      <td class="num">{r.state === 0 ? '—' : r.stability.toFixed(1)}</td>
    </tr>
  );
  return (
    <>
      <PageTitle title={t('explorar.explorar')} sub={t('explorar.n_de_size_tarjetas', { n: res.length, size: col.byCid.size })} />
      <div class="grid phone-stack" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(280px, 2fr)', alignItems: 'start' }}>
        <section class="glass panel stack-s">
          <input class="input wide" type="search" placeholder='tag:ecg due:<3 is:leech deck:Cardio "frase" -is:new' value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label={t('explorar.consulta')} />
          <div class="row wrap">
            {['is:due', 'is:new', 'is:leech', 'is:suspended', 'due:<7', 'origen:ia'].map((x) => <button type="button" class="btn small" onClick={() => setQ(x)}>{x}</button>)}
          </div>
          {sel.size > 0 && (
            <div class="row wrap">
              <b>{sel.size} seleccionadas</b>
              <button type="button" class="btn small" onClick={() => batch('suspend')}>{t('decks.suspender')}</button>
              <button type="button" class="btn small" onClick={() => batch('unsuspend')}>{t('explorar.reactivar')}</button>
              <button type="button" class="btn small danger" onClick={() => batch('forget')}>{t('explorar.reiniciar')}</button>
            </div>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table class="tbl">
              <thead><tr><th><input type="checkbox" aria-label={t('explorar.seleccionar_todas')} onChange={(e) => setSel((e.target as HTMLInputElement).checked ? new Set(res.map((r) => r.cid)) : new Set())} /></th>{th('front', t('explorar.tarjeta'))}{th('deck', t('deck.mazo'))}<th>{t('exams.estado')}</th>{th('due', t('explorar.vence'))}{th('lapses', t('explorar.lapsos'))}{th('stability', 'S')}</tr></thead>
              <tbody>{res.slice(0, 400).map(row)}</tbody>
            </table>
            {res.length > 400 && <p class="foot">{t('explorar.mostrando_400_de_n_afina_la', { n: res.length })}</p>}
          </div>
        </section>
        <section class="glass strong panel stack-s" aria-label={t('deck.vista_previa')}>
          {c ? (
            <>
              <div class="row"><b class="grow">{c.deck.full}</b><button type="button" class="btn small" onClick={() => setEdit(true)}><Pencil size={14} />{' '}{t('exams.editar')}</button></div>
              {c.ref.note.type === 'cloze' ? <Html html={renderCloze(c.ref.note.front, c.ref.ord, true)} /> : <NotePreview note={c.ref.note} />}
              {c.ref.note.back && c.ref.note.type !== 'cloze' && <Html class="t2" html={renderMarkdown('')} />}
              <h3 style={{ fontSize: 'var(--t-body)' }}>{t('explorar.historial')}</h3>
              {hist.length ? hist.map((h) => <div class="kv"><span class="k">{new Date(h.ts).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' })}</span><span class="v">{RATING_LABEL[h.rating!]} · {Math.round((h.ms ?? 0) / 1000)} s</span></div>) : <p class="t2">{t('explorar.sin_repasos')}</p>}
            </>
          ) : <p class="t2">{t('explorar.toca_una_tarjeta_para_ver_su')}</p>}
        </section>
      </div>
      {edit && c && <EditNote deckPath={c.deck.path} noteId={c.ref.note.id} raw={c.ref.note.raw} onClose={() => setEdit(false)} />}
    </>
  );
}
