import { t } from '../i18n';
/**
 * Colección: todos los mazos parseados + estado FSRS reproducido desde
 * `reviews.jsonl` (+ caché `state.json`). Reconciliación por ID (SPEC §4):
 * texto cambiado = misma tarjeta; ID nuevo = tarjeta nueva; ID que desaparece =
 * archivada 30 días (su historial nunca se borra).
 */
import { type CardRef, cardsOf, ensureIds, type Note, parseDeck } from '../cards/parse';
import type { Frontmatter } from '../lib/frontmatter';
import { type CardState, type LogEntry, parseLog, replay, type SrsParams } from '../srs/engine';
import type { VaultAdapter } from '../vault/types';
import { readTextOr, walk } from '../vault/util';

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
}

export function paramsKey(p: SrsParams): string {
  return JSON.stringify([p.retention, p.learningSteps, p.relearningSteps, p.maxInterval, p.w, p.fuzz]);
}

function logKey(log: LogEntry[], p: SrsParams): string {
  const last = log[log.length - 1];
  return `${log.length}:${last?.ts ?? 0}:${last?.id ?? ''}:${paramsKey(p)}`;
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
  const taken = new Set<string>();
  let idsAdded = 0;
  const texts: [string, string][] = [];
  for (const f of files) texts.push([f.path, await readTextOr(vault, f.path, '')]);
  for (const [, t] of texts) for (const n of parseDeck(t).notes) if (n.id) taken.add(n.id);
  for (const [path, original] of texts) {
    let text = original;
    const fixed = ensureIds(text, taken);
    if (fixed.added.length) {
      text = fixed.text;
      idsAdded += fixed.added.length;
      await vault.write(path, text);
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
  for (const d of decks) for (const ref of d.cards) byCid.set(ref.cid, { ref, deck: d });

  const { states, log, bad } = await loadStates(vault, params);

  // Archivo: IDs con historial que ya no están en ningún mazo
  let archive: Record<string, number> = {};
  try {
    archive = JSON.parse(await readTextOr(vault, ARCHIVE, '{}')) as Record<string, number>;
  } catch {
    archive = {};
  }
  let changed = false;
  for (const cid of states.keys()) {
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

  return { decks, byCid, states, log, badLines: bad, archived, idsAdded };
}

/** Agrega entradas al historial y actualiza la caché. */
export async function appendLog(vault: VaultAdapter, col: Collection, entries: LogEntry[], params: SrsParams): Promise<void> {
  const prev = await readTextOr(vault, REVIEWS, '');
  const add = entries.map((e) => JSON.stringify(e)).join('\n');
  await vault.write(REVIEWS, prev && !prev.endsWith('\n') ? `${prev}\n${add}\n` : `${prev}${add}\n`);
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
