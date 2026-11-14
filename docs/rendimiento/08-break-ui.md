# Fase 8 · break-ui con datos hostiles

**Entorno:** Chromium de Playwright (`chromium.launch()` sin opciones; no hay WebKit en el contenedor), compilación de `rendimiento-2`. iPad 1180×820 y teléfono 390×844. Script: `e2e/break-ui.mjs` (capturas en `e2e/out/break-ui/`, no va a git).

**Datos:** un zip de 517 archivos importado por Mazos → «Importar archivo» sobre la bóveda de ejemplo: mazos y materias/temas/notas con nombres de 210 caracteres sin espacios, de una letra (`X`, `Q`, `Z`, `a`), árabe, japonés, emoji y mezcla RTL; mazo `Grande 20000` (20 000 tarjetas `Q::`/`A::`); `Nota 5 MB` y `Nota 1 MB` (`big-notes.zip`); 500 notas de `files500.zip`. Importación: ~6 s. Abrir el mazo grande 1.5 s; abrir la nota de 5 MB 6 s (< 10 s). 0 errores de consola; ninguna tarea > 10 s.

## Hallazgos
| Pantalla | Hallazgo | Sev. | Estado |
|---|---|---|---|
| Hoy y Mazos (iPad) | Un nombre de mazo largo ensanchaba la tabla: scroll horizontal de 1932 px (en teléfono ya truncaba) | Roto | Arreglado (`.decks .name a { max-width: 28rem }`) |
| Notas (iPad) | La lista «Todo» ensanchaba la página 914 px: el `<select>` de materias crecía hasta su opción más larga | Roto | Arreglado (`select { max-width: 100% }`) |
| Notas, árbol | Nombre de materia (`<b>`) y de tema salían del panel sin elipsis | Feo | Arreglado (elipsis en `.tree button.ti > b`; el tema va en `<span class="ellipsis">`) |
| Notas, lista | La fecha `2026-11-01` se partía en 4 líneas al lado de un título largo | Feo | Arreglado (`.kv .v` nowrap, igual que en teléfono) |
| Importar | Un segmento de ruta > 255 caracteres tras `encodeURIComponent` (nombre árabe de ~60 letras) se omite con «ruta no permitida»; el motivo real es la longitud, y el resumen final dice «0 omitidos» | Frágil | Sin arreglar: es texto en 3 idiomas y decisión de producto |
| Notas, lista (RTL) | Con título RTL la elipsis recorta por el lado equivocado (se ve «…ز القلبي») | Feo | Sin arreglar: requiere `dir="auto"`/`bdi` en contenido de usuario, no es CSS de una línea |
| Hoy (teléfono) | Filas de mazo de 21 px de alto como enlaces (< 44 px); `Luego`/`Respaldar` 36 px | Frágil | Ya existen con la bóveda de ejemplo; sin tocar |
| Calendario, Estadísticas, Ajustes, Explorar | Sin desbordes ni textos cortados. Explorar con 20 000 tarjetas usa la tabla con scroll propio (a propósito) | — | — |

La barra superior (40 px de alto) y los controles de la bóveda de ejemplo salen en la auditoría de 44 px, pero no son nuevos.

## Verificación
`npm run typecheck` y `npx vitest run` (58 archivos, 476 pruebas) en verde. `MODE=compare npm run e2e:phone` contra una línea base nueva de `origin/main` (d060e6a): **0 píxeles en las 36 capturas, dos corridas seguidas**. La diferencia de 418 762 px en `1024×768 addons` que vio la primera comparación venía de una línea base vieja, no de estos cambios.
