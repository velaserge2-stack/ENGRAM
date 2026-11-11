import { zipSync, strToU8 } from 'fflate';
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
