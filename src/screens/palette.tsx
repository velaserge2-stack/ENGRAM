import { t as tr } from '../i18n';
import MiniSearch from 'minisearch';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { normalizeAnswer } from '../cards/parse';
import { TABS } from '../nav';
import { go, href, useApp, useAsync } from '../state';
import { Sheet } from '../ui/kit';
import { readTextOr, walk } from '../vault/util';
import { addonOn } from './addons';
import { search as searchCards } from '../lib/query';

interface Item {
  id: string;
  kind: string;
  title: string;
  sub?: string;
  run: () => void;
}

/** Un solo buscador ⌘K: cambio rápido, búsqueda global y comandos. */
export function Palette(props: { mode: string | null; onClose: () => void }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const { data: notes } = useAsync(async () => {
    const files = (await walk(app.vault, 'notes')).filter((f) => f.path.endsWith('.md'));
    const docs = [];
    for (const f of files.slice(0, 3000)) docs.push({ id: f.path, title: f.name.replace(/\.md$/, ''), body: (await readTextOr(app.vault, f.path, '').catch(() => '')).slice(0, 20000) /* solo lectura */ });
    const ms = new MiniSearch({ fields: ['title', 'body'], storeFields: ['title'], searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 3 }, processTerm: (t) => normalizeAnswer(t) }, processTerm: (t) => normalizeAnswer(t) || null });
    ms.addAll(docs);
    return { ms, docs };
  }, [app.version, app.notesVersion]);
  const close = (fn: () => void) => () => (props.onClose(), fn());
  const commands: Item[] = [
    { id: 'c-study', kind: tr('palette.k_cmd'), title: tr('decks.estudiar_todo'), run: close(() => go('estudiar')) },
    { id: 'c-add', kind: tr('palette.k_cmd'), title: tr('app.anadir_tarjeta'), run: () => app.openSheet('add') },
    { id: 'c-note', kind: tr('palette.k_cmd'), title: tr('notes.nueva_nota'), sub: '⌘N', run: close(() => go('notas', '+nueva')) },
    { id: 'c-daily', kind: tr('palette.k_cmd'), title: tr('palette.nota_diaria_de_hoy'), run: close(() => go('notas', '+diaria')) },
    { id: 'c-import', kind: tr('palette.k_cmd'), title: tr('palette.importar_archivos'), run: () => app.openSheet('import') },
    { id: 'c-backup', kind: tr('palette.k_cmd'), title: tr('palette.respaldar_boveda'), run: () => app.openSheet('backup') },
    { id: 'c-exam', kind: tr('palette.k_cmd'), title: tr('exams.anadir_examen'), run: () => app.openSheet('exam') },
    { id: 'c-pomo', kind: tr('palette.k_cmd'), title: app.pomo.state.running ? tr('palette.pausar_pomodoro') : tr('palette.iniciar_pomodoro'), run: close(() => (app.pomo.state.running ? app.pomo.pause() : app.pomo.start())) },
    { id: 'c-sim', kind: tr('palette.k_cmd'), title: tr('palette.crear_simulacro'), run: close(() => go('simulacros')) },
    ...(addonOn(app.settings, 'inbox') ? [{ id: 'c-inbox', kind: tr('palette.k_cmd'), title: tr('palette.procesar_bandeja'), run: close(() => go('bandeja')) }] : []),
    { id: 'c-addons', kind: tr('palette.k_cmd'), title: tr('addons.add_ons'), run: close(() => go('ajustes', 'addons')) },
    { id: 'c-design', kind: tr('palette.k_cmd'), title: tr('palette.pagina_de_diseno_design'), run: close(() => go('design')) },
    ...TABS.map((t) => ({ id: 'g-' + t.id, kind: tr('palette.ir_a'), title: t.label, run: close(() => go(t.id)) })),
    { id: 'g-aj', kind: 'Ir a', title: tr('app.ajustes'), run: close(() => go('ajustes')) },
  ];
  const items = useMemo<Item[]>(() => {
    const nq = normalizeAnswer(q);
    const out: Item[] = [];
    if (props.mode !== 'archivos') out.push(...commands.filter((c) => !nq || normalizeAnswer(c.title).includes(nq)));
    for (const d of app.col?.decks ?? []) if (!nq || normalizeAnswer(d.full).includes(nq)) out.push({ id: d.path, kind: tr('palette.k_deck'), title: d.full, sub: `${d.cards.length} tarjetas`, run: close(() => go('mazos', ...d.path.split('/'))) });
    if (notes) {
      const hits = nq ? notes.ms.search(q).slice(0, 20).map((h) => h.id as string) : notes.docs.slice(0, 15).map((d) => d.id);
      for (const id of hits) out.push({ id, kind: tr('palette.k_note'), title: id.split('/').pop()!.replace(/\.md$/, ''), sub: id.split('/').slice(1, -1).join(' › '), run: close(() => (location.hash = href('notas', ...id.split('/').slice(1)))) });
    }
    if (nq.length >= 3 && app.col && props.mode !== 'archivos') for (const r of searchCards(app.col, q).slice(0, 15)) out.push({ id: r.cid, kind: tr('palette.k_card'), title: r.front.slice(0, 90), sub: r.deck, run: close(() => go('explorar', `id:${r.cid}`)) });
    return out.slice(0, 60);
  }, [q, notes, app.col]);
  const pick = Math.min(i, Math.max(0, items.length - 1));
  return (
    <Sheet title={props.mode === 'archivos' ? tr('palette.cambio_rapido') : tr('palette.buscar_y_comandos')} onClose={props.onClose}>
      <div class="palette stack-s">
        <input ref={input} class="input wide" type="search" placeholder={tr('palette.busca_notas_mazos_tarjetas_o_comandos')} value={q} onInput={(e) => (setQ((e.target as HTMLInputElement).value), setI(0))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setI(Math.min(items.length - 1, pick + 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setI(Math.max(0, pick - 1)));
            else if (e.key === 'Enter') (e.preventDefault(), items[pick]?.run());
          }} aria-label={tr('inbox.buscar')} />
        <div class="res" role="listbox">
          {items.map((it, k) => (
            <button type="button" role="option" aria-selected={k === pick} class={k === pick ? 'on' : ''} onClick={it.run} onMouseEnter={() => setI(k)}>
              <span class="chip">{it.kind}</span>
              <span class="grow ellipsis">{it.title}</span>
              {it.sub && <span class="foot ellipsis" style={{ maxWidth: '40%' }}>{it.sub}</span>}
            </button>
          ))}
          {!items.length && <p class="t2" style={{ padding: '10px' }}>{tr('palette.sin_resultados')}</p>}
        </div>
        <p class="foot">{tr('palette.para_moverte_para_abrir_k_en')}</p>
      </div>
    </Sheet>
  );
}
