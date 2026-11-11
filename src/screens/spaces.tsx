import { BarChart3, BookOpen, ClipboardCheck, FileSpreadsheet, FileText, Image as ImageIcon, Lock, Maximize2, Minimize2, NotebookPen, Plus, Scan, Timer, Unlock, X, LayoutGrid, Inbox as InboxIcon, Sparkles } from 'lucide-preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { docxToHtml } from '../io/extract';
import { parseCSV } from '../io/csv';
import { renderMarkdown, sanitize } from '../md/render';
import { listNotes } from '../notes/model';
import { go, href, useApp, useAsync } from '../state';
import { Html } from '../ui/md';
import { Segmented, Sheet } from '../ui/kit';
import { mediaUrl } from '../ui/background';
import { extname } from '../vault/paths';
import { readTextOr, walk } from '../vault/util';
import { PdfViewer } from './pdf';
import { PomodoroPanel } from './pomodoro';
import { Study } from './study';
import { todayProgress } from '../lib/stats';
import { dayKey } from '../lib/days';
import { saveImage } from '../notes/images';

type PType = 'estudio' | 'simulacro' | 'nota' | 'pdf' | 'docx' | 'hoja' | 'imagen' | 'pomodoro' | 'stats';
interface Panel { id: string; type: PType; arg: string; x: number; y: number; w: number; h: number; locked?: boolean; min?: boolean }
interface Space { id: string; name: string; emoji: string; mode: 'tiles' | 'canvas'; panels: Panel[]; sizes: number[]; view: { x: number; y: number; k: number } }

const DIR = '.app/spaces';
const TYPES: { t: PType; label: string; icon: preact.JSX.Element }[] = [
  { t: 'estudio', label: 'Estudio', icon: <BookOpen size={18} /> },
  { t: 'nota', label: 'Nota', icon: <NotebookPen size={18} /> },
  { t: 'pdf', label: 'PDF', icon: <FileText size={18} /> },
  { t: 'docx', label: 'Documento', icon: <FileText size={18} /> },
  { t: 'hoja', label: 'Hoja', icon: <FileSpreadsheet size={18} /> },
  { t: 'imagen', label: 'Imagen', icon: <ImageIcon size={18} /> },
  { t: 'simulacro', label: 'Simulacro', icon: <ClipboardCheck size={18} /> },
  { t: 'pomodoro', label: 'Pomodoro', icon: <Timer size={18} /> },
  { t: 'stats', label: 'Estadísticas', icon: <BarChart3 size={18} /> },
];
const MAX_ACTIVE = 4;

const PRESETS: Record<string, Omit<Space, 'id'>> = {
  'PDF + tarjetas': { name: 'PDF + tarjetas', emoji: '📄', mode: 'tiles', panels: [{ id: 'a', type: 'pdf', arg: '', x: 0, y: 0, w: 640, h: 560 }, { id: 'b', type: 'estudio', arg: '', x: 680, y: 0, w: 520, h: 560 }], sizes: [0.6, 0.4], view: { x: 0, y: 0, k: 1 } },
  'Clase: notas + PDF': { name: 'Clase', emoji: '🎓', mode: 'tiles', panels: [{ id: 'a', type: 'nota', arg: '', x: 0, y: 0, w: 560, h: 560 }, { id: 'b', type: 'pdf', arg: '', x: 600, y: 0, w: 600, h: 560 }], sizes: [0.5, 0.5], view: { x: 0, y: 0, k: 1 } },
  Repaso: { name: 'Repaso', emoji: '🔁', mode: 'tiles', panels: [{ id: 'a', type: 'estudio', arg: '', x: 0, y: 0, w: 700, h: 560 }, { id: 'b', type: 'pomodoro', arg: '', x: 740, y: 0, w: 340, h: 420 }, { id: 'c', type: 'stats', arg: '', x: 740, y: 440, w: 340, h: 260 }], sizes: [0.55, 0.22, 0.23], view: { x: 0, y: 0, k: 1 } },
};

async function loadSpaces(vault: ReturnType<typeof useApp>['vault']): Promise<Space[]> {
  const out: Space[] = [];
  for (const f of await walk(vault, DIR)) {
    try { out.push(JSON.parse(await readTextOr(vault, f.path, '')) as Space); } catch { /* dañado */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

export function Spaces(props: { route: string[] }) {
  const app = useApp();
  const { data: spaces } = useAsync(() => loadSpaces(app.vault), [app.version]);
  const [creating, setCreating] = useState(false);
  const [sp, setSp] = useState<Space | null>(null);
  const saveT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const save = (s: Space) => {
    setSp(s);
    clearTimeout(saveT.current);
    saveT.current = setTimeout(() => void app.vault.write(`${DIR}/${s.id}.json`, JSON.stringify(s)), 400);
  };
  // abrir un archivo desde un enlace: #/espacios/abrir/<ruta[#pN]>
  useEffect(() => {
    if (!spaces) return;
    if (props.route[0] === 'abrir' && props.route[1]) {
      const [path, frag] = decodeURIComponent(props.route.slice(1).join('/')).split('#');
      const type: PType = /\.pdf$/i.test(path!) ? 'pdf' : /\.docx$/i.test(path!) ? 'docx' : /\.(csv|tsv)$/i.test(path!) ? 'hoja' : /\.(png|jpe?g|webp|gif)$/i.test(path!) ? 'imagen' : 'nota';
      const base = spaces[0] ?? { id: 'general', name: 'General', emoji: '🗂️', mode: 'tiles' as const, panels: [], sizes: [], view: { x: 0, y: 0, k: 1 } };
      const panel: Panel = { id: Date.now().toString(36), type, arg: frag ? `${path}#${frag}` : path!, x: 40, y: 40, w: 640, h: 560 };
      const panels = [...base.panels.slice(-2), panel];
      const s = { ...base, panels, sizes: panels.map(() => 1 / panels.length) };
      save(s);
      location.replace(href('espacios', s.id));
      return;
    }
    const id = props.route[0];
    setSp(spaces.find((s) => s.id === id) ?? spaces[0] ?? null);
  }, [spaces, props.route.join('/')]);

  return (
    <div class="spaces">
      <nav class="rail glass" aria-label="Espacios">
        {spaces?.map((s) => <button type="button" aria-current={sp?.id === s.id} aria-label={s.name} title={s.name} onClick={() => go('espacios', s.id)}>{s.emoji}</button>)}
        <button type="button" aria-label="Nuevo espacio" onClick={() => setCreating(true)}><Plus size={20} /></button>
      </nav>
      <div style={{ minWidth: 0 }}>
        {!sp ? (
          <div class="empty glass"><LayoutGrid size={44} /><h2>Espacios</h2><p>Paneles que comparten datos: crea una tarjeta desde un PDF o cita el PDF en tu nota. Elige un preajuste.</p>
            <div class="row wrap" style={{ justifyContent: 'center' }}>{Object.keys(PRESETS).map((k) => <button type="button" class="btn" onClick={() => { const s = { ...PRESETS[k]!, id: Date.now().toString(36) }; save(s); go('espacios', s.id); }}>{k}</button>)}</div>
          </div>
        ) : (
          <>
            <div class="row wrap" style={{ marginBottom: '10px' }}>
              <span class="title-chip glass"><b>{sp.emoji} {sp.name}</b></span>
              <span class="grow" />
              <Segmented label="Modo" value={sp.mode} onChange={(m) => save({ ...sp, mode: m })} options={[['tiles', 'Mosaico'], ['canvas', 'Lienzo']]} />
              <button type="button" class="btn small" onClick={async () => { if (!confirm(`¿Eliminar el espacio "${sp.name}"? Los archivos no se borran.`)) return; await app.vault.remove(`${DIR}/${sp.id}.json`); app.changed(); go('espacios'); }}>Eliminar</button>
            </div>
            {sp.mode === 'tiles' ? <Tiles sp={sp} save={save} /> : <CanvasView sp={sp} save={save} />}
            <Dock sp={sp} save={save} />
          </>
        )}
      </div>
      {creating && (
        <Sheet title="Nuevo espacio" onClose={() => setCreating(false)}>
          <form class="stack" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget as HTMLFormElement); const preset = PRESETS[String(f.get('p'))]; const s: Space = { ...(preset ?? { mode: 'tiles', panels: [], sizes: [], view: { x: 0, y: 0, k: 1 } }), id: Date.now().toString(36), name: String(f.get('n')) || 'Espacio', emoji: String(f.get('e')) || '🗂️' } as Space; save(s); setCreating(false); go('espacios', s.id); }}>
            <label class="field">Nombre (materia o examen)<input class="input" name="n" required /></label>
            <label class="field">Emoji<input class="input" name="e" maxLength={8} placeholder="🫀" /></label>
            <label class="field">Preajuste<select name="p"><option value="">Vacío</option>{Object.keys(PRESETS).map((k) => <option>{k}</option>)}</select></label>
            <button class="btn primary" type="submit">Crear</button>
          </form>
        </Sheet>
      )}
    </div>
  );
}

function Dock(p: { sp: Space; save: (s: Space) => void }) {
  const app = useApp();
  const add = (t: PType) => {
    const n = p.sp.panels.length;
    const panel: Panel = { id: Date.now().toString(36), type: t, arg: '', x: 60 + n * 40, y: 60 + n * 40, w: t === 'pomodoro' ? 340 : 560, h: t === 'pomodoro' ? 420 : 520 };
    const panels = p.sp.mode === 'tiles' ? [...p.sp.panels.slice(-2), panel] : [...p.sp.panels, panel];
    p.save({ ...p.sp, panels, sizes: panels.map(() => 1 / panels.length) });
  };
  return (
    <div class="dock no-print">
      <a class="pill glass" href="#/addons"><Sparkles size={16} /> Extras</a>
      <div class="glass" role="toolbar" aria-label="Añadir panel">
        <span class="note t2" style={{ padding: '0 10px' }}><Plus size={14} /> Añadir panel</span>
        {TYPES.map((x) => <button type="button" class="btn icon small ghost" aria-label={`Añadir panel ${x.label}`} title={x.label} onClick={() => add(x.t)}>{x.icon}</button>)}
      </div>
      <a class="pill glass" href="#/bandeja"><InboxIcon size={16} /> Bandeja <span class={`count${app.inboxCount ? '' : ' zero'}`}>{app.inboxCount}</span></a>
    </div>
  );
}

function Tiles(p: { sp: Space; save: (s: Space) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const panels = p.sp.panels.slice(0, 3);
  const sizes = panels.map((_, i) => p.sp.sizes[i] ?? 1 / panels.length);
  const drag = useRef<{ i: number; x: number; s: number[] } | null>(null);
  if (!panels.length) return <div class="empty glass"><p>Añade paneles desde el dock (1 a 3 en mosaico).</p></div>;
  const cols = sizes.flatMap((s, i) => (i ? ['10px', `${s}fr`] : [`${s}fr`])).join(' ');
  return (
    <div ref={box} class="tiles" style={{ gridTemplateColumns: cols, height: 'calc(100dvh - 230px)' }}>
      {panels.flatMap((pn, i) => [
        ...(i ? [<div class="divider" role="separator" aria-orientation="vertical" aria-label="Redimensionar paneles" tabIndex={0}
          onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { i, x: e.clientX, s: [...sizes] }; }}
          onPointerMove={(e) => { const d = drag.current; if (!d) return; const W = box.current!.clientWidth; const dx = (e.clientX - d.x) / W; const tot = d.s[d.i - 1]! + d.s[d.i]!; const a = Math.min(tot - 0.15, Math.max(0.15, d.s[d.i - 1]! + dx)); const s = [...d.s]; s[d.i - 1] = a; s[d.i] = tot - a; p.save({ ...p.sp, sizes: s }); }}
          onPointerUp={() => (drag.current = null)}
          onKeyDown={(e) => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; const s = [...sizes]; const dx = e.key === 'ArrowLeft' ? -0.05 : 0.05; s[i - 1] = Math.max(0.15, s[i - 1]! + dx); s[i] = Math.max(0.15, s[i]! - dx); p.save({ ...p.sp, sizes: s }); }} />] : []),
        <Window key={pn.id} panel={pn} sp={p.sp} save={p.save} />,
      ])}
    </div>
  );
}

/** Lienzo infinito (nivel 2): transformaciones CSS sobre contenedores DOM, paneo/zoom con dos dedos. */
function CanvasView(p: { sp: Space; save: (s: Space) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [v, setV] = useState(p.sp.view);
  const [focus, setFocus] = useState<string | null>(p.sp.panels[p.sp.panels.length - 1]?.id ?? null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const last = useRef<{ d: number } | null>(null);
  const commit = (nv: typeof v) => (setV(nv), p.save({ ...p.sp, view: nv }));
  // máximo 4 activos: los menos recientes se "duermen"
  const order = [...p.sp.panels].sort((a, b) => (a.id === focus ? 1 : b.id === focus ? -1 : 0));
  const awake = new Set(order.slice(-MAX_ACTIVE).map((x) => x.id));
  const fit = () => {
    const ps = p.sp.panels;
    if (!ps.length || !wrap.current) return;
    const minX = Math.min(...ps.map((x) => x.x)), minY = Math.min(...ps.map((x) => x.y));
    const maxX = Math.max(...ps.map((x) => x.x + x.w)), maxY = Math.max(...ps.map((x) => x.y + x.h));
    const W = wrap.current.clientWidth, H = wrap.current.clientHeight;
    const k = Math.min(1.5, Math.min(W / (maxX - minX + 80), H / (maxY - minY + 80)));
    commit({ k, x: (W - (maxX - minX) * k) / 2 - minX * k, y: (H - (maxY - minY) * k) / 2 - minY * k });
  };
  const ps = p.sp.panels;
  const minX = Math.min(0, ...ps.map((x) => x.x)), minY = Math.min(0, ...ps.map((x) => x.y));
  const maxX = Math.max(1, ...ps.map((x) => x.x + x.w)), maxY = Math.max(1, ...ps.map((x) => x.y + x.h));
  const mk = Math.min(160 / (maxX - minX), 110 / (maxY - minY));
  return (
    <div ref={wrap} class="canvas-wrap glass flat"
      onPointerDown={(e) => { if ((e.target as HTMLElement).closest('.win')) return; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); }}
      onPointerMove={(e) => {
        const m = pts.current;
        if (!m.has(e.pointerId)) return;
        const prev = m.get(e.pointerId)!;
        m.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (m.size === 1) setV((o) => ({ ...o, x: o.x + e.clientX - prev.x, y: o.y + e.clientY - prev.y }));
        else {
          const [a, b] = [...m.values()];
          const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
          const r = wrap.current!.getBoundingClientRect();
          const cx = (a!.x + b!.x) / 2 - r.left, cy = (a!.y + b!.y) / 2 - r.top;
          if (last.current) { const k = d / last.current.d; setV((o) => ({ k: Math.min(3, Math.max(0.2, o.k * k)), x: cx - (cx - o.x) * k, y: cy - (cy - o.y) * k })); }
          last.current = { d };
        }
      }}
      onPointerUp={(e) => { pts.current.delete(e.pointerId); last.current = null; if (!pts.current.size) p.save({ ...p.sp, view: v }); }}
      onWheel={(e) => { e.preventDefault(); const r = wrap.current!.getBoundingClientRect(); const cx = e.clientX - r.left, cy = e.clientY - r.top; if (e.ctrlKey || e.metaKey) { const k = Math.exp(-e.deltaY / 300); setV((o) => ({ k: Math.min(3, Math.max(0.2, o.k * k)), x: cx - (cx - o.x) * k, y: cy - (cy - o.y) * k })); } else setV((o) => ({ ...o, x: o.x - e.deltaX, y: o.y - e.deltaY })); }}>
      <div class="canvas-plane" style={{ transform: `translate(${v.x}px, ${v.y}px) scale(${v.k})` }}>
        {p.sp.panels.map((pn) => <Window key={pn.id} panel={pn} sp={p.sp} save={p.save} free scale={v.k} asleep={!awake.has(pn.id)} focused={focus === pn.id} onFocus={() => setFocus(pn.id)} />)}
      </div>
      <div class="row" style={{ position: 'absolute', left: '12px', bottom: '12px' }}>
        <button type="button" class="btn small glass" onClick={fit}><Scan size={16} /> Ajustar al contenido</button>
        <span class="chip">{Math.round(v.k * 100)} %</span>
      </div>
      <div class="minimap glass" aria-hidden="true">
        {ps.map((x) => <i style={{ left: `${(x.x - minX) * mk}px`, top: `${(x.y - minY) * mk}px`, width: `${x.w * mk}px`, height: `${x.h * mk}px` }} />)}
        {wrap.current && <b style={{ left: `${(-v.x / v.k - minX) * mk}px`, top: `${(-v.y / v.k - minY) * mk}px`, width: `${(wrap.current.clientWidth / v.k) * mk}px`, height: `${(wrap.current.clientHeight / v.k) * mk}px` }} />}
      </div>
    </div>
  );
}

function Window(p: { panel: Panel; sp: Space; save: (s: Space) => void; free?: boolean; scale?: number; asleep?: boolean; focused?: boolean; onFocus?: () => void }) {
  const pn = p.panel;
  const t = TYPES.find((x) => x.t === pn.type)!;
  const upd = (patch: Partial<Panel>) => p.save({ ...p.sp, panels: p.sp.panels.map((x) => (x.id === pn.id ? { ...x, ...patch } : x)) });
  const dragRef = useRef<{ x: number; y: number; px: number; py: number; mode: 'move' | 'size' } | null>(null);
  const start = (mode: 'move' | 'size') => (e: PointerEvent) => {
    if (!p.free || pn.locked || (e.target as HTMLElement).closest('button')) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, px: mode === 'move' ? pn.x : pn.w, py: mode === 'move' ? pn.y : pn.h, mode };
    p.onFocus?.();
  };
  const move = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const k = p.scale ?? 1;
    const dx = (e.clientX - d.x) / k, dy = (e.clientY - d.y) / k;
    if (d.mode === 'move') upd({ x: Math.round(d.px + dx), y: Math.round(d.py + dy) });
    else upd({ w: Math.max(260, Math.round(d.px + dx)), h: Math.max(200, Math.round(d.py + dy)) });
  };
  const style = p.free ? { left: `${pn.x}px`, top: `${pn.y}px`, width: `${pn.w}px`, height: pn.min ? '44px' : `${pn.h}px` } : {};
  return (
    <section class={`win glass${p.focused ? ' focused' : ''}${p.asleep ? ' asleep flat' : ''}`} style={style} aria-label={`Panel ${t.label}`} onPointerDown={() => p.onFocus?.()}>
      <header class="win-bar" onPointerDown={start('move')} onPointerMove={move} onPointerUp={() => (dragRef.current = null)}>
        {t.icon}
        <span class="t ellipsis">{pn.arg ? pn.arg.split('/').pop() : t.label}</span>
        <span class="chip">{p.asleep ? 'en pausa' : t.label}</span>
        <span class="grow" />
        {p.free && <button type="button" class="btn icon small ghost" aria-label={pn.locked ? 'Desbloquear' : 'Bloquear'} onClick={() => upd({ locked: !pn.locked })}>{pn.locked ? <Lock size={16} /> : <Unlock size={16} />}</button>}
        {p.free && <button type="button" class="btn icon small ghost" aria-label={pn.min ? 'Expandir' : 'Minimizar'} onClick={() => upd({ min: !pn.min })}>{pn.min ? <Maximize2 size={16} /> : <Minimize2 size={16} />}</button>}
        <button type="button" class="btn icon small ghost" aria-label="Cerrar panel" onClick={() => p.save({ ...p.sp, panels: p.sp.panels.filter((x) => x.id !== pn.id), sizes: p.sp.panels.filter((x) => x.id !== pn.id).map((_, _i, a) => 1 / a.length) })}><X size={16} /></button>
      </header>
      {!pn.min && (
        <div class="win-body">
          {p.asleep ? <p class="t2" style={{ padding: '16px' }}>Panel en pausa para cuidar la memoria (máx. {MAX_ACTIVE} activos). Tócalo para reanudar.</p> : <PanelBody panel={pn} onArg={(arg) => upd({ arg })} />}
          {p.free && <div class="win-resize" onPointerDown={start('size')} onPointerMove={move} onPointerUp={() => (dragRef.current = null)} aria-hidden="true" />}
        </div>
      )}
    </section>
  );
}

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
      {data?.length ? <p class="foot">O elige uno de tu bóveda:</p> : null}
      {data?.map((x) => <button type="button" class="opt note" style={{ fontSize: 'var(--t-note)' }} onClick={() => p.onPick(x)}>{x}</button>)}
    </div>
  );
}

function PanelBody(p: { panel: Panel; onArg: (a: string) => void }) {
  const app = useApp();
  const a = p.panel.arg;
  switch (p.panel.type) {
    case 'pdf': {
      if (!a) return <FilePicker exts={['pdf']} dir="docs" label="Abrir PDF" onPick={p.onArg} />;
      const [path, frag] = a.split('#');
      return <PdfViewer path={path!} page={frag ? Number(frag.replace(/^p/, '')) : undefined} />;
    }
    case 'docx': return a ? <DocxView path={a} /> : <FilePicker exts={['docx']} dir="docs" label="Abrir .docx" onPick={p.onArg} />;
    case 'hoja': return a ? <SheetView path={a} /> : <FilePicker exts={['csv', 'tsv', 'xlsx']} dir="docs" label="Abrir hoja (.csv)" onPick={p.onArg} />;
    case 'imagen': return a ? <ImageView path={a} /> : <FilePicker exts={['png', 'jpg', 'jpeg', 'webp', 'gif']} dir="media" label="Abrir imagen" onPick={p.onArg} />;
    case 'nota': return a ? <NoteView path={a} /> : <NotePick onPick={p.onArg} />;
    case 'estudio': return <div style={{ padding: '12px' }}><Study filter={a || null} embedded /></div>;
    case 'pomodoro': return <div style={{ padding: '12px' }}><PomodoroPanel compact /></div>;
    case 'simulacro': return <div class="stack" style={{ padding: '16px' }}><p>Los simulacros usan la pantalla completa para el cronómetro.</p><a class="btn primary" href="#/simulacros">Abrir simulacros</a></div>;
    case 'stats': {
      const s = app.settings;
      const tp = todayProgress(app.col?.log ?? [], dayKey(Date.now(), s.timeZone, s.dayStartHour), s.timeZone, s.dayStartHour);
      return <div class="stack-s" style={{ padding: '16px' }}><div class="kv"><span class="k">Estudiadas hoy</span><span class="v">{tp.studied}</span></div><div class="kv"><span class="k">Minutos</span><span class="v">{tp.minutes}</span></div><div class="kv"><span class="k">Aciertos</span><span class="v">{tp.studied ? `${tp.correct} %` : '—'}</span></div><a class="foot" href="#/estadisticas">Ver estadísticas</a></div>;
    }
  }
}

function NotePick(p: { onPick: (a: string) => void }) {
  const app = useApp();
  const { data } = useAsync(() => listNotes(app.vault), [app.version]);
  return <div class="stack-s" style={{ padding: '14px' }}>{data?.length ? data.map((n) => <button type="button" class="opt note" style={{ fontSize: 'var(--t-note)' }} onClick={() => p.onPick(n.path)}>{n.materia} › {n.title}</button>) : <p class="t2">Sin notas. Créalas en Notas.</p>}</div>;
}

function NoteView(p: { path: string }) {
  const app = useApp();
  const [edit, setEdit] = useState(false);
  const { data: text } = useAsync(() => readTextOr(app.vault, p.path, ''), [p.path, app.version]);
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div style={{ padding: '14px 18px' }}>
      <div class="row"><span class="grow" /><button type="button" class="btn small" onClick={async () => { if (edit && draft !== null) { await app.vault.write(p.path, draft); app.changed(); } setEdit(!edit); setDraft(null); }}>{edit ? 'Guardar' : 'Editar'}</button><a class="btn small" href={href('notas', ...p.path.split('/').slice(1))}>Abrir</a></div>
      {edit ? <textarea class="input code" style={{ width: '100%', minHeight: '50dvh' }} value={draft ?? text ?? ''} onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)} /> : <Html html={renderMarkdown((text ?? '').replace(/^---\n[\s\S]*?\n---\n/, ''))} />}
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
  if (error) return <div class="err">⚠ No se pudo leer el documento.</div>;
  return <div style={{ padding: '18px 22px' }}>{data ? <Html html={data} /> : <p class="t2">Abriendo…</p>}<p class="foot">Solo lectura. Para editarlo, ábrelo en otra app.</p></div>;
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
  if (error) return <div class="err" style={{ margin: '12px' }}>⚠ Las hojas .xlsx no se leen en esta versión: guárdala como CSV.</div>;
  if (!data) return <p class="t2" style={{ padding: '12px' }}>Abriendo…</p>;
  const h = box.current?.clientHeight ?? 600;
  const first = Math.max(0, Math.floor(top / ROW_H) - 10);
  const last = Math.min(rows.length, first + Math.ceil(h / ROW_H) + 20);
  return (
    <div ref={box} style={{ overflow: 'auto', height: '100%' }} onScroll={(e) => setTop((e.target as HTMLElement).scrollTop)} data-user-content>
      {data.length > 50_000 && <div class="err">⚠ La hoja tiene {data.length} filas; se muestran 50 000.</div>}
      <div style={{ height: `${rows.length * ROW_H}px`, position: 'relative' }}>
        <table class="sheet-table" style={{ position: 'absolute', top: `${first * ROW_H}px` }}>
          <tbody>{rows.slice(first, last).map((r, i) => <tr style={{ height: `${ROW_H}px` }}><th>{first + i + 1}</th>{r.map((c) => <td title={c}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function ImageView(p: { path: string }) {
  const app = useApp();
  const { data } = useAsync(() => mediaUrl(app.vault, p.path), [p.path]);
  return data ? <img src={data} alt={p.path} style={{ maxWidth: '100%', display: 'block', margin: '0 auto' }} /> : <p class="t2">Cargando…</p>;
}


