// Único punto de carga bajo demanda de la vista de diagramas (CONTRATO §6): se importa con `import()` desde
// el render de nota solo si el HTML contiene `diag-host`. Nadie más importa este módulo ni `view.tsx`.
import { h, render } from 'preact';
import { DiagramView } from './view';
import type { DiagramKind } from './types';

const KINDS: readonly string[] = ['mapa', 'flujo', 'diagrama'];

/** Monta `DiagramView` en cada `.diag-host` (`data-kind`, `data-src`). Devuelve una función que los desmonta. */
export function mountDiagrams(root: HTMLElement): () => void {
  // el propio contenedor puede ser el host (DiagramSlot lo pasa así): antes solo se buscaban descendientes
  const hosts = root.matches('.diag-host') ? [root] : Array.from(root.querySelectorAll<HTMLElement>('.diag-host'));
  const done: HTMLElement[] = [];
  for (const host of hosts) {
    if (host.dataset.mounted) continue;
    const kind = host.dataset.kind ?? '';
    if (!KINDS.includes(kind)) continue; // tipo desconocido: se queda el texto (`<pre><code>`)
    const text = host.dataset.src ?? host.textContent ?? '';
    host.dataset.mounted = '1';
    host.textContent = '';
    render(h(DiagramView, { text, kind: kind as DiagramKind }), host);
    done.push(host);
  }
  return () => { for (const host of done) { render(null, host); delete host.dataset.mounted; } };
}
