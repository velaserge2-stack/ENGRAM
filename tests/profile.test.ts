import { describe, expect, it } from 'vitest';
import { EMPTY_PROFILE, initial, normUsername, parseProfile, PHOTO_DIR, PROFILE_PATH, serializeProfile, usernameError } from '../src/lib/profile';
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
  it('usuario: retrocompatible y perezoso (solo se escribe con valor), ida y vuelta idéntica', () => {
    const viejo = '---\nnombre: Ana\nemoji: 🩺\n---\n';
    expect(parseProfile(viejo)).toEqual({ ...EMPTY_PROFILE, name: 'Ana', emoji: '🩺' });
    expect(serializeProfile(parseProfile(viejo))).not.toContain('usuario');
    const p = { ...EMPTY_PROFILE, name: 'Serge', username: 'SergeV' };
    const txt = serializeProfile(p);
    expect(txt).toContain('usuario: SergeV');
    expect(parseProfile(txt)).toEqual(p);
    expect(serializeProfile(parseProfile(txt))).toBe(txt);
  });
  it('usuario: normalización y validación', () => {
    expect(normUsername('  @SergeV ')).toBe('SergeV');
    expect(normUsername('@@ana.lu')).toBe('ana.lu');
    for (const ok of ['abc', 'a'.repeat(30), 'SergeV', 'josé_luis', 'ana.lu', 'Ñoño_2026', '']) expect(usernameError(ok)).toBeNull();
    expect(usernameError('ab')).toBe('largo');
    expect(usernameError('a'.repeat(31))).toBe('largo');
    expect(usernameError('ana lu')).toBe('caracteres');
    expect(usernameError('ana@lu')).toBe('caracteres');
    expect(usernameError('ana-lu')).toBe('caracteres');
    expect(usernameError('.ana')).toBe('puntos');
    expect(usernameError('ana.')).toBe('puntos');
    expect(usernameError('an..a')).toBe('puntos');
  });
});
