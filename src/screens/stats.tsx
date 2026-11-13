import { t } from '../i18n';
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
  if (!col) return <p class="t2">{t('deck.cargando')}</p>;
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
      <PageTitle title={t('spaces.estadisticas')} sub={t('stats.size_tarjetas_n_repasos_en_total', { size: col.byCid.size, n: col.log.filter((e) => e.rating).length })}>
        <button type="button" class="btn" onClick={() => setHow(true)}><Info size={18} />{' '}{t('stats.como_se_calcula')}</button>
      </PageTitle>
      <div class="stack">
        <div class="grid cards3">
          <section class="glass panel center stack-s"><h3>{t('stats.retencion_real')}</h3><Ring value={ret.value ?? 0} label={t('stats.retencion_real')} text={pct(ret.value)} /><p class="foot">{t('stats.n_repasos_de_maduras_30_dias', { n: ret.n })}{' '}{Math.round(s.retention * 100)} %</p></section>
          <section class="glass panel stack-s">
            <h3 class="center">{t('stats.precision_y_eficiencia')}</h3>
            <div class="kv"><span class="k">{t('design.precision')}</span><span class="v">{pct(acc.value)}</span></div><Bar value={acc.value ?? 0} label={t('design.precision')} />
            <div class="kv"><span class="k">{t('stats.eficiencia')}</span><span class="v">{eff.value === null ? '—' : `${Math.round(eff.secToday)} s vs ${Math.round(eff.median)} s`}</span></div><Bar value={eff.value ?? 0} label={t('stats.eficiencia')} outline={eff.value === null} />
            <p class="foot">{act.get(today)?.cards ? t('stats.p_tarjetas_min_hoy', { p: (act.get(today)!.cards / Math.max(1, act.get(today)!.ms / 60000)).toFixed(1) }) : t('stats.sin_repasos_hoy')}</p>
          </section>
          <section class="glass panel center stack-s"><h3>{t('today.nuevas_aprendidas')}</h3><Ring value={nl.value ?? 0} label={t('today.nuevas_aprendidas')} text={pct(nl.value)} /><p class="foot">{t('stats.de_n_nuevas_introducidas_en_30', { n: nl.n })}</p></section>
        </div>
        <section class="glass panel"><div class="panel-h"><h2>{t('stats.pronostico_de_30_dias')}</h2><span class="foot">{t('stats.solido_carga_alta_gt_1_5')}</span></div>
          <Bars data={fc.map((x) => ({ label: short(x.day), n: x.n, hi: avg > 0 && x.n > 1.5 * avg }))} label={t('stats.repasos_previstos_por_dia')} />
        </section>
        <section class="glass panel"><div class="panel-h"><h2>{t('stats.consistencia')}</h2></div>
          <Lines a={cons.map((x) => x.n)} b={cons.map((x) => x.avg7)} labels={cons.map((x) => short(x.day))} label={t('stats.tarjetas_por_dia_ultimos_30_dias')} legend={[t('stats.tarjetas_por_dia'), t('stats.promedio_movil_7_dias')]} />
        </section>
        <div class="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <section class="glass panel"><h2 style={{ fontSize: 'var(--t-3)' }}>{t('stats.estabilidad_dias')}</h2><Bars data={sHist.map((n, i) => ({ label: `${sEdges[i]}+`, n }))} label={t('stats.distribucion_de_estabilidad')} every={1} height={120} /></section>
          <section class="glass panel"><h2 style={{ fontSize: 'var(--t-3)' }}>{t('stats.dificultad')}</h2><Bars data={dHist.map((n, i) => ({ label: `${dEdges[i]}`, n }))} label={t('stats.distribucion_de_dificultad')} every={1} height={120} /></section>
        </div>
        <section class="glass panel stack-s"><h2 style={{ fontSize: 'var(--t-3)' }}>{t('stats.estimacion_de_carga_segun_la_retencion')}</h2>
          <p>{t('stats.a_85')}{' '}<b>{Math.round(work['0.85'] ?? 0)}</b>{' '}{t('stats.repasos_dia_a_90')}{' '}<b>{Math.round(work['0.9'] ?? 0)}</b>{' '}{t('stats.a_95')}{' '}<b>{Math.round(work['0.95'] ?? 0)}</b></p>
          <p class="foot">{t('stats.con_tu_historial_actual_suma_de')}</p>
        </section>
        <section class="glass panel"><h2 style={{ fontSize: 'var(--t-3)', marginBottom: '8px' }}>{t('stats.tarjetas_en_riesgo')}</h2>
          {risk.length ? risk.map((r) => <a class="kv" href={href('explorar', `id:${r.cid}`)} style={{ textDecoration: 'none' }}><span class="k ellipsis">{col.byCid.get(r.cid)?.ref.note.front.slice(0, 70)}</span><span class="v">{r.reason}</span></a>) : <p class="t2">{t('stats.ninguna_por_ahora')}</p>}
        </section>
        <Heatmap act={act} today={today} byDeck={byDeckFn(app)} />
        {/* encabezado sobre el fondo: dentro de vidrio, como el resto de secciones (el guardián lo cubre) */}
        <div class="row glass panel"><h2 style={{ fontSize: 'var(--t-2)' }}>{t('calendar.examenes')}</h2><span class="grow" /><AddExamButton /></div>
        {data?.exams.map((e) => <ExamCard exam={e} extra={data.extra} detailed />)}
      </div>
      {how && (
        <Sheet title={t('stats.como_se_calcula')} onClose={() => setHow(false)}>
          <div class="stack note">
            <p><b>{t('stats.retencion_real_2')}</b>{' '}{t('stats.repasos_con_bien_o_facil_sobre')}</p>
            <p><b>{t('stats.precision')}</b>{' '}{t('stats.porcentaje_de_repasos_con_bien_o')}</p>
            <p><b>{t('stats.eficiencia_2')}</b>{' '}{t('stats.tus_segundos_por_tarjeta_de_hoy')}</p>
            <p><b>{t('stats.nuevas_aprendidas')}</b>{' '}{t('stats.de_las_tarjetas_nuevas_que_introdujiste')}</p>
            <p><b>{t('stats.tiempo')}</b>{' '}{t('stats.cada_repaso_registra_su_tiempo_con')}</p>
            <p><b>{t('stats.retencion_proyectada_del_examen')}</b>{' '}{t('stats.simulacion_fsrs_suponiendo_que_respondes_b')}</p>
            <p>{t('stats.todo_se_calcula_desde_reviews_jsonl')}</p>
          </div>
        </Sheet>
      )}
    </>
  );
}
