import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { convertApkg, fieldToMd, type SqlJs } from '../src/io/apkg';
import { parseDeck, cardsOf } from '../src/cards/parse';
import { replay, DEFAULT_PARAMS } from '../src/srs/engine';

async function sql(): Promise<SqlJs> {
  const init = (await import('sql.js')).default as unknown as () => Promise<SqlJs>;
  return init();
}

async function fakeApkg(): Promise<Uint8Array> {
  const SQL = await sql();
  const db = new SQL.Database() as unknown as { run(s: string, p?: unknown[]): void; export(): Uint8Array; exec(s: string): unknown };
  db.run('CREATE TABLE col (id integer, models text, decks text)');
  db.run('CREATE TABLE notes (id integer, mid integer, flds text, tags text)');
  db.run('CREATE TABLE cards (id integer, nid integer, did integer, ord integer)');
  db.run('CREATE TABLE revlog (id integer, cid integer, ease integer, time integer, type integer)');
  db.run('INSERT INTO col VALUES (1, ?, ?)', [JSON.stringify({ 10: { type: 0, name: 'Básico' }, 11: { type: 1, name: 'Cloze' } }), JSON.stringify({ 5: { name: 'Medicina::Cardio' } })]);
  db.run('INSERT INTO notes VALUES (1001, 10, ?, ?)', ['¿Pared inferior?<br>\x1fII, III y <b>aVF</b> <img src="ecg.png">', ' ecg urgencias::uci ']);
  db.run('INSERT INTO notes VALUES (1002, 11, ?, ?)', ['La {{c1::FA}} no tiene {{c2::ondas P}}\x1f', '']);
  db.run('INSERT INTO cards VALUES (1, 1001, 5, 0)');
  db.run('INSERT INTO cards VALUES (2, 1002, 5, 0)');
  db.run('INSERT INTO cards VALUES (3, 1002, 5, 1)');
  db.run('INSERT INTO revlog VALUES (1700000000000, 1, 3, 8000, 0)');
  db.run('INSERT INTO revlog VALUES (1700086400000, 1, 3, 5000, 1)');
  db.run('INSERT INTO revlog VALUES (1700000000000, 3, 1, 90000, 0)');
  return zipSync({ 'collection.anki2': db.export(), media: strToU8(JSON.stringify({ 0: 'ecg.png' })), 0: new Uint8Array([1, 2, 3]) });
}

describe('importar .apkg', () => {
  it('convierte notas, cloze, mazos, medios e historial', async () => {
    const r = convertApkg(await fakeApkg(), await sql());
    expect(r.decks.map((d) => d.path)).toEqual(['decks/Medicina/Cardio.md']);
    const p = parseDeck(r.decks[0]!.text);
    expect(p.data).toMatchObject({ deck: 'Cardio', tags: ['ecg', 'urgencias/uci'], origen: 'anki' });
    expect(p.notes.map((n) => n.type)).toEqual(['basic', 'cloze']);
    expect(p.notes[0]!.back).toBe('II, III y **aVF** ![[ecg.png]]');
    expect(p.notes.flatMap(cardsOf).map((c) => c.cid)).toEqual(['art', 'aru:c1', 'aru:c2']);
    expect(r.media).toEqual([{ name: 'ecg.png', data: new Uint8Array([1, 2, 3]) }]);
    expect(r.log.map((e) => [e.id, e.rating, e.state, e.ms])).toEqual([['art', 3, 0, 8000], ['aru:c2', 1, 0, 60000], ['art', 3, 2, 5000]]);
    expect(replay(r.log, DEFAULT_PARAMS).get('art')!.card.reps).toBe(2);
  });
  it('rechaza paquetes no válidos', async () => {
    expect(() => convertApkg(zipSync({ x: new Uint8Array(1) }), {} as SqlJs)).toThrow(/no es un paquete/i);
    expect(fieldToMd('a&nbsp;&amp;<div>b</div>[sound:x.mp3]', new Set())).toBe('a &b\n![[x.mp3]]');
  });
});

// ───────── Prompt 10: formato nuevo de Anki (anki21b) ─────────
import { readFileSync } from 'node:fs';
import { zstdCompressSync } from 'node:zlib';
import { ApkgError, mediaEntries, metaVersion, pbFields, unzstd } from '../src/io/apkg';

const FIX = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/apkg/${n}`, import.meta.url)));
const zstd = (b: Uint8Array) => new Uint8Array(zstdCompressSync(b));
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as ApkgError).code; } return 'ok'; };

/** Paquetes reales de Anki (scripts/apkg-fixtures.py): mismo contenido en los tres formatos. */
describe('importar .apkg: legado, compatibilidad y formato nuevo', () => {
  for (const [file, format, schema] of [['legado.apkg', 'legacy', 'v11'], ['compat.apkg', 'compat', 'v11'], ['nuevo.apkg', 'new', 'v18']] as const) {
    it(`${file}: elige la colección real (${format}, esquema ${schema}), nunca el marcador falso`, async () => {
      const r = convertApkg(FIX(file), await sql(), true, 'Mis tarjetas.apkg');
      expect(r.info).toMatchObject({ format, schema, notes: 5, decks: 2, skippedEmpty: 1 });
      expect(r.decks.map((d) => d.path).sort()).toEqual(['decks/Medicina/Cardio/ECG.md', 'decks/Mis tarjetas.md']);
      const ecg = parseDeck(r.decks.find((d) => d.path.endsWith('ECG.md'))!.text);
      expect(ecg.data).toMatchObject({ deck: 'ECG', origen: 'anki', tags: expect.arrayContaining(['ecg', 'urgencias/uci']) });
      expect(ecg.notes.map((n) => n.type)).toEqual(['basic', 'cloze', 'reverse']);
      expect(ecg.notes[0]!.back).toContain('![[eje.png]]');
      expect(ecg.notes.flatMap(cardsOf).length).toBe(1 + 2 + 2);
      expect(r.decks.every((d) => !d.text.includes('Please update'))).toBe(true);
      expect(r.media.map((m) => m.name)).toEqual(['eje.png']);
      expect(r.media[0]!.data.slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47])); // PNG real (descomprimido)
      // historial: un repaso por tarjeta importada (la de la nota vacía no)
      expect(r.log.length).toBe(1 + 2 + 2 + 1);
      expect(r.log.every((e) => e.src === 'anki' && (e.rating ?? 0) >= 1 && (e.rating ?? 0) <= 4 && (e.ms ?? 0) <= 60_000)).toBe(true);
      const ids = new Set(ecg.notes.flatMap(cardsOf).map((c) => c.cid).concat(parseDeck(r.decks.find((d) => d.path.endsWith('tarjetas.md'))!.text).notes.flatMap(cardsOf).map((c) => c.cid)));
      expect(r.log.every((e) => ids.has(e.id))).toBe(true);
      expect(r.warnings.join(' ')).toMatch(/1 notas omitidas por estar vacías/);
      expect(r.warnings[0]).toMatch(new RegExp(`Esquema Anki ${schema}: 5 notas, 2 mazos, 1 medios`));
    });
  }

  it('solo el marcador falso (anki21b ilegible): error «formato nuevo», no una nota inútil', async () => {
    const z = unzipSync(FIX('nuevo.apkg'));
    const onlyFake = zipSync({ 'collection.anki2': z['collection.anki2']!, meta: z['meta']!, media: z['media']! });
    const SQL = await sql();
    expect(code(() => convertApkg(onlyFake, SQL))).toBe('new-format');
    const broken = zipSync({ ...z, 'collection.anki21b': new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 1, 2, 3]) });
    expect(code(() => convertApkg(broken, SQL))).toBe('new-format');
  });

  it('anki21 comprimido con zstd también se abre', async () => {
    const z = unzipSync(FIX('compat.apkg'));
    const r = convertApkg(zipSync({ ...z, 'collection.anki21': zstd(z['collection.anki21']!) }), await sql());
    expect(r.info?.format).toBe('compat');
    expect(r.decks.length).toBe(2);
  });

  it('paquetes no válidos: basura, zip sin colección, corrupto, vacío y sin notas', async () => {
    const SQL = await sql();
    expect(code(() => convertApkg(FIX('basura.apkg'), SQL))).toBe('invalid');
    expect(code(() => convertApkg(zipSync({ x: new Uint8Array(1) }), SQL))).toBe('invalid');
    expect(code(() => convertApkg(zipSync({ 'collection.anki2': strToU8('SQLite format 3\0basura basura basura') }), SQL))).toMatch(/corrupt|new-format/);
    const empty = new SQL.Database() as unknown as { run(s: string): void; export(): Uint8Array };
    empty.run('CREATE TABLE notes (id integer, mid integer, flds text, tags text)');
    empty.run('CREATE TABLE cards (id integer, nid integer, did integer, ord integer)');
    expect(code(() => convertApkg(zipSync({ 'collection.anki2': empty.export() }), SQL))).toBe('empty');
  });

  it('tope de descompresión zstd (bomba)', () => {
    const big = zstd(new Uint8Array(4 * 1024 * 1024)); // 4 MB de ceros → unos pocos bytes
    expect(big.length).toBeLessThan(2000);
    expect(unzstd(big).length).toBe(4 * 1024 * 1024);
    expect(() => unzstd(big, 1024 * 1024)).toThrow(/supera 1 MB/);
  });

  it('protobuf mínimo: meta y media nuevos', () => {
    expect(metaVersion(new Uint8Array([0x08, 0x03]))).toBe(3);
    expect(metaVersion(new Uint8Array([0x08, 0x02]))).toBe(2);
    expect(metaVersion(undefined)).toBe(0);
    expect(metaVersion(new Uint8Array([0xff]))).toBe(0);
    // MediaEntries { entries: [{ name: "a.png", size: 3 }, { name: "b.mp3", legacy_zip_filename: 7 }] }
    const entry = (name: string, extra: number[] = []) => [0x0a, name.length, ...[...name].map((c) => c.charCodeAt(0)), ...extra];
    const e1 = entry('a.png', [0x10, 3]), e2 = entry('b.mp3', [0xf8, 0x0f, 7]);
    const buf = new Uint8Array([0x0a, e1.length, ...e1, 0x0a, e2.length, ...e2]);
    expect(mediaEntries(buf)).toEqual([{ name: 'a.png', zip: '0' }, { name: 'b.mp3', zip: '7' }]);
    expect(() => pbFields(new Uint8Array([0x0a, 0x09, 1]))).toThrow();
  });

  it('medios con rutas peligrosas se renombran y los ilegibles se omiten con aviso', async () => {
    const z = unzipSync(FIX('legado.apkg'));
    const r = convertApkg(zipSync({ ...z, media: strToU8(JSON.stringify({ 0: '../../etc/passwd', 1: '..\\x.png' })), 1: new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 9, 9]) }), await sql());
    expect(r.media.map((m) => m.name)).toEqual(['__.._etc_passwd']);
    expect(r.media.every((m) => !m.name.includes('/') && !m.name.startsWith('.'))).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/1 medios no se pudieron descomprimir/);
  });

  it('esquema v18: nombres jerárquicos con \\x1f y cloze por config del tipo de nota', async () => {
    const r = convertApkg(FIX('nuevo.apkg'), await sql());
    expect(r.decks.some((d) => d.path === 'decks/Medicina/Cardio/ECG.md')).toBe(true);
    const cl = parseDeck(r.decks.find((d) => d.path.endsWith('ECG.md'))!.text).notes.find((n) => n.type === 'cloze')!;
    expect(cl.clozes).toEqual([1, 2]);
  });
});
