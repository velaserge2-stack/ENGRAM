import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseDeck } from '../src/cards/parse';
import { ankiId, deckNameOf, guidFrom, mapDeck, mediaName, MODELS, sha1 } from '../src/io/apkgexport/map';

const DECK = `---
nombre: x
---
Q:: ¿Capital?
A:: **México** ^aaa01

QR:: perro
A:: dog ^aaa02

Cloze: La {{c1::mitosis}} y la {{c2::meiosis::pista}} ^aaa03

L:: Colores
- rojo
- verde ^aaa04

MC:: ¿2+2?
- [ ] 3
- [x] 4
A:: fácil ^aaa05

MATCH:: Une
- a => 1
- b => 2 ^aaa06

ORD:: Orden
1. uno
2. dos ^aaa07

T:: Escribe
A:: hola ^aaa08

IO: ![[mapa.png|300]]
<!-- io: 1,2,3,4;5,6,7,8 --> ^aaa09

Q:: sin id
A:: x
`;
const run = () => mapDeck('Bio::Cel', parseDeck(DECK));

describe('apkgexport/map', () => {
  it('SHA-1 coincide con node:crypto', () => {
    for (const s of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'ñ'.repeat(100)]) {
      expect([...sha1(s)]).toEqual([...createHash('sha1').update(s).digest()]);
    }
  });

  it('mapea por tipo', () => {
    const r = run();
    const by = Object.fromEntries(r.notes.map((n) => [n.src, n]));
    expect(by.aaa01!.model).toBe('basic');
    expect(by.aaa01!.fields).toEqual(['¿Capital?', '<strong>México</strong>']);
    expect(by.aaa02!.model).toBe('reversed');
    expect(by.aaa02!.cards.map((c) => c.ord)).toEqual([0, 1]);
    expect(by.aaa03!.model).toBe('cloze');
    expect(by.aaa03!.fields[0]).toBe('La {{c1::mitosis}} y la {{c2::meiosis::pista}}');
    expect(by.aaa03!.cards.map((c) => c.ord)).toEqual([0, 1]);
    expect(by.aaa04!.fields[1]).toBe('<ul><li>rojo</li><li>verde</li></ul>');
    expect(by.aaa05!.fields[0]).toContain('<li>3</li>');
    expect(by.aaa05!.fields[1]).toContain('<li>4</li>');
    expect(by.aaa06!.fields[1]).toContain('a → 1');
    expect(by.aaa07!.fields[1]).toMatch(/^<ol>/);
    expect(by.aaa09!.fields[0]).toBe('<img src="mapa.png">');
    expect(r.notes).toHaveLength(9); // la de sin id no se exporta
    expect(r.skipped).toBe(1);
    expect(MODELS.cloze.fields).toEqual(['Text', 'Back Extra']);
  });

  it('cuenta las convertidas', () => {
    expect(run().converted).toEqual({ list: 1, mc: 1, match: 1, order: 1, type: 1, io: 1 });
  });

  it('ids y guid estables, únicos y válidos', () => {
    const a = run();
    const b = run();
    expect(JSON.stringify(a.notes)).toBe(JSON.stringify(b.notes));
    const ids = [a.deckId, ...a.notes.flatMap((n) => [n.id, ...n.cards.map((c) => c.id)])];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id > 1.4e12 && id < 1.8e12 && Number.isInteger(id)).toBe(true);
    const g = guidFrom('aaa01');
    expect(g).toHaveLength(10);
    expect(g).toBe(guidFrom('aaa01'));
    expect(g).not.toBe(guidFrom('aaa02'));
    const used = new Set<number>();
    expect(ankiId('x', used)).not.toBe(ankiId('x', used));
  });

  it('checksum como Anki', () => {
    const n = run().notes[0]!;
    expect(n.sfld).toBe('¿Capital?');
    expect(n.csum).toBe(parseInt(createHash('sha1').update('¿Capital?').digest('hex').slice(0, 8), 16));
  });

  it('escapa HTML y enlaces peligrosos', () => {
    const d = parseDeck('Q:: <script>alert(1)</script> <img src=x onerror=alert(1)>\nA:: [clic](javascript:alert(1)) y [ok](https://a.b) <b onclick="x">b</b> ^e01\n');
    const [f, b] = mapDeck('D', d).notes[0]!.fields;
    expect(f).not.toContain('<script');
    expect(f).toContain('&lt;script&gt;');
    expect(f).not.toMatch(/<img/);
    expect(b).not.toContain('href="javascript');
    expect(b).toContain('href="https://a.b"');
    expect(b).not.toMatch(/<b onclick/);
  });

  it('nombres de media hostiles', () => {
    for (const h of ['../../etc/passwd', 'a/b.png', 'x\0y.png', 'a\\b\\..\\c.jpg', '..', '.png', 'a:b|c?.png']) {
      const s = mediaName(h);
      expect(s).not.toMatch(/[\\/\0:|?*<>]|\.\./);
      expect(s.length).toBeGreaterThan(0);
      expect(s).toBe(mediaName(h));
    }
    expect(mediaName('foto.png')).toBe('foto.png');
    expect(mediaName('a/b.png')).toMatch(/^b-[0-9a-f]{6}\.png$/);
    expect(mediaName('a/b.png')).not.toBe(mediaName('c/b.png'));
  });

  it('medios: ![[ ]] y ![]() → <img>, con mapa original→saneado', () => {
    const d = parseDeck('Q:: ![[foto.png|300|izq|alt Un gato]] y ![x](media/bc.jpg) ![[../../evil.png]] ![[a.mp3]]\nA:: ok ^m01\n');
    const r = mapDeck('D', d);
    const [f] = r.notes[0]!.fields;
    expect(f).toContain('<img src="foto.png" alt="Un gato">');
    expect(f).toContain('<img src="bc.jpg" alt="x">');
    expect(f).toContain('[sound:a.mp3]');
    expect(f).not.toContain('..');
    expect(r.media.get('foto.png')).toBe('foto.png');
    expect(r.media.get('../../evil.png')).toMatch(/^evil-[0-9a-f]{6}\.png$/);
    expect(r.notes[0]!.media).toHaveLength(4);
  });

  it('nombre de mazo', () => {
    expect(deckNameOf('decks/Bio/Cel: "A".md')).toBe("Bio::Cel- 'A'");
    expect(deckNameOf('decks/Mazo.md')).toBe('Mazo');
  });
});
