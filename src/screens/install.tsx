import { t as tr } from '../i18n';
import { PlusSquare, Share as ShareIcon } from 'lucide-preact';

/** Pasos para instalar la app (Bienvenida y Ajustes). */
export function InstallSteps() {
  return (
    <ol>
      <li>{tr('settings.toca')}{' '}<b>{tr('settings.compartir')}</b> <ShareIcon size={16} aria-label={tr('settings.icono_de_compartir')} style={{ verticalAlign: '-3px' }} />{' '}{tr('settings.en_la_barra_de_safari')}</li>
      <li>{tr('settings.elige')}{' '}<b>{tr('settings.anadir_a_pantalla_de_inicio')}</b> <PlusSquare size={16} aria-hidden="true" style={{ verticalAlign: '-3px' }} />.</li>
      <li>{tr('settings.abre_engrama_desde_su_icono_funciona')}</li>
    </ol>
  );
}
