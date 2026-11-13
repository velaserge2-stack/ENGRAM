/**
 * Buscador de notas (Mejoras 2 · D11). Puro: lo usan el Worker (`search.worker.ts`) y las pruebas.
 *
 * - Los tokens conservan números y símbolos internos: `120/80`, `37.5`, `5-HT`, `mg/dL`, `pH`;
 *   además se indexan sus partes (`5-HT` → `5`, `ht`), así «HT» encuentra «5-HT».
 * - Sin acentos ni mayúsculas (se pliega con un mapa de posiciones al texto original, para
 *   resaltar y abrir la nota en la coincidencia exacta).
 * - Los números son exactos: «12» no encuentra «120»; las palabras admiten prefijo.
 */
import MiniSearch from 'minisearch';

const TOKEN = /[\p{L}\p{N}]+(?:[./\-,][\p{L}\p{N}]+)*/gu;
const isNum = (t: string) => /\d/.test(t);

/** Minúsculas sin diacríticos, carácter por carácter, con el índice original de cada uno. */
function foldMap(s: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const f = s[i]!.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (const ch of f) (text += ch, map.push(i));
  }
  map.push(s.length);
  return { text, map };
}
export const fold = (s: string) => foldMap(s).text;

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of fold(text).matchAll(TOKEN)) {
    const t = m[0].replace(/[.,]$/, '');
    out.push(t);
    if (/[./\-,]/.test(t)) for (const p of t.split(/[./\-,]/)) if (p) out.push(p);
  }
  return out;
}

/** Términos de la consulta (sin partir los compuestos: «120/80» se busca entero). */
function queryTerms(q: string): string[] {
  return [...new Set([...fold(q).matchAll(TOKEN)].map((m) => m[0].replace(/[.,]$/, '')))];
}

export interface SearchDoc { id: string; title: string; body: string; materia: string; tema: string; fecha: string; thumb?: string }

export function createIndex(): MiniSearch<SearchDoc> {
  return new MiniSearch<SearchDoc>({
    fields: ['title', 'body'],
    storeFields: ['title', 'materia', 'tema', 'fecha'],
    tokenize,
    processTerm: (t) => t || null,
    searchOptions: {
      tokenize: queryTerms,
      processTerm: (t) => t || null,
      combineWith: 'AND',
      boost: { title: 3 },
      prefix: (t) => !isNum(t),
      fuzzy: (t) => (isNum(t) || t.length < 5 ? false : 0.15),
    },
  });
}

export interface Hit { start: number; end: number }

/** Coincidencias de la consulta en un texto (posiciones del texto original). */
export function findHits(text: string, q: string): Hit[] {
  const terms = queryTerms(q);
  if (!terms.length) return [];
  const { text: f, map } = foldMap(text);
  const hits: Hit[] = [];
  const word = /[\p{L}\p{N}]/u;
  for (const term of terms) {
    for (let i = f.indexOf(term); i >= 0; i = f.indexOf(term, i + 1)) {
      const before = f[i - 1], after = f[i + term.length];
      if (before && word.test(before)) continue; // inicio de palabra
      // números exactos: no seguir con otro dígito («12» ≠ «120»); palabras: prefijo
      if (isNum(term) && after && /[\p{N}]/u.test(after)) continue;
      if (isNum(term) && after && /[./,]/.test(after) && /\p{N}/u.test(f[i + term.length + 1] ?? '')) continue; // «37» ≠ «37.5»
      hits.push({ start: map[i]!, end: map[i + term.length]! });
    }
  }
  return hits.sort((a, b) => a.start - b.start).filter((h, i, a) => !i || h.start >= a[i - 1]!.end);
}

/** Fragmento alrededor de la primera coincidencia, dividido en trozos normales y resaltados. */
export function snippet(text: string, hits: Hit[], radius = 60): { parts: { t: string; hit: boolean }[]; at: number } {
  const clean = text.replace(/\s+/g, ' ');
  const first = hits[0];
  if (!first) return { parts: [{ t: clean.slice(0, radius * 2), hit: false }], at: -1 };
  // las posiciones se recalculan sobre el texto con espacios colapsados
  const ch = findHitsIn(clean, text, hits);
  const a = Math.max(0, ch[0]!.start - radius), b = Math.min(clean.length, ch[0]!.end + radius);
  const parts: { t: string; hit: boolean }[] = [];
  let cur = a;
  for (const h of ch) {
    if (h.end <= a || h.start >= b) continue;
    if (h.start > cur) parts.push({ t: clean.slice(cur, h.start), hit: false });
    parts.push({ t: clean.slice(Math.max(h.start, cur), Math.min(h.end, b)), hit: true });
    cur = Math.min(h.end, b);
  }
  if (cur < b) parts.push({ t: clean.slice(cur, b), hit: false });
  if (a > 0) parts.unshift({ t: '… ', hit: false });
  if (b < clean.length) parts.push({ t: ' …', hit: false });
  return { parts, at: 0 };
}

function findHitsIn(clean: string, raw: string, hits: Hit[]): Hit[] {
  // mapa raw → clean (colapsar espacios)
  const m: number[] = [];
  let j = 0;
  for (let i = 0; i < raw.length; i++) {
    m.push(j);
    if (!(/\s/.test(raw[i]!) && /\s/.test(raw[i - 1] ?? ''))) j++;
  }
  m.push(j);
  return hits.map((h) => ({ start: m[h.start]!, end: m[h.end]! })).filter((h) => h.end <= clean.length);
}
