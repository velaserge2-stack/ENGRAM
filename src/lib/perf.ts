/**
 * Contadores de rendimiento (Prompt 11). Siempre activos (son solo sumas); con `?perf` en la
 * URL se muestran en pantalla. Las pruebas los leen en `window.__perf`.
 * En WebKit no hay `performance.memory`: estos contadores son el sustituto.
 */
export const perf = {
  on: typeof location !== 'undefined' && /[?&]perf\b/.test(location.search + location.hash),
  c: {} as Record<string, number>,
  inc(k: string, n = 1) { perf.c[k] = (perf.c[k] ?? 0) + n; },
  reset() { perf.c = {}; },
};
if (typeof window !== 'undefined') (window as unknown as { __perf: typeof perf }).__perf = perf;

/** Cuenta las llamadas a getPage de un documento de pdf.js (para medir cuántas páginas se piden al abrir). */
export function countGetPage<T extends { getPage(n: number): Promise<unknown> }>(doc: T): T {
  const orig = doc.getPage.bind(doc);
  (doc as { getPage(n: number): Promise<unknown> }).getPage = (n: number) => (perf.inc('getPage'), orig(n));
  return doc;
}
