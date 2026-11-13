/**
 * Abrir un PDF sin cargarlo entero (Prompt 11 · Fase 2). pdf.js pide rangos de bytes a un
 * transporte propio (`PDFDataRangeTransport`) que los lee del `File` con `slice()`; con
 * `disableAutoFetch` solo se leen las partes que hacen falta para lo que se muestra.
 * No se usa una URL `blob:` con fetch: el CSP (`connect-src 'self'`) la bloquea y no se relaja.
 * Si el backend no da un `File` (memoria), se construye uno con los bytes (ruta de respaldo).
 */
import { pdfjs } from '../io/extract';
import { countGetPage, perf } from '../lib/perf';

type PdfLib = Awaited<ReturnType<typeof pdfjs>>;
export type PDFDoc = Awaited<ReturnType<PdfLib['getDocument']>['promise']>;
interface FileSource { file?(path: string): Promise<File>; read(path: string): Promise<Uint8Array> }

/** Tamaño de cada rango pedido a pdf.js (bytes). */
const RANGE_CHUNK = 256 * 1024;

export async function fileOf(vault: FileSource, path: string): Promise<File> {
  if (vault.file) return vault.file(path);
  return new File([(await vault.read(path)) as BlobPart], path.split('/').pop() ?? 'doc.pdf');
}

/** Abre por rangos. `destroy()` libera el documento y su worker. */
export async function openPdfFile(file: Blob): Promise<{ doc: PDFDoc; destroy: () => Promise<void> }> {
  const lib = await pdfjs();
  const head = new Uint8Array(await file.slice(0, Math.min(file.size, RANGE_CHUNK)).arrayBuffer());
  const transport = new lib.PDFDataRangeTransport(file.size, head);
  transport.requestDataRange = (begin: number, end: number) => {
    perf.inc('rangeReads');
    perf.inc('rangeBytes', end - begin);
    void file.slice(begin, end).arrayBuffer().then((b) => transport.onDataRange(begin, new Uint8Array(b)));
  };
  const task = lib.getDocument({ range: transport, rangeChunkSize: RANGE_CHUNK, disableAutoFetch: true, disableStream: true });
  const doc = countGetPage(await task.promise);
  return { doc, destroy: () => task.destroy() };
}
