import { useState } from 'preact/hooks';
import { useApp } from '../state';
import { usePhone } from '../ui/kit';

/** Qué se ve del Asistente: SOLO uno a la vez (los demás ni existen en el DOM). */
export type View = 'mascota' | 'barra' | 'chat';
/** Estado de reposo (persistido en settings.chat.dock): al cerrar el chat se vuelve a él. */
export type Rest = 'barra' | 'mascota';
export interface ChatState { open: boolean; rest: Rest }
export type ChatEvent = 'abrir' | 'cerrar' | 'alternar' | 'minimizar' | 'restaurar';

/** Teléfono: no hay barra; el reposo siempre es la mascota (botón flotante). */
export const view = (s: ChatState, phone = false): View => (s.open ? 'chat' : phone ? 'mascota' : s.rest);

/** Transiciones: mascota —restaurar→ barra · barra —minimizar→ mascota · abrir/cerrar chat (transitorio: no toca el reposo). */
export function step(s: ChatState, ev: ChatEvent): ChatState {
  switch (ev) {
    case 'abrir': return { ...s, open: true };
    case 'cerrar': return { ...s, open: false };
    case 'alternar': return { ...s, open: !s.open };
    case 'minimizar': return { open: false, rest: 'mascota' };
    case 'restaurar': return { open: false, rest: 'barra' };
  }
}

/** Estado único del Asistente: `open` es transitorio; el reposo vive en los ajustes. */
export function useChatView() {
  const app = useApp();
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  const rest = app.settings.chat.dock;
  const go = (ev: ChatEvent) => {
    const n = step({ open, rest }, ev);
    if (n.open !== open) setOpen(n.open);
    if (n.rest !== rest) app.update({ chat: { ...app.settings.chat, dock: n.rest } });
  };
  return { view: view({ open, rest }, phone), phone, go };
}
