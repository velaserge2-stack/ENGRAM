import { t } from '../i18n';
import { Import, PackageOpen, Sparkles } from 'lucide-preact';
import { exampleFiles } from '../lib/example';
import { isStandalone, requestPersist } from '../lib/storage';
import { useApp } from '../state';
import { InstallSteps } from './install';

export function Welcome() {
  const app = useApp();
  const standalone = isStandalone();

  const start = async (example: boolean) => {
    void requestPersist(); // dentro del gesto: Safari decide con más contexto
    if (example) {
      for (const f of await exampleFiles()) if (!(await app.vault.exists(f.path))) await app.vault.write(f.path, f.text);
      app.changed();
    }
    app.update({ welcomeDone: true }, true);
  };

  return (
    <main class="welcome">
      <div class="glass panel center stack-s" style={{ justifyItems: 'center' }}>
        <img class="brand-logo" src="brand/logo-256.png" width="112" height="112" alt={t('settings.logo_de_engrama')} />
        <div style={{ fontWeight: 500, fontSize: 'var(--t-2)' }}>{t('settings.engrama')}</div>
      </div>
      <div class="glass panel stack-s">
        <h1 style={{ fontSize: 'var(--t-large)', fontWeight: 700 }}>{t('welcome.bienvenido_a_engrama')}</h1>
        <p class="t2" style={{ fontSize: 'var(--t-3)' }}>{t('welcome.tarjetas_de_estudio_con_repeticion_espacia')}</p>
      </div>
      {!standalone && (
        <section class="glass panel" aria-label={t('settings.instalar')}>
          <h2 style={{ fontSize: 'var(--t-3)', fontWeight: 500, marginBottom: '10px' }}>{t('welcome.instalala_en_tu_ipad')}</h2>
          <InstallSteps />
        </section>
      )}
      <div class="row wrap">
        <button type="button" class="btn primary" onClick={() => start(false)}>
          <Sparkles size={18} aria-hidden="true" />{' '}{t('welcome.empezar')}</button>
        <button type="button" class="btn" onClick={() => start(true)}>
          <PackageOpen size={18} aria-hidden="true" />{' '}{t('welcome.con_boveda_de_ejemplo')}</button>
        <button type="button" class="btn" onClick={() => app.openSheet('import')}>
          <Import size={18} aria-hidden="true" />{' '}{t('welcome.restaurar_respaldo')}</button>
      </div>
      <p class="glass panel note">{t('backup.safari_guarda_tu_boveda_en_un')}</p>
    </main>
  );
}
