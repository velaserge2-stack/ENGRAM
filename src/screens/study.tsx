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
import { useApp } from '../state';
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
  speechSynthesis.speak(u);
}

export function Study(props: { filter: string | null }) {
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
    if (r === 1 && isLeech(st, s.leechThreshold) && st.card.lapses === s.leechThreshold) app.toast('Sanguijuela: esta tarjeta se olvida mucho. Divídela, añade imagen o mnemotecnia, o suspéndela.');
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
    app.toast('Repaso deshecho');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') return e.preventDefault(), void doUndo();
      if ((e.key === ' ' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) && !revealed && entry && !isInteractive(entry.ref)) return e.preventDefault(), setRevealed(true);
      if (revealed && ['1', '2', '3', '4'].includes(e.key)) return e.preventDefault(), void answer(Number(e.key) as Rating);
      if (e.key.toLowerCase() === 'e' && entry) setEdit(true);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  if (!col || !queue) return <p class="t2">Cargando…</p>;
  const deckName = props.filter ? col.decks.find((d) => d.path === props.filter)?.full ?? props.filter.replace(/^decks\//, '').replace(/\/$/, '') : 'Todos los mazos';
  const left = queue.learning.filter((c) => !done.has(c)).length + queue.review.filter((c) => !done.has(c)).length + queue.fresh.filter((c) => !done.has(c)).length;

  if (!entry || !st || !prev) {
    return (
      <div class="study">
        <PageTitle title="Estudiar" sub={deckName} />
        <Empty icon={<Check size={44} />} title={count ? '¡Listo por ahora!' : 'Nada que repasar'} action={
          <div class="row wrap" style={{ justifyContent: 'center' }}>
            <button type="button" class="btn" onClick={() => setExtraNew((n) => n + 10)}>Estudiar 10 nuevas más</button>
            <a class="btn primary" href="#/hoy">Volver a Hoy</a>
          </div>
        }>
          {count ? `Repasaste ${count} ${count === 1 ? 'tarjeta' : 'tarjetas'} en esta sesión.` : 'No hay tarjetas vencidas ni nuevas disponibles con tus límites diarios.'}
          {queue.nextLearningAt ? ` La siguiente de aprendizaje vuelve a las ${new Date(queue.nextLearningAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}.` : ''}
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
      <div class="row wrap" style={{ justifyContent: 'space-between' }}>
        <div class="title-chip glass row">
          <span aria-hidden="true">{deckEmoji(app, entry.deck)}</span>
          <b>{entry.deck.full}</b>
          <span class="t2 num">· quedan {left}</span>
        </div>
        <div class="row">
          <button type="button" class="btn icon glass" aria-label="Deshacer (⌘Z)" title="Deshacer (⌘Z)" disabled={!undo.length} onClick={doUndo}><Undo2 size={18} /></button>
          <button type="button" class="btn icon glass" aria-label="Leer en voz alta" title="Leer en voz alta" onClick={() => speak(plainText(revealed ? `${entry.ref.note.front}. ${entry.ref.note.back}` : entry.ref.note.front), lang)}><Volume2 size={18} /></button>
          <button type="button" class="btn icon glass" aria-label="Editar tarjeta (E)" title="Editar (E)" onClick={() => setEdit(true)}><Pencil size={18} /></button>
          <button type="button" class="btn glass" onClick={() => setWhy(true)}><CalendarClock size={18} /> ¿Por qué esta fecha?</button>
          <button type="button" class="btn icon glass" aria-label="Más acciones" onClick={() => setMore(true)}><MoreHorizontal size={18} /></button>
        </div>
      </div>
      {queue.recovery.active && (
        <div class="banner glass">⚠ <span class="k"><b>Modo recuperación:</b> tienes {queue.dueTotal} vencidas. Hoy repasas las {queue.recovery.cap} más olvidadas primero. Te pondrás al día en {queue.recovery.daysToCatchUp} días.</span></div>
      )}
      {leech && (
        <div class="banner glass">⚠ <span class="k"><b>Sanguijuela</b> ({st.card.lapses} lapsos). Sugerencias: divídela en tarjetas más pequeñas, añade una imagen o una mnemotecnia, o suspéndela.</span>
          <button type="button" class="btn small" onClick={async () => { await stateOp(app.vault, col, [entry.ref.cid], 'suspend', params); done.add(entry.ref.cid); setCur(null); }}>Suspender</button>
        </div>
      )}
      <article class="study-card glass strong" aria-live="polite" key={entry.ref.cid}>
        {entry.ref.note.origin === 'ia' && <span class="chip" style={{ alignSelf: 'flex-start' }}>origen: IA</span>}
        <CardView card={entry.ref} revealed={revealed} onReveal={() => setRevealed(true)} onSuggest={setSuggest} startedAt={started} seed={seed.current + entry.ref.cid} />
        {entry.ref.note.src && revealed && <a class="foot" href={entry.ref.note.src.includes('.pdf') ? `#/espacios/abrir/${encodeURIComponent(entry.ref.note.src)}` : `#/notas/${encodeURIComponent(entry.ref.note.src.split('#')[0]!)}`}>Ver origen: {entry.ref.note.src}</a>}
      </article>
      <div class="grades glass" role="group" aria-label="Calificación">
        {!revealed ? (
          isInteractive(entry.ref) ? <p class="t2 center" style={{ gridColumn: '1 / -1', padding: '14px' }}>Responde en la tarjeta para calificar.</p> : (
            <button type="button" class="grade inv" style={{ gridColumn: '1 / -1' }} onClick={() => setRevealed(true)}>
              <Eye size={18} /> Mostrar respuesta <span class="iv">Espacio · ⌘↩</span>
            </button>
          )
        ) : (
          ([1, 2, 3, 4] as Rating[]).map((r) => (
            <button type="button" key={r} class={`grade${r === 3 ? ' inv' : ''}${sug === r ? ' suggested' : ''}`} onClick={() => answer(r)} aria-label={`${RATING_LABEL[r]}, vuelve en ${formatInterval(Date.now(), prev[r].due.getTime())}`} disabled={busy}>
              {ICON[r]} {RATING_LABEL[r]}
              <span class="iv">{formatInterval(Date.now(), prev[r].due.getTime())} · {r}</span>
            </button>
          ))
        )}
      </div>
      {sug && revealed && <p class="foot center">Sugerencia resaltada ({RATING_LABEL[sug]}); la decisión es tuya.</p>}

      {why && (
        <Sheet title="¿Por qué esta fecha?" onClose={() => setWhy(false)}>
          <div class="stack">
            <p style={{ fontSize: 'var(--t-3)' }}>{ex.phrase}</p>
            <div>
              <div class="kv"><span class="k">Dificultad (D)</span><span class="v">{ex.D.toFixed(2)} / 10</span></div>
              <div class="kv"><span class="k">Estabilidad (S)</span><span class="v">{ex.S.toFixed(1)} días</span></div>
              <div class="kv"><span class="k">Recuperabilidad actual (R)</span><span class="v">{ex.state === 0 ? '—' : `${Math.round(ex.R * 100)} %`}</span></div>
              <div class="kv"><span class="k">Lapsos</span><span class="v">{ex.lapses}</span></div>
              <div class="kv"><span class="k">Repasos</span><span class="v">{ex.reps}</span></div>
              <div class="kv"><span class="k">Próximo vencimiento</span><span class="v">{new Date(ex.due).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}</span></div>
            </div>
            <div>
              <h3 style={{ fontSize: 'var(--t-body)', marginBottom: '6px' }}>Últimas respuestas</h3>
              {ex.last.length ? (
                <div class="row wrap">{ex.last.map((h) => <span class={`chip${h.rating === 3 ? ' solid' : ''}`} title={new Date(h.ts).toLocaleString('es-MX')}>{RATING_LABEL[h.rating]}</span>)}</div>
              ) : <p class="t2">Aún sin respuestas.</p>}
            </div>
            <p class="foot">FSRS calcula cuándo tu probabilidad de recordarla baja a {Math.round(s.retention * 100)} %. Repasar antes o después no rompe nada: se usa la R real del momento.</p>
          </div>
        </Sheet>
      )}
      {edit && <EditNote deckPath={entry.deck.path} noteId={entry.ref.note.id} raw={entry.ref.note.raw} onClose={() => setEdit(false)} />}
      {more && (
        <Sheet title="Acciones" onClose={() => setMore(false)}>
          <div class="stack">
            <button type="button" class="btn" onClick={async () => { await stateOp(app.vault, col, [entry.ref.cid], 'bury', params, dayKey(Date.now(), s.timeZone, s.dayStartHour)); done.add(entry.ref.cid); setMore(false); setCur(null); app.toast('Enterrada hasta mañana'); }}>Enterrar hasta mañana</button>
            <button type="button" class="btn" onClick={async () => { await stateOp(app.vault, col, [entry.ref.cid], 'suspend', params); done.add(entry.ref.cid); setMore(false); setCur(null); app.toast('Tarjeta suspendida'); }}>Suspender</button>
            <button type="button" class="btn danger" onClick={async () => { if (!confirm('¿Olvidar esta tarjeta? Vuelve a ser nueva; el historial se conserva.')) return; await stateOp(app.vault, col, [entry.ref.cid], 'forget', params); setMore(false); setCur(null); }}><X size={16} /> Olvidar (reiniciar)</button>
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
    <Sheet title="Editar tarjeta" onClose={props.onClose}>
      <form class="stack" onSubmit={async (e) => {
        e.preventDefault();
        const full = await readTextOr(app.vault, props.deckPath, '');
        await app.vault.write(props.deckPath, replaceBlock(full, props.noteId, text.replace(/\n\s*\n/g, '\n')));
        app.changed();
        props.onClose();
        app.toast('Tarjeta guardada; conserva su historial');
      }}>
        <textarea class="input code" style={{ minHeight: '30dvh' }} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} aria-label="Texto de la tarjeta" />
        <p class="foot">El ID ^{props.noteId} se conserva, así la tarjeta mantiene su programación.</p>
        <button class="btn primary" type="submit">Guardar</button>
      </form>
    </Sheet>
  );
}
