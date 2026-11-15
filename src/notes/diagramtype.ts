// Tipos de nota (Prompt 20 · D/E). `tipo:` en el frontmatter; claves y valores en español, no se traducen.
// Pura: sin HTML ni importar `src/diagrams/*` (la vista se carga bajo demanda desde la pantalla de nota).
import { type Frontmatter, parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter';

export type NoteKind = 'nota' | 'mapa' | 'flujo' | 'diagrama';
export type DiagramKind = Exclude<NoteKind, 'nota'>;

/** Tipo de la nota según su `tipo:`; sin `tipo` o desconocido = `'nota'` (las notas viejas no cambian). */
export function diagramKindOf(text: string): NoteKind {
  const v = parseFrontmatter(text).data.tipo;
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return s === 'mapa' || s === 'flujo' || s === 'diagrama' ? s : 'nota';
}

/** Cuerpo inicial (gramática, sin fence) para un diagrama nuevo. */
export function newDiagramText(kind: DiagramKind, title: string): string {
  const t = title.replace(/[\r\n]+/g, ' ').replace(/[\]\)}]/g, '').trim() || 'Diagrama';
  if (kind === 'mapa') return `${t}\n- Idea 1\n- Idea 2\n`;
  if (kind === 'flujo') return '(Inicio) --> [Paso] --> (Fin)\n';
  return `[${t}] --> [Idea]\n`;
}

/** Nota nueva de diagrama completa: `tipo:` solo aquí (nunca se reescribe una nota existente). */
export function newDiagramNote(kind: DiagramKind, materia: string, tema: string, title: string, now = new Date()): string {
  const fecha = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const fm: Frontmatter = { ...(materia.trim() ? { materia: materia.trim() } : {}), ...(tema.trim() ? { tema: tema.trim() } : {}), tipo: kind, fecha, tags: [] };
  return stringifyFrontmatter(fm, newDiagramText(kind, title));
}

/** Bloque ```mapa|flujo|diagrama dentro de una nota normal: devuelve tipo y fuente, o null. */
export function diagramFence(block: string): { kind: DiagramKind; src: string } | null {
  const m = /^```(mapa|flujo|diagrama)[ \t]*\r?\n([\s\S]*?)\r?\n?```[ \t]*$/.exec(block.trim());
  return m ? { kind: m[1] as DiagramKind, src: m[2]! } : null;
}
