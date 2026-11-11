import { Import, PackageOpen, Sparkles } from 'lucide-preact';
import { exampleFiles } from '../lib/example';
import { isStandalone, requestPersist } from '../lib/storage';
import { useApp } from '../state';
import { InstallSteps } from './settings';

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
        <img class="brand-logo" src="brand/logo-256.png" width="112" height="112" alt="Logo de Engrama" />
        <div style={{ fontWeight: 500, fontSize: 'var(--t-2)' }}>Engrama</div>
      </div>
      <div class="glass panel stack-s">
        <h1 style={{ fontSize: 'var(--t-large)', fontWeight: 700 }}>Bienvenido a Engrama</h1>
        <p class="t2" style={{ fontSize: 'var(--t-3)' }}>
          Tarjetas de estudio con repetición espaciada y notas. Sin cuentas, sin internet. Tus datos son archivos de texto que te pertenecen.
        </p>
      </div>
      {!standalone && (
        <section class="glass panel" aria-label="Instalar">
          <h2 style={{ fontSize: 'var(--t-3)', fontWeight: 500, marginBottom: '10px' }}>Instálala en tu iPad</h2>
          <InstallSteps />
        </section>
      )}
      <div class="row wrap">
        <button type="button" class="btn primary" onClick={() => start(false)}>
          <Sparkles size={18} aria-hidden="true" /> Empezar
        </button>
        <button type="button" class="btn" onClick={() => start(true)}>
          <PackageOpen size={18} aria-hidden="true" /> Con bóveda de ejemplo
        </button>
        <button type="button" class="btn" onClick={() => app.openSheet('import')}>
          <Import size={18} aria-hidden="true" /> Restaurar respaldo
        </button>
      </div>
      <p class="glass panel note">
        Safari guarda tu bóveda en un espacio privado que no se ve en Archivos. Exporta regularmente para tener una copia visible.
      </p>
    </main>
  );
}
