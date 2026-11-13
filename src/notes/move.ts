/**
 * Mover notas `.md` entre materias, temas y subcarpetas (Prompt 6 · A2).
 *
 * Se mueve el archivo (SafeVault) y se reparan las referencias por RUTA; las que van por título
 * (`[[Título]]`) o por `id:` siguen resolviendo solas:
 *   - `[[Materia/Tema/Nota]]`, `[[notes/…]]` y `[texto](notes/….md)` en otras notas;
 *   - `<!-- src: notes/….md#pN -->` de las tarjetas;
 *   - `engrama://note/<ruta>` del calendario (los de `id` no cambian);
 *   - el historial de versiones `.app/history/<ruta>/` viaja con la nota.
 * Imágenes y dibujos viven en `media/` y no se mueven. La papelera no se toca.
 * Devuelve un registro para deshacer (el mismo formato que mover mazos).
 */
import { parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter';
import { fromICS, toICS } from '../lib/ics';
import { makeUri, parseUri } from '../lib/links';
import { rewriteSpaces, type Undo } from '../data/move';
import { withSuffix } from '../vault/paths';
import type { VaultAdapter } from '../vault/types';
import { readTextOr, walk } from '../vault/util';
import { DAILY, noteMeta } from './model';

export type NoteClash = 'rename' | 'replace';
const HISTORY = '.app/history';
const TRASH = '.app/trash';
const CAL = 'calendar/estudio.ics';

/** Carpeta de destino: '' = raíz de notes/ («Sin clasificar»). */
export const noteDir = (dest: string) => (dest ? `notes/${dest}` : 'notes');

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const noExt = (p: string) => p.replace(/\.md$/, '');

/** Carpetas de notas existentes como destino (materias, temas y subcarpetas; sin el Diario). */
export function noteFolders(paths: string[], extra: string[] = []): string[] {
  const out = new Set<string>(extra);
  for (const p of paths) {
    const parts = p.split('/').slice(1, -1);
    for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/'));
  }
  out.delete(DAILY);
  return [...out].filter((f) => !f.startsWith(DAILY + '/')).sort((a, b) => a.localeCompare(b, 'es'));
}

/** Reescribe en un texto las referencias por ruta de `from` a `to` (rutas completas `notes/….md`). */
export function rewriteNoteRefs(text: string, from: string, to: string): string {
  const a = noExt(from), b = noExt(to);
  const a2 = a.replace(/^notes\//, ''), b2 = b.replace(/^notes\//, '');
  // `[[Título]]` (sin carpeta) lo resuelve el título, no la ruta: no se reescribe (si no, `[[Nota]]`
  // pasaría a `[[Materia/Nota]]`, que el resolvedor no encuentra). Solo las formas con carpeta.
  const alt = a2.includes('/') ? `|${esc(a2)}` : '';
  return text
    // [[notes/M/T/N]] · [[M/T/N]] · con .md, #ancla o |alias
    .replace(new RegExp(`(\\[\\[)(${esc(a)}${alt})(\\.md)?(?=[\\]#|])`, 'g'), (_m, o: string, p: string, md = '') => `${o}${p === a ? b : b2}${md}`)
    // [texto](notes/M/T/N.md) (también codificado con %20)
    .replace(new RegExp(`(\\]\\()(${esc(from)}|${esc(encodeURI(from))})(?=[)#])`, 'g'), (_m, o: string, p: string) => `${o}${p === from ? to : encodeURI(to)}`)
    // <!-- src: notes/M/T/N.md#p3 -->
    .replace(new RegExp(`(<!--\\s*src:\\s*)${esc(from)}(?=[#\\s])`, 'g'), `$1${to}`);
}

async function write(vault: VaultAdapter, log: Undo, path: string, text: string) {
  const before = (await vault.exists(path)) ? await readTextOr(vault, path, '') : null;
  if (before === text) return;
  await vault.write(path, text); // se anota después: una escritura (atómica) que falla no cambió nada
  log.push({ kind: 'write', path, before });
}
async function move(vault: VaultAdapter, log: Undo, from: string, to: string) {
  await vault.move(from, to);
  log.push({ kind: 'move', from, to });
}

/** ¿Qué notas chocan por nombre en el destino? */
export async function noteClashes(vault: VaultAdapter, paths: string[], dest: string): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    const to = `${noteDir(dest)}/${p.split('/').pop()}`;
    if (to !== p && (await vault.exists(to))) out.push(p);
  }
  return out;
}

/**
 * Mueve notas a `dest` (relativo a `notes/`, p. ej. `Cardiología/ECG`). Con nombre repetido:
 * `rename` → «Nota (2).md»; `replace` → la existente va a la papelera (se puede restaurar).
 * `rel` conserva subcarpetas al mover un tema entero (ruta relativa por nota).
 */
export async function moveNotes(vault: VaultAdapter, paths: string[], dest: string, clash: NoteClash = 'rename', rel?: Map<string, string>, log: Undo = []): Promise<{ undo: Undo; moved: [string, string][] }> {
  const moved: [string, string][] = [];
  const now = Date.now();
  for (const from of paths) {
    let to = `${noteDir(dest)}/${rel?.get(from) ?? from.split('/').pop()}`;
    if (to === from) continue;
    // solo cambia mayúsculas: en FS sin distinción, `exists(to)` es la propia nota; choca solo si
    // la carpeta tiene de verdad otro archivo con ese nombre exacto, y se mueve vía un temporal
    const caseOnly = to.toLowerCase() === from.toLowerCase();
    const name = to.split('/').pop();
    if (caseOnly ? (await vault.list(to.slice(0, to.lastIndexOf('/')))).some((e) => e.name === name) : await vault.exists(to)) {
      if (clash === 'replace') await move(vault, log, to, `${TRASH}/${now}/${to}`);
      else {
        let n = 2;
        while (await vault.exists(withSuffix(to, n))) n++;
        to = withSuffix(to, n);
      }
    }
    if (caseOnly && to.toLowerCase() === from.toLowerCase()) {
      const tmp = `${from}.${now}.mv`;
      await move(vault, log, from, tmp);
      await move(vault, log, tmp, to);
    } else await move(vault, log, from, to);
    // materia/tema del frontmatter, solo si la nota ya los tenía (cambio perezoso)
    const m = noteMeta(to);
    const text = await readTextOr(vault, to, '');
    const doc = parseFrontmatter(text);
    const depth = to.split('/').length - 1;
    if (doc.hasFrontmatter && depth <= 3 && m.materia !== DAILY && ('materia' in doc.data || 'tema' in doc.data)) {
      // Prompt 12: se escriben solo si tienen valor («Sin clasificar» o «Sin tema» los quitan)
      const data = { ...doc.data };
      if (m.structured && m.materia) data.materia = m.materia; else delete data.materia;
      if (m.structured && m.tema) data.tema = m.tema; else delete data.tema;
      await write(vault, log, to, stringifyFrontmatter(data, doc.body));
    }
    for (const h of await walk(vault, `${HISTORY}/${from}`)) await move(vault, log, h.path, `${HISTORY}/${to}/${h.path.slice(`${HISTORY}/${from}/`.length)}`);
    moved.push([from, to]);
  }
  if (!moved.length) return { undo: log, moved };
  // referencias por ruta en notas y mazos
  for (const f of [...(await walk(vault, 'notes')), ...(await walk(vault, 'decks'))]) {
    if (!f.path.endsWith('.md')) continue;
    const t = await readTextOr(vault, f.path, '');
    const next = moved.reduce((acc, [a, b]) => rewriteNoteRefs(acc, a, b), t);
    if (next !== t) await write(vault, log, f.path, next);
  }
  // calendario: vínculos por ruta (los de id siguen valiendo)
  const ics = await readTextOr(vault, CAL, '');
  if (ics) {
    const blocks = fromICS(ics);
    let touched = false;
    for (const b of blocks) {
      b.links = b.links?.map((u) => {
        const p = parseUri(u);
        const hit = p?.kind === 'note' && moved.find(([a]) => a === p.key || noExt(a) === p.key || noExt(a).replace(/^notes\//, '') === p.key);
        if (!hit) return u;
        touched = true;
        return makeUri('note', hit[1]);
      });
      if (!b.links?.length) delete b.links;
    }
    if (touched) await write(vault, log, CAL, toICS(blocks));
  }
  // paneles de nota del lienzo (`ruta` o `ruta#fragmento`)
  await rewriteSpaces(vault, log, (type, arg) => {
    if (type !== 'nota') return arg;
    const [p, ...frag] = arg.split('#');
    const hit = moved.find(([a]) => a === p);
    return hit ? [hit[1], ...frag].join('#') : arg;
  });
  return { undo: log, moved };
}

/** Un tema (o una subcarpeta) entero a otra materia o carpeta: `Cardiología/ECG` → `Urgencias`. */
export async function moveNoteFolder(vault: VaultAdapter, folder: string, destParent: string, clash: NoteClash = 'rename', log: Undo = []): Promise<{ undo: Undo; moved: [string, string][] }> {
  const base = folder.split('/').pop()!;
  const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '';
  if (destParent === parent || destParent === folder || destParent.startsWith(folder + '/')) return { undo: log, moved: [] };
  const files = (await walk(vault, `notes/${folder}`)).filter((f) => f.path.endsWith('.md')).map((f) => f.path);
  const rel = new Map(files.map((p) => [p, p.slice(`notes/${folder}/`.length)]));
  const r = await moveNotes(vault, files, destParent ? `${destParent}/${base}` : base, clash, rel, log);
  if ((await vault.exists(`notes/${folder}`)) && !(await walk(vault, `notes/${folder}`)).length) await vault.remove(`notes/${folder}`);
  return r;
}
