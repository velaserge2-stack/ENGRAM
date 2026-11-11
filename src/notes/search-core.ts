/**
 * Núcleo del índice de notas: mismo código en el Worker y, si no hay Worker, en el hilo
 * principal. El índice es una caché: se reconstruye entero desde los archivos (`reset`).
 */
import { createIndex, findHits, snippet, type SearchDoc } from './search';

export interface Filters { materia?: string; tema?: string; since?: number }
export interface Result { id: string; title: string; materia: string; tema: string; fecha: string; score: number; hits: number; parts: { t: string; hit: boolean }[] }

export function searchCore() {
  let ix = createIndex();
  const docs = new Map<string, SearchDoc>();
  return {
    reset(all: SearchDoc[]) {
      ix = createIndex();
      docs.clear();
      for (const d of all) docs.set(d.id, d);
      ix.addAll(all);
    },
    upsert(d: SearchDoc) {
      if (docs.has(d.id)) ix.discard(d.id);
      docs.set(d.id, d);
      ix.add(d);
    },
    remove(id: string) {
      if (docs.has(id)) (ix.discard(id), docs.delete(id));
    },
    query(q: string, f: Filters = {}, limit = 50): Result[] {
      if (!q.trim()) return [];
      const out: Result[] = [];
      for (const r of ix.search(q)) {
        const d = docs.get(r.id);
        if (!d) continue;
        if (f.materia && d.materia !== f.materia) continue;
        if (f.tema && d.tema !== f.tema) continue;
        if (f.since && !(d.fecha && Date.parse(d.fecha) >= f.since)) continue;
        const hits = findHits(d.body, q);
        // un número exacto que solo coincidía como prefijo no cuenta
        if (!hits.length && !findHits(d.title, q).length) continue;
        out.push({ id: d.id, title: d.title, materia: d.materia, tema: d.tema, fecha: d.fecha, score: r.score, hits: hits.length, parts: snippet(d.body, hits).parts });
        if (out.length >= limit) break;
      }
      return out;
    },
  };
}
