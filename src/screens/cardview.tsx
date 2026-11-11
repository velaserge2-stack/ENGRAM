import { t } from '../i18n';
/**
 * Vista de una tarjeta para estudiar (todos los tipos de SPEC §4 y §4b).
 * Interacción táctil con Pointer Events; alternativa "tocar uno y luego su
 * pareja" y botones para teclado/VoiceOver.
 */
import { ArrowDown, ArrowUp, Check, X } from 'lucide-preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { autoGrade, type CardRef, checkTyped, type TypedVerdict } from '../cards/parse';
import { renderCloze, renderInline, renderMarkdown } from '../md/render';
import type { Rating } from '../srs/engine';
import { Html } from '../ui/md';
import { mediaUrl } from '../ui/background';
import { resolveMedia } from '../data/ops';
import { useApp } from '../state';

export function shuffle<T>(a: T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const r = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 2 ** 32;
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export interface CardViewProps {
  card: CardRef;
  revealed: boolean;
  onReveal: () => void;
  /** tarjetas interactivas: calificación sugerida automáticamente */
  onSuggest: (r: Rating) => void;
  startedAt: number;
  seed: string;
}

export function CardView(p: CardViewProps) {
  const n = p.card.note;
  switch (n.type) {
    case 'basic':
      return <QA front={n.front} back={n.back} revealed={p.revealed} />;
    case 'reverse':
      return p.card.ord === 1 ? <QA front={n.back} back={n.front} revealed={p.revealed} /> : <QA front={n.front} back={n.back} revealed={p.revealed} />;
    case 'cloze':
      return <Html html={renderCloze(n.front, p.card.ord, p.revealed)} class="front" />;
    case 'type':
      return <Typed {...p} />;
    case 'io':
      return <Occlusion image={n.image} rects={n.rects} target={p.card.ord} revealed={p.revealed} />;
    case 'list':
    case 'olist':
      return <ListRecall {...p} />;
    case 'mc':
      return <MultipleChoice {...p} />;
    case 'match':
      return <Match {...p} />;
    case 'order':
      return <Order {...p} />;
  }
}

function QA(p: { front: string; back: string; revealed: boolean }) {
  return (
    <>
      <Html html={renderMarkdown(p.front)} class="front" />
      {p.revealed && (
        <>
          <hr />
          <Html html={renderMarkdown(p.back)} class="back" />
        </>
      )}
    </>
  );
}

const VERDICT = (): Record<TypedVerdict, string> => ({ correct: t('cardview.correcto'), almost: t('cardview.casi_correcto'), wrong: t('cardview.incorrecto') });

function Typed(p: CardViewProps) {
  const n = p.card.note;
  const [val, setVal] = useState('');
  const [v, setV] = useState<TypedVerdict | null>(null);
  const check = () => {
    const r = checkTyped(val, n.back);
    setV(r);
    p.onSuggest(r === 'correct' ? 3 : r === 'almost' ? 2 : 1);
    p.onReveal();
  };
  return (
    <>
      <Html html={renderMarkdown(n.front)} class="front" />
      <form class="row" onSubmit={(e) => (e.preventDefault(), check())}>
        <input class="input grow" value={val} onInput={(e) => setVal((e.target as HTMLInputElement).value)} placeholder={t('cardview.escribe_tu_respuesta')} autoFocus disabled={!!v} aria-label={t('cardview.tu_respuesta')} autocapitalize="off" autocomplete="off" spellcheck={false} />
        {!v && <button class="btn primary" type="submit">{t('cardview.comprobar')}</button>}
      </form>
      {v && (
        <>
          <div class="row" style={{ fontWeight: 700 }}>{VERDICT()[v]}</div>
          <hr />
          <Html html={renderMarkdown(n.back)} class="back" />
        </>
      )}
    </>
  );
}

/** Oclusión: rectángulos en % de la imagen. ord −1 = ocultar todo / revelar todo. */
export function Occlusion(p: { image: string; rects: { x: number; y: number; w: number; h: number }[]; target: number; revealed: boolean; hideAll?: boolean }) {
  const app = useApp();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    void resolveMedia(app.vault, p.image).then((path) => (path ? mediaUrl(app.vault, path) : null)).then(setUrl);
  }, [p.image]);
  if (!url) return <div class="err">{t('cardview.falta_la_imagen_image', { image: p.image })}</div>;
  return (
    <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }} data-user-content>
      <img src={url} alt={t('cardview.imagen_image', { image: p.image })} style={{ maxWidth: '100%', display: 'block', borderRadius: '12px' }} />
      {p.rects.map((r, i) => {
        const isT = p.target === -1 || i === p.target;
        const show = p.revealed ? !isT && p.hideAll : isT || p.hideAll;
        if (!show && !(p.revealed && isT)) return null;
        return (
          <div
            key={i}
            aria-label={isT ? (p.revealed ? t('cardview.zona_revelada') : t('cardview.zona_oculta_a_recordar')) : t('cardview.zona_oculta')}
            style={{
              position: 'absolute', left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%`, borderRadius: '6px',
              background: p.revealed && isT ? 'transparent' : isT ? '#111' : '#666',
              border: isT ? '2.5px solid #fff' : '1px solid #fff', boxShadow: isT ? '0 0 0 1.5px #000' : 'none',
            }}
          />
        );
      })}
    </div>
  );
}

function ListRecall(p: CardViewProps) {
  const n = p.card.note;
  const [i, setI] = useState(0);
  const [errs, setErrs] = useState<number[]>([]);
  const done = i >= n.items.length;
  const mark = (ok: boolean) => {
    const e = ok ? errs : [...errs, i];
    setErrs(e);
    const next = i + 1;
    setI(next);
    if (next >= n.items.length) (p.onSuggest(autoGrade(e.length, Date.now() - p.startedAt, n.items.length)), p.onReveal());
  };
  return (
    <>
      <Html html={renderMarkdown(n.front)} class="front" />
      <p class="foot">{n.type === 'olist' ? t('cardview.recuerda_todos_en_orden') : t('cardview.recuerda_todos_los_elementos')}{' '}{t('cardview.revelalos_uno_a_uno')}</p>
      <ol class="stack-s" style={{ paddingLeft: '1.4em', margin: 0 }}>
        {n.items.slice(0, done || p.revealed ? undefined : i).map((it, k) => (
          <li key={k} style={{ textDecoration: errs.includes(k) ? 'underline dashed' : 'none' }}>
            <Html tag="span" html={renderInline(it)} /> {errs.includes(k) ? <span class="chip">{t('cardview.olvidado')}</span> : <Check size={16} aria-label={t('cardview.recordado')} />}
          </li>
        ))}
      </ol>
      {!done && !p.revealed && (
        <div class="row wrap">
          <span class="t2">{t('cardview.elemento_p_de_n', { p: i + 1, n: n.items.length })}</span>
          <button type="button" class="btn" onClick={() => mark(true)}><Check size={18} />{' '}{t('cardview.lo_recorde')}</button>
          <button type="button" class="btn outline" onClick={() => mark(false)}><X size={18} />{' '}{t('cardview.no_lo_recorde')}</button>
        </div>
      )}
    </>
  );
}

function MultipleChoice(p: CardViewProps) {
  const n = p.card.note;
  const opts = useMemo(() => shuffle(n.options.map((o, i) => ({ ...o, i })), p.seed), [p.card.cid, p.seed]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const multi = n.options.filter((o) => o.correct).length > 1;
  const check = () => {
    const errors = opts.filter((o) => o.correct !== sel.has(o.i)).length;
    p.onSuggest(autoGrade(errors, Date.now() - p.startedAt, 1));
    p.onReveal();
  };
  return (
    <>
      <Html html={renderMarkdown(n.front)} class="front" />
      {multi && <p class="foot">{t('cardview.puede_haber_varias_correctas')}</p>}
      <div class="stack-s" role={multi ? 'group' : 'radiogroup'}>
        {opts.map((o, k) => {
          const on = sel.has(o.i);
          const cls = p.revealed ? (o.correct ? ' ok' : on ? ' bad' : '') : '';
          return (
            <button type="button" class={`opt${cls}`} aria-pressed={on} disabled={p.revealed} onClick={() => setSel((s) => { const c = new Set(multi ? s : []); on ? c.delete(o.i) : c.add(o.i); return c; })}>
              <b>{String.fromCharCode(65 + k)}</b> <Html tag="span" html={renderInline(o.text)} />
              {p.revealed && o.correct && <Check size={18} aria-label={t('cardview.correcta')} style={{ marginLeft: 'auto' }} />}
            </button>
          );
        })}
      </div>
      {!p.revealed && <button type="button" class="btn primary" disabled={!sel.size} onClick={check}>{t('cardview.comprobar')}</button>}
      {p.revealed && n.back && (<><hr /><Html html={renderMarkdown(n.back)} /></>)}
    </>
  );
}

/** Arrastre con Pointer Events: al soltar, el elemento bajo el dedo decide el destino. */
function useDrag(onDrop: (item: string, target: HTMLElement | null) => void) {
  const st = useRef<{ id: string; el: HTMLElement; x: number; y: number } | null>(null);
  return (id: string) => ({
    class: 'drag',
    onPointerDown: (e: PointerEvent) => {
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      st.current = { id, el, x: e.clientX, y: e.clientY };
    },
    onPointerMove: (e: PointerEvent) => {
      const s = st.current;
      if (!s) return;
      s.el.classList.add('lift');
      s.el.style.transform = `translate(${e.clientX - s.x}px, ${e.clientY - s.y}px)`;
    },
    onPointerUp: (e: PointerEvent) => {
      const s = st.current;
      if (!s) return;
      st.current = null;
      s.el.classList.remove('lift');
      s.el.style.transform = '';
      const moved = Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8;
      if (!moved) return;
      s.el.style.visibility = 'hidden';
      const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      s.el.style.visibility = '';
      onDrop(s.id, under?.closest<HTMLElement>('[data-drop]') ?? null);
    },
  });
}

function Match(p: CardViewProps) {
  const n = p.card.note;
  const rights = useMemo(() => shuffle(n.pairs.map(([, r], i) => ({ r, i })), p.seed), [p.card.cid, p.seed]);
  const [assign, setAssign] = useState<Record<number, number>>({}); // izquierda → índice de derecha
  const [pick, setPick] = useState<number | null>(null);
  const place = (ri: number, li: number) => setAssign((a) => {
    const c = { ...a };
    for (const k of Object.keys(c)) if (c[Number(k)] === ri) delete c[Number(k)];
    c[li] = ri;
    return c;
  });
  const drag = useDrag((id, target) => target && place(Number(id), Number(target.dataset.drop)));
  const used = new Set(Object.values(assign));
  const check = () => {
    const errors = n.pairs.filter((_, li) => assign[li] !== li).length;
    p.onSuggest(autoGrade(errors, Date.now() - p.startedAt, n.pairs.length));
    p.onReveal();
  };
  return (
    <>
      <Html html={renderMarkdown(n.front || t('cardview.une_cada_elemento_con_su_pareja'))} class="front" />
      <p class="foot">{t('cardview.arrastra_cada_respuesta_a_su_pareja')}</p>
      <div class="stack-s">
        {n.pairs.map(([l], li) => {
          const ri = assign[li];
          const ok = p.revealed ? ri === li : null;
          return (
            <div class="dz" data-drop={li} key={li} role="button" tabIndex={0} aria-label={t('cardview.pareja_de_l', { l: l })} onClick={() => pick !== null && (place(pick, li), setPick(null))} style={ok === false ? { borderStyle: 'solid', borderWidth: '2px' } : undefined}>
              <b class="grow"><Html tag="span" html={renderInline(l)} /></b>
              <span>{ri !== undefined ? <Html tag="span" html={renderInline(n.pairs[ri]![1])} /> : <span class="t3">—</span>}</span>
              {ok === true && <Check size={18} aria-label={t('cardview.correcta')} />}
              {ok === false && <span class="chip">✗ {n.pairs[li]![1]}</span>}
            </div>
          );
        })}
      </div>
      {!p.revealed && (
        <div class="row wrap">
          {rights.filter((x) => !used.has(x.i)).map((x) => (
            <button type="button" {...drag(String(x.i))} class={`btn small drag${pick === x.i ? ' primary' : ''}`} aria-pressed={pick === x.i} onClick={() => setPick(pick === x.i ? null : x.i)}>
              {x.r}
            </button>
          ))}
        </div>
      )}
      {!p.revealed && <button type="button" class="btn primary" disabled={used.size < n.pairs.length} onClick={check}>{t('cardview.comprobar')}</button>}
    </>
  );
}

function Order(p: CardViewProps) {
  const n = p.card.note;
  const [items, setItems] = useState(() => {
    let s = shuffle(n.items.map((t, i) => ({ t, i })), p.seed);
    if (s.every((x, k) => x.i === k) && s.length > 1) s = [...s.slice(1), s[0]!];
    return s;
  });
  const move = (from: number, to: number) => setItems((a) => {
    const c = [...a];
    const [x] = c.splice(from, 1);
    c.splice(Math.max(0, Math.min(c.length, to)), 0, x!);
    return c;
  });
  const drag = useDrag((id, target) => target && move(items.findIndex((x) => x.i === Number(id)), Number(target.dataset.drop)));
  const check = () => {
    const errors = items.filter((x, k) => x.i !== k).length;
    p.onSuggest(autoGrade(errors, Date.now() - p.startedAt, n.items.length));
    p.onReveal();
  };
  return (
    <>
      <Html html={renderMarkdown(n.front || t('cardview.ordena'))} class="front" />
      <p class="foot">{t('cardview.arrastra_para_ordenar_o_usa_las')}</p>
      <ol class="stack-s" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {items.map((x, k) => (
          <li key={x.i} data-drop={k} class="dz" style={p.revealed && x.i !== k ? { borderStyle: 'solid', borderWidth: '2px' } : undefined}>
            <span class="num t2">{k + 1}</span>
            <span {...(p.revealed ? {} : drag(String(x.i)))} class="grow drag"><Html tag="span" html={renderInline(x.t)} /></span>
            {p.revealed ? (x.i === k ? <Check size={18} aria-label={t('cardview.en_su_lugar')} /> : <span class="chip">{t('cardview.va_en_p', { p: x.i + 1 })}</span>) : (
              <>
                <button type="button" class="btn icon small" aria-label={t('cardview.subir_t', { t: x.t })} disabled={k === 0} onClick={() => move(k, k - 1)}><ArrowUp size={16} /></button>
                <button type="button" class="btn icon small" aria-label={t('cardview.bajar_t', { t: x.t })} disabled={k === items.length - 1} onClick={() => move(k, k + 1)}><ArrowDown size={16} /></button>
              </>
            )}
          </li>
        ))}
      </ol>
      {!p.revealed && <button type="button" class="btn primary" onClick={check}>{t('cardview.comprobar')}</button>}
    </>
  );
}

/** ¿La tarjeta se califica sola (interactiva)? */
export function isInteractive(c: CardRef): boolean {
  return ['type', 'list', 'olist', 'mc', 'match', 'order'].includes(c.note.type);
}
