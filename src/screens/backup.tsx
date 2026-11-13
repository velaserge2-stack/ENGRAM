import { errMsg, t } from '../i18n';
import { Archive, Share } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { deliver, stamp } from '../io/share';
import { type Manifest, zipVault } from '../io/zip';
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
      const { blob, counts } = await zipVault(app.vault, APP_VERSION); // por partes: sin todo en memoria
      setCounts(counts);
      setFile(new File([blob], t('backup.engrama_p_zip', { p: stamp() }), { type: 'application/zip' }));
    } catch (e) {
      app.toast(t('backup.no_se_pudo_preparar', { e: errMsg(e) }));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!file) return;
    let r: Awaited<ReturnType<typeof deliver>>;
    try {
      r = await deliver(file);
    } catch (e) {
      return app.toast(t('backup.no_se_pudo_guardar', { e: errMsg(e) }));
    }
    if (r === 'cancelled') return;
    app.update({ lastExportAt: Date.now(), backupReminderSnoozedUntil: null }, true);
    app.toast(r === 'shared' ? t('backup.respaldo_listo') : t('backup.respaldo_descargado'));
    props.onClose();
  }

  return (
    <Sheet title={t('app.respaldo')} onClose={props.onClose}>
      <div style={{ display: 'grid', gap: '14px' }}>
        <p style={{ margin: 0 }}>{t('backup.safari_guarda_tu_boveda_en_un')}</p>
        {!file ? (
          <button type="button" class="btn primary" style={{ justifySelf: 'start' }} disabled={busy} onClick={prepare}>
            <Archive size={18} aria-hidden="true" /> {busy ? t('backup.preparando') : t('backup.preparar_respaldo_zip')}
          </button>
        ) : (
          <>
            <p style={{ margin: 0 }}>
              <b>{file.name}</b> · {formatBytes(file.size)}
              <br />
              <span style={{ color: 'var(--t2)', fontSize: 'var(--t-note)' }}>{t('backup.decks_mazos_notes_notas_media_medios', { decks: counts!.decks, notes: counts!.notes, media: counts!.media, files: counts!.files })}</span>
            </p>
            <button type="button" class="btn primary" style={{ justifySelf: 'start' }} onClick={save}>
              <Share size={18} aria-hidden="true" />{' '}{t('backup.guardar_en_archivos')}</button>
            <p class="foot" style={{ padding: 0 }}>{t('backup.en_la_hoja_de_compartir_elige')}</p>
          </>
        )}
        <p class="foot" style={{ padding: 0 }}>{t('backup.para_restaurar_importar_elige_el_zip')}{' '}<code>manifest.json</code>{' '}{t('backup.con_version_de_formato_y_conteos')}</p>
      </div>
    </Sheet>
  );
}
