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
      <PageTitle title="Simulacros" sub="Exámenes de práctica con cronómetro (no confundir con los exámenes reales de Hoy).">
        <a class="btn" href="#/simulacros/importar"><FileUp size={18} /> Importar examen</a>
        <button type="button" class="btn primary" disabled={!data?.banks.length} onClick={() => setCreate(true)}><Play size={18} /> Crear simulacro</button>
      </PageTitle>
      {data?.current && !data.current.finishedAt && (
        <div class="banner glass"><Flag size={18} /><span class="k"><b>{data.current.title}</b> quedó a medias. Tus respuestas y el tiempo restante se conservaron.</span><a class="btn small primary" href="#/simulacros/hacer">Continuar simulacro</a></div>
      )}
      {!data ? <p class="t2">Cargando…</p> : data.banks.length === 0 ? (
        <Empty icon={<ClipboardCheck size={44} />} title="Sin bancos de preguntas" action={<a class="btn primary" href="#/simulacros/importar">Importar examen</a>}>
          Importa un archivo Markdown, CSV, JSON, TXT, DOCX o PDF. Verás una vista previa para corregir lo dudoso antes de usarlo.
        </Empty>
      ) : (
        <div class="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <section class="glass panel">
            <h2 style={{ fontSize: 'var(--t-3)', marginBottom: '8px' }}>Bancos</h2>
            {data.banks.map((b) => {
              const ok = b.bank.questions.filter((q) => !q.problems.length).length;
              return <div class="kv"><span class="k">{b.bank.name}</span><span class="v">{ok} listas{b.bank.questions.length - ok ? ` · ${b.bank.questions.length - ok} borrador` : ''}</span></div>;
            })}
          </section>
          <section class="glass panel">
            <h2 style={{ fontSize: 'var(--t-3)', marginBottom: '8px' }}>Intentos</h2>
            {data.attempts.length ? data.attempts.slice(-12).reverse().map((a) => {
              const sc = score(a.qs.map((x) => x.q), a.answers, a.penalty, a.pass);
              return <a class="kv" href={`#/simulacros/resultado/${a.id}`} style={{ textDecoration: 'none' }}><span class="k">{a.title} · {new Date(a.startedAt).toLocaleDateString('es-MX')}</span><span class="v">{Math.round(sc.pct * 100)} % {sc.passed ? '✓' : ''}</span></a>;
            }) : <p class="t2">Aún no hay intentos.</p>}
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
  const topics = [...new Set(pool.map((x) => x.q.topic || 'Sin tema'))].sort();
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
  let chosen = pool.filter((x) => !tsel || tsel.includes(x.q.topic || 'Sin tema'));
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
    <Sheet title="Crear simulacro" onClose={props.onClose}>
      <div class="stack">
        <fieldset class="field" style={{ border: 0, padding: 0 }}><legend>Bancos</legend>
          <div class="row wrap">{props.banks.map((b) => <button type="button" class={`btn small${sel.includes(b.path) ? ' primary' : ''}`} aria-pressed={sel.includes(b.path)} onClick={() => setSel(sel.includes(b.path) ? sel.filter((x) => x !== b.path) : [...sel, b.path])}>{b.bank.name}</button>)}</div>
        </fieldset>
        <fieldset class="field" style={{ border: 0, padding: 0 }}><legend>Temas</legend>
          <div class="row wrap">{topics.map((t) => { const on = !tsel || tsel.includes(t); return <button type="button" class={`btn small${on ? ' primary' : ''}`} aria-pressed={on} onClick={() => setTsel(on ? (tsel ?? topics).filter((x) => x !== t) : [...(tsel ?? []), t])}>{t}</button>; })}</div>
        </fieldset>
        <Segmented label="Preguntas" value={filter} onChange={setFilter} options={[['all', 'Todas'], ['failed', 'Solo falladas'], ['unseen', 'Solo no vistas']]} />
        <Segmented label="Modo" value={mode} onChange={setMode} options={[['sim', 'Simulacro'], ['practice', 'Práctica'], ['errors', 'Repaso de errores']]} />
        <div class="row wrap">
          <label class="field">Número<input class="input" type="number" min={1} max={chosen.length} value={Math.min(n, chosen.length)} onInput={(e) => setN(Number((e.target as HTMLInputElement).value))} /></label>
          {mode === 'sim' && <label class="field">Minutos<input class="input" type="number" min={1} value={minutes} onInput={(e) => setMinutes(Number((e.target as HTMLInputElement).value))} /></label>}
          <label class="field">Penalización por error<input class="input" type="number" min={0} max={1} step={0.05} value={penalty} onInput={(e) => setPenalty(Number((e.target as HTMLInputElement).value))} /></label>
          <label class="field">Aprobado (%)<input class="input" type="number" min={1} max={100} value={pass} onInput={(e) => setPass(Number((e.target as HTMLInputElement).value))} /></label>
        </div>
        <label class="row"><input type="checkbox" checked={shuf} onChange={(e) => setShuf((e.target as HTMLInputElement).checked)} /> Orden aleatorio de preguntas y opciones</label>
        <button type="button" class="btn primary" disabled={!chosen.length} onClick={start}>Empezar ({Math.min(n, chosen.length)} preguntas)</button>
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
      if (!a || (e.target as HTMLElement).closest('input, textarea')) return;
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
  if (!at) return <Empty icon={<ClipboardCheck size={44} />} title="No hay un simulacro en curso" action={<a class="btn primary" href="#/simulacros">Volver</a>}>Crea uno desde Simulacros.</Empty>;
  if (!q) return null;
  const left = at.endAt ? Math.max(0, at.endAt - now) : null;
  const mm = left === null ? null : `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`;
  const given = at.answers[q.q.id] ?? [];
  const checked = at.mode !== 'sim' && at.checked.includes(q.q.id);
  return (
    <div class="study">
      <div class="row wrap glass" style={{ justifyContent: 'space-between', padding: '8px 12px', borderRadius: 'var(--r-panel)' }}>
        <span><b>{at.title}</b> · {at.mode === 'sim' ? 'Simulacro' : at.mode === 'practice' ? 'Práctica' : 'Repaso de errores'}</span>
        {mm && <span class="timer" role="timer" aria-label={`Tiempo restante ${mm}`}>{mm}</span>}
        <button type="button" class="btn" onClick={() => setConfirmEnd(true)}><Flag size={18} /> Terminar</button>
      </div>
      <section class="glass panel"><div class="qnav" role="navigation" aria-label="Preguntas">
        {at.qs.map((x, i) => <button type="button" class={`${at.answers[x.q.id]?.length ? 'answered' : ''}${at.marked.includes(x.q.id) ? ' marked' : ''}${i === at.cur ? ' cur' : ''}`} aria-label={`Pregunta ${i + 1}${at.answers[x.q.id]?.length ? ', respondida' : ', sin responder'}${at.marked.includes(x.q.id) ? ', marcada' : ''}`} onClick={() => goTo(i)}>{i + 1}</button>)}
      </div></section>
      <article class="study-card glass strong" data-user-content style={{ fontSize: '1.2rem' }}>
        {q.q.case && <div class="inset" style={{ padding: '12px 14px', borderRadius: 'var(--r-row)', fontSize: '1rem' }}><b>Caso clínico.</b> {q.q.case}</div>}
        <p><b>{at.cur + 1}.</b> {q.q.text}</p>
        <div class="stack-s">
          {q.order.map((key, k) => {
            const o = q.q.options.find((x) => x.key === key)!;
            const on = given.includes(key);
            const cls = checked ? (q.q.answer.includes(key) ? ' ok' : on ? ' bad' : '') : '';
            return <button type="button" class={`opt${cls}`} aria-pressed={on} onClick={() => choose(key)}><b>{'ABCDEF'[k]}</b> {o.text}</button>;
          })}
        </div>
        {q.q.answer.length > 1 && <p class="foot">Varias respuestas correctas.</p>}
        {checked && (
          <div class="inset" style={{ padding: '12px', borderRadius: 'var(--r-row)' }}>
            <b>{isCorrect(q.q, given) ? '✓ Correcto' : `✗ Correcta: ${q.q.answer.map((a) => 'ABCDEF'[q.order.indexOf(a)]).join(', ')}`}</b>
            {q.q.explanation && <p class="note" style={{ marginTop: '6px' }}>{q.q.explanation}</p>}
          </div>
        )}
      </article>
      <div class="grades glass" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <button type="button" class="grade" disabled={at.cur === 0} onClick={() => goTo(at.cur - 1)}><ChevronLeft size={18} /> Anterior <span class="iv">←</span></button>
        {at.mode !== 'sim' && !checked ? (
          <button type="button" class="grade inv" disabled={!given.length} onClick={() => save({ ...at, checked: [...at.checked, q.q.id] })}>Comprobar</button>
        ) : (
          <button type="button" class={`grade${at.marked.includes(q.q.id) ? ' inv' : ''}`} aria-pressed={at.marked.includes(q.q.id)} onClick={() => save({ ...at, marked: at.marked.includes(q.q.id) ? at.marked.filter((x) => x !== q.q.id) : [...at.marked, q.q.id] })}><Bookmark size={18} /> Marcar <span class="iv">M</span></button>
        )}
        <button type="button" class="grade" onClick={() => (at.cur === at.qs.length - 1 ? setConfirmEnd(true) : goTo(at.cur + 1))}>{at.cur === at.qs.length - 1 ? 'Terminar' : 'Siguiente'} <ChevronRight size={18} /> <span class="iv">→</span></button>
      </div>
      <p class="foot center">A–E responder · ←/→ navegar · M marcar. Se guarda tras cada respuesta: si Safari se cierra, al volver puedes continuar.</p>
      {confirmEnd && (
        <Sheet title="¿Terminar?" onClose={() => setConfirmEnd(false)}>
          <div class="stack">
            <p>Respondiste {Object.values(at.answers).filter((a) => a.length).length} de {at.qs.length}. {at.marked.length ? `${at.marked.length} marcadas para revisar.` : ''}</p>
            <button type="button" class="btn primary" onClick={() => finish(at)}>Terminar y ver resultados</button>
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
  if (!data) return <p class="t2">Cargando…</p>;
  if (!a) return <p>No se encontró el intento.</p>;
  const sc = score(qs, a.answers, a.penalty, a.pass);
  const topics = byTopic(qs, a.answers);
  const prev = data.filter((x) => x.title === a.title && x.id !== a.id).slice(-5);
  const failed = a.qs.filter((x) => !isCorrect(x.q, a.answers[x.q.id]));
  const mkCards = async () => {
    const name = a.title.split(' + ')[0] ?? 'Simulacro';
    const path = `decks/Simulacros/${safeName(name)}.md`;
    if (!(await app.vault.exists(path))) await app.vault.write(path, `---\ndeck: ${safeName(name)}\ntags: [simulacro]\n---\n`);
    for (const x of failed) {
      const q = x.q;
      const head = (q.case ? `${q.case.replace(/\n/g, ' ')} — ` : '') + q.text.replace(/\n/g, ' ');
      const block = `MC:: ${head}\n${q.options.map((o) => `- [${q.answer.includes(o.key) ? 'x' : ' '}] ${o.text}`).join('\n')}${q.explanation ? `\nA:: ${q.explanation.replace(/\n/g, ' ')}` : ''} <!-- src: ${x.bank} -->`;
      await appendCard(app.vault, path, block, app.col);
    }
    app.changed();
    app.toast(`${failed.length} tarjetas creadas en ${path}`);
  };
  const retry = async () => {
    const at: Attempt = { ...a, id: Date.now().toString(36), qs: failed, answers: {}, checked: [], marked: [], startedAt: Date.now(), endAt: a.endAt ? Date.now() + Math.max(5, failed.length * 1.5) * 60_000 : null, finishedAt: undefined, elapsedMs: undefined, perQ: {}, cur: 0, mode: a.mode === 'sim' ? 'sim' : 'errors' };
    await app.vault.write(CURRENT, JSON.stringify(at));
    go('simulacros', 'hacer');
  };
  const per = a.elapsedMs && qs.length ? Math.round(a.elapsedMs / 1000 / qs.length) : 0;
  return (
    <>
      <PageTitle title="Resultados" sub={`${a.title} · ${new Date(a.startedAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`}>
        <button type="button" class="btn" disabled={!failed.length} onClick={mkCards}><Sparkles size={18} /> Crear tarjetas de las falladas</button>
        <button type="button" class="btn primary" disabled={!failed.length} onClick={retry}><Repeat size={18} /> Repetir solo las falladas</button>
      </PageTitle>
      <div class="grid cards3">
        <section class="glass panel center stack-s"><div class="big">{Math.round(sc.pct * 100)}<small>%</small></div><p class="t2">{sc.points} de {qs.length} puntos · {sc.passed ? '✓ Aprobado' : '✗ No aprobado'} (umbral {Math.round(a.pass * 100)} %)</p></section>
        <section class="glass panel stack-s"><div class="kv"><span class="k">Correctas</span><span class="v">{sc.correct}</span></div><div class="kv"><span class="k">Incorrectas</span><span class="v">{sc.wrong}</span></div><div class="kv"><span class="k">En blanco</span><span class="v">{sc.blank}</span></div><div class="kv"><span class="k">Tiempo total</span><span class="v">{Math.round((a.elapsedMs ?? 0) / 60000)} min</span></div><div class="kv"><span class="k">Por pregunta</span><span class="v">{per} s</span></div></section>
        <section class="glass panel stack-s"><h3>Intentos anteriores</h3>{prev.length ? prev.map((p) => { const s2 = score(p.qs.map((x) => x.q), p.answers, p.penalty, p.pass); return <div class="kv"><span class="k">{new Date(p.startedAt).toLocaleDateString('es-MX')}</span><span class="v">{Math.round(s2.pct * 100)} %</span></div>; }) : <p class="t2">Es el primero.</p>}</section>
      </div>
      <section class="glass panel stack-s" style={{ marginTop: '16px' }}>
        <h2 style={{ fontSize: 'var(--t-3)' }}>Por tema</h2>
        {topics.map((t) => <div><div class="kv"><span class="k">{t.topic}</span><span class="v">{t.ok}/{t.n}</span></div><Bar value={t.ok / t.n} label={`${t.topic}: ${t.ok} de ${t.n}`} /></div>)}
      </section>
      <section class="glass strong panel stack-s" style={{ marginTop: '16px' }}>
        <div class="row"><h2 style={{ fontSize: 'var(--t-3)' }} class="grow">Revisión</h2><label class="row note"><input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad((e.target as HTMLInputElement).checked)} /> Solo falladas</label></div>
        {a.qs.filter((x) => !onlyBad || !isCorrect(x.q, a.answers[x.q.id])).map((x) => {
          const ok = isCorrect(x.q, a.answers[x.q.id]);
          return (
            <div class="inset" style={{ padding: '12px', borderRadius: 'var(--r-row)' }} data-user-content>
              <p><b>{ok ? '✓' : '✗'} {a.qs.indexOf(x) + 1}.</b> {x.q.text} <span class="foot">{Math.round((a.perQ[x.q.id] ?? 0) / 1000)} s</span></p>
              <ul style={{ margin: '6px 0', paddingLeft: '1.2em' }}>{x.q.options.map((o) => <li style={{ fontWeight: x.q.answer.includes(o.key) ? 700 : 400, textDecoration: a.answers[x.q.id]?.includes(o.key) && !x.q.answer.includes(o.key) ? 'line-through' : 'none' }}>{x.q.answer.includes(o.key) ? '✓ ' : ''}{o.text}{a.answers[x.q.id]?.includes(o.key) ? ' (tu respuesta)' : ''}</li>)}</ul>
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
      if (ext === 'xlsx' || ext === 'xls') return setWarn(['Las hojas .xlsx no se leen aquí: guárdala como CSV (columnas pregunta, a, b, c, d, e, correcta, explicación, tema).']);
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
      setWarn([`No se pudo leer: ${(e as Error).message}. Prueba pegando el texto.`]);
    }
  };
  const upd = (i: number, patch: Partial<Question>) => setQs((arr) => arr!.map((q, k) => (k === i ? finalize({ ...q, ...patch }) : q)));
  const save = async () => {
    if (!qs) return;
    const path = `exams-bank/${safeName(name || 'Banco')}.md`;
    await app.vault.write(path, serializeBank({ name: name || 'Banco', minutes, shuffle: true, questions: qs }));
    app.changed();
    app.toast('Banco guardado; las dudosas quedan como borrador');
    go('simulacros');
  };
  return (
    <>
      <PageTitle title="Importar examen" sub="Markdown nativo (el más fiable), CSV, JSON y, en modo mejor esfuerzo, TXT, DOCX y PDF." />
      <div class="stack">
        <section class="glass panel stack">
          <label class="btn" style={{ justifySelf: 'start' }}><FileUp size={18} /> Elegir archivo<input type="file" hidden accept=".md,.txt,.csv,.tsv,.json,.docx,.pdf,.xlsx" onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void load(f); }} /></label>
          <details><summary>…o pega el texto</summary>
            <textarea class="input code" style={{ minHeight: '20dvh', marginTop: '8px' }} value={paste} onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)} placeholder={'1. ¿Pregunta?\n   A) …\n   B) …\n   Respuesta: B'} />
            <button type="button" class="btn small" onClick={() => (setQs(parseText(paste)), setWarn([]))}>Analizar texto</button>
          </details>
          {warn.map((w) => <div class="err">⚠ {w}</div>)}
        </section>
        {qs && (
          <section class="glass strong panel stack">
            <p style={{ fontSize: 'var(--t-3)' }}>{summarize(qs)}.</p>
            <p class="foot">Las preguntas dudosas se marcan; corrígelas aquí. Lo no resuelto queda como borrador y no entra al simulacro. Nunca se adivina la respuesta correcta.</p>
            <div class="row wrap">
              <label class="field">Nombre del banco<input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
              <label class="field">Minutos<input class="input" type="number" value={minutes} onInput={(e) => setMinutes(Number((e.target as HTMLInputElement).value))} /></label>
              <label class="row note"><input type="checkbox" checked={onlyBad} onChange={(e) => setOnlyBad((e.target as HTMLInputElement).checked)} /> Solo dudosas</label>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table class="tbl">
                <thead><tr><th>#</th><th>Pregunta</th><th>Opciones</th><th>Respuesta</th><th>Tema</th></tr></thead>
                <tbody>
                  {qs.map((q, i) => (onlyBad && !q.problems.length ? null : (
                    <tr class={q.problems.length ? 'warn' : ''}>
                      <td class="num">{i + 1}{q.problems.length > 0 && <div class="chip" title={q.problems.join(', ')}>⚠ {q.problems[0]}</div>}</td>
                      <td style={{ minWidth: '220px' }}><textarea class="input wide" rows={2} value={q.text} onChange={(e) => upd(i, { text: (e.target as HTMLTextAreaElement).value })} aria-label={`Pregunta ${i + 1}`} /></td>
                      <td style={{ minWidth: '200px' }}>{q.options.map((o, k) => <div class="row"><b>{o.key}</b><input class="input grow" value={o.text} onChange={(e) => upd(i, { options: q.options.map((x, j) => (j === k ? { ...x, text: (e.target as HTMLInputElement).value } : x)) })} aria-label={`Opción ${o.key}`} /></div>)}
                        <button type="button" class="btn small" onClick={() => upd(i, { options: [...q.options, { key: 'ABCDEF'[q.options.length] ?? 'F', text: '' }] })}>+ opción</button></td>
                      <td><input class="input" style={{ width: '80px' }} value={q.answer.join(', ')} onChange={(e) => upd(i, { answer: [...new Set(((e.target as HTMLInputElement).value.toUpperCase().match(/[A-F]/g) ?? []))] })} aria-label={`Respuesta ${i + 1}`} /></td>
                      <td><input class="input" style={{ width: '140px' }} value={q.topic} onChange={(e) => upd(i, { topic: (e.target as HTMLInputElement).value })} aria-label={`Tema ${i + 1}`} /></td>
                    </tr>
                  )))}
                </tbody>
              </table>
            </div>
            <button type="button" class="btn primary" style={{ justifySelf: 'start' }} onClick={save}>Guardar banco ({qs.filter((q) => !q.problems.length).length} listas)</button>
          </section>
        )}
      </div>
    </>
  );
}
