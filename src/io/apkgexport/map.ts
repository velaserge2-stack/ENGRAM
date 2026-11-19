/**
 * Exportar a Anki · Fase 1: tarjetas de Engrama → notas de Anki (legacy v11). Módulo PURO:
 * sin DOM, sin sql.js. El Markdown del usuario se convierte a HTML escapado (markdown-it con
 * `html: false`: el HTML crudo, `javascript:` y los atributos `on*` no sobreviven).
 */
import MarkdownIt from 'markdown-it';
import { cardsOf, type Note, type NoteType, type ParsedDeck } from '../../cards/parse';

export type ModelKey = 'basic' | 'reversed' | 'cloze';

/** Modelos con ids fijos (ms de epoch, constantes: nunca cambian entre exportaciones). */
export const MODELS: Record<ModelKey, { id: number; name: string; fields: string[] }> = {
  basic: { id: 1700000000001, name: 'Basic', fields: ['Front', 'Back'] },
  reversed: { id: 1700000000002, name: 'Basic (and reversed card)', fields: ['Front', 'Back'] },
  cloze: { id: 1700000000003, name: 'Cloze', fields: ['Text', 'Back Extra'] },
};

export interface AnkiCard {
  id: number;
  /** Ordinal de plantilla: 0/1 en Basic y reversa; `n - 1` en cloze. */
  ord: number;
}
export interface AnkiNote {
  id: number;
  guid: string;
  model: ModelKey;
  fields: string[];
  tags: string[];
  /** Primer campo sin HTML (`sfld`) y su suma (`csum`). */
  sfld: string;
  csum: number;
  cards: AnkiCard[];
  /** Nombres saneados de los medios que usa. */
  media: string[];
  /** Id de la nota de Engrama (`^id`). */
  src: string;
}
export interface MapResult {
  deckName: string;
  deckId: number;
  notes: AnkiNote[];
  /** original (como se escribió, sin `media/`) → nombre saneado. */
  media: Map<string, string>;
  /** Notas convertidas a Basic por no tener equivalente en Anki, por tipo. */
  converted: Partial<Record<NoteType, number>>;
  /** Notas sin `^id` o con errores de formato (no se exportan). */
  skipped: number;
}
export interface MapOpts {
  /** Ids ya usados en toda la exportación (se comparte entre mazos para evitar colisiones). */
  used?: Set<number>;
}

// ---------- SHA-1 (síncrono, mínimo) ----------
export function sha1(msg: string): Uint8Array {
  const data = new TextEncoder().encode(msg);
  const n = data.length;
  const buf = new Uint8Array(((n + 8) >> 6 << 6) + 64);
  buf.set(data);
  buf[n] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 4, n * 8 >>> 0);
  dv.setUint32(buf.length - 8, Math.floor((n * 8) / 2 ** 32));
  let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const w = new Uint32Array(80);
  const rol = (x: number, s: number) => (x << s) | (x >>> (32 - s));
  for (let o = 0; o < buf.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
    let [a, b, c, d, e] = [h0, h1, h2, h3, h4];
    for (let i = 0; i < 80; i++) {
      const [f, k] = i < 20 ? [(b & c) | (~b & d), 0x5a827999] : i < 40 ? [b ^ c ^ d, 0x6ed9eba1] : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6];
      const tmp = (rol(a, 5) + f! + e + k! + w[i]!) | 0;
      [e, d, c, b, a] = [d, c, rol(b, 30), a, tmp];
    }
    [h0, h1, h2, h3, h4] = [(h0! + a) | 0, (h1! + b) | 0, (h2! + c) | 0, (h3! + d) | 0, (h4! + e) | 0];
  }
  const out = new Uint8Array(20);
  const odv = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => odv.setUint32(i * 4, h! >>> 0));
  return out;
}
const hex = (b: Uint8Array, n: number) => [...b.slice(0, n)].map((x) => x.toString(16).padStart(2, '0')).join('');

// ---------- ids ----------
const EPOCH0 = 1_400_000_000_000; // 2014; con 38 bits queda < 1,68e12 (2023): ms válidos
/** Entero en ms derivado del texto; mismo `seed` → mismo id. Si `used` ya lo tiene, sube de 1 en 1. */
export function ankiId(seed: string, used?: Set<number>): number {
  const h = sha1(seed);
  const dv = new DataView(h.buffer);
  let id = EPOCH0 + (dv.getUint8(0) & 0x3f) * 2 ** 32 + dv.getUint32(1);
  if (used) {
    while (used.has(id)) id++;
    used.add(id);
  }
  return id;
}

const B91 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+,-./:;<=>?@[]^_`{|}~';
/** guid de Anki (base 91, 10 caracteres) derivado del `^id` de la nota. */
export function guidFrom(id: string): string {
  let n = new DataView(sha1(`guid:${id}`).buffer).getBigUint64(0);
  let s = '';
  for (let i = 0; i < 10; i++, n /= 91n) s = B91[Number(n % 91n)]! + s;
  return s;
}

// ---------- nombres ----------
/** `decks/<Carpeta>/<Mazo>.md` → `Carpeta::Mazo` (sin `::` ni comillas ni controles dentro de cada parte). */
export function deckNameOf(path: string): string {
  const parts = path.replace(/^decks\//, '').replace(/\.md$/i, '').split('/');
  return parts.map(segment).join('::');
}
function segment(s: string): string {
  // eslint-disable-next-line no-control-regex
  const c = s.replace(/[\u0000-\u001f\u007f]/g, '').replace(/:/g, '-').replace(/"/g, "'").trim();
  return c || 'Sin nombre';
}

const EXT = /(\.[A-Za-z0-9]{1,8})$/;
/** Nombre de medio seguro para el paquete: sin rutas, `..`, controles ni caracteres reservados; estable y con extensión. */
export function mediaName(original: string): string {
  const base = original.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  let s = base.replace(/[\u0000-\u001f\u007f<>:"|?*[\]{}\\/]/g, '_').replace(/\.{2,}/g, '.').replace(/^[.\s]+|[\s.]+$/g, '');
  const ext = EXT.exec(s)?.[1] ?? '';
  let stem = ext ? s.slice(0, -ext.length) : s;
  if (stem.length > 80) stem = stem.slice(0, 80);
  s = (stem || 'media') + ext;
  // si hubo que cambiarlo, un sufijo del original evita choques y lo mantiene estable
  return s === original ? s : `${stem || 'media'}-${hex(sha1(original), 3)}${ext}`;
}

// ---------- Markdown → HTML escapado ----------
const md = new MarkdownIt({ html: false, linkify: false, breaks: true });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const PH = /[]/g;
const IMG = /\.(png|jpe?g|gif|webp|svg|heic|heif|avif|bmp)$/i;
const SND = /\.(mp3|m4a|wav|ogg)$/i;

interface Ctx {
  media: Map<string, string>;
  used: Set<string>;
}

function useMedia(ctx: Ctx, ref: string): string {
  const key = ref.trim().replace(/^media\//, '');
  let name = ctx.media.get(key);
  if (!name) ctx.media.set(key, (name = mediaName(key)));
  ctx.used.add(name);
  return name;
}

/** Markdown de Engrama → HTML de campo de Anki. `inline`: sin `<p>`. */
function html(text: string, ctx: Ctx, inline = true): string {
  const tags: string[] = [];
  const hold = (h: string) => `${tags.push(h) - 1}`;
  const src = text
    .replace(PH, '')
    .replace(/!\[\[([^\]\n]+)\]\]/g, (all, inner: string) => {
      const [ref, ...opts] = inner.split('|');
      const name = ref!.trim();
      if (IMG.test(name)) {
        const alt = /^alt/i.test(opts[opts.length - 1] ?? '') ? opts[opts.length - 1]!.replace(/^\s*alt:?\s?/i, '').trim() : '';
        return hold(`<img src="${esc(useMedia(ctx, name))}"${alt ? ` alt="${esc(alt)}"` : ''}>`);
      }
      if (SND.test(name)) return hold(`[sound:${esc(useMedia(ctx, name))}]`);
      return name;
    })
    .replace(/!\[([^\]\n]*)\]\((?![a-z][a-z0-9+.-]*:)([^)\s]+)(?:\s+"[^"]*")?\)/gi, (_, alt: string, ref: string) =>
      hold(`<img src="${esc(useMedia(ctx, decodeURI_(ref)))}"${alt ? ` alt="${esc(alt)}"` : ''}>`))
    .replace(/\[\[([^\]|\n]+)(?:\|([^\]\n]*))?\]\]/g, (_, a: string, b?: string) => (b ?? a).trim())
    .replace(/\[([^\]\n]+)\]\{(?:\.[a-z]+[ \t]*)+\}/g, '$1')
    .replace(/[ \t]*\{\.(centro|der|justificado)\}[ \t]*$/gm, '');
  let out = inline ? md.renderInline(src) : md.render(src).trim();
  // un marcador que cayó dentro de una etiqueta (alt, href…) no se sustituye: dejaría el atributo roto
  out = out.replace(/<[^>]*>/g, (tag) => tag.replace(PH, ''));
  out = out.replace(/(\d+)/g, (_, i: string) => tags[Number(i)] ?? '').replace(PH, '');
  return !inline && /^<p>(?:(?!<\/?p>)[\s\S])*<\/p>$/.test(out) ? out.slice(3, -4) : out;
}
function decodeURI_(s: string): string {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
}

const list = (tag: 'ul' | 'ol', items: string[], ctx: Ctx) => `<${tag}>${items.map((i) => `<li>${html(i, ctx)}</li>`).join('')}</${tag}>`;
const block = (a: string, b: string) => (a && b ? `${a}<br>${b}` : a || b);

function fieldsOf(n: Note, ctx: Ctx): { model: ModelKey; fields: string[] } {
  const q = () => html(n.front, ctx, false);
  switch (n.type) {
    case 'basic':
    case 'type':
      return { model: 'basic', fields: [q(), html(n.back, ctx, false)] };
    case 'reverse':
      return { model: 'reversed', fields: [q(), html(n.back, ctx, false)] };
    case 'cloze':
      return { model: 'cloze', fields: [html(n.front, ctx, false), ''] };
    case 'list':
    case 'order':
      return { model: 'basic', fields: [q(), list(n.type === 'list' ? 'ul' : 'ol', n.items, ctx)] };
    case 'olist':
      return { model: 'basic', fields: [q(), list('ol', n.items, ctx)] };
    case 'mc': {
      const front = block(q(), list('ul', n.options.map((o) => o.text), ctx));
      const right = list('ul', n.options.filter((o) => o.correct).map((o) => o.text), ctx);
      return { model: 'basic', fields: [front, block(right, html(n.back, ctx, false))] };
    }
    case 'match':
      return {
        model: 'basic',
        fields: [block(q(), list('ul', n.pairs.map((p) => p[0]), ctx)), list('ul', n.pairs.map((p) => `${p[0]} → ${p[1]}`), ctx)],
      };
    case 'io': {
      // oclusión de imagen: Anki legacy no la tiene; queda la imagen (una tarjeta Basic por nota)
      const img = html(n.front, ctx, false);
      return { model: 'basic', fields: [img, img] };
    }
  }
}

const NATIVE = new Set<NoteType>(['basic', 'reverse', 'cloze']);

function stripHtml(h: string): string {
  return h.replace(/<[^>]*>/g, '').replace(/&(lt|gt|quot|amp);/g, (_, e: string) => ({ lt: '<', gt: '>', quot: '"', amp: '&' })[e]!).trim();
}

/** Convierte un mazo parseado. `deckName` ya en formato Anki (`Carpeta::Mazo`, ver `deckNameOf`). */
export function mapDeck(deckName: string, deck: ParsedDeck, opts: MapOpts = {}): MapResult {
  const used = opts.used ?? new Set<number>();
  const res: MapResult = { deckName, deckId: ankiId(`deck:${deckName}`, used), notes: [], media: new Map(), converted: {}, skipped: 0 };
  for (const n of deck.notes) {
    if (!n.id || n.errors.length) {
      res.skipped++;
      continue;
    }
    const ctx: Ctx = { media: res.media, used: new Set() };
    const { model, fields } = fieldsOf(n, ctx);
    const sfld = stripHtml(fields[0]!);
    res.notes.push({
      id: ankiId(`note:${n.id}`, used),
      guid: guidFrom(n.id),
      model,
      fields,
      tags: [],
      sfld,
      csum: parseInt(hex(sha1(sfld), 4), 16),
      cards: cardsOf(n).map((c) => ({ id: ankiId(`card:${c.cid}`, used), ord: model === 'cloze' ? c.ord - 1 : model === 'reversed' ? c.ord : 0 })),
      media: [...ctx.used],
      src: n.id,
    });
    if (!NATIVE.has(n.type)) res.converted[n.type] = (res.converted[n.type] ?? 0) + 1;
  }
  return res;
}
