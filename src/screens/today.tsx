import { locale, t, tn } from '../i18n';
import { BarChart3, BookOpen, CalendarRange, CheckCheck, CheckSquare, StickyNote, Flame, GraduationCap, Layers, ListTodo, Share2, Timer } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { addonOn } from './addons';
import { Minimizable, Tray, type TrayItem, useHoyTray } from '../ui/tray';
import { fmt, remaining } from '../lib/pomodoro';
import { useExtra } from '../data/extra';
import { dayKey, streaks } from '../lib/days';
import { studyLimits } from '../lib/settings';
import { activity, doneToday, pending, todayProgress } from '../lib/stats';
import { useApp } from '../state';
import { KV, PageTitle } from '../ui/kit';
import { DeckPanel } from './decks';
import { AddExamButton, ExamCard } from './exams';
import { Heatmap } from './heatmap';
import { PomodoroPanel } from './pomodoro';
import { useProfile } from '../ui/avatar';

export function byDeckFn(app: ReturnType<typeof useApp>) {
  return (day: string) => {
    const col = app.col;
    if (!col) return [];
    const m = new Map<string, number>();
    for (const e of col.log) if (e.rating && dayKey(e.ts, app.settings.timeZone, app.settings.dayStartHour) === day) {
      const d = col.byCid.get(e.id)?.deck.full ?? t('today.archivada');
      m.set(d, (m.get(d) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]);
  };
}

export function Today() {
  const app = useApp();
  const s = app.settings;
  const col = app.col;
  const { data } = useExtra();
  const now = Date.now();
  const today = dayKey(now, s.timeZone, s.dayStartHour);
  const log = col?.log ?? [];
  const tp = todayProgress(log, today, s.timeZone, s.dayStartHour);
  const pend = col ? pending(col, now, studyLimits(s), log) : null;
  const done = col ? doneToday(col, today, s.timeZone, s.dayStartHour) : null;
  const act = activity(log, data?.extra ?? { pomodoro: [], exams: [] }, s.timeZone, s.dayStartHour);
  const st = streaks(new Map([...act].map(([k, v]) => [k, v.cards])), today, s.streakMin);
  const evening = new Date().getHours() >= 18;
  const tray = useHoyTray();
  const profile = useProfile();
  const rem = fmt(remaining(app.pomo.state, app.pomo.now));
  // «Compartir estadísticas» (Prompt 19): la hoja y el compositor se cargan al pulsar
  const [Share, setShare] = useState<null | typeof import('../share/sheet').ShareSheet>(null);
 // add-on «Tareas» (Prompt 19 · 2): su código solo se carga si está activo
  const tasksOn = addonOn(s, 'tasks');
  const [Tasks, setTasks] = useState<null | typeof import('../tasks/tile')>(null);
  const [nTasks, setNTasks] = useState(0);
  useEffect(() => { if (tasksOn && !Tasks) void import('../tasks/tile').then(setTasks, () => {}); }, [tasksOn]);
  const stickyOn = addonOn(s, 'sticky-notes');
  const [Stickies, setStickies] = useState<null | typeof import('../stickies/tile')>(null);
  useEffect(() => { if (stickyOn && !Stickies) void import('../stickies/tile').then(setStickies, () => {}); }, [stickyOn]);
  const openShare = () => void import('../share/sheet').then((m) => setShare(() => m.ShareSheet), () => app.toast(t('share.error')));
  const ITEMS: Record<string, TrayItem> = {
    pomodoro: { id: 'pomodoro', label: t('today.pomodoro'), icon: <Timer size={20} />, live: rem, liveLabel: t(app.pomo.state.running ? 'tray.restantes' : 'tray.restantes_pausa', { rem }) },
    progreso: { id: 'progreso', label: t('today.progreso_de_hoy'), icon: <BarChart3 size={20} /> },
    pendientes: { id: 'pendientes', label: t('today.pendientes'), icon: <ListTodo size={20} />, live: String(pend?.total ?? 0), liveLabel: t('today.n_pendientes', { n: pend?.total ?? 0 }) },
    hecho: { id: 'hecho', label: t('today.hecho_hoy'), icon: <CheckCheck size={20} /> },
    calor: { id: 'calor', label: t('today.mapa_de_adherencia'), icon: <CalendarRange size={20} /> },
    mazos: { id: 'mazos', label: t('decks.mazos'), icon: <Layers size={20} /> },
  };
  if (stickyOn) ITEMS.sticky = { id: 'sticky', label: t('stickies.titulo'), icon: <StickyNote size={20} /> };
  if (tasksOn) ITEMS.tareas = { id: 'tareas', label: t('tasks.tareas'), icon: <CheckSquare size={20} />, live: String(nTasks), liveLabel: tn('tasks.n_pendientes', nTasks) };
  for (const e of data?.exams ?? []) ITEMS[`ex:${e.path}`] = { id: `ex:${e.path}`, label: e.name, icon: <GraduationCap size={20} /> };
  return (
    <>
      <PageTitle title={t('today.hoy')} sub={(profile.name.trim() ? `${t('today.hola_name', { name: profile.name.trim().split(/\s+/)[0] })} · ` : '') + new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: s.timeZone }).format(now)}>
        <span class="title-chip glass row" data-tip={t('today.racha')}><Flame size={18} /> <b class="num">{st.current}</b> {tn('plural.daysword', st.current)}{st.todayCounts ? t('today.hoy_cuenta') : ''}</span>
        <button type="button" class="btn share-btn" aria-label={t('share.compartir_estadisticas')} onClick={openShare}><Share2 size={18} /><span class="lbl">{t('share.compartir')}</span></button>
        <a class="btn primary" href="#/estudiar"><BookOpen size={18} />{' '}{t('today.estudiar')}{pend ? ` · ${pend.total}` : ''}</a>
      </PageTitle>
      {!st.todayCounts && evening && st.current > 0 && (
        <div class="banner glass">◐ <span class="k">{t('today.hoy_aun_no_cuenta_para_tu', { current: st.current, streakMin: s.streakMin })}{' '}{tn('plural.cardsword', s.streakMin)}.</span></div>
      )}
      <p class="title-chip glass" style={{ display: 'inline-block', marginBottom: '14px' }}>
        {tp.studied ? t('today.estudiaste_studied_tarjetas_en_minutes_min', { studied: tp.studied, minutes: tp.minutes, secPerCard: tp.secPerCard }) : pend?.total ? t('today.tienes_total_tarjetas_para_hoy_estmin', { total: pend.total, estMin: pend.estMin }) : t('today.nada_pendiente_por_ahora')}
      </p>
      <div class="grid hoy">
        <Minimizable id="mazos" label={t('decks.mazos')} tray={tray}>{(b) => <div class="mh">{b}<DeckPanel /></div>}</Minimizable>
        <div class="side">
          <Minimizable id="pomodoro" label={t('today.pomodoro')} tray={tray}>{(b) => <>{b}<PomodoroPanel /></>}</Minimizable>
          {data?.exams.filter((e) => e.date >= today).map((e) => <Minimizable key={e.path} id={`ex:${e.path}`} label={e.name} tray={tray}>{(b) => <div class="mh">{b}<ExamCard exam={e} extra={data.extra} /></div>}</Minimizable>)}
          {tasksOn && Tasks && <><Tasks.TasksCount onCount={setNTasks} /><Minimizable id="tareas" label={t('tasks.tareas')} tray={tray}>{(b) => <div class="mh">{b}<Tasks.TasksTile today={today} /></div>}</Minimizable></>}
          {/* sobre el fondo, siempre dentro de vidrio (el guardián de legibilidad lo cubre) */}
          <div class="row" style={{ justifyContent: 'center' }}>
            <div class="glass exam-add">
              <AddExamButton />
              {!data?.exams.some((e) => e.date >= today) && <p class="foot">{t('exams.vacio_ayuda')}</p>}
            </div>
          </div>
        </div>
        <div class="grid cards3 span-all">
          <Minimizable id="progreso" label={t('today.progreso_de_hoy')} tray={tray}>{(b) => <>{b}<section class="glass panel statcard" aria-label={t('today.progreso_de_hoy')}>
            <h3>{t('today.progreso_de_hoy')}</h3>
            <KV k={t('today.estudiadas')} v={tp.studied} />
            <KV k={t('today.tiempo_min')} v={tp.minutes} />
            <KV k={t('today.ritmo_s_tarjeta')} v={tp.secPerCard} />
            <KV k={t('today.promedio_tarjetas_min')} v={tp.perMin} />
            <KV k={t('today.aciertos')} v={tp.studied ? `${tp.correct} %` : '—'} />
          </section></>}</Minimizable>
          <Minimizable id="pendientes" label={t('today.pendientes')} tray={tray}>{(b) => <>{b}<section class="glass panel statcard" aria-label={t('today.pendientes')}>
            <h3>{t('today.pendientes')}</h3>
            <KV k={t('today.nuevas')} v={pend?.new ?? 0} />
            <KV k={t('today.aprendiendo')} v={pend?.learning ?? 0} />
            <KV k={t('today.vencidas')} v={pend?.due ?? 0} strong />
            <KV k={t('today.total')} v={pend?.total ?? 0} />
            <KV k={t('today.vencen_manana')} v={pend?.tomorrow ?? 0} />
            <KV k={t('today.tiempo_estimado_min')} v={pend?.estMin ?? 0} />
          </section></>}</Minimizable>
          <Minimizable id="hecho" label={t('today.hecho_hoy')} tray={tray}>{(b) => <>{b}<section class="glass panel statcard" aria-label={t('today.hecho_hoy')}>
            <h3>{t('today.hecho_hoy')}</h3>
            <KV k={t('today.nuevas_aprendidas')} v={done?.newLearned ?? 0} />
            <KV k={t('today.repeticiones_de_aprendizaje')} v={done?.learningReps ?? 0} />
            <KV k={t('today.repasos_vencidos')} v={done?.reviews ?? 0} />
            <KV k={t('today.maduradas')} v={done?.matured ?? 0} />
            <KV k={t('today.conteo_de_otra_vez')} v={done?.again ?? 0} />
          </section></>}</Minimizable>
        </div>
        {stickyOn && Stickies && <div class="span-all"><Minimizable id="sticky" label={t('stickies.titulo')} tray={tray}>{(b) => <div class="mh">{b}<Stickies.StickiesTile /></div>}</Minimizable></div>}
        {s.addons.heatmap !== false && <div class="span-all"><Minimizable id="calor" label={t('today.mapa_de_adherencia')} tray={tray}>{(b) => <div class="mh">{b}<Heatmap act={act} today={today} byDeck={byDeckFn(app)} /></div>}</Minimizable></div>}
      </div>
      {tray.hidden.length > 0 && <div class="row" style={{ justifyContent: 'center', marginTop: '14px' }}><button type="button" class="btn small glass" onClick={tray.reopenAll}>{t('today.mostrar_paneles_cerrados_n', { n: tray.hidden.length })}</button></div>}
      {Share && <Share act={act} today={today} profile={profile} onClose={() => setShare(null)} />}
      <Tray floating items={tray.min.map((id) => ITEMS[id]).filter((x): x is TrayItem => !!x)} onRestore={tray.restore} onClose={tray.close} />
    </>
  );
}
