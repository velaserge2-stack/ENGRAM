import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { convertApkg, type SqlJs } from '../src/io/apkg';
import { parseDeck } from '../src/cards/parse';
import { mapDeck, MODELS } from '../src/io/apkgexport/map';
import { ApkgExportError, buildApkg } from '../src/io/apkgexport/write';
import { LIMITS } from '../src/io/limits';

async function sql(): Promise<SqlJs> {
  const init = (await import('sql.js')).default as unknown as () => Promise<SqlJs>;
  return init();
}

const A = `Q:: ¿Capital?
A:: **México** ![[foto.png]] ^aaa01

QR:: perro
A:: dog ^aaa02

Cloze: La {{c1::mitosis}} y la {{c2::meiosis}} ^aaa03

L:: Colores
- rojo
- verde ^aaa04

Q:: sin id
A:: x
`;
const B = `Q:: Hola ![[falta.png]]
A:: mundo ^bbb01
`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const NOW = 1_750_000_000_000;

async function build(extra: Partial<Parameters<typeof buildApkg>[0]> = {}) {
  const used = new Set<number>();
  const decks = [mapDeck('Bio::Cel', parseDeck(A), { used }), mapDeck('Idiomas', parseDeck(B), { used })];
  const SQL = await sql();
  const progress: string[] = [];
  const out = await buildApkg({ SQL, decks, readMedia: (n) => (n === 'foto.png' ? PNG : undefined), now: NOW, onProgress: (p) => progress.push(p.phase), ...extra });
  return { ...out, SQL, decks, progress };
}
const q = (SQL: SqlJs, coll: Uint8Array, s: string) => {
  const db = new SQL.Database(coll);
  try { return db.exec(s)[0]?.values ?? []; } finally { db.close(); }
};

describe('apkgexport/write', () => {
  it('estructura del zip, tablas y conteos', async () => {
    const { bytes, stats, SQL, progress } = await build();
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(['0', 'collection.anki2', 'media']);
    expect(JSON.parse(strFromU8(files.media!))).toEqual({ 0: 'foto.png' });
    expect([...files['0']!]).toEqual([...PNG]);
    expect(stats).toMatchObject({ decks: 2, notes: 5, cards: 7, media: 1, revlog: 0, skipped: 1, missingMedia: 1, converted: { list: 1 } });
    expect(progress).toContain('zip');
    const coll = files['collection.anki2']!;
    const tables = q(SQL, coll, "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map((r) => r[0]);
    expect(tables).toEqual(['cards', 'col', 'graves', 'notes', 'revlog']);
    expect(q(SQL, coll, "SELECT count(*) FROM sqlite_master WHERE type='index' AND name LIKE 'ix_%'")[0]![0]).toBe(7);
    const cols = q(SQL, coll, 'PRAGMA table_info(cards)').map((r) => r[1]);
    expect(cols).toEqual(['id', 'nid', 'did', 'ord', 'mod', 'usn', 'type', 'queue', 'due', 'ivl', 'factor', 'reps', 'lapses', 'left', 'odue', 'odid', 'flags', 'data']);
    expect(q(SQL, coll, 'SELECT ord FROM cards ORDER BY id').map((r) => r[0]).sort()).toEqual([0, 0, 0, 0, 0, 1, 1]);
    expect(q(SQL, coll, 'SELECT DISTINCT type, queue, usn FROM cards')).toEqual([[0, 0, -1]]);
    expect(q(SQL, coll, 'SELECT due FROM cards ORDER BY due').map((r) => r[0])).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const [ver, conf, models, decks, dconf, tags] = q(SQL, coll, 'SELECT ver, conf, models, decks, dconf, tags FROM col')[0]!;
    expect(ver).toBe(11);
    expect(JSON.parse(String(conf)).nextPos).toBe(8);
    const m = JSON.parse(String(models));
    expect(m[MODELS.reversed.id].tmpls).toHaveLength(2);
    expect(m[MODELS.cloze.id].type).toBe(1);
    expect(Object.values(JSON.parse(String(decks))).map((d) => (d as { name: string }).name).sort()).toEqual(['Bio', 'Bio::Cel', 'Default', 'Idiomas']);
    expect(JSON.parse(String(dconf))[1].id).toBe(1);
    expect(JSON.parse(String(tags))).toEqual({});
    const fl = q(SQL, coll, `SELECT flds FROM notes WHERE mid = ${MODELS.basic.id} ORDER BY id`).map((r) => String(r[0]));
    expect(fl.some((f) => f.includes('\x1f') && f.includes('<img src="foto.png">'))).toBe(true);
  });

  it('sqlite3 de Python: integrity_check = ok', async () => {
    const { bytes } = await build();
    const dir = mkdtempSync(join(tmpdir(), 'apkg-'));
    const p = join(dir, 'collection.anki2');
    writeFileSync(p, unzipSync(bytes)['collection.anki2']!);
    const r = spawnSync('python3', ['-I', '-c', 'import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);print(c.execute("PRAGMA integrity_check").fetchone()[0], c.execute("select count(*) from cards").fetchone()[0])', p], { encoding: 'utf8' });
    expect(r.stdout.trim()).toBe('ok 7');
  });

  it('mismo input → mismos ids y mismos bytes', async () => {
    const a = await build(), b = await build();
    expect(a.decks.map((d) => d.notes.map((n) => [n.id, n.cards.map((c) => c.id)]))).toEqual(b.decks.map((d) => d.notes.map((n) => [n.id, n.cards.map((c) => c.id)])));
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });

  it('sched y revlog sobrescriben', async () => {
    const used = new Set<number>();
    const decks = [mapDeck('Bio::Cel', parseDeck(A), { used })];
    const cid = decks[0]!.notes[0]!.cards[0]!.id;
    const { bytes, SQL, stats } = await build({ decks, sched: new Map([[cid, { type: 2, queue: 2, due: 30, ivl: 10, factor: 2500, reps: 4, lapses: 1 }]]), revlog: [{ id: NOW - 1000, cid, ease: 3, ivl: 10, lastIvl: 4, factor: 2500, time: 8000, type: 1 }] });
    const coll = unzipSync(bytes)['collection.anki2']!;
    expect(q(SQL, coll, `SELECT type, queue, due, ivl, factor, reps, lapses FROM cards WHERE id = ${cid}`)[0]).toEqual([2, 2, 30, 10, 2500, 4, 1]);
    expect(q(SQL, coll, 'SELECT cid, ease, usn FROM revlog')).toEqual([[cid, 3, -1]]);
    expect(stats.revlog).toBe(1);
    expect(convertApkg(bytes, SQL, true, 'x.apkg').log).toHaveLength(1);
  });

  it('ida y vuelta con convertApkg', async () => {
    const { bytes, SQL } = await build();
    const r = convertApkg(bytes, SQL, true, 'x.apkg');
    expect(r.info).toMatchObject({ format: 'legacy', schema: 'v11', notes: 5, cards: 7, media: 1 });
    expect(r.decks.map((d) => [d.path, d.cards]).sort()).toEqual([['decks/Bio/Cel.md', 6], ['decks/Idiomas.md', 1]]);
    expect(r.media.map((m) => m.name)).toEqual(['foto.png']);
    const cel = r.decks.find((d) => d.path === 'decks/Bio/Cel.md')!.text;
    expect(cel).toContain('Q:: ¿Capital?');
    expect(cel).toContain('México');
    expect(cel).toContain('![[foto.png]]');
    expect(cel).toContain('QR:: perro');
    expect(cel).toMatch(/Cloze: La \{\{c1::mitosis\}\} y la \{\{c2::meiosis\}\}/);
  });

  it('demasiado grande → apkg_export_too_big', async () => {
    const prev = LIMITS.maxApkgEntryBytes;
    LIMITS.maxApkgEntryBytes = 1 << 20; // la colección cabe; el medio no
    try {
      const big = new Uint8Array((1 << 20) + 1);
      await expect(build({ readMedia: () => big })).rejects.toThrow(ApkgExportError);
      await expect(build({ readMedia: () => big })).rejects.toThrow('apkg_export_too_big');
    } finally {
      LIMITS.maxApkgEntryBytes = prev;
    }
  });
});
