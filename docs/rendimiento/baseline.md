# Rendimiento · línea base (Fase 0, Prompt 21)

Medida sin optimizar nada, sobre `rendimiento` @ el commit de la Fase 0. Reproducir: `node scripts/vault-gen.mjs && npm run build && npm run perf` (≈ 20 min). Datos crudos (todas las muestras): `docs/rendimiento/baseline.json`. Tabla regenerable con `node scripts/perf-table.mjs`.

## Entorno
- Navegador: **Chromium 153.0.8010.12** (en el contenedor no hay WebKit; `npm run perf` usa WebKit si existe). Las cifras no son las de Safari/iPad: sirven para comparar antes/después, no como valores absolutos de campo.
- CPU: Intel Xeon 2.30 GHz × 4 · 16 GB · Linux 6.18 · fecha 2026-11-13 · almacenamiento OPFS de Chromium (perfil persistente).
- 5 corridas por métrica (mediana y p95 sobre las 5; en estudio, p95 sobre las 90 tarjetas; en teclear, por pulsación). Bóveda L: 5 corridas también (cada escenario tardó < 20 min).
- Bóvedas (`scripts/vault-gen.mjs`, semilla fija 20261113, fecha base = día de generación): S 500 tarjetas/100 notas/20 imágenes; M 5 000/500/200 (incluye mazo `Grande` de 5 000 y `notes/Lote/` de 100 notas); L 20 000/2 000/500 + 3 PDF (10, 10 y 40 MB) = 2 607 archivos, 64.7 MB. Historial FSRS de ~60 % de las tarjetas. Extras: `reviews-100k.jsonl` (100 000 líneas, 19 940 tarjetas), `files500.zip`, `big-notes.zip` (1 y 5 MB), `apkg-5000.apkg` (generado con la biblioteca `anki`, formato nuevo).

## Cómo se midió
- **Escrituras al diario** = contador `journal` (solo con `?perf`; `perf.inc` en `SafeVault.commit`/`writeStream`): una por transacción con diario (cada una = temporal + diario + destino + 2 borrados en el backend).
- **Tareas largas** = `PerformanceObserver('longtask')` (> 50 ms) en la ventana medida. **Memoria pico** = `JSHeapUsedSize` por CDP cada 100 ms (solo hilo principal: Workers, OPFS y cachés de decodificación no cuentan).
- Por la interfaz (Playwright): arranque, pantallas, estudio, notas grandes (abrir, teclear, buscar), importar zip/.apkg, restaurar (= «Importar» del zip de respaldo).
- Por ganchos `?perf` (`src/lib/perfhooks.ts`, mismas funciones que usa la interfaz, sin gesto): reconstrucción FSRS y `verifyDeterminism` (en el navegador, no en Node), índice de búsqueda y consulta (`notesIndex`), mover 100 notas (`moveNotes`) y mover un mazo de 5 000 (`moveDeck`; carga de la colección aparte), crear el respaldo (`collectVault` + `buildZip`, sin escribir `settings.json` ni entregar el archivo). No se pudo medir por gestos de la interfaz: mover (selección + hoja) y el botón «Preparar respaldo».
- Arranque en frío = sin caché HTTP ni service worker (se borran por CDP; la bóveda en OPFS se conserva); caliente = recarga con SW activo. «Hoy interactivo» = `h1 Hoy` en pantalla **y** colección cargada (`perf.c.colAt`).
- Límites: «importar-zip-boveda» es una sola muestra por tamaño (la siembra). `estudio-mostrar` comparte con `estudio-responder-siguiente` las columnas de diario/tareas largas/memoria (se miden en el mismo bucle); su mediana es solo la de «Mostrar respuesta». En `nota-teclear-*`, mediana y p95 son por pulsación (2 rAF tras el evento `input`).
- Cambios en `src/` (todos detrás de `?perf`): contador en `safe.ts`, `colMs/colAt` en `app.tsx`, `import()` de `perfhooks.ts` en `main.tsx`.

## Paquete
- Inicial: **315 KB gzip** (19 archivos, incluidos los `modulepreload`). Diferido: 1 444 KB gzip en 42 archivos; los mayores: `pdf.worker` 370 KB, `sql-wasm` 330 KB, 171 KB, 138 KB, `apkg.worker` 124 KB.
- Arranque en frío: **26 peticiones, ≈ 358 KB transferidos** (idéntico en S, M y L); en caliente 26 peticiones servidas por el SW (0 KB de red).

## Tabla (mediana en negrita; ms salvo donde se indica)
| Métrica | Mediana (ms) por bóveda | p95 (ms) | Escrituras al diario | Tareas largas >50 ms (máx ms) | Memoria pico (MB, hilo principal) |
|---|---|---|---|---|---|
| importar-zip-boveda | S: **2554**<br>M: **10293**<br>L: **31704** | S: 2554<br>M: 10293<br>L: 31704 | S: 132<br>M: 743<br>L: 2605 | S: 0<br>M: 2 (máx 176)<br>L: 1 (máx 174) | S: 9.7<br>M: 34.7<br>L: 18.2 |
| arranque-frio-hasta-Hoy | S: **614**<br>M: **1120**<br>L: **2674** | S: 787<br>M: 1189<br>L: 2738 | S: 0<br>M: 0<br>L: 0 | S: 0<br>M: 1 (máx 135)<br>L: 3 (máx 466) | S: 6.5<br>M: 13.9<br>L: 47.2 |
| arranque-caliente-hasta-Hoy | S: **470**<br>M: **992**<br>L: **2641** | S: 533<br>M: 1055<br>L: 2672 | S: 0<br>M: 0<br>L: 0 | S: 0<br>M: 1 (máx 140)<br>L: 2 (máx 421) | S: 12.3<br>M: 29.8<br>L: 60.5 |
| pantalla-mazos | M: **120**<br>L: **103** | M: 142<br>L: 148 | M: 0<br>L: 0 | M: 0<br>L: 0 | M: 20.5<br>L: 57 |
| pantalla-notas | M: **1395**<br>L: **5209** | M: 2271<br>L: 8485 | M: 0<br>L: 0 | M: 0<br>L: 3 (máx 160) | M: 27.2<br>L: 65.4 |
| pantalla-estadisticas | M: **149**<br>L: **434** | M: 262<br>L: 468 | M: 0<br>L: 0 | M: 2 (máx 74)<br>L: 2 (máx 215) | M: 39.6<br>L: 61.5 |
| pantalla-hoy | M: **392**<br>L: **1249** | M: 437<br>L: 1320 | M: 0<br>L: 0 | M: 3 (máx 138)<br>L: 3 (máx 455) | M: 39.3<br>L: 64.7 |
| ciclo-pantallas | M: **2056**<br>L: **6995** | M: ·<br>L: · | M: ·<br>L: · | M: ·<br>L: · | M: ·<br>L: · |
| estudio-mostrar | M: **49.4**<br>L: **77.3** | M: 54.9<br>L: 84.1 | M: 36<br>L: 36 | M: 0<br>L: 18 (máx 111) | M: 30.6<br>L: 79.3 |
| estudio-responder-siguiente | M: **258.3**<br>L: **351.5** | M: 324<br>L: 444.1 | M: 36<br>L: 36 | M: 0<br>L: 18 (máx 111) | M: 30.6<br>L: 79.3 |
| fsrs-100k-reconstruir-y-verificar | L: **1791.8** | L: 1888.7 | L: 2 | L: 4 (máx 946) | L: 124.9 |
| busqueda-indice | M: **1193.5**<br>L: **5056.5** | M: 2292<br>L: 9418.8 | M: 0<br>L: 0 | M: 0<br>L: 0 | M: 31.2<br>L: 64.7 |
| busqueda-consulta | M: **18.1**<br>L: **19.8** | M: 19.8<br>L: 38.4 | M: ·<br>L: · | M: ·<br>L: · | M: ·<br>L: · |
| nota-abrir-1MB | nota: **1731** | nota: 2245 | nota: 0 | nota: 1 (máx 141) | nota: 63.4 |
| nota-teclear-50-bloque-1MB | nota: **54** | nota: 86.4 | nota: 1 | nota: 0 | nota: 118.7 |
| nota-teclear-50-markdown-1MB | nota: **73.4** | nota: 105.8 | nota: 1 | nota: 0 | nota: 88.1 |
| nota-buscar-en-nota-1MB | nota: **304** | nota: 409 | nota: 0 | nota: 1 (máx 200) | nota: 90.9 |
| nota-abrir-5MB | nota: **3601** | nota: 3840 | nota: 0 | nota: 2 (máx 1808) | nota: 328.3 |
| nota-teclear-50-bloque-5MB | nota: **56.6** | nota: 103.8 | nota: 1 | nota: 6 (máx 80) | nota: 329.3 |
| nota-teclear-50-markdown-5MB | nota: **62.5** | nota: 102.1 | nota: 1 | nota: 60 (máx 122) | nota: 218.8 |
| nota-buscar-en-nota-5MB | nota: **1926** | nota: 2237 | nota: 0 | nota: 1 (máx 1651) | nota: 278.5 |
| mover-100-notas | M: **4869**<br>L: **10247** | M: 6290<br>L: 14210 | M: 200<br>L: 200 | M: 0<br>L: 0 | M: 24.7<br>L: 66.9 |
| mover-mazo-5000 | M: **203**<br>L: **513** | M: 305<br>L: 520 | M: 1<br>L: 1 | M: 0<br>L: 1 (máx 86) | M: 21.1<br>L: 78 |
| importar-zip-500-archivos | n/a: **5922** | n/a: 5988 | n/a: 500 | n/a: 0 | n/a: 15.5 |
| importar-apkg-5000 | n/a: **695** | n/a: 755 | n/a: 10 | n/a: 0 | n/a: 7.2 |
| respaldo-crear | L: **6740.8** | L: 11770.2 | L: 0 | L: 2 (máx 468) | L: 221.2 |
| respaldo-restaurar | L: **28998** | L: 30029 | L: 2606 | L: 1 (máx 195) | L: 17.6 |

## Objetivos propuestos (con la evidencia de esta tabla)
Cada objetivo cita su cifra; los umbrales de «después» son propuestas a validar en la Fase 1, no compromisos.

| # | Hallazgo medido | Objetivo propuesto |
|---|---|---|
| 1 | **Mover 100 notas: 200 escrituras al diario en serie** (2 por nota), 4.9 s en M y 10.2 s en L. Mover un mazo de 5 000 tarjetas hace 1 escritura (0.2–0.5 s): el costo está en la cantidad de transacciones, no en los bytes. | 1 lote (≤ 2 escrituras al diario por operación de mover), < 1 s en M y < 2 s en L, deshacer intacto. |
| 2 | **Restaurar el respaldo de L: 2 606 escrituras al diario, 29 s**; importar el zip de 500 archivos: 500 escrituras, 5.9 s; sembrar L: 2 605 escrituras, 31.7 s. ≈ 11 ms por archivo, todo en serie. | Importación por lotes con un diario por lote: restaurar L < 10 s, zip de 500 < 2 s. Misma garantía de recuperación (`recover`). |
| 3 | **Estudiar con la cola de L: responder + siguiente = 351 ms mediana, p95 444 ms** (M: 258/324 ms); **2 escrituras al diario por respuesta** y 18 tareas largas (máx 111 ms) en 18 respuestas; el pico de memoria es 2.6 veces el de M (79 vs 31 MB). Según el mapa, cada respuesta reescribe `state.json` entero (20 000 tarjetas) y relee `reviews.jsonl`. | p95 ≤ 100 ms con L; ≤ 1 escritura al diario por respuesta; sin tareas largas en el gesto. `reviews.jsonl` sigue siendo la verdad (`verifyDeterminism`). |
| 4 | **Abrir Notas: 1.4 s (M) y 5.2 s (L)** (p95 8.5 s en L). El índice de búsqueda tarda 1.2 s (M) / 5.1 s (L) y de ellos **5.4 s son leer las 2 000 notas una por una**; construir el índice en el Worker solo 0.6 s. La consulta ya es rápida (mediana 20 ms, p95 38 ms). | Abrir Notas < 1 s con L (leer en paralelo/por lotes o reutilizar un índice persistido y reconstruible); consulta sin cambios. |
| 5 | **FSRS 100 000 repasos: 1.8 s, una sola tarea larga de 946 ms** en el hilo principal. `replay` (854 ms) se ejecuta de nuevo dentro de `verifyDeterminism` (911 ms): dos reconstrucciones completas. Resultado correcto en las 5 corridas (`ok`). | Ninguna tarea > 100 ms (replay en Worker o por trozos); no duplicar el replay en la verificación (comparar la caché con la reconstrucción ya hecha). Mismo estado byte a byte. |
| 6 | **Arranque con L: Hoy interactivo en 2.7 s** (S 0.6 s, M 1.1 s), de los cuales la carga de la colección son 1.3 s; 3 tareas largas (máx 466 ms). Frío y caliente cuestan igual (el costo es la bóveda, no la red). | Hoy interactivo < 1.5 s con L y sin tarea > 200 ms; S y M sin regresión (≤ 0.6 y 1.1 s). |
| 7 | **Nota de 5 MB: abrir 3.6 s con una tarea de 1.8 s, buscar dentro 1.9 s (tarea de 1.7 s), pico 330 MB**; en vista Markdown teclear produce 60 tareas largas en 50 pulsaciones (p95 por pulsación 102 ms). Nota de 1 MB: abrir 1.7 s, buscar 0.3 s. | Abrir 5 MB < 1.5 s sin tarea > 200 ms; buscar en la nota sin bloquear; pico < 200 MB; teclear 50 caracteres sin tareas largas en Markdown. |
| 8 | **Respaldo de L: 6.7 s (p95 11.8 s)**; 5.6 s son leer los 2 607 archivos en serie, pico 221 MB (todo el vault en memoria, zip de 64.7 MB). | < 3 s y pico < 120 MB (lectura en paralelo / escritura del zip por trozos). Mismo `.zip` válido y restaurable. |
| 9 | **Cambio de pantallas con L: Hoy→Mazos→Notas→Estadísticas→Hoy = 7.0 s** (M: 2.1 s); Notas (5.2 s) es el 75 %; Hoy 1.2 s y Estadísticas 0.43 s con tareas de hasta 455 ms. | Ciclo con L < 3 s; Hoy y Estadísticas sin tareas > 200 ms. |
| 10 | **Paquete**: inicial 315 KB gzip, 26 peticiones en frío (358 KB). | No crecer (tope 315 KB gzip inicial y 26 peticiones); lo nuevo, diferido. |

Sin medir / pendientes: WebKit/iPad (no existe en el contenedor; todo esto es Chromium); estudio con tipos interactivos (`T::`, MC, etc.); Lienzo y PDF pesados (ya cubiertos por `npm run e2e:perf`, `docs/perf/`); mover mediante la hoja de la interfaz (se mide la función); memoria de Workers y de OPFS.
