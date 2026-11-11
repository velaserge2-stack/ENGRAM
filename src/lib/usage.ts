/**
 * Almacenamiento (Mejoras 2 · C10): desglose por tipo, usos de cada archivo y huérfanos.
 * Puro (sin bóveda) para poder probarlo; la pantalla lee los archivos y llama aquí.
 */
export type Kind = 'pdf' | 'documentos' | 'hojas' | 'fotos' | 'fondos' | 'audio' | 'cache' | 'datos' | 'otros';
export const KINDS: Kind[] = ['pdf', 'documentos', 'hojas', 'fotos', 'fondos', 'audio', 'cache', 'datos', 'otros'];

/** Cachés que se reconstruyen solas desde los archivos (state.json desde reviews.jsonl). */
export const REGENERABLE = (p: string) => p === '.app/state.json' || p.startsWith('.app/cache/');

export function kindOf(path: string): Kind {
  const p = path.toLowerCase();
  if (REGENERABLE(path)) return 'cache';
  if (p.startsWith('media/.app/fondos/')) return 'fondos';
  if (p.endsWith('.pdf')) return 'pdf';
  if (/\.(docx?|odt|rtf|pages)$/.test(p)) return 'documentos';
  if (/\.(csv|tsv|xlsx?|ods|numbers)$/.test(p)) return 'hojas';
  if (/\.(png|jpe?g|gif|webp|heic|heif|svg|bmp)$/.test(p)) return 'fotos';
  if (/\.(mp3|m4a|wav|ogg|aac|flac|opus)$/.test(p)) return 'audio';
  if (/\.(md|json|jsonl|ics|txt|srt)$/.test(p)) return 'datos';
  return 'otros';
}

/** Archivos que se pueden borrar desde aquí: lo pesado que el usuario añadió (no sus notas ni mazos). */
export const DELETABLE = (p: string) => (p.startsWith('media/') || p.startsWith('docs/')) && !p.startsWith('media/.app/') && !p.endsWith('.annots.json'); // las anotaciones van con su PDF

/** Referencias en un texto: `![[x]]`, `[[x]]`, `](x)`, `src: x#p3`, rutas entre comillas (JSON de espacios). */
export function refsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/!?\[\[([^\]|#\n]+)/g)) out.push(m[1]!.trim());
  for (const m of text.matchAll(/\]\(([^)\s#]+)/g)) { try { out.push(decodeURI(m[1]!)); } catch { out.push(m[1]!); } }
  for (const m of text.matchAll(/(?:^|\s)src:\s*([^\s#]+)/gm)) out.push(m[1]!);
  for (const m of text.matchAll(/"((?:media|docs)\/[^"#]+)/g)) out.push(m[1]!);
  return out;
}

const base = (p: string) => p.split('/').pop()!.toLowerCase();

/** Cuántos documentos (notas, mazos, espacios…) usan cada archivo, por ruta o por nombre. */
export function countUses(targets: string[], docs: { path: string; text: string }[]): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const t of targets) (byName.get(base(t)) ?? byName.set(base(t), []).get(base(t))!).push(t);
  const uses = new Map<string, string[]>(targets.map((t) => [t, []]));
  for (const d of docs) {
    const hit = new Set<string>();
    for (const r of refsIn(d.text)) {
      if (uses.has(r)) hit.add(r);
      else for (const t of byName.get(base(r)) ?? []) hit.add(t);
    }
    for (const t of hit) uses.get(t)!.push(d.path);
  }
  return uses;
}

/** Huérfanos: solo medios (imágenes, audio) sin ningún uso. Los PDF y documentos de docs/ son biblioteca, no basura. */
export function orphans(uses: Map<string, string[]>): string[] {
  return [...uses].filter(([p, u]) => p.startsWith('media/') && !u.length).map(([p]) => p);
}
