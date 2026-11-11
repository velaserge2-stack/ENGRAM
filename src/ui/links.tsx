/** Vínculos del calendario: selector, chips, datos vivos e «Iniciar bloque» (Mejora 1 · §2). */
import { BookOpen, FileText, Folder, Hash, Link2, Unlink } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { normalizeAnswer } from '../cards/parse';
import { buildLinkIndex, ensureFileId, type LinkIndex, type LinkKind, type LinkTarget, makeUri, type Resolved, resolveLink, studyFilter } from '../lib/links';
import type { StudyBlock } from '../lib/ics';
import { studyLimits } from '../lib/settings';
import { deckCounts, inDeck, newIntroducedToday } from '../srs/queue';
import { go, useApp, useAsync } from '../state';
import { Segmented, Sheet } from './kit';

export const CAL_PATH = 'calendar/estudio.ics';

export function useLinkIndex() {
  const app = useApp();
  return useAsync(async () => (app.col ? buildLinkIndex(app.vault, app.col.decks as never) : null), [app.version, app.col]);
}

const ICON: Record<LinkKind, preact.JSX.Element> = { deck: <BookOpen size={14} />, note: <FileText size={14} />, topic: <Folder size={14} />, tag: <Hash size={14} /> };

/** Datos vivos de un vínculo: "Cardiología: 34 vencidas". */
export function liveData(app: ReturnType<typeof useApp>, r: Resolved): string {
  const col = app.col;
  if (!col || !r.target || r.kind === 'note') return '';
  const now = Date.now();
  const lim = studyLimits(app.settings);
  const intro = newIntroducedToday(col, now, lim);
  let due = 0, fresh = 0;
  for (const d of col.decks) {
    if (!inDeck(d, r.target.path)) continue;
    const c = deckCounts(col, d, now, lim, intro);
    due += c.due + c.learning;
    fresh += c.new;
  }
  return `${due} vencidas${fresh ? ` · ${fresh} nuevas` : ''}`;
}

export function openLink(r: Resolved) {
  if (!r.target) return;
  if (r.kind === 'note') location.hash = `#/espacios/abrir/${encodeURIComponent(r.target.path)}`;
  else go('estudiar', ...r.target.path.split('/').filter(Boolean), ...(r.target.path.endsWith('/') ? [''] : []));
}

export function LinkChips(p: { links: string[]; idx: LinkIndex | null | undefined; live?: boolean; onRemove?: (uri: string) => void; onRepair?: (uri: string) => void }) {
  const app = useApp();
  if (!p.links.length) return null;
  return (
    <div class="row wrap" role="list" aria-label="Vínculos">
      {p.links.map((u) => {
        const r = p.idx ? resolveLink(u, p.idx) : { uri: u, kind: 'note' as LinkKind, target: null, label: u };
        const data = p.live && r.target ? liveData(app, r) : '';
        return (
          <span role="listitem" class="row" style={{ gap: '4px' }}>
            {r.target ? (
              <button type="button" class="chip" style={{ minHeight: '32px' }} onClick={() => openLink(r)} aria-label={`Abrir ${r.label}${data ? `, ${data}` : ''}`}>
                {ICON[r.kind]} {r.label}{data ? <b>: {data}</b> : null}
              </button>
            ) : (
              <span class="chip" style={{ borderStyle: 'dashed', minHeight: '32px' }}><Unlink size={14} /> {r.label} · enlace roto
                {p.onRepair && <button type="button" class="link" style={{ minHeight: '28px' }} onClick={() => p.onRepair!(u)}>Reparar</button>}
              </span>
            )}
            {p.onRemove && <button type="button" class="btn icon small ghost" aria-label={`Quitar vínculo ${r.label}`} onClick={() => p.onRemove!(u)}>✕</button>}
          </span>
        );
      })}
    </div>
  );
}

/** Selector con pestañas Mazos y temas / Notas. Asigna `id` al archivo la primera vez que se vincula. */
export function LinkPicker(p: { idx: LinkIndex; onPick: (uri: string) => void; onClose: () => void }) {
  const app = useApp();
  const [tab, setTab] = useState<'decks' | 'notes'>('decks');
  const [q, setQ] = useState('');
  const nq = normalizeAnswer(q);
  const items: LinkTarget[] = tab === 'decks' ? [...p.idx.decks, ...p.idx.topics, ...p.idx.tags] : p.idx.notes;
  const shown = items.filter((t) => !nq || normalizeAnswer(`${t.name} ${t.path}`).includes(nq)).slice(0, 80);
  const pick = async (t: LinkTarget) => {
    let key = t.path;
    if (t.kind === 'topic') key = t.name;
    if (t.kind === 'tag') key = t.path.slice(4);
    if (t.kind === 'deck' || t.kind === 'note') {
      const taken = new Set([...p.idx.decks, ...p.idx.notes].map((x) => x.id).filter(Boolean) as string[]);
      key = await ensureFileId(app.vault, t.path, taken);
    }
    p.onPick(makeUri(t.kind, key));
  };
  return (
    <Sheet title="Vincular" onClose={p.onClose}>
      <div class="stack-s">
        <Segmented label="Tipo" value={tab} onChange={setTab} options={[['decks', 'Mazos y temas'], ['notes', 'Notas']]} />
        <input class="input wide" type="search" placeholder="Buscar…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Buscar" />
        {shown.map((t) => <button type="button" class="opt" onClick={() => void pick(t)}>{ICON[t.kind]} <span class="grow ellipsis">{t.name}</span><span class="foot ellipsis" style={{ maxWidth: '45%' }}>{t.kind === 'note' ? t.path.replace(/^notes\//, '') : t.kind === 'topic' ? 'tema' : t.kind === 'tag' ? 'etiqueta' : 'mazo'}</span></button>)}
        {!shown.length && <p class="t2">Sin resultados.</p>}
      </div>
    </Sheet>
  );
}

/** Iniciar bloque: pomodoro + estudio filtrado a lo vinculado + notas vinculadas en un espacio. */
export async function startBlock(app: ReturnType<typeof useApp>, b: StudyBlock, idx: LinkIndex | null | undefined) {
  app.pomo.start(b.title);
  const res = (b.links ?? []).map((u) => (idx ? resolveLink(u, idx) : null)).filter((r): r is Resolved => !!r?.target);
  const filter = studyFilter(res);
  const notes = res.filter((r) => r.kind === 'note').slice(0, 2);
  if (!res.length) {
    const dk = app.col?.decks.find((x) => b.subject && (x.full.includes(b.subject) || b.subject.includes(x.name)));
    return go(dk ? 'estudiar' : 'espacios', ...(dk ? dk.path.split('/') : []));
  }
  if (!notes.length) return go('estudiar', filter ?? '');
  const panels = [
    ...(filter ? [{ id: 'study', type: 'estudio', arg: filter, x: 0, y: 0, w: 560, h: 560 }] : []),
    ...notes.map((n, i) => ({ id: `n${i}`, type: 'nota', arg: n.target!.path, x: 600 + i * 40, y: 40 * i, w: 560, h: 560 })),
  ];
  const space = { id: 'bloque', name: `Bloque: ${b.title}`, emoji: '📅', mode: 'tiles', panels, sizes: panels.map(() => 1 / panels.length), view: { x: 0, y: 0, k: 1 } };
  await app.vault.write('.app/spaces/bloque.json', JSON.stringify(space));
  app.changed();
  go('espacios', 'bloque');
}

/** Bloques del calendario propio vinculados a una ruta (vínculo inverso). */
export function linkedBlocks(blocks: StudyBlock[], idx: LinkIndex, path: string): StudyBlock[] {
  return blocks.filter((b) => (b.links ?? []).some((u) => {
    const r = resolveLink(u, idx);
    return r.target && (r.target.path === path || (r.kind !== 'note' && r.kind !== 'deck' && path.startsWith('decks/') && inDeckPath(path, r.target.path)));
  }));
}

function inDeckPath(path: string, filter: string) {
  return filter.endsWith('/') ? path.startsWith(filter) : false;
}

/** Eventos del calendario vinculados a un archivo: próximos y pasados. */
export function useLinkedEvents(path: string) {
  const app = useApp();
  const { data: idx } = useLinkIndex();
  return useAsync(async () => {
    if (!idx) return null;
    const { fromICS, occurrences } = await import('../lib/ics');
    const { readTextOr } = await import('../vault/util');
    const blocks = linkedBlocks(fromICS(await readTextOr(app.vault, CAL_PATH, '')), idx, path);
    const now = Date.now();
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const from = day(now - 120 * 86_400_000);
    const to = day(now + 365 * 86_400_000);
    const occ = blocks.flatMap((b) => occurrences(b, from, to, day).map((o) => ({ ...o, b })));
    return { next: occ.filter((o) => o.end >= now).sort((a, b) => a.start - b.start).slice(0, 10), past: occ.filter((o) => o.end < now).sort((a, b) => b.start - a.start).slice(0, 10) };
  }, [idx, path, app.version]);
}

export function LinkedEvents(p: { path: string }) {
  const { data } = useLinkedEvents(p.path);
  if (!data) return <p class="t2 note">Cargando…</p>;
  const row = (o: { start: number; b: StudyBlock }) => (
    <a class="kv note" href="#/calendario" style={{ textDecoration: 'none' }}><span class="k ellipsis">{o.b.title}</span><span class="v">{new Date(o.start).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></a>
  );
  return (
    <div class="stack-s">
      <b class="note">Próximos ({data.next.length})</b>
      {data.next.length ? data.next.map(row) : <p class="t2 note">Ninguno.</p>}
      <b class="note">Pasados ({data.past.length})</b>
      {data.past.length ? data.past.map(row) : <p class="t2 note">Ninguno.</p>}
    </div>
  );
}
