import { Info } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { useExtra } from '../data/extra';
import { dayKey } from '../lib/days';
import { srsParams } from '../lib/settings';
import { accuracy, activity, consistency, efficiency, forecast, histogram, newLearned, trueRetention, avgDaily } from '../lib/stats';
import { State, workloadEstimate } from '../srs/engine';
import { atRisk } from '../srs/queue';
import { useApp } from '../state';
import { Bars, Lines } from '../ui/charts';
import { Bar, PageTitle, Ring, Sheet } from '../ui/kit';
import { AddExamButton, ExamCard } from './exams';
import { Heatmap } from './heatmap';
import { byDeckFn } from './today';
import { href } from '../state';

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)} %`);

export function Stats() {
  const app = useApp();
  const s = app.settings;
  const col = app.col;
  const { data } = useExtra();
  const [how, setHow] = useState(false);
  if (!col) return <p class="t2">Cargando…</p>;
  const now = Date.now();
  const today = dayKey(now, s.timeZone, s.dayStartHour);
  const act = activity(col.log, data?.extra ?? { pomodoro: [], exams: [] }, s.timeZone, s.dayStartHour);
  const ret = trueRetention(col.log, now);
  const acc = accuracy(col.log, now);
  const eff = efficiency(act, today);
  const nl = newLearned(col, now);
  const fc = forecast(col, now, s.timeZone, s.dayStartHour);
  const avg = avgDaily(act, today);
  const cons = consistency(act, today);
  const live = [...col.states].filter(([k, st]) => col.byCid.has(k) && st.card.state !== State.New);
  const sEdges = [0, 1, 3, 7, 14, 30, 60, 120, 365];
  const sHist = histogram(live.map(([, st]) => st.card.stability), sEdges);
  const dEdges = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const dHist = histogram(live.map(([, st]) => st.card.difficulty), dEdges);
  const work = workloadEstimate(live.map(([, st]) => st), [0.85, 0.9, 0.95], s.fsrsW ?? undefined);
  const risk = atRisk(col, now, srsParams(s)).slice(0, 12);
  const short = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;
  return (
    <>
      <PageTitle title="Estadísticas" sub={`${col.byCid.size} tarjetas · ${col.log.filter((e) => e.rating).length} repasos en total`}>
        <button type="button" class="btn" onClick={() => setHow(true)}><Info size={18} /> ¿Cómo se calcula?</button>
      </PageTitle>
      <div class="stack">
        <div class="grid cards3">
          <section class="glass panel center stack-s"><h3>Retención real</h3><Ring value={ret.value ?? 0} label="Retención real" text={pct(ret.value)} /><p class="foot">{ret.n} repasos de maduras · 30 días · meta {Math.round(s.retention * 100)} %</p></section>
          <section class="glass panel stack-s">
            <h3 class="center">Precisión y eficiencia</h3>
            <div class="kv"><span class="k">Precisión</span><span class="v">{pct(acc.value)}</span></div><Bar value={acc.value ?? 0} label="Precisión" />
            <div class="kv"><span class="k">Eficiencia</span><span class="v">{eff.value === null ? '—' : `${Math.round(eff.secToday)} s vs ${Math.round(eff.median)} s`}</span></div><Bar value={eff.value ?? 0} label="Eficiencia" outline={eff.value === null} />
            <p class="foot">{act.get(today)?.cards ? `${(act.get(today)!.cards / Math.max(1, act.get(today)!.ms / 60000)).toFixed(1)} tarjetas/min hoy` : 'Sin repasos hoy'}</p>
          </section>
          <section class="glass panel center stack-s"><h3>Nuevas aprendidas</h3><Ring value={nl.value ?? 0} label="Nuevas aprendidas" text={pct(nl.value)} /><p class="foot">de {nl.n} nuevas introducidas en 30 días, ya en repaso</p></section>
        </div>
        <section class="glass panel"><div class="panel-h"><h2>Pronóstico de 30 días</h2><span class="foot">sólido = carga alta (&gt; 1.5× tu promedio)</span></div>
          <Bars data={fc.map((x) => ({ label: short(x.day), n: x.n, hi: avg > 0 && x.n > 1.5 * avg }))} label="Repasos previstos por día" />
        </section>
        <section class="glass panel"><div class="panel-h"><h2>Consistencia</h2></div>
          <Lines a={cons.map((x) => x.n)} b={cons.map((x) => x.avg7)} labels={cons.map((x) => short(x.day))} label="Tarjetas por día, últimos 30 días" legend={['Tarjetas por día', 'Promedio móvil 7 días']} />
        </section>
        <div class="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <section class="glass panel"><h2 style={{ fontSize: 'var(--t-3)' }}>Estabilidad (días)</h2><Bars data={sHist.map((n, i) => ({ label: `${sEdges[i]}+`, n }))} label="Distribución de estabilidad" every={1} height={120} /></section>
          <section class="glass panel"><h2 style={{ fontSize: 'var(--t-3)' }}>Dificultad</h2><Bars data={dHist.map((n, i) => ({ label: `${dEdges[i]}`, n }))} label="Distribución de dificultad" every={1} height={120} /></section>
        </div>
        <section class="glass panel stack-s"><h2 style={{ fontSize: 'var(--t-3)' }}>Estimación de carga según la retención deseada</h2>
          <p>A 85 % ≈ <b>{Math.round(work['0.85'] ?? 0)}</b> repasos/día · a 90 % ≈ <b>{Math.round(work['0.9'] ?? 0)}</b> · a 95 % ≈ <b>{Math.round(work['0.95'] ?? 0)}</b></p>
          <p class="foot">Con tu historial actual (suma de 1/intervalo de cada tarjeta en repaso). Cámbiala en Ajustes → Estudio.</p>
        </section>
        <section class="glass panel"><h2 style={{ fontSize: 'var(--t-3)', marginBottom: '8px' }}>Tarjetas en riesgo</h2>
          {risk.length ? risk.map((r) => <a class="kv" href={href('explorar', `id:${r.cid}`)} style={{ textDecoration: 'none' }}><span class="k ellipsis">{col.byCid.get(r.cid)?.ref.note.front.slice(0, 70)}</span><span class="v">{r.reason}</span></a>) : <p class="t2">Ninguna por ahora.</p>}
        </section>
        <Heatmap act={act} today={today} byDeck={byDeckFn(app)} />
        <div class="row"><h2 style={{ fontSize: 'var(--t-2)' }}>Exámenes</h2><span class="grow" /><AddExamButton /></div>
        {data?.exams.map((e) => <ExamCard exam={e} extra={data.extra} detailed />)}
      </div>
      {how && (
        <Sheet title="¿Cómo se calcula?" onClose={() => setHow(false)}>
          <div class="stack note">
            <p><b>Retención real:</b> repasos con Bien o Fácil sobre todos los repasos de tarjetas maduras (intervalo ≥ 21 días) en los últimos 30 días.</p>
            <p><b>Precisión:</b> porcentaje de repasos con Bien o Fácil sobre todos los repasos de 30 días.</p>
            <p><b>Eficiencia:</b> tus segundos por tarjeta de hoy frente a tu mediana de 30 días; si vas más rápido que tu mediana, la barra se llena.</p>
            <p><b>Nuevas aprendidas:</b> de las tarjetas nuevas que introdujiste en 30 días, cuántas ya están en estado de repaso.</p>
            <p><b>Tiempo:</b> cada repaso registra su tiempo con un tope de 60 s para ignorar pausas. El tiempo de simulacros se suma; el de pomodoro cuenta si fue mayor (no se suma dos veces).</p>
            <p><b>Retención proyectada del examen:</b> simulación FSRS suponiendo que respondes "Bien" en cada vencimiento hasta la fecha.</p>
            <p>Todo se calcula desde reviews.jsonl y los archivos; nada se guarda duplicado.</p>
          </div>
        </Sheet>
      )}
    </>
  );
}
