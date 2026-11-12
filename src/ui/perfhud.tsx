/**
 * Contadores en pantalla con `?perf` (Prompt 11 · 6). Solo existe con ese parámetro: sin él,
 * no se monta nada. Lee el DOM y `perf.c` cada 500 ms; las tareas largas y los cuadros perdidos
 * con PerformanceObserver/rAF donde existen (feature detection). Sin red, sin almacenamiento.
 */
import { useEffect, useState } from 'preact/hooks';
import { t } from '../i18n';
import { perf } from '../lib/perf';
import { Portal } from './overlay';

interface Snap { pages: number; canvases: number; mp: number; panels: number; bodies: number; heap: number | null; long: number; maxLong: number; gaps: number }

function snap(long: { n: number; max: number; gaps: number }): Snap {
  const cs = [...document.querySelectorAll('canvas')];
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return {
    pages: document.querySelectorAll('.pdf-page').length,
    canvases: cs.length,
    mp: cs.reduce((s, c) => s + c.width * c.height, 0) / 1e6,
    panels: document.querySelectorAll('.canvas-plane > .win').length,
    bodies: [...document.querySelectorAll('.canvas-plane > .win .win-body')].filter((b) => b.querySelector(':scope > :not(.win-resize):not(p)')).length,
    heap: mem ? mem.usedJSHeapSize / 1048576 : null,
    long: long.n, maxLong: long.max, gaps: long.gaps,
  };
}

export function PerfHud() {
  const [s, setS] = useState<Snap | null>(null);
  const [c, setC] = useState<Record<string, number>>({});
  useEffect(() => {
    const long = { n: 0, max: 0, gaps: 0 };
    let obs: PerformanceObserver | null = null;
    if ('PerformanceObserver' in window && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) (long.n++, (long.max = Math.max(long.max, Math.round(e.duration)))); });
      obs.observe({ type: 'longtask' });
    }
    // cuadros de más de 50 ms (también en WebKit, que no tiene longtask)
    let raf = 0, prev = performance.now();
    const tick = (now: number) => { if (now - prev > 50 && document.visibilityState === 'visible') long.gaps++; prev = now; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    const id = setInterval(() => (setS(snap(long)), setC({ ...perf.c })), 500);
    return () => (clearInterval(id), cancelAnimationFrame(raf), obs?.disconnect());
  }, []);
  if (!s) return null;
  const row = (k: string, v: string | number) => <><dt>{k}</dt><dd>{v}</dd></>;
  return (
    <Portal>
      <aside class="perf-hud glass strong" aria-label={t('perf.titulo')}>
        <dl>
          {row(t('perf.paginas_pdf'), s.pages)}
          {row(t('perf.lienzos'), `${s.canvases} · ${s.mp.toFixed(1)} MP`)}
          {row('getPage', c.getPage ?? 0)}
          {row(t('perf.lecturas'), `${c.rangeReads ?? 0} · ${((c.rangeBytes ?? 0) / 1048576).toFixed(1)} MB`)}
          {row(t('perf.dibujos_pagina'), c.pageRenders ?? 0)}
          {row(t('perf.paneles'), `${s.bodies}/${s.panels}`)}
          {row(t('perf.renders_panel'), c.windowRender ?? 0)}
          {row(t('perf.tareas_largas'), s.long ? `${s.long} · ${s.maxLong} ms` : '0')}
          {row(t('perf.cuadros_lentos'), s.gaps)}
          {s.heap !== null && row(t('perf.memoria'), `${s.heap.toFixed(0)} MB`)}
        </dl>
        <button type="button" class="btn small" onClick={() => (perf.reset(), setC({}))}>{t('perf.reiniciar')}</button>
      </aside>
    </Portal>
  );
}
