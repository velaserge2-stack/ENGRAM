/**
 * Perfil del usuario (Mejoras 2 · C7): `profile/perfil.md` = frontmatter + bio en el cuerpo.
 * La foto vive en `media/.app/perfil/`. Todo es opcional y nunca sale del dispositivo
 * (solo viaja dentro del respaldo de la bóveda).
 */
import { parseFrontmatter, stringifyFrontmatter, type Frontmatter } from './frontmatter';

export const PROFILE_PATH = 'profile/perfil.md';
export const PHOTO_DIR = 'media/.app/perfil';

export interface Profile {
  name: string;
  emoji: string;
  photo: string;
  bio: string;
  program: string;
  institution: string;
  year: string;
  motto: string;
}

/** Claves del archivo (en español, como el resto de formatos de Engrama; no se traducen). */
const KEYS: Record<Exclude<keyof Profile, 'bio'>, string> = { name: 'nombre', emoji: 'emoji', photo: 'foto', program: 'carrera', institution: 'institucion', year: 'anio', motto: 'lema' };

export const EMPTY_PROFILE: Profile = { name: '', emoji: '', photo: '', bio: '', program: '', institution: '', year: '', motto: '' };

export function parseProfile(text: string): Profile {
  const doc = parseFrontmatter(text);
  const p: Profile = { ...EMPTY_PROFILE, bio: doc.body.trim() };
  for (const [k, file] of Object.entries(KEYS) as [Exclude<keyof Profile, 'bio'>, string][]) {
    const v = doc.data[file];
    if (v !== undefined && v !== null && !Array.isArray(v)) p[k] = String(v);
  }
  return p;
}

export function serializeProfile(p: Profile): string {
  const data: Frontmatter = {};
  for (const [k, file] of Object.entries(KEYS) as [Exclude<keyof Profile, 'bio'>, string][]) if (p[k].trim()) data[file] = p[k].trim();
  // sin datos: el archivo queda vacío pero válido
  return stringifyFrontmatter(Object.keys(data).length ? data : { nombre: '' }, p.bio.trim() ? `${p.bio.trim()}\n` : '');
}

/** Letra del avatar cuando no hay foto ni emoji. */
export function initial(p: Pick<Profile, 'name'>): string {
  return [...p.name.trim()][0]?.toUpperCase() ?? '';
}
