/**
 * Opciones de un embed de imagen: `![[foto.jpg|300|izq|alt Texto]]` (Notas-Pro · A3).
 * Tras el nombre, opciones separadas por `|` en cualquier orden:
 * - tamaño: `300` (px, 40–4000) o `40%` (5–100);
 * - alineación: `izq|der|centro` (alias `left|right|center`);
 * - texto alternativo: `alt …`, siempre el último; todo lo que sigue (incluidos `|`) es el alt.
 *   No puede contener `]]` (se quita `]` al guardarlo).
 * Lo que no se reconoce o no es válido se ignora al mostrar y se conserva literal al guardar.
 */
export type Align = 'izq' | 'der' | 'centro';
export interface Embed { name: string; w: { v: number; unit: 'px' | '%' } | null; align: Align | null; alt: string | null; rest: string[] }

const ALIGN: Record<string, Align> = { izq: 'izq', der: 'der', centro: 'centro', left: 'izq', right: 'der', center: 'centro' };

export function parseEmbed(inner: string): Embed {
  const parts = inner.split('|');
  const e: Embed = { name: parts[0]!.trim(), w: null, align: null, alt: null, rest: [] };
  for (let i = 1; i < parts.length; i++) {
    const s = parts[i]!.trim();
    const m = /^(\d+(?:\.\d+)?)(%?)$/.exec(s);
    if (/^alt(?:\s|:|$)/i.test(s)) {
      e.alt = [parts[i]!.replace(/^\s*alt:?\s?/i, ''), ...parts.slice(i + 1)].join('|').trim();
      break;
    } else if (m && !e.w) {
      const v = Number(m[1]);
      const pct = m[2] === '%';
      if (Number.isFinite(v) && (pct ? v >= 5 && v <= 100 : v >= 40 && v <= 4000 && Number.isInteger(v))) e.w = { v, unit: pct ? '%' : 'px' };
      else e.rest.push(parts[i]!);
    } else if (ALIGN[s.toLowerCase()] && !e.align) e.align = ALIGN[s.toLowerCase()]!;
    else e.rest.push(parts[i]!);
  }
  return e;
}

export function serializeEmbed(e: Embed): string {
  const out = [e.name];
  if (e.w) out.push(`${e.w.v}${e.w.unit === '%' ? '%' : ''}`);
  if (e.align) out.push(e.align);
  out.push(...e.rest);
  if (e.alt) out.push(`alt ${e.alt.replace(/\]/g, '').trim()}`);
  return out.join('|');
}

export const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|heic|heif|avif|bmp)$/i;
/** Embeds de imagen de un texto, en orden (para ubicar el n-ésimo y reescribirlo). */
export const EMBED_RE = /!\[\[([^\]\n]+)\]\]/g;

/** Reescribe el n-ésimo embed de imagen de `text` con `fn`; devuelve el texto igual si no existe. */
export function rewriteImageEmbed(text: string, n: number, fn: (e: Embed) => Embed): string {
  let k = -1;
  return text.replace(EMBED_RE, (all, inner: string) => {
    if (!IMG_EXT.test(inner.split('|')[0]!.trim())) return all;
    if (++k !== n) return all;
    return `![[${serializeEmbed(fn(parseEmbed(inner)))}]]`;
  });
}

/** El n-ésimo embed de imagen de un bloque, ya interpretado. */
export function nthImageEmbed(text: string, n: number): Embed | null {
  let k = -1;
  for (const m of text.matchAll(EMBED_RE)) if (IMG_EXT.test(m[1]!.split('|')[0]!.trim()) && ++k === n) return parseEmbed(m[1]!);
  return null;
}

const PLAIN = (s: string) => !!s.trim() && !/^\s*(#{1,6}\s|```|\||>|[-*+]\s|\d+[.)]\s|!\[\[)/.test(s);

/**
 * «Texto al lado» (A4): deja el embed al inicio de un párrafo para que el texto fluya junto a la
 * imagen. Si ya lo está, no cambia nada. Si no, lo quita de su bloque y lo antepone al párrafo
 * siguiente (o crea uno). Devuelve los bloques y cuál abrir para escribir.
 */
export function textBeside(blocks: string[], b: number, n: number): { blocks: string[]; edit: number } | null {
  let raw = '';
  let k = -1;
  const without = blocks[b]!.replace(EMBED_RE, (all, inner: string) => {
    if (!IMG_EXT.test(inner.split('|')[0]!.trim()) || ++k !== n) return all;
    raw = all;
    return '\u0000';
  });
  if (!raw) return null;
  const [before, after] = without.split('\u0000') as [string, string];
  if (!before.trim() && PLAIN(after)) return { blocks, edit: b }; // ya está al inicio de su párrafo
  const rest = (before.replace(/[ \t]+$/, '') + after.replace(/^[ \t]+/, '')).replace(/^\n+|\n+$/g, '');
  const out = [...blocks];
  let at = b + 1;
  if (rest.trim()) out[b] = rest;
  else (out.splice(b, 1), (at = b));
  if (at < out.length && PLAIN(out[at]!)) out[at] = `${raw} ${out[at]}`;
  else out.splice(at, 0, `${raw} `);
  return { blocks: out, edit: at };
}

/** Quita el n-ésimo embed de imagen (y el espacio que lo seguía); el archivo de media/ no se toca. */
export function removeImageEmbed(text: string, n: number): string {
  let k = -1;
  return text.replace(/!\[\[([^\]\n]+)\]\][ \t]?/g, (all, inner: string) => (IMG_EXT.test(inner.split('|')[0]!.trim()) && ++k === n ? '' : all));
}
