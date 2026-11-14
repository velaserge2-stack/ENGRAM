// Tipos del contrato de diagramas (docs/diagramas/CONTRATO.md §2). Solo firmas.
export type DiagramKind = 'mapa' | 'flujo' | 'diagrama';
export type Kind = DiagramKind;
export type Shape = 'rect' | 'round' | 'diamond' | 'io' | 'note'; // mapa: siempre 'rect'
export type Dir = 'TB' | 'LR';

export interface DiagramNode {
  id: string; // estable: 'n' + orden de primera aparición
  shape: Shape;
  text: string; // texto crudo; nunca HTML (el pintor lo escapa)
  x?: number;
  y?: number;
  folded?: boolean;
  color?: 1 | 2 | 3 | 4 | 5 | 6; // reservado: el parser aún no lo lee
  parent?: string; // solo mapa
  depth: number; // solo mapa
  line: number; // índice (desde 0) en doc.lines de la primera aparición
}

export interface DiagramEdge {
  id: string; // 'e' + orden
  from: string;
  to: string;
  label?: string;
  arrow: 'to' | 'none' | 'both';
  route?: 'recta' | 'curva' | 'orto';
  line: number;
}

export type Line =
  | { t: 'node'; node: string; raw: string }
  | { t: 'edge'; edges: string[]; raw: string }
  | { t: 'raw'; raw: string }; // vacía, comentario o desconocida

export interface DiagramDoc {
  kind: DiagramKind;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  lines: Line[];
  eol: '\n' | '\r\n';
}

export interface DiagramError {
  line: number; // índice (desde 0) en doc.lines
  code: 'desconocida' | 'sangria' | 'forma' | 'tope';
}

export interface ParseResult {
  doc: DiagramDoc;
  errors: DiagramError[];
  truncated: boolean; // más de MAX_NODES nodos
  tooBig: boolean; // alias de `truncated`
}

export const MAX_NODES = 300;
export const MAX_LINE = 1000;

export type Edit =
  | { op: 'addNode'; shape?: Shape; text: string; parent?: string; x?: number; y?: number }
  | { op: 'rename'; id: string; text: string }
  | { op: 'remove'; ids: string[] }
  | { op: 'move'; id: string; x: number; y: number }
  | { op: 'moveMany'; items: { id: string; x: number; y: number }[] }
  | { op: 'reparent'; id: string; parent: string }
  | { op: 'fold'; id: string; folded: boolean }
  | { op: 'addEdge'; from: string; to: string; label?: string; arrow?: DiagramEdge['arrow'] }
  | { op: 'editEdge'; id: string; label?: string; arrow?: DiagramEdge['arrow']; route?: DiagramEdge['route'] }
  | { op: 'removeEdge'; id: string }
  | { op: 'setColor'; ids: string[]; color?: DiagramNode['color'] }
  | { op: 'clearPositions' };

export interface Applied {
  doc: DiagramDoc;
  inverse: Edit[];
}

export interface Layout {
  pos: Map<string, { x: number; y: number; w: number; h: number }>;
  paths: Map<string, string>;
  bounds: { x: number; y: number; w: number; h: number };
}
