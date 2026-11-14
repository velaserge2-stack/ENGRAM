// Tipos de diagramas (docs/diagramas/CONTRATO.md §2). Copia mínima: el dueño es el subagente A (núcleo).
export type Kind = 'mapa' | 'flujo' | 'diagrama';
export type Shape = 'rect' | 'round' | 'diamond' | 'io' | 'note'; // mapa: siempre 'rect'
export type Dir = 'TB' | 'LR';
export interface DiagramNode {
  id: string /* estable: 'n'+orden de primera aparición */; shape: Shape; text: string;
  x?: number; y?: number; folded?: boolean; color?: 1 | 2 | 3 | 4 | 5 | 6; parent?: string /* solo mapa */; depth: number /* solo mapa */; line: number;
}
export interface DiagramEdge { id: string; from: string; to: string; label?: string; arrow: 'to' | 'none' | 'both'; route?: 'recta' | 'curva' | 'orto'; line: number }
export type Line = // preserva el texto original, en orden
  | { t: 'node'; node: string; raw: string } // línea del mapa o de un nodo suelto
  | { t: 'edge'; edges: string[]; raw: string }
  | { t: 'raw'; raw: string }; // vacía, comentario o desconocida
export interface DiagramDoc { kind: Kind; nodes: DiagramNode[]; edges: DiagramEdge[]; lines: Line[]; eol: '\n' | '\r\n' }
export interface DiagramError { line: number; code: 'desconocida' | 'sangria' | 'forma' | 'tope' }
export interface ParseResult { doc: DiagramDoc; errors: DiagramError[]; truncated: boolean }
export type Edit = // datos puros, serializables, invertibles
  | { op: 'addNode'; shape?: Shape; text: string; parent?: string; x?: number; y?: number }
  | { op: 'rename'; id: string; text: string } | { op: 'remove'; ids: string[] }
  | { op: 'move'; id: string; x: number; y: number } | { op: 'moveMany'; items: { id: string; x: number; y: number }[] }
  | { op: 'reparent'; id: string; parent: string } | { op: 'fold'; id: string; folded: boolean }
  | { op: 'addEdge'; from: string; to: string; label?: string; arrow?: DiagramEdge['arrow'] }
  | { op: 'editEdge'; id: string; label?: string; arrow?: DiagramEdge['arrow']; route?: DiagramEdge['route'] } | { op: 'removeEdge'; id: string }
  | { op: 'setColor'; ids: string[]; color?: DiagramNode['color'] } | { op: 'clearPositions' } /* «Ordenar» */;
export interface Applied { doc: DiagramDoc; inverse: Edit[] /* aplicar en orden para deshacer */ }
export interface Layout { pos: Map<string, { x: number; y: number; w: number; h: number }>; paths: Map<string, string /* d de SVG */>; bounds: { x: number; y: number; w: number; h: number } }
