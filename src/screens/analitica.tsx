/** Analítica de estudio (carril A): paneles de Estadísticas y mosaico de Hoy. Se carga con `import()`. */
import { ChevronDown, ChevronRight, Target } from 'lucide-preact';
import { useMemo, useState } from 'preact/hooks';
import { confusions, forecastRetention, type GoalWhy, masteryTree, type MasteryNode, relapses, smartNewGoals, weaknesses } from '../lib/analytics';
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
        <button type="button" class="btn small row" style={{ width: '100%', justifyContent: 'flex-start', minHeight: '44px' }} aria-expanded={open} aria-label={t('analitica.desplegar', { name: n.name })} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}{row}
        </button>
      ) : <div class="row" style={{ minHeight: '44px', padding: '0 12px' }}>{row}</div>}
      <Bar value={n.mastery} label={`${n.name}: ${pct(n.mastery)}`} />
      {open && n.children.map((c) => <Node key={c.path} n={c} depth={props.depth + 1} />)}
    </div>
  );
}

export function AnalyticsPanels() {
  const app = useApp();
  const col = app.col!;
  const params = srsParams(app.settings);
  const now = Date.now();
  const { data: attempts } = useAsync(() => loadAttempts(app.vault), [app.version]);
  const a = useMemo(() => ({
    tree: masteryTree(col, now, params),
    weak: weaknesses(col, now),
    fc: forecastRetention(col, now, HOR, params),
    rel: relapses(col),
  }), [col, app.tick]);
  const conf = useMemo(() => confusions(col, attempts ?? []), [col, app.tick, attempts]);
  const card = (cid: string) => col.byCid.get(cid)?.ref.note.front.slice(0, 70) ?? cid;
  const link = (cid: string) => href('explorar', `id:${cid}`);
  return (
    <>
      <section class="glass panel stack-s"><h2 style={{ fontSize: 'var(--t-3)' }}>{t('analitica.dominio')}</h2>
        <p class="foot">{t('analitica.dominio_ayuda')}</p>
        {a.tree.map((n) => <Node key={n.path} n={n} depth={0} />)}
      </section>
      <section class="glass panel"><h2 style={{ fontSize: 'var(--t-3)', marginBottom: '8px' }}>{t('analitica.debilidades')}</h2>
        {a.weak.topics.length ? a.weak.topics.slice(0, 6).map((g) => <div class="kv"><span class="k ellipsis" data-user-content>{g.key}</span><span class="v">{t('analitica.debiles', { n: g.weak })}</span></div>) : <p class="t2">{t('analitica.sin_debiles')}</p>}
        {a.weak.cards.slice(0, 6).map((c) => <a class="kv" href={link(c.cid)} style={{ textDecoration: 'none', minHeight: '44px' }}><span class="k ellipsis" data-user-content>{card(c.cid)}</span><span class="v">{t('analitica.otra_vez_recientes', { n: c.againRecent })}</span></a>)}
      </section>
      <section class="glass panel stack-s"><h2 style={{ fontSize: 'var(--t-3)' }}>{t('analitica.prediccion')}</h2>
        <div class="grid cards3">{HOR.map((h) => <div class="center"><div class="num" style={{ fontSize: 'var(--t-2)' }}><b>{pct(a.fc.overall.r[h])}</b></div><div class="foot">{t('analitica.en_dias', { n: h })}</div></div>)}</div>
        <p class="foot">{t('analitica.prediccion_ayuda')}</p>
        {a.fc.decks.slice(0, 8).map((d) => <div class="kv"><span class="k ellipsis" data-user-content>{d.key}</span><span class="v num">{HOR.map((h) => pct(d.r[h])).join(' · ')}</span></div>)}
      </section>
      <section class="glass panel"><h2 style={{ fontSize: 'var(--t-3)' }}>{t('analitica.olvidos')}</h2>
        <p class="foot">{t('analitica.olvidos_ayuda')}</p>
        {a.rel.length ? a.rel.slice(0, 8).map((r) => <a class="kv" href={link(r.cid)} style={{ textDecoration: 'none', minHeight: '44px' }}><span class="k ellipsis" data-user-content>{card(r.cid)}</span><span class="v">{t('analitica.veces', { n: r.count })}</span></a>) : <p class="t2">{t('analitica.sin_olvidos')}</p>}
      </section>
      <section class="glass panel"><h2 style={{ fontSize: 'var(--t-3)' }}>{t('analitica.confusiones')}</h2>
        <p class="foot">{t('analitica.confusiones_ayuda')}</p>
        {conf.length ? conf.slice(0, 8).map((c) => c.kind === 'cards'
          ? <div class="kv"><span class="k" data-user-content><a href={link(c.a)}>{card(c.a)}</a> ↔ <a href={link(c.b)}>{card(c.b)}</a></span><span class="v">{t('analitica.fallas_juntas', { n: c.count })}</span></div>
          : <div class="kv"><span class="k ellipsis" data-user-content>{t('analitica.pregunta', { id: c.a })}</span><span class="v">{t('analitica.distractor', { opt: c.b, n: c.count })}</span></div>) : <p class="t2">{t('analitica.sin_confusiones')}</p>}
      </section>
    </>
  );
}

const whyText = (w: GoalWhy) => w.kind === 'exam' ? t('analitica.porque_examen', { exam: w.exam, needed: w.needed }) : w.kind === 'load' ? t('analitica.porque_carga') : w.kind === 'base' ? t('analitica.porque_base') : t('analitica.sin_objetivos');

/** Hoy: botón «Sesión adaptativa» y tarjeta «Objetivos de hoy». */
export function AdaptiveTile(props: { exams: Exam[] }) {
  const app = useApp();
  const s = app.settings;
  const col = app.col;
  const goals = useMemo(() => (col ? smartNewGoals(col, props.exams, Date.now(), { newPerDay: s.newPerDay, reviewLimit: s.reviewLimit, tz: s.timeZone, dayStartHour: s.dayStartHour }) : []), [col, props.exams, app.tick, s.newPerDay, s.reviewLimit]);
  const shown = goals.filter((g) => g.newLeft > 0).slice(0, 6);
  return (
    <section class="glass panel stack-s" aria-label={t('analitica.objetivos_hoy')}>
      <div class="row wrap" style={{ justifyContent: 'space-between' }}>
        <h3>{t('analitica.objetivos_hoy')}</h3>
        <a class="btn" href={href('estudiar', ADAPTIVE)}><Target size={18} />{' '}{t('analitica.sesion_adaptativa')}</a>
      </div>
      <p class="foot">{t('analitica.sesion_adaptativa_ayuda')}</p>
      {shown.length ? shown.map((g) => <div class="kv" style={{ alignItems: 'flex-start' }}><span class="k" data-user-content>{g.deck}<span class="foot" style={{ display: 'block' }}>{g.why.map(whyText).join(' · ')}</span></span><span class="v">{t('analitica.nuevas_n', { n: g.goal })} · {t('analitica.tope', { n: g.cap })}</span></div>) : <p class="t2">{t('analitica.sin_objetivos')}</p>}
    </section>
  );
}
