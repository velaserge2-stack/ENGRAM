import { describe, expect, it } from 'vitest';
import { EMPTY_PROFILE, initial, parseProfile, PHOTO_DIR, PROFILE_PATH, serializeProfile } from '../src/lib/profile';
import { isExportable } from '../src/io/zip';

describe('perfil', () => {
  it('ida y vuelta conserva todos los campos', () => {
    const p = { ...EMPTY_PROFILE, name: 'Ana López', emoji: '🩺', photo: 'media/.app/perfil/a.jpg', bio: 'Residente.\nSegunda línea', program: 'Medicina', institution: 'UANL', year: '2027', motto: 'Poco a poco' };
    const txt = serializeProfile(p);
    expect(txt).toContain('nombre: Ana López');
    expect(parseProfile(txt)).toEqual(p);
  });
  it('archivo vacío o ausente', () => {
    expect(parseProfile('')).toEqual(EMPTY_PROFILE);
    expect(parseProfile(serializeProfile(EMPTY_PROFILE))).toEqual(EMPTY_PROFILE);
  });
  it('inicial del nombre', () => {
    expect(initial({ name: ' ángel' })).toBe('Á');
    expect(initial({ name: '' })).toBe('');
  });
  it('viaja en el respaldo de la bóveda', () => {
    expect(isExportable(PROFILE_PATH)).toBe(true);
    expect(isExportable(`${PHOTO_DIR}/x.jpg`)).toBe(true);
  });
});
