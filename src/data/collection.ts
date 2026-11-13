import { t } from '../i18n';
/**
 * Colección: todos los mazos parseados + estado FSRS reproducido desde
 * `reviews.jsonl` (+ caché `state.json`). Reconciliación por ID (SPEC §4):
 * texto cambiado = misma tarjeta; ID nuevo = tarjeta nueva; ID que desaparece =
 * archivada 30 días (su historial nunca se borra).
 */
import { type CardRef, cardsOf, carryIds, ensureIds, type Note, noteIdOf, parseDeck } from '../cards/parse';
import { DECK_TRASH } from './decktrash';
import { noteStore } from '../notes/store';
import type { Frontmatter } from '../lib/frontmatter';
import { type CardState, ENGINE_VERSION, type LogEntry, parseLog, replay, type SrsParams } from '../srs/engine';
import type { VaultAdapter } from '../vault/types';
import { appendLines, checksum, enc, readTextOr, walk } from '../vault/util';

export const REVIEWS = '.app/reviews.jsonl';
export const STATE = '.app/state.json';
export const ARCHIVE = '.app/archive.json';
const DAY = 86_400_000;

export interface Deck {
  path: string;
  name: string;
  /** nombre con jerarquía: "Neurología/EVC" */
  full: string;
  folder: string;
  data: Frontmatter;
  notes: Note[];
  cards: CardRef[];
  newPerDay: number | null;
  tags: string[];
  errors: string[];
}

export interface Collection {
  decks: Deck[];
  byCid: Map<string, { ref: CardRef; deck: Deck }>;
  states: Map<string, CardState>;
  log: LogEntry[];
  badLines: number;
  archived: { cid: string; since: number }[];
  /** IDs añadidos al cargar (archivos reescritos) */
  idsAdded: number;
  /** mazos que no se pudieron leer (omitidos en esta sesión) */
  unreadable?: string[];
}

export function paramsKey(p: SrsParams): string {
  return JSON.stringify([p.retention, p.learningSteps, p.relearningSteps, p.maxInterval, p.w, p.fuzz]);
}

/**
 * Clave de `state.json`: suma de TODAS las entradas que reproduce `replay` (no solo la última) + versión del
 * motor + parámetros. Se calcula sobre las entradas leídas, no sobre los bytes: así `appendLog` no relee el
 * archivo y la caché queda ligada al historial con el que se calculó (si otra pestaña añadió líneas, no casa).
 */
function logKey(log: LogEntry[], p: SrsParams): string {
  return `${log.length}:${checksum(enc.encode(log.map((e) => JSON.stringify(e)).join('\n')))}:${ENGINE_VERSION}:${paramsKey(p)}`;
}

type SerializedState = Omit<CardState, 'card'> & { card: Record<string, unknown> };

function revive(s: SerializedState): CardState {
  const c = s.card as Record<string, unknown>;
  return { ...s, card: { ...(c as object), due: new Date(c.due as string), last_review: c.last_review ? new Date(c.last_review as string) : undefined } as CardState['card'] };
}

export async function loadStates(vault: VaultAdapter, params: SrsParams): Promise<{ states: Map<string, CardState>; log: LogEntry[]; bad: number; rebuilt: boolean }> {
  const { entries, bad } = parseLog(await readTextOr(vault, REVIEWS, ''));
  const key = logKey(entries, params);
  try {
    const cache = JSON.parse(await readTextOr(vault, STATE, '{}')) as { key?: string; cards?: Record<string, SerializedState> };
    if (cache.key === key && cache.cards) {
      return { states: new Map(Object.entries(cache.cards).map(([k, v]) => [k, revive(v)])), log: entries, bad, rebuilt: false };
    }
  } catch {
    /* caché dañada: se reconstruye */
  }
  const states = replay(entries, params);
  await vault.write(STATE, serializeStates(states, key));
  return { states, log: entries, bad, rebuilt: true };
}

function serializeStates(states: Map<string, CardState>, key: string): string {
  return JSON.stringify({ v: 1, key, cards: Object.fromEntries(states) });
}

export async function loadCollection(vault: VaultAdapter, params: SrsParams, now = Date.now()): Promise<Collection> {
  const files = (await walk(vault, 'decks')).filter((f) => f.path.endsWith('.md'));
  const decks: Deck[] = [];
  // el historial primero: un ID nuevo nunca reutiliza el de una tarjeta archivada o en la papelera
  const { states, log, bad } = await loadStates(vault, params);
  const taken = new Set<string>(log.map((e) => noteIdOf(e.id)));
  for (const t of await trashTexts(vault)) for (const n of parseDeck(t).notes) if (n.id) taken.add(n.id);
  let idsAdded = 0;
  const texts: [string, string][] = [];
  // un mazo ilegible se omite en esta sesión (sin archivar sus tarjetas ni reescribir nada); se avisa
  const unreadable: string[] = [];
  for (const f of files) {
    try { texts.push([f.path, await readTextOr(vault, f.path, '')]); } catch { unreadable.push(f.path); }
  }
  for (const [, t] of texts) for (const n of parseDeck(t).notes) if (n.id) taken.add(n.id);
  for (const [path, original] of texts) {
    let text = original;
    const fixed = ensureIds(text, taken);
    if (fixed.added.length) {
      text = fixed.text;
      idsAdded += fixed.added.length;
      await vault.write(path, text);
      // el editor abierto de ese mazo recibe los IDs: si tiene cambios sin guardar, se le añaden (su guardado no los quita)
      const open = noteStore.peek(path);
      if (open !== null && noteStore.pending(path)) noteStore.set(vault, path, carryIds(open, text));
      else await noteStore.refresh(vault, path);
    }
    const p = parseDeck(text);
    const rel = path.slice('decks/'.length, -3);
    const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const name = typeof p.data.deck === 'string' && p.data.deck ? p.data.deck : rel.split('/').pop()!;
    const tags = Array.isArray(p.data.tags) ? p.data.tags.map(String) : [];
    const d: Deck = {
      path, name, full: folder ? `${folder}/${name}` : name, folder, data: p.data, notes: p.notes,
      cards: [], newPerDay: typeof p.data.new_per_day === 'number' ? p.data.new_per_day : null, tags,
      errors: [...p.errors, ...p.notes.flatMap((n) => n.errors.map((e) => t('collection.linea_n_e', { n: n.line + 1, e })))],
    };
    d.cards = p.notes.filter((n) => !n.errors.length).flatMap(cardsOf);
    decks.push(d);
  }
  decks.sort((a, b) => a.full.localeCompare(b.full, 'es'));
  const byCid = new Map<string, { ref: CardRef; deck: Deck }>();
  for (const d of decks) {
    // un ID repetido (entre mazos o en el mismo): cuenta solo la primera copia y se avisa en el de la segunda
    d.cards = d.cards.filter((ref) => {
      const first = byCid.get(ref.cid);
      if (!first) return byCid.set(ref.cid, { ref, deck: d }), true;
      d.errors.push(t('collection.id_repetido', { id: noteIdOf(ref.cid), deck: first.deck.full }));
      return false;
    });
  }

  // Archivo: IDs con historial que ya no están en ningún mazo
  let archive: Record<string, number> = {};
  try {
    archive = JSON.parse(await readTextOr(vault, ARCHIVE, '{}')) as Record<string, number>;
  } catch {
    archive = {};
  }
  let changed = false;
  if (!unreadable.length) for (const cid of states.keys()) {
    if (byCid.has(cid)) {
      if (cid in archive) (delete archive[cid], (changed = true));
    } else if (!(cid in archive)) {
      archive[cid] = now;
      changed = true;
    }
  }
  if (changed) await vault.write(ARCHIVE, JSON.stringify(archive, null, 1));
  const archived = Object.entries(archive)
    .filter(([, since]) => now - since < 30 * DAY)
    .map(([cid, since]) => ({ cid, since }));

  return { decks, byCid, states, log, badLines: bad, archived, idsAdded, unreadable };
}

/** Textos de los mazos en la papelera (solo para reservar sus IDs; si no se pueden leer, se omiten). */
async function trashTexts(vault: VaultAdapter): Promise<string[]> {
  const files = (await walk(vault, DECK_TRASH).catch(() => [])).filter((f) => f.path.endsWith('.md'));
  return Promise.all(files.map((f) => readTextOr(vault, f.path, '').catch(() => '')));
}

/** Agrega entradas al historial y actualiza la caché. */
export async function appendLog(vault: VaultAdapter, col: Collection, entries: LogEntry[], params: SrsParams): Promise<void> {
  await appendLines(vault, REVIEWS, entries.map((e) => JSON.stringify(e)));
  col.log.push(...entries);
  await vault.write(STATE, serializeStates(col.states, logKey(col.log, params)));
}

/** Comprobación de la fase 2: reconstruir desde el historial == caché. */
export function verifyDeterminism(col: Collection, params: SrsParams): { ok: boolean; mismatched: string[] } {
  const rebuilt = replay(col.log, params);
  const mismatched: string[] = [];
  const keys = new Set([...rebuilt.keys(), ...col.states.keys()]);
  for (const k of keys) {
    const a = rebuilt.get(k);
    const b = col.states.get(k);
    if (JSON.stringify(a?.card) !== JSON.stringify(b?.card) || a?.suspended !== b?.suspended) mismatched.push(k);
  }
  return { ok: mismatched.length === 0, mismatched };
}
