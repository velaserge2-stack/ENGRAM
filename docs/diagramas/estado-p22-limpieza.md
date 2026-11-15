# P22 · Limpieza de src/diagrams (ola 7)
Alcance: diff de `fix-diagramas` frente a `main` en `src/`. Sin cambios de comportamiento ni de formato.

- `src/diagrams/edit.ts` (461 → 460): quitada la variable `m` sin uso en `case 'label'` (única advertencia de `noUnusedLocals`).
- `src/diagrams/gestures.ts` (212 → 209): quitado `zoomBy`, sin referencias (lo reemplaza `zoomBy4` en `inline.ts`).
- `src/diagrams/diagram.css` (251 → 248): quitado el comentario huérfano de `.diag-edge/.diag-head/.diag-handle` y la nota sobre «reglas viejas»; las reglas `.diag-handle*` actuales las usa `handles.tsx`.
- Revisados sin hallazgos: `console.*`, `TODO`, `any`, parámetros sin uso, clases CSS (`diag-c*`, `diag-bd-*`, `diag-w*` son dinámicas), exports solo internos (inocuos, se dejan).
- Se conservan escritura segura, límites, `aria-*` e i18n.

Fragmentos gzip (antes → después; ver y exportar sin cambio de tamaño):
- ver (diagram view/canvas): c-Lf0MLQEI 2 223 → 2 223
- editar: c-izCT0Xbn 19 729 → 19 725
- exportar (PNG/SVG): c-kwcPYp6z 38 771 → 38 772
- export-pdf: c-FAaCqgLU 178 047 → 178 047
Verificación: tsc, vitest (771), build en verde; e2e:diagramas en verde (una ejecución falló en «Ctrl/⌘+Shift+Z rehace Ordenar»: intermitente, pasó en las dos siguientes).
