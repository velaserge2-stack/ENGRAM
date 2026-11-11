import { t } from '../i18n';
/**
 * Parser de mazos (SPEC §4 y §4b). Un mazo es Markdown: el texto libre se
 * conserva tal cual y cada tarjeta es un bloque que empieza con un prefijo
 * (`Q::`, `Cloze:` …) y termina en una línea en blanco. El bloque acaba con un
 * ID `^xxxx` que la app añade si falta (ensureIds).
 */
import { parseFrontmatter, type Frontmatter } from '../lib/frontmatter';

export type NoteType = 'basic' | 'reverse' | 'type' | 'cloze' | 'io' | 'list' | 'olist' | 'mc' | 'match' | 'order';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Note {
  id: string;
  type: NoteType;
  front: string;
  back: string;
  items: string[];
  options: { text: string; correct: boolean }[];
  pairs: [string, string][];
  clozes: number[];
  image: string;
  rects: Rect[];
  ioAll: boolean;
  /** Línea (0-based, en el cuerpo) donde empieza el bloque. */
  line: number;
  endLine: number;
  raw: string;
  errors: string[];
  origin: string | null;
  src: string | null;
}

export interface CardRef {
  /** ID de tarjeta: nota + ordinal (`c01a`, `c01a:r`, `c02b:c2`, `c03c:o1`). */
  cid: string;
  note: Note;
  /** Para cloze: número; para oclusión: índice del rectángulo; reversa: 1 = vuelta. */
  ord: number;
}

export interface ParsedDeck {
  data: Frontmatter;
  body: string;
  notes: Note[];
  /** Bloques sin ID (ensureIds los completa). */
  missingIds: number;
  errors: string[];
}

const START = /^(QR|Q|T|LO|L|MC|MATCH|ORD)::\s?(.*)$|^(Cloze|IO):\s?(.*)$/;
const ID_RE = /\s\^([A-Za-z0-9_-]{2,40})\s*$/;
const META_RE = /<!--\s*(origen|src):\s*([^>]*?)\s*-->/g;

const TYPE_OF: Record<string, NoteType> = {
  Q: 'basic', QR: 'reverse', T: 'type', L: 'list', LO: 'olist', MC: 'mc', MATCH: 'match', ORD: 'order', Cloze: 'cloze', IO: 'io',
};

export function isCardStart(line: string): boolean {
  return START.test(line);
}

interface Block {
  start: number;
  end: number;
  lines: string[];
}

/** Separa el cuerpo en bloques de tarjeta (índices de línea inclusivos). */
export function blocks(body: string): Block[] {
  const lines = body.split(/\r?\n/);
  const out: Block[] = [];
  let cur: Block | null = null;
  lines.forEach((line, i) => {
    if (START.test(line)) {
      if (cur) out.push(cur);
      cur = { start: i, end: i, lines: [line] };
    } else if (cur) {
      if (line.trim() === '' || /^#{1,6}\s/.test(line)) {
        out.push(cur);
        cur = null;
      } else {
        cur.lines.push(line);
        cur.end = i;
      }
    }
  });
  if (cur) out.push(cur);
  return out;
}

const listItem = (l: string) => /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(l)?.[1];

function parseBlock(b: Block): Note {
  const lines = [...b.lines];
  let id = '';
  const last = lines[lines.length - 1]!;
  const m = ID_RE.exec(last);
  if (m) {
    id = m[1]!;
    lines[lines.length - 1] = last.slice(0, m.index);
  }
  let origin: string | null = null;
  let src: string | null = null;
  const clean = lines.map((l) =>
    l.replace(META_RE, (_, k: string, v: string) => {
      if (k === 'origen') origin = v;
      else src = v;
      return '';
    }),
  );
  const head = START.exec(clean[0]!)!;
  const isIO = /^IO:/.test(clean[0]!);
  if (!isIO) for (let i = 0; i < clean.length; i++) clean[i] = clean[i]!.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+$/, '');
  const key = head[1] ?? head[3]!;
  const type = TYPE_OF[key]!;
  const note: Note = {
    id, type, front: '', back: '', items: [], options: [], pairs: [], clozes: [], image: '', rects: [], ioAll: false,
    line: b.start, endLine: b.end, raw: b.lines.join('\n'), errors: [], origin, src,
  };
  const first = (head[2] ?? head[4] ?? '').trim();
  const rest = clean.slice(1);

  switch (type) {
    case 'basic':
    case 'reverse':
    case 'type': {
      const ai = rest.findIndex((l) => /^A::/.test(l));
      const q = [first, ...(ai < 0 ? rest : rest.slice(0, ai))];
      note.front = q.join('\n').trim();
      if (ai < 0) note.errors.push(t('parse.falta_la_respuesta_a'));
      else note.back = [rest[ai]!.replace(/^A::\s?/, ''), ...rest.slice(ai + 1)].join('\n').trim();
      if (!note.front) note.errors.push(t('parse.pregunta_vacia'));
      break;
    }
    case 'cloze': {
      note.front = [first, ...rest].join('\n').trim();
      note.clozes = [...new Set([...note.front.matchAll(/\{\{c(\d+)::/g)].map((x) => Number(x[1])))].sort((a, b) => a - b);
      if (!note.clozes.length) note.errors.push('Cloze sin huecos {{c1::…}}');
      break;
    }
    case 'io': {
      const all = [first, ...rest].join('\n');
      note.image = /!\[\[([^\]|]+)/.exec(all)?.[1]?.trim() ?? /!\[[^\]]*\]\(([^)]+)\)/.exec(all)?.[1] ?? '';
      const io = /<!--\s*io(-all)?:\s*([^>]*?)\s*-->/.exec(all);
      note.ioAll = !!io?.[1];
      for (const r of (io?.[2] ?? '').split(';')) {
        const n = r.split(',').map((x) => Number(x.trim()));
        if (n.length === 4 && n.every((v) => Number.isFinite(v))) note.rects.push({ x: n[0]!, y: n[1]!, w: n[2]!, h: n[3]! });
      }
      note.front = all.replace(/<!--[\s\S]*?-->/g, '').trim();
      if (!note.image) note.errors.push(t('parse.oclusion_sin_imagen'));
      if (!note.rects.length) note.errors.push(t('parse.oclusion_sin_rectangulos'));
      break;
    }
    case 'list':
    case 'olist':
    case 'order': {
      note.front = first;
      note.items = rest.map((l) => listItem(l) ?? l.trim()).filter(Boolean);
      if (note.items.length < 2) note.errors.push(t('parse.se_necesitan_al_menos_2_elementos'));
      break;
    }
    case 'mc': {
      const q: string[] = [first];
      for (const l of rest) {
        const o = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(l);
        if (o) note.options.push({ text: o[2]!.trim(), correct: o[1] !== ' ' });
        else if (/^A::|^Explicación::/.test(l)) note.back = l.replace(/^(A|Explicación)::\s?/, '');
        else if (!note.options.length) q.push(l);
      }
      note.front = q.join('\n').trim();
      if (note.options.length < 2) note.errors.push(t('parse.opcion_multiple_con_menos_de_2'));
      if (!note.options.some((o) => o.correct)) note.errors.push(t('parse.sin_opcion_correcta_marcada_x'));
      break;
    }
    case 'match': {
      note.front = first;
      for (const l of rest) {
        const p = /^\s*(?:[-*]\s+)?(.+?)\s*(?:=>|→)\s*(.+)$/.exec(l);
        if (p) note.pairs.push([p[1]!.trim(), p[2]!.trim()]);
      }
      if (note.pairs.length < 2) note.errors.push('Unir necesita al menos 2 pares "a => b"');
      break;
    }
  }
  return note;
}

export function parseDeck(text: string): ParsedDeck {
  const doc = parseFrontmatter(text);
  const notes = blocks(doc.body).map(parseBlock);
  const seen = new Set<string>();
  const errors = [...doc.errors];
  for (const n of notes) {
    if (!n.id) continue;
    if (seen.has(n.id)) {
      n.errors.push(t('parse.id_repetido_id', { id: n.id }));
      errors.push(t('parse.id_repetido_id_linea_p', { id: n.id, p: n.line + 1 }));
    }
    seen.add(n.id);
  }
  return { data: doc.data, body: doc.body, notes, missingIds: notes.filter((n) => !n.id).length, errors };
}

/** Tarjetas que genera una nota. */
export function cardsOf(note: Note): CardRef[] {
  if (!note.id) return [];
  switch (note.type) {
    case 'reverse':
      return [{ cid: note.id, note, ord: 0 }, { cid: `${note.id}:r`, note, ord: 1 }];
    case 'cloze':
      return note.clozes.map((n) => ({ cid: `${note.id}:c${n}`, note, ord: n }));
    case 'io':
      return note.ioAll ? [{ cid: note.id, note, ord: -1 }] : note.rects.map((_, i) => ({ cid: `${note.id}:o${i + 1}`, note, ord: i }));
    default:
      return [{ cid: note.id, note, ord: 0 }];
  }
}

export function noteIdOf(cid: string): string {
  return cid.split(':')[0]!;
}

export function newId(taken: Set<string>, rnd: () => number = Math.random): string {
  for (;;) {
    const id = Math.floor(rnd() * 36 ** 5).toString(36).padStart(5, '0');
    if (!taken.has(id) && /[a-z]/.test(id)) {
      taken.add(id);
      return id;
    }
  }
}

/** Añade `^id` a los bloques que no lo tienen. Devuelve el texto completo (con frontmatter). */
export function ensureIds(text: string, taken = new Set<string>(), rnd?: () => number): { text: string; added: string[] } {
  const doc = parseFrontmatter(text);
  const fmLen = text.length - doc.body.length;
  const head = text.slice(0, fmLen);
  const lines = doc.body.split(/\r?\n/);
  for (const n of parseDeck(text).notes) if (n.id) taken.add(n.id);
  const added: string[] = [];
  for (const b of blocks(doc.body)) {
    const last = lines[b.end]!;
    if (ID_RE.test(last)) continue;
    const id = newId(taken, rnd);
    lines[b.end] = `${last.replace(/\s+$/, '')} ^${id}`;
    added.push(id);
  }
  return { text: added.length ? head + lines.join('\n') : text, added };
}

/** Sustituye el bloque de una nota (editar durante el repaso). */
export function replaceBlock(text: string, noteId: string, newRaw: string): string {
  const doc = parseFrontmatter(text);
  const head = text.slice(0, text.length - doc.body.length);
  const lines = doc.body.split(/\r?\n/);
  const n = parseDeck(text).notes.find((x) => x.id === noteId);
  if (!n) return text;
  const raw = ID_RE.test(newRaw.split('\n').pop()!) ? newRaw : `${newRaw.replace(/\s+$/, '')} ^${noteId}`;
  lines.splice(n.line, n.endLine - n.line + 1, ...raw.split('\n'));
  return head + lines.join('\n');
}

/** Normaliza para comparar respuestas escritas: sin mayúsculas, acentos ni puntuación. */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

export type TypedVerdict = 'correct' | 'almost' | 'wrong';

export function checkTyped(given: string, expected: string): TypedVerdict {
  const plain = (s: string) => normalizeAnswer(s.replace(/\[([^\]]*)\]\{\.[^}]+\}/g, '$1').replace(/[*_=`]/g, ''));
  const a = plain(given);
  const b = plain(expected);
  if (!a) return 'wrong';
  if (a === b) return 'correct';
  return levenshtein(a, b) <= Math.max(1, Math.floor(b.length * 0.15)) ? 'almost' : 'wrong';
}

/** Calificación automática de tarjetas interactivas (SPEC §4b). */
export function autoGrade(errors: number, ms: number, items: number): 1 | 2 | 3 | 4 {
  if (errors === 0) return ms > 0 && ms < items * 4000 ? 4 : 3;
  if (errors <= 2) return 2;
  return 1;
}
