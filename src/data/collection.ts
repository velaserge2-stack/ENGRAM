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
import { appendLinesAt, decodeText, FNV_INIT, fnvHex, fnvUpdate, isNotFound, readTextOr, walk } from '../vault/util';

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
  /**
   * Punto de control (Prompt 21 · 4): bytes de `reviews.jsonl` que reflejan `states` y su suma FNV en curso.
   * `logAt` = -1 si se perdió la pista (otra pestaña añadió entre medias): entonces no se guardan más
   * puntos de control en esta sesión y el viejo sigue valiendo.
   */
  logAt?: number;
  logFnv?: number;
}

export function paramsKey(p: SrsParams): string {
  return JSON.stringify([p.retention, p.learningSteps, p.relearningSteps, p.maxInterval, p.w, p.fuzz]);
}

/** Clave de `state.json`: versión del motor + parámetros (el historial lo ata el punto de control). */
const stateKey = (p: SrsParams) => `${ENGINE_VERSION}:${paramsKey(p)}`;

type SerializedState = Omit<CardState, 'card'> & { card: Record<string, unknown> };

function revive(s: SerializedState): CardState {
  const c = s.card as Record<string, unknown>;
  return { ...s, card: { ...(c as object), due: new Date(c.due as string), last_review: c.last_review ? new Date(c.last_review as string) : undefined } as CardState['card'] };
}

/**
 * Reconstruye solo las tarjetas `ids` con TODAS sus entradas. El estado de una tarjeta depende solo de sus
 * propias entradas (orden por `ts`, `undo` por id y `ts`, azar de ts-fsrs ligado a la tarjeta), así que es
 * idéntico a su estado en la repetición completa, aunque lo nuevo venga fuera de orden o deshaga algo.
 */
function rebuildCards(states: Map<string, CardState>, entries: LogEntry[], ids: Set<string>, params: SrsParams) {
  const mine = entries.filter((e) => ids.has(e.id));
  const fresh = replay(mine, params);
  for (const id of ids) {
    const st = fresh.get(id);
    if (st) states.set(id, st);
    else states.delete(id);
  }
}

/**
 * Estado FSRS desde `reviews.jsonl` (la verdad) con la caché `state.json` como punto de control
 * (Prompt 21 · 4): `at` = bytes del historial que refleja y `head` = su suma. Si el principio del archivo
 * casa con la suma, solo se reconstruyen las tarjetas que aparecen después de `at`; si no (archivo editado,
 * truncado, otra versión del motor u otros parámetros, caché v1 o dañada) → reconstrucción completa.
 * `at` siempre cae en un fin de línea: así las entradas de antes y de después son exactamente las del archivo.
 */
export async function loadStates(vault: VaultAdapter, params: SrsParams): Promise<{ states: Map<string, CardState>; log: LogEntry[]; bad: number; rebuilt: boolean; at: number; fnv: number }> {
  let bytes: Uint8Array;
  try {
    bytes = await vault.read(REVIEWS);
  } catch (e) {
    if (!isNotFound(e)) throw e;
    bytes = new Uint8Array();
  }
  const { entries, bad } = parseLog(decodeText(bytes));
  const key = stateKey(params);
  try {
    const cache = JSON.parse(await readTextOr(vault, STATE, '{}')) as { v?: number; key?: string; at?: number; head?: string; cards?: Record<string, SerializedState> };
    const at = cache.at;
    if (cache.v === 2 && cache.key === key && cache.cards && Number.isInteger(at) && at! >= 0 && at! <= bytes.length && (at === 0 || bytes[at! - 1] === 10)) {
      const head = fnvUpdate(FNV_INIT, bytes.subarray(0, at));
      if (fnvHex(head) === cache.head) {
        const states = new Map(Object.entries(cache.cards).map(([k, v]) => [k, revive(v)]));
        const tail = parseLog(decodeText(bytes.subarray(at))).entries;
        const fnv = fnvUpdate(head, bytes.subarray(at));
        if (tail.length) {
          rebuildCards(states, entries, new Set(tail.map((e) => e.id)), params);
          // lo nuevo llegó por fuera de `appendLog` (importar, restaurar, otra pestaña): el punto de control
          // avanza ya; si no, cada arranque volvería a reconstruir esas tarjetas
          if (bytes[bytes.length - 1] === 10) await vault.write(STATE, serializeStates(states, key, bytes.length, fnv));
        }
        return { states, log: entries, bad, rebuilt: false, at: bytes.length, fnv };
      }
    }
  } catch {
    /* caché dañada: se reconstruye */
  }
  const states = replay(entries, params);
  const fnv = fnvUpdate(FNV_INIT, bytes);
  const ok = !bytes.length || bytes[bytes.length - 1] === 10;
  if (ok) await vault.write(STATE, serializeStates(states, key, bytes.length, fnv));
  return { states, log: entries, bad, rebuilt: true, at: ok ? bytes.length : -1, fnv };
}

function serializeStates(states: Map<string, CardState>, key: string, at: number, fnv: number): string {
  return JSON.stringify({ v: 2, key, at, head: fnvHex(fnv), cards: Object.fromEntries(states) });
}

export async function loadCollection(vault: VaultAdapter, params: SrsParams, now = Date.now()): Promise<Collection> {
  const files = (await walk(vault, 'decks')).filter((f) => f.path.endsWith('.md'));
  const decks: Deck[] = [];
  // el historial primero: un ID nuevo nunca reutiliza el de una tarjeta archivada o en la papelera
  const { states, log, bad, at: logAt, fnv: logFnv } = await loadStates(vault, params);
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

  return { decks, byCid, states, log, badLines: bad, archived, idsAdded, unreadable, logAt, logFnv };
}

/** Textos de los mazos en la papelera (solo para reservar sus IDs; si no se pueden leer, se omiten). */
async function trashTexts(vault: VaultAdapter): Promise<string[]> {
  const files = (await walk(vault, DECK_TRASH).catch(() => [])).filter((f) => f.path.endsWith('.md'));
  return Promise.all(files.map((f) => readTextOr(vault, f.path, '').catch(() => '')));
}

/**
 * Agrega entradas al historial (Prompt 21 · 4: solo se añaden, sin leer ni reescribir el archivo) y deja
 * pendiente guardar `state.json`. Quien llama ya cambió `col.states` justo antes, sin esperas en medio.
 */
export async function appendLog(vault: VaultAdapter, col: Collection, entries: LogEntry[], params: SrsParams): Promise<void> {
  inFlight++;
  try {
    const r = await appendLinesAt(vault, REVIEWS, entries.map((e) => JSON.stringify(e)));
    col.log.push(...entries);
    // la suma sigue al archivo solo si lo añadido empezó donde lo dejamos (si no, otra pestaña escribió)
    if (r.written && col.logAt !== undefined && col.logAt >= 0 && r.at === col.logAt) {
      col.logFnv = fnvUpdate(col.logFnv ?? FNV_INIT, r.written);
      col.logAt += r.written.length;
    } else col.logAt = -1;
  } finally {
    inFlight--;
  }
  scheduleState(vault, col, params);
}

/*
 * `state.json` diferido (Prompt 21 · 4, cuello #6: serializar 20 000 estados costaba ~80 ms en cada
 * respuesta). Se guarda tras un rato sin respuestas, al ocultar la página y al salir (`pagehide`; sin
 * `beforeunload`). Si no llega a guardarse no se pierde nada: el punto de control anterior sigue siendo
 * válido y lo que falte se reconstruye por tarjeta al cargar. Nunca con una respuesta en vuelo: el estado
 * en memoria ya la incluye y el archivo aún no (y si falla, quien llama lo revierte).
 */
let inFlight = 0;
let pending: { vault: VaultAdapter; col: Collection; params: SrsParams } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const QUIET_MS = 15_000;

function scheduleState(vault: VaultAdapter, col: Collection, params: SrsParams) {
  if (col.logAt === undefined || col.logAt < 0) return;
  pending = { vault, col, params };
  clearTimeout(timer);
  timer = setTimeout(() => void flushState(), QUIET_MS);
}

/** Guarda ya el `state.json` pendiente (si lo hay y no hay respuestas en vuelo). */
export async function flushState(): Promise<void> {
  const p = pending;
  if (!p) return;
  if (inFlight) {
    clearTimeout(timer);
    timer = setTimeout(() => void flushState(), 300);
    return;
  }
  pending = null;
  clearTimeout(timer);
  const { col } = p;
  if (col.logAt === undefined || col.logAt < 0) return;
  // se arma de una vez, sin esperas: `states`, `logAt` y `logFnv` quedan fijos y casan entre sí
  const text = serializeStates(col.states, stateKey(p.params), col.logAt, col.logFnv ?? FNV_INIT);
  await p.vault.write(STATE, text).catch(() => {}); // es una caché: si falla, el punto de control anterior sigue valiendo
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void flushState());
  addEventListener('pagehide', () => void flushState());
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
