import { t } from '../i18n';
/**
 * Notas con estructura fija (SPEC §10c): Materia → Tema/Clase → Notas.
 *   notes/<Materia>/<Tema>/<Nota>.md      notas de clase
 *   notes/Diario/<AAAA-MM-DD>.md          notas diarias
 *   inbox/<id>/…                          bandeja (sin clasificar)
 * Historial de versiones en .app/history/, papelera en .app/trash/.
 */
import { levenshtein, normalizeAnswer, parseDeck } from '../cards/parse';
import { parseFrontmatter, stringifyFrontmatter, type Frontmatter } from '../lib/frontmatter';
import { basename, dirname } from '../vault/paths';
import type { VaultAdapter } from '../vault/types';
import { readTextOr, walk } from '../vault/util';

export const DAILY = 'Diario';
const HISTORY = '.app/history';
const TRASH = '.app/trash';

export interface NoteMeta {
  path: string;
  title: string;
  materia: string;
  tema: string;
  structured: boolean;
}

export function noteMeta(path: string): NoteMeta {
  const parts = path.split('/').slice(1);
  const title = basename(path).replace(/\.md$/, '');
  if (parts[0] === DAILY && parts.length === 2) return { path, title, materia: DAILY, tema: '', structured: true };
  // Prompt 12: con materia y sin tema (notes/<Materia>/<Título>.md) va dentro de su materia, en «Sin tema»
  if (parts.length === 2) return { path, title, materia: parts[0]!, tema: '', structured: true };
  return parts.length === 3 ? { path, title, materia: parts[0]!, tema: parts[1]!, structured: true } : { path, title, materia: parts.length > 1 ? parts[0]! : '', tema: '', structured: false };
}

/** Nombre seguro: sin caracteres prohibidos y ≤ 200 bytes (sin partir un emoji ni el sufijo « (2)»). */
export function safeSegment(s: string): string {
  const c = s.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+/, '').trim();
  const [, base = c, suf = ''] = /^(.*?)( \(\d+\))?$/.exec(c) ?? [];
  const enc = new TextEncoder();
  let out = '';
  for (const ch of base) { if (enc.encode(out + ch + suf).length > 200) break; out += ch; }
  return (out.trim() + suf).trim();
}

/**
 * Ruta de una nota nueva. Solo el título es obligatorio (Prompt 12):
 * materia y tema → notes/<Materia>/<Tema>/<Título>.md · solo materia → notes/<Materia>/<Título>.md ·
 * sin materia (con o sin tema) → notes/<Título>.md («Sin clasificar»; el tema queda en el frontmatter).
 */
export function notePath(materia: string, tema: string, title: string): string {
  const name = safeSegment(title) || t('inbox.sin_titulo');
  if (materia === DAILY) return `notes/${DAILY}/${name}.md`;
  const m = safeSegment(materia), tm = safeSegment(tema);
  return m ? (tm ? `notes/${m}/${tm}/${name}.md` : `notes/${m}/${name}.md`) : `notes/${name}.md`;
}

export async function listNotes(vault: VaultAdapter): Promise<NoteMeta[]> {
  return (await walk(vault, 'notes')).filter((f) => f.path.endsWith('.md')).map((f) => noteMeta(f.path));
}

export interface Tree {
  materia: string;
  temas: { tema: string; notes: NoteMeta[] }[];
}

export function buildTree(notes: NoteMeta[], extraMaterias: string[] = []): { tree: Tree[]; loose: NoteMeta[]; daily: NoteMeta[] } {
  const m = new Map<string, Map<string, NoteMeta[]>>();
  for (const x of extraMaterias) m.set(x, new Map());
  const loose: NoteMeta[] = [];
  const daily: NoteMeta[] = [];
  for (const n of notes) {
    if (n.materia === DAILY) daily.push(n);
    else if (!n.structured) loose.push(n);
    else {
      const t = m.get(n.materia) ?? m.set(n.materia, new Map()).get(n.materia)!;
      (t.get(n.tema) ?? t.set(n.tema, []).get(n.tema)!).push(n);
    }
  }
  const tree = [...m].sort(([a], [b]) => a.localeCompare(b, 'es')).map(([materia, t]) => ({ materia, temas: [...t].sort(([a], [b]) => a.localeCompare(b, 'es')).map(([tema, ns]) => ({ tema, notes: ns.sort((a, b) => a.title.localeCompare(b.title, 'es')) })) }));
  return { tree, loose, daily: daily.sort((a, b) => b.title.localeCompare(a.title)) };
}

// ───────── plantillas ─────────

export const TEMPLATES: Record<string, string> = {
  Clase: '# {{titulo}}\n\n## Fuente\n\n## Resumen\n\n## Puntos clave\n- \n\n## Imágenes\n\n## Tarjetas\n\n## Pendientes\n- [ ] \n',
  Resumen: '# {{titulo}}\n\n> [!abstract] En una frase\n> \n\n## Ideas principales\n1. \n\n## Conceptos\n\n## Dudas\n',
  'Caso clínico': '# {{titulo}}\n\n## Presentación\n\n## Antecedentes\n\n## Exploración\n\n## Estudios\n\n## Diagnóstico diferencial\n| Diagnóstico | A favor | En contra |\n|---|---|---|\n|  |  |  |\n\n## Diagnóstico\n\n## Tratamiento\n\n## Perlas\n',
  'Repaso de examen': '# {{titulo}}\n\n## Temas\n- [ ] \n\n## Lo que más fallo\n\n## Fórmulas y cifras\n\n## Plan hasta el {{fecha}}\n',
  Cornell: '# {{titulo}}\n\n| Preguntas clave | Notas |\n|---|---|\n|  |  |\n\n## Resumen\n',
  'Nota diaria': '# {{fecha}}\n\n## Plan del día\n- [ ] \n\n## Estudié\n\n## Notas rápidas\n',
};

export function fillTemplate(t: string, title: string, now = new Date()): string {
  const fecha = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const hora = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return t.replace(/\{\{\s*titulo\s*\}\}/g, title).replace(/\{\{\s*fecha\s*\}\}/g, fecha).replace(/\{\{\s*hora\s*\}\}/g, hora);
}

export function newNoteText(materia: string, tema: string, title: string, template = 'Clase', tags: string[] = [], now = new Date()): string {
  const body = fillTemplate(TEMPLATES[template] ?? TEMPLATES.Clase!, title, now);
  // materia y tema solo si tienen valor (Prompt 12)
  const fm: Frontmatter = materia === DAILY ? { fecha: fillTemplate('{{fecha}}', '', now) } : { ...(materia.trim() ? { materia: materia.trim() } : {}), ...(tema.trim() ? { tema: tema.trim() } : {}), fecha: fillTemplate('{{fecha}}', '', now), tags };
  return stringifyFrontmatter(fm, body);
}

// ───────── enlaces ─────────

export function wikilinks(text: string): string[] {
  return [...text.matchAll(/(?<!!)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map((m) => m[1]!.trim());
}

export interface LinkIndex {
  backlinks: Map<string, string[]>;
  titles: Map<string, string>;
}

export async function linkIndex(vault: VaultAdapter, notes: NoteMeta[]): Promise<{ idx: LinkIndex; texts: Map<string, string> }> {
  const titles = new Map(notes.map((n) => [n.title.toLowerCase(), n.path]));
  const backlinks = new Map<string, string[]>();
  const texts = new Map<string, string>();
  for (const n of notes) {
    const t = await readTextOr(vault, n.path, '').catch(() => ''); // solo lectura (lista, grafo, búsqueda)
    texts.set(n.path, t);
    for (const l of wikilinks(t)) {
      const target = titles.get(l.toLowerCase().replace(/\.md$/, ''));
      if (target && target !== n.path) backlinks.set(target, [...new Set([...(backlinks.get(target) ?? []), n.path])]);
    }
  }
  return { idx: { backlinks, titles }, texts };
}

/** Menciones sin enlazar: notas que nombran el título sin [[ ]]. */
export function unlinkedMentions(title: string, path: string, texts: Map<string, string>): string[] {
  if (title.length < 4) return [];
  const re = new RegExp(`(^|[^\\[\\p{L}])${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\]])`, 'iu');
  return [...texts].filter(([p, t]) => p !== path && re.test(parseFrontmatter(t).body.replace(/\[\[[^\]]*\]\]/g, ''))).map(([p]) => p);
}

export function outline(text: string): { level: number; text: string; line: number }[] {
  const out: { level: number; text: string; line: number }[] = [];
  let fence = false;
  text.split('\n').forEach((l, i) => {
    if (/^```/.test(l)) fence = !fence;
    const m = !fence && /^(#{1,6})\s+(.*)$/.exec(l);
    if (m) out.push({ level: m[1]!.length, text: m[2]!, line: i });
  });
  return out;
}

// ───────── historial y papelera ─────────

export async function snapshot(vault: VaultAdapter, path: string, text: string, now = Date.now(), minGapMs = 5 * 60_000): Promise<boolean> {
  const dir = `${HISTORY}/${path}`;
  const prev = (await vault.list(dir)).map((e) => Number(e.name.replace(/\.md$/, ''))).filter(Number.isFinite).sort((a, b) => b - a);
  if (prev[0] && now - prev[0] < minGapMs) return false;
  if (prev[0] && (await readTextOr(vault, `${dir}/${prev[0]}.md`, '')) === text) return false;
  await vault.write(`${dir}/${now}.md`, text);
  for (const old of prev.slice(49)) await vault.remove(`${dir}/${old}.md`);
  return true;
}

export async function versions(vault: VaultAdapter, path: string): Promise<number[]> {
  return (await vault.list(`${HISTORY}/${path}`)).map((e) => Number(e.name.replace(/\.md$/, ''))).filter(Number.isFinite).sort((a, b) => b - a);
}

export async function readVersion(vault: VaultAdapter, path: string, ts: number): Promise<string> {
  return readTextOr(vault, `${HISTORY}/${path}/${ts}.md`, '');
}

export async function trash(vault: VaultAdapter, path: string, now = Date.now()): Promise<string> {
  const to = `${TRASH}/${now}/${path}`;
  await vault.move(path, to);
  return to;
}

export async function trashList(vault: VaultAdapter): Promise<{ ts: number; path: string; stored: string }[]> {
  const out: { ts: number; path: string; stored: string }[] = [];
  for (const f of await walk(vault, TRASH)) {
    const [, , ts, ...rest] = f.path.split('/');
    out.push({ ts: Number(ts), path: rest.join('/'), stored: f.path });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

export async function restore(vault: VaultAdapter, stored: string, path: string): Promise<string> {
  let target = path;
  for (let i = 2; await vault.exists(target); i++) target = path.replace(/\.md$/, ` (${i}).md`);
  await vault.move(stored, target);
  return target;
}

// ───────── tarjetas desde notas ─────────

export function paragraphs(body: string): { idx: number; text: string }[] {
  return body.split(/\n\s*\n/).map((t, idx) => ({ idx, text: t.trim() })).filter((p) => p.text && !/^#{1,6}\s/.test(p.text) && p.text.replace(/[-*\s[\]]/g, '').length > 25);
}

const words = (s: string) => new Set(normalizeAnswer(s).split(' ').filter((w) => w.length > 3));

/** Cobertura: qué párrafos tienen al menos una tarjeta (por src explícito o por solapamiento de términos). */
export function coverage(body: string, cards: { front: string; back: string; src: string | null }[], path: string): { total: number; covered: number[]; uncovered: { idx: number; text: string }[]; cards: number } {
  const ps = paragraphs(body);
  const mine = cards.filter((c) => c.src?.split('#')[0] === path);
  const covered = new Set<number>();
  for (const c of mine) {
    const m = /#p(\d+)/.exec(c.src ?? '');
    if (m) covered.add(Number(m[1]));
    else {
      const cw = words(`${c.front} ${c.back}`);
      for (const p of ps) {
        const pw = words(p.text);
        let hit = 0;
        for (const w of cw) if (pw.has(w)) hit++;
        if (cw.size && hit / Math.min(cw.size, pw.size || 1) >= 0.4) covered.add(p.idx);
      }
    }
  }
  return { total: ps.length, covered: [...covered], uncovered: ps.filter((p) => !covered.has(p.idx)), cards: mine.length };
}

/** Prompt para la herramienta de IA del usuario (modo B, sin agentes ni backend). */
export function buildPrompt(title: string, body: string, max = 20): string {
  return `Eres un asistente que crea tarjetas de estudio de alta calidad para repetición espaciada.

Reglas:
- Una idea por tarjeta, precisa y verificable con el texto. No inventes datos.
- Usa SOLO este formato, con una línea en blanco entre tarjetas:
  Q:: pregunta
  A:: respuesta
  o bien
  Cloze: texto con {{c1::hueco}} (y {{c2::otro}} si aplica)
- Máximo ${max} tarjetas. Responde únicamente con las tarjetas, sin comentarios.

Texto de la nota "${title}":
"""
${body.trim()}
"""`;
}

/** Valida la respuesta pegada: tarjetas listas para revisar (nunca se agregan solas). */
export function parseAiResponse(text: string): { block: string; ok: boolean; errors: string[] }[] {
  const clean = text.replace(/```[a-z]*\n?/g, '').replace(/^\s*\d+[.)]\s+(?=(Q|Cloze):)/gm, '');
  const d = parseDeck(clean);
  return d.notes.map((n) => ({ block: n.raw.replace(/\s\^[A-Za-z0-9_-]+\s*$/, '').trim(), ok: !n.errors.length, errors: n.errors }));
}

export function withOrigin(block: string, src: string, ai: boolean): string {
  return `${block}${ai ? ' <!-- origen: ia -->' : ''} <!-- src: ${src} -->`;
}

// ───────── Plaud y glosario ─────────

export type PlaudKind = 'resumen' | 'transcripcion' | 'mapa' | 'audio' | 'otro';

export function plaudKind(name: string, text = ''): PlaudKind {
  const n = name.toLowerCase();
  if (/\.(mp3|wav|m4a|aac|ogg)$/.test(n)) return 'audio';
  if (/\.srt$/.test(n) || /transcri|transcript/.test(n)) return 'transcripcion';
  if (/mind ?map|mapa ?mental|mindmap/.test(n)) return 'mapa';
  if (/summary|resumen|notes?\b/.test(n)) return 'resumen';
  if (/\.png$/.test(n)) return 'mapa';
  if (/^\d+\s*\n\d{2}:\d{2}:\d{2},\d{3} -->/m.test(text) || /^\[?\d{1,2}:\d{2}(:\d{2})?\]?\s*(speaker|hablante|orador)/im.test(text)) return 'transcripcion';
  if (/^#{1,3}\s/m.test(text) && text.length < 20000) return 'resumen';
  return text.length > 6000 ? 'transcripcion' : 'otro';
}

/** Clave de agrupación: mismo nombre base sin sufijos de tipo ni extensión. */
export function plaudGroupKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[\s_-]*[([]?(?<![\p{L}\p{N}])(summary|resumen|transcript(ion)?|transcripci[oó]n|mind ?map|mapa ?mental|notes?|audio)(?![\p{L}\p{N}])[)\]]?[\s_-]*/gu, ' ')
    .replace(/[\s_-]+/g, ' ')
    .trim();
}

export function srtToText(srt: string): string {
  return srt.replace(/\r/g, '').split(/\n\s*\n/).map((b) => { const ls = b.split('\n'); return ls.filter((l, i) => !(/^\d+$/.test(l.trim()) && /-->/.test(ls[i + 1] ?? '')) && !/-->/.test(l) && l.trim()).join(' '); }).filter(Boolean).join('\n');
}

/** Fecha local AAAA-MM-DD (no UTC). */
export const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function classNoteFromPlaud(title: string, parts: { kind: PlaudKind; name: string; text?: string; media?: string }[], materia = '', tema = ''): string {
  const resumen = parts.filter((p) => p.kind === 'resumen').map((p) => parseFrontmatter(p.text ?? '').body.trim()).join('\n\n');
  const trans = parts.filter((p) => p.kind === 'transcripcion').map((p) => (/\.srt$/i.test(p.name) ? srtToText(p.text ?? '') : (p.text ?? '').trim())).join('\n\n');
  const mapas = parts.filter((p) => p.kind === 'mapa');
  const audio = parts.filter((p) => p.kind === 'audio');
  const body = [
    `# ${title}`,
    '',
    '## Fuente',
    `Grabación de Plaud${audio.length ? ` · audio: ${audio.map((a) => `![[${a.media}]]`).join(' ')}` : ''}`,
    '',
    '## Resumen',
    resumen || '_(sin resumen)_',
    '',
    '## Puntos clave',
    '- ',
    '',
    '## Imágenes',
    ...mapas.map((m) => (m.media ? `![[${m.media}]]` : m.text ?? '')),
    '',
    '## Tarjetas',
    '',
    '## Pendientes',
    '- [ ] Revisar términos de la transcripción',
    '',
    ...(trans ? ['> [!quote]- Transcripción', ...trans.split('\n').map((l) => `> ${l}`)] : []),
  ].join('\n');
  // materia y tema solo si tienen valor (Prompt 12); el orden de las claves es el de siempre
  return stringifyFrontmatter({ ...(materia.trim() ? { materia } : {}), ...(tema.trim() ? { tema } : {}), fecha: localDate(), fuente: 'plaud', tags: [] }, body + '\n');
}

/** Sugerencias del glosario: palabras parecidas a un término correcto (posibles errores de transcripción). */
export function glossarySuggestions(text: string, glossary: string[]): { wrong: string; right: string; count: number }[] {
  const out = new Map<string, { wrong: string; right: string; count: number }>();
  const tokens = text.match(/[\p{L}][\p{L}\p{N}-]{3,}/gu) ?? [];
  for (const term of glossary) {
    const nt = normalizeAnswer(term);
    if (nt.includes(' ')) continue;
    for (const tok of tokens) {
      const nk = normalizeAnswer(tok);
      if (nk === nt || tok === term) continue;
      if (Math.abs(nk.length - nt.length) <= 2 && nk[0] === nt[0] && levenshtein(nk, nt) <= Math.max(1, Math.floor(nt.length / 5))) {
        const k = `${tok}→${term}`;
        const x = out.get(k) ?? { wrong: tok, right: term, count: 0 };
        x.count++;
        out.set(k, x);
      }
    }
  }
  return [...out.values()].sort((a, b) => b.count - a.count);
}

export function replaceAll(text: string, from: string, to: string, wholeWord = true): { text: string; n: number } {
  if (!from) return { text, n: 0 };
  const re = new RegExp(wholeWord ? `(?<![\\p{L}\\p{N}])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])` : from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu');
  let n = 0;
  return { text: text.replace(re, () => (n++, to)), n };
}

/** Sugiere materia y tema por nombre/fecha comparando con la estructura existente. */
export function suggestPlace(name: string, tree: Tree[]): { materia: string; tema: string } | null {
  const nn = normalizeAnswer(name);
  let best: { materia: string; tema: string; score: number } | null = null;
  for (const m of tree) {
    const mScore = nn.includes(normalizeAnswer(m.materia)) ? 2 : 0;
    for (const t of m.temas) {
      if (!t.tema) continue; // «Sin tema» no puntúa
      const s = mScore + (nn.includes(normalizeAnswer(t.tema)) ? 3 : 0);
      if (s > (best?.score ?? 0)) best = { materia: m.materia, tema: t.tema, score: s };
    }
    if (mScore && !best) best = { materia: m.materia, tema: m.temas[0]?.tema ?? '', score: mScore };
  }
  return best ? { materia: best.materia, tema: best.tema } : null;
}

export function dirOf(path: string) {
  return dirname(path);
}
