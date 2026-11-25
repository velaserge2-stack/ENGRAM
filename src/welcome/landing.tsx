import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { ProviderLogo } from '../chat/logos';
import { DemoFrame } from './demo';
import { Ic } from './icons';
import { LangSeg, ThemeSeg, type Chrome } from './chrome';
import { CURRENCY, PLANS, PRICE_PERIOD } from './plans';

const K = (k: string) => t(`bienvenida.${k}`);
const P = (k: string) => K(k).split('|');
const go = (id: string) => document.getElementById(`bv-${id}`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
/** Enlace interno de desplazamiento: sin cambiar el hash. */
function Go(p: { to: string; class?: string; children: preact.ComponentChildren }) {
  return <a class={p.class} href="#/bienvenida" onClick={(e) => { e.preventDefault(); go(p.to); }}>{p.children}</a>;
}

const TABS = [
  { id: 'repaso', hash: '#/estudiar' },
  { id: 'notas', hash: '#/notas' },
  { id: 'examenes', hash: '#/simulacros' },
  { id: 'asistente', hash: '#/hoy' },
];
const TILES: [string, number, number, string][] = [
  ['cards', 88, -9, 'left:7%;top:34px'], ['chart', 74, 8, 'right:7%;top:22px'], ['note', 98, 6, 'left:12%;top:196px'], ['cal', 84, -7, 'right:11%;top:206px'],
  ['grex', 100, -4, 'right:3%;top:296px'], ['pdf', 78, 9, 'left:3%;top:378px'], ['flow', 80, 10, 'right:16%;top:36px'], ['exam', 72, -8, 'left:19%;top:352px'],
];
const style = (s: number, r: number, pos: string, i: number) => `--s:${s}px;--r:${r}deg;--d:-${i * 1.3}s;${pos}`;

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = [...root.querySelectorAll('.bv-reveal')];
    if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
    root.classList.add('js');
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -6% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  return ref;
}

export function Landing(c: Chrome) {
  const [tab, setTab] = useState(0);
  const [filter, setFilter] = useState('todo');
  const ref = useReveal();
  const fns = Array.from({ length: 19 }, (_, i) => P(`fn${i + 1}`));
  const cats = ['todo', 'repaso', 'notas', 'pdf', 'examenes', 'asistente', 'datos'];
  const shown = fns.filter((f) => filter === 'todo' || f[0] === filter);
  const onTabKey = (e: KeyboardEvent, i: number) => {
    const n = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % 4 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i + 3) % 4 : e.key === 'Home' ? 0 : e.key === 'End' ? 3 : -1;
    if (n < 0) return;
    e.preventDefault();
    setTab(n);
    document.getElementById(`bv-t-${TABS[n]!.id}`)?.focus();
  };
  const [capT, capS] = P(`cap_${TABS[tab]!.id}`);

  return (
    <div class="bv-land" ref={ref}>
      <nav class="bv-nav bv-glass" aria-label={K('principal')}>
        <a class="bv-brand" href="#/bienvenida" aria-label={K('inicio')} onClick={(e) => { e.preventDefault(); go('inicio'); }}><i><img src="brand/logo-64.png" alt="" /></i>Engrama</a>
        <Go class="bv-l" to="funciones">{K('nav_funciones')}</Go>
        <Go class="bv-l" to="como">{K('nav_como')}</Go>
        <Go class="bv-l" to="ia">{K('nav_asistente')}</Go>
        <Go class="bv-l" to="precios">{K('nav_precios')}</Go>
        <Go class="bv-l xl" to="preguntas">{K('nav_preguntas')}</Go>
        <span class="bv-sp" />
        <ThemeSeg {...c} />
        <a class="bv-login" href="#/bienvenida/instalar">{K('login')}</a>
        <a class="bv-btn ink sm" href="#/bienvenida/instalar">{K('instalar')}</a>
      </nav>

      <header class="bv-hero" id="bv-inicio">
        <div class="bv-tiles" aria-hidden="true">
          {TILES.map(([n, s, r, pos], i) => <span class="bv-tile float" key={n} style={style(s, r, pos, i)}><Ic n={n} /></span>)}
        </div>
        <div class="bv-wrap">
          <h1 class="bv-display">{K('h1a')}<br />{K('h1b')}</h1>
          <p class="bv-lead">{K('lead')}</p>
          <div class="bv-cta">
            <a class="bv-btn ink" href="#/bienvenida/instalar">{K('instalar')}</a>
            <Go class="bv-btn" to="funciones">{K('cta_funciones')}</Go>
          </div>
          <div class="bv-tabs"><div class="bv-seg big" role="tablist" aria-label={K('nav_asistente')}>
            {TABS.map((x, i) => (
              <button type="button" role="tab" id={`bv-t-${x.id}`} key={x.id} aria-selected={tab === i} aria-controls="bv-stage" tabIndex={tab === i ? 0 : -1}
                onClick={() => setTab(i)} onKeyDown={(e) => onTabKey(e, i)}>{K(`tab_${x.id}`)}</button>
            ))}
          </div></div>
          <div id="bv-stage" role="tabpanel" aria-labelledby={`bv-t-${TABS[tab]!.id}`} class="bv-stage">
            <p class="bv-cap"><b>{capT}</b> {capS}</p>
            <DemoFrame hash={TABS[tab]!.hash} lang={c.lang} dark={c.dark} />
          </div>
        </div>
      </header>

      <section class="bv-sec" style={{ paddingTop: '50px', paddingBottom: '20px' }}><div class="bv-wrap">
        <div class="bv-facts bv-glass bv-reveal">
          {[1, 2, 3, 4, 5].map((i) => { const [b, s] = P(`fact${i}`); return <div key={i}><b class="bv-mono">{b}</b><span>{s}</span></div>; })}
        </div>
      </div></section>

      <section class="bv-sec" id="bv-funciones"><div class="bv-wrap">
        <div class="bv-head bv-reveal"><h2 class="bv-h2">{K('fn_t')}</h2><p class="bv-lead">{K('fn_s')}</p></div>
        <div class="bv-filters" role="group" aria-label={K('nav_funciones')}>
          {cats.map((k) => <button type="button" class="bv-pill" key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{K(`f_${k}`)} <span class="n bv-mono">{fns.filter((f) => k === 'todo' || f[0] === k).length}</span></button>)}
        </div>
        <div class="bv-glass bv-tw bv-reveal">
          <table class="bv-t">
            <thead><tr><th scope="col">{K('th_fn')}</th><th scope="col">{K('th_que')}</th><th scope="col">{K('th_tipo')}</th><th scope="col" class="r">{K('th_dato')}</th></tr></thead>
            <tbody>
              {shown.map((f) => (
                <tr key={f[1]}>
                  <td><b>{f[1]}</b></td><td class="ben">{f[2]}</td>
                  <td><span class="bv-tgs">{(f[4] ?? '').includes('n') && <span class="bv-tg core">{K('tg_n')}</span>}{(f[4] ?? '').includes('a') && <span class="bv-tg">{K('tg_a')}</span>}{(f[4] ?? '').includes('b') && <span class="bv-tg beta">{K('tg_b')}</span>}</span></td>
                  <td class="r dat">{f[3]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div class="bv-tf"><span aria-live="polite">{t('bienvenida.conteo', { n: shown.length, m: fns.length })}</span><span>{K('fn_pie')}</span></div>
        </div>
      </div></section>

      <section class="bv-sec" id="bv-como"><div class="bv-wrap bv-why">
        <div class="bv-reveal">
          <p class="bv-eyebrow">{K('why_eye')}</p>
          <h2 class="bv-h2">{K('why_t')}</h2>
          <div class="bv-glass bv-stat">
            <p class="bv-big">{K('why_big')}</p>
            <p class="c">{K('why_cap')}</p>
            <svg class="curve" viewBox="0 0 400 120" role="img" aria-label={K('why_curve')}>
              <path d="M6 12 C40 40 70 70 96 100 L96 22 C140 44 175 72 210 100 L210 36 C260 56 300 76 340 100 L340 50 C360 60 380 72 394 82" fill="none" stroke="var(--t1)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M6 112h388" stroke="var(--hair)" stroke-width="1.5" />
            </svg>
            <p class="bv-small">{K('why_curve')}</p>
          </div>
        </div>
        <div class="bv-rows bv-reveal">
          {[['clock', 'why1'], ['lock', 'why2'], ['shield', 'why3'], ['off', 'why4']].map(([ic, k]) => { const [h, p] = P(k!); return <div class="bv-row" key={k}><span class="ico"><Ic n={ic!} /></span><h3>{h}</h3><p>{p}</p></div>; })}
        </div>
      </div></section>

      <section class="bv-sec" id="bv-ia"><div class="bv-wrap">
        <div class="bv-head bv-reveal">
          <p class="bv-eyebrow"><span class="bv-mascot"><Ic n="grex" /></span> {K('ia_eye')}</p>
          <h2 class="bv-h2">{K('ia_t')}</h2><p class="bv-lead">{K('ia_s')}</p>
        </div>
        <ul class="bv-caps">
          {[['eye', 1], ['cards', 2], ['exam', 3], ['note', 4], ['flow', 5], ['cal', 6], ['trash', 7], ['mic', 8]].map(([ic, n]) => { const [h, p, q] = P(`ia${n}`); return (
            <li class="bv-glass bv-cardx bv-reveal" key={n}>
              <span class="ico"><Ic n={ic as string} /></span>
              <h3>{h}{n === 8 && <span class="bv-tg beta">{K('tg_b')}</span>}</h3>
              <p>{p}</p>
              <p class="ask"><b>{K('pidele')}</b> «{q}»</p>
            </li>); })}
        </ul>
        <ul class="bv-guar bv-glass bv-reveal">
          {[['check', 1], ['undo', 2], ['eye', 3], ['key', 4]].map(([ic, n]) => <li key={n}><Ic n={ic as string} />{K(`ia_g${n}`)}</li>)}
        </ul>
        <div class="bv-prov" aria-label={K('ia_g4')}>
          {(['gemini', 'groq', 'openrouter', 'kimi'] as const).map((p) => <span class="bv-chip" key={p}><ProviderLogo provider={p} size={18} />{{ gemini: 'Gemini', groq: 'Groq', openrouter: 'OpenRouter', kimi: 'Kimi' }[p]}</span>)}
        </div>
        <p class="bv-note">{K('ia_nota')}</p>
      </div></section>

      <section class="bv-sec" id="bv-migrar"><div class="bv-wrap bv-mig">
        <div class="bv-glass bv-mg bv-reveal">
          <p class="bv-eyebrow">{K('mig_eye')}</p>
          <h2 class="bv-h2 s">{K('mig_t')}</h2>
          <p class="bv-lead">{K('mig_s')}</p>
          <ol class="bv-flowrow">{['mig_1', 'mig_2', 'mig_3'].map((k, i) => <li key={k}><i class="bv-mono">{i + 1}</i>{K(k)}</li>)}</ol>
          <p class="bv-small">{K('mig_nota')}</p>
        </div>
        <div class="bv-glass bv-start bv-reveal">
          <h3>{K('st_t')}</h3>
          {[1, 2, 3].map((i) => <div class="bv-st" key={i}><i class="bv-mono">{i}</i>{K(`st${i}`)}</div>)}
          <h3 style={{ marginTop: '22px' }}>{K('works_t')}</h3>
          <div class="bv-chips">{K('works').split('|').map((w) => <span key={w}>{w}</span>)}</div>
        </div>
      </div></section>

      <section class="bv-sec" id="bv-precios"><div class="bv-wrap">
        <div class="bv-head bv-reveal"><h2 class="bv-h2">{K('pr_t')}</h2><p class="bv-lead">{K('pr_s')}</p></div>
        <div class="bv-plans">
          {PLANS.map((p) => (
            <article class={`bv-glass bv-plan bv-reveal${p.soon ? '' : ' hi'}`} key={p.id}>
              <h3>{t(p.name)}{p.soon && <span class="bv-tg">{K('soon')}</span>}</h3>
              <p class="d">{t(p.desc)}</p>
              <p class="pr"><small>{CURRENCY}</small> {p.price}<small>{t(PRICE_PERIOD)}</small></p>
              <ul>{p.rows.map(([a, b]) => <li key={a}>{t(a)}<b>{t(b)}</b></li>)}</ul>
              {p.soon ? <button type="button" class="bv-btn bv-wide" aria-disabled="true" onClick={(e) => e.preventDefault()}>{K('soon')}</button>
                : <a class="bv-btn ink bv-wide" href="#/bienvenida/instalar">{K('instalar')}</a>}
            </article>
          ))}
        </div>
        <p class="bv-note">{K('pr_nota1')}</p>
        <p class="bv-note">{K('pr_nota2')}</p>
      </div></section>

      <section class="bv-sec" id="bv-preguntas"><div class="bv-wrap">
        <div class="bv-head bv-reveal"><h2 class="bv-h2">{K('faq_t')}</h2></div>
        <div class="bv-faq">
          {[1, 2, 3, 4, 5, 6, 7].map((i) => { const [q, a] = P(`faq${i}`); return <details key={i}><summary>{q}<Ic n="plus" /></summary><p class="a">{a}</p></details>; })}
        </div>
      </div></section>

      <section class="bv-sec" id="bv-empezar" style={{ paddingBottom: 0 }}><div class="bv-wrap">
        <div class="bv-glass bv-final bv-reveal">
          <span class="bv-mascot big"><Ic n="grex" /></span>
          <h2 class="bv-h2">{K('fin_t')}</h2><p class="bv-lead">{K('fin_s')}</p>
          <div class="bv-cta"><a class="bv-btn ink" href="#/bienvenida/instalar">{K('instalar')}</a><a class="bv-btn" href="#/bienvenida/crear">{K('crear')}</a></div>
        </div>
        <footer class="bv-foot">
          <div class="cols">
            <div><a class="bv-brand" href="#/bienvenida" onClick={(e) => { e.preventDefault(); go('inicio'); }}><i><img src="brand/logo-64.png" alt="" /></i>Engrama</a><p class="bv-small">{K('foot_tag')}</p></div>
            <div><h4>{K('foot_prod')}</h4><Go to="funciones">{K('nav_funciones')}</Go><Go to="como">{K('nav_como')}</Go><Go to="ia">{K('nav_asistente')}</Go><Go to="precios">{K('nav_precios')}</Go></div>
            <div><h4>{K('foot_rec')}</h4><Go to="migrar">{K('foot_mig')}</Go><Go to="preguntas">{K('nav_preguntas')}</Go><a href="#/bienvenida/instalar">{K('login')}</a></div>
          </div>
          <div class="bv-bot"><span class="bv-small">{K('fn_beta')}</span><span class="tools"><LangSeg {...c} /><ThemeSeg {...c} /></span></div>
        </footer>
      </div></section>
    </div>
  );
}
