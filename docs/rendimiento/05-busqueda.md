# Fase 5 · Búsqueda y notas (Prompt 21-B)

Rama `rendimiento-2`. Cifras de **Chromium** en el contenedor (no hay WebKit).

## Cuello #3 · Abrir Notas leía las 2 000 notas
`useNotes` hacía `walk('notes')` y después `linkIndex` leía **cada nota, en serie**, para retroenlaces, grafo, menciones y el índice de búsqueda: 2 001 lecturas al Worker de OPFS, que hace una operación a la vez.

### Caché de textos (`7934734`, `src/notes/textcache.ts`)
- Cada nota se guarda en **IndexedDB** (`engrama-cache`, almacén `notas`, con versión) junto con la firma que da el propio listado: tamaño + fecha de modificación (`walk` ya los trae, sin operaciones extra).
- Al abrir Notas solo se leen del disco las notas cuya firma cambió o que no están en la caché; las borradas se quitan de ella. Una lectura de IndexedDB (`getAll` por prefijo de bóveda) sustituye a ~2 000 lecturas de OPFS.
- **Reconstruible**: los archivos siguen siendo la verdad. Sin IndexedDB, con la base ilegible, sin espacio o sin fecha de modificación fiable (`mtime` = 0), se lee del disco como antes. Al cambiar la forma de lo guardado se sube `VERSION` y la base se rehace.
- Solo la usan vistas de **lectura** (lista, grafo, retroenlaces, menciones, búsqueda); el editor y todo lo que escribe leen siempre el archivo.
- Una entrada por bóveda (`kind` + nombre de la carpeta raíz): dos bóvedas del mismo origen no se mezclan.

### Medición (`ONLY=pantallas`, 5 navegaciones Hoy → Notas)
| | M | L |
|---|---|---|
| Antes (`ca41863`) | 1.36 s | 6.16 s |
| Caché de textos, primera visita (la llena) | 1.22 s | 4.59 s |
| Caché de textos, visitas siguientes (mediana de las 5) | **0.41 s (−70 %)** | **1.19 s (−81 %)** |

Objetivo (< 1 s en L): casi; queda `walk('notes')` (82 `list`, que hacen `getFile()` por archivo) y el render del árbol (~0.14 s).

### Descartado: no reconstruir el índice al volver a Notas (`ad81b4a`, revertido en `87bad81`)
Si los documentos eran idénticos a los ya indexados, se saltaba `reset`. Abrir Notas en L no mejoró (1.19 → 1.38 s, dentro del ruido): el índice se reconstruye en su Worker y no bloquea la pantalla. Por la regla del prompt se revierte. El índice persistido en IndexedDB que pide el prompt queda descartado por lo mismo: el costo que evitaría (≈ 0.8 s en el Worker al abrir Notas) no está en el camino que ve el usuario, y la caché de textos ya quitó las 2 000 lecturas, que eran lo caro.

## Cuello #10 · Buscar en una nota de 5 MB (`be44872`)
`rangesIn` (`src/notes/find.tsx`) buscaba el nodo de texto de cada coincidencia **hacia atrás desde el último nodo**: O(coincidencias × nodos), 1.2 s de 2.1 s. Ahora es una búsqueda binaria que devuelve el mismo nodo (el último que empieza en la posición o antes; `starts[0] = 0`, así que siempre hay uno).

| `ONLY=notas`, bóveda S, 5 corridas | Antes (`ca41863`) | Búsqueda binaria (`be44872`) |
|---|---|---|
| Buscar en la nota de 5 MB | 2.88 s · tarea larga máx 2.5 s | **1.25 s (−57 %)** · máx 0.9 s |
| Buscar en la nota de 1 MB | 413 ms | **310 ms (−25 %)** |

### Abrir la nota de 5 MB: pintado progresivo (hecho)
En notas de más de `2 * CHUNK` (80) bloques se renderizan y sanean solo los 2 primeros tramos de 40 al abrir; el resto se pinta en reposo (`requestIdleCallback`, o `setTimeout` si no existe), un tramo por hueco libre. Los tramos sin pintar van vacíos (la altura la da `contain-intrinsic-size` de `.doc-cv`, sin HTML sin sanear). Se reutiliza `renderMarkdownCached`; no se tocó DOMPurify ni `src/md/`. Se pinta TODO de inmediato cuando algo lee el DOM entero: «Buscar en esta nota» abierta (incluido `pendingFind`), imprimir (botón «PDF / imprimir» y `beforeprint` vía el evento `engrama:paintall`; Preact renderiza en microtarea, antes de imprimir) y editar un bloque de un tramo aún sin pintar. Las notas de ≤ 80 bloques no cambian.

Chromium 5 corridas, banco `e2e/rendimiento.mjs` (solo hay Chromium en el contenedor; WebKit/iPad sin probar):

| Métrica (mediana) | Antes | Después |
|---|---|---|
| `nota-abrir-5MB` | 3899 ms (2 tareas largas, máx ~2.1 s) | 1899 ms (1 tarea larga, máx ~0.3 s) |
| `nota-abrir-1MB` | 1750 ms | 1642 ms |
| `nota-buscar-en-nota-5MB` | 1199 ms | 1250 ms (igual: fuerza el pintado completo) |
| `nota-buscar-en-nota-1MB` | 407 ms | 410 ms |

Los e2e `p14` y `notas-perf` esperaban los tramos completos nada más abrir: se les añadió una espera al pintado en reposo.

## Verificación
`npm test` (475), `typecheck`, `build`; `e2e`, `e2e:flows`, `e2e:design`, `e2e:mejoras`, `e2e:mejoras2`, `e2e:p6`, `e2e:p10`, `e2e:p12`, `e2e:notaspro`, `e2e:intentos`, `e2e:share` en verde; `e2e:bancos` falló una vez («restaurar desde la papelera») y pasó entero al repetirlo (intermitente conocido, ver el prompt). `e2e:phone` contra `main`: **0 píxeles**.
