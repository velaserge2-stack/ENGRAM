import { Archive, Camera, Check, FileUp, Inbox as InboxIcon, Replace, Sparkles } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { extractText } from '../io/extract';
import { parseFrontmatter, stringifyFrontmatter } from '../lib/frontmatter';
import { docxToMarkdown, pdfToMarkdown } from '../notes/io';
import { saveImage } from '../notes/images';
import { buildTree, classNoteFromPlaud, glossarySuggestions, listNotes, newNoteText, notePath, plaudGroupKey, plaudKind, type PlaudKind, replaceAll, suggestPlace } from '../notes/model';
import { go, href, useApp, useAsync } from '../state';
import { Empty, PageTitle } from '../ui/kit';
import { extname } from '../vault/paths';
import { readTextOr, walk } from '../vault/util';
import { PromptSheet } from './notes';

interface Item {
  id: string;
  title: string;
  created: number;
  kind: 'plaud' | 'foto' | 'documento' | 'nota';
  files: { name: string; kind: PlaudKind | 'doc' | 'img'; path: string; media?: string }[];
  materia: string;
  tema: string;
  draft: string;
  step: number;
}

const META = (id: string) => `inbox/${id}/meta.json`;

async function loadItems(vault: ReturnType<typeof useApp>['vault']): Promise<Item[]> {
  const ids = new Set((await walk(vault, 'inbox')).map((f) => f.path.split('/')[1]!));
  const out: Item[] = [];
  for (const id of ids) {
    try {
      out.push(JSON.parse(await readTextOr(vault, META(id), '')) as Item);
    } catch {
      out.push({ id, title: id, created: 0, kind: 'nota', files: (await walk(vault, `inbox/${id}`)).map((f) => ({ name: f.name, kind: 'otro', path: f.path })), materia: '', tema: '', draft: '', step: 0 });
    }
  }
  return out.sort((a, b) => a.created - b.created);
}

/** Recibe archivos (Plaud, fotos, PDF, DOCX, notas) y los agrupa en elementos de la bandeja. */
async function intake(vault: ReturnType<typeof useApp>['vault'], files: File[], tree: ReturnType<typeof buildTree>['tree']): Promise<number> {
  const groups = new Map<string, File[]>();
  for (const f of files) {
    const k = /\.(jpe?g|png|heic|webp)$/i.test(f.name) && !/mind ?map|mapa/i.test(f.name) ? `foto:${f.name}` : plaudGroupKey(f.name);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(f);
  }
  let n = 0;
  for (const [key, fs] of groups) {
    const id = `${Date.now().toString(36)}${(n++).toString(36)}`;
    const item: Item = { id, title: '', created: Date.now(), kind: 'nota', files: [], materia: '', tema: '', draft: '', step: 0 };
    const parts: { kind: PlaudKind; name: string; text?: string; media?: string }[] = [];
    for (const f of fs) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const ext = extname(f.name);
      const path = `inbox/${id}/${f.name.replace(/[\\/]/g, '_')}`;
      if (/^(jpe?g|png|heic|webp|gif)$/.test(ext)) {
        const media = await saveImage(vault, f, f.name);
        item.files.push({ name: f.name, kind: 'img', path: `media/${media}`, media });
        parts.push({ kind: key.startsWith('foto:') ? 'otro' : 'mapa', name: f.name, media });
        continue;
      }
      await vault.write(path, bytes);
      let kind: PlaudKind = plaudKind(f.name);
      let text: string | undefined;
      if (['md', 'txt', 'srt'].includes(ext)) text = new TextDecoder().decode(bytes);
      else if (ext === 'docx') {
        const r = await docxToMarkdown(bytes);
        for (const im of r.images) await vault.write(`media/${im.name}`, im.data);
        text = r.md;
      } else if (ext === 'pdf') {
        const r = await pdfToMarkdown(bytes);
        text = r.scanned ? '_(PDF escaneado: sin texto; queda adjunto)_' : r.md;
      } else if (ext === 'mp3' || ext === 'wav' || ext === 'm4a') {
        kind = 'audio';
      } else text = (await extractText(f.name, bytes)).text;
      if (text) kind = plaudKind(f.name, text);
      if (ext === 'pdf' || ext === 'docx') item.files.push({ name: f.name, kind: 'doc', path });
      else item.files.push({ name: f.name, kind, path });
      parts.push({ kind, name: f.name, text, media: kind === 'audio' ? f.name : undefined });
    }
    const base = fs[0]!.name.replace(/\.[^.]+$/, '').replace(/[_-]?(summary|resumen|transcript|transcripci[oó]n|mind ?map)$/i, '').trim();
    item.title = base || 'Sin título';
    const sug = suggestPlace(item.title, tree);
    item.materia = sug?.materia ?? '';
    item.tema = sug?.tema ?? '';
    const isPlaud = parts.some((p) => p.kind === 'transcripcion' || p.kind === 'audio') || (parts.length > 1 && parts.some((p) => p.kind === 'resumen'));
    if (key.startsWith('foto:')) {
      item.kind = 'foto';
      item.draft = newNoteText('', '', item.title, 'Clase').replace('## Imágenes\n', `## Imágenes\n${parts.map((p) => `![[${p.media}]]`).join('\n')}\n`);
    } else if (isPlaud) {
      item.kind = 'plaud';
      item.draft = classNoteFromPlaud(item.title, parts);
    } else {
      item.kind = item.files.some((x) => x.kind === 'doc') ? 'documento' : 'nota';
      const t = parts.map((p) => p.text ?? '').join('\n\n');
      item.draft = /^---\n/.test(t) ? t : stringifyFrontmatter({ materia: '', tema: '', fecha: new Date().toISOString().slice(0, 10), tags: [] }, `# ${item.title}\n\n${t}\n`);
    }
    await vault.write(META(id), JSON.stringify(item));
  }
  return groups.size;
}

export function Inbox() {
  const app = useApp();
  const { data } = useAsync(async () => ({ items: await loadItems(app.vault), tree: buildTree(await listNotes(app.vault)).tree }), [app.version]);
  const [cur, setCur] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const take = async (list: FileList | null) => {
    if (!list?.length || !data) return;
    setBusy(true);
    try {
      const n = await intake(app.vault, [...list], data.tree);
      app.changed();
      app.toast(`${n} ${n === 1 ? 'elemento' : 'elementos'} en la bandeja`);
    } catch (e) {
      app.toast(`No se pudo leer: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const item = data?.items.find((i) => i.id === cur) ?? null;
  return (
    <>
      <PageTitle title="Bandeja" sub="Todo lo que entra llega aquí primero. Nada se archiva sin tu confirmación.">
        <label class="btn"><Camera size={18} /> Foto<input type="file" accept="image/*" capture="environment" hidden multiple onChange={(e) => take((e.target as HTMLInputElement).files)} /></label>
        <label class="btn primary"><FileUp size={18} /> Añadir archivos<input type="file" hidden multiple accept=".md,.txt,.srt,.docx,.pdf,.mp3,.wav,.m4a,image/*" onChange={(e) => take((e.target as HTMLInputElement).files)} /></label>
      </PageTitle>
      <div class="drop glass" style={{ marginBottom: '14px' }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => (e.preventDefault(), void take(e.dataTransfer?.files ?? null))}>
        {busy ? 'Procesando…' : 'Suelta aquí archivos de Plaud (resumen, transcripción, mapa mental, audio), fotos, PDF o Word. Se agrupan por grabación.'}
      </div>
      {!data ? <p class="t2">Cargando…</p> : item ? <Process item={item} tree={data.tree} onDone={(next) => setCur(next ? data.items.find((x) => x.id !== item.id)?.id ?? null : null)} /> : data.items.length === 0 ? (
        <Empty icon={<InboxIcon size={44} />} title="Bandeja vacía">Exporta de Plaud el resumen y la transcripción (TXT, SRT, DOCX, PDF o Markdown) y suéltalos aquí. No se usa ninguna API de Plaud.</Empty>
      ) : (
        <section class="glass panel stack-s">
          {data.items.map((i) => (
            <div class="row-i">
              <div class="k"><b>{i.title}</b><small>{i.kind} · {i.files.map((f) => f.name).join(', ')}</small></div>
              <span class="chip">paso {i.step + 1}/4</span>
              <button type="button" class="btn small primary" onClick={() => setCur(i.id)}>Procesar</button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

const STEPS = ['Asignar', 'Limpiar', 'Crear tarjetas', 'Archivar'];

function Process(p: { item: Item; tree: ReturnType<typeof buildTree>['tree']; onDone: (next: boolean) => void }) {
  const app = useApp();
  const [it, setIt] = useState(p.item);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [prompt, setPrompt] = useState(false);
  const [cards, setCards] = useState(0);
  const [started] = useState(Date.now());
  useEffect(() => setIt(p.item), [p.item.id]);
  const save = async (next: Item) => {
    setIt(next);
    await app.vault.write(META(next.id), JSON.stringify(next));
  };
  const finalPath = notePath(it.materia || 'Sin materia', it.tema || 'General', it.title);
  const doc = parseFrontmatter(it.draft);
  const sugg = glossarySuggestions(doc.body, app.settings.glossary);
  const archive = async () => {
    let path = finalPath;
    for (let i = 2; await app.vault.exists(path); i++) path = notePath(it.materia, it.tema, `${it.title} (${i})`);
    let body = doc.body;
    const attach: string[] = [];
    for (const f of it.files) {
      if (f.kind === 'doc') {
        const dest = `docs/${it.materia}/${f.name}`;
        await app.vault.move(f.path, dest);
        attach.push(`- [${f.name}](#/espacios/abrir/${encodeURIComponent(dest)})`);
      } else if (f.kind === 'audio') {
        const dest = `media/${f.name}`;
        await app.vault.move(f.path, dest);
      }
    }
    if (attach.length) body = body.replace('## Fuente\n', `## Fuente\n${attach.join('\n')}\n`);
    await app.vault.write(path, stringifyFrontmatter({ ...doc.data, materia: it.materia, tema: it.tema }, body));
    await app.vault.remove(`inbox/${it.id}`);
    app.changed();
    app.toast(`Archivado en ${it.materia} › ${it.tema} (${Math.round((Date.now() - started) / 1000)} s)`);
    p.onDone(true);
    go('notas', ...path.split('/').slice(1));
  };
  const materias = p.tree.map((m) => m.materia);
  const temas = p.tree.find((m) => m.materia === it.materia)?.temas.map((t) => t.tema) ?? [];
  return (
    <section class="glass strong panel stack">
      <div class="row wrap">
        <button type="button" class="btn small" onClick={() => p.onDone(false)}>‹ Bandeja</button>
        <b class="grow">{it.title}</b>
        <div class="seg" role="list" aria-label="Pasos">{STEPS.map((s, i) => <button type="button" aria-pressed={it.step === i} onClick={() => save({ ...it, step: i })}>{i < it.step ? '✓ ' : `${i + 1}. `}{s}</button>)}</div>
      </div>
      {it.step === 0 && (
        <div class="stack">
          <label class="field">Título<input class="input" value={it.title} onInput={(e) => setIt({ ...it, title: (e.target as HTMLInputElement).value })} /></label>
          <label class="field">Materia<input class="input" list="ib-m" value={it.materia} onInput={(e) => setIt({ ...it, materia: (e.target as HTMLInputElement).value })} /><datalist id="ib-m">{materias.map((m) => <option value={m} />)}</datalist></label>
          <label class="field">Tema o clase<input class="input" list="ib-t" value={it.tema} onInput={(e) => setIt({ ...it, tema: (e.target as HTMLInputElement).value })} /><datalist id="ib-t">{temas.map((t) => <option value={t} />)}</datalist></label>
          {suggestPlace(it.title, p.tree) && <p class="foot">Sugerido por nombre: {suggestPlace(it.title, p.tree)!.materia} › {suggestPlace(it.title, p.tree)!.tema}</p>}
          <button type="button" class="btn primary" disabled={!it.materia || !it.tema || !it.title} onClick={() => save({ ...it, step: 1 })}>Siguiente: limpiar</button>
        </div>
      )}
      {it.step === 1 && (
        <div class="stack">
          {sugg.length > 0 && (
            <div class="inset stack-s" style={{ padding: '10px', borderRadius: 'var(--r-row)' }}>
              <b class="note">Glosario: posibles errores de transcripción</b>
              {sugg.slice(0, 10).map((s) => <div class="row"><span class="grow">{s.wrong} → <b>{s.right}</b> <span class="foot">×{s.count}</span></span><button type="button" class="btn small" onClick={() => save({ ...it, draft: stringifyFrontmatter(doc.data, replaceAll(doc.body, s.wrong, s.right).text) })}>Corregir</button></div>)}
            </div>
          )}
          <div class="row wrap">
            <input class="input" placeholder="Buscar" value={from} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} aria-label="Buscar" />
            <input class="input" placeholder="Reemplazar por" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} aria-label="Reemplazar por" />
            <button type="button" class="btn" disabled={!from} onClick={() => { const r = replaceAll(doc.body, from, to); void save({ ...it, draft: stringifyFrontmatter(doc.data, r.text) }); app.toast(`${r.n} reemplazos en toda la clase`); }}><Replace size={16} /> Reemplazar en toda la clase</button>
          </div>
          <textarea class="input code" style={{ minHeight: '45dvh' }} value={it.draft} onInput={(e) => setIt({ ...it, draft: (e.target as HTMLTextAreaElement).value })} onBlur={() => save(it)} aria-label="Borrador de la nota" />
          <p class="foot">Quita relleno y corrige términos. Añade términos correctos al glosario en Ajustes → Notas.</p>
          <button type="button" class="btn primary" onClick={() => save({ ...it, step: 2 })}>Siguiente: crear tarjetas</button>
        </div>
      )}
      {it.step === 2 && (
        <div class="stack">
          <p>Las tarjetas guardan su origen (<code>{finalPath}</code>) para poder verificarlas. {cards ? `${cards} aceptadas.` : ''}</p>
          <div class="row wrap">
            <button type="button" class="btn primary" onClick={() => setPrompt(true)}><Sparkles size={18} /> Copiar prompt / pegar respuesta</button>
            <button type="button" class="btn" onClick={() => app.openSheet('add')}>Añadir manualmente</button>
            <button type="button" class="btn" onClick={() => save({ ...it, step: 3 })}>Siguiente: archivar</button>
          </div>
          {prompt && <PromptSheet path={finalPath} title={it.title} body={doc.body} onClose={() => setPrompt(false)} onAccepted={(n) => setCards((c) => c + n)} />}
        </div>
      )}
      {it.step === 3 && (
        <div class="stack">
          <p>Se guardará en <b>{finalPath}</b>. {it.files.some((f) => f.kind === 'doc') ? 'Los PDF/Word van a docs/ como adjuntos.' : ''} {it.files.some((f) => f.kind === 'audio') ? 'El audio va a media/.' : ''}</p>
          <button type="button" class="btn primary" onClick={archive}><Archive size={18} /> Archivar</button>
          <a class="foot" href={href('notas')}>Tras archivar, la nota muestra cuántas tarjetas tiene y qué párrafos faltan.</a>
        </div>
      )}
      <p class="foot"><Check size={12} /> Flujo: 1) Asignar → 2) Limpiar → 3) Crear tarjetas → 4) Archivar.</p>
    </section>
  );
}
