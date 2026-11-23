import { MessageCircle } from 'lucide-preact';

/** Marcador del Asistente. La mascota SVG llega en la Fase 4: solo cambia este componente. */
export function Mascot(p: { size?: number }) {
  return <MessageCircle size={p.size ?? 24} aria-hidden="true" />;
}
