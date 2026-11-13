import { errMsg, t } from '../i18n';
import { FilePlus2, FolderInput } from 'lucide-preact';
import { useState } from 'preact/hooks';
import type { Collection, Deck } from '../data/collection';
import { canMoveTo, clashOf, type Clash, type IdClash, moveCards, moveDeck, moveFolder, type Undo, undoMove } from '../data/move';
import { noteIdOf, parseDeck } from '../cards/parse';
import { createDeck } from '../data/ops';
import { useApp } from '../state';
import { Sheet } from '../ui/kit';
import { readTextOr } from '../vault/util';

/** Lo que se mueve: mazos (con sus submazos) y carpetas sin mazo propio. */
export interface MoveItems { decks: Deck[]; folders: string[] }

const label = (folder: string) => folder.split('/').pop()!;

/** Destinos posibles: «Nivel superior» y cada mazo o carpeta existente (sin el propio ni sus descendientes). */
function destinations(col: Collection, items: MoveItems): string[] {
  const all = new Set<string>();
  for (const d of col.decks) {
    all.add(d.full);
    const parts = d.folder ? d.folder.split('/') : [];
    for (let i = 1; i <= parts.length; i++) all.add(parts.slice(0, i).join('/'));
  }
  const roots = [...items.decks.map((d) => d.full), ...items.folders];
  return ['', ...[...all].sort((a, b) => a.localeCompare(b, 'es'))].filter((f) => roots.every((r) => f !== r && !f.startsWith(r + '/')));
}

/** ¿Algo choca por nombre en el destino? */
function hasClash(col: Collection, items: MoveItems, dest: string): boolean {
  return items.decks.some((d) => clashOf(col, d, dest)) ||
    items.folders.some((f) => { const to = dest ? `${dest}/${label(f)}` : label(f); return to !== f && col.decks.some((d) => d.full === to || d.folder === to || d.folder.startsWith(to + '/')); });
}

/** Ejecuta el movimiento (los descendientes de otro elemento viajan con su padre). */
async function runMove(app: ReturnType<typeof useApp>, items: MoveItems, dest: string, clash: Clash): Promise<void> {
  const col = app.col!;
  const roots = [...items.decks.map((d) => d.full), ...items.folders];
  const inside = (full: string) => roots.some((r) => r !== full && full.startsWith(r + '/'));
  const log: Undo = [];
  try {
    await app.vault.batch(async (tx) => { // todo el movimiento en un solo diario
      for (const d of items.decks) if (!inside(d.full) && canMoveTo(d, dest)) await moveDeck(tx, col, d, dest, clash, log);
      for (const f of items.folders) if (!inside(f)) await moveFolder(tx, col, f, dest, clash, log);
    });
  } catch (e) {
    // a medias: se deshace lo que alcanzó a moverse (el registro sí está completo hasta el fallo)
    await undoMove(app.vault, log).catch(() => {});
    return app.toast(t('move.fallo', { message: errMsg(e) }));
  } finally {
    app.changed();
  }
  if (!log.length) return;
  const n = items.decks.length + items.folders.length;
  app.toast(t('move.movidos', { n, dest: dest || t('move.nivel_superior') }), { label: t('move.deshacer'), run: async () => { await undoMove(app.vault, log); app.changed(); app.toast(t('move.deshecho')); } });
}

/** Renombrar / Fusionar / Cancelar cuando el destino ya tiene un mazo con ese nombre. */
function ClashSheet(p: { onPick: (c: Clash | null) => void; names: string }) {
  return (
    <Sheet title={t('move.nombre_repetido')} onClose={() => p.onPick(null)}>
      <div class="stack">
        <p>{t('move.ya_existe')} <b data-user-content>{p.names}</b></p>
        <p class="foot">{t('move.renombrar_nota')} {t('move.fusionar_nota')}</p>
        <div class="row wrap" style={{ justifyContent: 'flex-end' }}>
          <button type="button" class="btn" onClick={() => p.onPick(null)}>{t('settings.cancelar')}</button>
          <button type="button" class="btn" onClick={() => p.onPick('merge')}>{t('move.fusionar')}</button>
          <button type="button" class="btn primary" onClick={() => p.onPick('rename')}>{t('move.renombrar')}</button>
        </div>
      </div>
    </Sheet>
  );
}

/** Mueve ya, o pregunta si hay nombres repetidos. Para soltar al arrastrar. */
export function useMoveTo(onDone?: () => void) {
  const app = useApp();
  const [ask, setAsk] = useState<{ items: MoveItems; dest: string } | null>(null);
  const go = async (items: MoveItems, dest: string) => {
    if (!app.col) return;
    if (hasClash(app.col, items, dest)) return setAsk({ items, dest });
    await runMove(app, items, dest, 'rename');
    onDone?.();
  };
  const sheet = ask && <ClashSheet names={[...ask.items.decks.map((d) => d.name), ...ask.items.folders.map(label)].join(', ')} onPick={async (c) => { const a = ask; setAsk(null); if (c) { await runMove(app, a.items, a.dest, c); onDone?.(); } }} />;
  return { go, sheet };
}

/** Hoja «Mover a…» con el árbol de mazos. */
export function MoveDecksSheet(p: { items: MoveItems; onClose: () => void; onDone?: () => void }) {
  const app = useApp();
  const col = app.col!;
  const dests = destinations(col, p.items);
  const [dest, setDest] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mover = useMoveTo(() => { p.onClose(); p.onDone?.(); });
  const names = [...p.items.decks.map((d) => d.full), ...p.items.folders];
  const here = (f: string) => p.items.decks.every((d) => d.folder === f) && p.items.folders.every((x) => (x.includes('/') ? x.slice(0, x.lastIndexOf('/')) : '') === f);
  const submit = async (to: string) => {
    setBusy(true);
    if (creating !== null && creating.trim()) {
      const path = await createDeck(app.vault, creating.trim(), to);
      const name = parseDeck(await readTextOr(app.vault, path, '')).data.deck as string;
      to = to ? `${to}/${name}` : name;
    }
    setCreating(null);
    await mover.go(p.items, to);
    setBusy(false);
  };
  return (
    <>
      <Sheet title={t('move.mover_a')} onClose={p.onClose}>
        <div class="stack">
          <p class="foot ellipsis" data-user-content>{names.join(', ')}</p>
          <div class="move-tree stack-s" role="radiogroup" aria-label={t('move.destino')}>
            {dests.map((f) => {
              const depth = f ? f.split('/').length - 1 : 0;
              const isDeck = col.decks.some((d) => d.full === f);
              return (
                <button type="button" role="radio" aria-checked={dest === f} class="opt note" disabled={here(f) && creating === null} style={{ paddingLeft: `${12 + depth * 18}px` }} onClick={() => setDest(f)}>
                  {f === '' ? <>⤒ {t('move.nivel_superior')}</> : <><span aria-hidden="true">{isDeck ? '📚' : '📁'}</span> <span class="grow ellipsis" data-user-content>{label(f)}</span></>}
                  {here(f) && <span class="foot">{t('move.aqui')}</span>}
                </button>
              );
            })}
          </div>
          {creating !== null ? (
            <label class="field">{t('move.nuevo_mazo_en', { dest: dest ? label(dest) : t('move.nivel_superior') })}<input class="input" value={creating} autoFocus onInput={(e) => setCreating((e.target as HTMLInputElement).value)} /></label>
          ) : (
            <button type="button" class="btn small" style={{ justifySelf: 'start' }} disabled={dest === null} onClick={() => setCreating('')}><FilePlus2 size={16} />{' '}{t('move.nuevo_mazo_aqui')}</button>
          )}
          <div class="row wrap" style={{ justifyContent: 'flex-end' }}>
            <button type="button" class="btn" onClick={p.onClose}>{t('settings.cancelar')}</button>
            <button type="button" class="btn primary" disabled={busy || dest === null || (creating !== null && !creating.trim())} onClick={() => dest !== null && void submit(dest)}><FolderInput size={16} />{' '}{t('move.mover_aqui')}</button>
          </div>
        </div>
      </Sheet>
      {mover.sheet}
    </>
  );
}

/** «Mover a mazo…» para tarjetas: conservan ID, historial y programación. */
export function MoveCardsSheet(p: { cids: string[]; onClose: () => void; onDone?: () => void }) {
  const app = useApp();
  const col = app.col!;
  const ids = new Set(p.cids.map(noteIdOf));
  const from = new Set(col.decks.filter((d) => d.notes.some((n) => ids.has(n.id))).map((d) => d.path));
  const [ask, setAsk] = useState<{ target: Deck; n: number } | null>(null);
  const run = async (target: Deck, mode: IdClash) => {
    let r: Awaited<ReturnType<typeof moveCards>>;
    try {
      r = await moveCards(app.vault, col, p.cids, target, mode); // si falla, ya deshizo lo escrito
    } catch (e) {
      app.changed();
      p.onClose();
      return app.toast(t('move.fallo', { message: errMsg(e) }));
    }
    app.changed();
    p.onClose();
    p.onDone?.();
    const msg = [r.moved && t('move.tarjetas_movidas', { n: r.moved, dest: target.full }), r.duplicated && t('move.duplicadas', { n: r.duplicated }), r.skipped && t('move.omitidas', { n: r.skipped })].filter(Boolean).join(' · ');
    if (r.undo.length) app.toast(msg, { label: t('move.deshacer'), run: async () => { await undoMove(app.vault, r.undo); app.changed(); app.toast(t('move.deshecho')); } });
    else app.toast(msg || t('move.nada_que_mover'));
  };
  const pick = (target: Deck) => {
    const n = target.notes.filter((x) => ids.has(x.id)).length;
    if (n && !from.has(target.path)) return setAsk({ target, n });
    void run(target, 'skip');
  };
  return (
    <>
      <Sheet title={t('move.mover_a_mazo', { n: ids.size })} onClose={p.onClose}>
        <div class="move-tree stack-s">
          {col.decks.map((d) => (
            <button type="button" class="opt note" disabled={from.size === 1 && from.has(d.path)} style={{ paddingLeft: `${12 + (d.full.split('/').length - 1) * 18}px` }} onClick={() => pick(d)}>
              <span aria-hidden="true">📚</span> <span class="grow ellipsis" data-user-content>{d.name}</span>
              {from.has(d.path) && <span class="foot">{t('move.aqui')}</span>}
            </button>
          ))}
        </div>
      </Sheet>
      {ask && (
        <Sheet title={t('move.id_repetido')} onClose={() => setAsk(null)}>
          <div class="stack">
            <p>{t('move.id_repetido_n', { n: ask.n, dest: ask.target.full })}</p>
            <div class="row wrap" style={{ justifyContent: 'flex-end' }}>
              <button type="button" class="btn" onClick={() => setAsk(null)}>{t('settings.cancelar')}</button>
              <button type="button" class="btn" onClick={() => { const a = ask; setAsk(null); void run(a.target, 'duplicate'); }}>{t('move.duplicar')}</button>
              <button type="button" class="btn primary" onClick={() => { const a = ask; setAsk(null); void run(a.target, 'skip'); }}>{t('move.omitir')}</button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
