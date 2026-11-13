import { describe, expect, it } from 'vitest';
import { parseFrontmatter, setKeys, stringifyFrontmatter } from '../src/lib/frontmatter';
import { checkIntegrity } from '../src/vault/integrity';
import { MemoryBackend } from '../src/vault/memory';

describe('frontmatter', () => {
  it('lee el formato de mazo de la SPEC', () => {
    const d = parseFrontmatter('---\ndeck: Cardiología\ntags: [ecg, urgencias]\nnew_per_day: 15\ncolor: "#FF9500"\n---\nQ:: ¿?\n');
    expect(d.errors).toEqual([]);
    expect(d.data).toEqual({ deck: 'Cardiología', tags: ['ecg', 'urgencias'], new_per_day: 15, color: '#FF9500' });
    expect(d.body).toBe('Q:: ¿?\n');
  });
  it('listas en bloque, booleanos y nulos', () => {
    const d = parseFrontmatter('---\ntemas:\n  - Cardio\n  - "Neuro/EVC"\naleatorio: true\nvacio:\n---\n');
    expect(d.data).toEqual({ temas: ['Cardio', 'Neuro/EVC'], aleatorio: true, vacio: null });
  });
  it('sin frontmatter', () => {
    expect(parseFrontmatter('# Hola').hasFrontmatter).toBe(false);
  });
  it('reporta errores sin perder el texto', () => {
    const d = parseFrontmatter('---\ndeck: X\n');
    expect(d.errors.length).toBe(1);
    expect(d.body).toBe('---\ndeck: X\n');
    expect(parseFrontmatter('---\n: :\n---\n').errors.length).toBe(1);
  });
  it('ida y vuelta', () => {
    const data = { deck: 'Cardiología', tags: ['a', 'b c'], n: 3, ok: false, num: '15' };
    const back = parseFrontmatter(stringifyFrontmatter(data, 'cuerpo'));
    expect(back.data).toEqual(data);
    expect(back.body).toBe('cuerpo');
  });
});

describe('integridad', () => {
  it('cuenta y reporta sin borrar', async () => {
    const v = new MemoryBackend();
    await v.write('decks/a.md', '---\ndeck: A\n---\nQ:: x\nA:: y ^c1');
    await v.write('decks/roto.md', '---\ndeck: B\n');
    await v.write('decks/sin.md', '---\ntags: [x]\n---\n');
    await v.write('notes/bin.md', new Uint8Array([0xff, 0xfe, 0x00]));
    await v.write('.app/settings.json', '{mal');
    await v.write('.app/reviews.jsonl', '{"ts":1,"rating":3}\nbasura\n');
    await v.write('media/x.png', new Uint8Array(10));
    const r = await checkIntegrity(v);
    expect(r.files).toBe(7);
    expect(r.byFolder).toEqual({ decks: 3, notes: 1, '.app': 2, media: 1 });
    expect(r.problems.map((p) => p.path).sort()).toEqual(['.app/reviews.jsonl', '.app/settings.json', 'decks/roto.md', 'decks/sin.md', 'notes/bin.md']);
    expect(await v.exists('decks/roto.md')).toBe(true);
  });
});

describe('plan 15: setKeys', () => {
  it('cambia solo las claves pedidas y deja intacto lo que el parser no entiende', () => {
    const t = '---\ndescripcion: >\n  Texto largo\ntemas:\n  - a\n  - b\nversion: 1.0\n# comentario\n---\n# Hola\n';
    expect(setKeys(t, { temas: ['c'], id: 'x1' })).toBe('---\ndescripcion: >\n  Texto largo\ntemas: [c]\nversion: 1.0\n# comentario\nid: x1\n---\n# Hola\n');
    expect(setKeys(t, { descripcion: undefined })).toBe('---\ntemas:\n  - a\n  - b\nversion: 1.0\n# comentario\n---\n# Hola\n');
  });
  it('sin frontmatter lo antepone; CRLF se conserva; sin claves lo quita; «» no pasa a null', () => {
    expect(setKeys('# Nota\n', { id: 'k' })).toBe('---\nid: k\n---\n# Nota\n');
    expect(setKeys('# Nota\n', { id: undefined })).toBe('# Nota\n');
    expect(setKeys('---\r\nmateria: X\r\n---\r\nTexto\r\n', { tema: 'Y' })).toBe('---\r\nmateria: X\r\ntema: Y\r\n---\r\nTexto\r\n');
    expect(setKeys('---\nmateria: X\n---\nB\n', { materia: undefined })).toBe('B\n');
    expect(parseFrontmatter(stringifyFrontmatter({ a: '' }, '')).data.a).toBe('');
    expect(setKeys('---\nab: 1\n---\n', { a: 2 })).toBe('---\nab: 1\na: 2\n---\n');
  });
});
