import { Archive, CircleCheck, Clock, Flame, HardDriveDownload, Import, Layers, Sparkles, Target, TriangleAlert } from 'lucide-preact';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { dayKey, daysBetween, heatGrid, heatLevels, streaks } from '../lib/days';
import { activityByDay, deckSummaries, loadReviews } from '../lib/summary';
import { useApp, useAsync } from '../state';
import { LargeTitle, Sheet } from '../ui/kit';
import { DeckTable } from './decks';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function Tile(props: { color: string; icon: JSX.Element; label: string; value: string | number; unit?: string; foot?: string; class?: string }) {
  return (
    <section class={`tile glass ${props.class ?? ''}`} style={{ '--tint': `var(--c-${props.color})`, '--on-tint': `var(--on-${props.color})` }} aria-label={props.label}>
      <div class="tile-head">
        <span class="chip" aria-hidden="true">{props.icon}</span>
      </div>
      <div class="big">
        {props.value}
        {props.unit && <small>{props.unit}</small>}
      </div>
      <div class="label">{props.label}</div>
      {props.foot && <div class="foot">{props.foot}</div>}
    </section>
  );
}

export function Today() {
  const app = useApp();
  const { settings: s } = app;
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const heatRef = useRef<HTMLDivElement>(null);
  const { data } = useAsync(async () => {
    const [decks, reviews] = await Promise.all([deckSummaries(app.vault), loadReviews(app.vault)]);
    return { decks, reviews };
  }, [app.version]);

  const now = Date.now();
  const today = dayKey(now, s.timeZone, s.dayStartHour);
  const act = activityByDay(data?.reviews ?? [], s.timeZone, s.dayStartHour);
  const counts = new Map([...act].map(([k, v]) => [k, v.cards]));
  const st = streaks(counts, today, s.streakMin);
  const t = act.get(today) ?? { cards: 0, ms: 0 };
  const minutes = Math.round(t.ms / 60000);
  const totalCards = data?.decks.reduce((n, d) => n + d.cards, 0) ?? 0;
  const lv = heatLevels(counts);
  const grid = heatGrid(today);
  const dateLabel = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: s.timeZone }).format(now);
  const problems = app.integrity?.problems.length ?? 0;
  const firstDay = [...counts.keys()].sort()[0];
  const backupDays = s.lastExportAt ? Math.floor((now - s.lastExportAt) / 86_400_000) : null;
  // En pantallas estrechas el mapa se desplaza: mostrar primero las semanas recientes
  useEffect(() => {
    const el = heatRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [data]);
  const span = firstDay ? daysBetween(firstDay, today) + 1 : 0;

  return (
    <>
      <LargeTitle title="Hoy" sub={dateLabel}>
        <button type="button" class="btn glass" onClick={() => app.openSheet('import')}>
          <Import size={18} aria-hidden="true" /> Importar
        </button>
        <button type="button" class="btn glass" onClick={() => app.openSheet('backup')}>
          <Archive size={18} aria-hidden="true" /> Respaldo
        </button>
      </LargeTitle>
      <div class="page">
        {problems > 0 && (
          <a class="banner glass warn" href="#/ajustes" style={{ color: 'inherit', textDecoration: 'none' }}>
            <TriangleAlert size={18} />
            <span class="k">{problems === 1 ? '1 archivo tiene' : `${problems} archivos tienen`} problemas de formato. No se borró nada. Ver detalles en Ajustes.</span>
          </a>
        )}
        <div class="bento">
          <section class="tile glass w2" style={{ '--tint': 'var(--accent)' }} aria-label="Resumen del día">
            <div class="tile-head">
              <h2>Resumen</h2>
              <span class="chip" aria-hidden="true" style={{ background: 'var(--accent-fill)', color: 'var(--on-accent)' }}>
                <Sparkles size={20} />
              </span>
            </div>
            <p style={{ fontSize: 'var(--t-3)', margin: 'auto 0 0', letterSpacing: '-0.01em' }}>
              {t.cards > 0
                ? `Estudiaste ${t.cards} tarjetas en ${minutes} min hoy (${Math.round(t.ms / 1000 / t.cards)} s/tarjeta).`
                : totalCards > 0
                  ? `Tienes ${totalCards} tarjetas en ${data!.decks.length} ${data!.decks.length === 1 ? 'mazo' : 'mazos'}. El repaso llega en la fase 2.`
                  : 'Tu bóveda está vacía. Importa un mazo o una bóveda para empezar.'}
            </p>
            <div class="foot">{st.todayCounts ? 'Hoy ya cuenta para tu racha.' : 'Hoy aún no cuenta para tu racha.'}</div>
          </section>
          <Tile color="rojo" icon={<Target size={20} />} label="Vencidas" value={0} foot="Sin programación aún" />
          <Tile color="azul" icon={<Layers size={20} />} label="Nuevas" value={totalCards} foot="Conteo preliminar" />
          <Tile color="naranja" icon={<Flame size={20} />} label="Racha" value={st.current} unit={st.current === 1 ? 'día' : 'días'} foot={`Máxima: ${st.longest}`} />
          <Tile color="indigo" icon={<Clock size={20} />} label="Tiempo hoy" value={minutes} unit="min" />
          <Tile color="verde" icon={<CircleCheck size={20} />} label="Retención real" value="—" foot="Con tus repasos de tarjetas maduras" />
          <button type="button" class="tile glass tile-btn" style={{ '--tint': 'var(--c-turquesa)', '--on-tint': 'var(--on-turquesa)' }} onClick={() => app.openSheet('backup')}>
            <div class="tile-head">
              <span class="chip" aria-hidden="true"><HardDriveDownload size={20} /></span>
            </div>
            <div class="big">
              {backupDays ?? '—'}
              {backupDays !== null && <small>{backupDays === 1 ? 'día' : 'días'}</small>}
            </div>
            <div class="label">Desde tu último respaldo</div>
            <div class="foot" style={{ color: 'var(--accent)' }}>Respaldar ›</div>
          </button>

          <section class="tile glass dense wide" style={{ '--tint': 'var(--accent)' }} aria-label="Mapa de adherencia">
            <div class="tile-head">
              <h2>Adherencia</h2>
              <div class="legend" aria-hidden="true">
                menos
                {[0, 1, 2, 3, 4].map((l) => (
                  <span class="c heat-l" data-l={l} style={{ background: l ? `color-mix(in srgb, var(--heat) ${[0, 30, 55, 78, 100][l]}%, var(--fill))` : 'var(--fill)' }} />
                ))}
                más
              </div>
            </div>
            <div class="heat" ref={heatRef} role="grid" aria-label="Tarjetas por día, últimas 53 semanas">
              {grid.map((week, wi) => {
                const first = week[0]!;
                const showMonth = wi === 0 || first.slice(5, 7) !== grid[wi - 1]![0]!.slice(5, 7);
                return [
                  <span class="m" style={{ gridColumn: wi + 1 }}>{showMonth ? MONTHS[Number(first.slice(5, 7)) - 1] : ''}</span>,
                  ...week.map((d) => {
                    const n = counts.get(d) ?? 0;
                    return (
                      <button
                        type="button"
                        class={`c${d > today ? ' future' : ''}${d === today ? ' today' : ''}`}
                        data-l={lv(n)}
                        style={{ gridColumn: wi + 1 }}
                        aria-label={`${d}: ${n} tarjetas`}
                        onClick={() => setDayOpen(d)}
                      />
                    );
                  }),
                ];
              })}
            </div>
            <div class="foot">
              Días estudiados: {st.daysStudied}{span ? ` (${Math.round((st.daysStudied / span) * 100)} %)` : ''} · Racha más larga: {st.longest} · Racha actual: {st.current}
            </div>
          </section>

          <div style={{ gridColumn: '1 / -1' }}>
            <DeckTable decks={data?.decks ?? []} />
          </div>
        </div>
      </div>
      {dayOpen && (
        <Sheet title={new Intl.DateTimeFormat('es-MX', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(dayOpen + 'T12:00:00Z'))} onClose={() => setDayOpen(null)}>
          <p>
            {act.get(dayOpen)?.cards ?? 0} tarjetas · {Math.round((act.get(dayOpen)?.ms ?? 0) / 60000)} min
          </p>
        </Sheet>
      )}
    </>
  );
}
