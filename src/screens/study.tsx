import { locale, t as tr, tn } from '../i18n';
import { CalendarClock, Check, Eye, HelpCircle, MoreHorizontal, Pencil, RotateCcw, Undo2, Volume2, X, Zap } from 'lucide-preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { noteIdOf, replaceBlock } from '../cards/parse';
import { appendLog } from '../data/collection';
import { stateOp } from '../data/ops';
import { dayKey } from '../lib/days';
import { srsParams, studyLimits } from '../lib/settings';
import { plainText } from '../md/render';
import { applyReview, explain, formatInterval, type LogEntry, previews, type Rating, RATING_LABEL, replay, scheduler } from '../srs/engine';
import { buildQueue, isLeech, nextCard, stateOf } from '../srs/queue';
import { go, useApp } from '../state';
import { KeyFeedback, keymap, useKeyScope, type Via } from '../ui/keys';

/** Marcas del repaso («*» marcar, «F» no la sé / favorita): aparte del historial FSRS. */
const MARKS = '.app/marcas.json';
import { Empty, PageTitle, Sheet } from '../ui/kit';
import { readTextOr } from '../vault/util';
import { CardView, isInteractive } from './cardview';
import { deckEmoji } from './decks';

const ICON: Record<Rating, preact.JSX.Element> = { 1: <RotateCcw size={18} />, 2: <HelpCircle size={18} />, 3: <Check size={18} />, 4: <Zap size={18} /> };

export function speak(text: string, lang: string) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  // «Atenuar al estudiar» del sonido ambiente escucha estos avisos
  u.onstart = () => dispatchEvent(new CustomEvent('engrama-duck', { detail: true }));
  u.onend = u.onerror = () => dispatchEvent(new CustomEvent('engrama-duck', { detail: false }));
  speechSynthesis.speak(u);
}

export function Study(props: { filter: string | null; embedded?: boolean }) {
  const app = useApp();
  const col = app.col;
  const s = app.settings;
  const params = srsParams(s);
  const lim = studyLimits(s);
  const f = useMemo(() => scheduler(params), [JSON.stringify(params)]);
  const [done] = useState(() => new Set<string>());
  const [seen] = useState(() => new Set<string>());
  const [count, setCount] = useState(0);
  const [extraNew, setExtraNew] = useState(0);
  const [cur, setCur] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [suggest, setSuggest] = useState<Rating | null>(null);
  const [started, setStarted] = useState(Date.now());
  const [undo, setUndo] = useState<LogEntry[]>([]);
  const [why, setWhy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const seed = useRef(String(Date.now()));

  useEffect(() => {
    if (props.embedded) return;
    app.focus(true);
    return () => app.focus(false);
  }, []);

  const queue = useMemo(() => (col ? buildQueue(col, props.filter, Date.now(), lim, params, extraNew) : null), [col, props.filter, extraNew, count, app.tick]);

  // elegir la siguiente tarjeta
  useEffect(() => {
    if (!col || !queue) return;
    if (cur && col.byCid.has(cur) && !done.has(cur)) return;
    const next = nextCard(col, queue, seen, done, Date.now(), count);
    setCur(next);
    setRevealed(false);
    setSuggest(null);
    setStarted(Date.now());
  }, [queue, cur]);

  // si solo quedan de aprendizaje que vencen más tarde, despertar cuando venzan
  useEffect(() => {
    if (cur || !queue?.nextLearningAt) return;
    const t = setTimeout(() => (setNow(Date.now()), setCount((c) => c + 1)), Math.max(1000, queue.nextLearningAt - Date.now()));
    return () => clearTimeout(t);
  }, [cur, queue]);

  const entry = cur && col ? col.byCid.get(cur) : null;
  const st = cur && col ? stateOf(col, cur) : null;
  const prev = st ? previews(f, st.card, Date.now()) : null;

  const answer = async (r: Rating) => {
    if (!col || !cur || !st || busy) return;
    setBusy(true);
    const ms = Math.min(60_000, Date.now() - started);
    const e = applyReview(f, st, cur, r, Date.now(), ms);
    col.states.set(cur, st);
    await appendLog(app.vault, col, [e], params);
    if (r === 1 && isLeech(st, s.leechThreshold) && st.card.lapses === s.leechThreshold) app.toast(tr('study.sanguijuela_esta_tarjeta_se_olvida_mucho'));
    done.add(cur);
    seen.add(noteIdOf(cur));
    // las de aprendizaje vuelven a la cola de la sesión
    if (st.card.state === 1 || st.card.state === 3) done.delete(cur);
    setUndo((u) => [...u.slice(-20), e]);
    setCount((c) => c + 1);
    setCur(null);
    setBusy(false);
  };

  const doUndo = async () => {
    const last = undo[undo.length - 1];
    if (!col || !last) return;
    const u: LogEntry = { id: last.id, ts: Date.now(), op: 'undo', ref: last.ts };
    const rebuilt = replay([...col.log.filter((x) => x.id === last.id), u], params).get(last.id);
    if (rebuilt) col.states.set(last.id, rebuilt);
    await appendLog(app.vault, col, [u], params);
    setUndo((x) => x.slice(0, -1));
    done.delete(last.id);
    seen.delete(noteIdOf(last.id));
    setCur(last.id);
    setRevealed(false);
    setCount((c) => c + 1);
    app.toast(tr('study.repaso_deshecho'));
  };

  // teclado, clicker y mando (configurables en Ajustes → Atajos); el repaso se hace sin tocar la pantalla
  const [lastKey, setLastKey] = useState<{ via: Via; action: string; at: number } | null>(null);
  const [marks, setMarks] = useState<Record<string, { mark?: boolean; flag?: boolean }>>({});
  useEffect(() => { void readTextOr(app.vault, MARKS, '{}').then((t) => { try { setMarks(JSON.parse(t) as typeof marks); } catch { /* dañado */ } }); }, []);
  const toggleMark = async (cid: string, k: 'mark' | 'flag') => {
    const next = { ...marks, [cid]: { ...marks[cid], [k]: !marks[cid]?.[k] } };
    setMarks(next);
    await app.vault.write(MARKS, JSON.stringify(next));
  };
  useKeyScope('study', (id, via) => {
    if (!entry) return;
    const canReveal = !revealed && !isInteractive(entry.ref);
    setLastKey({ via, action: id, at: Date.now() });
    if (id === 'study.show') { if (canReveal) setRevealed(true); else if (revealed && keymap.cfg.spaceGood) void answer(3); }
    else if (id === 'study.advance') { if (canReveal) setRevealed(true); else if (revealed) void answer(3); }
    else if (revealed && ['study.again', 'study.hard', 'study.good', 'study.easy'].includes(id)) void answer((['study.again', 'study.hard', 'study.good', 'study.easy'].indexOf(id) + 1) as Rating);
    else if (id === 'study.undo') void doUndo();
    else if (id === 'study.edit') setEdit(true);
    else if (id === 'study.bury' && col) void stateOp(app.vault, col, [entry.ref.cid], 'bury', params, dayKey(Date.now(), s.timeZone, s.dayStartHour)).then(() => (done.add(entry.ref.cid), setCur(null), app.toast(tr('keys.enterrada'))));
    else if (id === 'study.mark') void toggleMark(entry.ref.cid, 'mark');
    else if (id === 'study.flag') void toggleMark(entry.ref.cid, 'flag');
    else if (id === 'study.exit') go('hoy');
  }, !props.embedded);

  if (!col || !queue) return <p class="t2">{tr('deck.cargando')}</p>;
  const deckName = props.filter ? col.decks.find((d) => d.path === props.filter)?.full ?? props.filter.replace(/^decks\//, '').replace(/\/$/, '') : tr('study.todos_los_mazos');
  const left = queue.learning.filter((c) => !done.has(c)).length + queue.review.filter((c) => !done.has(c)).length + queue.fresh.filter((c) => !done.has(c)).length;

  if (!entry || !st || !prev) {
    return (
      <div class="study">
        <PageTitle title={tr('today.estudiar')} sub={deckName} />
        <Empty icon={<Check size={44} />} title={count ? tr('study.listo_por_ahora') : tr('study.nada_que_repasar')} action={
          <div class="row wrap" style={{ justifyContent: 'center' }}>
            <button type="button" class="btn" onClick={() => setExtraNew((n) => n + 10)}>{tr('study.estudiar_10_nuevas_mas')}</button>
            <a class="btn primary" href="#/hoy">{tr('study.volver_a_hoy')}</a>
          </div>
        }>
          {count ? tr('study.repasaste_count_p_en_esta_sesion', { count: count, p: tn('plural.cardsword', count) }) : tr('study.no_hay_tarjetas_vencidas_ni_nuevas')}
          {queue.nextLearningAt ? tr('study.la_siguiente_de_aprendizaje_vuelve_a', { p: new Date(queue.nextLearningAt).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) }) : ''}
          {now ? '' : ''}
        </Empty>
      </div>
    );
  }

  const leech = isLeech(st, s.leechThreshold);
  const timeSuggest: Rating | null = s.suggestByTime && revealed && !isInteractive(entry.ref) ? (() => { const sec = (Date.now() - started) / 1000; return sec < 4 ? 4 : sec < 12 ? 3 : sec < 25 ? 2 : null; })() : null;
  const sug = suggest ?? timeSuggest;
  const lang = (typeof entry.deck.data.lang === 'string' && entry.deck.data.lang) || s.ttsLang;
  const ex = explain(st, Date.now(), s.retention, f);

  return (
    <div class="study">
      <div class="row wrap glass" style={{ justifyContent: 'space-between', padding: '8px 10px', borderRadius: 'var(--r-panel)' }}>
        <div class="row" style={{ padding: '0 8px' }}>
          <span aria-hidden="true">{deckEmoji(app, entry.deck)}</span>
          <b>{entry.deck.full}</b>
          <span class="t2 num">{tr('study.quedan_left', { left: left })}</span>
        </div>
        <div class="row">
          <button type="button" class="btn icon" aria-label={tr('study.deshacer_z')} disabled={!undo.length} onClick={doUndo}><Undo2 size={18} /></button>
          <button type="button" class="btn icon" aria-label={tr('study.leer_en_voz_alta')} onClick={() => speak(plainText(revealed ? `${entry.ref.note.front}. ${entry.ref.note.back}` : entry.ref.note.front), lang)}><Volume2 size={18} /></button>
          <button type="button" class="btn icon" aria-label={tr('study.editar_tarjeta_e')} onClick={() => setEdit(true)}><Pencil size={18} /></button>
          <button type="button" class="btn" onClick={() => setWhy(true)}><CalendarClock size={18} />{' '}{tr('study.por_que_esta_fecha')}</button>
          <button type="button" class="btn icon" aria-label={tr('study.mas_acciones')} onClick={() => setMore(true)}><MoreHorizontal size={18} /></button>
        </div>
      </div>
      {queue.recovery.active && (
        <div class="banner glass">⚠ <span class="k"><b>{tr('study.modo_recuperacion')}</b>{' '}{tr('study.tienes_duetotal_vencidas_hoy_repasas_las', { dueTotal: queue.dueTotal, cap: queue.recovery.cap, daysToCatchUp: queue.recovery.daysToCatchUp })}</span></div>
      )}
      {leech && (
        <div class="banner glass">⚠ <span class="k"><b>{tr('study.sanguijuela')}</b>{' '}{tr('study.lapses_lapsos_sugerencias_dividela_en_tarj', { lapses: st.card.lapses })}</span>
          <button type="button" class="btn small" onClick={async () => { await stateOp(app.vault, col, [entry.ref.cid], 'suspend', params); done.add(entry.ref.cid); setCur(null); }}>{tr('decks.suspender')}</button>
        </div>
      )}
      <article class="study-card glass strong" aria-live="polite" key={entry.ref.cid}>
        {entry.ref.note.origin === 'ia' && <span class="chip" style={{ alignSelf: 'flex-start' }}>{tr('notes.origen_ia')}</span>}
        {(marks[entry.ref.cid]?.mark || marks[entry.ref.cid]?.flag) && <span class="row" style={{ gap: '6px' }}>{marks[entry.ref.cid]?.mark && <span class="chip">★ {tr('keys.marcada')}</span>}{marks[entry.ref.cid]?.flag && <span class="chip">⚑ {tr('keys.no_la_se')}</span>}</span>}
        <CardView card={entry.ref} revealed={revealed} onReveal={() => setRevealed(true)} onSuggest={setSuggest} startedAt={started} seed={seed.current + entry.ref.cid} />
        {entry.ref.note.src && revealed && <a class="foot" href={entry.ref.note.src.includes('.pdf') ? `#/espacios/abrir/${encodeURIComponent(entry.ref.note.src)}` : `#/notas/${encodeURIComponent(entry.ref.note.src.split('#')[0]!)}`}>{tr('study.ver_origen_src', { src: entry.ref.note.src })}</a>}
      </article>
      <KeyFeedback last={lastKey} />
      <div class="grades glass" role="group" aria-label={tr('design.calificacion')}>
        {!revealed ? (
          isInteractive(entry.ref) ? <p class="t2 center" style={{ gridColumn: '1 / -1', padding: '14px' }}>{tr('study.responde_en_la_tarjeta_para_calificar')}</p> : (
            <button type="button" class="grade inv" style={{ gridColumn: '1 / -1' }} onClick={() => setRevealed(true)}>
              <Eye size={18} />{' '}{tr('study.mostrar_respuesta')}{' '}<span class="iv">{tr('study.espacio')}</span>
            </button>
          )
        ) : (
          ([1, 2, 3, 4] as Rating[]).map((r) => (
            <button type="button" key={r} class={`grade${r === 3 ? ' inv' : ''}${sug === r ? ' suggested' : ''}`} onClick={() => answer(r)} aria-label={tr('study.p_vuelve_en_p2', { p: RATING_LABEL[r], p2: formatInterval(Date.now(), prev[r].due.getTime()) })} disabled={busy}>
              {ICON[r]} {RATING_LABEL[r]}
              <span class="iv">{formatInterval(Date.now(), prev[r].due.getTime())} · {r}</span>
            </button>
          ))
        )}
      </div>
      {sug && revealed && <p class="foot center">{tr('study.sugerencia_resaltada_p_la_decision_es', { p: RATING_LABEL[sug] })}</p>}

      {why && (
        <Sheet title={tr('study.por_que_esta_fecha')} onClose={() => setWhy(false)}>
          <div class="stack">
            <p style={{ fontSize: 'var(--t-3)' }}>{ex.phrase}</p>
            <div>
              <div class="kv"><span class="k">{tr('study.dificultad_d')}</span><span class="v">{ex.D.toFixed(2)} / 10</span></div>
              <div class="kv"><span class="k">{tr('study.estabilidad_s')}</span><span class="v">{ex.S.toFixed(1)}{' '}{tr('today.dias')}</span></div>
              <div class="kv"><span class="k">{tr('study.recuperabilidad_actual_r')}</span><span class="v">{ex.state === 0 ? '—' : `${Math.round(ex.R * 100)} %`}</span></div>
              <div class="kv"><span class="k">{tr('explorar.lapsos')}</span><span class="v">{ex.lapses}</span></div>
              <div class="kv"><span class="k">{tr('study.repasos')}</span><span class="v">{ex.reps}</span></div>
              <div class="kv"><span class="k">{tr('study.proximo_vencimiento')}</span><span class="v">{new Date(ex.due).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })}</span></div>
            </div>
            <div>
              <h3 style={{ fontSize: 'var(--t-body)', marginBottom: '6px' }}>{tr('study.ultimas_respuestas')}</h3>
              {ex.last.length ? (
                <div class="row wrap">{ex.last.map((h) => <span class={`chip${h.rating === 3 ? ' solid' : ''}`} data-tip={new Date(h.ts).toLocaleString(locale())}>{RATING_LABEL[h.rating]}</span>)}</div>
              ) : <p class="t2">{tr('study.aun_sin_respuestas')}</p>}
            </div>
            <p class="foot">{tr('study.fsrs_calcula_cuando_tu_probabilidad_de')}{' '}{Math.round(s.retention * 100)}{' '}{tr('study.repasar_antes_o_despues_no_rompe')}</p>
          </div>
        </Sheet>
      )}
      {edit && <EditNote deckPath={entry.deck.path} noteId={entry.ref.note.id} raw={entry.ref.note.raw} onClose={() => setEdit(false)} />}
      {more && (
        <Sheet title={tr('study.acciones')} onClose={() => setMore(false)}>
          <div class="stack">
            <button type="button" class="btn" onClick={async () => { await stateOp(app.vault, col, [entry.ref.cid], 'bury', params, dayKey(Date.now(), s.timeZone, s.dayStartHour)); done.add(entry.ref.cid); setMore(false); setCur(null); app.toast(tr('study.enterrada')); }}>{tr('study.enterrar_hasta_manana')}</button>
            <button type="button" class="btn" onClick={async () => { await stateOp(app.vault, col, [entry.ref.cid], 'suspend', params); done.add(entry.ref.cid); setMore(false); setCur(null); app.toast(tr('study.tarjeta_suspendida')); }}>{tr('decks.suspender')}</button>
            <button type="button" class="btn danger" onClick={async () => { if (!confirm(tr('study.confirm_olvidar'))) return; await stateOp(app.vault, col, [entry.ref.cid], 'forget', params); setMore(false); setCur(null); }}><X size={16} />{' '}{tr('study.olvidar_reiniciar')}</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** Editar durante el repaso (SPEC §9 add-on 5): cambia solo el bloque de esta nota. */
export function EditNote(props: { deckPath: string; noteId: string; raw: string; onClose: () => void }) {
  const app = useApp();
  const [text, setText] = useState(props.raw.replace(/\s\^[A-Za-z0-9_-]+\s*$/, ''));
  return (
    <Sheet title={tr('notes.editar_tarjeta')} onClose={props.onClose}>
      <form class="stack" onSubmit={async (e) => {
        e.preventDefault();
        const full = await readTextOr(app.vault, props.deckPath, '');
        await app.vault.write(props.deckPath, replaceBlock(full, props.noteId, text.replace(/\n\s*\n/g, '\n')));
        app.changed();
        props.onClose();
        app.toast(tr('study.tarjeta_guardada'));
      }}>
        <textarea class="input code" style={{ minHeight: '30dvh' }} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} aria-label={tr('study.texto_de_la_tarjeta')} />
        <p class="foot">{tr('study.el_id_noteid_se_conserva_asi', { noteId: props.noteId })}</p>
        <button class="btn primary" type="submit">{tr('calendar.guardar')}</button>
      </form>
    </Sheet>
  );
}
