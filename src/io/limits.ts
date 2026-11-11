/** Límites para archivos importados (no confiables, SPEC §12). */
export const LIMITS = {
  maxFiles: 20_000,
  maxFileBytes: 200 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxDepth: 12,
  /** Razón de compresión sospechosa por archivo (bomba zip). */
  maxRatio: 200,
};
export type Limits = typeof LIMITS;
