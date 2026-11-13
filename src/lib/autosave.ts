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
  /** el último guardado: `flush` lo devuelve y RECHAZA si falló (el temporizador solo lo registra) */
  let last: Promise<void> = inflight;
  let saving = 0;

  const run = (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!next) return last;
    const { value } = next;
    next = null;
    saving++;
    last = inflight.then(() => save(value)).finally(() => void saving--);
    inflight = last.catch((e) => console.error('Autoguardado falló', e));
    return last;
  };

  const onHide = () => {
    if (!target || target.visibilityState === 'hidden') void run().catch(() => undefined);
  };
  const onPageHide = () => void run().catch(() => undefined);
  target?.addEventListener('visibilitychange', onHide);
  (typeof window !== 'undefined' ? window : null)?.addEventListener('pagehide', onPageHide);

  return {
    schedule(value) {
      next = { value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run().catch(() => undefined), delay);
    },
    flush: run,
    dispose() {
      target?.removeEventListener('visibilitychange', onHide);
      (typeof window !== 'undefined' ? window : null)?.removeEventListener('pagehide', onPageHide);
    },
    /** hay algo sin escribir: programado o con el guardado en vuelo */
    get pending() {
      return next !== null || saving > 0;
    },
  };
}
