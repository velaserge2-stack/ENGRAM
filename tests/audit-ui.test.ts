// @vitest-environment jsdom
/**
 * Auditoría etapa 2.5 · src/screens + src/ui + state. Cada `it.fails` demuestra un error que EXISTE hoy.
 * auditoría: cambiar a it() al corregir.
 */
import { describe, expect, it } from 'vitest';
import { parseHash } from '../src/state';

describe('auditoría · rutas', () => {
  // auditoría: cambiar a it() al corregir
  it.fails('abrir un archivo con «%» en el nombre: la ruta se decodifica dos veces (spaces.tsx:111)', () => {
    location.hash = `#/espacios/abrir/${encodeURIComponent('docs/50% de descuento.pdf')}`;
    const route = parseHash().slice(1); // lo que recibe <Spaces route=…>: ya decodificado por parseHash
    // spaces.tsx:111 hace decodeURIComponent(route.slice(1).join('/')) otra vez
    const reopened = () => decodeURIComponent(route.slice(1).join('/'));
    expect(reopened()).toBe('docs/50% de descuento.pdf');
  });
  it.fails('abrir un archivo con «%41» literal: la segunda decodificación lo cambia', () => {
    location.hash = `#/espacios/abrir/${encodeURIComponent('docs/a%41b.pdf')}`;
    const route = parseHash().slice(1);
    expect(decodeURIComponent(route.slice(1).join('/'))).toBe('docs/a%41b.pdf');
  });
});
