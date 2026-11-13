import { t } from '../i18n';
/**
 * Importar .apkg de Anki (SPEC §5, fase 5). Conversión pura (probada en Node);
 * en la app se ejecuta en un Worker con sql.js (WASM). Datos no confiables:
 * límites de tamaño, HTML convertido a texto, medios renombrados de forma segura.
 */
import { unzipSync, strFromU8 } from 'fflate';
import { Decompress } from 'fzstd';
import { stringifyFrontmatter } from '../lib/frontmatter';
import { LIMITS } from './limits';
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
  /** Qué se leyó (para el resumen y el diagnóstico). */
  info?: { format: 'legacy' | 'compat' | 'new'; schema: 'v11' | 'v18'; notes: number; decks: number; cards: number; media: number; skippedEmpty: number };
}

const MAX_APKG = 500 * 1024 * 1024;

/** Nombre seguro para `media/` y para `![[…]]`: sin separadores, `|`, `[`, `]`, `#`, `^` ni punto inicial. */
export const safeMediaName = (name: string) => String(name).replace(/[\\/:*?"<>|[\]#^]+/g, '_').replace(/^\.+/, '_').slice(0, 120);

/** Línea que el parser de mazos leería como marca (inicio de tarjeta, respuesta o título que corta el bloque). */
const MARKER = /^(?:(?:QR|Q|T|LO|L|MC|MATCH|ORD|A|Explicación)::|(?:Cloze|IO):|#{1,6}\s)/;

/**
 * HTML de un campo de Anki → Markdown sencillo. `media`: nombre original → nombre guardado.
 * El texto del campo no puede crear tarjetas: las líneas que empiezan con una marca del parser
 * (`Q::`, `A::`, `Cloze:`, `# `…) llevan un espacio delante (el parser exige la marca en la
 * columna 0; Markdown ignora ese espacio) o `\#`; y `<!-- … -->` no se convierte en metadato.
 */
export function fieldToMd(html: string, media: Map<string, string> | Set<string>): string {
  const ref = (s: string) => `![[${(media instanceof Map ? media.get(s) : undefined) ?? safeMediaName(s)}]]`;
  return html
    .replace(/<img[^>]*src="([^"]+)"[^>]*>/gi, (_, s: string) => ref(s))
    .replace(/\[sound:([^\]]+)\]/g, (_, s: string) => ref(s))
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<(b|strong)>(.*?)<\/\1>/gi, '**$2**')
    .replace(/<(i|em)>(.*?)<\/\1>/gi, '*$2*')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/gi, "'").replace(/&amp;/g, '&')
    .replace(/<!--/g, '&lt;!--')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .split('\n')
    .map((l) => (MARKER.test(l) ? (l.startsWith('#') ? `\\${l}` : ` ${l}`) : l))
    .join('\n');
}

/** Error con causa conocida (la hoja de importación muestra causa y paso siguiente). */
export type ApkgErrorCode = 'invalid' | 'new-format' | 'too-big' | 'too-many' | 'corrupt' | 'empty';
export class ApkgError extends Error {
  constructor(public code: ApkgErrorCode, message: string) { super(message); }
}

const ZSTD = [0x28, 0xb5, 0x2f, 0xfd];
const SQLITE = 'SQLite format 3\0';
const isZstd = (b?: Uint8Array) => !!b && b.length >= 4 && ZSTD.every((x, i) => b[i] === x);
const isSqlite = (b?: Uint8Array) => !!b && b.length >= 16 && strFromU8(b.subarray(0, 16)) === SQLITE;

/** Mayor de (ventana, tamaño de contenido) que declara la cabecera del primer marco zstd. */
export function zstdDeclared(b: Uint8Array): number {
  if (!isZstd(b) || b.length < 6) return 0;
  const fhd = b[4]!, single = (fhd >> 5) & 1, fcsFlag = fhd >> 6, did = fhd & 3;
  let i = 5, ws = 0;
  if (!single) { const wb = 2 ** (10 + (b[5]! >> 3)); ws = wb + (wb / 8) * (b[5]! & 7); i++; }
  i += [0, 1, 2, 4][did]!;
  const n = [single, 2, 4, 8][fcsFlag]!;
  let fcs = 0;
  for (let k = 0; k < n && i + k < b.length; k++) fcs += b[i + k]! * 2 ** (8 * k);
  if (n === 2) fcs += 256;
  return Math.max(ws, fcs);
}

/** zstd con tope de salida (bomba de descompresión): se cuenta lo que sale, trozo a trozo. */
export function unzstd(data: Uint8Array, max = LIMITS.maxUnzstdBytes): Uint8Array {
  // la cabecera declara ventana y tamaño: se rechaza antes de reservar memoria
  const declared = zstdDeclared(data);
  if (declared > max) throw new ApkgError('too-big', t('apkg.descomprimido_demasiado_grande', { mb: Math.round(max / 1048576) }));
  const parts: Uint8Array[] = [];
  let total = 0;
  const d = new Decompress((chunk) => {
    total += chunk.length;
    if (total > max) throw new ApkgError('too-big', t('apkg.descomprimido_demasiado_grande', { mb: Math.round(max / 1048576) }));
    parts.push(chunk);
  });
  const STEP = 1 << 16;
  for (let i = 0; i < data.length; i += STEP) d.push(data.subarray(i, i + STEP), i + STEP >= data.length);
  if (!data.length) d.push(new Uint8Array(0), true);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}

/** Protobuf mínimo: campos de nivel superior (varint y longitud delimitada; el resto se salta). */
export function pbFields(b: Uint8Array): { field: number; varint?: number; bytes?: Uint8Array }[] {
  const out: { field: number; varint?: number; bytes?: Uint8Array }[] = [];
  let i = 0;
  const varint = () => {
    let v = 0, mul = 1;
    for (let n = 0; n < 10; n++) {
      if (i >= b.length) throw new Error('pb');
      const x = b[i++]!;
      v += (x & 0x7f) * mul;
      if (!(x & 0x80)) return v;
      mul *= 128;
    }
    throw new Error('pb');
  };
  while (i < b.length) {
    const key = varint(), field = Math.floor(key / 8), wire = key & 7;
    if (wire === 0) out.push({ field, varint: varint() });
    else if (wire === 2) { const len = varint(); if (i + len > b.length) throw new Error('pb'); out.push({ field, bytes: b.subarray(i, i + len) }); i += len; }
    else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else throw new Error('pb');
  }
  return out;
}

/** `meta`: PackageMetadata { Version version = 1 } (1 = anki2, 2 = anki21, 3 = anki21b). */
export function metaVersion(b?: Uint8Array): number {
  if (!b) return 0;
  try { return pbFields(b).find((f) => f.field === 1)?.varint ?? 0; } catch { return 0; }
}

/** `media` nuevo: MediaEntries { repeated MediaEntry { string name = 1; uint32 size = 2; bytes sha1 = 3; uint32 legacy_zip_filename = 255 } = 1 }. */
export function mediaEntries(b: Uint8Array): { name: string; zip: string }[] {
  return pbFields(b).filter((f) => f.field === 1 && f.bytes).map((f, i) => {
    const e = pbFields(f.bytes!);
    const name = e.find((x) => x.field === 1)?.bytes;
    const legacy = e.find((x) => x.field === 255)?.varint;
    return { name: name ? strFromU8(name) : '', zip: String(legacy ?? i) };
  });
}

/** Marcador del formato nuevo: una colección cuya única nota pide actualizar Anki. */
const FAKE = /^Please update to the latest Anki version/i;

interface Rows { (sql: string, table: string): Record<string, unknown>[] }
function reader(db: SqlDb, warnings: string[]): { rows: Rows; has: (table: string) => boolean } {
  const tables = new Set<string>();
  try {
    for (const v of db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values ?? []) tables.add(String(v[0]));
  } catch (e) {
    throw new ApkgError('corrupt', t('apkg.coleccion_danada', { msg: (e as Error).message }));
  }
  const rows: Rows = (sql, table) => {
    if (!tables.has(table)) return []; // esquema distinto: el llamador prueba la alternativa
    try {
      const r = db.exec(sql)[0];
      return r ? r.values.map((v) => Object.fromEntries(r.columns.map((c, i) => [c, v[i]]))) : [];
    } catch (e) {
      warnings.push(t('apkg.error_al_leer', { table, msg: (e as Error).message }));
      return [];
    }
  };
  return { rows, has: (x) => tables.has(x) };
}

/** Elige la colección real: anki21b (zstd) → anki21 → anki2, nunca el marcador falso. */
function openCollection(files: Record<string, Uint8Array>, SQL: SqlJs, warnings: string[]): { db: SqlDb; format: 'legacy' | 'compat' | 'new' } {
  const version = metaVersion(files['meta']);
  const order = ['collection.anki21b', 'collection.anki21', 'collection.anki2'].filter((n) => files[n]);
  if (!order.length) throw new ApkgError('invalid', t('apkg.no_es_un_paquete_de_anki'));
  let sawFake = false, sawNew = !!files['collection.anki21b'] || version >= 3;
  for (const name of order) {
    let bytes = files[name]!;
    if (isZstd(bytes)) {
      try { bytes = unzstd(bytes); } catch (e) {
        if (e instanceof ApkgError) throw e; // tope de tamaño
        warnings.push(t('apkg.coleccion_ilegible', { name }));
        continue;
      }
    }
    if (!isSqlite(bytes)) { warnings.push(t('apkg.coleccion_ilegible', { name })); continue; }
    let db: SqlDb;
    try { db = new SQL.Database(bytes); } catch (e) { warnings.push(t('apkg.coleccion_ilegible', { name }) + ` (${(e as Error).message})`); continue; }
    try {
      const n = db.exec('SELECT count(*), max(flds) FROM notes')[0]?.values[0] ?? [0, ''];
      if (Number(n[0]) <= 1 && FAKE.test(String(n[1] ?? ''))) { sawFake = true; sawNew = true; db.close(); continue; }
    } catch { /* sin tabla notes: lo dirá el lector */ }
    return { db, format: name === 'collection.anki21b' ? 'new' : name === 'collection.anki21' ? 'compat' : 'legacy' };
  }
  if (sawFake || sawNew) throw new ApkgError('new-format', t('apkg.este_apkg_usa_el_formato_nuevo'));
  throw new ApkgError('corrupt', t('apkg.ninguna_coleccion_legible'));
}

export function convertApkg(bytes: Uint8Array, SQL: SqlJs, withHistory = true, fileName = ''): ApkgResult {
  const warnings: string[] = [];
  if (bytes.length > MAX_APKG) throw new ApkgError('too-big', t('apkg.el_apkg_supera_500_mb'));
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new ApkgError('invalid', t('apkg.no_es_un_paquete_de_anki'));
  let files: Record<string, Uint8Array>;
  try {
    // límites como parseZip: por entrada, total y razón (fflate reserva lo que declara cada cabecera)
    let total = 0, count = 0, skipped = 0;
    files = unzipSync(bytes, {
      filter: (f) => {
        const coll = f.name.startsWith('collection.') || f.name === 'meta' || f.name === 'media';
        const ok = f.originalSize < 300 * 1024 * 1024 && ++count <= LIMITS.maxFiles * 5 &&
          (coll || !(f.size > 0 && f.originalSize / f.size > LIMITS.maxRatio && f.originalSize > 1024 * 1024)) &&
          total + f.originalSize <= LIMITS.maxTotalBytes;
        if (ok) total += f.originalSize; else skipped++;
        return ok;
      },
    });
    if (skipped) warnings.push(t('apkg.medios_omitidos', { n: skipped }));
  } catch {
    throw new ApkgError('invalid', t('apkg.no_es_un_paquete_de_anki'));
  }
  const { db, format } = openCollection(files, SQL, warnings);
  try {
    const { rows, has } = reader(db, warnings);
    const schema = has('notetypes') ? 'v18' : 'v11';
    // modelos y mazos: JSON en col (v11) o tablas propias (v18)
    const models = new Map<string, { type: number; name: string; templates?: number }>();
    const decks = new Map<string, string>();
    if (has('col') && schema === 'v11') {
      const col = rows('SELECT models, decks FROM col', 'col')[0] as { models?: string; decks?: string } | undefined;
      try {
        for (const [id, m] of Object.entries(JSON.parse(col?.models || '{}') as Record<string, { type: number; name: string; tmpls?: unknown[] }>)) models.set(String(id), { type: m.type, name: m.name, templates: m.tmpls?.length });
        for (const [id, d] of Object.entries(JSON.parse(col?.decks || '{}') as Record<string, { name: string }>)) decks.set(String(id), d.name);
      } catch {
        warnings.push(t('apkg.metadatos_de_modelos_mazos_ilegibles'));
      }
    }
    for (const r of rows('SELECT id, name FROM decks', 'decks')) decks.set(String(r.id), String(r.name));
    const tmplCount = new Map<string, number>();
    for (const r of rows('SELECT ntid, count(*) AS n FROM templates GROUP BY ntid', 'templates')) tmplCount.set(String(r.ntid), Number(r.n));
    for (const r of rows('SELECT id, name, config FROM notetypes', 'notetypes')) {
      // config (protobuf): campo 1 = kind (0 normal, 1 cloze)
      let kind = 0;
      try { if (r.config instanceof Uint8Array) kind = pbFields(r.config).find((f) => f.field === 1)?.varint ?? 0; } catch { /* config ilegible: se usa el nombre */ }
      models.set(String(r.id), { type: kind === 1 || String(r.name).toLowerCase().includes('cloze') ? 1 : 0, name: String(r.name), templates: tmplCount.get(String(r.id)) });
    }

    let mediaMap: Record<string, string> = {};
    const mediaRaw = files['media'];
    if (mediaRaw && (isZstd(mediaRaw) || (mediaRaw.length && mediaRaw[0] !== 0x7b))) {
      // formato nuevo: protobuf (comprimido con zstd)
      try {
        for (const e of mediaEntries(isZstd(mediaRaw) ? unzstd(mediaRaw) : mediaRaw)) if (e.name) mediaMap[e.zip] = e.name;
      } catch (e) {
        if (e instanceof ApkgError) throw e;
        warnings.push(t('apkg.lista_de_medios_ilegible'));
      }
    } else {
      try {
        mediaMap = JSON.parse(strFromU8(mediaRaw ?? new Uint8Array())) as Record<string, string>;
      } catch {
        mediaMap = {};
      }
    }
    const media: ApkgResult['media'] = [];
    const names = new Map<string, string>(); // nombre original (el de los campos) → nombre guardado
    const used = new Set<string>();
    let badMedia = 0;
    for (const [num, name] of Object.entries(mediaMap)) {
      let data = files[num];
      let safe = safeMediaName(name);
      if (!data || !safe || names.has(String(name))) continue;
      if (isZstd(data)) {
        try { data = unzstd(data, Math.min(LIMITS.maxUnzstdBytes, LIMITS.maxFileBytes)); } catch { badMedia++; continue; }
      }
      // dos nombres que se sanean igual no se pisan: «a_b (2).png»
      const b = safe, dot = b.lastIndexOf('.');
      for (let n = 2; used.has(safe.toLowerCase()); n++) safe = dot > 0 ? `${b.slice(0, dot)} (${n})${b.slice(dot)}` : `${b} (${n})`;
      used.add(safe.toLowerCase());
      media.push({ name: safe, data });
      names.set(String(name), safe);
    }
    if (badMedia) warnings.push(t('apkg.medios_omitidos', { n: badMedia }));

    const notes = rows('SELECT id, mid, flds, tags FROM notes', 'notes');
    if (notes.length > LIMITS.maxApkgNotes) throw new ApkgError('too-many', t('apkg.demasiadas_notas', { n: notes.length, max: LIMITS.maxApkgNotes }));
    const cards = rows('SELECT id, nid, did, ord FROM cards', 'cards');
    const deckOf = new Map<string, string>();
    for (const c of cards) if (!deckOf.has(String(c.nid))) deckOf.set(String(c.nid), String(c.did));
    const byDeck = new Map<string, { blocks: string[]; tags: Set<string>; n: number }>();
    const nid2id = new Map<string, string>();
    const reverseOf = (m?: { type: number; name: string; templates?: number }) => !!m && m.type !== 1 && (/reverse|invers|ambos/i.test(m.name) || m.templates === 2);
    let skippedEmpty = 0;
    for (const n of notes) {
      const id = `a${Number(n.id).toString(36)}`;
      const fields = String(n.flds).split('\x1f').map((f) => fieldToMd(f, names));
      const model = models.get(String(n.mid));
      const isCloze = model?.type === 1 || /\{\{c\d+::/.test(fields[0] ?? '');
      const one = (s: string) => s.replace(/\n+/g, '\n');
      let block: string;
      if (isCloze) block = `Cloze: ${one(fields[0] ?? '')}${fields[1] ? `\n${one(fields[1])}` : ''}`;
      else if (reverseOf(model)) block = `QR:: ${one(fields[0] ?? '')}\nA:: ${one(fields[1] ?? '')}`;
      else block = `Q:: ${one(fields[0] ?? '')}\nA:: ${one(fields.slice(1).filter(Boolean).join('\n'))}`;
      if (!fields[0]?.trim()) { skippedEmpty++; continue; }
      nid2id.set(String(n.id), id);
      let deckName = decks.get(deckOf.get(String(n.id)) ?? '') ?? 'Anki';
      // «Default» con tarjetas: se nombra como el archivo
      if (/^(default|por defecto|predeterminado|par défaut)$/i.test(deckName.trim()) || !deckName.trim()) deckName = fileName.replace(/\.(apkg|colpkg|zip)$/i, '').trim() || 'Anki';
      const d = byDeck.get(deckName) ?? byDeck.set(deckName, { blocks: [], tags: new Set(), n: 0 }).get(deckName)!;
      d.blocks.push(`${block} ^${id}`);
      d.n += isCloze ? new Set((fields[0]!.match(/\{\{c(\d+)::/g) ?? [])).size || 1 : reverseOf(model) ? 2 : 1;
      for (const t of String(n.tags).trim().split(/\s+/).filter(Boolean)) d.tags.add(t.replace(/::/g, '/'));
    }
    const out: ApkgResult['decks'] = [];
    const paths = new Set<string>();
    for (const [name, d] of byDeck) {
      // segmentos válidos para la bóveda: sin «.»/«..» ni punto inicial, ≤ 120 caracteres, ≤ 12 niveles
      let parts = name.split(/::|\x1f/).map((x) => x.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/^\.+/, '_').trim().slice(0, 120).trim() || t('deck.mazo'));
      if (parts.length > 12) parts = [...parts.slice(0, 11), parts.slice(11).join(' · ').slice(0, 120)];
      // dos mazos que se sanean igual («A:B» y «A B») no comparten archivo: «A B (2)»
      const base = parts[parts.length - 1]!;
      for (let n = 2; paths.has(`decks/${parts.join('/')}.md`.toLowerCase()); n++) parts[parts.length - 1] = `${base} (${n})`;
      paths.add(`decks/${parts.join('/')}.md`.toLowerCase());
      out.push({ path: `decks/${parts.join('/')}.md`, text: stringifyFrontmatter({ deck: parts[parts.length - 1]!, tags: [...d.tags].slice(0, 30), origen: 'anki' }, `\n${d.blocks.join('\n\n')}\n`), cards: d.n });
    }

    const log: LogEntry[] = [];
    if (withHistory) {
      const card2cid = new Map<string, string>();
      const noteById = new Map(notes.map((x) => [String(x.id), x]));
      for (const c of cards) {
        const nid = nid2id.get(String(c.nid));
        if (!nid) continue;
        const note = noteById.get(String(c.nid));
        const isCloze = models.get(String(note?.mid))?.type === 1 || /\{\{c\d+::/.test(String(note?.flds ?? ''));
        const reverse = reverseOf(models.get(String(note?.mid)));
        card2cid.set(String(c.id), isCloze ? `${nid}:c${Number(c.ord) + 1}` : reverse && Number(c.ord) === 1 ? `${nid}:r` : nid);
      }
      const seen = new Set<string>();
      for (const r of rows('SELECT id, cid, ease, time, type FROM revlog ORDER BY id', 'revlog')) {
        const cid = card2cid.get(String(r.cid));
        const ease = Number(r.ease);
        if (!cid || ease < 1 || ease > 4) continue;
        const state = !seen.has(cid) ? 0 : Number(r.type) === 1 ? 2 : Number(r.type) === 2 ? 3 : 1;
        seen.add(cid);
        log.push({ id: cid, ts: Number(r.id), rating: ease as 1 | 2 | 3 | 4, ms: Math.min(60_000, Number(r.time) || 0), state, src: 'anki' });
      }
    }
    if (skippedEmpty) warnings.push(t('apkg.notas_vacias_omitidas', { n: skippedEmpty }));
    if (!notes.length) warnings.push(t('apkg.sin_notas'));
    else if (!out.length) warnings.push(t('apkg.notas_sin_mazos', { n: notes.length }));
    const info = { format, schema, notes: notes.length, decks: out.length, cards: out.reduce((a, d) => a + d.cards, 0), media: media.length, skippedEmpty } as const;
    warnings.unshift(t('apkg.esquema_detectado', { schema: schema === 'v18' ? 'v18' : 'v11', notes: info.notes, decks: info.decks, media: info.media }));
    if (!out.length) throw new ApkgError('empty', warnings.slice(1).join(' ') || t('apkg.sin_notas'));
    return { decks: out, media, log, warnings, info: { ...info } };
  } finally {
    db.close();
  }
}
