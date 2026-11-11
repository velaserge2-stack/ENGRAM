/**
 * Importar .apkg de Anki (SPEC §5, fase 5). Conversión pura (probada en Node);
 * en la app se ejecuta en un Worker con sql.js (WASM). Datos no confiables:
 * límites de tamaño, HTML convertido a texto, medios renombrados de forma segura.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { stringifyFrontmatter } from '../lib/frontmatter';
import type { LogEntry } from '../srs/engine';

interface SqlDb {
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  close(): void;
}
export interface SqlJs {
  Database: new (data?: Uint8Array) => SqlDb;
}

export interface ApkgResult {
  decks: { path: string; text: string; cards: number }[];
  media: { name: string; data: Uint8Array }[];
  log: LogEntry[];
  warnings: string[];
}

const MAX_APKG = 500 * 1024 * 1024;

/** HTML de un campo de Anki → Markdown sencillo. */
export function fieldToMd(html: string, mediaNames: Set<string>): string {
  return html
    .replace(/<img[^>]*src="([^"]+)"[^>]*>/gi, (_, s: string) => (mediaNames.has(s) ? `![[${s}]]` : `![[${s}]]`))
    .replace(/\[sound:([^\]]+)\]/g, '![[$1]]')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<(b|strong)>(.*?)<\/\1>/gi, '**$2**')
    .replace(/<(i|em)>(.*?)<\/\1>/gi, '*$2*')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

const rows = (db: SqlDb, sql: string) => {
  try {
    const r = db.exec(sql)[0];
    return r ? r.values.map((v) => Object.fromEntries(r.columns.map((c, i) => [c, v[i]]))) : [];
  } catch {
    return [];
  }
};

export function convertApkg(bytes: Uint8Array, SQL: SqlJs, withHistory = true): ApkgResult {
  const warnings: string[] = [];
  if (bytes.length > MAX_APKG) throw new Error('El .apkg supera 500 MB');
  const files = unzipSync(bytes, { filter: (f) => f.originalSize < 300 * 1024 * 1024 });
  const dbBytes = files['collection.anki21'] ?? files['collection.anki2'];
  if (!dbBytes) {
    if (files['collection.anki21b']) throw new Error('Este .apkg usa el formato nuevo comprimido (anki21b). En Anki, exporta marcando «Compatibilidad con versiones antiguas».');
    throw new Error('No es un paquete de Anki válido (falta collection.anki2)');
  }
  const db = new SQL.Database(dbBytes);
  try {
    // modelos y mazos (JSON en col; en esquemas nuevos, tablas propias)
    const col = rows(db, 'SELECT models, decks FROM col')[0] as { models?: string; decks?: string } | undefined;
    const models = new Map<string, { type: number; name: string }>();
    const decks = new Map<string, string>();
    try {
      for (const [id, m] of Object.entries(JSON.parse(col?.models || '{}') as Record<string, { type: number; name: string }>)) models.set(String(id), m);
      for (const [id, d] of Object.entries(JSON.parse(col?.decks || '{}') as Record<string, { name: string }>)) decks.set(String(id), d.name);
    } catch {
      warnings.push('Metadatos de modelos/mazos ilegibles');
    }
    for (const r of rows(db, 'SELECT id, name FROM decks')) decks.set(String(r.id), String(r.name));
    for (const r of rows(db, 'SELECT id, name, config FROM notetypes')) models.set(String(r.id), { type: String(r.name).toLowerCase().includes('cloze') ? 1 : 0, name: String(r.name) });

    let mediaMap: Record<string, string> = {};
    try {
      mediaMap = JSON.parse(strFromU8(files['media'] ?? new Uint8Array())) as Record<string, string>;
    } catch {
      mediaMap = {};
    }
    const media: ApkgResult['media'] = [];
    const names = new Set<string>();
    for (const [num, name] of Object.entries(mediaMap)) {
      const data = files[num];
      const safe = name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
      if (data && safe) (media.push({ name: safe, data }), names.add(safe));
    }

    const notes = rows(db, 'SELECT id, mid, flds, tags FROM notes');
    const cards = rows(db, 'SELECT id, nid, did, ord FROM cards');
    const deckOf = new Map<string, string>();
    for (const c of cards) if (!deckOf.has(String(c.nid))) deckOf.set(String(c.nid), String(c.did));
    const byDeck = new Map<string, { blocks: string[]; tags: Set<string>; n: number }>();
    const nid2id = new Map<string, string>();
    for (const n of notes) {
      const id = `a${Number(n.id).toString(36)}`;
      nid2id.set(String(n.id), id);
      const fields = String(n.flds).split('\x1f').map((f) => fieldToMd(f, names));
      const model = models.get(String(n.mid));
      const isCloze = model?.type === 1 || /\{\{c\d+::/.test(fields[0] ?? '');
      const one = (s: string) => s.replace(/\n+/g, '\n');
      let block: string;
      if (isCloze) block = `Cloze: ${one(fields[0] ?? '')}${fields[1] ? `\n${one(fields[1])}` : ''}`;
      else if (/reverse|invers|ambos/i.test(model?.name ?? '')) block = `QR:: ${one(fields[0] ?? '')}\nA:: ${one(fields[1] ?? '')}`;
      else block = `Q:: ${one(fields[0] ?? '')}\nA:: ${one(fields.slice(1).filter(Boolean).join('\n'))}`;
      if (!fields[0]?.trim()) continue;
      const deckName = decks.get(deckOf.get(String(n.id)) ?? '') ?? 'Anki';
      const d = byDeck.get(deckName) ?? byDeck.set(deckName, { blocks: [], tags: new Set(), n: 0 }).get(deckName)!;
      d.blocks.push(`${block} ^${id}`);
      d.n += isCloze ? new Set((fields[0]!.match(/\{\{c(\d+)::/g) ?? [])).size || 1 : 1;
      for (const t of String(n.tags).trim().split(/\s+/).filter(Boolean)) d.tags.add(t.replace(/::/g, '/'));
    }
    const out: ApkgResult['decks'] = [];
    for (const [name, d] of byDeck) {
      const parts = name.split('::').map((x) => x.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').trim() || 'Mazo');
      out.push({ path: `decks/${parts.join('/')}.md`, text: stringifyFrontmatter({ deck: parts[parts.length - 1]!, tags: [...d.tags].slice(0, 30), origen: 'anki' }, `\n${d.blocks.join('\n\n')}\n`), cards: d.n });
    }

    const log: LogEntry[] = [];
    if (withHistory) {
      const card2cid = new Map<string, string>();
      for (const c of cards) {
        const nid = nid2id.get(String(c.nid));
        if (!nid) continue;
        const note = notes.find((x) => String(x.id) === String(c.nid));
        const isCloze = models.get(String(note?.mid))?.type === 1 || /\{\{c\d+::/.test(String(note?.flds ?? ''));
        const reverse = /reverse|invers|ambos/i.test(models.get(String(note?.mid))?.name ?? '');
        card2cid.set(String(c.id), isCloze ? `${nid}:c${Number(c.ord) + 1}` : reverse && Number(c.ord) === 1 ? `${nid}:r` : nid);
      }
      const seen = new Set<string>();
      for (const r of rows(db, 'SELECT id, cid, ease, time, type FROM revlog ORDER BY id')) {
        const cid = card2cid.get(String(r.cid));
        const ease = Number(r.ease);
        if (!cid || ease < 1 || ease > 4) continue;
        const state = !seen.has(cid) ? 0 : Number(r.type) === 1 ? 2 : Number(r.type) === 2 ? 3 : 1;
        seen.add(cid);
        log.push({ id: cid, ts: Number(r.id), rating: ease as 1 | 2 | 3 | 4, ms: Math.min(60_000, Number(r.time) || 0), state, src: 'anki' });
      }
    }
    return { decks: out, media, log, warnings };
  } finally {
    db.close();
  }
}
