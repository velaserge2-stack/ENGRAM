import { locale, t as tr } from '../i18n';
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
import { LinkChips, LinkPicker, startBlock, useLinkIndex } from '../ui/links';
import { type LinkIndex, resolveLink } from '../lib/links';
import { Link2 } from 'lucide-preact';

const CAL = 'calendar/estudio.ics';
const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
type View = 'mes' | 'semana' | 'dia' | 'agenda';
type Layer = 'forecast' | 'exams' | 'sims' | 'focus' | 'blocks' | 'tasks' | 'imported';
const LAYERS = (): [Layer, string][] => ([['forecast', tr('calendar.pronostico')], ['exams', tr('calendar.examenes')], ['sims', tr('calendar.simulacros')], ['focus', tr('calendar.tiempo_y_pomodoro')], ['blocks', tr('calendar.bloques')], ['tasks', tr('calendar.tareas_y_diaria')], ['imported', tr('calendar.importados')]]);

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
  const { data: lidx } = useLinkIndex();
  const label = (u: string) => (lidx ? resolveLink(u, lidx).label : u);
  const saveOwn = async (blocks: StudyBlock[]) => {
    await app.vault.write(CAL, toICS(blocks, undefined, label));
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
  const title = view === 'mes' ? new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(anchor.slice(0, 8) + '15T12:00:00Z')) : `${fmtDate(from)} – ${fmtDate(to)}`;

  // arrastrar bloques entre días (Pointer Events)
  const [drag, setDrag] = useState<{ uid: string; x: number; y: number } | null>(null);
  const dropOn = async (uid: string, date: string) => {
    if (!data) return;
    const b = data.own.find((x) => x.uid === uid);
    if (!b || b.rrule) return app.toast(b?.rrule ? tr('calendar.los_bloques_repetidos_se_editan_desde') : '');
    const delta = daysBetween(localDay(b.start), date) * 86_400_000;
    await saveOwn(data.own.map((x) => (x.uid === uid ? { ...x, start: x.start + delta, end: x.end + delta } : x)));
  };

  const cell = (d: string) => {
    const x = byDay(d);
    const high = layers.forecast && avg > 0 && x.load > 1.5 * avg;
    return (
      <button type="button" class={`day${d.slice(0, 7) !== anchor.slice(0, 7) && view === 'mes' ? ' out' : ''}${d === today ? ' today' : ''}${d === sel ? ' sel' : ''}`} data-day={d} onClick={() => setSel(d)} aria-label={tr('calendar.d_load_repasos_previstos', { d: d, load: x.load })}>
        <span class="row"><span class="n">{Number(d.slice(8))}</span>{x.cards >= s.streakMin && <span title={tr('calendar.dia_de_racha')}>•</span>}<span class="grow" />{layers.forecast && x.load > 0 && <span class="num t2">{x.load}</span>}</span>
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
            }}>{new Date(o.start).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })} {o.b.title}</span>
        ))}
        {x.imported.map((o) => <span class="ev" style={{ borderStyle: 'dotted' }}>{o.b.title}</span>)}
        {x.sims.map((a) => <span class="ev">{tr('calendar.simulacro')}</span>)}
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
    if (!exam) return app.toast(tr('calendar.anade_un_examen_con_fecha_futura'));
    const lastDay = addDays(exam.date, -Math.max(1, exam.finalDays));
    const pending = exam.topics.map((t) => topicStats(col, t, exam.goal, Date.now(), srsParams(s))).filter((t) => !t.complete);
    const span = Math.max(1, daysBetween(today, lastDay));
    const blocks: StudyBlock[] = pending.map((t, i) => {
      const day = addDays(today, 1 + Math.floor((i * span) / Math.max(1, pending.length)));
      const [y, m, dd] = day.split('-').map(Number) as [number, number, number];
      const start = new Date(y, m - 1, dd, 18, 0).getTime();
      return { uid: `plan-${Date.now()}-${i}@engrama`, start, end: start + 60 * 60_000, title: tr('calendar.estudiar_topic', { topic: t.topic }), subject: exam.name, note: tr('calendar.newleft_nuevas_restantes_dominio_p', { newLeft: t.newLeft, p: Math.round(t.mastery * 100) }), rrule: '', until: '', done: [], alarmMin: 10 };
    });
    for (let k = addDays(lastDay, 1); k < exam.date; k = addDays(k, 1)) {
      const [y, m, dd] = k.split('-').map(Number) as [number, number, number];
      const start = new Date(y, m - 1, dd, 18, 0).getTime();
      blocks.push({ uid: `plan-${Date.now()}-f${k}@engrama`, start, end: start + 45 * 60_000, title: tr('calendar.repaso_final_name', { name: exam.name }), subject: exam.name, note: '', rrule: '', until: '', done: [], alarmMin: 10 });
    }
    setPlan(blocks);
  };

  return (
    <>
      <PageTitle title={tr('calendar.calendario')} sub={title}>
        <Segmented label={tr('calendar.vista')} value={view} onChange={setView} options={[['mes', tr('calendar.mes')], ['semana', tr('calendar.semana')], ['dia', tr('calendar.dia')], ['agenda', tr('calendar.agenda')]]} />
        <button type="button" class="btn icon" aria-label={tr('calendar.anterior')} onClick={() => step(-1)}><ChevronLeft size={18} /></button>
        <button type="button" class="btn small" onClick={() => (setAnchor(today), setSel(today))}>{tr('today.hoy')}</button>
        <button type="button" class="btn icon" aria-label={tr('calendar.siguiente')} onClick={() => step(1)}><ChevronRight size={18} /></button>
        <button type="button" class="btn" onClick={() => setShowLayers(true)}>{tr('calendar.capas')}</button>
        <button type="button" class="btn" onClick={proposePlan}><Wand2 size={18} />{' '}{tr('calendar.plan_semanal')}</button>
      </PageTitle>
      <div class="grid" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(260px, 1fr)', alignItems: 'start' }}>
        <section class="glass panel">
          {view === 'agenda' ? (
            <div class="stack-s">{days.map((k) => { const x = byDay(k); const items = [...x.exams.map((e) => `🎯 ${e.name}`), ...x.blocks.map((o) => `${new Date(o.start).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })} ${o.b.title}`), ...x.imported.map((o) => o.b.title), ...x.tasks.map((t) => `☐ ${t.text}`)]; return items.length || x.load ? <button type="button" class="row-i tap" style={{ border: 0, background: 'none', width: '100%', textAlign: 'left' }} onClick={() => setSel(k)}><div class="k"><b>{fmtDate(k)}</b><small>{items.join(' · ') || '—'}</small></div><span class="v">{x.load} repasos</span></button> : null; })}</div>
          ) : (
            <div class="cal" style={view === 'dia' ? { gridTemplateColumns: '1fr' } : undefined}>
              {view !== 'dia' && (s.weekStartsMonday ? DOW : [DOW[6]!, ...DOW.slice(0, 6)]).map((w) => <span class="dow">{w}</span>)}
              {days.map(cell)}
            </div>
          )}
          <p class="foot" style={{ marginTop: '8px' }}>{tr('calendar.la_barra_de_cada_dia_es')}{' '}{Math.round(avg)}{tr('calendar.arrastra_un_bloque_a_otro_dia')}</p>
        </section>
        <section class="glass panel stack-s" aria-label={tr('calendar.dia_seleccionado')}>
          <h2 style={{ fontSize: 'var(--t-3)' }}>{new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(sel + 'T12:00:00Z'))}</h2>
          <div class="kv"><span class="k">{tr('calendar.repasos_previstos')}</span><span class="v">{d.load}</span></div>
          {avg > 0 && d.load > 1.5 * avg && <div class="err">{tr('calendar.dia_con_carga_alta_introduce_menos')}</div>}
          <div class="kv"><span class="k">{tr('calendar.estudiado')}</span><span class="v">{tr('calendar.cards_tarjetas', { cards: d.cards })}{' '}{Math.round(d.focus / 60000)} min</span></div>
          {suggestDeck && suggestDeck.n > 0 && <p class="note">{tr('calendar.sugerencia_estudia')}{' '}<b>{suggestDeck.dk.full}</b> {tr('calendar.n_vencen', { n: suggestDeck.n })}</p>}
          {d.exams.map((e) => <div class="chip solid">🎯 {e.name}</div>)}
          {[...d.blocks, ...d.imported].map((o) => (
            <div class="inset row" style={{ padding: '8px 10px', borderRadius: 'var(--r-row)' }}>
              <div class="grow stack-s"><b style={{ textDecoration: o.b.done.includes(sel) ? 'line-through' : 'none' }}>{o.b.title}</b><div class="foot">{new Date(o.start).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}–{new Date(o.end).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}{o.b.subject ? ` · ${o.b.subject}` : ''}{o.b.readonly ? tr('calendar.importado') : ''}</div>
                <LinkChips links={o.b.links ?? []} idx={lidx} live onRepair={() => setEdit(o.b)} /></div>
              {!o.b.readonly && (
                <>
                  <button type="button" class="btn icon small" aria-label={tr('calendar.marcar_como_hecho')} aria-pressed={o.b.done.includes(sel)} onClick={() => data && saveOwn(data.own.map((x) => (x.uid === o.b.uid ? { ...x, done: x.done.includes(sel) ? x.done.filter((y) => y !== sel) : [...x.done, sel] } : x)))}><Check size={16} /></button>
                  <button type="button" class="btn icon small" aria-label={tr('calendar.iniciar_bloque')} onClick={() => void startBlock(app, o.b, lidx)}><Play size={16} /></button>
                </>
              )}
            </div>
          ))}
          {d.tasks.map((t) => <a class="note" href={href('notas', ...t.note.split('/').slice(1))}>☐ {t.text}</a>)}
          <div class="row wrap">
            <button type="button" class="btn small" onClick={() => { const [y, m, dd] = sel.split('-').map(Number) as [number, number, number]; const st = new Date(y, m - 1, dd, 18, 0).getTime(); setEdit({ uid: `${Date.now().toString(36)}@engrama`, start: st, end: st + 3600_000, title: '', subject: '', note: '', rrule: '', until: '', done: [], alarmMin: 10 }); }}><CalendarPlus size={16} />{' '}{tr('calendar.bloque')}</button>
            <a class="btn small" href={href('notas', '+diaria', sel)}><NotebookPen size={16} />{' '}{tr('calendar.nota_diaria')}</a>
          </div>
          <div class="row wrap" style={{ marginTop: '8px' }}>
            <button type="button" class="btn small" onClick={async () => { if (!data) return; await deliver(new File([toICS(data.own)], 'engrama-estudio.ics', { type: 'text/calendar' })); }}><Download size={16} />{' '}{tr('calendar.exportar_ics')}</button>
            <label class="btn small"><Upload size={16} />{' '}{tr('calendar.importar_ics')}<input type="file" hidden accept=".ics,text/calendar" onChange={async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; const t = await f.text(); const n = fromICS(t, f.name).length; await app.vault.write(`calendar/${f.name.replace(/[^\w.-]+/g, '_')}`, t); app.changed(); app.toast(tr('calendar.eventos_importados', { n })); }} /></label>
          </div>
          <p class="foot">{tr('calendar.una_web_no_puede_escribir_en')}</p>
        </section>
      </div>
      {showLayers && (
        <Sheet title={tr('calendar.capas')} onClose={() => setShowLayers(false)}>
          {LAYERS().map(([k, l]) => <div class="row-i"><span class="k">{l}</span><Switch label={l} checked={layers[k]} onChange={(v) => setLayers({ ...layers, [k]: v })} /></div>)}
          <div class="row-i"><span class="k">{tr('calendar.la_semana_empieza_en_lunes')}</span><Switch label={tr('calendar.semana_en_lunes')} checked={s.weekStartsMonday} onChange={(v) => app.update({ weekStartsMonday: v })} /></div>
        </Sheet>
      )}
      {edit && data && <BlockEditor idx={lidx} block={edit} onClose={() => setEdit(null)} onSave={async (b) => { await saveOwn(data.own.some((x) => x.uid === b.uid) ? data.own.map((x) => (x.uid === b.uid ? b : x)) : [...data.own, b]); setEdit(null); }} onDelete={async () => { await saveOwn(data.own.filter((x) => x.uid !== edit.uid)); setEdit(null); }} />}
      {plan && (
        <Sheet title={tr('calendar.plan_sugerido')} onClose={() => setPlan(null)}>
          <div class="stack-s">
            <p class="note">{tr('calendar.bloques_repartidos_hasta_el_examen_segun')}</p>
            {plan.map((b, i) => <div class="row-i"><div class="k">{b.title}<small>{new Date(b.start).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {b.note}</small></div><button type="button" class="btn icon small" aria-label={tr('calendar.quitar')} onClick={() => setPlan(plan.filter((_, k) => k !== i))}>✕</button></div>)}
            <button type="button" class="btn primary" onClick={async () => { await saveOwn([...(data?.own ?? []), ...plan]); setPlan(null); app.toast(tr('calendar.bloques_anadidos', { n: plan.length })); }}>{tr('calendar.aceptar_plan')}</button>
          </div>
        </Sheet>
      )}
    </>
  );
}

function BlockEditor(p: { idx: LinkIndex | null | undefined; block: StudyBlock; onClose: () => void; onSave: (b: StudyBlock) => void; onDelete: () => void }) {
  const app = useApp();
  const [b, setB] = useState(p.block);
  const [picker, setPicker] = useState<{ replace: string | null } | null>(null);
  const [ac, setAc] = useState<string | null>(null);
  const links = b.links ?? [];
  const addLink = (uri: string, replace: string | null = null) => {
    setB((x) => {
      const cur = (x.links ?? []).filter((u) => u !== replace);
      return { ...x, links: cur.includes(uri) ? cur : [...cur, uri] };
    });
    app.changed(); // el archivo pudo recibir su `id`
  };
  // [[ en la nota: autocompletar mazos y notas
  const acItems = ac !== null && p.idx ? [...p.idx.decks, ...p.idx.notes].filter((t) => t.name.toLowerCase().includes(ac.toLowerCase())).slice(0, 6) : [];
  const iso = (ms: number) => { const d = new Date(ms); return `${localDay(ms)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const dur = Math.round((b.end - b.start) / 60000);
  return (
    <Sheet title={p.block.title ? tr('calendar.bloque_de_estudio') : tr('calendar.nuevo_bloque')} onClose={p.onClose}>
      <form class="stack" onSubmit={(e) => (e.preventDefault(), p.onSave(b))}>
        <label class="field">{tr('calendar.titulo')}<input class="input" required value={b.title} onInput={(e) => setB({ ...b, title: (e.target as HTMLInputElement).value })} placeholder={tr('calendar.repasar_ecg')} /></label>
        <label class="field">{tr('calendar.materia_tema')}<input class="input" value={b.subject} onInput={(e) => setB({ ...b, subject: (e.target as HTMLInputElement).value })} /></label>
        <div class="row wrap">
          <label class="field">{tr('calendar.inicio')}<input class="input" type="datetime-local" value={iso(b.start)} onInput={(e) => { const t = new Date((e.target as HTMLInputElement).value).getTime(); if (Number.isFinite(t)) setB({ ...b, start: t, end: t + dur * 60000 }); }} /></label>
          <label class="field">{tr('calendar.duracion_min')}<input class="input" type="number" min={5} value={dur} onInput={(e) => setB({ ...b, end: b.start + Number((e.target as HTMLInputElement).value) * 60000 })} /></label>
          <label class="field">{tr('calendar.repetir')}<select value={b.rrule} onChange={(e) => setB({ ...b, rrule: (e.target as HTMLSelectElement).value as StudyBlock['rrule'] })}><option value="">{tr('calendar.no')}</option><option value="DAILY">{'Diario'}</option><option value="WEEKLY">{tr('calendar.semanal')}</option></select></label>
          <label class="field">{tr('calendar.recordatorio_min_antes_en_el_ics')}<input class="input" type="number" min={0} value={b.alarmMin ?? ''} onInput={(e) => setB({ ...b, alarmMin: (e.target as HTMLInputElement).value === '' ? null : Number((e.target as HTMLInputElement).value) })} /></label>
        </div>
        <div class="field">{tr('calendar.vinculos')}<LinkChips links={links} idx={p.idx} onRemove={(u) => setB({ ...b, links: links.filter((x) => x !== u) })} onRepair={(u) => setPicker({ replace: u })} />
          <button type="button" class="btn small" style={{ justifySelf: 'start' }} disabled={!p.idx} onClick={() => setPicker({ replace: null })}><Link2 size={16} />{' '}{tr('calendar.vincular')}</button>
        </div>
        <label class="field">{tr('calendar.nota_escribe_para_vincular')}<textarea class="input" rows={2} value={b.note} onInput={(e) => { const v = (e.target as HTMLTextAreaElement).value; setB({ ...b, note: v }); const m = /\[\[([^\]\n]*)$/.exec(v.slice(0, (e.target as HTMLTextAreaElement).selectionStart)); setAc(m ? m[1]! : null); }} /></label>
        {acItems.length > 0 && (
          <div class="glass strong stack-s" style={{ padding: '6px', borderRadius: '14px' }} role="listbox">
            {acItems.map((t) => <button type="button" role="option" class="opt note" onClick={async () => {
              const taken = new Set([...p.idx!.decks, ...p.idx!.notes].map((x) => x.id).filter(Boolean) as string[]);
              const { ensureFileId, makeUri } = await import('../lib/links');
              const id = await ensureFileId(app.vault, t.path, taken);
              setB((x) => ({ ...x, note: x.note.replace(/\[\[[^\]\n]*$/, `[[${t.name}]]`) }));
              addLink(makeUri(t.kind, id));
              setAc(null);
            }}>{t.kind === 'deck' ? '📚' : '📄'} {t.name}</button>)}
          </div>
        )}
        {picker && p.idx && <LinkPicker idx={p.idx} onClose={() => setPicker(null)} onPick={(u) => { addLink(u, picker.replace); setPicker(null); }} />}
        <div class="row"><button class="btn primary" type="submit">{tr('calendar.guardar')}</button>{p.block.title && <button type="button" class="btn danger" onClick={p.onDelete}>{tr('calendar.eliminar')}</button>}</div>
      </form>
    </Sheet>
  );
}

export { decksForTopic };
