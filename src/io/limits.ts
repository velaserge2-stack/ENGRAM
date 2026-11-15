/** Límites para archivos importados (no confiables, SPEC §12). */
export const LIMITS = {
  maxFiles: 20_000,
  maxFileBytes: 200 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxDepth: 12,
  /** Razón de compresión sospechosa por archivo (bomba zip). */
  maxRatio: 200,
  /** Tope de salida al descomprimir zstd (colección y medios de Anki): protege de bombas de descompresión. */
  maxUnzstdBytes: 1024 * 1024 * 1024,
  /** Tope de notas en un paquete de Anki. */
  maxApkgNotes: 300_000,
  /** Paquete de Anki (se lee por trozos, no entero): tamaño del archivo, de cada entrada y total declarado. */
  maxApkgBytes: 4 * 1024 * 1024 * 1024,
  maxApkgEntryBytes: 300 * 1024 * 1024,
  maxApkgTotalBytes: 4 * 1024 * 1024 * 1024,
};
export type Limits = typeof LIMITS;
