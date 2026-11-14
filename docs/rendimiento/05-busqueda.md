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

### Pendiente: abrir la nota de 5 MB (~3.9 s, tarea larga de ~2.1 s)
Sanear y pintar por tramos en reposo (los primeros 80 bloques al abrir, el resto de a un tramo por hueco libre, reutilizando `renderMarkdownCached` y sin tocar la configuración de DOMPurify) no se hizo en esta fase: mientras falten tramos, «Buscar en esta nota» (`rangesIn` lee el DOM), imprimir (también con Cmd+P, `beforeprint`) y tocar un bloque aún sin pintar para editarlo verían la nota incompleta. Hay que forzar el pintado completo en esos tres casos y probarlo con `e2e:p14`, `e2e:notas-perf` y `e2e:pdf`; queda como el siguiente paso de este cuello.
