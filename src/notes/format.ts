/**
 * Edición de Markdown para la barra del editor (Prompt 17). Funciones puras: reciben el texto y la
 * selección y devuelven texto y selección nuevos. La nota sigue siendo Markdown legible.
 * Ninguna acción corta `[[ ]]`, `![[ ]]` ni código en línea; todas son idempotentes al repetirlas
 * dos veces (alternar = poner/quitar).
 */
export interface Sel { text: string; s: number; e: number }

export type Mark = '**' | '*' | '++' | '~~' | '==' | '`';
export const COLORS = ['azul', 'verde', 'indigo', 'naranja', 'rosa', 'rojo', 'morado', 'turquesa', 'menta', 'amarillo'] as const;
export const SIZES = ['pequeno', 'grande', 'muygrande'] as const;
export const ALIGNS = ['centro', 'der', 'justificado'] as const;
export type Align = (typeof ALIGNS)[number];

/** Tramos que no se pueden partir: `![[…]]`, `[[…]]` y código en línea. */
function atoms(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of text.matchAll(/!?\[\[[^\]\n]*\]\]|`[^`\n]*`/g)) out.push([m.index!, m.index! + m[0].length]);
  return out;
}
/** Ensancha la selección para no cortar un tramo indivisible. */
function snap(text: string, s: number, e: number): [number, number] {
  for (const [a, b] of atoms(text)) {
    if (s > a && s < b) s = a;
    if (e > a && e < b) e = b;
  }
  return [s, e];
}
/** Sin selección: la palabra bajo el cursor (letras, números, guion bajo; Unicode). */
export function wordAt(text: string, pos: number): [number, number] {
  const isW = (c: string | undefined) => !!c && /[\p{L}\p{N}_'’-]/u.test(c);
  let s = pos, e = pos;
  while (s > 0 && isW(text[s - 1])) s--;
  while (e < text.length && isW(text[e])) e++;
  return [s, e];
}

const re = (m: Mark) => m.replace(/[*+~=`]/g, '\\$&');
/** ¿El tramo [s,e) está envuelto por `m` (por fuera)? `*` no cuenta si es parte de `**`. */
function wrappedBy(text: string, s: number, e: number, m: Mark): boolean {
  if (text.slice(s - m.length, s) !== m || text.slice(e, e + m.length) !== m) return false;
  if (m === '*') return text[s - 2] !== '*' && text[e + 1] !== '*' || (text.slice(s - 3, s) === '***' && text.slice(e, e + 3) === '***');
  return true;
}

/** Marcas activas en la posición (para `aria-pressed`). */
export function activeMarks(text: string, pos: number): Set<Mark> {
  const out = new Set<Mark>();
  const ls = text.lastIndexOf('\n', pos - 1) + 1;
  const le = text.indexOf('\n', pos) === -1 ? text.length : text.indexOf('\n', pos);
  const line = text.slice(ls, le);
  const p = pos - ls;
  const pats: [Mark, RegExp][] = [['**', /\*\*(?=\S)(.+?)\*\*/g], ['*', /(?<!\*)\*(?!\*)(?=\S)(.+?)(?<!\*)\*(?!\*)/g], ['++', /\+\+(?=\S)(.+?)\+\+/g], ['~~', /~~(.+?)~~/g], ['==', /==(.+?)==/g], ['`', /`([^`]+)`/g]];
  for (const [m, r] of pats) for (const x of line.matchAll(r)) if (p > x.index! && p < x.index! + x[0].length) out.add(m);
  return out;
}

/** Alterna una marca de texto. Sin selección, sobre la palabra; sin palabra, deja el cursor entre las marcas. */
export function toggleMark(sel: Sel, m: Mark): Sel {
  let { text, s, e } = sel;
  if (s === e) [s, e] = wordAt(text, s);
  [s, e] = snap(text, s, e);
  // no envolver espacios de los bordes: `** x **` no es negrita
  while (s < e && /\s/.test(text[s]!)) s++;
  while (e > s && /\s/.test(text[e - 1]!)) e--;
  const n = m.length;
  if (s === e) return { text: text.slice(0, s) + m + m + text.slice(s), s: s + n, e: s + n };
  // quitar: marcas justo por fuera…
  if (wrappedBy(text, s, e, m)) return { text: text.slice(0, s - n) + text.slice(s, e) + text.slice(e + n), s: s - n, e: e - n };
  // …o dentro de la selección
  const inner = text.slice(s, e);
  if (inner.length > 2 * n && inner.startsWith(m) && inner.endsWith(m) && (m !== '*' || !inner.startsWith('**'))) return { text: text.slice(0, s) + inner.slice(n, -n) + text.slice(e), s, e: e - 2 * n };
  // …o el cursor está dentro de un tramo ya marcado: quitar ese tramo
  const ls = text.lastIndexOf('\n', s - 1) + 1;
  const line = text.slice(ls, text.indexOf('\n', e) === -1 ? text.length : text.indexOf('\n', e));
  for (const x of line.matchAll(new RegExp(`${re(m)}(?=\\S)(.+?)${re(m)}`, 'g'))) {
    const a = ls + x.index!, b = a + x[0].length;
    if (s >= a + n && e <= b - n && (m !== '*' || (text[a - 1] !== '*' && text[b] !== '*'))) return { text: text.slice(0, a) + x[1] + text.slice(b), s: s - n, e: e - n };
  }
  // poner: línea por línea si la selección cruza saltos (las marcas no cruzan líneas en una lista)
  // (después de la viñeta, el «>» o el «#» de cada línea)
  const parts = text.slice(s, e).split('\n').map((l, i) => {
    const pre = i ? /^\s*(?:[-*+]\s\[[ xX]\]\s|[-*+]\s|\d+[.)]\s|>\s?|#{1,6}\s)?/.exec(l)![0] : '';
    const t = l.slice(pre.length).trim();
    return t ? pre + l.slice(pre.length).replace(t, m + t + m) : l;
  });
  const out = parts.join('\n');
  return { text: text.slice(0, s) + out + text.slice(e), s: s + n, e: s + out.length - n };
}

/** Tramo `[texto]{.a .b}` que contiene la selección (o null). */
function spanAt(text: string, s: number, e: number): { a: number; b: number; inner: string; cls: string[] } | null {
  for (const x of text.matchAll(/\[([^\]\n]+)\]\{((?:\.[a-z]+\s*)+)\}/g)) {
    const a = x.index!, b = a + x[0].length;
    if (s >= a && e <= b) return { a, b, inner: x[1]!, cls: x[2]!.split(/\s+/).filter(Boolean).map((c) => c.slice(1)) };
  }
  return null;
}
/** Pone, cambia o quita (null) una clase de un grupo (color o tamaño) en `[texto]{.clase}`. */
export function setSpanClass(sel: Sel, group: readonly string[], cls: string | null): Sel {
  let { text, s, e } = sel;
  const sp = spanAt(text, s, e);
  if (sp) {
    const rest = sp.cls.filter((c) => !group.includes(c));
    const next = cls && !sp.cls.includes(cls) ? [...rest, cls] : rest;
    const rep = next.length ? `[${sp.inner}]{${next.map((c) => '.' + c).join(' ')}}` : sp.inner;
    const ns = sp.a + (next.length ? 1 : 0);
    return { text: text.slice(0, sp.a) + rep + text.slice(sp.b), s: ns, e: ns + sp.inner.length };
  }
  if (!cls) return sel;
  if (s === e) [s, e] = wordAt(text, s);
  [s, e] = snap(text, s, e);
  if (s === e || text.slice(s, e).includes('\n') || /[[\]]/.test(text.slice(s, e).replace(/!?\[\[[^\]]*\]\]/g, ''))) return sel;
  const inner = text.slice(s, e);
  return { text: `${text.slice(0, s)}[${inner}]{.${cls}}${text.slice(e)}`, s: s + 1, e: s + 1 + inner.length };
}

/** Quita marcas y tramos de clase dentro de la selección (o de la palabra). Respeta `[[ ]]` y el código. */
export function clearFormat(sel: Sel): Sel {
  let { text, s, e } = sel;
  if (s === e) [s, e] = wordAt(text, s);
  const sp = spanAt(text, s, e);
  if (sp) ({ text, s, e } = setSpanClass({ text, s, e }, [...COLORS, ...SIZES], null));
  // ampliar a las marcas que rodean la selección
  for (let k = 0; k < 4; k++) for (const m of ['**', '++', '~~', '==', '*'] as Mark[]) if (wrappedBy(text, s, e, m)) ({ text, s, e } = toggleMark({ text, s, e }, m));
  const seg = text.slice(s, e);
  const keep: string[] = [];
  const masked = seg.replace(/!?\[\[[^\]\n]*\]\]|`[^`\n]*`/g, (x) => `\u0000${keep.push(x) - 1}\u0000`);
  const clean = masked.replace(/\[([^\]\n]+)\]\{(?:\.[a-z]+\s*)+\}/g, '$1').replace(/\*\*|\+\+|~~|==|(?<![\w*])\*(?!\s)|(?<=\S)\*(?![\w*])/g, '').replace(/\u0000(\d+)\u0000/g, (_m, i: string) => keep[Number(i)]!);
  return { text: text.slice(0, s) + clean + text.slice(e), s, e: s + clean.length };
}

// ───────── párrafo ─────────

/** Límites del párrafo (bloque separado por líneas en blanco, sin partir un bloque de código) en la posición. */
export function paragraphAt(text: string, pos: number): [number, number] {
  const lines = text.split('\n');
  let off = 0, start = 0, fence = false, inPara = false, res: [number, number] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const blank = !fence && l.trim() === '';
    if (!blank && !inPara) (start = off), (inPara = true);
    if (/^```/.test(l)) fence = !fence;
    const end = off + l.length;
    if (inPara && (blank || i === lines.length - 1)) {
      const pe = blank ? off - 1 : end;
      if (pos >= start && pos <= pe + 1) res ??= [start, Math.max(start, pe)];
      inPara = false;
    }
    off = end + 1;
  }
  return res ?? [pos, pos];
}
/** Aplica `fn` al párrafo bajo el cursor; la selección se conserva en lo posible. */
export function onParagraph(sel: Sel, fn: (p: string) => string): Sel {
  const [a, b] = paragraphAt(sel.text, sel.s);
  const p = sel.text.slice(a, b);
  const q = fn(p);
  if (q === p) return sel;
  const d = q.length - p.length;
  const clamp = (x: number) => Math.max(a, Math.min(a + q.length, x + d));
  return { text: sel.text.slice(0, a) + q + sel.text.slice(b), s: clamp(sel.s), e: clamp(sel.e) };
}

export type Style = 'p' | 'h1' | 'h2' | 'h3' | 'quote' | 'code' | 'callout';
const ALIGN_RE = /[ \t]*\{\.(centro|der|justificado)\}[ \t]*$/;

export function styleOf(p: string): Style {
  if (/^```/.test(p)) return 'code';
  if (/^> ?\[!\w+\]/.test(p)) return 'callout';
  if (p.split('\n').every((l) => /^>/.test(l)) && p) return 'quote';
  const h = /^(#{1,3})\s/.exec(p);
  return h ? (`h${h[1]!.length}` as Style) : 'p';
}
/** Texto del párrafo sin su estilo (ni su alineación). */
function bare(p: string): string {
  const st = styleOf(p);
  let t = p.replace(ALIGN_RE, '');
  if (st === 'code') t = t.replace(/^```[^\n]*\n?/, '').replace(/\n?```\s*$/, '');
  else if (st === 'callout') t = t.replace(/^> ?\[!\w+\][+-]?\s?/, '').split('\n').map((l) => l.replace(/^> ?/, '')).join('\n');
  else if (st === 'quote') t = t.split('\n').map((l) => l.replace(/^> ?/, '')).join('\n');
  else t = t.replace(/^#{1,6}\s+/, '');
  return t;
}
export function setStyle(p: string, st: Style): string {
  const al = ALIGN_RE.exec(p)?.[0] ?? '';
  const t = bare(p);
  switch (st) {
    case 'p': return t + al;
    case 'h1': case 'h2': case 'h3': return `${'#'.repeat(Number(st[1]))} ${t.replace(/\n+/g, ' ')}${al}`;
    case 'quote': return t.split('\n').map((l) => `> ${l}`).join('\n');
    case 'callout': { const [first, ...rest] = t.split('\n'); return [`> [!note] ${first}`, ...rest.map((l) => `> ${l}`)].join('\n'); }
    case 'code': return '```\n' + t + '\n```';
  }
}

export const alignOf = (p: string): Align | null => (ALIGN_RE.exec(p)?.[1] as Align | undefined) ?? null;
/** Alineación de un párrafo o título con una marca final ` {.centro}`; izquierda = sin marca. */
export function setAlign(p: string, a: Align | null): string {
  if (!['p', 'h1', 'h2', 'h3'].includes(styleOf(p)) || /^\s*([-*+]\s|\d+[.)]\s|\||!\[\[)/.test(p)) return p; // listas, tablas e imágenes: no
  const t = p.replace(ALIGN_RE, '');
  return a && alignOf(p) !== a ? `${t} {.${a}}` : t;
}

// ───────── listas ─────────

export type ListKind = 'ul' | 'ol' | 'task';
const LIST_RE = /^(\s*)(?:[-*+]\s\[[ xX]\]\s|[-*+]\s|\d+[.)]\s)/;
const kindOf = (l: string): ListKind | null => (/^\s*[-*+]\s\[[ xX]\]\s/.test(l) ? 'task' : /^\s*[-*+]\s/.test(l) ? 'ul' : /^\s*\d+[.)]\s/.test(l) ? 'ol' : null);

/** Líneas tocadas por la selección dentro del párrafo. */
function lineSpan(sel: Sel): [number, number] {
  const a = sel.text.lastIndexOf('\n', sel.s - 1) + 1;
  const i = sel.text.indexOf('\n', Math.max(sel.s, sel.e - 1));
  return [a, i === -1 ? sel.text.length : i];
}
/** Convierte las líneas seleccionadas a una lista (o la quita si ya son de ese tipo). */
export function toggleList(sel: Sel, kind: ListKind): Sel {
  const [a, b] = lineSpan(sel);
  const lines = sel.text.slice(a, b).split('\n');
  const all = lines.filter((l) => l.trim()).every((l) => kindOf(l) === kind);
  let n = 0;
  const out = lines.map((l) => {
    if (!l.trim()) return l;
    const ind = /^\s*/.exec(l)![0];
    const body = l.replace(LIST_RE, '').replace(/^\s+/, '');
    if (all) return ind + body;
    return ind + (kind === 'ul' ? '- ' : kind === 'task' ? '- [ ] ' : `${++n}. `) + body;
  }).join('\n');
  const d = out.length - (b - a);
  return { text: sel.text.slice(0, a) + out + sel.text.slice(b), s: Math.max(a, sel.s + (lines.length === 1 ? d : 0)), e: Math.max(a, sel.e + d) };
}
/** Sangría ± de las líneas seleccionadas (dos espacios; en listas cambia el nivel). */
export function indent(sel: Sel, dir: 1 | -1): Sel {
  const [a, b] = lineSpan(sel);
  const lines = sel.text.slice(a, b).split('\n');
  let first = 0;
  const out = lines.map((l, i) => {
    if (!l.trim()) return l;
    const r = dir > 0 ? '  ' + l : l.replace(/^ {1,2}|^\t/, '');
    if (i === 0) first = r.length - l.length;
    return r;
  }).join('\n');
  const d = out.length - (b - a);
  return { text: sel.text.slice(0, a) + out + sel.text.slice(b), s: Math.max(a, sel.s + first), e: Math.max(a, sel.e + d) };
}
/** Mueve el elemento de lista bajo el cursor (con sus hijos) arriba o abajo entre sus hermanos. */
export function moveListItem(sel: Sel, dir: 1 | -1): Sel | null {
  const lines = sel.text.split('\n');
  const at = sel.text.slice(0, sel.s).split('\n').length - 1;
  if (!kindOf(lines[at] ?? '')) return null;
  const ind = (l: string) => /^\s*/.exec(l)![0].length;
  const item = (i: number): [number, number] => { let j = i + 1; while (j < lines.length && lines[j]!.trim() && ind(lines[j]!) > ind(lines[i]!)) j++; return [i, j]; };
  const [s0, e0] = item(at);
  let other: [number, number] | null = null;
  if (dir > 0) { if (e0 < lines.length && kindOf(lines[e0]!) && ind(lines[e0]!) === ind(lines[at]!)) other = item(e0); }
  else for (let k = at - 1; k >= 0 && lines[k]!.trim() && kindOf(lines[k]!); k--) { if (ind(lines[k]!) === ind(lines[at]!)) { other = item(k); break; } if (ind(lines[k]!) < ind(lines[at]!)) break; }
  if (!other) return null;
  const [x, y] = dir > 0 ? [[s0, e0], other] : [other, [s0, e0]];
  const out = [...lines.slice(0, x[0]), ...lines.slice(y[0], y[1]), ...lines.slice(x[0], x[1]), ...lines.slice(y[1])];
  const text = out.join('\n');
  const newLine = dir > 0 ? s0 + (other[1] - other[0]) : other[0];
  const col = sel.s - (sel.text.lastIndexOf('\n', sel.s - 1) + 1);
  const off = out.slice(0, newLine).reduce((n, l) => n + l.length + 1, 0) + col;
  return { text, s: off, e: off + (sel.e - sel.s) };
}

// ───────── tablas (GFM) ─────────

export type ColAlign = '' | 'l' | 'c' | 'r';
export interface Table { a: number; b: number; rows: string[][]; align: ColAlign[]; row: number; col: number }
const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim());

export function makeTable(cols: number, rows: number, head: (i: number) => string): string {
  const h = Array.from({ length: cols }, (_, i) => head(i + 1));
  return fmt({ rows: [h, ...Array.from({ length: rows - 1 }, () => h.map(() => ''))], align: h.map(() => '' as ColAlign) }, false);
}
/** Tabla en la posición (líneas que empiezan con `|`, con fila separadora). */
export function tableAt(text: string, pos: number): Table | null {
  const lines = text.split('\n');
  let off = 0;
  const starts = lines.map((l) => { const o = off; off += l.length + 1; return o; });
  const at = text.slice(0, pos).split('\n').length - 1;
  if (!/^\s*\|/.test(lines[at] ?? '')) return null;
  let i = at, j = at;
  while (i > 0 && /^\s*\|/.test(lines[i - 1]!)) i--;
  while (j < lines.length - 1 && /^\s*\|/.test(lines[j + 1]!)) j++;
  const sep = lines[i + 1];
  if (!sep || !/^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(sep)) return null;
  const align = cells(sep).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'c' : c.endsWith(':') ? 'r' : c.startsWith(':') ? 'l' : '') as ColAlign);
  const rows = [cells(lines[i]!), ...lines.slice(i + 2, j + 1).map(cells)];
  const w = Math.max(align.length, ...rows.map((r) => r.length));
  for (const r of rows) while (r.length < w) r.push('');
  while (align.length < w) align.push('');
  const lineInPos = pos - starts[at]!;
  const col = Math.max(0, (lines[at]!.slice(0, lineInPos).match(/(?<!\\)\|/g)?.length ?? 1) - 1);
  const row = at === i ? 0 : at === i + 1 ? 0 : at - i - 1;
  return { a: starts[i]!, b: starts[j]! + lines[j]!.length, rows, align, row, col: Math.min(col, w - 1) };
}
/** Texto de una tabla; `pad` = columnas alineadas («Ajustar columnas»). */
export function fmt(t: { rows: string[][]; align: ColAlign[] }, pad: boolean): string {
  const w = t.align.map((_, c) => (pad ? Math.max(3, ...t.rows.map((r) => [...(r[c] ?? '')].length)) : 3));
  const cell = (s: string, c: number) => (pad ? s + ' '.repeat(Math.max(0, w[c]! - [...s].length)) : s);
  const sep = t.align.map((a, c) => { const n = w[c]!; return a === 'c' ? ':' + '-'.repeat(n - 2) + ':' : a === 'r' ? '-'.repeat(n - 1) + ':' : a === 'l' ? ':' + '-'.repeat(n - 1) : '-'.repeat(n); });
  const line = (r: string[]) => `| ${r.map((s, c) => cell(s, c)).join(' | ')} |`;
  return [line(t.rows[0]!), `| ${sep.join(' | ')} |`, ...t.rows.slice(1).map(line)].join('\n');
}
export type TableOp = 'addRow' | 'delRow' | 'addCol' | 'delCol' | 'fit' | ColAlign;
export function tableOp(sel: Sel, op: TableOp): Sel | null {
  const t = tableAt(sel.text, sel.s);
  if (!t) return null;
  const rows = t.rows.map((r) => [...r]);
  const align = [...t.align];
  if (op === 'addRow') rows.splice(t.row + 1, 0, rows[0]!.map(() => ''));
  else if (op === 'delRow') { if (t.row === 0 || rows.length <= 2) return null; rows.splice(t.row, 1); }
  else if (op === 'addCol') { rows.forEach((r) => r.splice(t.col + 1, 0, '')); align.splice(t.col + 1, 0, ''); }
  else if (op === 'delCol') { if (align.length <= 1) return null; rows.forEach((r) => r.splice(t.col, 1)); align.splice(t.col, 1); }
  else if (op !== 'fit') align[t.col] = op;
  const out = fmt({ rows, align }, op === 'fit');
  const s = Math.min(t.a + out.length, sel.s);
  return { text: sel.text.slice(0, t.a) + out + sel.text.slice(t.b), s, e: s };
}

// ───────── bloques ─────────

/** Rango [i, j) de un bloque; con `section`, un título se lleva lo que hay bajo él hasta otro título de igual o mayor nivel. */
function blockRange(blocks: string[], i: number, section: boolean): [number, number] {
  const h = /^(#{1,6})\s/.exec(blocks[i] ?? '');
  if (!section || !h) return [i, i + 1];
  let j = i + 1;
  while (j < blocks.length && !(/^(#{1,6})\s/.exec(blocks[j]!) && /^(#{1,6})\s/.exec(blocks[j]!)![1]!.length <= h[1]!.length)) j++;
  return [i, j];
}
/** Mueve un bloque (o una sección) una posición arriba o abajo. Devuelve los bloques y el nuevo índice. */
export function moveBlock(blocks: string[], i: number, dir: 1 | -1, section = false): { blocks: string[]; i: number } | null {
  const [a, b] = blockRange(blocks, i, section);
  if (dir < 0) {
    if (a === 0) return null;
    // el vecino de arriba entero: el primer bloque cuyo rango (bloque o sección) termina justo aquí
    let p = a - 1;
    for (let k = 0; k < a; k++) if (blockRange(blocks, k, section)[1] === a) { p = k; break; }
    const out = [...blocks.slice(0, p), ...blocks.slice(a, b), ...blocks.slice(p, a), ...blocks.slice(b)];
    return { blocks: out, i: p };
  }
  if (b >= blocks.length) return null;
  const [, nb] = blockRange(blocks, b, section);
  const out = [...blocks.slice(0, a), ...blocks.slice(b, nb), ...blocks.slice(a, b), ...blocks.slice(nb)];
  return { blocks: out, i: a + (nb - b) };
}
export const duplicateBlock = (blocks: string[], i: number) => [...blocks.slice(0, i + 1), blocks[i]!, ...blocks.slice(i + 1)];
export const removeBlock = (blocks: string[], i: number) => blocks.filter((_, k) => k !== i);
export function mergeWithPrev(blocks: string[], i: number): string[] | null {
  if (i <= 0) return null;
  return [...blocks.slice(0, i - 1), `${blocks[i - 1]}\n${blocks[i]}`, ...blocks.slice(i + 1)];
}
