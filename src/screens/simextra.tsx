// Simulacros · análisis (distractores, comparar intentos) y preguntas de IA con revisión una por una.
import { locale, t as tr } from '../i18n';
import { useEffect, useState } from 'preact/hooks';
import { Check, Pencil, Sparkles, Trash2 } from 'lucide-preact';
import { compare, distractors, type AttemptLike } from '../sim/analysis';
import { qStats } from '../sim/pick';
import { acceptInto, editPending, equivalentPrompt, examples, loadPending, type Pending, type ReviewError, savePending, toPending, validateGenerated } from '../sim/review';
import { type Bank, type Question } from '../sim/parse';
import { useApp } from '../state';
import { Bar, Sheet } from '../ui/kit';
import { readTextOr } from '../vault/util';

type Att = AttemptLike & { id: string; title: string; startedAt: number };

export function DistractorPanel(p: { a: Att; all: Att[] }) {
  const rows = distractors(p.all, p.a.qs.map((x) => x.q));
  if (!rows.length) return <section class="glass panel"><p class="t2">{tr('examen2.distr_vacio')}</p></section>;
  return (
    <section class="glass strong panel stack-s">
      {rows.map((r) => (
        <div class="inset" style={{ padding: '12px', borderRadius: 'var(--r-row)' }} data-user-content>
          <p><b>{r.q.text}</b> <span class="foot">{tr('examen2.distr_resumen', { total: r.total, wrong: r.wrongPicks })}</span></p>
          {r.options.map((o) => (
            <div class="kv">
              <span class="k" style={{ fontWeight: o.correct ? 700 : 400 }}>{o.correct ? '✓ ' : ''}{o.text}{o.attractive ? ` · ${tr('examen2.atractivo')}` : ''}</span>
              <span class="v">{tr('examen2.veces', { n: o.count })}</span>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

const pct = (x: number) => `${Math.round(x * 100)} %`;
const sgn = (x: number) => `${x > 0 ? '+' : ''}${Math.round(x * 100)}`;

export function ComparePanel(p: { a: Att; all: Att[] }) {
  const others = p.all.filter((x) => x.id !== p.a.id && x.title === p.a.title);
  const [id, setId] = useState(others.filter((x) => x.startedAt < p.a.startedAt).pop()?.id ?? others[0]?.id);
  const o = others.find((x) => x.id === id);
  if (!o) return <section class="glass panel"><p class="t2">{tr('examen2.cmp_ninguno')}</p></section>;
  const [x, y] = o.startedAt < p.a.startedAt ? [o, p.a] : [p.a, o];
  const c = compare(x, y);
  const list = (qs: Question[]) => qs.length ? qs.map((q) => <li data-user-content>{q.text}</li>) : <li class="t2">{tr('examen2.cmp_nada')}</li>;
  return (
    <section class="glass strong panel stack-s">
      <label class="field">{tr('examen2.cmp_con')}
        <select class="input" value={o.id} onChange={(e) => setId((e.target as HTMLSelectElement).value)}>
          {others.map((z) => <option value={z.id}>{new Date(z.startedAt).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })}</option>)}
        </select>
      </label>
      <div class="kv"><span class="k">{tr('examen2.cmp_puntaje')}</span><span class="v">{pct(c.pctA)} → {pct(c.pctB)} ({sgn(c.delta)})</span></div>
      <div class="kv"><span class="k">{tr('examen2.cmp_tiempo')}</span><span class="v">{Math.round(c.minA)} → {Math.round(c.minB)} min</span></div>
      <h3>{tr('examen2.cmp_temas')}</h3>
      {c.topics.map((t) => <div><div class="kv"><span class="k" data-user-content>{t.topic}</span><span class="v">{pct(t.pctA)} → {pct(t.pctB)} ({sgn(t.delta)})</span></div><Bar value={t.pctB} label={`${t.topic}: ${pct(t.pctB)}`} /></div>)}
      <h3>{tr('examen2.cmp_mejoro')}</h3>
      <ul>{c.topics.filter((t) => t.delta > 0).map((t) => <li data-user-content>{t.topic}</li>)}{!c.topics.some((t) => t.delta > 0) && <li class="t2">{tr('examen2.cmp_nada')}</li>}</ul>
      <h3>{tr('examen2.cmp_empeoro')}</h3>
      <ul>{c.topics.filter((t) => t.delta < 0).map((t) => <li data-user-content>{t.topic}</li>)}{!c.topics.some((t) => t.delta < 0) && <li class="t2">{tr('examen2.cmp_nada')}</li>}</ul>
      <h3>{tr('examen2.cmp_arreglo')}</h3>
      <ul>{list(c.fixed)}</ul>
      <h3>{tr('examen2.cmp_rompio')}</h3>
      <ul>{list(c.broke)}</ul>
    </section>
  );
}

type BankRef = { path: string; bank: Bank };

/** Plantilla para la IA + pegar lo generado: pasa a «pendiente de revisión», nunca al banco. */
export function AiSheet(p: { b: BankRef; attempts: AttemptLike[]; onClose: () => void }) {
  const app = useApp();
  const [n, setN] = useState(5);
  const [text, setText] = useState('');
  const k = Math.min(15, Math.max(1, Math.round(n) || 5));
  const prompt = equivalentPrompt(examples(p.b.bank.questions, 6, p.b.path + qStats(p.attempts).size), k);
  const send = async () => {
    const found = toPending(text, p.b.bank.questions);
    if (!found.length) return app.toast(tr('examen2.ia_nada'));
    await savePending(app.vault, p.b.path, [...(await loadPending(app.vault, p.b.path)), ...found]);
    app.changed();
    app.toast(tr('examen2.ia_pendientes', { n: found.length }));
    p.onClose();
  };
  return (
    <Sheet title={tr('examen2.ia_titulo')} onClose={p.onClose}>
      <div class="stack">
        <p class="t2">{tr('examen2.ia_pasos')}</p>
        <label class="field">{tr('examen2.ia_cuantas')}<input class="input" type="number" min={1} max={15} value={n} onInput={(e) => setN(Number((e.target as HTMLInputElement).value))} /></label>
        <textarea class="input code" readOnly style={{ minHeight: '18dvh' }} value={prompt} aria-label={tr('examen2.ia_copiar')} />
        <button type="button" class="btn" onClick={async () => { if ('clipboard' in navigator) { await navigator.clipboard.writeText(prompt); app.toast(tr('examen2.ia_copiada')); } }}>{tr('examen2.ia_copiar')}</button>
        <textarea class="input code" style={{ minHeight: '20dvh' }} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} aria-label={tr('examen2.ia_pegar')} placeholder={tr('examen2.ia_pegar')} />
        <button type="button" class="btn primary" disabled={!text.trim()} onClick={send}><Sparkles size={16} />{' '}{tr('examen2.ia_enviar')}</button>
      </div>
    </Sheet>
  );
}

const ERR: Record<ReviewError, string> = { texto: 'examen2.err_texto', opciones: 'examen2.err_opciones', correcta: 'examen2.err_correcta', duplicadas: 'examen2.err_duplicadas', explicacion: 'examen2.err_explicacion', repetida: 'examen2.err_repetida' };

/** Revisión pregunta a pregunta: Aceptar solo con pregunta, respuesta y explicación revisadas; editar o descartar. */
export function ReviewSheet(p: { b: BankRef; onClose: () => void }) {
  const app = useApp();
  const [items, setItems] = useState<Pending[] | null>(null);
  const [chk, setChk] = useState([false, false, false]);
  const [edit, setEdit] = useState(false);
  const [bank, setBank] = useState(p.b.bank.questions);
  useEffect(() => { void loadPending(app.vault, p.b.path).then((l) => setItems(l.map((x) => ({ q: x.q, errors: validateGenerated(x.q, bank) })))); }, []);
  const cur = items?.[0];
  const next = async (rest: Pending[]) => { setItems(rest); setChk([false, false, false]); setEdit(false); await savePending(app.vault, p.b.path, rest); app.changed(); if (!rest.length) p.onClose(); };
  const accept = async () => {
    if (!cur) return;
    const text = acceptInto(await readTextOr(app.vault, p.b.path, ''), p.b.bank.name, cur.q);
    await app.vault.write(p.b.path, text);
    setBank([...bank, cur.q]);
    app.toast(tr('examen2.rev_aceptada'));
    await next(items!.slice(1).map((x) => ({ q: x.q, errors: validateGenerated(x.q, [...bank, cur.q]) })));
  };
  const upd = (patch: Partial<Question>) => setItems(items!.map((x, i) => (i ? x : editPending(x, patch, bank))));
  const ok = !!cur && !cur.errors.length && chk.every(Boolean);
  const fld = (label: string, value: string, set: (v: string) => void) => <label class="field">{label}<input class="input" value={value} onInput={(e) => set((e.target as HTMLInputElement).value)} /></label>;
  return (
    <Sheet title={tr('examen2.rev_titulo')} onClose={p.onClose}>
      <div class="stack" data-user-content>
        {!items ? <p class="t2">…</p> : !cur ? <p class="t2">{tr('examen2.rev_vacio')}</p> : <>
          <p class="foot">{tr('examen2.rev_progreso', { i: 1, n: items.length })}</p>
          {edit ? <>
            {fld(tr('examen2.rev_texto'), cur.q.text, (v) => upd({ text: v }))}
            {cur.q.options.map((o, i) => fld(tr('examen2.rev_opcion', { key: o.key }), o.text, (v) => upd({ options: cur.q.options.map((z, j) => (i === j ? { ...z, text: v } : z)) })))}
            {fld(tr('examen2.rev_respuesta'), cur.q.answer.join(', '), (v) => upd({ answer: [...new Set(v.toUpperCase().match(/[A-F]/g) ?? [])] }))}
            {fld(tr('examen2.rev_explicacion'), cur.q.explanation, (v) => upd({ explanation: v }))}
            {fld(tr('examen2.rev_tema'), cur.q.topic, (v) => upd({ topic: v }))}
            <button type="button" class="btn" onClick={() => setEdit(false)}><Check size={16} />{' '}{tr('examen2.rev_listo')}</button>
          </> : <>
            <p><b>{cur.q.text}</b></p>
            <ul>{cur.q.options.map((o) => <li style={{ fontWeight: cur.q.answer.includes(o.key) ? 700 : 400 }}>{cur.q.answer.includes(o.key) ? '✓ ' : ''}{o.key}) {o.text}</li>)}</ul>
            <p class="note">{cur.q.explanation}</p>
            {cur.q.topic && <p class="foot">{cur.q.topic}</p>}
          </>}
          {cur.errors.length > 0 && <ul role="alert">{cur.errors.map((e) => <li>{tr(ERR[e])}</li>)}</ul>}
          {[tr('examen2.rev_chk_p'), tr('examen2.rev_chk_r'), tr('examen2.rev_chk_e')].map((l, i) => (
            <label class="row" style={{ minHeight: '44px' }}><input type="checkbox" checked={chk[i]} onChange={(e) => setChk(chk.map((v, j) => (i === j ? (e.target as HTMLInputElement).checked : v)))} />{' '}{l}</label>
          ))}
          <div class="row wrap">
            <button type="button" class="btn primary" disabled={!ok} onClick={accept}><Check size={16} />{' '}{tr('examen2.rev_aceptar')}</button>
            <button type="button" class="btn" onClick={() => setEdit(!edit)}><Pencil size={16} />{' '}{tr('examen2.rev_editar')}</button>
            <button type="button" class="btn danger" onClick={async () => { app.toast(tr('examen2.rev_descartada')); await next(items.slice(1)); }}><Trash2 size={16} />{' '}{tr('examen2.rev_descartar')}</button>
          </div>
        </>}
      </div>
    </Sheet>
  );
}
