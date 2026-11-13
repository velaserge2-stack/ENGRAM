/**
 * Historial de una nota (Prompt 17): deshacer/rehacer sobre el texto completo. Cada acción de la
 * barra es un paso; lo que se teclea seguido (menos de 1 s entre cambios) se agrupa en uno.
 * Solo memoria: el historial de versiones en disco sigue siendo el de `src/notes/model.ts`.
 */
export function createHistory(limit = 100, now = () => Date.now()) {
  let undo: string[] = [];
  let redo: string[] = [];
  let last = { kind: '', t: 0 };
  return {
    /** Antes de cambiar: guarda el texto previo. */
    record(prev: string, kind: 'type' | 'action') {
      const t = now();
      const merge = kind === 'type' && last.kind === 'type' && t - last.t < 1000;
      last = { kind, t };
      if (merge) return;
      undo.push(prev);
      if (undo.length > limit) undo.shift();
      redo = [];
    },
    undo(cur: string): string | null {
      const p = undo.pop();
      if (p === undefined) return null;
      redo.push(cur);
      last = { kind: '', t: 0 };
      return p;
    },
    redo(cur: string): string | null {
      const n = redo.pop();
      if (n === undefined) return null;
      undo.push(cur);
      last = { kind: '', t: 0 };
      return n;
    },
    get canUndo() { return undo.length > 0; },
    get canRedo() { return redo.length > 0; },
    clear() { undo = []; redo = []; last = { kind: '', t: 0 }; },
  };
}
export type History = ReturnType<typeof createHistory>;
