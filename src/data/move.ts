/**
 * Mover mazos, submazos y tarjetas (Prompt 6 · A1).
 *
 * Un mazo es `decks/<carpeta>/<archivo>.md` y sus submazos viven en `decks/<carpeta>/<nombre>/`.
 * Mover = mover esos archivos (uno a uno, por SafeVault) y reescribir lo que apunta al nombre
 * con jerarquía: los vínculos `engrama://topic/…` y `engrama://deck/<ruta>` del calendario y los
 * `temas:` de los exámenes. Los IDs `^xxxx` no cambian, así que `reviews.jsonl` y el estado FSRS
 * siguen valiendo tal cual. El frontmatter (color, new_per_day, id) viaja con el archivo.
 *
 * Cada operación devuelve un registro para deshacerla (movimientos inversos y textos previos).
 */
import { newId, noteIdOf, parseDeck } from '../cards/parse';
import { parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter';
import { fromICS, toICS } from '../lib/ics';
import { makeUri, parseUri } from '../lib/links';
import { withSuffix } from '../vault/paths';
import type { VaultAdapter } from '../vault/types';
import { readTextOr, walk } from '../vault/util';
import type { Collection, Deck } from './collection';
import { withSubdecks } from './decktrash';

export type UndoOp = { kind: 'move'; from: string; to: string } | { kind: 'write'; path: string; before: string | null };
export type Undo = UndoOp[];
export type Clash = 'rename' | 'merge';

const CAL = 'calendar/estudio.ics';

/** Deshace en orden inverso. */
export async function undoMove(vault: VaultAdapter, log: Undo): Promise<void> {
  for (const op of [...log].reverse()) {
    if (op.kind === 'move') await vault.move(op.to, op.from);
    else if (op.before === null) await vault.remove(op.path);
    else await vault.write(op.path, op.before);
  }
}

async function write(vault: VaultAdapter, log: Undo, path: string, text: string) {
  const before = (await vault.exists(path)) ? await readTextOr(vault, path, '') : null;
  if (before === text) return;
  log.push({ kind: 'write', path, before });
  await vault.write(path, text);
}
async function remove(vault: VaultAdapter, log: Undo, path: string) {
  log.push({ kind: 'write', path, before: await readTextOr(vault, path, '') });
  await vault.remove(path);
}
async function move(vault: VaultAdapter, log: Undo, from: string, to: string) {
  await vault.move(from, to);
  log.push({ kind: 'move', from, to });
}

/** Carpetas válidas como destino de un mazo: no él mismo ni sus descendientes. */
export function canMoveTo(d: Deck, folder: string): boolean {
  return folder !== d.full && !folder.startsWith(d.full + '/');
}

/** ¿Hay ya un mazo con ese nombre en la carpeta destino? */
export function clashOf(col: Collection, d: Deck, folder: string): Deck | null {
  const full = folder ? `${folder}/${d.name}` : d.name;
  return col.decks.find((x) => x !== d && x.full === full) ?? null;
}

const fileOf = (p: string) => p.split('/').pop()!;
const dirOf = (folder: string) => (folder ? `decks/${folder}` : 'decks');

/** Renombra el prefijo de jerarquía `from` → `to` en un nombre de tema o mazo. */
export function renamePrefix(s: string, from: string, to: string): string {
  return s === from ? to : s.startsWith(from + '/') ? to + s.slice(from.length) : s;
}

/**
 * Reescribe los vínculos que nombran mazos o carpetas por su jerarquía.
 * `names`: pares nombre completo viejo → nuevo; `paths`: rutas de archivo viejas → nuevas.
 */
export async function rewriteDeckRefs(vault: VaultAdapter, log: Undo, names: [string, string][], paths: [string, string][]): Promise<void> {
  if (!names.length && !paths.length) return;
  const ren = (s: string) => names.reduce((acc, [a, b]) => renamePrefix(acc, a, b), s);
  // calendario
  const ics = await readTextOr(vault, CAL, '');
  if (ics) {
    const blocks = fromICS(ics);
    let touched = false;
    for (const b of blocks) {
      if (!b.links?.length) continue;
      b.links = b.links.map((u) => {
        const p = parseUri(u);
        if (!p) return u;
        let k = p.key;
        if (p.kind === 'topic') k = ren(k);
        else if (p.kind === 'deck') k = paths.find(([a]) => a === k)?.[1] ?? k;
        if (k === p.key) return u;
        touched = true;
        return makeUri(p.kind, k);
      });
    }
    if (touched) await write(vault, log, CAL, toICS(blocks));
  }
  // exámenes
  for (const f of await walk(vault, 'exams')) {
    if (!f.path.endsWith('.md')) continue;
    const text = await readTextOr(vault, f.path, '');
    const doc = parseFrontmatter(text);
    if (!Array.isArray(doc.data.temas)) continue;
    const temas = doc.data.temas.map(String);
    const next = temas.map((x) => (x.startsWith('tag:') ? x : ren(x)));
    if (next.every((x, i) => x === temas[i])) continue;
    await write(vault, log, f.path, stringifyFrontmatter({ ...doc.data, temas: next }, doc.body));
  }
}

/** Paneles del lienzo (`.app/spaces/*.json`) que apuntan a un archivo o carpeta movidos. */
export async function rewriteSpaces(vault: VaultAdapter, log: Undo, fix: (type: string, arg: string) => string): Promise<void> {
  for (const f of await walk(vault, '.app/spaces')) {
    if (!f.path.endsWith('.json')) continue;
    const text = await readTextOr(vault, f.path, '');
    let sp: { panels?: { type: string; arg: string }[] };
    try { sp = JSON.parse(text) as typeof sp; } catch { continue; }
    let touched = false;
    for (const p of sp.panels ?? []) {
      const next = fix(p.type, p.arg);
      if (next !== p.arg) (p.arg = next, (touched = true));
    }
    if (touched) await write(vault, log, f.path, JSON.stringify(sp, null, 1));
  }
}

/** Copia las notas de `text` (sin frontmatter) al final del mazo `target`. */
function appendBody(target: string, text: string): string {
  const body = parseFrontmatter(text).body.trim();
  return body ? `${target.replace(/\s*$/, '')}\n\n${body}\n` : target;
}

/** Quita el bloque de una nota (su línea `^id` incluida) sin tocar el resto. */
export function removeBlock(text: string, id: string): string {
  const doc = parseFrontmatter(text);
  const head = text.slice(0, text.length - doc.body.length);
  const n = parseDeck(text).notes.find((x) => x.id === id);
  if (!n) return text;
  const lines = doc.body.split(/\r?\n/);
  lines.splice(n.line, n.endLine - n.line + 1);
  return head + lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Cambia el nombre visible (`deck:`) de un archivo de mazo. */
function renameDeckText(text: string, name: string): string {
  const doc = parseFrontmatter(text);
  return stringifyFrontmatter({ ...doc.data, deck: name }, doc.hasFrontmatter ? doc.body : text);
}

/**
 * Mueve un mazo (con sus submazos) a `folder` ('' = nivel superior). Si allí hay otro con el
 * mismo nombre: `rename` lo deja como «Nombre (2)»; `merge` junta sus tarjetas en el existente
 * (y sus submazos en la carpeta de este).
 */
export async function moveDeck(vault: VaultAdapter, col: Collection, d: Deck, folder: string, clash: Clash = 'rename', log: Undo = []): Promise<Undo> {
  if (!canMoveTo(d, folder) || folder === d.folder) return log;
  const subs = withSubdecks(col, d).slice(1);
  const oldSub = `${dirOf(d.folder)}/${d.name}`;
  const other = clashOf(col, d, folder);
  let name = d.name;
  let moved = other?.path ?? '';
  if (other && clash === 'merge') {
    await write(vault, log, other.path, appendBody(await readTextOr(vault, other.path, ''), await readTextOr(vault, d.path, '')));
    await remove(vault, log, d.path);
  } else {
    let to = `${dirOf(folder)}/${fileOf(d.path)}`;
    if (other || (await vault.exists(to))) {
      const taken = new Set(col.decks.filter((x) => x.folder === folder).map((x) => x.name));
      let n = 2;
      while (taken.has(`${d.name} (${n})`) || (await vault.exists(withSuffix(to, n)))) n++;
      name = `${d.name} (${n})`;
      to = withSuffix(to, n);
      await move(vault, log, d.path, to);
      await write(vault, log, to, renameDeckText(await readTextOr(vault, to, ''), name));
    } else await move(vault, log, d.path, to);
    moved = to;
  }
  const newFull = folder ? `${folder}/${name}` : name;
  const newSub = `${dirOf(folder)}/${name}`;
  const paths: [string, string][] = [[d.path, moved]];
  // submazos: archivo por archivo (si ya hay uno igual en la carpeta del destino, «(2)»)
  for (const s of subs) {
    const rel = s.path.slice(oldSub.length + 1);
    let to = `${newSub}/${rel}`;
    if (await vault.exists(to)) {
      let n = 2;
      while (await vault.exists(withSuffix(to, n))) n++;
      to = withSuffix(to, n);
      await move(vault, log, s.path, to);
      await write(vault, log, to, renameDeckText(await readTextOr(vault, to, ''), `${s.name} (${n})`));
    } else await move(vault, log, s.path, to);
    paths.push([s.path, to]);
  }
  if (subs.length && (await vault.exists(oldSub)) && !(await walk(vault, oldSub)).length) await vault.remove(oldSub);
  await rewriteDeckRefs(vault, log, [[d.full, newFull]], paths);
  await rewriteSpaces(vault, log, spaceFix([[d.full, newFull]], paths));
  return log;
}

/** Paneles «mazo» (ruta) y «tema» (`decks/<carpeta>/`). */
const spaceFix = (names: [string, string][], paths: [string, string][]) => (type: string, arg: string) => {
  if (type === 'mazo') return paths.find(([a]) => a === arg)?.[1] ?? arg;
  if (type === 'tema' && arg.startsWith('decks/')) return `decks/${names.reduce((acc, [a, b]) => renamePrefix(acc, a, b), arg.slice(6, -1))}/`;
  return arg;
};

/** Mueve varios mazos; los que son descendientes de otro de la lista viajan con su padre. */
export async function moveDecks(vault: VaultAdapter, col: Collection, decks: Deck[], folder: string, clash: Clash = 'rename'): Promise<Undo> {
  const top = decks.filter((d) => !decks.some((p) => p !== d && (d.folder === p.full || d.folder.startsWith(p.full + '/'))));
  const log: Undo = [];
  for (const d of top) await moveDeck(vault, col, d, folder, clash, log);
  return log;
}

export type IdClash = 'skip' | 'duplicate';

/**
 * Mueve tarjetas (por nota) de su mazo a `target`. El ID `^xxxx` se conserva, así que el
 * historial y el estado FSRS siguen a la tarjeta. Si el destino ya tiene una nota con ese ID:
 * `skip` la deja donde está; `duplicate` copia la nota con un ID nuevo (sin historial) y
 * deja el original.
 */
export async function moveCards(vault: VaultAdapter, col: Collection, cids: string[], target: Deck, onClash: IdClash = 'skip'): Promise<{ undo: Undo; moved: number; skipped: number; duplicated: number }> {
  const log: Undo = [];
  const ids = [...new Set(cids.map(noteIdOf))];
  let dest = await readTextOr(vault, target.path, '');
  const destIds = new Set(parseDeck(dest).notes.map((n) => n.id));
  const taken = new Set<string>([...col.byCid.keys()].map(noteIdOf));
  const bySource = new Map<string, string[]>();
  let moved = 0, skipped = 0, duplicated = 0;
  for (const id of ids) {
    const src = col.decks.find((d) => d.notes.some((n) => n.id === id));
    if (!src || src.path === target.path) continue;
    if (destIds.has(id)) {
      if (onClash === 'skip') { skipped++; continue; }
      const raw = src.notes.find((n) => n.id === id)!.raw.replace(/\s*\^[A-Za-z0-9_-]+\s*$/, '');
      const nid = newId(taken);
      taken.add(nid);
      dest = `${dest.replace(/\s*$/, '')}\n\n${raw.trim()} ^${nid}\n`;
      duplicated++;
      continue;
    }
    bySource.set(src.path, [...(bySource.get(src.path) ?? []), id]);
  }
  for (const [path, list] of bySource) {
    let text = await readTextOr(vault, path, '');
    for (const id of list) {
      const n = parseDeck(text).notes.find((x) => x.id === id);
      if (!n) continue;
      dest = `${dest.replace(/\s*$/, '')}\n\n${n.raw.trim()}\n`;
      text = removeBlock(text, id);
      moved++;
    }
    await write(vault, log, path, text);
  }
  if (moved || duplicated) await write(vault, log, target.path, dest);
  return { undo: log, moved, skipped, duplicated };
}

/**
 * Mueve una carpeta de mazos (un «tema» sin archivo propio, p. ej. `Cardiología/`) dentro de
 * `dest`. Si existe el mazo homónimo (`Cardiología.md`), se mueve con él como un mazo más.
 */
export async function moveFolder(vault: VaultAdapter, col: Collection, folder: string, dest: string, clash: Clash = 'rename', log: Undo = []): Promise<Undo> {
  const owner = col.decks.find((d) => d.full === folder);
  if (owner) return moveDeck(vault, col, owner, dest, clash, log);
  const base = folder.split('/').pop()!;
  const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '';
  if (dest === parent || dest === folder || dest.startsWith(folder + '/')) return log;
  let target = dest ? `${dest}/${base}` : base;
  const exists = col.decks.some((d) => d.full === target || d.folder === target || d.folder.startsWith(target + '/'));
  if (exists && clash === 'rename') {
    let n = 2;
    while (col.decks.some((d) => d.full === `${target} (${n})` || d.folder === `${target} (${n})` || d.folder.startsWith(`${target} (${n})/`))) n++;
    target = `${target} (${n})`;
  }
  const paths: [string, string][] = [];
  for (const d of col.decks.filter((x) => x.folder === folder || x.folder.startsWith(folder + '/'))) {
    let to = `decks/${target}/${d.path.slice(`decks/${folder}/`.length)}`;
    if (await vault.exists(to)) {
      let n = 2;
      while (await vault.exists(withSuffix(to, n))) n++;
      to = withSuffix(to, n);
      await move(vault, log, d.path, to);
      await write(vault, log, to, renameDeckText(await readTextOr(vault, to, ''), `${d.name} (${n})`));
    } else await move(vault, log, d.path, to);
    paths.push([d.path, to]);
  }
  if ((await vault.exists(`decks/${folder}`)) && !(await walk(vault, `decks/${folder}`)).length) await vault.remove(`decks/${folder}`);
  await rewriteDeckRefs(vault, log, [[folder, target]], paths);
  await rewriteSpaces(vault, log, spaceFix([[folder, target]], paths));
  return log;
}
