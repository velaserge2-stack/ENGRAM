// Asistente · propuestas de CREAR (nota, diagrama, examen con fecha). Solo validan y arman la propuesta; no escriben.
// Con los validadores reales: parseDiagram (diagramas), parseExam (fechas), notePath/newNoteText (notas, vía notes/create.ts).
import type { Collection } from '../data/collection';
import { safeName } from '../data/ops';
import { MAX_NODES } from '../diagrams/types';
import { parseDiagram } from '../diagrams/parse';
import { daysBetween } from '../lib/days';
import { parseExam, serializeExam } from '../lib/exams';
import { headOf, parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter';
import { planNote } from '../notes/create';
import { diagramFence, diagramKindOf, type DiagramKind } from '../notes/diagramtype';
import { DAILY, safeSegment } from '../notes/model';
import type { Proposal } from './proposal';

type Bad = { error: string; detail?: string };
const bad = (x: unknown): x is Bad => typeof x === 'object' && x !== null && 'error' in x;
export const MAX_NOTE = 20000;
export const DIAGRAMS: readonly DiagramKind[] = ['mapa', 'flujo', 'diagrama'];

/** Una línea, sin comentarios HTML, con tope. */
export const one = (s: unknown, max = 600) => String(s ?? '').replace(/<!--|-->/g, '').replace(/\s*[\r\n]+\s*/g, ' ').trim().slice(0, max);
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
// eslint-disable-next-line no-control-regex
const clean = (s: unknown) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
type Exists = (p: string) => Promise<boolean>;

function place(a: { materia?: unknown; tema?: unknown }): { materia: string; tema: string } | Bad {
  const materia = safeSegment(one(a.materia, 80)), tema = safeSegment(one(a.tema, 80));
  return materia === DAILY ? { error: 'materia' } : { materia, tema };
}
const tagsOf = (t: unknown) => [...new Set((Array.isArray(t) ? t : []).slice(0, 8).map((x) => one(x, 40).replace(/^#+/, '').replace(/[\s,[\]]+/g, '-')).filter(Boolean))];

// ───────── nota ─────────
export interface NoteIn { materia?: string; tema?: string; titulo?: string; contenido?: string; tags?: string[] }
export async function buildNote(exists: Exists, a: NoteIn, now = new Date()): Promise<Proposal | Bad> {
  const titulo = one(a.titulo, 120);
  if (!safeSegment(titulo)) return { error: 'titulo' };
  const at = place(a);
  if (bad(at)) return at;
  let body = clean(a.contenido).trim();
  if (headOf(body) !== null) body = parseFrontmatter(body).body.trim(); // el modelo no fija el frontmatter
  if (!body) return { error: 'vacio' };
  if (body.length > MAX_NOTE) return { error: 'largo', detail: `${MAX_NOTE}` };
  if (!/^#\s/.test(body)) body = `# ${titulo}\n\n${body}`;
  const { path, text } = await planNote(exists, { ...at, titulo, tags: tagsOf(a.tags), texto: body + '\n', extra: { origen: 'ia' } }, now);
  return { tipo: 'nota', destino: path, contenido: text, items: [path], resumen: `${titulo} → ${path.replace(/^notes\//, '')}` };
}

// ───────── diagrama ─────────
/** Valida la gramática con el parser real. Devuelve el error con línea y código para que el modelo corrija. */
export function checkDiagram(src: string, kind: DiagramKind): Bad | null {
  if (!src.trim()) return { error: 'vacio' };
  const r = parseDiagram(src, kind);
  if (r.tooBig) return { error: 'grande', detail: `más de ${MAX_NODES} nodos` };
  if (r.errors.length) return { error: 'diagrama', detail: r.errors.slice(0, 5).map((e) => { const l = r.doc.lines[e.line]; return `línea ${e.line + 1}${l && l.t === 'raw' ? ` «${l.raw.slice(0, 60)}»` : ''}: ${e.code}`; }).join('; ') };
  return r.doc.nodes.length ? null : { error: 'vacio' };
}
export interface DiagIn extends NoteIn { tipo?: string; fuente?: string }
export async function buildDiagram(exists: Exists, a: DiagIn, now = new Date()): Promise<Proposal | Bad> {
  const kind = DIAGRAMS.find((k) => k === a.tipo);
  if (!kind) return { error: 'tipo' };
  const titulo = one(a.titulo, 120);
  if (!safeSegment(titulo)) return { error: 'titulo' };
  const at = place(a);
  if (bad(at)) return at;
  let src = clean(a.fuente).replace(/^\s*\n/, '').trimEnd();
  const f = diagramFence(src.trim());
  if (f) src = f.src.trimEnd(); // si el modelo envolvió la fuente en ```mapa
  if (src.length > MAX_NOTE) return { error: 'largo', detail: `${MAX_NOTE}` };
  const e = checkDiagram(src + '\n', kind);
  if (e) return e;
  const { path, text } = await planNote(exists, { ...at, titulo, kind, texto: src + '\n', extra: { origen: 'ia' } }, now);
  return { tipo: 'diagrama', diag: kind, destino: path, contenido: text, items: [path], resumen: `${titulo} (${kind}) → ${path.replace(/^notes\//, '')}` };
}

/** Tras «Editar»: el archivo completo sigue siendo válido y conserva `origen: ia` y su tipo. */
export function checkNoteFile(text: string, tipo: 'nota' | 'diagrama', diag?: DiagramKind): { contenido: string } | Bad {
  const t = clean(text);
  if (t.length > MAX_NOTE + 2000) return { error: 'largo', detail: `${MAX_NOTE}` };
  const d = parseFrontmatter(t);
  if (!d.body.trim()) return { error: 'vacio' };
  if (diagramKindOf(t) !== (tipo === 'diagrama' ? diag : 'nota')) return { error: 'formato', detail: 'tipo:' };
  if (tipo === 'diagrama') { const e = checkDiagram(d.body, diag!); if (e) return e; }
  return { contenido: d.data.origen === 'ia' ? t : stringifyFrontmatter({ ...d.data, origen: 'ia' }, d.body) };
}

// ───────── examen con fecha (sección Exámenes, no bancos) ─────────
export const topicOptions = (col: Collection | null): string[] => [...new Set([...(col?.decks.map((d) => d.full) ?? []), ...(col?.decks.map((d) => d.folder).filter(Boolean) ?? []), ...(col?.decks.flatMap((d) => d.tags.map((t) => `tag:${t}`)) ?? [])])].sort();
const validDate = (s: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return false; const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!)); return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!; };

/** Valida el archivo del examen con el parser real; hoy o futuro, temas existentes. */
export function checkExamFile(text: string, col: Collection | null, today: string): Bad | null {
  const e = parseExam('', text);
  if (!e.name.trim()) return { error: 'nombre' };
  if (!validDate(e.date)) return { error: 'fecha' };
  if (e.date < today) return { error: 'pasada' };
  if (!e.topics.length) return { error: 'temas', detail: topicOptions(col).slice(0, 8).join(', ') };
  if (col) {
    const opts = topicOptions(col), unk = e.topics.filter((x) => !opts.includes(x));
    if (unk.length) {
      const sug = [...new Set(unk.flatMap((u) => opts.filter((o) => norm(o).includes(norm(u)) || norm(u).includes(norm(o)))))].slice(0, 6);
      return { error: 'temas', detail: `no existen: ${unk.join(', ')}. ${sug.length ? 'Parecidos' : 'Disponibles'}: ${(sug.length ? sug : opts.slice(0, 8)).join(', ') || '(ninguno)'}. Díselo al usuario; no inventes temas.` };
    }
  }
  if (!(e.goal >= 0.5 && e.goal <= 0.99)) return { error: 'meta' };
  if (!Number.isInteger(e.finalDays) || e.finalDays < 0 || e.finalDays > 60) return { error: 'dias' };
  return null;
}
export interface ExamIn { nombre?: string; fecha?: string; temas?: string[]; meta_retencion?: number; dias_repaso_final?: number }
export async function buildExamDate(exists: Exists, col: Collection | null, today: string, a: ExamIn): Promise<Proposal | Bad> {
  const name = one(a.nombre, 80);
  if (!name || !safeName(name).trim()) return { error: 'nombre' };
  const path = `exams/${safeName(name)}.md`;
  if (await exists(path)) return { error: 'exists', detail: path };
  const opts = topicOptions(col);
  const topics = [...new Set((Array.isArray(a.temas) ? a.temas : []).slice(0, 10).map((x) => one(x, 120)).filter(Boolean).map((x) => opts.find((o) => norm(o) === norm(x)) ?? x))];
  const g = a.meta_retencion === undefined ? 0.9 : Number(a.meta_retencion), goal = g > 1 ? g / 100 : g;
  const text = serializeExam({ path, name, date: String(a.fecha ?? '').trim(), topics, goal, finalDays: a.dias_repaso_final === undefined ? 7 : Number(a.dias_repaso_final), minPerDay: null, created: today, notes: '' });
  const e = checkExamFile(text, col, today);
  if (e) return e;
  const d = parseFrontmatter(text);
  const contenido = stringifyFrontmatter({ ...d.data, origen: 'ia' }, d.body);
  const ex = parseExam(path, contenido);
  return { tipo: 'fecha', destino: path, contenido, items: [ex.name, ex.date, ...ex.topics], resumen: `${ex.name} · ${ex.date}`, datos: { dias: daysBetween(today, ex.date) } };
}
/** Tras «Editar» un examen con fecha: el archivo completo, sin pasar el nombre del archivo. */
export function checkExamEdit(text: string, col: Collection | null, today: string): { contenido: string; items: string[]; datos: { dias: number } } | Bad {
  const e = checkExamFile(text, col, today);
  if (e) return e;
  const d = parseFrontmatter(text), contenido = d.data.origen === 'ia' ? text : stringifyFrontmatter({ ...d.data, origen: 'ia' }, d.body), ex = parseExam('', contenido);
  return { contenido, items: [ex.name, ex.date, ...ex.topics], datos: { dias: daysBetween(today, ex.date) } };
}
