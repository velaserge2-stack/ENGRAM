// «Preguntar a GREX»: abre el chat con una nota, PDF (y página) o mazo como contexto. Solo con el add-on encendido; no importa el panel.
import { MessageCircleQuestion } from 'lucide-preact';
import { t } from '../i18n';
import { useApp } from '../state';
import { askEvent, type ChatCtx } from './context';

export function AskButton(p: { ctx: ChatCtx; icon?: boolean }) {
  const app = useApp();
  if (app.settings.addons.assistant !== true) return null;
  return (
    <button type="button" class={`btn${p.icon ? ' icon' : ''}`} aria-label={t('asist2.preguntar')} onClick={() => dispatchEvent(askEvent(p.ctx))}>
      <MessageCircleQuestion size={18} aria-hidden="true" />{!p.icon && <>{' '}{t('asist2.preguntar')}</>}
    </button>
  );
}
