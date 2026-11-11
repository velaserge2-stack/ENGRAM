import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { applyPlan, buildPlan, gather, type IncomingFile, placeLoose, undoImport } from '../src/io/import';
import { LIMITS } from '../src/io/limits';
import { buildZip, collectVault, parseZip } from '../src/io/zip';
import { MemoryBackend } from '../src/vault/memory';
import { SafeVault } from '../src/vault/safe';
import { readText, walk } from '../src/vault/util';

const inc = (name: string, text: string | Uint8Array, relativePath?: string): IncomingFile => ({
  name,
  relativePath,
  bytes: async () => (typeof text === 'string' ? strToU8(text) : text),
});

async function sampleVault() {
  const v = new SafeVault(new MemoryBackend());
  await v.write('decks/Cardiología.md', '---\ndeck: Cardiología\n---\nQ:: ¿?\nA:: sí ^c01a\n');
  await v.write('notes/Clase 1.md', '# Clase');
  await v.write('media/ecg.png', new Uint8Array([137, 80, 78, 71]));
  await v.write('.app/settings.json', '{}');
  await v.write('.app/reviews.jsonl', '{"id":"c01a","ts":1,"rating":3,"ms":1000}\n');
  return v;
}

describe('zip de bóveda', () => {
  it('exportar → reimportar produce archivos idénticos', async () => {
    const v = await sampleVault();
    const files = await collectVault(v);
    const zipped = await buildZip(files, '0.1.0', new Date('2026-01-01T00:00:00Z'));
    const parsed = await parseZip(zipped);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.manifest?.counts).toMatchObject({ files: 5, decks: 1, notes: 1, media: 1 });
    expect(parsed.manifest?.createdAt).toBe('2026-01-01T00:00:00.000Z');

    const w = new SafeVault(new MemoryBackend());
    const plan = await buildPlan(w, parsed.files);
    await applyPlan(w, plan, () => 'replace');
    const a = await walk(v);
    const b = await walk(w);
    expect(b.map((f) => f.path)).toEqual(a.map((f) => f.path));
    for (const f of a) expect(await w.read(f.path)).toEqual(await v.read(f.path));
  });

  it('no exporta el diario ni temporales', async () => {
    const raw = new MemoryBackend();
    await raw.write('.app/journal.json', '{}');
    await raw.write('.app/tmp/x', 'x');
    await raw.write('notes/a.md', 'a');
    expect((await collectVault(raw)).map((f) => f.path)).toEqual(['notes/a.md']);
  });

  it('rechaza rutas maliciosas y quita carpeta envolvente', async () => {
    const z = zipSync({
      'MiBoveda/decks/a.md': strToU8('---\ndeck: A\n---\n'),
      'MiBoveda/notes/b.md': strToU8('b'),
      'MiBoveda/.obsidian/app.json': strToU8('{}'),
      '__MACOSX/MiBoveda/._a.md': strToU8('x'),
    });
    const p = await parseZip(z);
    expect(p.files.map((f) => f.path).sort()).toEqual(['decks/a.md', 'notes/b.md']);
    const evil = zipSync({ '../../fuera.md': strToU8('x'), 'ok.md': strToU8('y') });
    const q = await parseZip(evil);
    expect(q.files.map((f) => f.path)).toEqual(['ok.md']);
    expect(q.warnings.some((w) => w.includes('no permitida'))).toBe(true);
  });

  it('aplica límites (bomba zip / demasiados archivos)', async () => {
    const big = new Uint8Array(3 * 1024 * 1024); // ceros: compresión enorme
    const p = await parseZip(zipSync({ 'bomba.md': big, 'ok.md': strToU8('y') }));
    expect(p.files.map((f) => f.path)).toEqual(['ok.md']);
    const many = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`n${i}.md`, strToU8('x')]));
    const q = await parseZip(zipSync(many), { ...LIMITS, maxFiles: 3 });
    expect(q.files.length).toBe(3);
  });

  it('avisa si el manifiesto no coincide', async () => {
    const z = zipSync({ 'manifest.json': strToU8(JSON.stringify({ format: 'engrama-vault', formatVersion: 1, counts: { files: 9 } })), 'notes/a.md': strToU8('a') });
    expect((await parseZip(z)).warnings[0]).toContain('9 archivos');
  });
});

describe('importar', () => {
  it('clasifica archivos sueltos', () => {
    expect(placeLoose('Cardio.md', strToU8('---\ndeck: Cardio\n---\n'))).toBe('decks/Cardio.md');
    expect(placeLoose('Apuntes.md', strToU8('# hola'))).toBe('notes/Apuntes.md');
    expect(placeLoose('foto.JPG', new Uint8Array())).toBe('media/foto.JPG');
    expect(placeLoose('guia.pdf', new Uint8Array())).toBe('docs/guia.pdf');
    expect(placeLoose('decks/x.md', strToU8(''))).toBe('decks/x.md');
  });

  it('carpeta con estructura de bóveda quita el nombre de la carpeta', async () => {
    const g = await gather([inc('a.md', '---\ndeck: A\n---', 'Boveda/decks/a.md'), inc('b.md', 'b', 'Boveda/notes/b.md'), inc('.DS_Store', 'x', 'Boveda/.DS_Store')]);
    expect(g.files.map((f) => f.path)).toEqual(['decks/a.md', 'notes/b.md']);
  });

  it('carpeta de notas sueltas conserva subcarpetas', async () => {
    const g = await gather([inc('b.md', 'b', 'Obsidian/Cardio/b.md')]);
    expect(g.files.map((f) => f.path)).toEqual(['notes/Obsidian/Cardio/b.md']);
  });

  it('detecta iguales y conflictos; omitir, reemplazar, duplicar', async () => {
    const v = new SafeVault(new MemoryBackend());
    await v.write('notes/a.md', 'A');
    await v.write('notes/b.md', 'B');
    await v.write('notes/c.md', 'C');
    const plan = await buildPlan(v, [
      { path: 'notes/a.md', data: strToU8('A') },
      { path: 'notes/b.md', data: strToU8('B2') },
      { path: 'notes/c.md', data: strToU8('C2') },
      { path: 'notes/d.md', data: strToU8('D') },
    ]);
    expect(plan.map((p) => p.status)).toEqual(['same', 'conflict', 'conflict', 'new']);
    const res = await applyPlan(v, plan, (i) => (i.path === 'notes/b.md' ? 'replace' : 'duplicate'));
    expect(res.written.sort()).toEqual(['notes/b.md', 'notes/c (2).md', 'notes/d.md']);
    expect(await readText(v, 'notes/b.md')).toBe('B2');
    expect(await readText(v, 'notes/c.md')).toBe('C');
    const res2 = await applyPlan(v, await buildPlan(v, [{ path: 'notes/c.md', data: strToU8('C3') }]), () => 'omit');
    expect(res2.skipped).toEqual(['notes/c.md']);
    await undoImport(v, res);
    expect((await walk(v)).map((f) => f.path)).toEqual(['notes/a.md', 'notes/b.md', 'notes/c.md']);
    expect(await readText(v, 'notes/b.md')).toBe('B');
  });
});

describe('importar zip sin extensión', () => {
  it('reconoce el zip por su firma', async () => {
    const z = zipSync({ 'notes/a.md': strToU8('a') });
    const g = await gather([inc('6b95-uuid', z)]);
    expect(g.files.map((f) => f.path)).toEqual(['notes/a.md']);
  });
});

import { guessMapping, parseCSV, rowsToBlocks } from '../src/io/csv';
describe('CSV de tarjetas', () => {
  it('comillas, saltos y tipos', () => {
    const rows = parseCSV('pregunta,respuesta,tipo\n"¿Uno, dos?","Sí ""claro""",\nLa {{c1::FA}},,cloze\nIda,Vuelta,inversa\n');
    expect(rows[1]).toEqual(['¿Uno, dos?', 'Sí "claro"', '']);
    const m = guessMapping(rows);
    expect(m).toMatchObject({ header: true, front: 0, back: 1, type: 2 });
    const b = rowsToBlocks(rows, m);
    expect(b.map((x) => x.block.split('::')[0])).toEqual(['Q', 'Cloze: La {{c1', 'QR']);
    expect(b.every((x) => !x.error)).toBe(true);
  });
  it('TSV sin encabezado', () => {
    const rows = parseCSV('a\tb\nc\t\n');
    const b = rowsToBlocks(rows, guessMapping(rows));
    expect(b[0]!.block).toBe('Q:: a\nA:: b');
    expect(b[1]!.error).toBe('Fila sin respuesta');
  });
});
