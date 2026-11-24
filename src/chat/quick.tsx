import { Zap } from 'lucide-preact';
import { t } from '../i18n';

/** Prompts rápidos: solo rellenan el campo del chat (nunca envían); los [marcadores] quedan para editar. */
export const QUICK = () => [
  { k: 'tarjetas', label: t('dock.q_tarjetas'), text: t('dock.q_tarjetas_t') },
  { k: 'resumir', label: t('dock.q_resumir'), text: t('dock.q_resumir_t') },
  { k: 'examen', label: t('dock.q_examen'), text: t('dock.q_examen_t') },
];

/** Pestañita de la pastilla: oculta por defecto, aparece con el cursor o el foco (CSS `.gx-quick`). Sin edición de la lista (pendiente de la maqueta). */
export function Quick(p: { onPick: (text: string) => void }) {
  return (
    <div class="gx-quick glass" role="group" aria-label={t('dock.rapidas')}>
      <Zap size={13} aria-hidden="true" />
      {QUICK().map((q) => <button type="button" class="gx-chip" key={q.k} onClick={() => p.onPick(q.text)}>{q.label}</button>)}
    </div>
  );
}
