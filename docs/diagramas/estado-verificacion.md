# Estado · verificación en navegador (Chromium; WebKit no existe en el contenedor)

Base: `a805808` (rendimiento-2 + diagramas). Capturas en `e2e/out/diagramas/` (no van a git).

1. **Build + vista en navegador: FALLA.** `npm run build` pasa, pero la vista de diagrama sale VACÍA en la
   interfaz real (mapa y flujo, teléfono 390×844 e iPad 1180×820): `.diag-host` queda sin hijos y el texto
   de reserva desaparece. Causa: `DiagramSlot` (`src/screens/notes.tsx`) llama `mountDiagrams(el)` con el propio
   `.diag-host`, y `mountDiagrams` (`src/diagrams/mount.ts`) solo busca `root.querySelectorAll('.diag-host')`
   (descendientes), así que no encuentra nada. Arreglo de una línea (no aplicado, `src/` intacto):
   `const hosts = root.matches('.diag-host') ? [root] : Array.from(root.querySelectorAll(...))`.
   Con ese arreglo en una compilación temporal (fuera de `dist`) se midió el resto:
   - Vista visible en 8/8 casos (2 tipos × 2 tamaños × claro/oscuro); texto plano de nodos presente
     («Mapa prueba», «Idea 1», «Idea 2» / «Inicio», «Paso», «Fin»); 0 errores de consola.
   - Sin desbordamiento horizontal: scrollWidth = innerWidth (390 y 1180) en los 8 casos.
   - Objetivos táctiles: alto mínimo de nodo 44 px; controles interactivos del mapa 101×44 y 66×44.
2. **Contraste: PASA (con el arreglo).** Texto de nodos vs. fondo compuesto (peor caso sobre negro, blanco y
   fondo del cuerpo): claro 10.06:1, oscuro 10.31:1 (mínimo 4.5:1).
3. **0 píxeles fuera de lo nuevo: PASA.** Línea base `origin/main` (`d060e6a`), 36 capturas. Primera pasada:
   1 diferencia (1366×768 `addons`, 418 756 px, sombreado de vidrio de las tarjetas plegadas; sin ruido
   en las otras 35). Segunda pasada: 0 px en las 36. Hay que tratar esa captura como intermitente.
4. **Carga bajo demanda: PASA.** En una nota normal (sin Service Worker) no se pide el chunk de diagramas
   (`c-B4pncXXO.js`, 16.9 kB, ni `mount-C9kaO6kE.css`); sí se piden al crear una nota de mapa. Los nombres
   de archivo son hash (`c-*.js`), por lo que buscar «diagrams» en el nombre no sirve: se identificó por contenido.
   Con el Service Worker activo ambos se precargan (`sw.js` los lista): es caché, no render.

## NO se probó
- WebKit/Safari, iPad/iPhone reales, Apple Pencil. Edición del diagrama (solo lectura).
- Contraste de las etiquetas de arista y modo «alto contraste»/acento.
