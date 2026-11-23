import { t } from '../i18n';
import { lazy, Suspense } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../state';
import { useKeyScope } from '../ui/keys';
import { Portal } from '../ui/overlay';
import { usePhone } from '../ui/kit';
import { Mascot } from './mascot';
import './chat.css';

const Conversation = lazy(() => import('./conv'));

/** Evento para abrir el panel desde fuera sin importar este código (p. ej. «Más» del teléfono). */
export const OPEN_EVENT = 'engrama:chat';

/** Botón flotante + panel. Solo se carga con el add-on «Asistente» encendido (app.tsx, import()). */
export default function ChatHost() {
  const app = useApp();
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  const fab = useRef<HTMLButtonElement>(null);
  const was = useRef(false);
  const size = app.settings.chat.size;
  const setSize = (s: 'compact' | 'large') => app.update({ chat: { ...app.settings.chat, size: s } });

  useKeyScope('chat', (id) => {
    if (id === 'chat.toggle') setOpen((o) => !o);
    else if (id === 'chat.size' && open && !phone) setSize(size === 'large' ? 'compact' : 'large');
  });
  useEffect(() => {
    const f = () => setOpen(true);
    addEventListener(OPEN_EVENT, f);
    return () => removeEventListener(OPEN_EVENT, f);
  }, []);
  // al cerrar, el foco vuelve al botón (la capa modal del teléfono ya lo restaura sola)
  useLayoutEffect(() => { if (was.current && !open) fab.current?.focus(); was.current = open; }, [open]);

  return (
    <>
      {!open && (
        <Portal>
          <button ref={fab} type="button" class="chat-fab glass strong" aria-label={t('chat.p_abrir')} aria-haspopup="dialog" onClick={() => setOpen(true)}>
            <Mascot size={24} />
          </button>
        </Portal>
      )}
      {open && (
        <Suspense fallback={null}>
          <Conversation size={size} phone={phone} onClose={() => setOpen(false)} onSize={() => setSize(size === 'large' ? 'compact' : 'large')} />
        </Suspense>
      )}
    </>
  );
}
