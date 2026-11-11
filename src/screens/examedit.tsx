import { t } from '../i18n';
import { ArrowDown, ArrowUp, Copy, ImagePlus, Plus, Save, Trash2, X } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { safeName } from '../data/ops';
import { saveImage } from '../notes/images';
import { bankToDraft, type Draft, type DraftQ, draftToBank, emptyQ, MAX_OPTIONS, move, validate } from '../sim/draft';
import { parseBankMarkdown, serializeBank } from '../sim/parse';
import { useApp, useAsync } from '../state';
import { PageTitle, Switch } from '../ui/kit';
import { readTextOr } from '../vault/util';

const KEYS = 'ABCDEF';

/**
 * Editor visual de exámenes (Mejoras 2 · E15): título, minutos, orden aleatorio y, por pregunta,
 * caso compartido, enunciado con imagen, opciones (añadir, quitar, reordenar, marcar correctas),
 * explicación y tema. Guarda en `exams-bank/<nombre>.md` en el formato nativo.
 */
export function ExamEditor(props: { path: string | null; onDone: () => void }) {
  const app = useApp();
  const [d, setD] = useState<Draft | null>(null);
  const { data: loaded } = useAsync(async () => {
    if (!props.path) return { name: '', minutes: 60, shuffle: true, qs: [emptyQ()] } as Draft;
    return bankToDraft(parseBankMarkdown(await readTextOr(app.vault, props.path, ''), props.path.split('/').pop()!.replace(/\.md$/, '')));
  }, [props.path]);
  const draft = d ?? loaded;
  const [tried, setTried] = useState(false);
  if (!draft) return <p class="t2">{t('deck.cargando')}</p>;
  const v = validate(draft);
  const bad = v.exam.length > 0 || v.perQ.some((p) => p.length);
  const set = (patch: Partial<Draft>) => setD({ ...draft, ...patch });
  const setQ = (i: number, patch: Partial<DraftQ>) => set({ qs: draft.qs.map((q, k) => (k === i ? { ...q, ...patch } : q)) });
  const save = async () => {
    setTried(true);
    if (bad) return app.toast(t('examedit.revisa_los_avisos'));
    let path = props.path;
    if (!path) {
      const base = `exams-bank/${safeName(draft.name)}`;
      path = `${base}.md`;
      for (let n = 2; await app.vault.exists(path); n++) path = `${base} (${n}).md`;
    }
    await app.vault.write(path, serializeBank(draftToBank(draft)));
    app.changed();
    app.toast(t('examedit.examen_guardado', { n: draft.qs.length }));
    props.onDone();
  };
  return (
    <div class="stack exam-editor">
      <PageTitle title={props.path ? t('examedit.editar_examen') : t('examedit.nuevo_examen')} sub={t('examedit.n_preguntas', { n: draft.qs.length })}>
        <button type="button" class="btn" onClick={props.onDone}><X size={18} />{' '}{t('settings.cancelar')}</button>
        <button type="button" class="btn primary" onClick={() => void save()}><Save size={18} />{' '}{t('calendar.guardar')}</button>
      </PageTitle>
      <section class="glass panel stack-s">
        <label class="field">{t('examedit.titulo')}<input class="input wide" value={draft.name} onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} aria-invalid={tried && v.exam.includes('name')} data-user-content /></label>
        {tried && v.exam.includes('name') && <div class="err">⚠ {t('examedit.falta_titulo')}</div>}
        <div class="row wrap">
          <label class="field">{t('examedit.minutos')}<input class="input" type="number" min={1} max={600} style={{ width: '110px' }} value={draft.minutes} onInput={(e) => set({ minutes: Number((e.target as HTMLInputElement).value) })} /></label>
          <span class="row" style={{ gap: '10px' }}><Switch label={t('examedit.orden_aleatorio')} checked={draft.shuffle} onChange={(x) => set({ shuffle: x })} /><span class="note">{t('examedit.orden_aleatorio')}</span></span>
        </div>
      </section>
      {draft.qs.map((q, i) => (
        <section class="glass panel stack-s exam-q" aria-label={t('examedit.pregunta_n', { n: i + 1 })}>
          <div class="row wrap">
            <b class="grow">{t('examedit.pregunta_n', { n: i + 1 })}</b>
            <button type="button" class="btn icon small" aria-label={t('examedit.subir')} disabled={!i} onClick={() => set({ qs: move(draft.qs, i, -1) })}><ArrowUp size={16} /></button>
            <button type="button" class="btn icon small" aria-label={t('examedit.bajar')} disabled={i === draft.qs.length - 1} onClick={() => set({ qs: move(draft.qs, i, 1) })}><ArrowDown size={16} /></button>
            <button type="button" class="btn icon small" aria-label={t('examedit.duplicar')} onClick={() => set({ qs: [...draft.qs.slice(0, i + 1), structuredClone(q), ...draft.qs.slice(i + 1)] })}><Copy size={16} /></button>
            <button type="button" class="btn icon small" aria-label={t('examedit.eliminar_pregunta')} disabled={draft.qs.length === 1} onClick={() => set({ qs: draft.qs.filter((_, k) => k !== i) })}><Trash2 size={16} /></button>
          </div>
          <label class="field">{t('examedit.caso')}<textarea class="input" rows={2} value={q.case} placeholder={t('examedit.caso_ph')} onInput={(e) => setQ(i, { case: (e.target as HTMLTextAreaElement).value })} data-user-content /></label>
          {i > 0 && draft.qs[i - 1]!.case && q.case !== draft.qs[i - 1]!.case && <button type="button" class="link note" style={{ justifySelf: 'start' }} onClick={() => setQ(i, { case: draft.qs[i - 1]!.case })}>{t('examedit.mismo_caso')}</button>}
          <label class="field">{t('examedit.enunciado')}<textarea class="input" rows={2} value={q.text} onInput={(e) => setQ(i, { text: (e.target as HTMLTextAreaElement).value })} data-user-content /></label>
          <label class="btn small" style={{ justifySelf: 'start' }}><ImagePlus size={16} />{' '}{t('examedit.anadir_imagen')}
            <input type="file" accept="image/*" hidden onChange={async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; const name = await saveImage(app.vault, f, f.name); setQ(i, { text: `${q.text.trim()} ![[${name}]]`.trim() }); }} />
          </label>
          <fieldset class="stack-s" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend class="note t2">{t('examedit.opciones_marca')}</legend>
            {q.options.map((o, k) => (
              <div class="row exam-opt">
                <label class="row" style={{ gap: '6px' }}><input type="checkbox" checked={o.correct} aria-label={t('examedit.correcta_x', { k: KEYS[k] })} onChange={(e) => setQ(i, { options: q.options.map((x, j) => (j === k ? { ...x, correct: (e.target as HTMLInputElement).checked } : x)) })} /><b>{KEYS[k]})</b></label>
                <input class="input grow" value={o.text} aria-label={t('examedit.opcion_x', { k: KEYS[k] })} onInput={(e) => setQ(i, { options: q.options.map((x, j) => (j === k ? { ...x, text: (e.target as HTMLInputElement).value } : x)) })} data-user-content />
                <button type="button" class="btn icon small" aria-label={t('examedit.subir_opcion')} disabled={!k} onClick={() => setQ(i, { options: move(q.options, k, -1) })}><ArrowUp size={14} /></button>
                <button type="button" class="btn icon small" aria-label={t('examedit.quitar_opcion')} disabled={q.options.length <= 2} onClick={() => setQ(i, { options: q.options.filter((_, j) => j !== k) })}><X size={14} /></button>
              </div>
            ))}
            <button type="button" class="btn small" style={{ justifySelf: 'start' }} disabled={q.options.length >= MAX_OPTIONS} onClick={() => setQ(i, { options: [...q.options, { text: '', correct: false }] })}><Plus size={14} />{' '}{t('examedit.anadir_opcion')}</button>
          </fieldset>
          <label class="field">{t('examedit.explicacion')}<textarea class="input" rows={2} value={q.explanation} onInput={(e) => setQ(i, { explanation: (e.target as HTMLTextAreaElement).value })} data-user-content /></label>
          <label class="field">{t('examedit.tema')}<input class="input wide" value={q.topic} placeholder="Cardiología/IAM" onInput={(e) => setQ(i, { topic: (e.target as HTMLInputElement).value })} data-user-content /></label>
          {tried && v.perQ[i]!.map((p) => <div class="err">⚠ {p}</div>)}
        </section>
      ))}
      <button type="button" class="btn" style={{ justifySelf: 'start' }} onClick={() => set({ qs: [...draft.qs, emptyQ(draft.qs[draft.qs.length - 1]?.case ?? '')] })}><Plus size={18} />{' '}{t('examedit.anadir_pregunta')}</button>
      {tried && bad && <div class="err" role="alert">⚠ {t('examedit.revisa_los_avisos')}</div>}
    </div>
  );
}
