# Diagramas · revisión de seguridad

Método: lectura de `src/diagrams/*`, `src/notes/diagramtype.ts`, `DiagramSlot`/`DiagramEmbedBlock` (`src/screens/notes.tsx:486-540`) y `src/notes/find.tsx`, más pruebas en `tests/diagrams-seguridad.test.ts` (todas pasan: no hay hallazgo grave que reproducir).

| # | Punto | Resultado | Archivo:línea | Severidad |
|---|-------|-----------|---------------|-----------|
| 1 | Texto de nodo/etiqueta al DOM como HTML | PASA: solo nodos de Preact (`inline`), sin `innerHTML`/`dangerouslySetInnerHTML`/`href`/`src` con datos del usuario; `data-wiki` es atributo inerte (nada lo lee) | `view.tsx:21-35,77,96`, `canvas.tsx:298` | ninguno |
| 2 | SVG exportado | PASA: `esc()` en todo texto y en `d`; sin `<script>`, `href` ni `on…=`; solo 9 etiquetas fijas; prueba con carga `<img onerror>`/`<script>` | `export.ts:9,56-86` | ninguno |
| 3 | Nombre del embed `![[…]]` como ruta/selector | PASA: el nombre solo se compara con títulos/rutas del listado de la bóveda; nunca se concatena a una ruta ni a un selector (`../`, `\0`, `/etc` → «missing») | `embed.ts:17-27`, `notes.tsx:544-547` | ninguno |
| 4 | Clases/estilos con datos del usuario | PASA: `class` sale de tablas fijas; `style` solo números redondeados (`Math.round`); ids `nN`/`eN` generados, por eso los `querySelector` con `data-id`/`data-path` no son inyectables | `canvas.tsx:118,194,291-297`, `view.tsx:70-77` | ninguno |
| 5 | Lectura fuera de la bóveda | PASA: el embed lee `noteStore.load(path)` con `path` del listado `notes/`, y `go('notas', …)` con esa misma ruta; el texto del diagrama nunca produce rutas | `notes.tsx:520-533` | ninguno |
| 6a | DoS: sangría de 10 000 niveles / 20 000 espacios | PASA: línea > `MAX_LINE` (1000) o sin padre = error de línea; <2 s | `parse.ts:128,150-153` | ninguno |
| 6b | DoS: línea de 1 MB, 500 `[[` sin cierre, 120 flechas, 50 000 líneas/aristas, ciclo de 300 nodos | PASA: todas <2 s (prueba con tope de 2 s) | `parse.ts:128`, `layout.ts:208` | ninguno |
| 6c | Coordenadas `{x=999…,y=…}` sin tope (`\d+`): un diagrama con `x=10^300` da un lienzo/SVG gigante (no ejecuta ni cuelga el parser; la PNG falla y avisa) | HALLAZGO leve | `parse.ts:27` (regex `-?\d+`), `layout.ts:46` (`hasPos` solo exige finito) | leve |
| 7 | `find.tsx` | PASA: recorre nodos de texto y pinta rangos (Highlight API); no inserta HTML | `find.tsx:17-45` | ninguno |

Resumen: 8 PASA, 1 hallazgo leve (6c), 0 medios, 0 graves. `src/` no se tocó.
Sugerencia para 6c (una línea): limitar `x`/`y` a ±100 000 en `stripSuffixes` o en `hasPos`.
