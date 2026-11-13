import { errMsg, locale, t } from '../i18n';
import { CircleAlert, FileUp, FolderUp, Layers, LoaderCircle, Undo2 } from 'lucide-preact';
import { useRef, useState } from 'preact/hooks';
import { type ApplyResult, applyPlan, buildPlan, fromFileList, gather, mergeLog, type PlanItem, type Resolution, runApkgWorker, undoImport } from '../io/import';
import type { LogEntry } from '../srs/engine';
import { loadSettings, SETTINGS_PATH } from '../lib/settings';
import { go, useApp } from '../state';
import { Segmented, Sheet } from '../ui/kit';

const STATUS = (): Record<PlanItem['status'], string> => ({ new: t('import.st_new'), same: t('import.st_same'), conflict: t('import.ya_existe') });
const KIND = (): Record<PlanItem['kind'], string> => ({ deck: t('import.k_deck'), note: t('import.k_note'), media: t('import.k_media'), doc: t('import.k_doc'), app: t('import.k_app'), other: t('import.k_other') });

export function ImportSheet(props: { onClose: () => void }) {
  const app = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [over, setOver] = useState(false);
  const [plan, setPlan] = useState<PlanItem[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [policy, setPolicy] = useState<Resolution>('omit');
  const [overrides, setOverrides] = useState<Record<string, Resolution>>({});
  const [preview, setPreview] = useState<PlanItem | null>(null);
  const [done, setDone] = useState<ApplyResult | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [withLog, setWithLog] = useState(true);
  const [failures, setFailures] = useState<{ name: string; code: string; message: string }[]>([]);
  const [anki, setAnki] = useState<{ decks: number; cards: number; media: number; reviews: number } | null>(null);
  const num = (n: number) => new Intl.NumberFormat(locale()).format(n);

  async function take(list: FileList | File[] | null) {
    if (!list || !list.length) return;
    setBusy(true);
    try {
      const g = await gather(fromFileList(list), { apkg: (b, name) => runApkgWorker(b, true, name) });
      setWarnings(g.warnings);
      setLog(g.log);
      setFailures(g.failures);
      setAnki(g.anki);
      setPlan(await buildPlan(app.vault, g.files));
      if (g.fromVaultZip) setPolicy('replace');
    } catch (e) {
      setWarnings([t('import.no_se_pudo_leer_message', { message: errMsg(e) })]);
      setPlan([]);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!plan) return;
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    // a lo sumo un render por fotograma (uno por archivo hacía restaurar L un 26 % más lento)
    let last: [number, number] = [0, 0], frame = 0;
    try {
      const res = await applyPlan(app.vault, plan, (i) => overrides[i.path] ?? policy, { signal: ac.signal, onProgress: (d, n) => { last = [d, n]; frame ||= requestAnimationFrame(() => { frame = 0; setProgress(last); }); } });
      if (withLog && log.length) app.toast(t('import.p_repasos_de_historial_importados', { p: await mergeLog(app.vault, log) }));
      // Si llegaron ajustes (restaurar respaldo), adoptarlos en vez de sobrescribirlos con los de memoria
      if (res.written.includes(SETTINGS_PATH)) app.replaceSettings({ ...(await loadSettings(app.vault)), welcomeDone: true });
      app.changed();
      if (!app.settings.welcomeDone) {
        if (!res.written.includes(SETTINGS_PATH)) app.update({ welcomeDone: true }, true);
        app.toast(t('import.n_archivos_importados', { n: res.written.length }));
        props.onClose();
        return;
      }
      setDone(res);
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') throw e;
      app.toast(t('import.cancelada')); // el lote no llegó a escribir su diario: la bóveda no cambió
    } finally {
      cancelAnimationFrame(frame);
      abort.current = null;
      setProgress(null);
      setBusy(false);
    }
  }

  const counts = plan ? { new: plan.filter((p) => p.status === 'new').length, same: plan.filter((p) => p.status === 'same').length, conflict: plan.filter((p) => p.status === 'conflict').length } : null;

  return (
    <Sheet title={t('decks.importar')} onClose={props.onClose}>
      {done ? (
        <div style={{ display: 'grid', gap: '12px' }}>
          <p>
            <b>{done.written.length}</b>{' '}{t('import.archivos_importados_n_omitidos', { n: done.skipped.length })}</p>
          <div class="row wrap">
            {done.written.some((w) => w.startsWith('decks/')) && <button type="button" class="btn primary" onClick={() => { props.onClose(); go('mazos'); }}><Layers size={18} aria-hidden="true" />{' '}{t('import.ver_mazos')}</button>}
            <button type="button" class={`btn${done.written.some((w) => w.startsWith('decks/')) ? '' : ' primary'}`} onClick={props.onClose}>{t('import.listo')}</button>
            <button
              type="button"
              class="btn"
              onClick={async () => {
                await undoImport(app.vault, done);
                app.changed();
                app.toast(t('import.importacion_deshecha'));
                props.onClose();
              }}
            >
              <Undo2 size={18} aria-hidden="true" />{' '}{t('import.deshacer_importacion')}</button>
          </div>
        </div>
      ) : preview ? (
        <div style={{ display: 'grid', gap: '12px' }}>
          <button type="button" class="btn small" style={{ justifySelf: 'start' }} onClick={() => setPreview(null)}>{t('import.volver')}</button>
          <b style={{ wordBreak: 'break-all' }}>{preview.path}</b>
          {preview.preview ? <pre class="preview">{preview.preview}</pre> : <p>{((preview.blob?.size ?? preview.data.length) / 1024).toFixed(1)}{' '}{t('import.kb_sin_vista_previa')}</p>}
        </div>
      ) : plan && plan.length === 0 ? (
        <div style={{ display: 'grid', gap: '12px' }}>
          <div class="import-fail" role="alert">
            <CircleAlert size={28} aria-hidden="true" />
            <div class="stack-s">
              <b>{t('import.sin_tarjetas_titulo')}</b>
              {(failures.length ? failures : [{ name: '', code: 'nothing', message: '' }]).slice(0, 3).map((f) => (
                <p style={{ margin: 0 }}>{f.name && <><b data-user-content>{f.name}</b>{': '}</>}{t(`import.causa_${['new-format', 'empty', 'invalid', 'too-big', 'too-many', 'worker'].includes(f.code) ? f.code.replace('-', '_') : f.code === 'nothing' ? 'nada' : 'corrupt'}`)}</p>
              ))}
            </div>
          </div>
          {warnings.length > 0 && (
            <ul style={{ margin: 0, fontSize: 'var(--t-note)' }}>
              {warnings.slice(0, 20).map((w) => <li>{w}</li>)}
            </ul>
          )}
          <div class="row wrap">
            <button type="button" class="btn primary" onClick={() => setPlan(null)}>{t('import.elegir_otros')}</button>
          </div>
        </div>
      ) : plan ? (
        <div style={{ display: 'grid', gap: '12px' }}>
          {anki && <p class="import-sum" style={{ margin: 0 }}><b>{t('import.resumen_anki', { decks: num(anki.decks), cards: num(anki.cards), media: num(anki.media), reviews: num(anki.reviews) })}</b></p>}
          <p style={{ margin: 0 }}>{t('import.n_archivos_new_nuevos_conflict_ya', { n: plan.length, new: counts!.new, conflict: counts!.conflict, same: counts!.same })}</p>
          {counts!.conflict > 0 && (
            <div class="row-i" style={{ padding: 0 }}>
              <span class="k">{t('import.si_ya_existe')}</span>
              <Segmented label={t('import.si_ya_existe_2')} value={policy} onChange={setPolicy} options={[['omit', t('import.omitir')], ['replace', t('import.reemplazar')], ['duplicate', t('import.duplicar')]]} />
            </div>
          )}
          {log.length > 0 && <label class="row note"><input type="checkbox" checked={withLog} onChange={(e) => setWithLog((e.target as HTMLInputElement).checked)} />{' '}{t('import.incluir_historial_de_repasos_n_fsrs', { n: log.length })}</label>}
          {warnings.length > 0 && (
            <ul style={{ margin: 0, fontSize: 'var(--t-note)' }}>
              {warnings.slice(0, 20).map((w) => <li>{w}</li>)}
            </ul>
          )}
          <ul class="plan-list">
            {plan.slice(0, 500).map((p) => (
              <li key={p.path}>
                <span class={`chip${p.status === "new" ? " solid" : ""}`}>{STATUS()[p.status]}</span>
                <button type="button" class="p" style={{ background: 'none', border: 0, textAlign: 'left', minHeight: '44px', padding: 0 }} onClick={() => setPreview(p)}>
                  {p.path}
                </button>
                <span class="chip">{KIND()[p.kind]}</span>
                {p.status === 'conflict' && (
                  <select aria-label={t('import.que_hacer_con_path', { path: p.path })} value={overrides[p.path] ?? policy} onChange={(e) => setOverrides({ ...overrides, [p.path]: (e.target as HTMLSelectElement).value as Resolution })}>
                    <option value="omit">{t('import.omitir')}</option>
                    <option value="replace">{t('import.reemplazar')}</option>
                    <option value="duplicate">{t('import.duplicar')}</option>
                  </select>
                )}
              </li>
            ))}
          </ul>
          {plan.length > 500 && <p class="foot">{t('import.y_p_mas', { p: plan.length - 500 })}</p>}
          <div class="row wrap">
            <button type="button" class="btn primary" disabled={busy || counts!.new + counts!.conflict === 0} onClick={confirm}>
              {busy ? <><LoaderCircle size={18} class="spin" aria-hidden="true" />{' '}{progress && progress[1] > 1 ? t('import.importando_n', { d: progress[0], n: progress[1] }) : t('import.importando')}</> : t('decks.importar')}
            </button>
            {busy && abort.current
              ? <button type="button" class="btn" onClick={() => abort.current?.abort()}>{t('settings.cancelar')}</button>
              : <button type="button" class="btn" onClick={() => setPlan(null)}>{t('import.elegir_otros')}</button>}
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '14px' }}>
          <div
            class={`drop${over ? ' over' : ''}`}
            onDragOver={(e) => (e.preventDefault(), setOver(true))}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void take(e.dataTransfer?.files ?? null);
            }}
          >
            {busy ? <span class="row" role="status" aria-live="polite" style={{ justifyContent: 'center' }}><LoaderCircle size={20} class="spin" aria-hidden="true" />{' '}{t('import.leyendo_descomprimiendo')}</span> : t('import.suelta_aqui_archivos_md_zip_o')}
          </div>
          <div class="row wrap">
            <button type="button" class="btn primary" onClick={() => fileRef.current?.click()}>
              <FileUp size={18} aria-hidden="true" />{' '}{t('import.elegir_archivos')}</button>
            <button type="button" class="btn" onClick={() => dirRef.current?.click()}>
              <FolderUp size={18} aria-hidden="true" />{' '}{t('import.elegir_carpeta')}</button>
          </div>
          <p class="foot" style={{ padding: 0 }}>{t('import.mazos_md_con')}{' '}<code>deck:</code>{t('import.y_paquetes_de_anki_apkg_van')}</p>
          <p class="foot" style={{ padding: 0 }}>{t('import.ayuda_anki')}</p>
          <input ref={fileRef} type="file" multiple hidden accept=".md,.markdown,.zip,.txt,.apkg,image/*,audio/*,application/zip" onChange={(e) => void take((e.target as HTMLInputElement).files)} />
          <input ref={dirRef} type="file" multiple hidden {...{ webkitdirectory: '' }} onChange={(e) => void take((e.target as HTMLInputElement).files)} />
        </div>
      )}
    </Sheet>
  );
}
