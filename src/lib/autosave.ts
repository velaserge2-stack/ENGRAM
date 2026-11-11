/**
 * Autoguardado con debounce (500 ms) y guardado inmediato al ocultar la página
 * (`visibilitychange` → hidden, `pagehide`). No se usa `beforeunload`: en iOS no es fiable.
 */
export interface Autosaver<T> {
  schedule(value: T): void;
  flush(): Promise<void>;
  dispose(): void;
  readonly pending: boolean;
}

export function createAutosave<T>(save: (value: T) => Promise<void>, delay = 500, target: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'> | null = typeof document !== 'undefined' ? document : null): Autosaver<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let next: { value: T } | null = null;
  let inflight: Promise<void> = Promise.resolve();

  const run = (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!next) return inflight;
    const { value } = next;
    next = null;
    inflight = inflight.then(() => save(value)).catch((e) => console.error('Autoguardado falló', e));
    return inflight;
  };

  const onHide = () => {
    if (!target || target.visibilityState === 'hidden') void run();
  };
  const onPageHide = () => void run();
  target?.addEventListener('visibilitychange', onHide);
  (typeof window !== 'undefined' ? window : null)?.addEventListener('pagehide', onPageHide);

  return {
    schedule(value) {
      next = { value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, delay);
    },
    flush: run,
    dispose() {
      target?.removeEventListener('visibilitychange', onHide);
      (typeof window !== 'undefined' ? window : null)?.removeEventListener('pagehide', onPageHide);
    },
    get pending() {
      return next !== null;
    },
  };
}
