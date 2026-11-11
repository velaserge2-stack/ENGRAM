import { Archive, Share } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { deliver, stamp } from '../io/share';
import { buildZip, collectVault, type Manifest, countFiles } from '../io/zip';
import { serializeSettings, SETTINGS_PATH } from '../lib/settings';
import { formatBytes } from '../lib/storage';
import { useApp } from '../state';
import { Sheet } from '../ui/kit';

export const APP_VERSION = __APP_VERSION__;

/**
 * Respaldo en dos pasos: "Preparar" construye el .zip (asíncrono) y
 * "Guardar en Archivos" llama a navigator.share dentro del gesto del toque.
 * Safari descarta el share si entre el toque y la llamada hubo trabajo asíncrono largo.
 */
export function BackupSheet(props: { onClose: () => void }) {
  const app = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [counts, setCounts] = useState<Manifest['counts'] | null>(null);
  const [busy, setBusy] = useState(false);

  async function prepare() {
    setBusy(true);
    try {
      await app.vault.write(SETTINGS_PATH, serializeSettings(app.settings)); // el respaldo lleva los ajustes al día
      const files = await collectVault(app.vault);
      const zip = await buildZip(files, APP_VERSION);
      setCounts(countFiles(files.map((f) => ({ path: f.path, size: f.data.length }))));
      setFile(new File([zip as BlobPart], `Engrama_${stamp()}.zip`, { type: 'application/zip' }));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!file) return;
    const r = await deliver(file);
    if (r === 'cancelled') return;
    app.update({ lastExportAt: Date.now(), backupReminderSnoozedUntil: null }, true);
    app.toast(r === 'shared' ? 'Respaldo listo' : 'Respaldo descargado');
    props.onClose();
  }

  return (
    <Sheet title="Respaldo" onClose={props.onClose}>
      <div style={{ display: 'grid', gap: '14px' }}>
        <p style={{ margin: 0 }}>
          Safari guarda tu bóveda en un espacio privado que no se ve en Archivos. Exporta regularmente para tener una copia visible.
        </p>
        {!file ? (
          <button type="button" class="btn primary" style={{ justifySelf: 'start' }} disabled={busy} onClick={prepare}>
            <Archive size={18} aria-hidden="true" /> {busy ? 'Preparando…' : 'Preparar respaldo (.zip)'}
          </button>
        ) : (
          <>
            <p style={{ margin: 0 }}>
              <b>{file.name}</b> · {formatBytes(file.size)}
              <br />
              <span style={{ color: 'var(--t2)', fontSize: 'var(--t-note)' }}>
                {counts!.decks} mazos · {counts!.notes} notas · {counts!.media} medios · {counts!.files} archivos en total
              </span>
            </p>
            <button type="button" class="btn primary" style={{ justifySelf: 'start' }} onClick={save}>
              <Share size={18} aria-hidden="true" /> Guardar en Archivos
            </button>
            <p class="foot" style={{ padding: 0 }}>En la hoja de compartir elige «Guardar en Archivos». Si tu navegador no puede compartir archivos, se descargará.</p>
          </>
        )}
        <p class="foot" style={{ padding: 0 }}>
          Para restaurar: Importar → elige el .zip. Incluye <code>manifest.json</code> con versión de formato y conteos para validarlo.
        </p>
      </div>
    </Sheet>
  );
}
