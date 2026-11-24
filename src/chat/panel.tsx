import { t } from '../i18n';
import { lazy, Suspense } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../state';
import { useKeyScope } from '../ui/keys';
import { Portal } from '../ui/overlay';
import { Dock, DockMini } from './dock';
import { useDict } from './voice';
import { Mascot, useMascotState } from './mascot';
import { useChatView } from './state';
import './chat.css';

const Conversation = lazy(() => import('./conv'));

/** Evento para abrir el panel desde fuera sin importar este código (p. ej. «Más» del teléfono). */
export const OPEN_EVENT = 'engrama:chat';

/** Asistente: UN solo elemento a la vez (mascota · pastilla · chat), en un único portal por encima de la interfaz (--z-assistant).
 *  Solo se carga con el add-on encendido (app.tsx, import()). Teléfono: botón flotante con GREX y hoja a pantalla completa. */
export default function ChatHost() {
  const app = useApp();
  const { view, phone, go } = useChatView();
  const [pre, setPre] = useState<{ text: string; n: number } | undefined>();
  const rest = useRef<HTMLButtonElement>(null); // el elemento de reposo (mascota, avatar de la pastilla o botón del teléfono)
  const base = useMascotState();
  const dictating = useDict().state === 'listening';
  const ms = base === 'idle' && dictating ? 'listening' : base;
  const size = app.settings.chat.size;
  const setSize = (s: 'compact' | 'large') => app.update({ chat: { ...app.settings.chat, size: s } });

  useKeyScope('chat', (id) => {
    if (id === 'chat.toggle') go('alternar');
    else if (id === 'chat.size' && view === 'chat' && !phone) setSize(size === 'large' ? 'compact' : 'large');
  });
  useEffect(() => {
    const f = () => go('abrir');
    addEventListener(OPEN_EVENT, f);
    return () => removeEventListener(OPEN_EVENT, f);
  });
  // al cerrar o cambiar de reposo el foco pasa al elemento que aparece (el campo del chat se enfoca solo al abrir)
  const prev = useRef(view);
  useLayoutEffect(() => { if (prev.current !== view && view !== 'chat') rest.current?.focus(); prev.current = view; }, [view]);

  return (
    <Portal>
      {view === 'chat' && (
        <Suspense fallback={null}>
          <Conversation size={size} prefill={pre} phone={phone} onClose={() => go('cerrar')} onSize={() => setSize(size === 'large' ? 'compact' : 'large')} />
        </Suspense>
      )}
      {view === 'mascota' && (phone
        ? <button ref={rest} type="button" class="chat-fab glass strong" aria-label={t('chat.p_abrir')} aria-haspopup="dialog" onClick={() => go('abrir')}><Mascot size={24} state={ms} /></button>
        : <DockMini ms={ms} btnRef={rest} onRestore={() => go('restaurar')} />)}
      {view === 'barra' && <Dock ms={ms} avatarRef={rest} onOpen={() => go('abrir')} onQuick={(text) => { setPre({ text, n: (pre?.n ?? 0) + 1 }); go('abrir'); }} onMin={() => go('minimizar')} />}
    </Portal>
  );
}
