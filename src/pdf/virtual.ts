/**
 * Virtualización del visor de PDF (Prompt 11 · Fase 3). Puro, para probarlo.
 *
 * - Heights: alto de cada página a partir de su proporción (alto/ancho). Se estima con la de la
 *   primera página y se corrige al medir cada una; sumas por bloques para ubicar una página o
 *   saber cuál está en una posición sin recorrer todas (O(log n) por consulta).
 * - visibleRange: qué páginas montar (las visibles ± `overscan`).
 * - RenderQueue: como mucho `limit` renders a la vez, primero el de mayor prioridad (el más
 *   cercano a la página central); los que ya no hacen falta se cancelan.
 * - fitPixels: presupuesto global de píxeles de lienzo además del tope por página.
 */
export class Heights {
  private ratios: Float64Array;
  private pre: Float64Array | null = null;
  private w = -1;
  constructor(public readonly n: number, ratio: number, exceptions: Record<number, number> = {}, public readonly gap = 10) {
    this.ratios = new Float64Array(n).fill(ratio > 0 ? ratio : 1.414);
    for (const [k, r] of Object.entries(exceptions)) if (Number(k) >= 1 && Number(k) <= n && r > 0) this.ratios[Number(k) - 1] = r;
  }
  ratio(page: number) { return this.ratios[page - 1] ?? 1.414; }
  /** Corrige la proporción medida de una página; devuelve el cambio de alto (px) al ancho dado. */
  set(page: number, ratio: number, width: number): number {
    const old = this.ratio(page);
    if (!(ratio > 0) || Math.abs(old - ratio) < 1e-4) return 0;
    this.ratios[page - 1] = ratio;
    this.pre = null;
    return (ratio - old) * width;
  }
  /** Excepciones respecto a `base` (para guardar en el meta del PDF). */
  exceptions(base: number): Record<number, number> {
    const out: Record<number, number> = {};
    this.ratios.forEach((r, i) => { if (Math.abs(r - base) > 1e-3) out[i + 1] = +r.toFixed(4); });
    return out;
  }
  private prefix(width: number) {
    if (this.pre && this.w === width) return this.pre;
    const p = new Float64Array(this.n + 1);
    for (let i = 0; i < this.n; i++) p[i + 1] = p[i]! + this.ratios[i]! * width + this.gap;
    this.w = width;
    return (this.pre = p);
  }
  /** Alto del hueco de una página (página + separación). */
  slot(page: number, width: number) { return this.ratio(page) * width + this.gap; }
  top(page: number, width: number) { return this.prefix(width)[page - 1] ?? 0; }
  total(width: number) { return this.prefix(width)[this.n] ?? 0; }
  /** Página (1…n) que ocupa la posición `y`. */
  pageAt(y: number, width: number): number {
    const p = this.prefix(width);
    let lo = 1, hi = this.n;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (p[mid - 1]! <= y) lo = mid; else hi = mid - 1;
    }
    return Math.max(1, Math.min(this.n, lo));
  }
}

export function visibleRange(h: Heights, width: number, scrollTop: number, viewH: number, overscan = 2): { from: number; to: number; center: number } {
  const first = h.pageAt(Math.max(0, scrollTop), width);
  const last = h.pageAt(scrollTop + viewH, width);
  const center = h.pageAt(scrollTop + viewH / 2, width);
  return { from: Math.max(1, first - overscan), to: Math.min(h.n, last + overscan), center };
}

type Job = { id: string; prio: number; run: (signal: AbortSignal) => Promise<void>; ac: AbortController };
export class RenderQueue {
  private waiting: Job[] = [];
  private active = new Map<string, Job>();
  constructor(public limit = 2) {}
  get running() { return this.active.size; }
  get pending() { return this.waiting.length; }
  /** Encola (o reprioriza si ya está esperando). Menor `prio` = antes. */
  add(id: string, prio: number, run: (signal: AbortSignal) => Promise<void>) {
    if (this.active.has(id)) return;
    const w = this.waiting.find((j) => j.id === id);
    if (w) return void ((w.prio = prio), (w.run = run));
    this.waiting.push({ id, prio, run, ac: new AbortController() });
    this.pump();
  }
  cancel(id: string) {
    this.waiting = this.waiting.filter((j) => j.id !== id);
    this.active.get(id)?.ac.abort();
  }
  reprioritize(prio: (id: string) => number) {
    for (const j of this.waiting) j.prio = prio(j.id);
  }
  private pump() {
    while (this.active.size < this.limit && this.waiting.length) {
      this.waiting.sort((a, b) => a.prio - b.prio);
      const j = this.waiting.shift()!;
      this.active.set(j.id, j);
      void j.run(j.ac.signal).catch(() => {}).finally(() => { this.active.delete(j.id); this.pump(); });
    }
  }
}

/** Píxeles permitidos para un lienzo nuevo: tope por página y presupuesto global (las no enfocadas bajan). */
export function fitPixels(desired: number, used: number, budget: number, perPage: number, focused: boolean): number {
  const want = Math.min(desired, perPage);
  if (focused) return want;
  const left = budget - used;
  return Math.max(Math.min(want, left), Math.min(want, budget * 0.04));
}
