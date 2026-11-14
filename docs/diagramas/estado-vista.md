# Estado · C · vista de diagramas

## Qué quedó
- `src/diagrams/view.tsx`: `DiagramView({ text, kind })`. Parsea y acomoda con `useMemo([text, kind])`; nodos `<div>` con transform numérico; un solo `<svg>` (conectores + marcador de flecha); texto como texto de Preact (`**`, `*`, `[[nota]]` mínimos, recorte a 200). Mapa: `role="tree"` + `treeitem` planos con `aria-level`. Flujo/diagrama: lienzo `role="img"` + lista alternativa `ul[role=list]` (fuera de vista). `tooBig`: aviso + texto, sin acomodar.
- `src/diagrams/diagram.css`: solo tokens de Cristal; sin `backdrop-filter` en nodos; `prefers-reduced-motion`; nodos ≥ 44 px.
- `src/diagrams/mount.ts`: `mountDiagrams(root)` (único `import()`), idempotente; devuelve un desmontador; tipos desconocidos conservan el `<pre><code>`.
- `tests/diagrams-view.test.ts` (happy-dom, 5 pruebas): mapa, flujo, texto sin HTML, tope de 300, mount.

## Desviaciones
- La prueba es `.ts` (no `.tsx`): `vite.config.ts` solo incluye `tests/**/*.test.ts`. E puede ampliar `include` si prefiere `.tsx`.
- `view.tsx` importa `diagram.css` (se carga con el chunk bajo demanda).
- Este worktree se creó sin los archivos sin confirmar de A/B (`parse/layout/types/serialize`, `docs/diagramas/*`); se copiaron solo para verificar y NO van en el commit.

## No se pudo probar
- Aspecto real (CSS), contraste, tamaño táctil y rendimiento: no hay navegador en esta prueba (happy-dom no calcula estilos).
- Medida de gzip del chunk; `IntersectionObserver` con altura reservada (no implementado: monta de inmediato).
- Clic en `[[nota]]`: la vista solo marca `data-wiki`; abrir la nota lo conecta E.

## Claves i18n que necesita (E)
`diag.demasiados_nodos` (aviso del tope), `diag.mapa` (aria-label del árbol), `diag.flujo` (aria-label del flujo), `diag.lista` (aria-label de la lista alternativa).

## Pendientes
- Etiquetas de arista en el punto medio entre centros (aproximado; mejor sobre el trazo).
- Plegado visible solo como «…»; sin interacción (editor, D).
- Sin tonos `{c=n}` (diferido por decisión 3).
