/** «Exportar Anki» con FSRS: un solo .zip con el .apkg, un CSV de consulta y un LEEME (puro; solo File/Blob). */
import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { safeSegment } from '../../notes/model';
import type { LogEntry } from '../../srs/engine';

export const containsFsrs = (o: { history: boolean; revlog: number; sched: { size: number } }) => o.history && (o.revlog > 0 || o.sched.size > 0);

const STATES = ['nueva', 'aprendiendo', 'repaso', 'reaprendiendo'];
const p2 = (n: number) => String(n).padStart(2, '0');
const iso = (ts: number) => { const d = new Date(ts); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
const q = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Repasos de las tarjetas exportadas, sin los deshechos (misma regla que sched.ts). Solo consulta. */
export function historyCsv(log: LogEntry[], exported: Set<string>): string {
  const undone = new Set(log.filter((e) => e.op === 'undo').map((e) => `${e.id}@${e.ref}`));
  const rows = log
    .map((e, i) => [e, i] as const)
    .filter(([e]) => e.rating && !e.op && exported.has(e.id) && !undone.has(`${e.id}@${e.ts}`))
    .sort((a, b) => a[0].ts - b[0].ts || a[1] - b[1])
    .map(([e]) => [q(e.id), iso(e.ts), e.rating, e.state === undefined ? '' : STATES[e.state] ?? '', Math.round((e.ms ?? 0) / 1000)].join(','));
  return ['tarjeta,fecha,calificacion,estado,duracion_s', ...rows].join('\n') + '\n';
}

export async function bundleZip(o: { apkg: Uint8Array | Blob; baseName: string; historyCsv: string; readme: string }): Promise<Blob> {
  const base = safeSegment(o.baseName) || 'Engrama';
  const apkg = o.apkg instanceof Blob ? new Uint8Array(await o.apkg.arrayBuffer()) : o.apkg;
  const mtime = new Date(2000, 0, 1); // fijo: el zip es determinista
  const chunks: Uint8Array[] = [];
  await new Promise<void>((res, rej) => {
    const z = new Zip((err, chunk, final) => { if (err) return rej(err); chunks.push(chunk); if (final) res(); });
    const add = (data: Uint8Array, f: ZipPassThrough | ZipDeflate) => { z.add(f); f.push(data, true); };
    add(apkg, Object.assign(new ZipPassThrough(`${base}.apkg`), { mtime }));
    add(strToU8(o.historyCsv), Object.assign(new ZipDeflate('historial-repasos.csv', { level: 6 }), { mtime }));
    add(strToU8(o.readme), Object.assign(new ZipDeflate('LEEME.txt', { level: 6 }), { mtime }));
    z.end();
  });
  return new Blob(chunks as BlobPart[], { type: 'application/zip' });
}
