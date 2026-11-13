/**
 * Biblioteca de PDF (Prompt 5 · C): los originales viven intactos en `docs/`; el progreso de
 * lectura, las etiquetas y la última página van en `.app/pdfs.json` (reconstruible: si se
 * pierde, solo se pierde «por dónde iba»).
 */
import type { VaultAdapter } from '../vault/types';
import { readTextOr, walk } from '../vault/util';

export const PDF_META = '.app/pdfs.json';
export interface PdfMeta { last?: number; pages?: number; tags?: string[]; opened?: number; /** Prompt 11: proporción (alto/ancho) de la pág. 1 y las páginas que difieren */ ratio?: number; aspects?: Record<number, number> }

export async function readMeta(vault: VaultAdapter): Promise<Record<string, PdfMeta>> {
  const t = await readTextOr(vault, PDF_META, '{}'); // lectura fallida: se propaga (updatePdfMeta no debe reescribir con {})
  try { const m = JSON.parse(t) as Record<string, PdfMeta>; return m && typeof m === 'object' && !Array.isArray(m) ? m : {}; } catch { return {}; }
}

let queue: Promise<unknown> = Promise.resolve();
/** Actualiza los metadatos de un PDF (serializado para no pisar escrituras simultáneas). */
export function updatePdfMeta(vault: VaultAdapter, path: string, patch: PdfMeta): Promise<PdfMeta> {
  const run = queue.then(async () => {
    const all = await readMeta(vault);
    const next = { ...all[path], ...patch };
    if (JSON.stringify(next) !== JSON.stringify(all[path])) await vault.write(PDF_META, JSON.stringify({ ...all, [path]: next }, null, 1));
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}

export async function listPdfs(vault: VaultAdapter) {
  const meta = await readMeta(vault);
  return (await walk(vault, 'docs')).filter((f) => /\.pdf$/i.test(f.name)).map((f) => ({ path: f.path, name: f.name.replace(/\.pdf$/i, ''), folder: f.path.split('/').slice(1, -1).join('/'), size: f.size, meta: meta[f.path] ?? {} }));
}

/** Enlace a una página de un PDF (abre el visor de la sección PDFs). */
export const pdfLink = (path: string, page?: number) => `#/pdfs/ver/${path.split('/').map(encodeURIComponent).join('/')}${page ? `?p=${page}` : ''}`;
export const progress = (m: PdfMeta) => (m.pages && m.last ? Math.min(1, m.last / m.pages) : 0);
