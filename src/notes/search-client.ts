/**
 * Índice de búsqueda de notas en un Worker (D11). Si no hay Worker (o falla), el mismo núcleo
 * corre en el hilo principal. Se reconstruye desde los archivos al abrir Notas y se actualiza
 * de forma incremental al guardar cada nota.
 */
import { parseFrontmatter } from '../lib/frontmatter';
import { noteMeta } from './model';
import type { SearchDoc } from './search';
import { type Filters, type Result, searchCore } from './search-core';

type Op = 'reset' | 'upsert' | 'remove' | 'query';
let worker: Worker | null = null;
let local: ReturnType<typeof searchCore> | null = null;
let seq = 0;
const pending = new Map<number, (v: unknown) => void>();
/** Copia de lo indexado (para repoblar el índice local si el Worker muere). */
const mirror = new Map<string, SearchDoc>();

function call<T>(op: Op, arg: unknown, f?: Filters): Promise<T> {
  if (!worker && !local && typeof Worker !== 'undefined') {
    try {
      worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; res: unknown }>) => { pending.get(e.data.id)?.(e.data.ok ? e.data.res : undefined); pending.delete(e.data.id); };
      worker.onerror = () => {
        // el Worker murió: lo pendiente se resuelve (si no, quien espera queda colgado: runNoteMove)
        // y el índice local se repuebla con la copia de lo indexado
        worker?.terminate();
        worker = null;
        for (const res of pending.values()) res(undefined);
        pending.clear();
        local = searchCore();
        local.reset([...mirror.values()]);
      };
    } catch {
      worker = null;
    }
  }
  if (!worker) {
    local ??= searchCore();
    return Promise.resolve((op === 'query' ? local.query(arg as string, f) : (local[op] as (a: unknown) => void)(arg)) as T);
  }
  const id = ++seq;
  return new Promise<T>((res) => { pending.set(id, res as (v: unknown) => void); worker!.postMessage({ id, op, arg, f }); });
}

function toSearchDoc(path: string, text: string): SearchDoc {
  const m = noteMeta(path);
  const doc = parseFrontmatter(text);
  // los dibujos no se indexan (solo su referencia); su miniatura sale en los resultados
  return { id: path, title: m.title, body: doc.body.replace(/!\[\[dibujo-[\w-]+\.png\]\]/g, ' '), thumb: /!\[\[(dibujo-[\w-]+\.png)\]\]/.exec(doc.body)?.[1] ?? '', materia: m.materia, tema: m.tema, fecha: typeof doc.data.fecha === 'string' ? doc.data.fecha : '' };
}

const same = (a: SearchDoc | undefined, b: SearchDoc) => !!a && a.body === b.body && a.title === b.title && a.materia === b.materia && a.tema === b.tema && a.fecha === b.fecha && a.thumb === b.thumb;

export const notesIndex = {
  reset: (texts: Map<string, string>) => {
    const docs = [...texts].map(([p, t]) => toSearchDoc(p, t));
    // Prompt 21 · 5: volver a Notas sin cambios no reconstruye el índice (0.8 s en L); si algo cambió, se
    // reconstruye entero como siempre (mismas respuestas que antes; lo de cada guardado ya va por `upsert`)
    if (docs.length === mirror.size && docs.every((d) => same(mirror.get(d.id), d))) return Promise.resolve();
    mirror.clear();
    for (const d of docs) mirror.set(d.id, d);
    return call<void>('reset', docs);
  },
  upsert: (path: string, text: string) => { const d = toSearchDoc(path, text); mirror.set(path, d); return call<void>('upsert', d); },
  remove: (path: string) => { mirror.delete(path); return call<void>('remove', path); },
  query: (q: string, f: Filters = {}) => call<Result[]>('query', q, f),
};
