/**
 * Escritor de .apkg (Anki legado, esquema v11, `collection.anki2`). Puro: recibe sql.js ya
 * inicializado, los mazos de `mapDeck` y un lector de medios; sin DOM. Ids estables (map.ts).
 */
import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { NoteType } from '../../cards/parse';
import type { SqlJs } from '../apkg';
import { LIMITS } from '../limits';
import { ankiId, MODELS, type AnkiNote, type MapResult, type ModelKey } from './map';

/** Estado de una tarjeta (por id de tarjeta de Anki). `due`: posición (nueva), días desde `crt` (repaso) o segundos (aprendizaje). */
export interface AnkiSched { type: number; queue: number; due: number; ivl: number; factor: number; reps: number; lapses: number }
/** Fila de `revlog` (`id` en ms, `cid` = id de tarjeta de Anki). */
export interface AnkiRevlog { id: number; cid: number; ease: number; ivl: number; lastIvl: number; factor: number; time: number; type: number }
export interface BuildStats { decks: number; notes: number; cards: number; media: number; revlog: number; converted: Partial<Record<NoteType, number>>; skipped: number; missingMedia: number }
export interface BuildProgress { phase: 'notes' | 'media' | 'zip'; done: number; total: number }
export interface BuildOpts {
  SQL: SqlJs;
  decks: MapResult[];
  /** Bytes de `media/<original>`; `undefined` si falta (se omite y se cuenta). */
  readMedia: (original: string) => Promise<Uint8Array | undefined> | Uint8Array | undefined;
  sched?: Map<number, AnkiSched>;
  revlog?: AnkiRevlog[];
  onProgress?: (p: BuildProgress) => void;
  /** ms de epoch para `mod`/`crt` (por defecto ahora). */
  now?: number;
}

export class ApkgExportError extends Error {
  constructor(public code: 'apkg_export_too_big') {
    super(code);
  }
}
const MAX_TOTAL = Math.min(LIMITS.maxApkgTotalBytes, 1.5 * 2 ** 30);
/** Inicio del día (UTC) en segundos: `crt` de la colección; base de `due` de repaso. */
export const crtOf = (now: number) => Math.floor(now / 86_400_000) * 86_400;

const SCHEMA = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);`;

const CSS = '.card {\n font-family: arial;\n font-size: 20px;\n text-align: center;\n color: black;\n background-color: white;\n}\n';
const CLOZE_CSS = CSS + '.cloze {\n font-weight: bold;\n color: blue;\n}\n.nightMode .cloze {\n color: lightblue;\n}\n';
const ANS = '{{FrontSide}}\n\n<hr id=answer>\n\n';
const TMPLS: Record<ModelKey, [string, string, string][]> = {
  basic: [['Card 1', '{{Front}}', ANS + '{{Back}}']],
  reversed: [['Card 1', '{{Front}}', ANS + '{{Back}}'], ['Card 2', '{{Back}}', ANS + '{{Front}}']],
  cloze: [['Cloze', '{{cloze:Text}}', '{{cloze:Text}}<br>\n{{Back Extra}}']],
};

function modelsJson(mod: number) {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(MODELS) as ModelKey[]) {
    const m = MODELS[key], cloze = key === 'cloze';
    out[m.id] = {
      id: m.id, name: m.name, type: cloze ? 1 : 0, mod, usn: -1, sortf: 0, did: 1, tags: [], vers: [],
      css: cloze ? CLOZE_CSS : CSS, latexPre: '\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}\n', latexPost: '\\end{document}', latexsvg: false,
      flds: m.fields.map((name, ord) => ({ name, ord, sticky: false, rtl: false, font: 'Arial', size: 20, media: [] })),
      tmpls: TMPLS[key].map(([name, qfmt, afmt], ord) => ({ name, ord, qfmt, afmt, bqfmt: '', bafmt: '', did: null, bfont: '', bsize: 0 })),
      ...(cloze ? {} : { req: TMPLS[key].map((_, ord) => [ord, 'all', [ord]]) }),
    };
  }
  return out;
}
const deckJson = (id: number, name: string, mod: number) => ({
  id, name, mod, usn: -1, desc: '', dyn: 0, conf: 1, collapsed: false, browserCollapsed: false, extendNew: 0, extendRev: 0,
  newToday: [0, 0], revToday: [0, 0], lrnToday: [0, 0], timeToday: [0, 0],
});
const DCONF = {
  1: {
    id: 1, name: 'Default', mod: 0, usn: 0, maxTaken: 60, autoplay: true, timer: 0, replayq: true, dyn: false,
    new: { bury: false, delays: [1, 10], initialFactor: 2500, ints: [1, 4, 0], order: 1, perDay: 20, separate: true },
    lapse: { delays: [10], leechAction: 1, leechFails: 8, minInt: 1, mult: 0 },
    rev: { bury: false, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, minSpace: 1, perDay: 200, hardFactor: 1.2 },
  },
};

const yieldThread = () => new Promise<void>((r) => setTimeout(r, 0));

/** Construye el .apkg. Lanza `ApkgExportError('apkg_export_too_big')` si supera los límites. */
export async function buildApkg(o: BuildOpts): Promise<{ bytes: Uint8Array; stats: BuildStats }> {
  const now = o.now ?? Date.now(), mod = Math.floor(now / 1000), crt = crtOf(now);
  const notes: { n: AnkiNote; did: number }[] = o.decks.flatMap((d) => d.notes.map((n) => ({ n, did: d.deckId })));
  if (notes.length > LIMITS.maxApkgNotes) throw new ApkgExportError('apkg_export_too_big');
  const stats: BuildStats = { decks: o.decks.length, notes: notes.length, cards: 0, media: 0, revlog: o.revlog?.length ?? 0, converted: {}, skipped: 0, missingMedia: 0 };
  for (const d of o.decks) {
    stats.skipped += d.skipped;
    for (const [k, v] of Object.entries(d.converted) as [NoteType, number][]) stats.converted[k] = (stats.converted[k] ?? 0) + v;
  }

  // mazos: Default (1), los exportados y sus padres («A» de «A::B»)
  const decks: Record<string, unknown> = { 1: deckJson(1, 'Default', mod) };
  const byName = new Map(o.decks.map((d) => [d.deckName, d.deckId]));
  const ids = new Set([1, ...byName.values()]);
  for (const name of [...byName.keys()]) {
    const parts = name.split('::');
    for (let i = 1; i < parts.length; i++) {
      const p = parts.slice(0, i).join('::');
      if (!byName.has(p)) byName.set(p, ankiId(`deck:${p}`, ids));
    }
  }
  for (const [name, id] of byName) decks[id] = deckJson(id, name, mod);
  const conf = { activeDecks: [1], curDeck: 1, newSpread: 0, collapseTime: 1200, timeLim: 0, estTimes: true, dueCounts: true, curModel: null, nextPos: 1, sortType: 'noteFld', sortBackwards: false, addToCur: true, schedVer: 2 };

  const db = new o.SQL.Database();
  let coll: Uint8Array;
  try {
    db.exec(SCHEMA);
    db.run('BEGIN');
    const insNote = db.prepare('INSERT INTO notes VALUES (?,?,?,?,-1,?,?,?,?,0,\'\')');
    const insCard = db.prepare('INSERT INTO cards VALUES (?,?,?,?,?,-1,?,?,?,?,?,?,?,0,0,0,0,\'\')');
    const insRev = db.prepare('INSERT INTO revlog VALUES (?,?,-1,?,?,?,?,?,?)');
    try {
      let pos = 0;
      for (let i = 0; i < notes.length; i++) {
        const { n, did } = notes[i]!;
        insNote.run([n.id, n.guid, MODELS[n.model].id, mod, n.tags.length ? ` ${n.tags.join(' ')} ` : '', n.fields.join('\x1f'), n.sfld, n.csum]);
        for (const c of n.cards) {
          const s = o.sched?.get(c.id) ?? { type: 0, queue: 0, due: ++pos, ivl: 0, factor: 0, reps: 0, lapses: 0 };
          insCard.run([c.id, n.id, did, c.ord, mod, s.type, s.queue, s.due, s.ivl, s.factor, s.reps, s.lapses]);
          stats.cards++;
        }
        if ((i + 1) % 500 === 0) {
          o.onProgress?.({ phase: 'notes', done: i + 1, total: notes.length });
          await yieldThread();
        }
      }
      for (const r of o.revlog ?? []) insRev.run([r.id, r.cid, r.ease, r.ivl, r.lastIvl, r.factor, r.time, r.type]);
      conf.nextPos = pos + 1;
      db.run('INSERT INTO col VALUES (1,?,?,?,11,0,0,0,?,?,?,?,?)', [crt, now, now, JSON.stringify(conf), JSON.stringify(modelsJson(mod)), JSON.stringify(decks), JSON.stringify(DCONF), '{}']);
      db.run('COMMIT');
    } finally {
      insNote.free(); insCard.free(); insRev.free();
    }
    o.onProgress?.({ phase: 'notes', done: notes.length, total: notes.length });
    coll = db.export();
  } finally {
    db.close();
  }
  if (coll.length > LIMITS.maxApkgEntryBytes) throw new ApkgExportError('apkg_export_too_big');

  // zip en streaming: colección comprimida, medios sin comprimir (STORE)
  const chunks: Uint8Array[] = [];
  let zipErr: Error | null = null;
  const zip = new Zip((err, data) => { if (err) zipErr = err; else chunks.push(data); });
  const add = (name: string, data: Uint8Array, store: boolean) => {
    const f = store ? new ZipPassThrough(name) : new ZipDeflate(name, { level: 6 });
    f.mtime = now;
    zip.add(f);
    f.push(data, true);
    if (zipErr) throw zipErr;
  };
  add('collection.anki2', coll, false);
  let total = coll.length;
  const mediaList: [string, string][] = []; // [original, saneado], sin repetir el saneado
  const seen = new Set<string>();
  for (const d of o.decks) for (const [orig, safe] of d.media) if (!seen.has(safe)) { seen.add(safe); mediaList.push([orig, safe]); }
  const index: Record<string, string> = {};
  for (let i = 0; i < mediaList.length; i++) {
    const [orig, safe] = mediaList[i]!;
    const data = await o.readMedia(orig);
    if (!data) { stats.missingMedia++; continue; }
    total += data.length;
    if (data.length > LIMITS.maxApkgEntryBytes || total > MAX_TOTAL) throw new ApkgExportError('apkg_export_too_big');
    const num = String(stats.media++);
    index[num] = safe;
    add(num, data, true);
    o.onProgress?.({ phase: 'media', done: i + 1, total: mediaList.length });
  }
  add('media', strToU8(JSON.stringify(index)), false);
  zip.end();
  if (zipErr) throw zipErr;
  o.onProgress?.({ phase: 'zip', done: 1, total: 1 });
  const bytes = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }
  return { bytes, stats };
}
