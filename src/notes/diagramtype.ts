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

const FENCE = /^```(mapa|flujo|diagrama)([ \t][^\r\n]*)?\r?\n([\s\S]*?)\r?\n?```[ \t]*$/;

/** `alto=420` de la info del fence (160–2000); fuera de rango o ausente = undefined (§P22.1; mismo criterio que `readHeight`). */
export function fenceAlto(info: string): number | undefined {
  const v = /(?:^|\s)alto=(\S+)/.exec(info)?.[1];
  const n = v !== undefined && /^\d+$/.test(v) ? Number(v) : NaN;
  return n >= 160 && n <= 2000 ? n : undefined;
}

/** Bloque ```mapa|flujo|diagrama [alto=N] dentro de una nota normal: devuelve tipo, fuente y `alto` (si la info lo trae), o null. */
export function diagramFence(block: string): { kind: DiagramKind; src: string; alto?: number } | null {
  const m = FENCE.exec(block.trim());
  if (!m) return null;
  const info = (m[2] ?? '').trim();
  const alto = fenceAlto(info);
  return { kind: m[1] as DiagramKind, src: m[3]!, ...(alto !== undefined ? { alto } : {}) };
}

/** Reescribe SOLO la línea de apertura del fence con `alto=h`; el resto del bloque queda byte a byte. Sin cambio real = el mismo texto. */
export function setFenceAlto(block: string, h: number): string {
  const f = diagramFence(block);
  if (!f || !Number.isInteger(h) || h < 160 || h > 2000 || f.alto === h) return block;
  return block.replace(/^(\s*```(?:mapa|flujo|diagrama))([ \t][^\r\n]*)?/, (_m, a: string, info: string | undefined) => {
    const rest = (info ?? '').replace(/(?:^|[ \t]+)alto=\S*/, '').trimEnd();
    return `${a}${rest ? (rest.startsWith(' ') || rest.startsWith('\t') ? rest : ' ' + rest) : ''} alto=${h}`;
  });
}

/** Cambia solo el bloque `block` (su `nth` aparición a inicio de línea) por `next` en el texto crudo; el resto queda byte a byte. */
export function replaceBlockAt(body: string, block: string, nth: number, next: string): string {
  for (let at = body.indexOf(block); at >= 0; at = body.indexOf(block, at + 1)) {
    if (at > 0 && body[at - 1] !== '\n') continue;
    if (nth-- === 0) return body.slice(0, at) + next + body.slice(at + block.length);
  }
  return body;
}
