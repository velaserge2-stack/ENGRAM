import { CalendarPlus, Check, ChevronLeft, ChevronRight, Download, NotebookPen, Play, Upload, Wand2 } from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import { useExtra } from '../data/extra';
import { deliver } from '../io/share';
import { addDays, dayKey, daysBetween, weekdayMon } from '../lib/days';
import { decksForTopic, fmtDate, topicStats } from '../lib/exams';
import { fromICS, occurrences, type StudyBlock, toICS } from '../lib/ics';
import { srsParams } from '../lib/settings';
import { activity, avgDaily, forecast, studyMs } from '../lib/stats';
import { go, href, useApp, useAsync } from '../state';
import { PageTitle, Segmented, Sheet, Switch } from '../ui/kit';
import { readTextOr, walk } from '../vault/util';
import { loadAttempts } from './simulacros';

const CAL = 'calendar/estudio.ics';
const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
type View = 'mes' | 'semana' | 'dia' | 'agenda';
const LAYERS = [['forecast', 'Pronóstico'], ['exams', 'Exámenes'], ['sims', 'Simulacros'], ['focus', 'Tiempo y pomodoro'], ['blocks', 'Bloques'], ['tasks', 'Tareas y diaria'], ['imported', 'Importados']] as const;
type Layer = (typeof LAYERS)[number][0];

const localDay = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function loadBlocks(vault: ReturnType<typeof useApp>['vault']) {
  const own = fromICS(await readTextOr(vault, CAL, ''));
  const imported: StudyBlock[] = [];
  for (const f of await walk(vault, 'calendar')) if (f.path !== CAL && f.path.endsWith('.ics')) imported.push(...fromICS(await readTextOr(vault, f.path, ''), f.name));
  const tasks: { date: string; text: string; note: string }[] = [];
  for (const f of await walk(vault, 'notes')) {
    if (!f.path.endsWith('.md')) continue;
    const t = await readTextOr(vault, f.path, '');
    for (const m of t.matchAll(/^\s*- \[ \] (.+?)\s+(?:📅|@)\s?(\d{4}-\d{2}-\d{2})/gm)) tasks.push({ date: m[2]!, text: m[1]!, note: f.path });
  }
  return { own, imported, tasks };
}

export function Calendar() {
  const app = useApp();
  const s = app.settings;
  const col = app.col;
  const today = dayKey(Date.now(), s.timeZone, s.dayStartHour);
  const [view, setView] = useState<View>('mes');
  const [anchor, setAnchor] = useState(today);
  const [sel, setSel] = useState(today);
  const [layers, setLayers] = useState<Record<Layer, boolean>>({ forecast: true, exams: true, sims: true, focus: true, blocks: true, tasks: true, imported: true });
  const [edit, setEdit] = useState<StudyBlock | null>(null);
  const [plan, setPlan] = useState<StudyBlock[] | null>(null);
  const [showLayers, setShowLayers] = useState(false);
  const { data } = useAsync(() => loadBlocks(app.vault), [app.version]);
  const { data: ex } = useExtra();
  const { data: attempts } = useAsync(() => loadAttempts(app.vault), [app.version]);
  const fc = useMemo(() => (col ? new Map(forecast(col, Date.now(), s.timeZone, s.dayStartHour, 120).map((x) => [x.day, x.n])) : new Map<string, number>()), [col]);
  const act = activity(col?.log ?? [], ex?.extra ?? { pomodoro: [], exams: [] }, s.timeZone, s.dayStartHour);
  const avg = avgDaily(act, today);
  const saveOwn = async (blocks: StudyBlock[]) => {
    await app.vault.write(CAL, toICS(blocks));
    app.changed();
  };

  // rango visible
  let days: string[];
  if (view === 'mes') {
    const first = anchor.slice(0, 8) + '01';
    const start = addDays(first, -((weekdayMon(first) + (s.weekStartsMonday ? 0 : 1)) % 7));
    days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  } else if (view === 'semana') {
    const start = addDays(anchor, -weekdayMon(anchor));
    days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  } else if (view === 'dia') days = [anchor];
  else days = Array.from({ length: 30 }, (_, i) => addDays(anchor, i));
  const from = days[0]!;
  const to = days[days.length - 1]!;

  const occ = (blocks: StudyBlock[]) => blocks.flatMap((b) => occurrences(b, from, to, localDay).map((o) => ({ ...o, b })));
  const own = data ? occ(data.own) : [];
  const imp = data && layers.imported ? occ(data.imported) : [];
  const byDay = (d: string) => ({
    load: fc.get(d) ?? 0,
    exams: layers.exams ? ex?.exams.filter((e) => e.date === d) ?? [] : [],
    sims: layers.sims ? attempts?.filter((a) => localDay(a.startedAt) === d) ?? [] : [],
    focus: layers.focus ? studyMs(act.get(d)) : 0,
    cards: act.get(d)?.cards ?? 0,
    blocks: layers.blocks ? own.filter((o) => o.date === d) : [],
    imported: imp.filter((o) => o.date === d),
    tasks: layers.tasks ? data?.tasks.filter((t) => t.date === d) ?? [] : [],
  });
  const step = (n: number) => setAnchor(view === 'mes' ? addDays(anchor.slice(0, 8) + '15', n * 30).slice(0, 8) + '01' : addDays(anchor, n * (view === 'semana' ? 7 : view === 'dia' ? 1 : 30)));
  const title = view === 'mes' ? new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(anchor.slice(0, 8) + '15T12:00:00Z')) : `${fmtDate(from)} – ${fmtDate(to)}`;

  // arrastrar bloques entre días (Pointer Events)
  const [drag, setDrag] = useState<{ uid: string; x: number; y: number } | null>(null);
  const dropOn = async (uid: string, date: string) => {
    if (!data) return;
    const b = data.own.find((x) => x.uid === uid);
    if (!b || b.rrule) return app.toast(b?.rrule ? 'Los bloques repetidos se editan desde su detalle' : '');
    const delta = daysBetween(localDay(b.start), date) * 86_400_000;
    await saveOwn(data.own.map((x) => (x.uid === uid ? { ...x, start: x.start + delta, end: x.end + delta } : x)));
  };

  const cell = (d: string) => {
    const x = byDay(d);
    const high = layers.forecast && avg > 0 && x.load > 1.5 * avg;
    return (
      <button type="button" class={`day${d.slice(0, 7) !== anchor.slice(0, 7) && view === 'mes' ? ' out' : ''}${d === today ? ' today' : ''}${d === sel ? ' sel' : ''}`} data-day={d} onClick={() => setSel(d)} aria-label={`${d}: ${x.load} repasos previstos`}>
        <span class="row"><span class="n">{Number(d.slice(8))}</span>{x.cards >= s.streakMin && <span title="Día de racha">•</span>}<span class="grow" />{layers.forecast && x.load > 0 && <span class="num t2">{x.load}</span>}</span>
        {layers.forecast && x.load > 0 && <span class={`load${high ? ' high' : ''}`} style={{ width: `${Math.min(100, (x.load / Math.max(1, avg * 2)) * 100)}%` }} aria-hidden="true" />}
        {x.exams.map((e) => <span class="ev solid">🎯 {e.name}</span>)}
        {x.blocks.map((o) => (
          <span class={`ev drag${o.b.done.includes(d) ? ' done' : ''}`} onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag({ uid: o.b.uid, x: e.clientX, y: e.clientY }); }}
            onPointerUp={(e) => {
              if (!drag) return;
              const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8;
              const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-day]');
              setDrag(null);
              if (moved && target?.dataset.day && target.dataset.day !== d) void dropOn(o.b.uid, target.dataset.day);
              else setEdit(o.b);
            }}>{new Date(o.start).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} {o.b.title}</span>
        ))}
        {x.imported.map((o) => <span class="ev" style={{ borderStyle: 'dotted' }}>{o.b.title}</span>)}
        {x.sims.map((a) => <span class="ev">📝 Simulacro</span>)}
        {x.tasks.map((t) => <span class="ev">☐ {t.text}</span>)}
        {layers.focus && x.focus > 0 && <span class="foot">{Math.round(x.focus / 60000)} min</span>}
      </button>
    );
  };

  const d = byDay(sel);
  const suggestDeck = col?.decks.map((dk) => ({ dk, n: dk.cards.filter((c) => { const st = col.states.get(c.cid); return st && st.card.state !== 0 && localDay(st.card.due.getTime()) <= sel; }).length })).sort((a, b) => b.n - a.n)[0];

  const proposePlan = () => {
    if (!ex || !col) return;
    const exam = ex.exams.find((e) => e.date > today);
    if (!exam) return app.toast('Añade un examen con fecha futura para sugerir un plan');
    const lastDay = addDays(exam.date, -Math.max(1, exam.finalDays));
    const pending = exam.topics.map((t) => topicStats(col, t, exam.goal, Date.now(), srsParams(s))).filter((t) => !t.complete);
    const span = Math.max(1, daysBetween(today, lastDay));
    const blocks: StudyBlock[] = pending.map((t, i) => {
      const day = addDays(today, 1 + Math.floor((i * span) / Math.max(1, pending.length)));
      const [y, m, dd] = day.split('-').map(Number) as [number, number, number];
      const start = new Date(y, m - 1, dd, 18, 0).getTime();
      return { uid: `plan-${Date.now()}-${i}@engrama`, start, end: start + 60 * 60_000, title: `Estudiar ${t.topic}`, subject: exam.name, note: `${t.newLeft} nuevas restantes · dominio ${Math.round(t.mastery * 100)} %`, rrule: '', until: '', done: [], alarmMin: 10 };
    });
    for (let k = addDays(lastDay, 1); k < exam.date; k = addDays(k, 1)) {
      const [y, m, dd] = k.split('-').map(Number) as [number, number, number];
      const start = new Date(y, m - 1, dd, 18, 0).getTime();
      blocks.push({ uid: `plan-${Date.now()}-f${k}@engrama`, start, end: start + 45 * 60_000, title: `Repaso final · ${exam.name}`, subject: exam.name, note: '', rrule: '', until: '', done: [], alarmMin: 10 });
    }
    setPlan(blocks);
  };

  return (
    <>
      <PageTitle title="Calendario" sub={title}>
        <Segmented label="Vista" value={view} onChange={setView} options={[['mes', 'Mes'], ['semana', 'Semana'], ['dia', 'Día'], ['agenda', 'Agenda']]} />
        <button type="button" class="btn icon" aria-label="Anterior" onClick={() => step(-1)}><ChevronLeft size={18} /></button>
        <button type="button" class="btn small" onClick={() => (setAnchor(today), setSel(today))}>Hoy</button>
        <button type="button" class="btn icon" aria-label="Siguiente" onClick={() => step(1)}><ChevronRight size={18} /></button>
        <button type="button" class="btn" onClick={() => setShowLayers(true)}>Capas</button>
        <button type="button" class="btn" onClick={proposePlan}><Wand2 size={18} /> Plan semanal</button>
      </PageTitle>
      <div class="grid" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(260px, 1fr)', alignItems: 'start' }}>
        <section class="glass panel">
          {view === 'agenda' ? (
            <div class="stack-s">{days.map((k) => { const x = byDay(k); const items = [...x.exams.map((e) => `🎯 ${e.name}`), ...x.blocks.map((o) => `${new Date(o.start).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })} ${o.b.title}`), ...x.imported.map((o) => o.b.title), ...x.tasks.map((t) => `☐ ${t.text}`)]; return items.length || x.load ? <button type="button" class="row-i tap" style={{ border: 0, background: 'none', width: '100%', textAlign: 'left' }} onClick={() => setSel(k)}><div class="k"><b>{fmtDate(k)}</b><small>{items.join(' · ') || '—'}</small></div><span class="v">{x.load} repasos</span></button> : null; })}</div>
          ) : (
            <div class="cal" style={view === 'dia' ? { gridTemplateColumns: '1fr' } : undefined}>
              {view !== 'dia' && (s.weekStartsMonday ? DOW : [DOW[6]!, ...DOW.slice(0, 6)]).map((w) => <span class="dow">{w}</span>)}
              {days.map(cell)}
            </div>
          )}
          <p class="foot" style={{ marginTop: '8px' }}>La barra de cada día es el pronóstico de repasos; gruesa = carga alta (&gt; 1.5× tu promedio de {Math.round(avg)}). Arrastra un bloque a otro día para moverlo.</p>
        </section>
        <section class="glass panel stack-s" aria-label="Día seleccionado">
          <h2 style={{ fontSize: 'var(--t-3)' }}>{new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(sel + 'T12:00:00Z'))}</h2>
          <div class="kv"><span class="k">Repasos previstos</span><span class="v">{d.load}</span></div>
          {avg > 0 && d.load > 1.5 * avg && <div class="err">⚠ Día con carga alta: introduce menos nuevas los días previos para repartirla.</div>}
          <div class="kv"><span class="k">Estudiado</span><span class="v">{d.cards} tarjetas · {Math.round(d.focus / 60000)} min</span></div>
          {suggestDeck && suggestDeck.n > 0 && <p class="note">Sugerencia: estudia <b>{suggestDeck.dk.full}</b> ({suggestDeck.n} vencen).</p>}
          {d.exams.map((e) => <div class="chip solid">🎯 {e.name}</div>)}
          {[...d.blocks, ...d.imported].map((o) => (
            <div class="inset row" style={{ padding: '8px 10px', borderRadius: 'var(--r-row)' }}>
              <div class="grow"><b style={{ textDecoration: o.b.done.includes(sel) ? 'line-through' : 'none' }}>{o.b.title}</b><div class="foot">{new Date(o.start).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}–{new Date(o.end).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}{o.b.subject ? ` · ${o.b.subject}` : ''}{o.b.readonly ? ' · importado' : ''}</div></div>
              {!o.b.readonly && (
                <>
                  <button type="button" class="btn icon small" aria-label="Marcar como hecho" aria-pressed={o.b.done.includes(sel)} onClick={() => data && saveOwn(data.own.map((x) => (x.uid === o.b.uid ? { ...x, done: x.done.includes(sel) ? x.done.filter((y) => y !== sel) : [...x.done, sel] } : x)))}><Check size={16} /></button>
                  <button type="button" class="btn icon small" aria-label="Iniciar bloque" onClick={() => { app.pomo.start(o.b.title); const dk = col?.decks.find((x) => o.b.subject && (x.full.includes(o.b.subject) || o.b.subject.includes(x.name))); go(dk ? 'estudiar' : 'espacios', ...(dk ? dk.path.split('/') : [])); }}><Play size={16} /></button>
                </>
              )}
            </div>
          ))}
          {d.tasks.map((t) => <a class="note" href={href('notas', ...t.note.split('/').slice(1))}>☐ {t.text}</a>)}
          <div class="row wrap">
            <button type="button" class="btn small" onClick={() => { const [y, m, dd] = sel.split('-').map(Number) as [number, number, number]; const st = new Date(y, m - 1, dd, 18, 0).getTime(); setEdit({ uid: `${Date.now().toString(36)}@engrama`, start: st, end: st + 3600_000, title: '', subject: '', note: '', rrule: '', until: '', done: [], alarmMin: 10 }); }}><CalendarPlus size={16} /> Bloque</button>
            <a class="btn small" href={href('notas', '+diaria', sel)}><NotebookPen size={16} /> Nota diaria</a>
          </div>
          <div class="row wrap" style={{ marginTop: '8px' }}>
            <button type="button" class="btn small" onClick={async () => { if (!data) return; await deliver(new File([toICS(data.own)], 'engrama-estudio.ics', { type: 'text/calendar' })); }}><Download size={16} /> Exportar .ics</button>
            <label class="btn small"><Upload size={16} /> Importar .ics<input type="file" hidden accept=".ics,text/calendar" onChange={async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; const t = await f.text(); const n = fromICS(t, f.name).length; await app.vault.write(`calendar/${f.name.replace(/[^\w.-]+/g, '_')}`, t); app.changed(); app.toast(`${n} eventos importados (solo lectura)`); }} /></label>
          </div>
          <p class="foot">Una web no puede escribir en el Calendario de iOS ni enviar notificaciones fiables: exporta el .ics (con alarmas) y ábrelo en Calendario.</p>
        </section>
      </div>
      {showLayers && (
        <Sheet title="Capas" onClose={() => setShowLayers(false)}>
          {LAYERS.map(([k, l]) => <div class="row-i"><span class="k">{l}</span><Switch label={l} checked={layers[k]} onChange={(v) => setLayers({ ...layers, [k]: v })} /></div>)}
          <div class="row-i"><span class="k">La semana empieza en lunes</span><Switch label="Semana en lunes" checked={s.weekStartsMonday} onChange={(v) => app.update({ weekStartsMonday: v })} /></div>
        </Sheet>
      )}
      {edit && data && <BlockEditor block={edit} onClose={() => setEdit(null)} onSave={async (b) => { await saveOwn(data.own.some((x) => x.uid === b.uid) ? data.own.map((x) => (x.uid === b.uid ? b : x)) : [...data.own, b]); setEdit(null); }} onDelete={async () => { await saveOwn(data.own.filter((x) => x.uid !== edit.uid)); setEdit(null); }} />}
      {plan && (
        <Sheet title="Plan sugerido" onClose={() => setPlan(null)}>
          <div class="stack-s">
            <p class="note">Bloques repartidos hasta el examen según los temas pendientes. No se crea nada sin tu confirmación.</p>
            {plan.map((b, i) => <div class="row-i"><div class="k">{b.title}<small>{new Date(b.start).toLocaleString('es-MX', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {b.note}</small></div><button type="button" class="btn icon small" aria-label="Quitar" onClick={() => setPlan(plan.filter((_, k) => k !== i))}>✕</button></div>)}
            <button type="button" class="btn primary" onClick={async () => { await saveOwn([...(data?.own ?? []), ...plan]); setPlan(null); app.toast(`${plan.length} bloques añadidos`); }}>Aceptar plan</button>
          </div>
        </Sheet>
      )}
    </>
  );
}

function BlockEditor(p: { block: StudyBlock; onClose: () => void; onSave: (b: StudyBlock) => void; onDelete: () => void }) {
  const [b, setB] = useState(p.block);
  const iso = (ms: number) => { const d = new Date(ms); return `${localDay(ms)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const dur = Math.round((b.end - b.start) / 60000);
  return (
    <Sheet title={p.block.title ? 'Bloque de estudio' : 'Nuevo bloque'} onClose={p.onClose}>
      <form class="stack" onSubmit={(e) => (e.preventDefault(), p.onSave(b))}>
        <label class="field">Título<input class="input" required value={b.title} onInput={(e) => setB({ ...b, title: (e.target as HTMLInputElement).value })} placeholder="Repasar ECG" /></label>
        <label class="field">Materia / tema<input class="input" value={b.subject} onInput={(e) => setB({ ...b, subject: (e.target as HTMLInputElement).value })} /></label>
        <div class="row wrap">
          <label class="field">Inicio<input class="input" type="datetime-local" value={iso(b.start)} onInput={(e) => { const t = new Date((e.target as HTMLInputElement).value).getTime(); if (Number.isFinite(t)) setB({ ...b, start: t, end: t + dur * 60000 }); }} /></label>
          <label class="field">Duración (min)<input class="input" type="number" min={5} value={dur} onInput={(e) => setB({ ...b, end: b.start + Number((e.target as HTMLInputElement).value) * 60000 })} /></label>
          <label class="field">Repetir<select value={b.rrule} onChange={(e) => setB({ ...b, rrule: (e.target as HTMLSelectElement).value as StudyBlock['rrule'] })}><option value="">No</option><option value="DAILY">Diario</option><option value="WEEKLY">Semanal</option></select></label>
          <label class="field">Recordatorio (min antes, en el .ics)<input class="input" type="number" min={0} value={b.alarmMin ?? ''} onInput={(e) => setB({ ...b, alarmMin: (e.target as HTMLInputElement).value === '' ? null : Number((e.target as HTMLInputElement).value) })} /></label>
        </div>
        <label class="field">Nota<textarea class="input" rows={2} value={b.note} onInput={(e) => setB({ ...b, note: (e.target as HTMLTextAreaElement).value })} /></label>
        <div class="row"><button class="btn primary" type="submit">Guardar</button>{p.block.title && <button type="button" class="btn danger" onClick={p.onDelete}>Eliminar</button>}</div>
      </form>
    </Sheet>
  );
}

export { decksForTopic };
