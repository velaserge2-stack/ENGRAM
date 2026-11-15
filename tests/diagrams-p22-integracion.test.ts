import { describe, expect, it } from 'vitest';
import { diagramFence, setFenceAlto } from '../src/notes/diagramtype';
import { parseFrontmatter, setKeys } from '../src/lib/frontmatter';
import { readBackdrop, readHeight } from '../src/diagrams/parse';
import { resolveDiagramEmbed } from '../src/diagrams/embed';

const B = '```mapa\nRaíz\n- A\n```';

describe('P22 integración: diagramFence y alto=', () => {
  it('sin info = como siempre', () => {
    const f = diagramFence(B)!;
    expect(f).toEqual({ kind: 'mapa', src: 'Raíz\n- A' });
    expect(f.alto).toBeUndefined();
  });
  it('con alto= y otras palabras', () => {
    expect(diagramFence('```flujo alto=420\n[A] --> [B]\n```')).toMatchObject({ kind: 'flujo', alto: 420, src: '[A] --> [B]' });
    expect(diagramFence('```flujo foo alto=500\n[A]\n```')!.alto).toBe(500);
    expect(diagramFence('```mapa alto=99\nX\n```')!.alto).toBeUndefined(); // fuera de rango: ignorado
    expect(diagramFence('```mapas\nX\n```')).toBeNull();
  });
  it('setFenceAlto cambia solo la línea de apertura', () => {
    const out = setFenceAlto(B, 420);
    expect(out).toBe('```mapa alto=420\nRaíz\n- A\n```');
    expect(setFenceAlto(out, 500)).toBe('```mapa alto=500\nRaíz\n- A\n```');
    expect(setFenceAlto('```mapa foo alto=300 bar\nX\n```', 400)).toBe('```mapa foo bar alto=400\nX\n```');
  });
  it('sin cambio real, mismo texto', () => {
    expect(setFenceAlto('```mapa alto=420\nX\n```', 420)).toBe('```mapa alto=420\nX\n```');
    expect(setFenceAlto('texto', 420)).toBe('texto');
    expect(setFenceAlto(B, 10)).toBe(B);
  });
});

describe('P22 integración: fondo y alto del frontmatter', () => {
  const nota = '---\ntipo: mapa\nfondo: puntos\nalto: 480\n---\n# fondo: gris\nRaíz\n';
  it('fondo: del frontmatter manda sobre # fondo:', () => {
    const fm = parseFrontmatter(nota);
    expect(readBackdrop(fm.body, String(fm.data.fondo))).toBe('puntos');
    expect(readBackdrop(fm.body)).toBe('gris');
    expect(readBackdrop(fm.body, 'inventado')).toBe('gris');
  });
  it('alto: del frontmatter', () => {
    expect(readHeight(undefined, '480')).toBe(480);
    expect(readHeight(undefined, undefined)).toBeUndefined();
  });
  it('el embed trae fondo y alto solo si existen', () => {
    const notes = [{ path: 'notes/M.md', title: 'M' }];
    const e = resolveDiagramEmbed('M', notes, new Map([['notes/M.md', nota]]));
    expect(e).toMatchObject({ state: 'diagram', fondo: 'puntos', alto: '480' });
    const v = resolveDiagramEmbed('M', notes, new Map([['notes/M.md', '---\ntipo: mapa\n---\nRaíz\n']]));
    expect(v).toEqual({ state: 'diagram', kind: 'mapa', path: 'notes/M.md', title: 'M', src: 'Raíz\n' });
  });
  it('nota vieja sin claves: guardar sin cambios = mismo texto', () => {
    const vieja = '---\ntipo: flujo\nfecha: 2026-01-01\ntags: []\n---\n[A] --> [B]\n';
    expect(setKeys(vieja, { fondo: undefined })).toBe(vieja);
    expect(setKeys(vieja, { alto: undefined })).toBe(vieja);
    expect(setKeys(vieja, { fondo: 'gris' })).toContain('fondo: gris');
    expect(parseFrontmatter(setKeys(vieja, { fondo: 'gris' })).body).toBe('[A] --> [B]\n');
  });
});
