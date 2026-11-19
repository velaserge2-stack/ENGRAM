import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { convertApkg, type SqlJs } from '../src/io/apkg';
import { parseDeck } from '../src/cards/parse';
import { deckNameOf, mapDeck, mediaName } from '../src/io/apkgexport/map';
import { ApkgExportError, buildApkg } from '../src/io/apkgexport/write';

async function sql(): Promise<SqlJs> {
  return ((await import('sql.js')).default as unknown as () => Promise<SqlJs>)();
}
const NOW = 1_750_000_000_000;
const big = (n: number) => Array.from({ length: n }, (_, i) => `Q:: Pregunta ${i} ¿ñandú? 🧠\nA:: Respuesta ${i} con **negrita** y más texto de relleno ^k${i.toString(36).padStart(5, '0')}\n`).join('\n');

describe('exportador · casos extremos', () => {
  it('mazo vacío y un solo mazo', async () => {
    const SQL = await sql();
    const e = await buildApkg({ SQL, decks: [mapDeck('Vacío', parseDeck(''))], readMedia: () => undefined, now: NOW });
    expect(e.stats.cards).toBe(0);
    const one = await buildApkg({ SQL, decks: [mapDeck('Uno', parseDeck('Q:: a\nA:: b ^a0001\n'))], readMedia: () => undefined, now: NOW });
    const r = await convertApkg(one.bytes, SQL, false, 'x.apkg');
    expect(r.decks.length).toBe(1);
  });

  it('5000 tarjetas: ida y vuelta y bloqueo máximo entre cesiones', async () => {
    const SQL = await sql();
    const gaps: number[] = [];
    const deck = (() => { const a = performance.now(); const d = mapDeck('Gran', parseDeck(big(5000))); console.log('parse+map (hilo principal)', Math.round(performance.now() - a), 'ms'); return d; })();
    let last = performance.now();
    const orig = globalThis.setTimeout;
    (globalThis as { setTimeout: unknown }).setTimeout = ((f: () => void, ms?: number) => {
      const n = performance.now(); gaps.push(n - last);
      return orig(() => { last = performance.now(); f(); }, ms);
    }) as typeof setTimeout;
    let out;
    try {
      const t0 = performance.now();
      out = await buildApkg({ SQL, decks: [deck], readMedia: () => undefined, now: NOW });
      gaps.push(performance.now() - last);
      console.log('5000 tarjetas', Math.round(performance.now() - t0), 'ms; bloqueos máx', gaps.map((g) => g.toFixed(1)).sort((a, b) => +b - +a).slice(0, 4).join(', '));
    } finally { (globalThis as { setTimeout: unknown }).setTimeout = orig; }
    expect(out.stats.cards).toBe(5000);
    const r = await convertApkg(out.bytes, SQL, false, 'x.apkg');
    expect(r.decks[0]!.text.match(/Q::/g)!.length).toBe(5000);
  }, 60000);

  it('campo de 20 000 caracteres', async () => {
    const SQL = await sql();
    const txt = 'palabra ñ '.repeat(2000);
    const out = await buildApkg({ SQL, decks: [mapDeck('L', parseDeck(`Q:: ${txt}\nA:: ${txt} ^l0001\n`))], readMedia: () => undefined, now: NOW });
    const r = await convertApkg(out.bytes, SQL, false, 'x.apkg');
    expect(r.decks[0]!.text.length).toBeGreaterThan(20000);
  });

  it('nombres con emoji, acentos y :: ; JSON de col íntegro', async () => {
    const SQL = await sql();
    expect(deckNameOf('decks/Año 🧠/Cap: 1 "x"::y.md')).toBe('Año 🧠::Cap- 1 \'x\'--y');
    const used = new Set<number>();
    const names = ['Año 🧠::Cap "uno" \\ ñ', 'Default', '</script>&"\'<b>'];
    const decks = names.map((n, i) => mapDeck(n, parseDeck(`Q:: a${i}\nA:: b ^z000${i}\n`), { used }));
    const out = await buildApkg({ SQL, decks, readMedia: () => undefined, now: NOW });
    const db = new SQL.Database(unzipSync(out.bytes)['collection.anki2']!);
    const col = db.exec('SELECT decks, models FROM col')[0]!.values[0]!;
    db.close();
    const ds = Object.values(JSON.parse(col[0] as string) as Record<string, { name: string }>).map((d) => d.name);
    for (const n of names) expect(ds).toContain(n);
    expect(JSON.parse(col[1] as string)).toBeTruthy();
  });

  it('un mazo «Default» (o «default::x») se funde con el mazo 1 de Anki', async () => {
    const SQL = await sql();
    const used = new Set<number>();
    const decks = ['Default', 'default::Sub'].map((n, i) => mapDeck(n, parseDeck(`Q:: a${i}\nA:: b ^d000${i}\n`), { used }));
    const out = await buildApkg({ SQL, decks, readMedia: () => undefined, now: NOW });
    const db = new SQL.Database(unzipSync(out.bytes)['collection.anki2']!);
    const ds = Object.values(JSON.parse(db.exec('SELECT decks FROM col')[0]!.values[0]![0] as string) as Record<string, { id: number; name: string }>);
    const dids = db.exec('SELECT DISTINCT did FROM cards ORDER BY did')[0]!.values.map((r) => r[0]);
    db.close();
    expect(ds.filter((d) => d.name.toLowerCase() === 'default').map((d) => d.id)).toEqual([1]);
    expect(ds.length).toBe(2);
    expect(dids).toContain(1);
    expect(new Set(ds.map((d) => d.name.toLowerCase())).size).toBe(ds.length);
  });

  it('oclusión con varios rectángulos: una sola tarjeta Basic (sin ord repetidos)', () => {
    const n = mapDeck('O', parseDeck('IO: ![[a.png]]\n<!-- io: 1,2,3,4;5,6,7,8 --> ^o0001\n')).notes[0]!;
    expect(n.model).toBe('basic');
    expect(n.cards.map((c) => c.ord)).toEqual([0]);
  });

  it('HTML hostil y separador de campos no escapan del campo', async () => {
    const SQL = await sql();
    const d = mapDeck('H', parseDeck('Q:: <img src=x onerror=alert(1)> [x](javascript:alert(1)) a\x1fb\nA:: <script>alert(1)</script> ![](x"onerror="y.png) ![[a"b<c>.png|alt "><svg>]] ^h0001\n'));
    const n = d.notes[0]!;
    expect(n.fields.length).toBe(2);
    for (const f of n.fields) { expect(f).not.toMatch(/<script|<svg|<img src=x|href="javascript/i); expect(f).not.toContain('\x1f'); }
    for (const f of n.fields) for (const m of f.matchAll(/<img[^>]*>/g)) expect(m[0]).not.toMatch(/onerror\s*=\s*[^&]*"[^>]*onerror/);
    const out = await buildApkg({ SQL, decks: [d], readMedia: () => new Uint8Array([1]), now: NOW });
    expect(out.stats.cards).toBe(1);
  });

  it('medios: nombres hostiles, numéricos, faltantes y enormes', async () => {
    const SQL = await sql();
    for (const h of ['../../etc/passwd.png', '..\\..\\x.png', '/abs/y.png', '..', '', 'a\u0000b.png', '1.png', '0']) {
      const m = mediaName(h);
      expect(m).not.toMatch(/[\\/\u0000:]|^\.\.?$/);
      expect(m.length).toBeGreaterThan(0);
    }
    const d = mapDeck('M', parseDeck('Q:: ![[../../etc/passwd.png]] ![[0.png]] ![[falta.png]]\nA:: ![[1.png]] ^m0001\n'));
    const out = await buildApkg({ SQL, decks: [d], readMedia: (n) => (n === 'falta.png' ? undefined : new Uint8Array([1, 2, 3])), now: NOW });
    expect(out.stats.missingMedia).toBe(1);
    const z = unzipSync(out.bytes);
    for (const k of Object.keys(z)) expect(k).toMatch(/^(collection\.anki2|media|\d+)$/);
    const idx = JSON.parse(strFromU8(z.media!)) as Record<string, string>;
    for (const v of Object.values(idx)) expect(v).not.toMatch(/[\\/]/);
    const huge = { get length() { return 10 ** 12; } } as unknown as Uint8Array;
    await expect(buildApkg({ SQL, decks: [d], readMedia: () => huge, now: NOW })).rejects.toBeInstanceOf(ApkgExportError);
  });
});
