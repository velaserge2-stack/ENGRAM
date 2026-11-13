// @vitest-environment jsdom
/**
 * Auditoría etapa 2.5 · src/screens + src/ui + state. Cada `it.fails` demuestra un error que EXISTE hoy.
 * auditoría: cambiar a it() al corregir.
 */
import { describe, expect, it } from 'vitest';
import { parseHash, routeFilePath } from '../src/state';

describe('auditoría · rutas', () => {
  // auditoría: corregido (menores)
  it('abrir un archivo con «%» en el nombre: la ruta se decodifica dos veces (spaces.tsx:111)', () => {
    location.hash = `#/espacios/abrir/${encodeURIComponent('docs/50% de descuento.pdf')}`;
    const route = parseHash().slice(1); // lo que recibe <Spaces route=…>: ya decodificado por parseHash
    expect(routeFilePath(route)).toBe('docs/50% de descuento.pdf');
  });
  it('abrir un archivo con «%41» literal: la segunda decodificación lo cambia', () => {
    location.hash = `#/espacios/abrir/${encodeURIComponent('docs/a%41b.pdf')}`;
    const route = parseHash().slice(1);
    expect(routeFilePath(route)).toBe('docs/a%41b.pdf');
  });
});
