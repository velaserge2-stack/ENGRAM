import { locale, t as tr } from '../i18n';
import { Bookmark, ChevronLeft, ChevronRight, ClipboardCheck, FileUp, Flag, Play, Repeat, Sparkles } from 'lucide-preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ATTEMPTS } from '../data/extra';
import { appendCard, createDeck, safeName } from '../data/ops';
import { extractText } from '../io/extract';
import { type Bank, byTopic, finalize, isCorrect, parseBankCSV, parseBankJSON, parseBankMarkdown, parseText, type Question, score, serializeBank, summarize } from '../sim/parse';
import { go, useApp, useAsync } from '../state';
import { Bar, Empty, PageTitle, Segmented, Sheet } from '../ui/kit';
import { extname } from '../vault/paths';
import { readTextOr, walk } from '../vault/util';
import { shuffle } from './cardview';
import { modalOpen } from '../ui/overlay';

const CURRENT = '.app/exam-current.json';

export interface Attempt {
  id: string;
  title: string;
  banks: string[];
  mode: 'sim' | 'practice' | 'errors';
  qs: { bank: string; q: Question; order: string[] }[];
  answers: Record<string, string[]>;
  checked: string[];
  marked: string[];
  startedAt: number;
  endAt: number | null;
  finishedAt?: number;
  elapsedMs?: number;
  perQ: Record<string, number>;
  cur: number;
  penalty: number;
  pass: number;
}

async function loadBanks(vault: ReturnType<typeof useApp>['vault']): Promise<{ path: string; bank: Bank }[]> {
  const out = [];
  for (const f of await walk(vault, 'exams-bank')) if (f.path.endsWith('.md')) out.push({ path: f.path, bank: parseBankMarkdown(await readTextOr(vault, f.path, ''), f.name.replace(/\.md$/, '')) });
  return out;
}

export async function loadAttempts(vault: ReturnType<typeof useApp>['vault']): Promise<Attempt[]> {
  const out: Attempt[] = [];
  for (const l of (await readTextOr(vault, ATTEMPTS, '')).split('\n')) {
    try {
      if (l.trim()) out.push(JSON.parse(l) as Attempt);
    } catch {
      /* línea dañada */
    }
  }
  return out;
}

export function Simulacros(props: { route: string[] }) {
  const [sub, arg] = props.route;
  if (sub === 'importar') return <ImportBank />;
  if (sub === 'hacer') return <Runner />;
  if (sub === 'resultado' && arg) return <Results id={arg} />;
  return <SimHome />;
}

function SimHome() {
  const app = useApp();
  const { data } = useAsync(async () => ({ banks: await loadBanks(app.vault), attempts: await loadAttempts(app.vault), current: JSON.parse((await readTextOr(app.vault, CURRENT, 'null')) || 'null') as Attempt | null }), [app.version]);
  const [create, setCreate] = useState(false);
  return (
    <>
      <PageTitle title={tr('calendar.simulacros')} sub={tr('simulacros.examenes_de_practica_con_cronometro_no')}>
        <a class="btn" href="#/simulacros/importar"><FileUp size={18} />{' '}{tr('simulacros.importar_examen')}</a>
        <button type="button" class="btn primary" disabled={!data?.banks.length} onClick={() => setCreate(true)}><Play size={18} />{' '}{tr('palette.crear_simulacro')}</button>
      </PageTitle>
      {data?.current && !data.current.finishedAt && (
        <div class="banner glass"><Flag size={18} /><span class="k"><b>{data.current.title}</b>{' '}{tr('simulacros.quedo_a_medias_tus_respuestas_y')}</span><a class="btn small primary" href="#/simulacros/hacer">{tr('simulacros.continuar_simulacro')}</a></div>
      )}
      {!data ? <p class="t2">{tr('deck.cargando')}</p> : data.banks.length === 0 ? (
        <Empty icon={<ClipboardCheck size={44} />} title={tr('simulacros.sin_bancos_de_preguntas')} action={<a class="btn primary" href="#/simulacros/importar">{tr('simulacros.importar_examen')}</a>}>{tr('simulacros.importa_un_archivo_markdown_csv_json')}</Empty>
      ) : (
        <div class="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <section class="glass panel">
            <h2 style={{ fontSize: 'var(--t-3)', marginBottom: '8px' }}>{tr('simulacros.bancos')}</h2>
            {data.banks.map((b) => {
              const ok = b.bank.questions.filter((q) => !q.problems.length).length;
              return <div class="kv"><span class="k">{b.bank.name}</span><span class="v">{ok} listas{b.bank.questions.length - ok ? tr('simulacros.p_borrador', { p: b.bank.questions.length - ok }) : ''}</span></div>;
            })}
          </section>
          <section class="glass panel">
            <h2 style={{ fontSize: 'var(--t-3)', marginBottom: '8px' }}>{tr('simulacros.intentos')}</h2>
            {data.attempts.length ? data.attempts.slice(-12).reverse().map((a) => {
              const sc = score(a.qs.map((x) => x.q), a.answers, a.penalty, a.pass);
              return <a class="kv" href={`#/simulacros/resultado/${a.id}`} style={{ textDecoration: 'none' }}><span class="k">{a.title} · {new Date(a.startedAt).toLocaleDateString(locale())}</span><span class="v">{Math.round(sc.pct * 100)} % {sc.passed ? '✓' : ''}</span></a>;
            }) : <p class="t2">{tr('simulacros.aun_no_hay_intentos')}</p>}
          </section>
        </div>
      )}
      {create && data && <CreateSim banks={data.banks} attempts={data.attempts} onClose={() => setCreate(false)} />}
    </>
  );
}

function CreateSim(props: { banks: { path: string; bank: Bank }[]; attempts: Attempt[]; onClose: () => void }) {
  const app = useApp();
  const [sel, setSel] = useState<string[]>(props.banks.map((b) => b.path));
  const pool = props.banks.filter((b) => sel.includes(b.path)).flatMap((b) => b.bank.questions.filter((q) => !q.problems.length).map((q) => ({ bank: b.path, q })));
  const topics = [...new Set(pool.map((x) => x.q.topic || tr('simulacros.sin_tema')))].sort();
  const [tsel, setTsel] = useState<string[] | null>(null);
  const [n, setN] = useState(Math.min(40, pool.length || 40));
  const [minutes, setMinutes] = useState(props.banks[0]?.bank.minutes ?? 60);
  const [filter, setFilter] = useState<'all' | 'failed' | 'unseen'>('all');
  const [mode, setMode] = useState<Attempt['mode']>('sim');
  const [shuf, setShuf] = useState(true);
  const [penalty, setPenalty] = useState(0);
  const [pass, setPass] = useState(60);
  const seen = new Map<string, boolean>();
  for (const a of props.attempts) for (const x of a.qs) if (a.answers[x.q.id]?.length) seen.set(x.q.id, (seen.get(x.q.id) ?? false) || !isCorrect(x.q, a.answers[x.q.id]));
  let chosen = pool.filter((x) => !tsel || tsel.includes(x.q.topic || tr('simulacros.sin_tema')));
  if (filter === 'failed') chosen = chosen.filter((x) => seen.get(x.q.id) === true);
  if (filter === 'unseen') chosen = chosen.filter((x) => !seen.has(x.q.id));
  const start = async () => {
    const seed = String(Date.now());
    const picked = (shuf ? shuffle(chosen, seed) : chosen).slice(0, n);
    const at: Attempt = {
      id: Date.now().toString(36), title: props.banks.filter((b) => sel.includes(b.path)).map((b) => b.bank.name).join(' + '), banks: sel, mode,
      qs: picked.map((x) => ({ ...x, order: shuf ? shuffle(x.q.options.map((o) => o.key), seed + x.q.id) : x.q.options.map((o) => o.key) })),
      answers: {}, checked: [], marked: [], startedAt: Date.now(), endAt: mode === 'sim' ? Date.now() + minutes * 60_000 : null, perQ: {}, cur: 0, penalty, pass: pass / 100,
    };
    await app.vault.write(CURRENT, JSON.stringify(at));
    go('simulacros', 'hacer');
  };
  return (
    <Sheet title={tr('palette.crear_simulacro')} onClose={props.onClose}>
      <div class="stack">
        <fieldset class="field" style={{ border: 0, padding: 0 }}><legend>{tr('simulacros.bancos')}</legend>
          <div class="row wrap">{props.banks.map((b) => <button type="button" class={`btn small${sel.includes(b.path) ? ' primary' : ''}`} aria-pressed={sel.includes(b.path)} onClick={() => setSel(sel.includes(b.path) ? sel.filter((x) => x !== b.path) : [...sel, b.path])}>{b.bank.name}</button>)}</div>
        </fieldset>
        <fieldset class="field" style={{ border: 0, padding: 0 }}><legend>{tr('simulacros.temas')}</legend>
          <div class="row wrap">{topics.map((t) => { const on = !tsel || tsel.includes(t); return <button type="button" class={`btn small${on ? ' primary' : ''}`} aria-pressed={on} onClick={() => setTsel(on ? (tsel ?? topics).filter((x) => x !== t) : [...(tsel ?? []), t])}>{t}</button>; })}</div>
        </fieldset>
        <Segmented label={tr('simulacros.preguntas')} value={filter} onChange={setFilter} options={[['all', tr('simulacros.todas')], ['failed', tr('simulacros.solo_falladas')], ['unseen', tr('simulacros.solo_no_vistas')]]} />
        <Segmented label={tr('deck.modo')} value={mode} onChange={setMode} options={[['sim', tr('simulacros.simulacro')], ['practice', tr('simulacros.practica')], ['errors', tr('simulacros.repaso_de_errores')]]} />
        <div class="row wrap">
          <label class="field">{tr('simulacros.numero')}<input class="input" type="number" min={1} max={chosen.length} value={Math.min(n, chosen.length)} onInput={(e) => setN(Number((e.target as HTMLInputElement).value))} /></label>
          {mode === 'sim' && <label class="field">{tr('heatmap.minutos')}<input class="input" type="number" min={1} value={minutes} onInput={(e) => setMinutes(Number((e.target as HTMLInputElement).value))} /></label>}
          <label class="field">{tr('simulacros.penalizacion_por_error')}<input class="input" type="number" min={0} max={1} step={0.05} value={penalty} onInput={(e) => setPenalty(Number((e.target as HTMLInputElement).value))} /></label>
          <label class="field">{tr('simulacros.aprobado')}<input class="input" type="number" min={1} max={100} value={pass} onInput={(e) => setPass(Number((e.target as HTMLInputElement).value))} /></label>
        </div>
        <label class="row"><input type="checkbox" checked={shuf} onChange={(e) => setShuf((e.target as HTMLInputElement).checked)} />{' '}{tr('simulacros.orden_aleatorio_de_preguntas_y_opciones')}</label>
        <button type="button" class="btn primary" disabled={!chosen.length} onClick={start}>{tr('simulacros.empezar_n', { n: Math.min(n, chosen.length) })}</button>
      </div>
    </Sheet>
  );
}

function Runner() {
  const app = useApp();
  const [at, setAt] = useState<Attempt | null>(null);
  const [now, setNow] = useState(Date.now());
  const [shownAt, setShownAt] = useState(Date.now());
  const [confirmEnd, setConfirmEnd] = useState(false);
  useEffect(() => {
    void readTextOr(app.vault, CURRENT, 'null').then((t) => setAt(JSON.parse(t || 'null') as Attempt | null));
    app.focus(true);
    return () => app.focus(false);
  }, []);
  // El reloj solo refresca la pantalla; el tiempo real es endAt − ahora.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    const vis = () => setNow(Date.now());
    document.addEventListener('visibilitychange', vis);
    return () => (clearInterval(iv), document.removeEventListener('visibilitychange', vis));
  }, []);
  // ref con el intento vigente: teclas rápidas seguidas no deben usar un estado viejo
  const atRef = useRef<Attempt | null>(null);
  atRef.current = atRef.current && at && atRef.current.id === at.id && (atRef.current.startedAt === at.startedAt) ? atRef.current : at;
  const save = async (next: Attempt) => {
    atRef.current = next;
    setAt(next);
    await app.vault.write(CURRENT, JSON.stringify(next));
  };
  const finish = async (a: Attempt) => {
    const done: Attempt = { ...a, finishedAt: Date.now(), elapsedMs: Math.min(Date.now(), a.endAt ?? Date.now()) - a.startedAt };
    const prev = await readTextOr(app.vault, ATTEMPTS, '');
    await app.vault.write(ATTEMPTS, prev + JSON.stringify(done) + '\n');
    await app.vault.remove(CURRENT);
    app.changed();
    go('simulacros', 'resultado', done.id);
  };
  useEffect(() => {
    if (at && at.endAt && now >= at.endAt && !at.finishedAt) void finish(at);
  }, [now, at]);
  const q = at?.qs[at.cur];
  const keyFor = (k: number) => { const a = atRef.current; return a?.qs[a.cur]?.order[k]; };
  const choose = (key: string) => {
    const at = atRef.current;
    const q = at?.qs[at.cur];
    if (!at || !q) return;
    if (at.mode !== 'sim' && at.checked.includes(q.q.id)) return;
    const prevA = at.answers[q.q.id] ?? [];
    const multi = q.q.answer.length > 1;
    const nextA = multi ? (prevA.includes(key) ? prevA.filter((x) => x !== key) : [...prevA, key]) : [key];
    const spent = (at.perQ[q.q.id] ?? 0) + (Date.now() - shownAt);
    setShownAt(Date.now());
    void save({ ...at, answers: { ...at.answers, [q.q.id]: nextA }, perQ: { ...at.perQ, [q.q.id]: spent } });
  };
  const goTo = (i: number) => {
    const at = atRef.current;
    const q = at?.qs[at.cur];
    if (!at || i < 0 || i >= at.qs.length) return;
    setShownAt(Date.now());
    void save({ ...at, cur: i, perQ: q ? { ...at.perQ, [q.q.id]: (at.perQ[q.q.id] ?? 0) + (Date.now() - shownAt) } : at.perQ });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = atRef.current;
      if (!a || modalOpen() || (e.target as HTMLElement).closest('input, textarea')) return;
      const qq = a.qs[a.cur];
      const k = e.key.toUpperCase();
      const i = 'ABCDEF'.indexOf(k);
      if (k.length === 1 && i >= 0 && keyFor(i)) choose(keyFor(i)!);
      else if (e.key === 'ArrowRight') goTo(a.cur + 1);
      else if (e.key === 'ArrowLeft') goTo(a.cur - 1);
      else if (k === 'M' && qq) void save({ ...a, marked: a.marked.includes(qq.q.id) ? a.marked.filter((x) => x !== qq.q.id) : [...a.marked, qq.q.id] });
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });
  if (!at) return <Empty icon={<ClipboardCheck size={44} />} title={tr('simulacros.no_hay_un_simulacro_en_curso')} action={<a class="btn primary" href="#/simulacros">{tr('simulacros.volver')}</a>}>{tr('simulacros.crea_uno_desde_simulacros')}</Empty>;
  if (!q) return null;
  const left = at.endAt ? Math.max(0, at.endAt - now) : null;
  const mm = left === null ? null : `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
  const given = at.answers[q.q.id] ?? [];
  const checked = at.mode !== 'sim' && at.checked.includes(q.q.id);
  return (
    <div class="study">
      <div class="row wrap glass" style={{ justifyContent: 'space-between', padding: '8px 12px', borderRadius: 'var(--r-panel)' }}>
        <span><b>{at.title}</b> · {at.mode === 'sim' ? tr('simulacros.simulacro') : at.mode === 'practice' ? tr('simulacros.practica') : tr('simulacros.repaso_de_errores')}</span>
        {mm && <span class="timer" role="timer" aria-label={tr('simulacros.tiempo_restante_mm', { mm: mm })}>{mm}</span>}
        <button type="button" class="btn" onClick={() => setConfirmEnd(true)}><Flag size={18} />{' '}{tr('simulacros.terminar')}</button>
      </div>
      <section class="glass panel"><div class="qnav" role="navigation" aria-label={tr('simulacros.preguntas')}>
        {at.qs.map((x, i) => <button type="button" class={`${at.answers[x.q.id]?.length ? 'answered' : ''}${at.marked.includes(x.q.id) ? ' marked' : ''}${i === at.cur ? ' cur' : ''}`} aria-label={tr('simulacros.pregunta_pp2p3', { p: i + 1, p2: at.answers[x.q.id]?.length ? ', respondida' : ', sin responder', p3: at.marked.includes(x.q.id) ? ', marcada' : '' })} onClick={() => goTo(i)}>{i + 1}</button>)}
      </div></section>
      <article class="study-card glass strong" data-user-content style={{ fontSize: '1.2rem' }}>
        {q.q.case && <div class="inset" style={{ padding: '12px 14px', borderRadius: 'var(--r-row)', fontSize: '1rem' }}><b>{tr('simulacros.caso_clinico')}</b> {q.q.case}</div>}
        <p><b>{at.cur + 1}.</b> {q.q.text}</p>
        <div class="stack-s">
          {q.order.map((key, k) => {
            const o = q.q.options.find((x) => x.key === key)!;
            const on = given.includes(key);
            const cls = checked ? (q.q.answer.includes(key) ? ' ok' : on ? ' bad' : '') : '';
            return <button type="button" class={`opt${cls}`} aria-pressed={on} onClick={() => choose(key)}><b>{'ABCDEF'[k]}</b> {o.text}</button>;
          })}
        </div>
        {q.q.answer.length > 1 && <p class="foot">{tr('simulacros.varias_respuestas_correctas')}</p>}
        {checked && (
          <div class="inset" style={{ padding: '12px', borderRadius: 'var(--r-row)' }}>
            <b>{isCorrect(q.q, given) ? tr('cardview.correcto') : tr('simulacros.correcta_p', { p: q.q.answer.map((a) => 'ABCDEF'[q.order.indexOf(a)]).join(', ') })}</b>
            {q.q.explanation && <p class="note" style={{ marginTop: '6px' }}>{q.q.explanation}</p>}
          </div>
        )}
      </article>
      <div class="grades glass" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <button type="button" class="grade" disabled={at.cur === 0} onClick={() => goTo(at.cur - 1)}><ChevronLeft size={18} />{' '}{tr('calendar.anterior')}{' '}<span class="iv">←</span></button>
        {at.mode !== 'sim' && !checked ? (
          <button type="button" class="grade inv" disabled={!given.length} onClick={() => save({ ...at, checked: [...at.checked, q.q.id] })}>{tr('cardview.comprobar')}</button>
        ) : (
          <button type="button" class={`grade${at.marked.includes(q.q.id) ? ' inv' : ''}`} aria-pressed={at.marked.includes(q.q.id)} onClick={() => save({ ...at, marked: at.marked.includes(q.q.id) ? at.marked.filter((x) => x !== q.q.id) : [...at.marked, q.q.id] })}><Bookmark size={18} />{' '}{tr('notes.marcar')}{' '}<span class="iv">M</span></button>
        )}
        <button type="button" class="grade" onClick={() => (at.cur === at.qs.length - 1 ? setConfirmEnd(true) : goTo(at.cur + 1))}>{at.cur === at.qs.length - 1 ? tr('simulacros.terminar') : tr('calendar.siguiente')} <ChevronRight size={18} /> <span class="iv">→</span></button>
      </div>
      <p class="foot center">{tr('simulacros.a_e_responder_navegar_m_marcar')}</p>
      {confirmEnd && (
        <Sheet title={tr('simulacros.terminar_2')} onClose={() => setConfirmEnd(false)}>
          <div class="stack">
            <p>{tr('simulacros.respondiste_n_de_n2', { n: Object.values(at.answers).filter((a) => a.length).length, n2: at.qs.length })}{' '}{at.marked.length ? tr('simulacros.n_marcadas_para_revisar', { n: at.marked.length }) : ''}</p>
            <button type="button" class="btn primary" onClick={() => finish(at)}>{tr('simulacros.terminar_y_ver_resultados')}</button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function Results(props: { id: string }) {
  const app = useApp();
  const { data } = useAsync(() => loadAttempts(app.vault), [app.version]);
  const [onlyBad, setOnlyBad] = useState(false);
  const a = data?.find((x) => x.id === props.id);
  const qs = useMemo(() => a?.qs.map((x) => x.q) ?? [], [a]);
  if (!data) return <p class="t2">{tr('deck.cargando')}</p>;
  if (!a) return <p>{tr('simulacros.no_se_encontro_el_intento')}</p>;
  const sc = score(qs, a.answers, a.penalty, a.pass);
  const topics = byTopic(qs, a.answers);
  const prev = data.filter((x) => x.title === a.title && x.id !== a.id).slice(-5);
  const failed = a.qs.filter((x) => !isCorrect(x.q, a.answers[x.q.id]));
  const mkCards = async () => {
    const name = a.title.split(' + ')[0] ?? tr('simulacros.simulacro');
    const path = `decks/Simulacros/${safeName(name)}.md`;
    if (!(await app.vault.exists(path))) await app.vault.write(path, `---\ndeck: ${safeName(name)}\ntags: [simulacro]\n---\n`);
    for (const x of failed) {
      const q = x.q;
      const head = (q.case ? `${q.case.replace(/\n/g, ' ')} — ` : '') + q.text.replace(/\n/g, ' ');
      const block = `MC:: ${head}\n${q.options.map((o) => `- [${q.answer.includes(o.key) ? 'x' : ' '}] ${o.text}`).join('\n')}${q.explanation ? `\nA:: ${q.explanation.replace(/\n/g, ' ')}` : ''} <!-- src: ${x.bank} -->`;
      await appendCard(app.vault, path, block, app.col);
    }
    app.changed();
    app.toast(tr('simulacros.n_tarjetas_creadas_en_path', { n: failed.length, path: path }));
  };
  const retry = async () => {
    const at: Attempt = { ...a, id: Date.now().toString(36), qs: failed, answers: {}, checked: [], marked: [], startedAt: Date.now(), endAt: a.endAt ? Date.now() + Math.max(5, failed.length * 1.5) * 60_000 : null, finishedAt: undefined, elapsedMs: undefined, perQ: {}, cur: 0, mode: a.mode === 'sim' ? 'sim' : 'errors' };
    await app.vault.write(CURRENT, JSON.stringify(at));
    go('simulacros', 'hacer');
  };
  const per = a.elapsedMs && qs.length ? Math.round(a.elapsedMs / 1000 / qs.length) : 0;
  return (
    <>
      <PageTitle title={tr('simulacros.resultados')} sub={`${a.title} · ${new Date(a.startedAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })}`}>
        <button type="button" class="btn" disabled={!failed.length} onClick={mkCards}><Sparkles size={18} />{' '}{tr('simulacros.crear_tarjetas_de_las_falladas')}</button>
        <button type="button" class="btn primary" disabled={!failed.length} onClick={retry}><Repeat size={18} />{' '}{tr('simulacros.repetir_solo_las_falladas')}</button>
      </PageTitle>
      <div class="grid cards3">
        <section class="glass panel center stack-s"><div class="big">{Math.round(sc.pct * 100)}<small>%</small></div><p class="t2">{tr('simulacros.points_de_n_puntos', { points: sc.points, n: qs.length })}{' '}{sc.passed ? tr('simulacros.aprobado_2') : tr('simulacros.no_aprobado')} {tr('simulacros.umbral', { n: Math.round(a.pass * 100) })}</p></section>
        <section class="glass panel stack-s"><div class="kv"><span class="k">{tr('simulacros.correctas')}</span><span class="v">{sc.correct}</span></div><div class="kv"><span class="k">{tr('simulacros.incorrectas')}</span><span class="v">{sc.wrong}</span></div><div class="kv"><span class="k">{tr('simulacros.en_blanco')}</span><span class="v">{sc.blank}</span></div><div class="kv"><span class="k">{tr('simulacros.tiempo_total')}</span><span class="v">{Math.round((a.elapsedMs ?? 0) / 60000)} min</span></div><div class="kv"><span class="k">{tr('simulacros.por_pregunta')}</span><span class="v">{per} s</span></div></section>
        <section class="glass panel stack-s"><h3>{tr('simulacros.intentos_anteriores')}</h3>{prev.length ? prev.map((p) => { const s2 = score(p.qs.map((x) => x.q), p.answers, p.penalty, p.pass); return <div class="kv"><span class="k">{new Date(p.startedAt).toLocaleDateString(locale())}</span><span class="v">{Math.round(s2.pct * 100)} %</span></div>; }) : <p class="t2">{tr('simulacros.es_el_primero')}</p>}</section>
      </div>
      <section class="glass panel stack-s" style={{ marginTop: '16px' }}>
        <h2 style={{ fontSize: 'var(--t-3)' }}>{tr('simulacros.por_tema')}</h2>
        {topics.map((t) => <div><div class="kv"><span class="k">{t.topic}</span><span class="v">{t.ok}/{t.n}</span></div><Bar value={t.ok / t.n} label={`${t.topic}: ${t.ok} de ${t.n}`} /></div>)}
      </section>
      <section class="glass strong panel stack-s" style={{ marginTop: '16px' }}>
        <div class="row"><h2 style={{ fontSize: 'var(--t-3)' }} class="grow">{tr('simulacros.revision')}</h2><label class="row note"><input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad((e.target as HTMLInputElement).checked)} />{' '}{tr('simulacros.solo_falladas')}</label></div>
        {a.qs.filter((x) => !onlyBad || !isCorrect(x.q, a.answers[x.q.id])).map((x) => {
          const ok = isCorrect(x.q, a.answers[x.q.id]);
          return (
            <div class="inset" style={{ padding: '12px', borderRadius: 'var(--r-row)' }} data-user-content>
              <p><b>{ok ? '✓' : '✗'} {a.qs.indexOf(x) + 1}.</b> {x.q.text} <span class="foot">{Math.round((a.perQ[x.q.id] ?? 0) / 1000)} s</span></p>
              <ul style={{ margin: '6px 0', paddingLeft: '1.2em' }}>{x.q.options.map((o) => <li style={{ fontWeight: x.q.answer.includes(o.key) ? 700 : 400, textDecoration: a.answers[x.q.id]?.includes(o.key) && !x.q.answer.includes(o.key) ? 'line-through' : 'none' }}>{x.q.answer.includes(o.key) ? '✓ ' : ''}{o.text}{a.answers[x.q.id]?.includes(o.key) ? tr('simulacros.tu_respuesta') : ''}</li>)}</ul>
              {x.q.explanation && <p class="note t2">{x.q.explanation}</p>}
            </div>
          );
        })}
      </section>
    </>
  );
}

function ImportBank() {
  const app = useApp();
  const [name, setName] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [qs, setQs] = useState<Question[] | null>(null);
  const [warn, setWarn] = useState<string[]>([]);
  const [paste, setPaste] = useState('');
  const [onlyBad, setOnlyBad] = useState(false);
  const load = async (f: File) => {
    const ext = extname(f.name);
    setName(f.name.replace(/\.[^.]+$/, ''));
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      if (ext === 'xlsx' || ext === 'xls') return setWarn([tr('simulacros.las_hojas_xlsx_no_se_leen')]);
      if (ext === 'csv' || ext === 'tsv') return (setQs(parseBankCSV(new TextDecoder().decode(bytes))), setWarn([]));
      if (ext === 'json') return (setQs(parseBankJSON(new TextDecoder().decode(bytes))), setWarn([]));
      if (ext === 'md') {
        const b = parseBankMarkdown(new TextDecoder().decode(bytes), f.name);
        setName(b.name);
        setMinutes(b.minutes);
        return (setQs(b.questions), setWarn([]));
      }
      const t = await extractText(f.name, bytes);
      setWarn(t.warnings);
      setQs(parseText(t.text));
    } catch (e) {
      setWarn([tr('simulacros.no_se_pudo_leer_message_prueba', { message: (e as Error).message })]);
    }
  };
  const upd = (i: number, patch: Partial<Question>) => setQs((arr) => arr!.map((q, k) => (k === i ? finalize({ ...q, ...patch }) : q)));
  const save = async () => {
    if (!qs) return;
    const path = `exams-bank/${safeName(name || 'Banco')}.md`;
    await app.vault.write(path, serializeBank({ name: name || tr('simulacros.banco'), minutes, shuffle: true, questions: qs }));
    app.changed();
    app.toast(tr('simulacros.banco_guardado_las_dudosas_quedan_como'));
    go('simulacros');
  };
  return (
    <>
      <PageTitle title={tr('simulacros.importar_examen')} sub={tr('simulacros.markdown_nativo_el_mas_fiable_csv')} />
      <div class="stack">
        <section class="glass panel stack">
          <label class="btn" style={{ justifySelf: 'start' }}><FileUp size={18} />{' '}{tr('simulacros.elegir_archivo')}<input type="file" hidden accept=".md,.txt,.csv,.tsv,.json,.docx,.pdf,.xlsx" onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void load(f); }} /></label>
          <details><summary>{tr('simulacros.o_pega_el_texto')}</summary>
            <textarea class="input code" style={{ minHeight: '20dvh', marginTop: '8px' }} value={paste} onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)} placeholder={tr('simulacros.1_pregunta_a_b_respuesta_b')} />
            <button type="button" class="btn small" onClick={() => (setQs(parseText(paste)), setWarn([]))}>{tr('simulacros.analizar_texto')}</button>
          </details>
          {warn.map((w) => <div class="err">⚠ {w}</div>)}
        </section>
        {qs && (
          <section class="glass strong panel stack">
            <p style={{ fontSize: 'var(--t-3)' }}>{summarize(qs)}.</p>
            <p class="foot">{tr('simulacros.las_preguntas_dudosas_se_marcan_corrigelas')}</p>
            <div class="row wrap">
              <label class="field">{tr('simulacros.nombre_del_banco')}<input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
              <label class="field">{tr('heatmap.minutos')}<input class="input" type="number" value={minutes} onInput={(e) => setMinutes(Number((e.target as HTMLInputElement).value))} /></label>
              <label class="row note"><input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad((e.target as HTMLInputElement).checked)} />{' '}{tr('simulacros.solo_dudosas')}</label>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table class="tbl">
                <thead><tr><th>#</th><th>{tr('deck.pregunta')}</th><th>{tr('simulacros.opciones')}</th><th>{tr('deck.respuesta')}</th><th>{tr('exams.tema')}</th></tr></thead>
                <tbody>
                  {qs.map((q, i) => (onlyBad && !q.problems.length ? null : (
                    <tr class={q.problems.length ? 'warn' : ''}>
                      <td class="num">{i + 1}{q.problems.length > 0 && <div class="chip" title={q.problems.join(', ')}>⚠ {q.problems[0]}</div>}</td>
                      <td style={{ minWidth: '220px' }}><textarea class="input wide" rows={2} value={q.text} onChange={(e) => upd(i, { text: (e.target as HTMLTextAreaElement).value })} aria-label={tr('simulacros.pregunta_p', { p: i + 1 })} /></td>
                      <td style={{ minWidth: '200px' }}>{q.options.map((o, k) => <div class="row"><b>{o.key}</b><input class="input grow" value={o.text} onChange={(e) => upd(i, { options: q.options.map((x, j) => (j === k ? { ...x, text: (e.target as HTMLInputElement).value } : x)) })} aria-label={tr('simulacros.opcion_key', { key: o.key })} /></div>)}
                        <button type="button" class="btn small" onClick={() => upd(i, { options: [...q.options, { key: 'ABCDEF'[q.options.length] ?? 'F', text: '' }] })}>{tr('simulacros.opcion')}</button></td>
                      <td><input class="input" style={{ width: '80px' }} value={q.answer.join(', ')} onChange={(e) => upd(i, { answer: [...new Set(((e.target as HTMLInputElement).value.toUpperCase().match(/[A-F]/g) ?? []))] })} aria-label={tr('simulacros.respuesta_p', { p: i + 1 })} /></td>
                      <td><input class="input" style={{ width: '140px' }} value={q.topic} onChange={(e) => upd(i, { topic: (e.target as HTMLInputElement).value })} aria-label={tr('simulacros.tema_p', { p: i + 1 })} /></td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
            <button type="button" class="btn primary" style={{ justifySelf: 'start' }} onClick={save}>{tr('simulacros.guardar_banco_n_listas', { n: qs.filter((q) => !q.problems.length).length })}</button>
          </section>
        )}
      </div>
    </>
  );
}
