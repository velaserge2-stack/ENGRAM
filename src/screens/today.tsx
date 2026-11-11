import { BookOpen, Flame } from 'lucide-preact';
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

export function byDeckFn(app: ReturnType<typeof useApp>) {
  return (day: string) => {
    const col = app.col;
    if (!col) return [];
    const m = new Map<string, number>();
    for (const e of col.log) if (e.rating && dayKey(e.ts, app.settings.timeZone, app.settings.dayStartHour) === day) {
      const d = col.byCid.get(e.id)?.deck.full ?? '(archivada)';
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
  return (
    <>
      <PageTitle title="Hoy" sub={new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: s.timeZone }).format(now)}>
        <span class="title-chip glass row" title="Racha"><Flame size={18} /> <b class="num">{st.current}</b> {st.current === 1 ? 'día' : 'días'}{st.todayCounts ? ' · hoy cuenta ✓' : ''}</span>
        <a class="btn primary" href="#/estudiar"><BookOpen size={18} /> Estudiar{pend ? ` · ${pend.total}` : ''}</a>
      </PageTitle>
      {!st.todayCounts && evening && st.current > 0 && (
        <div class="banner glass">◐ <span class="k">Hoy aún no cuenta para tu racha de {st.current} días: repasa al menos {s.streakMin} {s.streakMin === 1 ? 'tarjeta' : 'tarjetas'}.</span></div>
      )}
      <p class="title-chip glass" style={{ display: 'inline-block', marginBottom: '14px' }}>
        {tp.studied ? `Estudiaste ${tp.studied} tarjetas en ${tp.minutes} min hoy (${tp.secPerCard} s/tarjeta).` : pend?.total ? `Tienes ${pend.total} tarjetas para hoy (≈ ${pend.estMin} min).` : 'Nada pendiente por ahora.'}
      </p>
      <div class="grid hoy">
        <DeckPanel />
        <div class="side">
          <PomodoroPanel />
          {data?.exams.filter((e) => e.date >= today).map((e) => <ExamCard exam={e} extra={data.extra} />)}
          <div class="row" style={{ justifyContent: 'center' }}><AddExamButton /></div>
        </div>
        <div class="grid cards3 span-all">
          <section class="glass panel statcard" aria-label="Progreso de hoy">
            <h3>Progreso de hoy</h3>
            <KV k="Estudiadas" v={tp.studied} />
            <KV k="Tiempo (min)" v={tp.minutes} />
            <KV k="Ritmo (s/tarjeta)" v={tp.secPerCard} />
            <KV k="Promedio (tarjetas/min)" v={tp.perMin} />
            <KV k="Aciertos" v={tp.studied ? `${tp.correct} %` : '—'} />
          </section>
          <section class="glass panel statcard" aria-label="Pendientes">
            <h3>Pendientes</h3>
            <KV k="Nuevas" v={pend?.new ?? 0} />
            <KV k="Aprendiendo" v={pend?.learning ?? 0} />
            <KV k="Vencidas" v={pend?.due ?? 0} strong />
            <KV k="Total" v={pend?.total ?? 0} />
            <KV k="Vencen mañana" v={pend?.tomorrow ?? 0} />
            <KV k="Tiempo estimado (min)" v={pend?.estMin ?? 0} />
          </section>
          <section class="glass panel statcard" aria-label="Hecho hoy">
            <h3>Hecho hoy</h3>
            <KV k="Nuevas aprendidas" v={done?.newLearned ?? 0} />
            <KV k="Repeticiones de aprendizaje" v={done?.learningReps ?? 0} />
            <KV k="Repasos vencidos" v={done?.reviews ?? 0} />
            <KV k="Maduradas" v={done?.matured ?? 0} />
            <KV k={'Conteo de "Otra vez"'} v={done?.again ?? 0} />
          </section>
        </div>
        {s.addons.heatmap !== false && <div class="span-all"><Heatmap act={act} today={today} byDeck={byDeckFn(app)} /></div>}
      </div>
    </>
  );
}
