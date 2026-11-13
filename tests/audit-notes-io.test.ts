// @vitest-environment jsdom
/**
 * Auditoría etapa 2.3 · src/notes, src/sim, src/io, src/md, src/share, src/tasks, src/stickies, src/ink, src/pdf.
 * Cada `it.fails` demuestra un error que EXISTE hoy: la suite sigue en verde mientras el error exista.
 * auditoría: cambiar a it() al corregir.
 */
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { clearFormat } from '../src/notes/format';
import { classNoteFromPlaud, plaudGroupKey, srtToText, suggestPlace } from '../src/notes/model';
import { rewriteNoteRefs } from '../src/notes/move';
import { compatibleMarkdown } from '../src/notes/io';
import { noteStore } from '../src/notes/store';
import { saveImage } from '../src/notes/images';
import { plainText, renderMarkdown } from '../src/md/render';
import { finalize, isCorrect, parseBankJSON, parseText, qid, serializeBank } from '../src/sim/parse';
import { parseCSV } from '../src/io/csv';
import { gather, placeLoose } from '../src/io/import';
import { convertApkg, fieldToMd, type SqlJs } from '../src/io/apkg';
import { parseTasks } from '../src/tasks/parse';
import { stickyTitle } from '../src/stickies/model';
import { outline, parseInk, svgPath } from '../src/ink/model';
import { readMeta, updatePdfMeta, PDF_META } from '../src/pdf/library';
import { MemoryBackend } from '../src/vault/memory';
import { readText } from '../src/vault/util';

class Flaky extends MemoryBackend {
  failRead: string | null = null;
  override async read(p: string) { if (this.failRead === p) { this.failRead = null; throw new Error('lectura transitoria'); } return super.read(p); }
}

describe('auditoría · notas', () => {
  // auditoría: corregido (plan 11)
  it('mover una nota suelta no convierte [[Título]] en [[Materia/Título]] (el resolvedor solo conoce títulos)', () => {
    expect(rewriteNoteRefs('ver [[Nota]]', 'notes/Nota.md', 'notes/Cardio/Nota.md')).toBe('ver [[Nota]]');
  });
  // auditoría: corregido (plan 1)
  it('noteStore.load: una lectura fallida no se cachea como "" (si no, teclear pisa la nota)', async () => {
    const be = new Flaky();
    await be.write('notes/audit-store.md', 'contenido valioso');
    be.failRead = 'notes/audit-store.md';
    const first = await noteStore.load(be, 'notes/audit-store.md').catch(() => null);
    expect(first).not.toBe('');
  });
  // auditoría: corregido (menores)
  it('clearFormat no borra «==» ni «++» que no son marcas (a == b, C++)', () => {
    const t = 'a == b y C++ ok';
    expect(clearFormat({ text: t, s: 0, e: t.length }).text).toBe(t);
  });
  // auditoría: corregido (menores)
  it('compatibleMarkdown convierte también ![[foto.jpg|300|izq]] (embed con opciones)', () => {
    const out = compatibleMarkdown('![[foto.jpg|300|izq]]', { links: true, colors: 'keep' });
    expect(out).not.toContain('![[');
  });
  // auditoría: corregido (menores)
  it('compatibleMarkdown convierte [[Nota#Sección]] y [[Nota#Sec|alias]]', () => {
    expect(compatibleMarkdown('[[Nota#Sec]] [[Nota#Sec|alias]]', { links: true, colors: 'keep' })).not.toContain('[[');
  });
  // auditoría: corregido (menores)
  it('suggestPlace: un tema vacío («Sin tema») no suma puntos a cualquier nombre', () => {
    expect(suggestPlace('Pediatría clase 3', [{ materia: 'Cardio', temas: [{ tema: '', notes: [] }] }])).toBeNull();
  });
  // auditoría: corregido (menores)
  it('classNoteFromPlaud usa la fecha LOCAL (no UTC) para el campo fecha', () => {
    const prev = process.env.TZ;
    process.env.TZ = 'America/Mexico_City';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-14T03:00:00Z')); // 21:00 del 13 en CDMX
    try {
      expect(classNoteFromPlaud('T', []) ).toContain('fecha: 2026-11-13');
    } finally {
      vi.useRealTimers();
      if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
    }
  });
  // auditoría: corregido (menores)
  it('srtToText conserva una línea de transcripción que es solo un número', () => {
    expect(srtToText('1\n00:00:01,000 --> 00:00:02,000\n120\n')).toBe('120');
  });
  // auditoría: corregido (menores)
  it('plaudGroupKey no corta palabras que contienen «audio»/«notes»', () => {
    expect(plaudGroupKey('Audiología.mp3')).toBe('audiología');
  });
  // auditoría: corregido (menores)
  it('saveImage: dos imágenes con el mismo nombre en el mismo instante no comparten ruta', async () => {
    const be = new MemoryBackend();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      const a = await saveImage(be, new Blob([new Uint8Array([1])], { type: 'image/png' }), 'image.png');
      const b = await saveImage(be, new Blob([new Uint8Array([2])], { type: 'image/png' }), 'image.png');
      expect(a).not.toBe(b);
    } finally { spy.mockRestore(); }
  });
});

describe('auditoría · md', () => {
  // auditoría: corregido (menores)
  it('[[Nota#Sección]] enlaza a «Nota» (la ruta del enlace no incluye el ancla)', () => {
    expect(renderMarkdown('[[Nota#Sec]]')).toContain('data-wl="Nota"');
  });
  // auditoría: corregido (menores)
  it('plainText no borra _ = > de texto normal (snake_case, x = 5)', () => {
    expect(plainText('snake_case x = 5')).toBe('snake_case x = 5');
  });
});

describe('auditoría · simulacros', () => {
  // auditoría: corregido (menores)
  it('una lista numerada dentro de «Explicación:» no crea preguntas nuevas', () => {
    const qs = parseText('1. ¿Cuál?\n A) uno*\n B) dos\n Explicación: pasos:\n 2. primero\n 3. segundo\n');
    expect(qs).toHaveLength(1);
  });
  // auditoría: corregido (menores)
  it('una opción en negritas al final («**texto**») no se toma por la marca de correcta', () => {
    const [q] = parseText('1. ¿Cuál?\n A) **Aspirina**\n B) otra\n Respuesta: B\n');
    expect(q!.options[0]!.text).toBe('**Aspirina**');
  });
  // auditoría: corregido (menores)
  it('serializar y volver a leer no pega el caso anterior a una pregunta sin caso', () => {
    const a = finalize({ n: 1, case: 'Caso X', text: 'P1', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }], answer: ['A'], explanation: '', topic: '' });
    const b = finalize({ n: 2, case: '', text: 'P2', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }], answer: ['A'], explanation: '', topic: '' });
    const back = parseText(serializeBank({ name: 'x', minutes: 10, shuffle: false, questions: [a, b] }).replace(/^---[\s\S]*?---\n/, ''));
    expect(back[1]!.case).toBe('');
  });
  // auditoría: corregido (menores)
  it('dos preguntas idénticas no comparten id (la puntuación contaría la respuesta dos veces)', () => {
    const qs = parseText('1. Igual\n A) a*\n B) b\n\n2. Igual\n A) a*\n B) b\n');
    expect(qs[0]!.id).not.toBe(qs[1]!.id);
  });
  // auditoría: corregido (menores)
  it('qid distingue preguntas que solo difieren en un emoji', () => {
    expect(qid('😀', [])).not.toBe(qid('😁', []));
  });
  // auditoría: corregido (menores)
  it('isCorrect rechaza respuestas con letras repetidas ([A,A] frente a [A,B])', () => {
    const q = finalize({ n: 1, case: '', text: 'x', options: [{ key: 'A', text: 'a' }, { key: 'B', text: 'b' }], answer: ['A', 'B'], explanation: '', topic: '' });
    expect(isCorrect(q, ['A', 'A'])).toBe(false);
  });
  // auditoría: corregido (menores)
  it('JSON con más de 6 opciones no genera claves undefined', () => {
    const qs = parseBankJSON(JSON.stringify([{ pregunta: 'p', opciones: ['1', '2', '3', '4', '5', '6', '7'], correcta: 'A' }]));
    expect(qs[0]!.options.every((o) => typeof o.key === 'string' && o.key)).toBe(true);
  });
});

describe('auditoría · io', () => {
  // auditoría: cambiar a it() al corregir
  it.fails('parseCSV no cuenta las comas DENTRO de comillas al elegir el separador', () => {
    expect(parseCSV('"Dosis: 5, 10 y 20";"Respuesta"\n"a";"b"')[0]).toEqual(['Dosis: 5, 10 y 20', 'Respuesta']);
  });
  // auditoría: cambiar a it() al corregir
  it.fails('placeLoose normaliza la extensión .MD (si no, la nota no aparece en listNotes)', () => {
    expect(placeLoose('Clase.MD', strToU8('hola')).endsWith('.md')).toBe(true);
  });
  // auditoría: corregido (plan 3)
  it('importar un zip no admite .app/journal.json ni .app/tmp/* (los repetiría el arranque de SafeVault)', async () => {
    const z = zipSync({ 'notes/a.md': strToU8('# a'), '.app/journal.json': strToU8('{"v":1,"entries":[]}'), '.app/tmp/x': strToU8('x') });
    const g = await gather([{ name: 'v.zip', bytes: async () => z }]);
    expect(g.files.map((f) => f.path).filter((p) => p.startsWith('.app/'))).toEqual([]);
  });
  // auditoría: corregido (plan 12)
  it('fieldToMd decodifica &#x27; y &apos;', () => {
    expect(fieldToMd('it&#x27;s &apos;ok&apos;', new Set())).toBe("it's 'ok'");
  });
});

async function sql(): Promise<SqlJs> {
  const init = (await import('sql.js')).default as unknown as () => Promise<SqlJs>;
  return init();
}
async function apkg(media: Record<string, string>, fields: string[], decks: Record<number, string>): Promise<Uint8Array> {
  const SQL = await sql();
  const db = new SQL.Database() as unknown as { run(s: string, p?: unknown[]): void; export(): Uint8Array };
  db.run('CREATE TABLE col (id integer, models text, decks text)');
  db.run('CREATE TABLE notes (id integer, mid integer, flds text, tags text)');
  db.run('CREATE TABLE cards (id integer, nid integer, did integer, ord integer)');
  db.run('CREATE TABLE revlog (id integer, cid integer, ease integer, time integer, type integer)');
  db.run('INSERT INTO col VALUES (1, ?, ?)', [JSON.stringify({ 10: { type: 0, name: 'Básico' } }), JSON.stringify(Object.fromEntries(Object.entries(decks).map(([k, v]) => [k, { name: v }])))]);
  fields.forEach((f, i) => {
    db.run('INSERT INTO notes VALUES (?, 10, ?, ?)', [1000 + i, f, '']);
    db.run('INSERT INTO cards VALUES (?, ?, ?, 0)', [i + 1, 1000 + i, Number(Object.keys(decks)[i % Object.keys(decks).length])]);
  });
  const files: Record<string, Uint8Array> = { 'collection.anki2': db.export(), media: strToU8(JSON.stringify(media)) };
  Object.keys(media).forEach((k) => { files[k] = new Uint8Array([1, 2, 3]); });
  return zipSync(files);
}

describe('auditoría · apkg (mapeo)', () => {
  // auditoría: corregido (plan 12)
  it('el nombre de un medio con caracteres prohibidos coincide en la tarjeta y en el archivo guardado', async () => {
    const r = convertApkg(await apkg({ 0: 'a:b?.png' }, ['q<br><img src="a:b?.png">\x1fr'], { 5: 'Mazo' }), await sql());
    const ref = /!\[\[([^\]]+)\]\]/.exec(r.decks[0]!.text)![1]!;
    expect(r.media.map((m) => m.name)).toContain(ref);
  });
  // auditoría: corregido (plan 12)
  it('dos mazos de Anki que se sanean al mismo nombre no producen la misma ruta', async () => {
    const r = convertApkg(await apkg({}, ['uno\x1fa', 'dos\x1fb'], { 5: 'A:B', 6: 'A B' }), await sql());
    const paths = r.decks.map((d) => d.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('auditoría · tareas, stickies, tinta, pdf', () => {
  // auditoría: cambiar a it() al corregir
  it.fails('parseTasks lee un archivo con saltos CRLF', () => {
    expect(parseTasks('- [ ] a\r\n- [x] b\r\n')).toHaveLength(2);
  });
  // auditoría: cambiar a it() al corregir
  it.fails('stickyTitle conserva _ y + del texto (snake_case, C++)', () => {
    expect(stickyTitle('C++ y mi_variable', 'x')).toBe('C++ y mi_variable');
  });
  // auditoría: cambiar a it() al corregir
  it.fails('stickyTitle no parte un emoji al recortar a 60', () => {
    const t = stickyTitle('a'.repeat(59) + '😀😀', 'x');
    expect(/[\ud800-\udbff]$/.test(t)).toBe(false);
  });
  // auditoría: cambiar a it() al corregir
  it.fails('parseInk descarta trazos sin size/tool (si no, el contorno sale con NaN)', () => {
    const d = parseInk('{"v":1,"strokes":[{"id":"a","pts":[[0,0,1],[0.5,0.5,1],[1,1,1]]}]}');
    const bad = d.strokes.some((s) => svgPath(outline(s, 600)).includes('NaN'));
    expect(bad).toBe(false);
  });
  // auditoría: corregido (plan 1)
  it('updatePdfMeta con una lectura fallida no borra los metadatos de los demás PDF', async () => {
    const be = new Flaky();
    await be.write(PDF_META, JSON.stringify({ 'docs/a.pdf': { tags: ['x'] }, 'docs/b.pdf': { tags: ['y'] } }));
    be.failRead = PDF_META;
    await updatePdfMeta(be, 'docs/a.pdf', { last: 3 }).catch(() => {});
    const now = JSON.parse(await readText(be, PDF_META)) as Record<string, unknown>;
    expect(now['docs/b.pdf']).toBeDefined();
    expect(await readMeta(be)).toBeDefined();
  });
});
