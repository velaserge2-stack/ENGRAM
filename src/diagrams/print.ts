// Imprimir / PDF de una nota normal con diagramas (P22 · integración): antes de imprimir, cada vista montada
// (`.diag-host`) recibe al lado una imagen SVG con la MISMA medición que «Exportar» (completa, sin el marco de 320 px)
// y el CSS de impresión oculta la vista. Síncrona (`beforeprint` no espera): quien la usa precarga este módulo.
import { parseDiagram, readBackdrop } from './parse';
import { diagramToSvg, exportLayout } from './export';
import type { Backdrop, DiagramKind } from './types';

const KINDS: readonly string[] = ['mapa', 'flujo', 'diagrama'];

export function printDiagrams(root: ParentNode = document): void {
  for (const host of Array.from(root.querySelectorAll<HTMLElement>('.diag-host[data-mounted]'))) {
    const kind = host.dataset.kind ?? '';
    if (!KINDS.includes(kind) || host.classList.contains('diag-printed')) continue;
    try {
      const text = host.dataset.src ?? '';
      const { doc, tooBig } = parseDiagram(text, kind as DiagramKind);
      if (tooBig || !doc.nodes.length) continue;
      let bd: Backdrop = readBackdrop(text, host.dataset.backdrop);
      if (bd === 'oscuro') bd = 'claro'; // el papel siempre es claro
      const { layout, measured } = exportLayout(doc, {});
      const svg = diagramToSvg(doc, layout, measured, { backdrop: bd });
      const img = document.createElement('img');
      img.className = 'diag-print';
      img.alt = '';
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      host.after(img);
      host.classList.add('diag-printed');
    } catch { /* si falla, se imprime la vista tal cual */ }
  }
}

export function unprintDiagrams(root: ParentNode = document): void {
  root.querySelectorAll('img.diag-print').forEach((x) => x.remove());
  root.querySelectorAll('.diag-printed').forEach((x) => x.classList.remove('diag-printed'));
}
