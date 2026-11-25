import { useEffect, useState } from 'preact/hooks';

/** Vuelve a dibujar cada `ms` (y al volver a la pestaña) para que las barras de uso se reinicien solas. Pausado con la pestaña oculta. */
export function useTick(ms = 15_000): void {
  const [, set] = useState(0);
  useEffect(() => {
    const bump = () => { if (!document.hidden) set((x) => x + 1); };
    const id = setInterval(bump, ms);
    document.addEventListener('visibilitychange', bump);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', bump); };
  }, [ms]);
}
