import { ChevronLeft, ChevronRight } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { addDays, daysBetween, heatLevels, streaks, weekdayMon } from '../lib/days';
import { type DayAct, studyMs } from '../lib/stats';
import { Segmented, Sheet } from '../ui/kit';
import { useApp } from '../state';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Mapa de calor (SPEC §9b A): métrica tarjetas/minutos, navegación por año, detalle al tocar. */
export function Heatmap(props: { act: Map<string, DayAct>; today: string; byDeck?: (day: string) => [string, number][] }) {
  const app = useApp();
  const [metric, setMetric] = useState<'cards' | 'min'>('cards');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const end = addDays(props.today, -offset * 371);
  const lastMon = addDays(end, -weekdayMon(end));
  const start = addDays(lastMon, -52 * 7);
  const val = (d: string) => (metric === 'cards' ? props.act.get(d)?.cards ?? 0 : Math.round(studyMs(props.act.get(d)) / 60000));
  const values = new Map([...props.act.keys()].map((k) => [k, val(k)]));
  const lv = heatLevels(values);
  const counts = new Map([...props.act].map(([k, v]) => [k, v.cards]));
  const st = streaks(counts, props.today, app.settings.streakMin);
  const first = [...counts.keys()].sort()[0];
  const span = first ? daysBetween(first, props.today) + 1 : 0;
  useEffect(() => {
    if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth;
  }, [offset]);
  const cells: preact.JSX.Element[] = [];
  for (let w = 0; w < 53; w++) {
    const wk = addDays(start, w * 7);
    const showM = w === 0 || wk.slice(5, 7) !== addDays(wk, -7).slice(5, 7);
    cells.push(<span class="m" style={{ gridColumn: w + 1 }}>{showM ? MONTHS[Number(wk.slice(5, 7)) - 1] : ''}</span>);
    for (let d = 0; d < 7; d++) {
      const day = addDays(wk, d);
      const n = values.get(day) ?? 0;
      cells.push(<button type="button" class={`c${day > props.today ? ' future' : ''}${day === props.today ? ' today' : ''}`} data-l={lv(n)} style={{ gridColumn: w + 1 }} aria-label={`${day}: ${n} ${metric === 'cards' ? 'tarjetas' : 'min'}`} onClick={() => setOpen(day)} />);
    }
  }
  const a = open ? props.act.get(open) : null;
  return (
    <section class="glass panel" aria-label="Mapa de adherencia">
      <div class="panel-h wrap">
        <h2>Adherencia</h2>
        <div class="row wrap">
          <Segmented label="Métrica" value={metric} onChange={setMetric} options={[['cards', 'Tarjetas'], ['min', 'Minutos']]} />
          <div class="row" role="group" aria-label="Año">
            <button type="button" class="btn icon small" aria-label="Año anterior" onClick={() => setOffset(offset + 1)}><ChevronLeft size={16} /></button>
            <button type="button" class="btn icon small" aria-label="Volver a hoy" onClick={() => setOffset(0)} disabled={offset === 0}>○</button>
            <button type="button" class="btn icon small" aria-label="Año siguiente" onClick={() => setOffset(Math.max(0, offset - 1))} disabled={offset === 0}><ChevronRight size={16} /></button>
          </div>
        </div>
      </div>
      <div class="heat" ref={ref} role="grid" aria-label={`Actividad por día hasta ${end}`}>{cells}</div>
      <div class="row wrap" style={{ justifyContent: 'space-between', marginTop: '8px' }}>
        <span class="foot">Días estudiados: {st.daysStudied}{span ? ` (${Math.round((st.daysStudied / span) * 100)} %)` : ''} · Racha más larga: {st.longest} · Racha actual: {st.current}{st.todayCounts ? ' · hoy ya cuenta' : ''}</span>
        <span class="legend" aria-hidden="true">menos {[0, 1, 2, 3, 4].map((l) => <span class="c" data-l={l} />)} más</span>
      </div>
      {open && (
        <Sheet title={new Intl.DateTimeFormat('es-MX', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(open + 'T12:00:00Z'))} onClose={() => setOpen(null)}>
          <div class="stack-s">
            <div class="kv"><span class="k">Tarjetas</span><span class="v">{a?.cards ?? 0}</span></div>
            <div class="kv"><span class="k">Minutos de estudio</span><span class="v">{Math.round(studyMs(a ?? undefined) / 60000)}</span></div>
            <div class="kv"><span class="k">Enfoque (pomodoro)</span><span class="v">{Math.round((a?.focusMs ?? 0) / 60000)} min</span></div>
            <div class="kv"><span class="k">Simulacros</span><span class="v">{Math.round((a?.examMs ?? 0) / 60000)} min</span></div>
            {props.byDeck?.(open).map(([d, n]) => <div class="kv"><span class="k">{d}</span><span class="v">{n}</span></div>)}
          </div>
        </Sheet>
      )}
    </section>
  );
}
