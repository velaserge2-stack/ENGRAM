import { BookOpen, FileSpreadsheet, ImagePlus, Plus, Settings2, Share } from 'lucide-preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { cardsOf, type Note, type NoteType, parseDeck, type Rect } from '../cards/parse';
import { appendCard } from '../data/ops';
import { guessMapping, parseCSV, rowsToBlocks } from '../io/csv';
import { deliver } from '../io/share';
import { createAutosave } from '../lib/autosave';
import { renderCloze, renderInline, renderMarkdown } from '../md/render';
import { go, href, useApp } from '../state';
import { PageTitle, Segmented, Sheet } from '../ui/kit';
import { Html } from '../ui/md';
import { readTextOr } from '../vault/util';
import { OcclusionEditor } from './occlusion';
import { useLinkedEvents } from '../ui/links';
import { CalendarDays } from 'lucide-preact';

/** Indicador de próximos eventos del calendario vinculados a este mazo. */
function DeckEvents(p: { path: string }) {
  const { data } = useLinkedEvents(p.path);
  if (!data?.next.length) return null;
  const n = data.next[0]!;
  return (
    <a class="btn" href="#/calendario" title={data.next.map((o) => `${o.b.title} · ${new Date(o.start).toLocaleString('es-MX')}`).join('\n')}>
      <CalendarDays size={18} /> {data.next.length} {data.next.length === 1 ? 'evento' : 'eventos'} · {new Date(n.start).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
    </a>
  );
}

const TYPES: [NoteType, string][] = [
  ['basic', 'Básica'], ['reverse', 'Inversa'], ['type', 'Escribir'], ['cloze', 'Cloze'], ['list', 'Lista'],
  ['olist', 'Lista ordenada'], ['mc', 'Opción múltiple'], ['match', 'Unir'], ['order', 'Ordenar'], ['io', 'Oclusión'],
];

const one = (s: string) => s.replace(/\r?\n\s*\r?\n/g, '\n').trim();

/** Construye la sintaxis del bloque desde el formulario visual (sin que el usuario la escriba). */
export function buildBlock(t: NoteType, f: { front: string; back: string; lines: string; image: string; rects: Rect[] }): string {
  const items = f.lines.split('\n').map((x) => x.trim()).filter(Boolean);
  switch (t) {
    case 'basic': return `Q:: ${one(f.front)}\nA:: ${one(f.back)}`;
    case 'reverse': return `QR:: ${one(f.front)}\nA:: ${one(f.back)}`;
    case 'type': return `T:: ${one(f.front)}\nA:: ${one(f.back)}`;
    case 'cloze': return `Cloze: ${one(f.front)}`;
    case 'list': return `L:: ${one(f.front)}\n${items.map((x) => `- ${x}`).join('\n')}`;
    case 'olist': return `LO:: ${one(f.front)}\n${items.map((x) => `- ${x}`).join('\n')}`;
    case 'order': return `ORD:: ${one(f.front)}\n${items.map((x) => `- ${x}`).join('\n')}`;
    case 'mc': return `MC:: ${one(f.front)}\n${items.map((x) => (x.startsWith('*') ? `- [x] ${x.slice(1).trim()}` : `- [ ] ${x}`)).join('\n')}${f.back.trim() ? `\nA:: ${one(f.back)}` : ''}`;
    case 'match': return `MATCH:: ${one(f.front)}\n${items.map((x) => `- ${x.includes('=>') ? x : x.replace(/\s*[|:]\s*/, ' => ')}`).join('\n')}`;
    case 'io': return `IO: ![[${f.image}]] <!-- io: ${f.rects.map((r) => `${r.x},${r.y},${r.w},${r.h}`).join('; ')} -->`;
  }
}

export function NotePreview(props: { note: Note }) {
  const n = props.note;
  const cards = cardsOf(n);
  return (
    <div class="inset" style={{ borderRadius: 'var(--r-row)', padding: '10px 12px' }}>
      <div class="row foot"><span class="chip">{TYPES.find((t) => t[0] === n.type)?.[1]}</span>{n.id && <span class="t3">^{n.id}</span>}<span class="grow" />{cards.length > 1 && <span>{cards.length} tarjetas</span>}{n.origin === 'ia' && <span class="chip">IA</span>}</div>
      {n.errors.map((e) => <div class="err" style={{ marginTop: '6px' }}>⚠ {e}</div>)}
      <div style={{ marginTop: '6px' }}>
        {n.type === 'cloze' ? <Html html={renderCloze(n.front, -1, true)} /> : <Html html={renderMarkdown(n.front)} />}
        {n.back && <Html class="t2" html={renderMarkdown(n.back)} />}
        {n.items.length > 0 && <ol style={{ margin: '4px 0', paddingLeft: '1.3em' }}>{n.items.map((i) => <li><Html tag="span" html={renderInline(i)} /></li>)}</ol>}
        {n.options.length > 0 && <ul style={{ margin: '4px 0', paddingLeft: '1.3em' }}>{n.options.map((o) => <li style={{ fontWeight: o.correct ? 700 : 400 }}>{o.correct ? '✓ ' : ''}{o.text}</li>)}</ul>}
        {n.pairs.length > 0 && <ul style={{ margin: '4px 0', paddingLeft: '1.3em' }}>{n.pairs.map(([a, b]) => <li>{a} → {b}</li>)}</ul>}
        {n.type === 'io' && <p class="foot">{n.image} · {n.rects.length} zonas</p>}
      </div>
    </div>
  );
}

/** Editor visual de tarjeta (sin escribir sintaxis). */
export function CardForm(props: { onAdd: (block: string) => Promise<void>; initialFront?: string }) {
  const app = useApp();
  const [type, setType] = useState<NoteType>('basic');
  const [front, setFront] = useState(props.initialFront ?? '');
  const [back, setBack] = useState('');
  const [lines, setLines] = useState('');
  const [image, setImage] = useState('');
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [rects, setRects] = useState<Rect[]>([]);
  const ta = useRef<HTMLTextAreaElement>(null);
  const block = buildBlock(type, { front, back, lines, image, rects });
  const parsed = parseDeck(block + ' ^vista').notes[0];
  const makeCloze = () => {
    const el = ta.current;
    if (!el) return;
    const [a, b] = [el.selectionStart, el.selectionEnd];
    if (a === b) return;
    const n = Math.max(0, ...[...front.matchAll(/\{\{c(\d+)::/g)].map((m) => Number(m[1]))) + 1;
    setFront(front.slice(0, a) + `{{c${n}::${front.slice(a, b)}}}` + front.slice(b));
  };
  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    const name = `${Date.now().toString(36)}-${file.name.replace(/[^\w.-]+/g, '_')}`;
    await app.vault.write(`media/${name}`, new Uint8Array(await file.arrayBuffer()));
    setImage(name);
    setImgUrl(URL.createObjectURL(file));
    setRects([]);
  };
  const listLabel = type === 'mc' ? 'Opciones (una por línea; marca las correctas con * al inicio)' : type === 'match' ? 'Pares, uno por línea: izquierda => derecha' : 'Elementos, uno por línea' + (type === 'order' || type === 'olist' ? ' (en el orden correcto)' : '');
  return (
    <form class="stack" onSubmit={async (e) => {
      e.preventDefault();
      if (parsed?.errors.length) return;
      await props.onAdd(block);
      setFront(''); setBack(''); setLines(''); setRects([]);
      ta.current?.focus();
    }}>
      <div style={{ overflowX: 'auto' }}><Segmented label="Tipo de tarjeta" value={type} onChange={setType} options={TYPES} /></div>
      {type === 'io' ? (
        <>
          <label class="btn" style={{ justifySelf: 'start' }}><ImagePlus size={18} /> Elegir imagen<input type="file" accept="image/*" hidden onChange={(e) => void pickImage((e.target as HTMLInputElement).files?.[0])} /></label>
          {imgUrl && <OcclusionEditor url={imgUrl} rects={rects} onChange={setRects} />}
          <p class="foot">Cada zona es una tarjeta (ocultar una). Dibuja con el dedo o con el Pencil.</p>
        </>
      ) : (
        <>
          <label class="field">{type === 'cloze' ? 'Texto (selecciona una palabra y toca "Hacer hueco")' : type === 'list' || type === 'olist' || type === 'order' || type === 'match' ? 'Título' : 'Pregunta'}
            <textarea ref={ta} class="input" rows={type === 'cloze' ? 4 : 2} value={front} onInput={(e) => setFront((e.target as HTMLTextAreaElement).value)} required />
          </label>
          {type === 'cloze' && <button type="button" class="btn small" style={{ justifySelf: 'start' }} onClick={makeCloze}>Hacer hueco {'{{c}}'}</button>}
          {['basic', 'reverse', 'type', 'mc'].includes(type) && (
            <label class="field">{type === 'mc' ? 'Explicación (opcional)' : 'Respuesta'}<textarea class="input" rows={2} value={back} onInput={(e) => setBack((e.target as HTMLTextAreaElement).value)} required={type !== 'mc'} /></label>
          )}
          {['list', 'olist', 'order', 'mc', 'match'].includes(type) && (
            <label class="field">{listLabel}<textarea class="input" rows={5} value={lines} onInput={(e) => setLines((e.target as HTMLTextAreaElement).value)} required /></label>
          )}
        </>
      )}
      {parsed && (front || lines || image) && <NotePreview note={parsed} />}
      <button class="btn primary" type="submit" disabled={!!parsed?.errors.length}><Plus size={18} /> Añadir tarjeta</button>
    </form>
  );
}

export function AddCardSheet(props: { deckPath: string | null; onClose: () => void }) {
  const app = useApp();
  const decks = app.col?.decks ?? [];
  const [deck, setDeck] = useState(props.deckPath ?? app.col?.decks[0]?.path ?? '');
  const [added, setAdded] = useState(0);
  return (
    <Sheet title="Añadir tarjeta" onClose={() => (added && app.changed(), props.onClose())} wide>
      {decks.length === 0 ? <p>Primero crea un mazo en Mazos.</p> : (
        <div class="stack">
          <label class="field">Mazo
            <select value={deck} onChange={(e) => setDeck((e.target as HTMLSelectElement).value)}>
              {decks.map((d) => <option value={d.path}>{d.full}</option>)}
            </select>
          </label>
          <CardForm onAdd={async (b) => { await appendCard(app.vault, deck, b, app.col); setAdded((n) => n + 1); app.toast('Tarjeta añadida'); }} />
          {added > 0 && <p class="foot">{added} añadidas en esta sesión.</p>}
        </div>
      )}
    </Sheet>
  );
}

/** Editor del archivo del mazo: Markdown a la izquierda, tarjetas renderizadas a la derecha. */
export function DeckEditor(props: { path: string }) {
  const app = useApp();
  const [text, setText] = useState<string | null>(null);
  const [mode, setMode] = useState<'visual' | 'md'>('visual');
  const [csv, setCsv] = useState(false);
  const dirty = useRef(false);
  const saver = useMemo(() => createAutosave(async (t: string) => { await app.vault.write(props.path, t); }), [props.path]);
  useEffect(() => {
    void readTextOr(app.vault, props.path, '').then(setText);
    return () => {
      void saver.flush().then(() => dirty.current && app.changed());
      saver.dispose();
    };
  }, [props.path]);
  if (text === null) return <p class="t2">Cargando…</p>;
  const parsed = parseDeck(text);
  const name = typeof parsed.data.deck === 'string' ? parsed.data.deck : props.path.split('/').pop()!.replace(/\.md$/, '');
  const onAdd = async (block: string) => {
    await saver.flush();
    await appendCard(app.vault, props.path, block, app.col);
    setText(await readTextOr(app.vault, props.path, ''));
    dirty.current = true;
    app.toast('Tarjeta añadida');
  };
  return (
    <>
      <PageTitle title={name} sub={`${props.path} · ${parsed.notes.length} notas · ${parsed.notes.flatMap(cardsOf).length} tarjetas`}>
        <Segmented label="Modo" value={mode} onChange={setMode} options={[['visual', 'Visual'], ['md', 'Ver Markdown']]} />
        <DeckEvents path={props.path} />
        <a class="btn primary" href={href('estudiar', ...props.path.split('/'))}><BookOpen size={18} /> Estudiar</a>
        <button type="button" class="btn" onClick={() => setCsv(true)}><FileSpreadsheet size={18} /> CSV</button>
        <button type="button" class="btn" onClick={async () => { await saver.flush(); const r = await deliver(new File([text], props.path.split('/').pop()!, { type: 'text/markdown' })); if (r !== 'cancelled') app.toast('Mazo exportado'); }}><Share size={18} /> Exportar</button>
        <button type="button" class="btn icon" aria-label="Volver a mazos" onClick={() => go('mazos')}><Settings2 size={18} /></button>
      </PageTitle>
      <div class="editor">
        {mode === 'md' ? (
          <section class="glass strong panel">
            <textarea class="input code" value={text} spellcheck={false} aria-label="Markdown del mazo" onInput={(e) => { const t = (e.target as HTMLTextAreaElement).value; setText(t); dirty.current = true; saver.schedule(t); }} />
            <p class="foot">Se guarda solo. Los IDs ^xxxx se añaden al salir del editor. Una línea en blanco separa tarjetas.</p>
          </section>
        ) : (
          <section class="glass strong panel"><h2 style={{ fontSize: 'var(--t-3)', marginBottom: '10px' }}>Nueva tarjeta</h2><CardForm onAdd={onAdd} /></section>
        )}
        <section class="glass strong panel stack-s" aria-label="Vista previa">
          {parsed.errors.map((e) => <div class="err">⚠ {e}</div>)}
          {parsed.notes.length === 0 && <p class="t2">Sin tarjetas todavía.</p>}
          {parsed.notes.map((n) => <NotePreview note={n} />)}
        </section>
      </div>
      {csv && <CsvImport onClose={() => setCsv(false)} onAdd={async (blocks) => { for (const b of blocks) await appendCard(app.vault, props.path, b, app.col); setText(await readTextOr(app.vault, props.path, '')); dirty.current = true; app.toast(`${blocks.length} tarjetas importadas`); }} />}
    </>
  );
}

/** Importar CSV/TSV con asistente de mapeo y vista previa renderizada con errores marcados. */
function CsvImport(props: { onClose: () => void; onAdd: (blocks: string[]) => Promise<void> }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [m, setM] = useState(guessMapping([]));
  const cols = rows?.[0]?.map((h, i) => [i, m.header ? h : `Columna ${i + 1}`] as const) ?? [];
  const blocks = rows ? rowsToBlocks(rows, m) : [];
  const sel = (k: 'front' | 'back' | 'type' | 'tags' | 'image', label: string, optional = false) => (
    <label class="field">{label}
      <select value={m[k]} onChange={(e) => setM({ ...m, [k]: Number((e.target as HTMLSelectElement).value) })}>
        {optional && <option value={-1}>—</option>}
        {cols.map(([i, h]) => <option value={i}>{h}</option>)}
      </select>
    </label>
  );
  return (
    <Sheet title="Importar CSV / TSV" onClose={props.onClose} wide>
      <div class="stack">
        <input type="file" accept=".csv,.tsv,.txt,text/csv" onChange={async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; const r = parseCSV(await f.text()); setRows(r); setM(guessMapping(r)); }} />
        {rows && (
          <>
            <div class="row wrap">{sel('front', 'Pregunta')}{sel('back', 'Respuesta', true)}{sel('type', 'Tipo', true)}{sel('tags', 'Etiquetas', true)}{sel('image', 'Imagen', true)}
              <label class="row"><input type="checkbox" checked={m.header} onChange={(e) => setM({ ...m, header: (e.target as HTMLInputElement).checked })} /> Primera fila es encabezado</label>
            </div>
            <p>{blocks.length} filas · {blocks.filter((b) => b.error).length} con errores (se omiten)</p>
            <div class="stack-s" style={{ maxHeight: '45dvh', overflow: 'auto' }}>
              {blocks.slice(0, 200).map((b) => { const n = parseDeck(b.block + ' ^vista').notes[0]; return b.error || !n ? <div class="err">⚠ {b.error ?? 'Fila no válida'}: {b.block.slice(0, 80)}</div> : <NotePreview note={n} />; })}
            </div>
            <button type="button" class="btn primary" onClick={async () => { await props.onAdd(blocks.filter((b) => !b.error).map((b) => b.block)); props.onClose(); }}>Importar {blocks.filter((b) => !b.error).length} tarjetas</button>
          </>
        )}
      </div>
    </Sheet>
  );
}
