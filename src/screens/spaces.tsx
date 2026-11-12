import { awakePanels, LITE_ZOOM, zoomAt } from '../lib/canvaszoom';
import { memo } from 'preact/compat';
import { perf } from '../lib/perf';
import { t as tr } from '../i18n';
import { BarChart3, BookOpen, CalendarDays, ChevronsDownUp, ChevronsUpDown, ClipboardCheck, FilePlus2, FileSpreadsheet, FileText, FolderTree, Image as ImageIcon, Layers, Lock, NotebookPen, Plus, Scan, Settings2, Timer, Unlock, X, LayoutGrid, Inbox as InboxIcon, Sparkles } from 'lucide-preact';
import { Popover } from '../ui/overlay';
import { Headphones } from 'lucide-preact';
import { addonOn } from './addons';
import { AmbientPlayer } from './ambient';
import { NewNotePanel, NotePanel } from './notes';
import { SimEmbed } from './simulacros';
import { Calendar } from './calendar';
import { DeckEditor } from './deck';
import { DeckOptions } from './decks';
import { Explorar } from './explorar';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { docxToHtml } from '../io/extract';
import { parseCSV } from '../io/csv';
import { renderMarkdown, sanitize } from '../md/render';
import { listNotes } from '../notes/model';
import { go, href, useApp, useAsync } from '../state';
import { Html } from '../ui/md';
import { Segmented, Sheet, usePhone } from '../ui/kit';
import { acquireMediaUrl, releaseMediaUrl } from '../ui/background';
import { imageSize, neededSide, reducedImage, stepFor, tooBig } from '../lib/imgview';
import { extname } from '../vault/paths';
import { readTextOr, walk } from '../vault/util';
import { PdfViewer } from './pdf';
import { growIn, MinButton, shrinkToTray, Tray, type TrayItem } from '../ui/tray';
import { fmt, remaining } from '../lib/pomodoro';
import { PomodoroPanel } from './pomodoro';
import { Study } from './study';
import { todayProgress } from '../lib/stats';
import { dayKey } from '../lib/days';
import { saveImage } from '../notes/images';

type PType = 'estudio' | 'simulacro' | 'nota' | 'pdf' | 'docx' | 'hoja' | 'imagen' | 'pomodoro' | 'stats' | 'mazo' | 'tema' | 'calendario' | 'sonido';
interface Panel { id: string; type: PType; arg: string; x: number; y: number; w: number; h: number; locked?: boolean; min?: boolean; z?: number }
interface Space { id: string; name: string; emoji: string; mode: 'tiles' | 'canvas'; panels: Panel[]; sizes: number[]; view: { x: number; y: number; k: number }; tray?: string[] }

/** Todos los paneles se pueden minimizar a cuadrito (el simulacro sigue contando: su reloj es una marca de tiempo). */
const MINIMIZABLE: PType[] = ['estudio', 'simulacro', 'nota', 'pdf', 'docx', 'hoja', 'imagen', 'pomodoro', 'stats', 'mazo', 'tema', 'calendario', 'sonido'];
const SIM_CURRENT = '.app/exam-current.json';
const visible = (sp: Space) => sp.panels.filter((x) => !x.min);
/** Teléfono: un panel a la vez. `show` es el elegido (si sigue visible); si no, el más reciente. */
type Phone = { show: string | null; setShow: (id: string | null) => void };
const shownId = (sp: Space, ph: Phone) => { const vis = visible(sp); return (vis.some((x) => x.id === ph.show) ? ph.show : vis[vis.length - 1]?.id) ?? null; };

const DIR = '.app/spaces';
const TYPES = (): { t: PType; label: string; icon: preact.JSX.Element }[] => ([
  { t: 'estudio', label: tr('design.estudio'), icon: <BookOpen size={18} /> },
  { t: 'nota', label: tr('notes.nota'), icon: <NotebookPen size={18} /> },
  { t: 'pdf', label: 'PDF', icon: <FileText size={18} /> },
  { t: 'docx', label: tr('notes.documento'), icon: <FileText size={18} /> },
  { t: 'hoja', label: tr('spaces.hoja'), icon: <FileSpreadsheet size={18} /> },
  { t: 'imagen', label: tr('deck.imagen'), icon: <ImageIcon size={18} /> },
  { t: 'simulacro', label: tr('simulacros.simulacro'), icon: <ClipboardCheck size={18} /> },
  { t: 'pomodoro', label: tr('today.pomodoro'), icon: <Timer size={18} /> },
  { t: 'stats', label: tr('spaces.estadisticas'), icon: <BarChart3 size={18} /> },
  { t: 'mazo', label: tr('deck.mazo'), icon: <Layers size={18} /> },
  { t: 'tema', label: tr('spaces.tema'), icon: <FolderTree size={18} /> },
  { t: 'calendario', label: tr('calendar.calendario'), icon: <CalendarDays size={18} /> },
  { t: 'sonido', label: tr('addons.n_ambient'), icon: <Headphones size={18} /> },
]);
const MAX_ACTIVE = 4;
/** Id único aunque se creen dos paneles en el mismo milisegundo. */
let uidSeq = 0;
const uid = () => `${Date.now().toString(36)}${(++uidSeq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Reparto inicial del mosaico: un panel de notas arranca con al menos el 60 % del área útil. */
function initialSizes(panels: Panel[]): number[] {
  const notes = panels.filter((p) => p.type === 'nota').length;
  if (notes !== 1 || panels.length === 1) return panels.map(() => 1 / panels.length);
  return panels.map((p) => (p.type === 'nota' ? 0.6 : 0.4 / (panels.length - 1)));
}
/** Tamaño mínimo por tipo (las notas necesitan más). */
const minFrac = (p: Panel | undefined) => (p?.type === 'nota' ? 0.4 : 0.15);

/** Un espacio nuevo empieza vacío (E13): sin preajustes. Los espacios guardados se conservan tal cual. */

async function loadSpaces(vault: ReturnType<typeof useApp>['vault']): Promise<Space[]> {
  const out: Space[] = [];
  for (const f of await walk(vault, DIR)) {
    if (f.name.startsWith('_')) continue; // estado del tablero Hoy, no es un espacio
    try { out.push(JSON.parse(await readTextOr(vault, f.path, '')) as Space); } catch { /* dañado */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export function Spaces(props: { route: string[] }) {
  const app = useApp();
  const { data: spaces } = useAsync(() => loadSpaces(app.vault), [app.version]);
  const [creating, setCreating] = useState(false);
  const [sp, setSp] = useState<Space | null>(null);
  const isPhone = usePhone();
  const [show, setShow] = useState<string | null>(null);
  const ph: Phone | undefined = isPhone ? { show, setShow } : undefined;
  const saveT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const save = (s: Space) => {
    setSp(s);
    clearTimeout(saveT.current);
    const isNew = !spaces?.some((x) => x.id === s.id);
    if (isNew) void app.vault.write(`${DIR}/${s.id}.json`, JSON.stringify(s)).then(() => app.changed());
    else saveT.current = setTimeout(() => void app.vault.write(`${DIR}/${s.id}.json`, JSON.stringify(s)), 400);
  };
  // abrir un archivo desde un enlace: #/espacios/abrir/<ruta[#pN]>
  useEffect(() => {
    if (!spaces) return;
    if (props.route[0] === 'abrir' && props.route[1]) {
      const [path, frag] = decodeURIComponent(props.route.slice(1).join('/')).split('#');
      const type: PType = /\.pdf$/i.test(path!) ? 'pdf' : /\.docx$/i.test(path!) ? 'docx' : /\.(csv|tsv)$/i.test(path!) ? 'hoja' : /\.(png|jpe?g|webp|gif)$/i.test(path!) ? 'imagen' : 'nota';
      const base = sp ?? spaces[0] ?? { id: 'general', name: 'General', emoji: '🗂️', mode: 'tiles' as const, panels: [], sizes: [], view: { x: 0, y: 0, k: 1 } };
      const at = base.mode === 'canvas' ? place(base, 640, 560, live.focus) : { x: 40, y: 40, w: 640, h: 560 };
      const panel: Panel = { id: uid(), type, arg: frag ? `${path}#${frag}` : path!, ...at, z: base.panels.length + 1 };
      live.reveal = panel.id;
      const panels = base.mode === 'canvas' ? [...base.panels, panel] : [...base.panels.slice(-2), panel];
      const s = { ...base, panels, sizes: initialSizes(panels) };
      save(s);
      location.replace(href('espacios', s.id));
      return;
    }
    const id = props.route[0];
    setSp((prev) => (prev && prev.id === id ? prev : spaces.find((s) => s.id === id) ?? (id ? prev : null) ?? spaces[0] ?? null));
  }, [spaces, props.route.join('/')]);

  return (
    <div class="spaces">
      <nav class="rail glass" aria-label={tr('spaces.espacios')}>
        {spaces?.map((s) => <button type="button" aria-current={sp?.id === s.id} aria-label={s.name} data-tip={s.name} onClick={() => go('espacios', s.id)}>{s.emoji}</button>)}
        <button type="button" aria-label={tr('spaces.nuevo_espacio')} onClick={() => setCreating(true)}><Plus size={20} /></button>
        {sp && (innerWidth < 900 || ph) && <PanelTray sp={sp} save={save} vertical={!ph} ph={ph} />}
      </nav>
      <div style={{ minWidth: 0 }}>
        {!sp ? (
          <div class="empty glass"><LayoutGrid size={44} /><h2>{tr('spaces.espacios')}</h2><p>{tr('spaces.espacio_vacio_explica')}</p>
            <button type="button" class="btn primary" onClick={() => setCreating(true)}><Plus size={18} />{' '}{tr('spaces.nuevo_espacio')}</button>
          </div>
        ) : (
          <>
            <div class="row wrap glass" style={{ marginBottom: '10px', padding: '8px 12px', borderRadius: 'var(--r-pill)' }}>
              <b style={{ padding: '0 6px' }}>{sp.emoji} {sp.name}</b>
              <span class="grow" />
              {!ph && <Segmented label={tr('deck.modo')} value={sp.mode} onChange={(m) => save({ ...sp, mode: m })} options={[['tiles', tr('spaces.mosaico')], ['canvas', tr('spaces.lienzo')]]} />}
              <button type="button" class="btn small" disabled={!visible(sp).length} onClick={() => minimizeAll(sp, save)}>{tr('spaces.minimizar_todos')}</button>
              <button type="button" class="btn small" disabled={!sp.panels.some((x) => x.min)} onClick={() => restoreAll(sp, save)}>{tr('spaces.restaurar_todos')}</button>
              <button type="button" class="btn small" onClick={async () => { if (!confirm(tr('spaces.confirm_eliminar', { name: sp.name }))) return; await app.vault.remove(`${DIR}/${sp.id}.json`); app.changed(); go('espacios'); }}>{tr('calendar.eliminar')}</button>
            </div>
            {sp.mode === 'tiles' || ph ? <Tiles sp={sp} save={save} ph={ph} /> : <CanvasView sp={sp} save={save} />}
            <Dock sp={sp} save={save} ph={ph} />
          </>
        )}
      </div>
      {creating && (
        <Sheet title={tr('spaces.nuevo_espacio')} onClose={() => setCreating(false)}>
          <form class="stack" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget as HTMLFormElement); const s: Space = { mode: 'tiles', panels: [], sizes: [], view: { x: 0, y: 0, k: 1 }, id: Date.now().toString(36), name: String(f.get('n')) || tr('spaces.espacios'), emoji: String(f.get('e')) || '🗂️' }; save(s); setCreating(false); go('espacios', s.id); }}>
            <label class="field">{tr('spaces.nombre_materia_o_examen')}<input class="input" name="n" required /></label>
            <label class="field">{tr('spaces.emoji')}<input class="input" name="e" maxLength={8} placeholder="🫀" /></label>
            <button class="btn primary" type="submit">{tr('decks.crear')}</button>
          </form>
        </Sheet>
      )}
    </div>
  );
}

const restored = new Set<string>();

/** Estado vivo del lienzo (vista y panel con foco) para colocar paneles nuevos sin solaparlos. */
const live = { view: null as Space['view'] | null, w: 0, h: 0, focus: null as string | null, reveal: null as string | null };
type Rect = { x: number; y: number; w: number; h: number };
const hit = (a: Rect, b: Rect, g = 16) => a.x < b.x + b.w + g && b.x < a.x + a.w + g && a.y < b.y + b.h + g && b.y < a.y + a.h + g;

/**
 * Lienzo: coloca un panel nuevo en el mayor hueco libre de la parte visible (junto al panel de
 * origen si lo hay); si no cabe ni reducido, en cascada de 32 px desde el último.
 */
function place(sp: Space, w: number, h: number, src?: string | null): Rect {
  const others = visible(sp);
  const v = live.view ?? sp.view;
  const vw = (live.w || innerWidth) / v.k, vh = (live.h || innerHeight * 0.7) / v.k;
  const vx = -v.x / v.k, vy = -v.y / v.k;
  const free = (r: Rect) => !others.some((o) => hit(r, o));
  const from = others.find((o) => o.id === src);
  if (from) for (const r of [{ x: from.x + from.w + 24, y: from.y }, { x: from.x - w - 24, y: from.y }, { x: from.x, y: from.y + from.h + 24 }].map((c) => ({ ...c, w, h }))) if (free(r)) return r;
  for (const f of [1, 0.8, 0.6]) {
    const rw = Math.round(w * f), rh = Math.round(h * f);
    for (let y = vy + 24; y + rh <= vy + vh - 8; y += 24)
      for (let x = vx + 24; x + rw <= vx + vw - 8; x += 24) {
        const r = { x: Math.round(x), y: Math.round(y), w: rw, h: rh };
        if (free(r)) return r;
      }
  }
  // el lienzo es infinito: el hueco libre más cercano al centro de la vista (luego se desplaza hasta él)
  const X0 = Math.min(vx, ...others.map((o) => o.x)) - w, Y0 = Math.min(vy, ...others.map((o) => o.y)) - h;
  const X1 = Math.max(vx + vw, ...others.map((o) => o.x + o.w)) + 24, Y1 = Math.max(vy + vh, ...others.map((o) => o.y + o.h)) + 24;
  const cx = vx + vw / 2, cy = vy + vh / 2;
  let best: Rect | null = null, bd = Infinity;
  for (let y = Y0; y <= Y1; y += 32)
    for (let x = X0; x <= X1; x += 32) {
      const r = { x: Math.round(x), y: Math.round(y), w, h };
      const d = Math.hypot(x + w / 2 - cx, y + h / 2 - cy);
      if (d < bd && free(r)) ((best = r), (bd = d));
    }
  if (best) return best;
  const last = from ?? others[others.length - 1];
  return last ? { x: last.x + 32, y: last.y + 32, w, h } : { x: Math.round(vx + 32), y: Math.round(vy + 32), w, h };
}

/** Trae un panel al frente y normaliza los z a 1…n (sin saltos ni números crecientes). */
function toFront(sp: Space, id: string): Space | null {
  const order = [...sp.panels].sort((a, b) => (a.z ?? 0) - (b.z ?? 0) || sp.panels.indexOf(a) - sp.panels.indexOf(b));
  if (order[order.length - 1]?.id === id && order.every((x, i) => x.z === i + 1)) return null;
  const sorted = [...order.filter((x) => x.id !== id), ...order.filter((x) => x.id === id)];
  const z = new Map(sorted.map((x, i) => [x.id, i + 1]));
  return { ...sp, panels: sp.panels.map((x) => ({ ...x, z: z.get(x.id)! })) };
}

function minimizePanel(sp: Space, save: (s: Space) => void, id: string) {
  const panels = sp.panels.map((x) => (x.id === id ? { ...x, min: true } : x));
  const next = { ...sp, panels, tray: [...(sp.tray ?? []).filter((x) => x !== id), id] };
  save({ ...next, sizes: initialSizes(visible(next).slice(0, 3)) });
}

function restorePanel(sp: Space, save: (s: Space) => void, id: string) {
  restored.add(id);
  let panels = sp.panels.map((x) => (x.id === id ? { ...x, min: false } : x));
  // en mosaico caben 3: el que vuelve desplaza al más antiguo visible a la bandeja
  let tray = (sp.tray ?? []).filter((x) => x !== id);
  if (sp.mode === 'tiles') {
    const vis = panels.filter((x) => !x.min);
    if (vis.length > 3) {
      const out = vis.find((x) => x.id !== id && MINIMIZABLE.includes(x.type));
      if (out) (panels = panels.map((x) => (x.id === out.id ? { ...x, min: true } : x)), (tray = [...tray, out.id]));
    }
  }
  const next = { ...sp, panels, tray };
  save({ ...next, sizes: initialSizes(visible(next).slice(0, 3)) });
}

function minimizeAll(sp: Space, save: (s: Space) => void) {
  const vis = visible(sp).map((x) => x.id);
  if (!vis.length) return;
  save({ ...sp, panels: sp.panels.map((x) => ({ ...x, min: true })), tray: [...(sp.tray ?? []).filter((x) => !vis.includes(x)), ...vis], sizes: [] });
}

/** En mosaico vuelven los 3 más recientes de la bandeja; en el lienzo, todos. */
function restoreAll(sp: Space, save: (s: Space) => void) {
  const order = [...new Set([...(sp.tray ?? []), ...sp.panels.filter((x) => x.min).map((x) => x.id)])].filter((id) => sp.panels.some((x) => x.id === id && x.min));
  if (!order.length) return;
  const room = sp.mode === 'tiles' ? Math.max(0, 3 - visible(sp).length) : order.length;
  const back = new Set(order.slice(-room));
  back.forEach((id) => restored.add(id));
  const next = { ...sp, panels: sp.panels.map((x) => (back.has(x.id) ? { ...x, min: false } : x)), tray: order.filter((id) => !back.has(id)) };
  save({ ...next, sizes: initialSizes(visible(next).slice(0, 3)) });
}

/** Lee el simulacro en curso (para el cuadrito: tiempo restante). */
function useSimLeft(active: boolean): string | null {
  const app = useApp();
  const { data: cur } = useAsync(async () => (active ? (JSON.parse((await readTextOr(app.vault, SIM_CURRENT, 'null')) || 'null') as { endAt: number | null; finishedAt?: number } | null) : null), [app.version, active]);
  const [now, setNow] = useState(Date.now());
  const running = !!cur?.endAt && !cur.finishedAt && cur.endAt > now;
  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [running]);
  return cur?.endAt && !cur.finishedAt ? fmt(Math.max(0, cur.endAt - now)) : null;
}

function PanelTray(p: { sp: Space; save: (s: Space) => void; vertical?: boolean; ph?: Phone }) {
  const app = useApp();
  const order = [...(p.sp.tray ?? []), ...p.sp.panels.filter((x) => x.min).map((x) => x.id)];
  const minIds = [...new Set(order)].filter((id) => p.sp.panels.some((x) => x.id === id && x.min));
  // teléfono: los paneles visibles que no se muestran también son cuadritos (tocar = mostrarlo)
  const cur = p.ph ? shownId(p.sp, p.ph) : null;
  const ids = p.ph ? [...visible(p.sp).map((x) => x.id).filter((id) => id !== cur), ...minIds] : minIds;
  const rem = fmt(remaining(app.pomo.state, app.pomo.now));
  const simLeft = useSimLeft(ids.some((id) => p.sp.panels.find((x) => x.id === id)?.type === 'simulacro'));
  const items: TrayItem[] = ids.map((id) => {
    const pn = p.sp.panels.find((x) => x.id === id)!;
    const t = TYPES().find((x) => x.t === pn.type)!;
    const name = pn.arg ? `${t.label}: ${pn.arg.split('/').pop()}` : t.label;
    if (pn.type === 'simulacro' && simLeft) return { id, label: name, icon: t.icon, live: simLeft, liveLabel: tr('tray.restantes', { rem: simLeft }) };
    return pn.type === 'pomodoro' ? { id, label: name, icon: t.icon, live: rem, liveLabel: tr(app.pomo.state.running ? 'tray.restantes' : 'tray.restantes_pausa', { rem }) } : { id, label: name, icon: t.icon };
  });
  const onRestore = (id: string) => (p.sp.panels.find((x) => x.id === id)?.min && restorePanel(p.sp, p.save, id), p.ph?.setShow(id));
  return <Tray items={items} vertical={p.vertical} max={p.vertical ? 4 : 6} onRestore={onRestore} onClose={(id) => { const panels = p.sp.panels.filter((x) => x.id !== id); p.save({ ...p.sp, panels, tray: (p.sp.tray ?? []).filter((x) => x !== id), sizes: initialSizes(panels.filter((x) => !x.min).slice(0, 3)) }); }} />;
}

function Dock(p: { sp: Space; save: (s: Space) => void; ph?: Phone }) {
  const app = useApp();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const add = (t: PType, arg = '') => {
    const n = p.sp.panels.length;
    const w = t === 'pomodoro' ? 340 : t === 'nota' ? 760 : 560, h = t === 'pomodoro' ? 420 : t === 'nota' ? 640 : 520;
    const at = p.sp.mode === 'canvas' ? place(p.sp, w, h) : { x: 60 + n * 40, y: 60 + n * 40, w, h };
    const panel: Panel = { id: uid(), type: t, arg, ...at, z: n + 1 };
    live.reveal = panel.id;
    const vis = visible(p.sp);
    // en mosaico caben 3: los demás visibles pasan a la bandeja si se pueden minimizar
    const keep = new Set(p.sp.mode === 'tiles' ? vis.slice(-2).map((x) => x.id) : vis.map((x) => x.id));
    const panels = [...p.sp.panels.map((x) => (!x.min && !keep.has(x.id) && MINIMIZABLE.includes(x.type) ? { ...x, min: true } : x)).filter((x) => x.min || keep.has(x.id)), panel];
    p.save({ ...p.sp, panels, sizes: initialSizes(panels.filter((x) => !x.min).slice(0, 3)) });
    p.ph?.setShow(panel.id);
  };
  return (
    <div class="dock no-print">
      {innerWidth >= 900 && !p.ph && <PanelTray sp={p.sp} save={p.save} />}
      <a class="pill glass" href="#/ajustes/addons"><Sparkles size={16} />{' '}{tr('design.extras')}</a>
      <button type="button" class="pill glass" aria-haspopup="menu" aria-expanded={!!menu} onClick={(e) => setMenu(menu ? null : (e.currentTarget as HTMLElement))}><Plus size={16} />{' '}{tr('design.anadir_panel')}</button>
      {menu && (
        <Popover anchor={menu} onClose={() => setMenu(null)} label={tr('design.anadir_panel')} role="menu" class="glass strong add-menu">
          <button type="button" role="menuitem" onClick={() => (setMenu(null), add('nota', '+nueva'))}><FilePlus2 size={18} />{' '}{tr('spaces.nota_nueva')}</button>
          {ADD_ORDER.filter((k) => k !== 'sonido' || addonOn(app.settings, 'ambient')).map((k) => { const x = TYPES().find((y) => y.t === k)!; return <button type="button" role="menuitem" aria-label={tr('spaces.anadir_panel_label', { label: x.label })} onClick={() => (setMenu(null), add(x.t))}>{x.icon}{' '}{k === 'nota' ? tr('spaces.nota_existente') : k === 'simulacro' ? tr('spaces.simulacro_examen') : x.label}</button>; })}
        </Popover>
      )}
      <div class="glass" role="toolbar" aria-label={tr('tray.paneles_minimizados')}>
        <button type="button" class="btn icon small ghost" aria-label={tr('spaces.minimizar_todos')} disabled={!visible(p.sp).length} onClick={() => minimizeAll(p.sp, p.save)}><ChevronsDownUp size={18} /></button>
        <button type="button" class="btn icon small ghost" aria-label={tr('spaces.restaurar_todos')} disabled={!p.sp.panels.some((x) => x.min)} onClick={() => restoreAll(p.sp, p.save)}><ChevronsUpDown size={18} /></button>
      </div>
      {addonOn(app.settings, 'inbox') && <a class="pill glass" href="#/bandeja"><InboxIcon size={16} />{' '}{tr('app.bandeja')}{' '}<span class={`count${app.inboxCount ? '' : ' zero'}`}>{app.inboxCount}</span></a>}
    </div>
  );
}

/** Orden del menú «＋ Añadir panel» (E13): todo lo que se puede abrir. */
const ADD_ORDER: PType[] = ['nota', 'mazo', 'tema', 'simulacro', 'pdf', 'docx', 'hoja', 'imagen', 'pomodoro', 'stats', 'calendario', 'estudio', 'sonido'];

function Tiles(p: { sp: Space; save: (s: Space) => void; ph?: Phone }) {
  const box = useRef<HTMLDivElement>(null);
  const panels = p.ph ? visible(p.sp).filter((x) => x.id === shownId(p.sp, p.ph!)) : visible(p.sp).slice(0, 3);
  const sizes = p.sp.sizes.length === panels.length ? p.sp.sizes : initialSizes(panels);
  const drag = useRef<{ i: number; x: number; s: number[] } | null>(null);
  const cur = useRef(p);
  cur.current = p;
  const api = useMemo(() => winApi(() => ({ sp: cur.current.sp, save: cur.current.save, k: 1 })), []);
  if (!panels.length) return <div class="empty glass"><p>{tr('spaces.anade_paneles_desde_el_dock_1')}</p></div>;
  const cols = sizes.flatMap((s, i) => (i ? ['10px', `${s}fr`] : [`${s}fr`])).join(' ');
  return (
    <div ref={box} class="tiles" style={{ gridTemplateColumns: cols, height: 'calc(100dvh - 230px)' }}>
      {panels.flatMap((pn, i) => [
        ...(i ? [<div class="divider" role="separator" aria-orientation="vertical" aria-label={tr('spaces.redimensionar_paneles')} tabIndex={0}
          onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { i, x: e.clientX, s: [...sizes] }; }}
          onPointerMove={(e) => { const d = drag.current; if (!d) return; const W = box.current!.clientWidth; const dx = (e.clientX - d.x) / W; const tot = d.s[d.i - 1]! + d.s[d.i]!; const a = Math.min(tot - minFrac(panels[d.i]), Math.max(minFrac(panels[d.i - 1]), d.s[d.i - 1]! + dx)); const s = [...d.s]; s[d.i - 1] = a; s[d.i] = tot - a; p.save({ ...p.sp, sizes: s }); }}
          onPointerUp={() => (drag.current = null)}
          onKeyDown={(e) => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; const s = [...sizes]; const dx = e.key === 'ArrowLeft' ? -0.05 : 0.05; s[i - 1] = Math.max(minFrac(panels[i - 1]), s[i - 1]! + dx); s[i] = Math.max(minFrac(panels[i]), s[i]! - dx); p.save({ ...p.sp, sizes: s }); }} />] : []),
        <Window key={pn.id} panel={pn} api={api} />,
      ])}
    </div>
  );
}

/** Qué arrastra el puntero: la barra (mover), la esquina o un borde (redimensionar). */
type Grip = 'move' | 'size' | 'w' | 'h';
const GRIPS: [Grip, string][] = [['w', 'win-edge right'], ['h', 'win-edge bottom'], ['size', 'win-resize']];

/** Operaciones de un panel; un objeto estable para que `Window` (memo) no se re-renderice por ellas. */
interface WinApi { upd(id: string, patch: Partial<Panel>): void; close(id: string): void; minimize(id: string): void; front(id: string): void; k(): number }
function winApi(get: () => { sp: Space; save: (s: Space) => void; k: number; front?: (id: string) => void }): WinApi {
  return {
    upd: (id, patch) => { const { sp, save } = get(); save({ ...sp, panels: sp.panels.map((x) => (x.id === id ? { ...x, ...patch } : x)) }); },
    close: (id) => { const { sp, save } = get(); const rest = sp.panels.filter((x) => x.id !== id); save({ ...sp, panels: rest, sizes: rest.map((_, _i, a) => 1 / a.length) }); },
    minimize: (id) => { const { sp, save } = get(); minimizePanel(sp, save, id); },
    front: (id) => get().front?.(id),
    k: () => get().k,
  };
}

/**
 * Lienzo infinito (nivel 2): transformaciones CSS sobre contenedores DOM, paneo/zoom con dos dedos.
 * Prompt 11 · 5: durante el gesto la vista vive en una ref y se aplica al DOM en rAF (plano, zoom
 * y minimapa), sin re-renderizar paneles; al terminar se confirma (`setV` + guardar) y se recalcula
 * qué paneles están en pantalla (solo esos montan su contenido).
 */
function CanvasView(p: { sp: Space; save: (s: Space) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const chip = useRef<HTMLSpanElement>(null);
  const mini = useRef<HTMLElement>(null);
  const [v, setV] = useState(p.sp.view);
  const vr = useRef(v);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [focus, setFocus] = useState<string | null>(p.sp.panels[p.sp.panels.length - 1]?.id ?? null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ d: number } | null>(null);
  const cur = useRef(p);
  cur.current = p;
  const commit = (nv: typeof v) => { vr.current = nv; setV(nv); cur.current.save({ ...cur.current.sp, view: nv }); };
  live.view = vr.current;
  live.focus = focus;
  const ps = p.sp.panels;
  const minX = Math.min(0, ...ps.map((x) => x.x)), minY = Math.min(0, ...ps.map((x) => x.y));
  const maxX = Math.max(1, ...ps.map((x) => x.x + x.w)), maxY = Math.max(1, ...ps.map((x) => x.y + x.h));
  const mk = Math.min(160 / (maxX - minX), 110 / (maxY - minY));
  const mm = useRef({ minX, minY, mk });
  mm.current = { minX, minY, mk };
  const miniBox = (o: typeof v) => {
    const { minX: mx, minY: my, mk: m } = mm.current, w = wrap.current;
    return w ? { left: `${(-o.x / o.k - mx) * m}px`, top: `${(-o.y / o.k - my) * m}px`, width: `${(w.clientWidth / o.k) * m}px`, height: `${(w.clientHeight / o.k) * m}px` } : null;
  };
  // gesto en curso: vista en la ref, DOM en rAF, confirmación al final
  const g = useRef({ raf: 0, timer: 0 as unknown as ReturnType<typeof setTimeout> });
  const paint = () => {
    g.current.raf = 0;
    const o = vr.current;
    if (plane.current) plane.current.style.transform = `translate(${o.x}px, ${o.y}px) scale(${o.k})`;
    if (chip.current) chip.current.textContent = `${Math.round(o.k * 100)} %`;
    const b = miniBox(o);
    if (b && mini.current) Object.assign(mini.current.style, b);
  };
  const preview = (f: (o: typeof v) => typeof v) => {
    vr.current = f(vr.current);
    live.view = vr.current;
    wrap.current?.classList.add('moving');
    if (!g.current.raf) g.current.raf = requestAnimationFrame(paint);
  };
  const end = () => {
    clearTimeout(g.current.timer);
    if (g.current.raf) (cancelAnimationFrame(g.current.raf), paint());
    wrap.current?.classList.remove('moving');
    if (vr.current !== v) commit(vr.current);
  };
  const endRef = useRef(end);
  endRef.current = end;
  /** Rueda y pellizco del trackpad no tienen «fin»: se confirma tras 150 ms sin eventos. */
  const endSoon = () => { clearTimeout(g.current.timer); g.current.timer = setTimeout(() => endRef.current(), 150); };
  useEffect(() => {
    const r = () => wrap.current && setSize({ w: (live.w = wrap.current.clientWidth), h: (live.h = wrap.current.clientHeight) });
    r();
    addEventListener('resize', r);
    return () => (removeEventListener('resize', r), (live.view = null), clearTimeout(g.current.timer), cancelAnimationFrame(g.current.raf));
  }, []);
  // Prompt 7 · 1: el lienzo consume TODO gesto de zoom que ocurra sobre él (también en el tope
  // y sobre los paneles), para que Safari nunca lo convierta en zoom o rebote de la página.
  // Listeners nativos con { passive: false }: con pasivos, preventDefault se ignora.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const rel = (x: number, y: number) => { const r = el.getBoundingClientRect(); return [x - r.left, y - r.top] as const; };
    /** Sobre un panel con zoom propio (PDF) manda el panel; si no, el lienzo. */
    const zoom = (target: EventTarget | null, f: number, x: number, y: number) => {
      const own = (target as HTMLElement | null)?.closest?.('[data-own-zoom]');
      if (own && el.contains(own)) return own.dispatchEvent(new CustomEvent('ownzoom', { detail: { f } }));
      const [cx, cy] = rel(x, y);
      preview((o) => zoomAt(o, f, cx, cy));
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoom(e.target, Math.exp(-e.deltaY / 300), e.clientX, e.clientY);
      else preview((o) => ({ ...o, x: o.x - e.deltaX, y: o.y - e.deltaY }));
      endSoon();
    };
    // WebKit: pellizco del trackpad (Safari en Mac) y de dos dedos sobre paneles (iPad)
    let gs = 1;
    const gstart = (e: Event) => { e.preventDefault(); gs = 1; };
    const gchange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale: number; clientX: number; clientY: number };
      const f = ge.scale / gs;
      gs = ge.scale;
      if (pts.current.size >= 2) return; // el pellizco con Pointer Events ya lo aplica
      zoom(e.target, f, ge.clientX, ge.clientY);
    };
    const gend = (e: Event) => { e.preventDefault(); gs = 1; if (!pts.current.size) endRef.current(); };
    const touch = (e: TouchEvent) => { if (e.touches.length >= 2) e.preventDefault(); };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('gesturestart', gstart, { passive: false } as AddEventListenerOptions);
    el.addEventListener('gesturechange', gchange, { passive: false } as AddEventListenerOptions);
    el.addEventListener('gestureend', gend, { passive: false } as AddEventListenerOptions);
    el.addEventListener('touchmove', touch, { passive: false });
    // sin rebote ni zoom de página solo mientras se ve el lienzo
    document.documentElement.classList.add('in-canvas');
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('gesturestart', gstart);
      el.removeEventListener('gesturechange', gchange);
      el.removeEventListener('gestureend', gend);
      el.removeEventListener('touchmove', touch);
      document.documentElement.classList.remove('in-canvas');
    };
  }, []);
  // un panel nuevo fuera de la vista: desplazar (sin cambiar el zoom) hasta que se vea entero
  useEffect(() => {
    const pn = p.sp.panels.find((x) => x.id === live.reveal);
    if (!pn || !wrap.current) return;
    live.reveal = null;
    setFocus(pn.id);
    const o = vr.current;
    const W = wrap.current.clientWidth, H = wrap.current.clientHeight;
    const k = Math.min(o.k, (W - 32) / pn.w, (H - 32) / pn.h);
    const sx = pn.x * k + o.x * (k / o.k), sy = pn.y * k + o.y * (k / o.k);
    if (k === o.k && sx >= 0 && sy >= 0 && sx + pn.w * k <= W && sy + pn.h * k <= H) return;
    const clamp = (x0: number, lo: number, hi: number) => Math.min(Math.max(x0, lo), hi);
    const nx = clamp(o.x * (k / o.k), 16 - pn.x * k, W - 16 - (pn.x + pn.w) * k), ny = clamp(o.y * (k / o.k), 16 - pn.y * k, H - 16 - (pn.y + pn.h) * k);
    commit({ k, x: nx, y: ny });
  }, [p.sp.panels.length]);
  const front = (id: string) => { setFocus(id); const next = toFront(cur.current.sp, id); if (next) cur.current.save(next); };
  const frontRef = useRef(front);
  frontRef.current = front;
  const api = useMemo(() => winApi(() => ({ sp: cur.current.sp, save: cur.current.save, k: vr.current.k, front: (id) => frontRef.current(id) })), []);
  // solo los paneles en pantalla montan su contenido; de ellos, máximo 4 activos (el foco primero)
  const W = size.w || innerWidth, H = size.h || innerHeight * 0.7;
  const awake = awakePanels(visible(p.sp), v, W, H, focus, MAX_ACTIVE);
  const lite = v.k < LITE_ZOOM;
  const fit = () => {
    if (!ps.length || !wrap.current) return;
    const W = wrap.current.clientWidth, H = wrap.current.clientHeight;
    const k = Math.min(1.5, Math.min(W / (maxX - minX + 80), H / (maxY - minY + 80)));
    commit({ k, x: (W - (maxX - minX) * k) / 2 - minX * k, y: (H - (maxY - minY) * k) / 2 - minY * k });
  };
  const mb = size.w ? miniBox(v) : null;
  return (
    <div ref={wrap} class="canvas-wrap glass flat"
      onPointerDown={(e) => { if ((e.target as HTMLElement).closest('.win')) return; try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* puntero ya liberado */ } pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); }}
      onPointerMove={(e) => {
        const m = pts.current;
        if (!m.has(e.pointerId)) return;
        const prev = m.get(e.pointerId)!;
        m.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (m.size === 1) preview((o) => ({ ...o, x: o.x + e.clientX - prev.x, y: o.y + e.clientY - prev.y }));
        else {
          const [a, b] = [...m.values()];
          const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
          const r = wrap.current!.getBoundingClientRect();
          const cx = (a!.x + b!.x) / 2 - r.left, cy = (a!.y + b!.y) / 2 - r.top;
          if (last.current) { const f = d / last.current.d; preview((o) => zoomAt(o, f, cx, cy)); }
          last.current = { d };
        }
      }}
      onPointerUp={(e) => { pts.current.delete(e.pointerId); last.current = null; if (!pts.current.size) end(); }}
      onPointerCancel={(e) => { pts.current.delete(e.pointerId); last.current = null; if (!pts.current.size) end(); }}>
      <div ref={plane} class="canvas-plane" style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.k})` }}>
        {visible(p.sp).map((pn) => <Window key={pn.id} panel={pn} api={api} free asleep={!awake.has(pn.id)} lite={lite} focused={focus === pn.id} />)}
      </div>
      <div class="row" style={{ position: 'absolute', left: '12px', bottom: '12px' }}>
        <button type="button" class="btn small glass" onClick={fit}><Scan size={16} />{' '}{tr('spaces.ajustar_al_contenido')}</button>
        <span ref={chip} class="chip">{Math.round(v.k * 100)} %</span>
      </div>
      <div class="minimap glass" aria-hidden="true">
        {ps.map((x) => <i style={{ left: `${(x.x - minX) * mk}px`, top: `${(x.y - minY) * mk}px`, width: `${x.w * mk}px`, height: `${x.h * mk}px` }} />)}
        {mb && <b ref={mini} style={mb} />}
      </div>
    </div>
  );
}

/**
 * Un panel. Memoizado: el paneo y el zoom no lo tocan; arrastrar o redimensionar mueve el DOM
 * directamente y confirma una sola vez al soltar (Prompt 11 · 5). Sin la escala como prop: la
 * lee de `api.k()` al arrastrar. `lite` (zoom bajo) lo dibuja como tarjeta con icono y título.
 */
const Window = memo(function Window(p: { panel: Panel; api: WinApi; free?: boolean; asleep?: boolean; lite?: boolean; focused?: boolean }) {
  const pn = p.panel;
  perf.inc('windowRender');
  const t = TYPES().find((x) => x.t === pn.type)!;
  const upd = (patch: Partial<Panel>) => p.api.upd(pn.id, patch);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number; mode: Grip; nx: number; ny: number } | null>(null);
  const winRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (restored.has(pn.id)) (restored.delete(pn.id), growIn(winRef.current));
  }, []);
  const minW = pn.type === 'nota' ? 480 : 260, minH = pn.type === 'nota' ? 360 : 200;
  const start = (mode: Grip) => (e: PointerEvent) => {
    if (!p.free || pn.locked || (e.target as HTMLElement).closest('button')) return;
    // asas: sin desplazar la nota, sin mover el foco ni abrir el teclado
    if (mode !== 'move') e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* puntero ya liberado */ }
    const px = mode === 'move' ? pn.x : pn.w, py = mode === 'move' ? pn.y : pn.h;
    dragRef.current = { x: e.clientX, y: e.clientY, px, py, mode, nx: px, ny: py };
    p.api.front(pn.id);
  };
  const move = (e: PointerEvent) => {
    const d = dragRef.current, el = winRef.current;
    if (!d || !el) return;
    const k = p.api.k();
    const dx = (e.clientX - d.x) / k, dy = (e.clientY - d.y) / k;
    if (d.mode === 'move') {
      d.nx = Math.round(d.px + dx); d.ny = Math.round(d.py + dy);
      el.style.transform = `translate(${d.nx - d.px}px, ${d.ny - d.py}px)`;
    } else {
      if (d.mode !== 'h') el.style.width = `${(d.nx = Math.max(minW, Math.round(d.px + dx)))}px`;
      if (d.mode !== 'w') el.style.height = `${(d.ny = Math.max(minH, Math.round(d.py + dy)))}px`;
    }
  };
  const stop = () => {
    const d = dragRef.current, el = winRef.current;
    dragRef.current = null;
    if (!d || !el || (d.nx === d.px && d.ny === d.py)) return;
    if (d.mode === 'move') { el.style.left = `${d.nx}px`; el.style.top = `${d.ny}px`; el.style.transform = ''; upd({ x: d.nx, y: d.ny }); }
    else upd({ w: d.nx, h: d.ny });
  };
  const style = p.free ? { left: `${pn.x}px`, top: `${pn.y}px`, width: `${pn.w}px`, height: `${pn.h}px`, zIndex: String(pn.z ?? 0) } : {};
  const title = pn.arg ? pn.arg.split('/').pop() : t.label;
  return (
    <section ref={winRef} class={`win glass${p.focused ? ' focused' : ''}${p.asleep && !p.lite ? ' asleep flat' : ''}${p.lite ? ' lite' : ''}`} style={style} aria-label={tr('spaces.panel_label', { label: t.label })} onPointerDown={() => p.api.front(pn.id)}>
      <header class="win-bar" onPointerDown={start('move')} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}>
        {t.icon}
        <span class="t ellipsis">{title}</span>
        <span class="chip">{p.asleep ? tr('spaces.en_pausa') : t.label}</span>
        <span class="grow" />
        {p.free && <button type="button" class="btn icon small ghost" aria-label={pn.locked ? tr('spaces.desbloquear') : tr('design.bloquear')} onClick={() => upd({ locked: !pn.locked })}>{pn.locked ? <Lock size={16} /> : <Unlock size={16} />}</button>}
        {MINIMIZABLE.includes(pn.type) && <MinButton label={t.label} onClick={async () => { await shrinkToTray(winRef.current); p.api.minimize(pn.id); }} />}
        <button type="button" class="btn icon small ghost" aria-label={tr('spaces.cerrar_panel')} onClick={() => p.api.close(pn.id)}><X size={16} /></button>
      </header>
      <div class="win-body">
        {p.lite ? <p class="lite-card" onPointerDown={start('move')} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}>{t.icon}<span class="ellipsis">{title}</span></p>
          : p.asleep ? <p class="t2" style={{ padding: '16px' }}>{tr('spaces.panel_en_pausa_para_cuidar_la', { MAX_ACTIVE: MAX_ACTIVE })}</p>
          : <PanelBody panel={pn} onArg={(arg) => upd({ arg })} />}
      </div>
      {/* Prompt 14 · 1: asas hijas de .win (no del área que se desplaza): siguen en la esquina visible */}
      {p.free && !p.lite && !p.asleep && GRIPS.map(([g, cls]) => <div class={cls} onPointerDown={start(g)} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} aria-hidden="true" />)}
    </section>
  );
});

function FilePicker(p: { exts: string[]; dir: string; onPick: (path: string) => void; label: string }) {
  const app = useApp();
  const { data } = useAsync(async () => (await walk(app.vault, '')).filter((f) => p.exts.includes(extname(f.path)) && !f.path.startsWith('.app/') && !f.path.startsWith('inbox/')).map((f) => f.path), [app.version]);
  return (
    <div class="stack-s" style={{ padding: '14px' }}>
      <label class="btn" style={{ justifySelf: 'start' }}><Plus size={16} /> {p.label}<input type="file" hidden accept={p.exts.map((e) => '.' + e).join(',')} onChange={async (e) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (!f) return;
        if (/\.(png|jpe?g|webp|heic)$/i.test(f.name)) return p.onPick(`media/${await saveImage(app.vault, f, f.name)}`);
        const path = `${p.dir}/${f.name.replace(/[\\/]/g, '_')}`;
        await app.vault.write(path, new Uint8Array(await f.arrayBuffer()));
        app.changed();
        p.onPick(path);
      }} /></label>
      {data?.length ? <p class="foot">{tr('spaces.o_elige_uno_de_tu_boveda')}</p> : null}
      {data?.map((x) => <button type="button" class="opt note" style={{ fontSize: 'var(--t-note)' }} onClick={() => p.onPick(x)}>{x}</button>)}
    </div>
  );
}

function PanelBody(p: { panel: Panel; onArg: (a: string) => void }) {
  const app = useApp();
  const a = p.panel.arg;
  switch (p.panel.type) {
    case 'pdf': {
      if (!a) return <FilePicker exts={['pdf']} dir="docs" label={tr('spaces.abrir_pdf')} onPick={p.onArg} />;
      const [path, frag] = a.split('#');
      return <PdfViewer path={path!} page={frag ? Number(frag.replace(/^p/, '')) : undefined} />;
    }
    case 'docx': return a ? <DocxView path={a} /> : <FilePicker exts={['docx']} dir="docs" label={tr('spaces.abrir_docx')} onPick={p.onArg} />;
    case 'hoja': return a ? <SheetView path={a} /> : <FilePicker exts={['csv', 'tsv', 'xlsx']} dir="docs" label={tr('spaces.abrir_hoja_csv')} onPick={p.onArg} />;
    case 'imagen': return a ? <ImageView path={a} /> : <FilePicker exts={['png', 'jpg', 'jpeg', 'webp', 'gif']} dir="media" label={tr('spaces.abrir_imagen')} onPick={p.onArg} />;
    case 'nota': return a && a !== '+nueva' ? <NotePanel path={a} /> : <NotePick onPick={p.onArg} creating={a === '+nueva'} />;
    case 'mazo': return a ? <DeckPanelBody path={a} /> : <DeckPick onPick={p.onArg} />;
    case 'tema': return a ? <TopicPanel target={a} /> : <TopicPick onPick={p.onArg} />;
    case 'calendario': return <div style={{ padding: '12px' }}><Calendar /></div>;
    case 'sonido': return <div style={{ padding: '12px' }}><AmbientPlayer /></div>;
    case 'estudio': return <div style={{ padding: '12px' }}><Study filter={a || null} embedded /></div>;
    case 'pomodoro': return <div style={{ padding: '12px' }}><PomodoroPanel compact /></div>;
    case 'simulacro': return <div style={{ padding: '12px' }}><SimEmbed /></div>;
    case 'stats': {
      const s = app.settings;
      const tp = todayProgress(app.col?.log ?? [], dayKey(Date.now(), s.timeZone, s.dayStartHour), s.timeZone, s.dayStartHour);
      return <div class="stack-s" style={{ padding: '16px' }}><div class="kv"><span class="k">{tr('spaces.estudiadas_hoy')}</span><span class="v">{tp.studied}</span></div><div class="kv"><span class="k">{tr('heatmap.minutos')}</span><span class="v">{tp.minutes}</span></div><div class="kv"><span class="k">{tr('today.aciertos')}</span><span class="v">{tp.studied ? `${tp.correct} %` : '—'}</span></div><a class="foot" href="#/estadisticas">{tr('spaces.ver_estadisticas')}</a></div>;
    }
  }
}

/** Elegir una nota existente (con buscador) o crear una nueva de verdad en la bóveda (E14). */
function NotePick(p: { onPick: (a: string) => void; creating?: boolean }) {
  const app = useApp();
  const { data } = useAsync(() => listNotes(app.vault), [app.version]);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(!!p.creating);
  const f = q.trim().toLowerCase();
  const list = (data ?? []).filter((n) => !f || `${n.materia} ${n.tema} ${n.title}`.toLowerCase().includes(f));
  return (
    <div class="stack-s" style={{ padding: '14px' }}>
      <div class="row wrap">
        <button type="button" class="btn primary" onClick={() => setCreating(true)}><FilePlus2 size={16} />{' '}{tr('spaces.nota_nueva')}</button>
        <input class="input grow" type="search" value={q} placeholder={tr('spaces.buscar_nota')} aria-label={tr('spaces.buscar_nota')} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      </div>
      {list.length ? list.slice(0, 200).map((n) => <button type="button" class="opt note" style={{ fontSize: 'var(--t-note)' }} onClick={() => p.onPick(n.path)}>{n.materia ? `${n.materia} › ` : ''}{n.title}</button>) : <p class="t2">{tr('spaces.sin_notas_crealas_en_notas')}</p>}
      {creating && <NewNotePanel onClose={() => setCreating(false)} onCreated={(path) => p.onPick(path)} />}
    </div>
  );
}

function DeckPick(p: { onPick: (a: string) => void }) {
  const app = useApp();
  return <div class="stack-s" style={{ padding: '14px' }}>{app.col?.decks.length ? app.col.decks.map((d) => <button type="button" class="opt note" style={{ fontSize: 'var(--t-note)' }} onClick={() => p.onPick(d.path)}>{d.full}</button>) : <p class="t2">{tr('decks.sin_mazos_todavia')}</p>}</div>;
}

/** Tema = carpeta de submazos (decks/<carpeta>/) o etiqueta (tag:x). */
function TopicPick(p: { onPick: (a: string) => void }) {
  const app = useApp();
  const folders = [...new Set(app.col?.decks.flatMap((d) => d.folder.split('/').map((_, i, a) => a.slice(0, i + 1).join('/'))).filter(Boolean) ?? [])].sort();
  const tags = [...new Set([...app.settings.tagList, ...(app.col?.decks.flatMap((d) => d.tags) ?? [])])].sort();
  return (
    <div class="stack-s" style={{ padding: '14px' }}>
      {folders.map((f) => <button type="button" class="opt note" style={{ fontSize: 'var(--t-note)' }} onClick={() => p.onPick(`decks/${f}/`)}>📁 {f}</button>)}
      {tags.map((g) => <button type="button" class="opt note" style={{ fontSize: 'var(--t-note)' }} onClick={() => p.onPick(`tag:${g}`)}>#{g}</button>)}
      {!folders.length && !tags.length && <p class="t2">{tr('spaces.sin_temas')}</p>}
    </div>
  );
}

/** Mazo como panel (E14): tarjetas (añadir y editar), estudiar y el mismo engranaje de Mazos. */
function DeckPanelBody(p: { path: string }) {
  const app = useApp();
  const [tab, setTab] = useState<'cards' | 'study'>('cards');
  const [gear, setGear] = useState(false);
  const deck = app.col?.decks.find((d) => d.path === p.path);
  return (
    <div class="stack-s" style={{ padding: '12px' }}>
      <div class="row wrap">
        <Segmented label={tr('deck.mazo')} value={tab} onChange={setTab} options={[['cards', tr('heatmap.tarjetas')], ['study', tr('today.estudiar')]]} />
        <span class="grow" />
        {deck && <button type="button" class="btn icon small" aria-label={tr('decks.opciones_de_label', { label: deck.name })} onClick={() => setGear(true)}><Settings2 size={16} /></button>}
      </div>
      {!deck && app.col ? <div class="err">⚠ {tr('spaces.mazo_no_encontrado', { path: p.path })}</div> : tab === 'cards' ? <DeckEditor path={p.path} onGear={() => setGear(true)} /> : <Study filter={p.path} embedded />}
      {gear && deck && <DeckOptions deck={deck} onClose={() => setGear(false)} />}
    </div>
  );
}

function TopicPanel(p: { target: string }) {
  const [tab, setTab] = useState<'cards' | 'study'>('cards');
  const q = p.target.startsWith('tag:') ? p.target : `deck:${p.target.replace(/^decks\//, '').replace(/\/$/, '')}`;
  return (
    <div class="stack-s" style={{ padding: '12px' }}>
      <Segmented label={tr('spaces.tema')} value={tab} onChange={setTab} options={[['cards', tr('heatmap.tarjetas')], ['study', tr('today.estudiar')]]} />
      {tab === 'cards' ? <Explorar q={q} /> : <Study filter={p.target} embedded />}
    </div>
  );
}

function DocxView(p: { path: string }) {
  const app = useApp();
  const { data, error } = useAsync(async () => {
    const r = await docxToHtml(await app.vault.read(p.path));
    for (const im of r.images) await app.vault.write(`media/${im.name}`, im.data);
    return sanitize(r.html.replace(/src="media:([^"]+)"/g, 'data-media="$1"'));
  }, [p.path]);
  if (error) return <div class="err">{tr('spaces.no_se_pudo_leer_el_documento')}</div>;
  return <div style={{ padding: '18px 22px' }}>{data ? <Html html={data} /> : <p class="t2">{tr('spaces.abriendo')}</p>}<p class="foot">{tr('spaces.solo_lectura_para_editarlo_abrelo_en')}</p></div>;
}

const ROW_H = 28;
function SheetView(p: { path: string }) {
  const app = useApp();
  const { data, error } = useAsync(async () => {
    if (/\.xlsx$/i.test(p.path)) throw new Error('xlsx');
    return parseCSV(await readTextOr(app.vault, p.path, ''));
  }, [p.path]);
  const [top, setTop] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => data?.slice(0, 50_000) ?? [], [data]);
  if (error) return <div class="err" style={{ margin: '12px' }}>{tr('spaces.las_hojas_xlsx_no_se_leen')}</div>;
  if (!data) return <p class="t2" style={{ padding: '12px' }}>{tr('spaces.abriendo')}</p>;
  const h = box.current?.clientHeight ?? 600;
  const first = Math.max(0, Math.floor(top / ROW_H) - 10);
  const last = Math.min(rows.length, first + Math.ceil(h / ROW_H) + 20);
  return (
    <div ref={box} style={{ overflow: 'auto', height: '100%' }} onScroll={(e) => setTop((e.target as HTMLElement).scrollTop)} data-user-content>
      {data.length > 50_000 && <div class="err">{tr('spaces.la_hoja_tiene_n_filas_se', { n: data.length })}</div>}
      <div style={{ height: `${rows.length * ROW_H}px`, position: 'relative' }}>
        <table class="sheet-table" style={{ position: 'absolute', top: `${first * ROW_H}px` }}>
          <tbody>{rows.slice(first, last).map((r, i) => <tr style={{ height: `${ROW_H}px` }}><th>{first + i + 1}</th>{r.map((c) => <td data-tip={c}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Imagen en un panel (Prompt 14 · 3): muestra una versión reducida al ancho del panel (caché
 * regenerable) y solo carga el original al acercar mucho o con «Ver original». Zoom propio
 * (`data-own-zoom`: el pellizco y Ctrl+rueda sobre la imagen la acercan a ella) y arrastre al estar
 * acercada. Las URLs se devuelven al cerrar o dormir el panel.
 */
function ImageView(p: { path: string }) {
  const app = useApp();
  const box = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<{ url: string; path: string; reduced: boolean; side: number } | null>(null);
  const [info, setInfo] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [z, setZ] = useState({ k: 1, x: 0, y: 0 });
  const held = useRef(new Set<string>());
  const want = useRef<'auto' | 'original'>('auto');
  const show = async (path: string, reduced: boolean, side: number) => {
    const url = await acquireMediaUrl(app.vault, path);
    if (!url || !box.current) return url && releaseMediaUrl(path);
    held.current.add(path);
    setSrc((o) => { if (o && o.path !== path && held.current.delete(o.path)) releaseMediaUrl(o.path); return { url, path, reduced, side }; });
  };
  const pick = async () => {
    const f = await app.vault.file?.(p.path);
    const head = f ? new Uint8Array(await f.slice(0, 1 << 16).arrayBuffer()) : await app.vault.read(p.path);
    const dims = imageSize(head);
    if (!dims || !box.current) return show(p.path, false, 0); // formato sin cabecera conocida: el original
    setInfo({ w: dims[0], h: dims[1] });
    const step = want.current === 'original' && !tooBig(dims[0], dims[1]) ? null : stepFor(dims[0], dims[1], neededSide(dims[0], dims[1], box.current.clientWidth * z.k, devicePixelRatio));
    if (step === null) return tooBig(dims[0], dims[1]) ? show(p.path, false, 0) : show(p.path, false, Math.max(...dims));
    const r = await reducedImage(app.vault, p.path, step);
    return r ? show(r, true, step) : tooBig(dims[0], dims[1]) ? setFailed(true) : show(p.path, false, Math.max(...dims));
  };
  useEffect(() => {
    want.current = 'auto';
    void pick();
    return () => { for (const x of held.current) releaseMediaUrl(x); held.current.clear(); };
  }, [p.path]);
  // al acercar más allá de lo que da la versión actual, se pide la siguiente (o el original)
  useEffect(() => {
    if (!src || !info || !box.current || z.k <= 1) return;
    const need = neededSide(info.w, info.h, box.current.clientWidth * z.k, devicePixelRatio);
    if (src.side && need > src.side * 1.25 && src.side < Math.max(info.w, info.h)) void pick();
  }, [z.k]);
  // zoom propio: el lienzo nos manda su pellizco o Ctrl+rueda
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const on = (e: Event) => setZ((o) => { const k = Math.min(8, Math.max(1, o.k * (e as CustomEvent<{ f: number }>).detail.f)); return k === 1 ? { k, x: 0, y: 0 } : { ...o, k }; });
    el.addEventListener('ownzoom', on);
    return () => el.removeEventListener('ownzoom', on);
  }, []);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<number | null>(null);
  const zoomed = z.k > 1;
  return (
    <div ref={box} class="img-view" data-own-zoom>
      {failed ? <p class="t2">{tr('imgview.no_se_pudo')}</p>
        : !src ? <div class="img-skeleton" aria-busy="true"><span class="t2">{tr('deck.cargando')}</span></div>
        : <img src={src.url} alt={p.path} decoding="async" draggable={false}
            style={{ maxWidth: '100%', display: 'block', margin: '0 auto', ...(zoomed ? { transform: `translate(${z.x}px, ${z.y}px) scale(${z.k})`, transformOrigin: 'center top', touchAction: 'none' } : {}) }}
            onPointerDown={(e) => { if (!zoomed) return; try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* sin captura */ } pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); e.stopPropagation(); }}
            onPointerMove={(e) => {
              const m = pts.current, prev = m.get(e.pointerId);
              if (!prev) return;
              m.set(e.pointerId, { x: e.clientX, y: e.clientY });
              if (m.size === 1) setZ((o) => ({ ...o, x: o.x + e.clientX - prev.x, y: o.y + e.clientY - prev.y }));
              else { const [a, b] = [...m.values()]; const d = Math.hypot(a!.x - b!.x, a!.y - b!.y); if (last.current) { const f = d / last.current; setZ((o) => ({ ...o, k: Math.min(8, Math.max(1, o.k * f)) })); } last.current = d; }
            }}
            onPointerUp={(e) => { pts.current.delete(e.pointerId); last.current = null; }}
            onPointerCancel={(e) => { pts.current.delete(e.pointerId); last.current = null; }} />}
      {src && (src.reduced || zoomed) && (
        <div class="img-bar row">
          {info && tooBig(info.w, info.h) && <span class="foot">{tr('imgview.muy_grande', { mp: Math.round((info.w * info.h) / 1e6) })}</span>}
          {zoomed && <button type="button" class="btn small" onClick={() => setZ({ k: 1, x: 0, y: 0 })}>{tr('imgview.ajustar')}</button>}
          {src.reduced && info && !tooBig(info.w, info.h) && <button type="button" class="btn small" onClick={() => { want.current = 'original'; void pick(); }}>{tr('imgview.ver_original')}</button>}
        </div>
      )}
    </div>
  );
}


