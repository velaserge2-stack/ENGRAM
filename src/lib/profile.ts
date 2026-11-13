/**
 * Perfil del usuario (Mejoras 2 · C7): `profile/perfil.md` = frontmatter + bio en el cuerpo.
 * La foto vive en `media/.app/perfil/`. Todo es opcional y nunca sale del dispositivo
 * (solo viaja dentro del respaldo de la bóveda).
 */
import { headOf, parseFrontmatter, rewriteDoc, stringifyFrontmatter, type Frontmatter } from './frontmatter';

export const PROFILE_PATH = 'profile/perfil.md';
export const PHOTO_DIR = 'media/.app/perfil';

export interface Profile {
  name: string;
  /** @usuario: solo una etiqueta local para las imágenes compartidas; se guarda sin «@» */
  username: string;
  emoji: string;
  photo: string;
  bio: string;
  program: string;
  institution: string;
  year: string;
  motto: string;
}

/** Claves del archivo (en español, como el resto de formatos de Engrama; no se traducen). */
const KEYS: Record<Exclude<keyof Profile, 'bio'>, string> = { name: 'nombre', username: 'usuario', emoji: 'emoji', photo: 'foto', program: 'carrera', institution: 'institucion', year: 'anio', motto: 'lema' };

export const EMPTY_PROFILE: Profile = { name: '', username: '', emoji: '', photo: '', bio: '', program: '', institution: '', year: '', motto: '' };

export function parseProfile(text: string): Profile {
  const doc = parseFrontmatter(text);
  const p: Profile = { ...EMPTY_PROFILE, bio: doc.body.trim() };
  for (const [k, file] of Object.entries(KEYS) as [Exclude<keyof Profile, 'bio'>, string][]) {
    const v = doc.data[file];
    if (v !== undefined && v !== null && !Array.isArray(v)) p[k] = String(v);
  }
  return p;
}

/** `prev`: el archivo actual; sus líneas ajenas del frontmatter se conservan. */
export function serializeProfile(p: Profile, prev = ''): string {
  const data: Frontmatter = {};
  for (const [k, file] of Object.entries(KEYS) as [Exclude<keyof Profile, 'bio'>, string][]) if (p[k].trim()) data[file] = p[k].trim();
  const body = p.bio.trim() ? `${p.bio.trim()}\n` : '';
  if (headOf(prev) !== null) {
    const out = rewriteDoc(prev, body, Object.fromEntries(Object.values(KEYS).map((f) => [f, data[f]])));
    if (headOf(out) !== null) return out;
  }
  // sin datos: el archivo queda vacío pero válido
  return stringifyFrontmatter(Object.keys(data).length ? data : { nombre: '' }, body);
}

/** Letra del avatar cuando no hay foto ni emoji. */
export function initial(p: Pick<Profile, 'name'>): string {
  return [...p.name.trim()][0]?.toUpperCase() ?? '';
}

/** Lo que el usuario teclea → como se guarda: sin espacios en los extremos ni «@» al inicio. */
export const normUsername = (v: string) => v.trim().replace(/^@+/, '');

/**
 * `null` si es válido (o vacío). 3–30 caracteres: letras (con acentos), números, «_» y «.»; sin
 * espacios, sin «..» ni punto al inicio o al final. Mayúsculas y minúsculas se conservan.
 */
export function usernameError(v: string): 'largo' | 'caracteres' | 'puntos' | null {
  if (!v) return null;
  const n = [...v].length;
  if (n < 3 || n > 30) return 'largo';
  if (!/^[\p{L}\p{M}\p{N}_.]+$/u.test(v)) return 'caracteres';
  if (v.startsWith('.') || v.endsWith('.') || v.includes('..')) return 'puntos';
  return null;
}
