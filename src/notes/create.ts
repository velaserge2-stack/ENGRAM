// Crear una nota nueva (pantalla Notas, Bandeja y Asistente): ruta libre (nunca sobrescribe: « (2)») y texto, en un solo sitio.
import { type Frontmatter, parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter';
import type { VaultAdapter } from '../vault/types';
import { type DiagramKind, newDiagramNote } from './diagramtype';
import { newNoteText, notePath } from './model';

export interface NewNote {
  materia: string;
  tema: string;
  titulo: string;
  kind?: 'nota' | DiagramKind;
  template?: string;
  tags?: string[];
  /** cuerpo propio: sustituye al de la plantilla (la fuente del diagrama, si es de diagrama) */
  texto?: string;
  /** claves extra del frontmatter (p. ej. `origen: 'ia'`) */
  extra?: Frontmatter;
}

/** Primera ruta libre para el título (« (2)», « (3)»…). `exists` permite reservar rutas aún no escritas. */
export async function freePath(exists: (p: string) => Promise<boolean>, materia: string, tema: string, title: string): Promise<string> {
  let path = notePath(materia, tema, title);
  for (let i = 2; await exists(path); i++) path = notePath(materia, tema, `${title} (${i})`);
  return path;
}

/** Texto completo del archivo nuevo, sin escribir. */
export function noteFileText(n: NewNote, now = new Date()): string {
  const title = n.titulo.trim(), kind = n.kind ?? 'nota';
  const base = kind === 'nota' ? newNoteText(n.materia, n.tema, title, n.template, n.tags ?? [], now) : newDiagramNote(kind, n.materia, n.tema, title, now);
  if (n.texto === undefined && !n.extra) return base;
  const d = parseFrontmatter(base);
  return stringifyFrontmatter({ ...d.data, ...n.extra }, n.texto ?? d.body);
}

/** Ruta y texto de la nota nueva, sin escribir (vista previa). */
export async function planNote(exists: (p: string) => Promise<boolean>, n: NewNote, now = new Date()): Promise<{ path: string; text: string }> {
  return { path: await freePath(exists, n.materia, n.tema, n.titulo), text: noteFileText(n, now) };
}

/** Crea la nota; nunca pisa una existente. Devuelve la ruta. */
export async function createNote(vault: VaultAdapter, n: NewNote, now = new Date()): Promise<string> {
  const { path, text } = await planNote((p) => vault.exists(p), n, now);
  await vault.write(path, text);
  return path;
}
