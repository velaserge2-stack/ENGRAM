/** Analítica de estudio (carril A): paneles de Estadísticas y mosaico de Hoy. Se carga con `import()`. */
import { ChevronDown, ChevronRight, Target } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { cached, type GoalWhy, type MasteryNode } from '../lib/analytics';
import type { Exam } from '../lib/exams';
import { srsParams } from '../lib/settings';
import { href, useApp, useAsync } from '../state';
import { t } from '../i18n';
import { ADAPTIVE } from '../srs/adaptive';
import { Bar } from '../ui/kit';
import { loadAttempts } from './simulacros';

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)} %`);
const HOR = [7, 30, 90];

function Node(props: { n: MasteryNode; depth: number }) {
  const { n } = props;
  const [open, setOpen] = useState(false);
  const row = (
    <>
      <span class="grow ellipsis" data-user-content>{n.name}</span>
      <span class="t2 num">{t('analitica.vistas', { seen: n.seen, n: n.cards })}</span>
      <b class="num">{pct(n.mastery)}</b>
    </>
  );
  return (
    <div style={{ paddingLeft: props.depth ? '16px' : '0' }}>
      {n.children.length ? (
        <button type="button" data-tn class="btn small row" style={{ width: '100%', justifyContent: 'flex-start', minHeight: '44px' }} aria-expanded={open} aria-label={t('analitica.desplegar', { name: n.name })} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}{row}
        </button>
      ) : <div class="row" data-tn tabIndex={0} style={{ minHeight: '44px', padding: '0 12px' }}>{row}</div>}
      <Bar value={n.mastery} label={`${n.name}: ${pct(n.mastery)}`} />
      {open && n.children.map((c) => <Node key={c.path} n={c} depth={props.depth + 1} />)}
    </div>
  );
}

/** Calcula fuera del gesto (tarea aparte por panel) y solo cuando el panel se ve; conserva el valor anterior al recalcular. */
function useDeferred<T>(f: () => T, deps: unknown[], on: boolean): T | undefined {
  const [v, setV] = useState<T>();
  useEffect(() => {
    if (!on) return;
    const id = setTimeout(() => setV(f()), 0);
    return () => clearTimeout(id);
  }, [...deps, on]);
  return v;
}
/** `true` cuando el elemento entra en pantalla (sin IntersectionObserver: de inmediato). */
function useSeen(ref: { current: Element | null }): boolean {
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (seen || !ref.current) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: '200px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  return seen;
}
/** Minuto entero: estable entre ticks para que la memoización acierte. */
const minute = () => Math.floor(Date.now() / 60_000) * 60_000;
const h2 = { fontSize: 'var(--t-3)' } as const;
const btnLink = { textDecoration: 'none', minHeight: '44px' } as const;

/** Sección con título, estado de carga (`aria-busy`) y contenido diferido. */
function Panel<T>(props: { title: string; compute: () => T | null; deps: unknown[]; class?: string; children: (d: NonNullable<T>) => preact.ComponentChildren }) {
  const ref = useRef<HTMLElement>(null);
  const seen = useSeen(ref);
  const d = useDeferred(props.compute, props.deps, seen);
  return (
    <section ref={ref} class={`glass panel ${props.class ?? ''}`} aria-busy={d == null} style={d == null ? { minHeight: '96px' } : undefined}>
      <h2 style={{ ...h2, marginBottom: '8px' }}>{props.title}</h2>
      {d == null ? <p class="t2" role="status">{t('analitica.cargando')}</p> : props.children(d)}
    </section>
  );
}

/** Flechas arriba/abajo recorren las filas; derecha/izquierda despliegan/pliegan (Enter y espacio ya son del botón). */
function treeKeys(e: KeyboardEvent) {
  const el = e.target as HTMLElement;
  const rows = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-tn]')];
  const i = rows.indexOf(el);
  if (i < 0) return;
  const open = el.getAttribute('aria-expanded');
  if (e.key === 'ArrowDown') rows[i + 1]?.focus();
  else if (e.key === 'ArrowUp') rows[i - 1]?.focus();
  else if (e.key === 'ArrowRight' && open === 'false') el.click();
  else if (e.key === 'ArrowLeft' && open === 'true') el.click();
  else return;
  e.preventDefault();
}

export function AnalyticsPanels() {
  const app = useApp();
  const col = app.col!;
  const params = srsParams(app.settings);
  const now = minute();
  const { data: attempts } = useAsync(() => loadAttempts(app.vault), [app.version]);
  const card = (cid: string) => col.byCid.get(cid)?.ref.note.front.slice(0, 70) ?? cid;
  const link = (cid: string) => href('explorar', `id:${cid}`);
  const dep = [col, app.tick, now];
  return (
    <>
      <Panel title={t('analitica.dominio')} compute={() => cached.masteryTree(col, now, params)} deps={dep} class="stack-s">
        {(tree) => (
          <>
            <p class="foot">{t('analitica.dominio_ayuda')}</p>
            <div onKeyDown={treeKeys as never}>{tree.map((n) => <Node key={n.path} n={n} depth={0} />)}</div>
          </>
        )}
      </Panel>
      <Panel title={t('analitica.debilidades')} compute={() => cached.weaknesses(col, now)} deps={dep}>
        {(w) => (
          <>
            {w.topics.length ? w.topics.slice(0, 6).map((g) => <div class="kv"><span class="k ellipsis" data-user-content>{g.key}</span><span class="v">{t('analitica.debiles', { n: g.weak })}</span></div>) : <p class="t2">{t('analitica.sin_debiles')}</p>}
            {w.cards.slice(0, 6).map((c) => <a class="kv" href={link(c.cid)} style={btnLink}><span class="k ellipsis" data-user-content>{card(c.cid)}</span><span class="v">{t('analitica.otra_vez_recientes', { n: c.againRecent })}</span></a>)}
          </>
        )}
      </Panel>
      <Panel title={t('analitica.prediccion')} compute={() => cached.forecastRetention(col, now, HOR, params)} deps={dep} class="stack-s">
        {(fc) => (
          <>
            <div class="grid cards3">{HOR.map((h) => <div class="center"><div class="num" style={{ fontSize: 'var(--t-2)' }}><b>{pct(fc.overall.r[h])}</b></div><div class="foot">{t('analitica.en_dias', { n: h })}</div></div>)}</div>
            <p class="foot">{t('analitica.prediccion_ayuda')}</p>
            {fc.decks.slice(0, 8).map((d) => <div class="kv"><span class="k ellipsis" data-user-content>{d.key}</span><span class="v num">{HOR.map((h) => pct(d.r[h])).join(' · ')}</span></div>)}
          </>
        )}
      </Panel>
      <Panel title={t('analitica.olvidos')} compute={() => cached.relapses(col)} deps={dep}>
        {(rel) => (
          <>
            <p class="foot">{t('analitica.olvidos_ayuda')}</p>
            {rel.length ? rel.slice(0, 8).map((r) => <a class="kv" href={link(r.cid)} style={btnLink}><span class="k ellipsis" data-user-content>{card(r.cid)}</span><span class="v">{t('analitica.veces', { n: r.count })}</span></a>) : <p class="t2">{t('analitica.sin_olvidos')}</p>}
          </>
        )}
      </Panel>
      <Panel title={t('analitica.confusiones')} compute={() => (attempts ? cached.confusions(col, attempts) : null)} deps={[...dep, attempts]}>
        {(conf) => (
          <>
            <p class="foot">{t('analitica.confusiones_ayuda')}</p>
            {conf.length ? conf.slice(0, 8).map((c) => c.kind === 'cards'
              ? <div class="kv"><span class="k" data-user-content style={{ minWidth: 0, overflowWrap: 'anywhere' }}><a style={{ display: 'inline-flex', minHeight: '44px', alignItems: 'center' }} href={link(c.a)}>{card(c.a)}</a> ↔ <a style={{ display: 'inline-flex', minHeight: '44px', alignItems: 'center' }} href={link(c.b)}>{card(c.b)}</a></span><span class="v">{t('analitica.fallas_juntas', { n: c.count })}</span></div>
              : <div class="kv"><span class="k ellipsis" data-user-content>{t('analitica.pregunta', { id: c.a })}</span><span class="v">{t('analitica.distractor', { opt: c.b, n: c.count })}</span></div>) : <p class="t2">{t('analitica.sin_confusiones')}</p>}
          </>
        )}
      </Panel>
    </>
  );
}

const whyText = (w: GoalWhy) => w.kind === 'exam' ? t('analitica.porque_examen', { exam: w.exam, needed: w.needed }) : w.kind === 'load' ? t('analitica.porque_carga') : w.kind === 'base' ? t('analitica.porque_base') : t('analitica.sin_objetivos');

/** Hoy: botón «Sesión adaptativa» y tarjeta «Objetivos de hoy». */
export function AdaptiveTile(props: { exams: Exam[] }) {
  const app = useApp();
  const s = app.settings;
  const col = app.col;
  const gp = { newPerDay: s.newPerDay, reviewLimit: s.reviewLimit, tz: s.timeZone, dayStartHour: s.dayStartHour };
  const now = minute();
  const goals = useDeferred(() => (col ? cached.smartNewGoals(col, props.exams, now, gp) : []), [col, props.exams, app.tick, now, s.newPerDay, s.reviewLimit], true);
  const shown = (goals ?? []).filter((g) => g.newLeft > 0).slice(0, 6);
  return (
    <section class="glass panel stack-s" aria-label={t('analitica.objetivos_hoy')}>
      <div class="row wrap" style={{ justifyContent: 'space-between' }}>
        <h3>{t('analitica.objetivos_hoy')}</h3>
        <a class="btn" href={href('estudiar', ADAPTIVE)}><Target size={18} />{' '}{t('analitica.sesion_adaptativa')}</a>
      </div>
      <p class="foot">{t('analitica.sesion_adaptativa_ayuda')}</p>
      {goals === undefined ? <p class="t2" role="status">{t('analitica.cargando')}</p> : shown.length ? shown.map((g) => <div class="kv" style={{ alignItems: 'flex-start' }}><span class="k" data-user-content>{g.deck}<span class="foot" style={{ display: 'block' }}>{g.why.map(whyText).join(' · ')}</span></span><span class="v">{t('analitica.nuevas_n', { n: g.goal })} · {t('analitica.tope', { n: g.cap })}</span></div>) : <p class="t2">{t('analitica.sin_objetivos')}</p>}
    </section>
  );
}
