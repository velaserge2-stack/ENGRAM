// Historial del editor de diagramas. Cada paso guarda las ediciones aplicadas y su inverso exacto
// (`splice`); el documento sale siempre del texto: aquí solo hay texto y ediciones, nunca estado duplicado.
// Si el texto cambió por fuera (modo texto, deshacer de la nota), el historial ya no vale y se vacía.
import { applyEdit } from './edit';
import { parseDiagram } from './parse';
import { serializeDiagram } from './serialize';
import type { DiagramKind, Edit } from './types';

export const LIMIT = 100;

export interface Step { fwd: Edit[]; inv: Edit[]; before: string; after: string }

/** Aplica ediciones en orden sobre el texto; devuelve el texto nuevo y el inverso (en orden de deshacer). */
export function runEdits(text: string, kind: DiagramKind, edits: Edit[]): { text: string; inv: Edit[]; fwd: Edit[] } {
  let doc = parseDiagram(text, kind).doc;
  let inv: Edit[] = [];
  const fwd: Edit[] = [];
  for (const e of edits) {
    const r = applyEdit(doc, e);
    if (!r.inverse.length) continue;
    doc = r.doc;
    inv = [...r.inverse, ...inv];
    fwd.push(e);
  }
  return { text: serializeDiagram(doc), inv, fwd };
}

export class History {
  done: Step[] = [];
  undone: Step[] = [];

  clear() { this.done = []; this.undone = []; }

  canUndo(text: string) { return this.done[this.done.length - 1]?.after === text; }
  canRedo(text: string) { return this.undone[this.undone.length - 1]?.before === text; }

  /** Aplica y registra; devuelve el texto nuevo, o null si nada cambió. */
  apply(text: string, kind: DiagramKind, edits: Edit[]): string | null {
    const r = runEdits(text, kind, edits);
    if (!r.fwd.length || r.text === text) return null;
    if (this.done.length && this.done[this.done.length - 1]!.after !== text) this.clear();
    this.done.push({ fwd: r.fwd, inv: r.inv, before: text, after: r.text });
    if (this.done.length > LIMIT) this.done.shift();
    this.undone = [];
    return r.text;
  }

  /** Deshacer: aplica el inverso; el resultado es el texto previo. */
  undo(text: string, kind: DiagramKind): string | null {
    const s = this.done[this.done.length - 1];
    if (!s) return null;
    if (s.after !== text) return (this.clear(), null);
    this.done.pop();
    const out = runEdits(text, kind, s.inv).text;
    this.undone.push(s);
    return out === s.before ? out : s.before;
  }

  /** Rehacer: aplica de nuevo las ediciones originales. */
  redo(text: string, kind: DiagramKind): string | null {
    const s = this.undone[this.undone.length - 1];
    if (!s) return null;
    if (s.before !== text) return (this.clear(), null);
    this.undone.pop();
    const out = runEdits(text, kind, s.fwd).text;
    this.done.push(s);
    return out === s.after ? out : s.after;
  }
}
