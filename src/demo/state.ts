// Modo demo (`?demo=1`): interruptor y estado en memoria. Mínimo a propósito: lo importan keys/usage/turn/dictbtn.
let on = false;
export const isDemo = (): boolean => on;
export const demoOn = (): void => { on = true; };
/** Claves y uso FALSOS, solo en memoria (nunca se leen ni escriben `engrama.chat.*`). */
export const mem: { keys: unknown; usage: unknown } = { keys: null, usage: null };
