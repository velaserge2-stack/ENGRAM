import { t as tr, tn } from '../i18n';
import { CircleCheck, CircleDashed, TriangleAlert, CircleHelp, Flag, Plus } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { setDeckMeta, safeName } from '../data/ops';
import { addDays, dayKey, daysBetween } from '../lib/days';
import { decksForTopic, type Exam, examCids, fmtDate, newPerDayMap, pace, type PaceStatus, parseExam, projectedRetention, serializeExam, topicStats } from '../lib/exams';
import { srsParams } from '../lib/settings';
import { avgDaily, activity, forecast } from '../lib/stats';
import { useApp, useAsync } from '../state';
import { Bar, Sheet } from '../ui/kit';
import { readTextOr } from '../vault/util';
import type { Extra } from '../lib/stats';

const PACE = (): Record<PaceStatus, { icon: preact.JSX.Element; text: string; fill: 'full' | 'half' | 'outline' }> => ({
  'en-ritmo': { icon: <CircleCheck size={18} />, text: tr('exams.en_ritmo'), fill: 'full' },
  ajustado: { icon: <CircleDashed size={18} />, text: tr('exams.ajustado'), fill: 'half' },
  atrasado: { icon: <TriangleAlert size={18} />, text: tr('exams.atrasado'), fill: 'outline' },
  calculando: { icon: <CircleHelp size={18} />, text: tr('exams.aun_calculando'), fill: 'outline' },
  terminado: { icon: <Flag size={18} />, text: tr('exams.temario_visto'), fill: 'full' },
  pasado: { icon: <Flag size={18} />, text: tr('exams.ya_paso'), fill: 'outline' },
});

export function ExamCard(props: { exam: Exam; extra: Extra; detailed?: boolean }) {
  const app = useApp();
  const col = app.col;
  const s = app.settings;
  const [adjust, setAdjust] = useState(false);
  if (!col) return null;
  const e = props.exam;
  const now = Date.now();
  const today = dayKey(now, s.timeZone, s.dayStartHour);
  const params = srsParams(s);
  const topics = e.topics.map((t) => topicStats(col, t, e.goal, now, params));
  const cids = examCids(col, e);
  const newLeft = topics.reduce((n, t) => n + t.newLeft, 0);
  const { map, first } = newPerDayMap(col, cids, s.timeZone, s.dayStartHour);
  const p = pace({ today, examDate: e.date, created: e.created, finalDays: e.finalDays, newLeft, newPerDay: map, firstActivity: first, minPerDay: e.minPerDay });
  const st = PACE()[p.status];
  const missing = topics.filter((t) => !t.complete).length;
  const examTs = Date.parse(e.date + 'T09:00:00');
  const proj = props.detailed ? projectedRetention(col, cids, examTs, now, params) : null;
  const act = props.detailed ? activity(col.log, props.extra, s.timeZone, s.dayStartHour) : null;
  const fc = props.detailed ? forecast(col, now, s.timeZone, s.dayStartHour, Math.min(60, Math.max(1, p.daysLeft + 1))) : [];
  const avg = act ? avgDaily(act, today) : 0;
  const peak = fc.reduce((m, x) => Math.max(m, x.n), 0);
  return (
    <section class="glass panel stack-s" aria-label={tr('exams.examen_name', { name: e.name })}>
      <div class="panel-h" style={{ marginBottom: 0 }}>
        <h2 style={{ fontSize: 'var(--t-3)' }}>{e.name}</h2>
        <button type="button" class="btn small" onClick={() => app.openSheet('exam', e.path)}>{tr('exams.editar')}</button>
      </div>
      <div class="row" style={{ alignItems: 'baseline' }}>
        <span class="big">{p.daysLeft < 0 ? '—' : p.daysLeft}</span><small class="t2">{tn('plural.daysword', p.daysLeft)} · {fmtDate(e.date)}</small>
      </div>
      <Bar value={p.elapsed} label={tr('exams.tiempo_transcurrido_desde_que_lo_creaste')} />
      <div class="row" style={{ fontWeight: 700 }}>{st.icon} {st.text}</div>
      <div class={`bar prog${st.fill === 'outline' ? ' outline' : ''}`} aria-hidden="true"><i style={{ width: st.fill === 'full' ? '100%' : st.fill === 'half' ? '50%' : `${Math.min(100, (p.actual / Math.max(1, p.needed)) * 100)}%` }} /></div>
      <p class="note">{p.message}</p>
      <p class="note t2">{tr('exams.te_faltan_missing_de_n_temas', { missing: missing, n: topics.length, newLeft: newLeft })}</p>
      {props.detailed && (
        <>
          <table class="tbl">
            <thead><tr><th>{tr('exams.tema')}</th><th>{tr('today.total')}</th><th>{tr('today.nuevas')}</th><th>{tr('exams.cobertura')}</th><th>{tr('exams.dominio')}</th><th>{tr('exams.estado')}</th></tr></thead>
            <tbody>
              {topics.map((t) => (
                <tr>
                  <td>{t.topic}{decksForTopic(col, t.topic).length === 0 && <span class="chip">{tr('exams.sin_mazos')}</span>}</td>
                  <td class="num">{t.total}</td><td class="num">{t.newLeft}</td>
                  <td class="num">{Math.round(t.coverage * 100)} %</td><td class="num">{Math.round(t.mastery * 100)} %</td>
                  <td>{t.complete ? tr('exams.completo') : tr('exams.pendiente')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div class="kv"><span class="k">{tr('exams.retencion_proyectada_el_dia_del_examen')}</span><span class="v">{proj === null ? '—' : `${Math.round(proj * 100)} %`} {proj !== null && (proj >= e.goal ? '✓' : '⚠')} meta {Math.round(e.goal * 100)} %</span></div>
          <div class="kv"><span class="k">{tr('exams.carga_futura_maxima')}</span><span class="v">{tr('exams.peak_repasos_dia', { peak: peak })}{' '}{avg > 0 && peak > 1.5 * avg ? tr('exams.supera_1_5_tu_promedio_p', { p: Math.round(avg) }) : ''}</span></div>
          {p.status !== 'pasado' && p.status !== 'terminado' && <button type="button" class="btn" onClick={() => setAdjust(true)}>{tr('exams.ajustar_plan')}</button>}
        </>
      )}
      {adjust && (
        <Sheet title={tr('exams.ajustar_plan')} onClose={() => setAdjust(false)}>
          <div class="stack">
            <p>{tr('exams.para_terminar_el_temario_finaldays_dias', { finalDays: e.finalDays })}{' '}<b>{tr('exams.needed_nuevas_dia', { needed: p.needed })}</b>.</p>
            <p class="t2">{tr('exams.se_repartira_entre_los_size_mazos', { size: new Set(e.topics.flatMap((t) => decksForTopic(col, t))).size })}{' '}<code>new_per_day</code>{' '}{tr('exams.de_cada_archivo')}</p>
            <button type="button" class="btn primary" onClick={async () => {
              const decks = [...new Set(e.topics.flatMap((t) => decksForTopic(col, t)))];
              const left = decks.map((d) => ({ d, n: d.cards.filter((c) => !col.states.get(c.cid) || col.states.get(c.cid)!.card.state === 0).length }));
              const tot = left.reduce((x, y) => x + y.n, 0) || 1;
              for (const { d, n } of left) if (n) await setDeckMeta(app.vault, d.path, { new_per_day: Math.max(1, Math.ceil((p.needed * n) / tot)) });
              app.changed();
              setAdjust(false);
              app.toast(tr('exams.limites_actualizados'));
            }}>{tr('exams.aplicar_a_los_mazos')}</button>
          </div>
        </Sheet>
      )}
    </section>
  );
}

export function ExamSheet(props: { path: string | null; onClose: () => void }) {
  const app = useApp();
  const s = app.settings;
  const today = dayKey(Date.now(), s.timeZone, s.dayStartHour);
  const { data } = useAsync(async () => (props.path ? parseExam(props.path, await readTextOr(app.vault, props.path, '')) : null), [props.path]);
  const [form, setForm] = useState<Exam | null>(null);
  const e: Exam = form ?? data ?? { path: '', name: '', date: addDays(today, 30), topics: [], goal: 0.9, finalDays: 7, minPerDay: null, created: today, notes: '' };
  const set = (patch: Partial<Exam>) => setForm({ ...e, ...patch });
  const options = [...new Set([...(app.col?.decks.map((d) => d.full) ?? []), ...(app.col?.decks.map((d) => d.folder).filter(Boolean) ?? []), ...(app.col?.decks.flatMap((d) => d.tags.map((t) => `tag:${t}`)) ?? [])])].sort();
  if (props.path && !data && !form) return null;
  return (
    <Sheet title={props.path ? tr('exams.editar_examen') : tr('exams.anadir_examen')} onClose={props.onClose}>
      <form class="stack" onSubmit={async (ev) => {
        ev.preventDefault();
        const path = props.path ?? `exams/${safeName(e.name)}.md`;
        await app.vault.write(path, serializeExam({ ...e, path }, props.path ? await readTextOr(app.vault, props.path, '') : ''));
        app.changed();
        props.onClose();
      }}>
        <label class="field">{tr('decks.nombre')}<input class="input" required value={e.name} onInput={(x) => set({ name: (x.target as HTMLInputElement).value })} placeholder={tr('exams.cardiologia_parcial_1')} /></label>
        <label class="field">{tr('exams.fecha')}<input class="input" type="date" required value={e.date} onInput={(x) => set({ date: (x.target as HTMLInputElement).value })} /></label>
        <fieldset class="field" style={{ border: 0, padding: 0 }}>
          <legend>{tr('exams.temas_mazos_carpetas_o_etiquetas')}</legend>
          <div class="row wrap">
            {options.map((o) => (
              <button type="button" class={`btn small${e.topics.includes(o) ? ' primary' : ''}`} aria-pressed={e.topics.includes(o)} onClick={() => set({ topics: e.topics.includes(o) ? e.topics.filter((t) => t !== o) : [...e.topics, o] })}>{o}</button>
            ))}
            {!options.length && <span class="t2">{tr('exams.crea_mazos_primero')}</span>}
          </div>
        </fieldset>
        <div class="row wrap">
          <label class="field">{tr('exams.meta_de_retencion')}<input class="input" type="number" min={70} max={99} value={Math.round(e.goal * 100)} onInput={(x) => set({ goal: Number((x.target as HTMLInputElement).value) / 100 })} /></label>
          <label class="field">{tr('exams.dias_de_repaso_final')}<input class="input" type="number" min={0} max={60} value={e.finalDays} onInput={(x) => set({ finalDays: Number((x.target as HTMLInputElement).value) })} /></label>
          <label class="field">{tr('exams.minimo_de_tarjetas_dia_opcional')}<input class="input" type="number" min={0} value={e.minPerDay ?? ''} onInput={(x) => set({ minPerDay: Number((x.target as HTMLInputElement).value) || null })} /></label>
        </div>
        <div class="row">
          <button class="btn primary" type="submit">{tr('calendar.guardar')}</button>
          {props.path && <button type="button" class="btn danger" onClick={async () => { if (confirm(tr('exams.confirm_eliminar'))) { await app.vault.remove(props.path!); app.changed(); props.onClose(); } }}>{tr('calendar.eliminar')}</button>}
        </div>
        <p class="foot">{tr('exams.se_guarda_en_exams_como_markdown')}{' '}{Math.max(0, daysBetween(today, e.date))}{' '}{tr('exams.dias')}</p>
      </form>
    </Sheet>
  );
}

/**
 * Acción principal (pantalla vacía o encabezado): relleno invertido, que contrasta con cualquier
 * fondo, sin color. Antes era un `.btn` suelto sobre el fondo (relleno de ~6 %) y se perdía.
 */
export function AddExamButton(p: { small?: boolean } = {}) {
  const app = useApp();
  return <button type="button" class={`btn primary${p.small ? ' small' : ''}`} onClick={() => app.openSheet('exam')}><Plus size={18} />{' '}{tr('exams.anadir_examen')}</button>;
}
