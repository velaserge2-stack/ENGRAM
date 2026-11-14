# Fase 4 · Datos y FSRS (Prompt 21-B)

Rama `rendimiento-2` desde `main` b5129af. Cifras de **Chromium** en el contenedor (no hay WebKit).

## Cuello #6 · `appendLog` reescribía todo
Antes, cada respuesta de estudio: leer `reviews.jsonl` entero, reescribirlo entero con `commit` (temporal + diario + destino), re-hashear las 54 000 entradas para la clave de la caché y serializar y escribir `state.json` (20 000 estados, ~6.8 MB). Son 2 diarios, 16.5 MB al Worker y ~88 ms de CPU por respuesta.

### 1 · Añadir de verdad (`652a169`)
- `VaultAdapter.appendAt(path, data, at, sep)` (opcional) en memoria, `HandleFS` (OPFS con *sync access handle* en el Worker; carpeta del usuario con `createWritable({ keepExistingData: true })`), cliente de OPFS y File System Access. Deja el archivo con sus primeros `at` bytes y escribe `data` desde ahí. Con `sep`, antepone `\n` si el byte `at − 1` no lo es. **Repetirlo da el mismo resultado.**
- `SafeVault.append(path, data)`:
  1. `stat` → `at`;
  2. **diario v3** con la ruta, `at`, los datos (son pocas líneas: van en el propio diario, sin temporal) y su suma;
  3. `appendAt`;
  4. quitar el diario.

  Son 4 operaciones pequeñas en lugar de leer y reescribir el archivo. Sin `appendAt` en el backend, se lee y se reescribe con `commit`, como antes.
- **Recuperación v3**: si el diario es íntegro (la suma de los datos casa) y el archivo mide al menos `at`, se repite `appendAt` (idempotente). Si no, se descarta sin tocar nada y se reporta. Un diario v1 o v2 se sigue recuperando igual.
- `appendLines` usa `SafeVault.append` y solo lee el archivo si la función necesita ver lo que hay (p. ej. `mergeLog` sin duplicados). Lo aprovechan también intentos de simulacro, pomodoro y la importación de historial.

### 2 · Punto de control y `state.json` diferido (`706566e`)
- **`state.json` v2** = `{ v: 2, key: motor + parámetros, at, head, cards }`: `at` = bytes de `reviews.jsonl` que reflejan los estados y `head` = su suma FNV.
- **Al cargar** (`loadStates`): si `key` casa, `at` cae en fin de línea y la suma de los primeros `at` bytes casa con `head`, se toman los estados guardados y **solo se reconstruyen las tarjetas que aparecen después de `at`**, cada una con **todas** sus entradas. Si no (archivo editado o truncado, otra versión del motor u otros parámetros, caché v1 o dañada), reconstrucción completa como antes. Un `state.json` viejo solo provoca reconstrucción (cambio perezoso y retrocompatible).
- **Por qué es idéntico bit a bit**: el estado de una tarjeta depende solo de sus propias entradas. `replay` ordena por `ts` con el índice como desempate (el orden relativo dentro de una tarjeta se conserva al filtrarla), `undo` se casa por id y `ts`, y el azar de ts-fsrs se siembra con datos de la tarjeta. Reconstruir una tarjeta con sus entradas da su estado en la repetición completa aunque lo nuevo llegue fuera de orden, con `ts` iguales o deshaga algo de antes del punto de control.
- **La suma sigue al archivo**: `SafeVault.append` devuelve dónde empezó y los bytes que quedaron escritos (con el `\n` si se añadió), y la colección continúa la suma FNV sin releer. Si lo añadido no empezó donde se esperaba (otra pestaña escribió entre medias), la colección deja de guardar puntos de control en esa sesión; el anterior sigue valiendo.
- **`state.json` diferido**: se guarda tras 15 s sin respuestas, al ocultar la página (`visibilitychange`) y en `pagehide` (sin `beforeunload`). **Nunca con una respuesta en vuelo**: el estudio cambia el estado y llama a `appendLog` en el mismo tick, y si la escritura falla lo revierte en una microtarea. Por eso el guardado (una tarea aparte) espera a `inFlight = 0` y arma el JSON de una vez, sin esperas. Si nunca llega a guardarse no se pierde nada: lo que falte se reconstruye por tarjeta al cargar.

### Pruebas (`tests/fsrs-checkpoint.test.ts`)
- **100 000 repasos hostiles** (fuera de orden, `ts` iguales, `undo`, suspender/enterrar/olvidar, líneas dañadas) con un corte al azar: incremental idéntico a `replay` completo, comparando el JSON de todos los estados.
- 3 000 repasos con 16 cortes (incluidos 0 y el final): siempre idéntico.
- Principio del archivo editado, archivo truncado, caché v1, caché dañada y otros parámetros: reconstrucción completa.
- Estudiar 20 respuestas: ninguna reescritura de `reviews.jsonl`, ningún `state.json` hasta `flushState`, y al recargar los estados casan con `replay` y con la memoria.
- `SafeVault.append` con muerte en cada paso (archivo vacío, con salto y sin salto final): queda como antes o con la línea entera una sola vez, sin separador doble ni diario. Sin `appendAt`: mismo resultado reescribiendo.
- Mismas pruebas con `TZ` = America/Mexico_City, Asia/Tokyo, Pacific/Kiritimati (+14 h) y America/St_Johns (−3:30): todas en verde. `replay` solo usa milisegundos de época; los estados se guardan en ISO.

## Medición (`ONLY=estudio,fsrs`, M y L, 5 corridas)
| Métrica | `main` b5129af | Solo añadir `652a169` | + punto de control `706566e` | Objetivo |
|---|---|---|---|---|
| Responder → siguiente · M (mediana / p95) | 362 / 497 ms | 307 ms | **203 / 375 ms** (−44 % / −25 %) | p95 ≤ 100 ms: no |
| Responder → siguiente · L (mediana / p95) | 541 / 1 049 ms | 455 ms | **199 / 330 ms** (−63 % / −69 %) | p95 ≤ 100 ms: no |
| Diarios por respuesta | 2 | 2 | **1** | ≤ 1: sí |
| Tareas largas en el gesto · L (18 respuestas) | 18 (máx 200 ms) | — | **0** | 0: sí |
| FSRS 100 k: reconstruir + verificar | 2.99 s | 2.66 s | 2.83 s | (sin cambio: es la repetición completa sin caché) |

Lo que queda de los ~200 ms ya no es escritura: es pintar la tarjeta siguiente y elegir de la cola. Sale de este cuello y queda para la fase 6 (interfaz).

## Verificación
`npm test` (475), `typecheck`, `build`; `e2e`, `e2e:flows`, `e2e:design`, `e2e:mejoras`, `e2e:mejoras2`, `e2e:p6`, `e2e:p10`, `e2e:p12`, `e2e:notaspro`, `e2e:intentos`, `e2e:bancos`, `e2e:share` en verde. `e2e:phone` contra `main`: **0 píxeles**. La primera corrida marcó 52 357 px en Ajustes a 1024×768 con la máquina cargada por la batería; repetida con el mismo `dist/`, dio 0 (intermitente: una captura a mitad de una animación).

## Cuello #9 · Replay
- Con el punto de control, `replay` completo solo corre si la caché no casa (restaurar, editar el historial a mano, cambiar parámetros). En el uso normal se reconstruyen solo las tarjetas nuevas.
- «Comprobar» en Ajustes ya hacía **una** sola repetición (`verifyDeterminism`); la doble pasada era solo del gancho de medición. No se cambió.
- **Descartado: mover `replay` a un Worker.** Haría falta mandar el historial entero (19 MB) y devolver 20 000 estados por mensaje para un caso que ya no está en el camino normal. No se implementó; si la reconstrucción completa tras restaurar molesta en el iPad, es lo siguiente.
- **Descartado: parsear mazos en un Worker con caché.** La fase 1 midió `loadCollection` en 140 ms (`parseDeck` 104 ms): no compensa una caché versionada más.
- **O(n²)**: no se encontraron búsquedas lineales dentro de bucles en FSRS, la cola ni la colección (los `find` de la cola son de una pasada; `col.log.includes` solo corre si falla la escritura).
