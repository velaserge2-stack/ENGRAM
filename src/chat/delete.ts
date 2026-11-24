// Borrar desde el Asistente = MOVER A LA PAPELERA que ya existe (nunca definitivo, nunca vaciar). Aquí solo se construye y
// se aplica la propuesta; las herramientas (tools-write.ts) solo proponen y la interfaz aplica tras «Mover a la papelera».
// Objetivos permitidos: decks/*.md, notes/**.md, exams-bank/*.md y calendar/estudio.ics. reviews.jsonl no se toca nunca.
import type { Collection } from '../data/collection';
import { listTrash, restoreTrash, trashDecks } from '../data/decktrash';
import { CAL, deleteOccurrence } from '../lib/calendar-edit';
import { fromICS, occurrences, type StudyBlock, toICS } from '../lib/ics';
import { listNotes, noteMeta, restore, trash } from '../notes/model';
import { noteStore } from '../notes/store';
import { restoreBank, trashBank, type BankTrashEntry } from '../sim/banktrash';
import { parseBankMarkdown } from '../sim/parse';
import type { VaultAdapter } from '../vault/types';
import { readTextOr, walk } from '../vault/util';
import type { Entry } from './undo';
import type { Bad, Proposal } from './proposal';

export type Objetivo = 'nota' | 'mazo' | 'banco' | 'evento';
export const MAX_DELETES = 3;

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
/** Huella corta del contenido: si cambia entre proponer y confirmar, el borrado se invalida (`changed`). */
export const fingerprint = (s: string): string => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return `${s.length}:${h.toString(36)}`; };
const blockFp = (b: StudyBlock) => fingerprint(JSON.stringify([b.uid, b.start, b.end, b.title, b.rrule, b.exdate ?? [], b.subject, b.note]));

// ───────── ¿pidió el usuario borrar? ─────────
// Solo se evalúa sobre el ÚLTIMO mensaje del usuario (turn.ts): notas, PDF y respuestas del modelo nunca cuentan.
const DEL_VERB = /\b(borr(a|ar|alo|ala|ame|ado|ada)|elimin(a|ar|alo|ala|ame)|quit(a|ar|alo|ala|ame)|suprim(e|ir)|delete\w*|remove\w*|erase\w*|get rid of|supprim(e|er|ez)\w*|efface\w*|retire\w*|enleve\w*)\b/;
const DEL_OBJ = /\b(notas?|notes?|mazos?|decks?|paquets?|bancos?|banks?|banques?|examen(es)?|exams?|simulacros?|eventos?|events?|evenements?|citas?|appointments?|rendez-vous)\b/;
const STEM = '(?:borr|elimin|quit|suprim|delet|remov|erase|supprim|efface|retir|enleve)';
// negación: «no», «nunca», «don't», «ne»… hasta 2 palabras de relleno («no quiero que borres», «ne les supprime pas», «n'efface pas»)
const DEL_NEG = new RegExp(`(?:\\b(?:no|nunca|jamas|don'?t|do not|never|ne)\\b|\\bn')\\s*(?:[^\\s.,;!?]+\\s+){0,2}?${STEM}`);
// pregunta o ayuda («¿cómo borro una nota?», «how do I delete…»): no es una orden
const DEL_HELP = new RegExp(`\\b(?:como|how|comment)\\b[^.?!]*${STEM}`);
export function wantsDelete(text: string): boolean {
  const q = String(text ?? '').replace(/\u2019/g, "'").replace(/"[^"]*"|\u201c[^\u201d]*\u201d|\u00ab[^\u00bb]*\u00bb|^\s*>.*$/gm, ' ') // citado o pegado
    .normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return DEL_VERB.test(q) && DEL_OBJ.test(q) && !DEL_NEG.test(q) && !DEL_HELP.test(q);
}
/** ¿El último mensaje del usuario nombra el objetivo (nombre o archivo)? Frena que un texto leído inyecte otro objetivo. */
export function named(userText: string, p: Proposal): boolean {
  const u = norm(String(userText ?? '').replace(/\u2019/g, "'"));
  const names = [p.resumen, p.destino.replace(/^.*\//, '').replace(/\.\w+$/, ''), p.op?.fecha ?? ''].map(norm).filter((x) => x.length > 1 && x !== 'estudio');
  return names.some((x) => u.includes(x));
}

// ───────── resolver el objetivo (solo contra lo que EXISTE) ─────────
interface Cand { key: string; names: string[]; label: string }
function pick(list: Cand[], q: string): Cand | Bad {
  const n = norm(q);
  if (!n) return { error: 'nombre' };
  const hits = list.filter((c) => c.names.some((x) => norm(x) === n));
  if (hits.length === 1) return hits[0]!;
  if (hits.length) return { error: 'varios', detail: hits.slice(0, 8).map((h) => h.label).join(' | ') };
  // solo parcial («Bio» ~ «Biología avanzada»): nunca se elige solo; el usuario precisa
  const part = list.filter((c) => c.names.some((x) => norm(x).includes(n)));
  return part.length ? { error: 'varios', detail: part.slice(0, 8).map((h) => h.label).join(' | ') } : { error: 'noexiste' };
}
const isBad = (x: unknown): x is Bad => typeof x === 'object' && x !== null && 'error' in x;

function proposal(objetivo: Objetivo, destino: string, huella: string, titulo: string, items: string[], datos: Record<string, number> = {}): Proposal {
  return { tipo: 'borrar', objetivo, destino, huella, reversible: true, contenido: '', resumen: titulo, items, datos };
}

export async function buildDeleteNote(vault: VaultAdapter, nombre: string): Promise<Proposal | Bad> {
  const notes = await listNotes(vault);
  const c = pick(notes.map((m) => ({ key: m.path, names: [m.title, m.path, m.path.replace(/^notes\//, ''), m.path.replace(/^notes\/|\.md$/g, '')], label: m.path })), String(nombre ?? ''));
  if (isBad(c)) return c;
  const text = await readTextOr(vault, c.key, '');
  const m = noteMeta(c.key);
  return proposal('nota', c.key, fingerprint(text), m.title, [`${m.title} · ${c.key}`], { chars: text.length });
}

export async function buildDeleteDeck(col: Collection | null, vault: VaultAdapter, nombre: string): Promise<Proposal | Bad> {
  if (!col) return { error: 'noexiste' };
  const c = pick(col.decks.map((d) => ({ key: d.path, names: [d.full, d.name, d.path], label: d.full })), String(nombre ?? ''));
  if (isBad(c)) return c;
  const d = col.decks.find((x) => x.path === c.key)!;
  const reviews = col.log.filter((e) => e.rating && d.cards.some((k) => k.cid === e.id)).length;
  return proposal('mazo', d.path, fingerprint(await readTextOr(vault, d.path, '')), d.full, [d.full], { cards: d.cards.length, reviews });
}

export async function buildDeleteBank(vault: VaultAdapter, nombre: string): Promise<Proposal | Bad> {
  const files = (await walk(vault, 'exams-bank')).filter((f) => f.path.endsWith('.md'));
  const banks = await Promise.all(files.map(async (f) => { const text = await readTextOr(vault, f.path, ''); return { path: f.path, text, bank: parseBankMarkdown(text, f.path.replace(/^.*\/|\.md$/g, '')) }; }));
  const c = pick(banks.map((b) => ({ key: b.path, names: [b.bank.name, b.path, b.path.replace(/^.*\/|\.md$/g, '')], label: b.bank.name })), String(nombre ?? ''));
  if (isBad(c)) return c;
  const b = banks.find((x) => x.path === c.key)!;
  return proposal('banco', b.path, fingerprint(b.text), b.bank.name, [b.bank.name], { questions: b.bank.questions.length });
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** Solo eventos PROPIOS (calendar/estudio.ics): los importados son de solo lectura. */
export async function buildDeleteEvent(vault: VaultAdapter, q: { titulo?: string; fecha: string; alcance?: string }): Promise<Proposal | Bad> {
  const own = fromICS(await readTextOr(vault, CAL, ''));
  const t = norm(String(q.titulo ?? '')), date = String(q.fecha ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'fecha' };
  const found = own.filter((b) => !b.allDay && (!t || norm(b.title).includes(t)) && occurrences(b, date, date, dayOf).length > 0);
  if (found.length !== 1) return found.length ? { error: 'varios', detail: found.slice(0, 8).map((b) => b.title).join(' | ') } : { error: 'noevento' };
  const b = found[0]!;
  const scope: 'one' | 'series' = b.rrule && q.alcance !== 'serie' ? 'one' : 'series';
  const p = proposal('evento', CAL, blockFp(b), b.title, [`${b.title} · ${date}`], { serie: b.rrule && scope === 'series' ? 1 : 0 });
  p.op = { uid: b.uid, fecha: date, scope };
  return p;
}

// ───────── aplicar y deshacer (solo la interfaz, tras confirmar) ─────────
const SEG = (p: string) => p.split('/').every((s) => s !== '' && s !== '.' && s !== '..') && !/[\\\u0000-\u001f]/.test(p);
const PREFIX: Record<Objetivo, [string, RegExp]> = { nota: ['notes/', /\.md$/], mazo: ['decks/', /\.md$/], banco: ['exams-bank/', /\.md$/], evento: ['calendar/', /\.ics$/] };
/** Ruta permitida para el objetivo: nunca `.app/`, `media/`, `reviews.jsonl` ni ajustes. */
export function safeDeleteDest(p: Proposal): boolean {
  const o = p.objetivo && PREFIX[p.objetivo];
  if (!o || p.tipo !== 'borrar' || !p.destino.startsWith(o[0]) || !o[1].test(p.destino) || !SEG(p.destino) || p.destino.length > 400) return false;
  return p.objetivo !== 'evento' || p.destino === CAL;
}

export interface Applied { entries: Entry[]; restore: () => Promise<void> }
const gone = (): never => { throw new Error('gone'); };
const changed = (): never => { throw new Error('changed'); };

/** Mueve a la papelera EXACTAMENTE lo propuesto, tras revalidar existencia y huella. `w` escribe el .ics anotando el «antes». */
export async function applyDelete(vault: VaultAdapter, col: Collection | null, p: Proposal, w: (path: string, text: string) => Promise<void>): Promise<Applied> {
  const path = p.destino;
  if (p.objetivo === 'evento') {
    const text = await readTextOr(vault, CAL, '');
    const own = fromICS(text), same = own.filter((x) => x.uid === p.op?.uid), b = same[0];
    if (!b) return gone();
    if (same.length > 1) return changed(); // UID repetido: no se quitan varios bloques
    if (blockFp(b) !== p.huella) return changed();
    await w(CAL, toICS(deleteOccurrence(own, b.uid, p.op!.fecha, p.op!.scope)));
    return { entries: [], restore: async () => undefined }; // el deshacer de eventos lo hace undo.ts con el grupo `tracked`
  }
  if (!(await vault.exists(path))) return gone();
  if (noteStore.listening(path)) throw new Error('open'); // abierto en un panel del editor: no se mueve
  await noteStore.flush(path); // cerrado pero con cambios pendientes: se escriben antes de comparar la huella
  if (fingerprint(await readTextOr(vault, path, '')) !== p.huella) return changed();
  if (p.objetivo === 'nota') {
    const stored = await trash(vault, path);
    await noteStore.forget(path);
    return { entries: [], restore: async () => { if (!(await vault.exists(stored))) gone(); await restore(vault, stored, path); } };
  }
  if (p.objetivo === 'mazo') {
    const d = col?.decks.find((x) => x.path === path);
    if (!col || !d) return gone();
    const e = await trashDecks(vault, col, [d]);
    return { entries: [], restore: async () => { if (!(await listTrash(vault)).some((x) => x.id === e.id) || !(await restoreTrash(vault, e)).length) gone(); } };
  }
  const bank = parseBankMarkdown(await readTextOr(vault, path, ''), path.replace(/^.*\/|\.md$/g, ''));
  const e: BankTrashEntry = await trashBank(vault, { path, name: bank.name, questions: bank.questions.length });
  return { entries: [], restore: async () => { if ((await restoreBank(vault, e)) === null) gone(); } };
}
