// Embed `![[Mi mapa]]` de una nota de diagrama dentro de otra nota. Puro: no importa la vista ni el editor
// (la vista se carga con `import()` solo si el bloque resuelve a un diagrama). Sin cambios en `render.ts`.
import { parseFrontmatter } from '../lib/frontmatter';
import { type DiagramKind, diagramKindOf } from '../notes/diagramtype';

/** Nombre de un bloque que es solo `![[nombre]]` (sin `|opciones`, sin extensión de imagen o audio); si no, null. */
export function embedName(block: string): string | null {
  const m = /^!\[\[([^\]|\n]+)\]\]$/.exec(block.trim());
  const name = m?.[1]?.trim();
  return name && !/\.(png|jpe?g|gif|webp|svg|heic|heif|avif|bmp|mp3|m4a|wav|ogg)$/i.test(name) ? name : null;
}

export type DiagramEmbed =
  | { state: 'diagram'; kind: DiagramKind; path: string; title: string; src: string }
  | { state: 'missing'; name: string }
  | null; // la nota existe y no es de diagrama: comportamiento de siempre

const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/\.md$/, '').trim();

/** Resuelve el embed por título (o ruta) contra las notas; `texts` es ruta → texto del `.md`. */
export function resolveDiagramEmbed(name: string, notes: { path: string; title: string }[], texts: Map<string, string>): DiagramEmbed {
  const k = norm(name);
  const n = notes.find((x) => norm(x.title) === k) ?? notes.find((x) => norm(x.path.replace(/^notes\//, '')) === k);
  if (!n) return { state: 'missing', name };
  const text = texts.get(n.path) ?? '';
  const kind = diagramKindOf(text);
  return kind === 'nota' ? null : { state: 'diagram', kind, path: n.path, title: n.title, src: parseFrontmatter(text).body };
}
