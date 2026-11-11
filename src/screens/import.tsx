import { FileUp, FolderUp, Undo2 } from 'lucide-preact';
import { useRef, useState } from 'preact/hooks';
import { type ApplyResult, applyPlan, buildPlan, fromFileList, gather, type PlanItem, type Resolution, undoImport } from '../io/import';
import { loadSettings, SETTINGS_PATH } from '../lib/settings';
import { useApp } from '../state';
import { Segmented, Sheet } from '../ui/kit';

const STATUS: Record<PlanItem['status'], string> = { new: 'nuevo', same: 'igual', conflict: 'ya existe' };
const KIND: Record<PlanItem['kind'], string> = { deck: 'mazo', note: 'nota', media: 'medio', doc: 'documento', app: 'datos', other: 'otro' };

export function ImportSheet(props: { onClose: () => void }) {
  const app = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [plan, setPlan] = useState<PlanItem[] | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [policy, setPolicy] = useState<Resolution>('omit');
  const [overrides, setOverrides] = useState<Record<string, Resolution>>({});
  const [preview, setPreview] = useState<PlanItem | null>(null);
  const [done, setDone] = useState<ApplyResult | null>(null);

  async function take(list: FileList | File[] | null) {
    if (!list || !list.length) return;
    setBusy(true);
    try {
      const g = await gather(fromFileList(list));
      setWarnings(g.warnings);
      setPlan(await buildPlan(app.vault, g.files));
      if (g.fromVaultZip) setPolicy('replace');
    } catch (e) {
      setWarnings([`No se pudo leer: ${(e as Error).message}`]);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!plan) return;
    setBusy(true);
    try {
      const res = await applyPlan(app.vault, plan, (i) => overrides[i.path] ?? policy);
      // Si llegaron ajustes (restaurar respaldo), adoptarlos en vez de sobrescribirlos con los de memoria
      if (res.written.includes(SETTINGS_PATH)) app.replaceSettings({ ...(await loadSettings(app.vault)), welcomeDone: true });
      app.changed();
      if (!app.settings.welcomeDone) {
        if (!res.written.includes(SETTINGS_PATH)) app.update({ welcomeDone: true }, true);
        app.toast(`${res.written.length} archivos importados`);
        props.onClose();
        return;
      }
      setDone(res);
    } finally {
      setBusy(false);
    }
  }

  const counts = plan ? { new: plan.filter((p) => p.status === 'new').length, same: plan.filter((p) => p.status === 'same').length, conflict: plan.filter((p) => p.status === 'conflict').length } : null;

  return (
    <Sheet title="Importar" onClose={props.onClose}>
      {done ? (
        <div style={{ display: 'grid', gap: '12px' }}>
          <p>
            <b>{done.written.length}</b> archivos importados · {done.skipped.length} omitidos.
          </p>
          <div class="row wrap">
            <button type="button" class="btn primary" onClick={props.onClose}>Listo</button>
            <button
              type="button"
              class="btn"
              onClick={async () => {
                await undoImport(app.vault, done);
                app.changed();
                app.toast('Importación deshecha');
                props.onClose();
              }}
            >
              <Undo2 size={18} aria-hidden="true" /> Deshacer importación
            </button>
          </div>
        </div>
      ) : preview ? (
        <div style={{ display: 'grid', gap: '12px' }}>
          <button type="button" class="btn small" style={{ justifySelf: 'start' }} onClick={() => setPreview(null)}>‹ Volver</button>
          <b style={{ wordBreak: 'break-all' }}>{preview.path}</b>
          {preview.preview ? <pre class="preview">{preview.preview}</pre> : <p>{(preview.data.length / 1024).toFixed(1)} KB (sin vista previa)</p>}
        </div>
      ) : plan ? (
        <div style={{ display: 'grid', gap: '12px' }}>
          <p style={{ margin: 0 }}>
            {plan.length} archivos: {counts!.new} nuevos, {counts!.conflict} ya existen con otro contenido, {counts!.same} idénticos (se omiten).
          </p>
          {counts!.conflict > 0 && (
            <div class="row-i" style={{ padding: 0 }}>
              <span class="k">Si ya existe:</span>
              <Segmented label="Si ya existe" value={policy} onChange={setPolicy} options={[['omit', 'Omitir'], ['replace', 'Reemplazar'], ['duplicate', 'Duplicar']]} />
            </div>
          )}
          {warnings.length > 0 && (
            <ul style={{ margin: 0, color: 'var(--c-naranja)', fontSize: 'var(--t-note)' }}>
              {warnings.slice(0, 20).map((w) => <li>{w}</li>)}
            </ul>
          )}
          <ul class="plan-list">
            {plan.slice(0, 500).map((p) => (
              <li key={p.path}>
                <span class={`chip${p.status === "new" ? " solid" : ""}`}>{STATUS[p.status]}</span>
                <button type="button" class="p" style={{ background: 'none', border: 0, textAlign: 'left', minHeight: '44px', padding: 0 }} onClick={() => setPreview(p)}>
                  {p.path}
                </button>
                <span class="chip">{KIND[p.kind]}</span>
                {p.status === 'conflict' && (
                  <select aria-label={`Qué hacer con ${p.path}`} value={overrides[p.path] ?? policy} onChange={(e) => setOverrides({ ...overrides, [p.path]: (e.target as HTMLSelectElement).value as Resolution })}>
                    <option value="omit">Omitir</option>
                    <option value="replace">Reemplazar</option>
                    <option value="duplicate">Duplicar</option>
                  </select>
                )}
              </li>
            ))}
          </ul>
          {plan.length > 500 && <p class="group-f">… y {plan.length - 500} más.</p>}
          <div class="row wrap">
            <button type="button" class="btn primary" disabled={busy || counts!.new + counts!.conflict === 0} onClick={confirm}>
              {busy ? 'Importando…' : 'Importar'}
            </button>
            <button type="button" class="btn" onClick={() => setPlan(null)}>Elegir otros</button>
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
            {busy ? 'Leyendo…' : 'Suelta aquí archivos .md, .zip o imágenes'}
          </div>
          <div class="row wrap">
            <button type="button" class="btn primary" onClick={() => fileRef.current?.click()}>
              <FileUp size={18} aria-hidden="true" /> Elegir archivos
            </button>
            <button type="button" class="btn" onClick={() => dirRef.current?.click()}>
              <FolderUp size={18} aria-hidden="true" /> Elegir carpeta
            </button>
          </div>
          <p class="group-f" style={{ padding: 0 }}>
            Mazos (.md con <code>deck:</code>) van a decks/, otras notas a notes/, imágenes y audio a media/. Un .zip exportado desde Engrama restaura la bóveda completa. Verás una vista previa antes de confirmar.
          </p>
          <input ref={fileRef} type="file" multiple hidden accept=".md,.markdown,.zip,.txt,image/*,audio/*,application/zip" onChange={(e) => void take((e.target as HTMLInputElement).files)} />
          <input ref={dirRef} type="file" multiple hidden {...{ webkitdirectory: '' }} onChange={(e) => void take((e.target as HTMLInputElement).files)} />
        </div>
      )}
    </Sheet>
  );
}
