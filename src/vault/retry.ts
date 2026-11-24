/**
 * Un handle de OPFS aún abierto (otra pestaña, un Worker reiniciado, Safari cerrando tarde) hace fallar
 * la operación con `NoModificationAllowedError`/`InvalidStateError` antes de tocar nada: se reintenta
 * con espera corta antes de rendirse.
 */
export const LOCKED_NAMES: ReadonlySet<string> = new Set(['NoModificationAllowedError', 'InvalidStateError']);
export const RETRY_DELAYS = [40, 120, 300];

export async function retryLocked<T>(fn: () => Promise<T>, delays: readonly number[] = RETRY_DELAYS): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= delays.length || !LOCKED_NAMES.has((e as { name?: string } | null)?.name ?? '')) throw e;
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
}
