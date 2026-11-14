# Fase 6 · Interfaz y recargas (Prompt 21-B)

Rama `rendimiento-2`. Cifras de **Chromium** en el contenedor (no hay WebKit), bóveda L.

## Cuello #2 · `app.changed()` lo recargaba todo
Antes, cualquier cambio avanzaba `app.version`: se volvían a cargar la colección (mazos + historial), la comprobación de integridad completa (≈ 2 200 lecturas) y todas las vistas.

### `app.changed('notes')` (`state.tsx`, `app.tsx`)
- `changed()` sin ámbito sigue recargándolo todo, como siempre.
- `changed('notes')` avanza solo `notesVersion`. Lo usan las operaciones que **solo** tocan `notes/` o `.app/bookmarks.json`: crear nota y nota diaria, marcar, enviar a la papelera y restaurar, y convertir una sticky en nota. Mover notas **no**, porque reescribe referencias en mazos y el calendario.
- **Todas** las vistas (25 `useAsync`/`useEffect`) escuchan `version` y `notesVersion`, así que ninguna queda más vieja que antes. Solo la colección y la comprobación de integridad esperan un cambio global. Una operación de notas no toca mazos ni historial, y la integridad solo reporta: se vuelve a comprobar en el siguiente cambio global o al pulsar «Comprobar de nuevo».

### Caché de textos también en vínculos, calendario y mover
Tres sitios leían las 2 000 notas en cada recarga: el índice de vínculos (`buildLinkIndex`, solo para el `id:` del frontmatter), las tareas con fecha del Calendario y la reescritura de referencias al mover notas. Ahora usan la caché por firma de la fase 5 (`noteTexts`). Mover lo hace con **lectura estricta**: un fallo de lectura aborta el movimiento en lugar de tomarse por vacío. Lo movido o reescrito dentro del lote tiene otra ruta u otra fecha, así que no casa con la caché y se lee del lote.

### Medición
Traza propia (`?perf`, cuenta los `read`/`list` que la página manda al Worker de OPFS durante 12 s) sobre una copia de la bóveda L, 3 corridas en la de mover.

| Escenario | Antes | Después |
|---|---|---|
| «Marcar» una nota con Notas abierta | 2 406 operaciones (integridad completa + colección) | **85** (solo listados; 0 lecturas) |
| Abrir el Calendario tras pasar por Notas | 4 170 operaciones | 2 170 (vínculos) → **170** (tareas): **−96 %** |
| Mover 100 notas con Notas abierta | 6.6 s · 2 202 lecturas | **2.6 s (−61 %)** · 302 lecturas |

Mover 100 notas en L queda en **−77 % contra `main`** (11.3 s); el objetivo era < 2 s.

**Cómo se midió y una trampa encontrada**: reutilizar una bóveda sembrada por otra compilación no sirve tal cual. `vite preview` ignora `--outDir` (sirve siempre `dist/`), y el perfil copiado trae el service worker y la caché HTTP con la app de cuando se sembró. La traza copia cada compilación a `dist/` y borra `Service Worker`, `Cache` y `Code Cache` de la copia del perfil, y comprueba qué `index-*.js` corre. Las cifras de las fases 3–5 no se ven afectadas: cada commit sembró su propia bóveda con su propia compilación. El perfil de la fase 1 (`e2e/rendimiento-perfil.mjs` con `DIST=`) sí tiene ese defecto; queda anotado.

## Descartado o pendiente
- **Virtualizar listas**: la fase 1 midió el árbol de notas en ~140 ms con 2 000 notas, Mazos en 103 ms y Explorar con tope de 400 filas. No es cuello: no se hizo.
- **Estudio p95 ≤ 100 ms** (resuelto en la medición, sin cambio de código; `b1b3698`). Un perfil de CPU de 15 respuestas en L muestra el hilo principal **ocioso** 3.3 s de 3.8 s: elegir de la cola cuesta ~4 ms por respuesta y `appendLog` ~22 ms (menos de un fotograma). Los ~180 ms de `estudio-responder-siguiente` eran sobre todo del **método**: Playwright espera que el botón esté «estable», sondea `waitFor` y hace viajes por CDP (~85 ms; por eso «Mostrar respuesta», que no lee ni escribe, ya daba ~86 ms). El banco ahora mide también **dentro de la página**, del `timeStamp` del clic al primer fotograma pintado con el resultado (`estudio-*-en-pagina`): calificar → siguiente **97 ms** de mediana en M y L (p95 97–113 ms) y mostrar la respuesta 80–84 ms. En este Chromium sin pantalla cada fotograma dura 33 ms, así que son ~3 y ~2.5 fotogramas (el mínimo medible es ~2). La «regresión» de +12–17 ms en «Mostrar respuesta» es medio fotograma de este entorno: ruido de cuantización.
- **Descartado: pintar la tarjeta siguiente antes de confirmar la escritura.** Ahorraría menos de un fotograma y dejaría la pantalla por delante del historial; si la escritura fallara, habría que deshacer con otra tarjeta ya en pantalla.
- **Más ámbitos** (`'settings'`, `'extra'`…): el costo grande era la colección + integridad + las lecturas de notas; con `'notes'` y la caché de textos queda resuelto. Otros ámbitos ahorrarían poco y añaden riesgo de vistas viejas.
- **Caché de `walk()`/listados** (pasada desde la fase 3): tras estos cambios, «Marcar» deja 85 listados y ninguna lectura. Con la carpeta del usuario (File System Access) otra app puede cambiar archivos por fuera y una caché de listados invalidada solo por nuestras operaciones serviría datos viejos. No se hizo.

## Verificación
`npm test` (475), `typecheck`, `build`; `e2e`, `e2e:flows`, `e2e:design`, `e2e:mejoras`, `e2e:mejoras2`, `e2e:p6`, `e2e:p10`, `e2e:p12`, `e2e:notaspro`, `e2e:intentos`, `e2e:bancos`, `e2e:share`, `e2e:tasks`, `e2e:stickies`, `e2e:p14` y `e2e:pdf` en verde. `e2e:phone` contra `main`: **0 píxeles**.
