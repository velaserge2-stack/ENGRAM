import { errMsg, t as tr } from '../i18n';
import { FolderInput, FolderPlus } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { type Undo, undoMove } from '../data/move';
import { moveNoteFolder, moveNotes, type NoteClash, noteDir, noteFolders } from '../notes/move';
import { notesIndex } from '../notes/search-client';
import { noteStore } from '../notes/store';
import { go, useApp } from '../state';
import { Sheet } from '../ui/kit';
import { readTextOr, walk } from '../vault/util';

/** Qué se mueve: notas sueltas (rutas completas) o carpetas (relativas a `notes/`, p. ej. un tema). */
export interface NoteItems { notes: string[]; folders: string[]; /** nuevo título (una sola nota) */ title?: string }
const fileName = (items: NoteItems, p: string) => (items.title && items.notes.length === 1 && items.notes[0] === p ? `${items.title}.md` : p.split('/').pop()!);

const clean = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
const depth = (f: string) => f.split('/').length;
const parentOf = (f: string) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '');

/** Destinos: para notas, temas y subcarpetas existentes (y carpetas que ya tienen notas sueltas); para un tema, las materias. */
function noteDestinations(all: string[], items: NoteItems): string[] {
  const folders = noteFolders(all);
  const direct = new Set(all.map((p) => parentOf(p.slice('notes/'.length))).filter(Boolean));
  return folders.filter((f) =>
    items.folders.every((x) => f !== x && !f.startsWith(x + '/')) &&
    (items.folders.length ? depth(f) === 1 : depth(f) >= 2 || direct.has(f)));
}

/** Ejecuta el movimiento y actualiza NoteStore, el índice de búsqueda y la ruta abierta. */
export async function runNoteMove(app: ReturnType<typeof useApp>, items: NoteItems, dest: string, clash: NoteClash, current?: string | null): Promise<void> {
  const involved = [...items.notes];
  for (const f of items.folders) involved.push(...(await walk(app.vault, `notes/${f}`)).filter((x) => x.path.endsWith('.md')).map((x) => x.path));
  for (const p of involved) { await noteStore.flush(p); await noteStore.forget(p); }
  const undo: Undo = [], moved: [string, string][] = [];
  try {
    await app.vault.batch(async (tx) => { // notas y carpetas en un solo diario
      if (items.notes.length) moved.push(...(await moveNotes(tx, items.notes, dest, clash, new Map(items.notes.map((n) => [n, fileName(items, n)])), undo)).moved);
      for (const f of items.folders) moved.push(...(await moveNoteFolder(tx, f, dest, clash, undo)).moved);
    });
  } catch (e) {
    // lote todo o nada: nada que deshacer (ver move.tsx)
    app.changed();
    return app.toast(tr('move.fallo', { message: errMsg(e) }));
  }
  const reindex = async (pairs: [string, string][]) => {
    for (const [a, b] of pairs) { await noteStore.forget(a); await notesIndex.remove(a); await notesIndex.upsert(b, await readTextOr(app.vault, b, '')); }
  };
  try { await reindex(moved); } finally { app.changed(); }
  const open = moved.find(([a]) => a === current);
  if (open) go('notas', ...open[1].split('/').slice(1));
  if (!moved.length) return;
  app.toast(tr('notemove.movidas', { n: moved.length, dest: dest || tr('notes.sin_clasificar') }), {
    label: tr('move.deshacer'),
    run: async () => {
      for (const [, b] of moved) await noteStore.forget(b);
      await undoMove(app.vault, undo);
      await reindex(moved.map(([a, b]) => [b, a]));
      app.changed();
      const back = moved.find(([, b]) => b === (open?.[1] ?? ''));
      if (back) go('notas', ...back[0].split('/').slice(1));
      app.toast(tr('move.deshecho'));
    },
  });
}

/** Renombrar / Reemplazar / Cancelar. */
function NoteClashSheet(p: { names: string[]; onPick: (c: NoteClash | null) => void }) {
  return (
    <Sheet title={tr('move.nombre_repetido')} onClose={() => p.onPick(null)}>
      <div class="stack">
        <p>{tr('notemove.ya_existe')} <b data-user-content>{p.names.join(', ')}</b></p>
        <p class="foot">{tr('notemove.reemplazar_nota')}</p>
        <div class="row wrap" style={{ justifyContent: 'flex-end' }}>
          <button type="button" class="btn" onClick={() => p.onPick(null)}>{tr('settings.cancelar')}</button>
          <button type="button" class="btn danger" onClick={() => p.onPick('replace')}>{tr('notemove.reemplazar')}</button>
          <button type="button" class="btn primary" onClick={() => p.onPick('rename')}>{tr('move.renombrar')}</button>
        </div>
      </div>
    </Sheet>
  );
}

/** Mover ya, o preguntar si hay nombres repetidos (también para soltar al arrastrar). */
export function useNoteMover(current?: string | null, onDone?: () => void) {
  const app = useApp();
  const [ask, setAsk] = useState<{ items: NoteItems; dest: string; names: string[] } | null>(null);
  const go2 = async (items: NoteItems, dest: string) => {
    const paths = [...items.notes];
    for (const f of items.folders) for (const x of await walk(app.vault, `notes/${f}`)) if (x.path.endsWith('.md')) paths.push(x.path);
    const rel = (p: string) => { const f = items.folders.find((x) => p.startsWith(`notes/${x}/`)); return f ? `${dest}/${f.split('/').pop()}/${parentOf(p.slice(`notes/${f}/`.length))}`.replace(/\/$/, '') : dest; };
    const clashes: string[] = [];
    for (const p of paths) { const to = `${noteDir(rel(p))}/${fileName(items, p)}`; if (to !== p && (await app.vault.exists(to))) clashes.push(p); }
    if (clashes.length) return setAsk({ items, dest, names: clashes.map((p) => p.split('/').pop()!.replace(/\.md$/, '')) });
    await runNoteMove(app, items, dest, 'rename', current);
    onDone?.();
  };
  const sheet = ask && <NoteClashSheet names={ask.names} onPick={async (c) => { const a = ask; setAsk(null); if (c) { await runNoteMove(app, a.items, a.dest, c, current); onDone?.(); } }} />;
  return { go: go2, sheet };
}

/** Hoja «Mover a…» con el árbol Materia → Tema existente (crear uno nuevo es opcional). */
export function MoveNotesSheet(p: { items: NoteItems; all: string[]; current?: string | null; onClose: () => void; onDone?: () => void }) {
  const dests = noteDestinations(p.all, p.items);
  const [dest, setDest] = useState<string | null>(null);
  const [extra, setExtra] = useState<string[]>([]);
  const [naming, setNaming] = useState<'materia' | 'tema' | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const single = p.items.notes.length === 1 && !p.items.folders.length ? p.items.notes[0]!.split('/').pop()!.replace(/\.md$/, '') : null;
  const [title, setTitle] = useState(single ?? '');
  const renamed = single !== null && clean(title) !== '' && clean(title) !== single;
  const mover = useNoteMover(p.current, () => { p.onClose(); p.onDone?.(); });
  const forNotes = !p.items.folders.length;
  const here = (f: string) => !renamed && p.items.notes.every((n) => parentOf(n.slice(6)) === f) && p.items.folders.every((x) => parentOf(x) === f);
  const list = [...new Set([...dests, ...extra])].sort((a, b) => a.localeCompare(b, 'es'));
  const materias = noteFolders(p.all).filter((f) => depth(f) === 1);
  const create = () => {
    const n = clean(name);
    if (!n) return;
    const f = naming === 'materia' ? n : `${dest!.split('/')[0]}/${n}`;
    setExtra((x) => [...x, f]);
    setDest(f);
    setName('');
    setNaming(null);
  };
  const shown = [...new Set([...list, ...(forNotes ? materias : [])])].sort((a, b) => a.localeCompare(b, 'es'));
  // solo renombrar: sin destino elegido, se queda en su carpeta
  const target = dest ?? (renamed ? parentOf(p.items.notes[0]!.slice(6)) : null);
  // Prompt 12: una nota puede ir a un tema, a una materia («Sin tema») o a «Sin clasificar» ('')
  const valid = (f: string | null) => f !== null && !here(f) && (forNotes || (f !== '' && dests.includes(f)));
  return (
    <>
      <Sheet title={tr('move.mover_a')} onClose={p.onClose}>
        <div class="stack">
          <p class="foot ellipsis" data-user-content>{[...p.items.notes.map((n) => n.split('/').pop()!.replace(/\.md$/, '')), ...p.items.folders].join(', ')}</p>
          <div class="move-tree stack-s" role="radiogroup" aria-label={tr('move.destino')}>
            {forNotes && (
              <button type="button" role="radio" aria-checked={dest === ''} class="opt note" disabled={here('')} onClick={() => setDest('')}>
                <span aria-hidden="true">📄</span> <span class="grow ellipsis">{tr('notes.sin_clasificar')}</span>
                {here('') && <span class="foot">{tr('move.aqui')}</span>}
              </button>
            )}
            {shown.map((f) => {
              return (
                <button type="button" role="radio" aria-checked={dest === f} class="opt note" disabled={here(f)} style={{ paddingLeft: `${12 + (depth(f) - 1) * 18}px` }} onClick={() => setDest(f)}>
                  <span aria-hidden="true">{depth(f) === 1 ? '📁' : '🗂️'}</span> <span class="grow ellipsis" data-user-content>{f.split('/').pop()}</span>
                  {here(f) && <span class="foot">{tr('move.aqui')}</span>}
                </button>
              );
            })}
            {!shown.length && <p class="t2">{tr('notemove.sin_destinos')}</p>}
          </div>
          {naming ? (
            <form class="row wrap" onSubmit={(e) => (e.preventDefault(), create())}>
              <label class="field grow">{naming === 'materia' ? tr('notemove.nueva_materia') : tr('notemove.nuevo_tema_en', { m: dest?.split('/')[0] ?? '' })}<input class="input" value={name} autoFocus onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
              <button type="submit" class="btn small" disabled={!clean(name)}>{tr('notemove.crear')}</button>
            </form>
          ) : (
            <div class="row wrap">
              <button type="button" class="btn small" onClick={() => setNaming('materia')}><FolderPlus size={16} />{' '}{tr('notemove.mas_materia')}</button>
              {forNotes && <button type="button" class="btn small" disabled={!dest} onClick={() => setNaming('tema')}><FolderPlus size={16} />{' '}{tr('notemove.mas_tema')}</button>}
            </div>
          )}
          {single !== null && <label class="field">{tr('calendar.titulo')}<input class="input" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></label>}
          {forNotes && dest && !valid(dest) && !here(dest) && <p class="foot">{tr('notemove.elige_tema')}</p>}
          <div class="row wrap" style={{ justifyContent: 'flex-end' }}>
            <button type="button" class="btn" onClick={p.onClose}>{tr('settings.cancelar')}</button>
            <button type="button" class="btn primary" disabled={busy || !valid(target)} onClick={async () => { setBusy(true); await mover.go(renamed ? { ...p.items, title: clean(title) } : p.items, target!); setBusy(false); }}><FolderInput size={16} />{' '}{dest === null && renamed ? tr('notemove.renombrar') : tr('move.mover_aqui')}</button>
          </div>
        </div>
      </Sheet>
      {mover.sheet}
    </>
  );
}
