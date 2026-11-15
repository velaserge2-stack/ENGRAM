// Tipos del contrato de diagramas (docs/diagramas/CONTRATO.md §2). Solo firmas.
export type DiagramKind = 'mapa' | 'flujo' | 'diagrama';
export type Kind = DiagramKind;
export type Shape = 'rect' | 'round' | 'diamond' | 'io' | 'note'; // mapa: siempre 'rect'
export type Dir = 'TB' | 'LR';
export type Color = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type FontSize = 's' | 'm' | 'l';
export type EdgeEnd = 'sin' | 'flecha' | 'ambos' | 'circulo' | 'rombo';
export type Backdrop = 'cristal' | 'claro' | 'gris' | 'oscuro' | 'cuadricula' | 'puntos';
export const BACKDROPS: readonly Backdrop[] = ['cristal', 'claro', 'gris', 'oscuro', 'cuadricula', 'puntos'];

// Atributos de nodo (§P22.2). w/h = mínimo manual; maxw = ancho de ajuste de línea.
export interface NodeAttrs { color?: Color; w?: number; h?: number; maxw?: number; fs?: FontSize; folded?: boolean; x?: number; y?: number }
export interface EdgeAttrs { color?: Color; w?: number; dash?: boolean; fin?: EdgeEnd; route?: 'recta' | 'curva' | 'orto' }

export interface DiagramNode extends NodeAttrs {
  id: string; // estable: 'n' + orden de primera aparición
  shape: Shape;
  text: string; // texto crudo; nunca HTML (el pintor lo escapa)
  extra?: string[]; // ítems de grupo no entendidos: se conservan literales, no se aplican
  parent?: string; // solo mapa
  depth: number; // solo mapa
  line: number; // índice (desde 0) en doc.lines de la primera aparición
}

export interface DiagramEdge extends EdgeAttrs {
  id: string; // 'e' + orden
  from: string;
  to: string;
  label?: string;
  arrow: 'to' | 'none' | 'both';
  extra?: string[];
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
export const MAX_LINE = 5500; // línea ≤ MAX_TEXT + forma y sufijos
export const MAX_TEXT = 5000; // texto de nodo: tope de seguridad (el resto no se lee; la línea queda literal)

export type Route = NonNullable<DiagramEdge['route']>;

export interface TreeItem { text: string; depth: number; shape?: Shape } // depth 0 = hijo directo; sube como mucho +1

// Ediciones puras e invertibles (applyEdit). `splice` es el inverso interno: reemplaza líneas del texto.
export type Edit =
  | { op: 'addChild'; parent: string; shape?: Shape; text: string; attrs?: NodeAttrs }
  | { op: 'addSibling'; id: string; shape?: Shape; text: string; attrs?: NodeAttrs }
  | { op: 'rename'; id: string; text: string }
  | { op: 'remove'; id: string }
  | { op: 'connect'; from: string; to: string; route?: Route; arrow?: DiagramEdge['arrow'] }
  | { op: 'disconnect'; id: string }
  | { op: 'move'; id: string; x: number; y: number }
  | { op: 'fold'; id: string; folded: boolean }
  | { op: 'reparent'; id: string; parent: string }
  | { op: 'style'; id: string; route: Route }
  | { op: 'label'; id: string; label: string }
  | { op: 'attrs'; ids: string[]; set?: NodeAttrs; unset?: (keyof NodeAttrs)[] }
  | { op: 'edgeAttrs'; ids: string[]; set?: EdgeAttrs; unset?: (keyof EdgeAttrs)[] }
  | { op: 'addTree'; parent: string; items: TreeItem[] }
  | { op: 'backdrop'; value?: Backdrop }
  | { op: 'splice'; at: number; remove: number; insert: string[] };

export interface Applied {
  doc: DiagramDoc;
  inverse: Edit[];
}

export interface Layout {
  pos: Map<string, { x: number; y: number; w: number; h: number }>;
  paths: Map<string, string>;
  bounds: { x: number; y: number; w: number; h: number };
}
