import { t } from '../i18n';
import { lazy, Suspense } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../state';
import { useKeyScope } from '../ui/keys';
import { Portal } from '../ui/overlay';
import { usePhone } from '../ui/kit';
import { Dock, DockMini } from './dock';
import { useDict } from './voice';
import { Mascot, useMascotState } from './mascot';
import './chat.css';

const Conversation = lazy(() => import('./conv'));

/** Evento para abrir el panel desde fuera sin importar este código (p. ej. «Más» del teléfono). */
export const OPEN_EVENT = 'engrama:chat';

/** Barra del Asistente (o su mascota minimizada) + panel. Solo se carga con el add-on «Asistente» encendido (app.tsx, import()).
 *  Teléfono: botón flotante con GREX y hoja a pantalla completa (sin barra). */
export default function ChatHost() {
  const app = useApp();
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  const [pre, setPre] = useState<{ text: string; n: number } | undefined>();
  const fab = useRef<HTMLButtonElement>(null);
  const mini = useRef<HTMLButtonElement>(null);
  const base = useMascotState();
  const dictating = useDict().state === 'listening';
  const ms = base === 'idle' && dictating ? 'listening' : base;
  const was = useRef(false);
  const size = app.settings.chat.size;
  const minimized = !phone && app.settings.chat.dock === 'mascota';
  const setSize = (s: 'compact' | 'large') => app.update({ chat: { ...app.settings.chat, size: s } });
  const setDock = (d: 'barra' | 'mascota') => app.update({ chat: { ...app.settings.chat, dock: d } });
  const show = () => { if (minimized) setDock('barra'); setOpen(true); };

  useKeyScope('chat', (id) => {
    if (id === 'chat.toggle') { if (open) setOpen(false); else show(); }
    else if (id === 'chat.size' && open && !phone) setSize(size === 'large' ? 'compact' : 'large');
  });
  useEffect(() => {
    const f = () => show();
    addEventListener(OPEN_EVENT, f);
    return () => removeEventListener(OPEN_EVENT, f);
  });
  // al cerrar, el foco vuelve al botón (la capa modal del teléfono ya lo restaura sola)
  useLayoutEffect(() => { if (was.current && !open) fab.current?.focus(); was.current = open; }, [open]);
  // minimizar ↔ restaurar: el foco pasa al otro control (nunca se pierde)
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    (minimized ? mini : fab).current?.focus();
  }, [minimized]);
  const minimize = () => { setOpen(false); setDock('mascota'); };

  return (
    <>
      {!open && phone && (
        <Portal>
          <button ref={fab} type="button" class="chat-fab glass strong" aria-label={t('chat.p_abrir')} aria-haspopup="dialog" onClick={() => setOpen(true)}>
            <Mascot size={24} state={ms} />
          </button>
        </Portal>
      )}
      {!phone && (
        <Portal>
          {minimized
            ? <DockMini ms={ms} btnRef={mini} onRestore={() => setDock('barra')} />
            : <Dock open={open} ms={ms} avatarRef={fab} onToggle={() => setOpen(!open)} onMin={minimize} onDictate={() => setOpen(true)} onQuick={(text) => { setPre({ text, n: (pre?.n ?? 0) + 1 }); setOpen(true); }} />}
        </Portal>
      )}
      {open && (
        <Suspense fallback={null}>
          <Conversation size={size} phone={phone} prefill={pre} onClose={() => setOpen(false)} onSize={() => setSize(size === 'large' ? 'compact' : 'large')} />
        </Suspense>
      )}
    </>
  );
}
