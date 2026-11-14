import type { DiagramDoc } from './types';

// Cada línea se reescribe desde su `raw`: sin edición, ida y vuelta exacta.
export function serializeDiagram(doc: DiagramDoc): string {
  return doc.lines.map((l) => l.raw).join(doc.eol);
}
