# Etapa 2.2 · errores de lógica en `src/cards/`, `src/srs/`, `src/data/` (2026-11-13)

**Módulos:** `cards/parse`, `srs/engine`, `srs/queue`, `data/collection`, `ops`, `extra`, `decktrash`, `move`.
**Hallazgos:** alta 3 · media 5 · baja 6 (14; 17 pruebas).
**Pruebas añadidas:** `tests/audit-data.test.ts`, 17 `it.fails` (cada una reproduce el error; al corregir, cambiar a `it()`).
Formato: `archivo:línea · problema · gravedad · reproducción`.

## Alta
1. `src/data/collection.ts:141-144` (`appendLog`) · `readTextOr(…, '')`: si la lectura de `reviews.jsonl` falla, se escribe un archivo con solo las entradas nuevas y se pierde TODO el historial FSRS (la verdad). Confirmado. · Backend cuya `read` lanza una vez → `appendLog` → el archivo queda con 1 línea. Prueba «appendLog no sustituye…». Arreglo: usar `readText` (propaga) o comprobar `exists`.
2. `src/data/ops.ts:30` (`appendCard`) y `:46` (`setDeckMeta`) · mismo patrón: lectura fallida = `''` y se escribe el mazo con una sola tarjeta / solo frontmatter; el resto de las tarjetas del archivo se pierde. Pruebas «appendCard…» y «setDeckMeta…». Mismo patrón en `src/data/move.ts:40` (`write` registra `before` con `''` → deshacer vaciaría el archivo), `:112`, `:265-267` (`moveCards` lee origen/destino con `''` y los reescribe).
3. `src/data/extra.ts:46-48` (`restoreAttempt`) · «Deshacer borrar intento» con lectura fallida inserta la línea en `''` y sustituye `exam-attempts.jsonl` por una sola línea (se pierden todos los intentos). Prueba «restoreAttempt…».

## Media
4. `src/data/collection.ts:141-146` · sin cola: dos `appendLog`/`stateOp` solapados leen el mismo `prev` y el segundo `write` pisa al primero (se pierde un repaso). Reachable: `doUndo` (`study.tsx:105`) y `stateOp` por teclado (`:141`, `void`) no comprueban `busy` mientras `answer` espera. · `Promise.all([appendLog(a), appendLog(b)])` → 1 línea. Prueba «dos appendLog simultáneos…».
5. `src/srs/queue.ts:46-60` (`newIntroducedToday`, `reviewsToday`) · no descuentan los repasos deshechos (`op:'undo'`): tras deshacer la primera respuesta de una tarjeta nueva, el cupo de nuevas del día sigue gastado (y el de repasos). · Responder una nueva, deshacer: `introduced` = 1. Pruebas «deshacer la primera respuesta…» y «…contador de repasos».
6. `src/data/collection.ts:100-103` (`byCid`) y `:93-95` · un `^id` repetido ENTRE mazos (p. ej. copiar un `.md`) no se avisa (solo se vigila dentro de un archivo): `byCid` queda con el último y la misma tarjeta entra dos veces en la cola, comparte estado y reorganiza al mover. · Dos mazos con `^dup01` → `buildQueue().fresh` tiene 2. Prueba «un ID repetido en dos mazos…».
7. `src/data/collection.ts:108-125` · si un mazo no se puede leer (`readTextOr('')`) sus tarjetas desaparecen de `byCid` y se **archivan** (`archive.json` se escribe con `since: now`); una falla transitoria deja marcas de archivo persistentes. · Prueba «un mazo ilegible…». Menor: no es destructivo (se limpian al volver a verse).
8. `src/cards/parse.ts:249-262` (`ensureIds`) y `replaceBlock` · normaliza a `\n` TODO el cuerpo del archivo cuando añade un ID (`split(/\r?\n/)` + `join('\n')`), dejando el archivo con saltos mixtos (el frontmatter conserva CRLF). Reescribe cada línea del archivo del usuario (diff/sync ruidoso). · Mazo CRLF sin IDs → carga → todo `\n`. Prueba «ensureIds conserva…».

## Baja
9. `src/cards/parse.ts:58` (`ID_RE`) · un texto que acaba en « ^10» o « ^2n» (potencias, `x ^10`) se toma por ID de tarjeta y `ensureIds` no añade el ID real; `Q:: x / A:: 2 ^10` → id `10`, back `2`. Prueba «un texto que acaba en…». Además, si el orden es `^id <!-- origen: ia -->` (a mano) el ID no se detecta y se añade un segundo.
10. `src/cards/parse.ts:177-179` (`io`) · `Number('')` = 0: `10,20,,40` pasa como rectángulo `w=0`; tampoco se limita a 0–100. Prueba «oclusión: un rectángulo…».
11. `src/cards/parse.ts:285-292` (`checkTyped`) · tolerancia mínima de 1 carácter: «2» frente a «1», «10» frente a «100» o letra por letra en respuestas de 1–6 caracteres dan «casi correcto» (SPEC §4b: «casi correcto» es para erratas). Además, una respuesta solo de símbolos («+», «→») normaliza a `''` y nunca es correcta, ni siquiera idéntica. Pruebas «escribir respuesta: …».
12. `src/data/ops.ts:52-62` (`stateOp`) · cambia `col.states` antes de `appendLog`; si la escritura falla, la memoria queda distinta del disco hasta recargar (la tarjeta se ve suspendida pero no está en el historial). Prueba «stateOp no deja…».
13. `src/data/extra.ts:55-59` (`loadExtra`) · `elapsedMs` negativo o no numérico entra tal cual (`Math.min(-9000,…)`, `NaN`) y falsea el tiempo de estudio de estadísticas. Prueba «loadExtra ignora…».
14. `src/data/decktrash.ts:25-28` (`withSubdecks`) · busca submazos por `d.name` (el `deck:` del frontmatter), pero las carpetas se llaman como el archivo; si difieren (p. ej. `deck: "Anatomía: tórax"` en `Anatomía tórax.md`, porque `safeName` quita `:`) los submazos no viajan con el padre al borrar/mover. Misma lógica en `move.ts:96-97` (`oldSub`). Prueba «withSubdecks encuentra…».

Sospechas sin prueba: `src/srs/queue.ts:150` y `atRisk:176-177` · `'R x %'`/`'fallos recientes'` fijos en español (regla `t()`); `engine.ts:150` (`explain`) · `'aprendizaje'/'reaprendizaje'` fijos. `trashDecks` usa `now.toString(36)` como id: dos borrados en el mismo ms comparten carpeta. `verifyDeterminism` (collection.ts:152) no compara `buried` ni `history`.

Descartado: `deckCounts().due` vs tope de repasos (cuenta distinto a la cola por diseño: la prueba pasó, es decir, el comportamiento coincide); BOM (el `TextDecoder` lo quita); `dayEnd` con DST; `replay` con `ts` iguales (orden estable por índice); `parseLog` rechaza ratings fuera de 1–4.

## Para etapa 3
- `replay` ordena por `ts` y luego por índice: dos dispositivos o un reloj atrasado reordenan repasos y cambian el estado; `applyReview` en vivo usa el orden de llegada. Revisar `verifyDeterminism` frente a eso, y `undo` por clave `id@ts` (dos repasos con el mismo ts se deshacen juntos).
- `loadStates`: la clave de la caché `state.json` es `longitud:último ts:último id:params`; una edición del `.jsonl` que conserve esos tres valores sirve estado viejo.
- Reconciliación por ID: `archive.json` (30 días) vs papelera de mazos; IDs duplicados entre mazos (hallazgo 6); cloze `c0`; ID recortado si el texto acaba en `^xx`.
- `moveDeck/moveCards/moveFolder`: `before` de `write()` con `''` por lectura fallida, deshacer parcial si una operación intermedia lanza, `merge` que concatena cuerpo sin comprobar IDs repetidos, `rewriteDeckRefs` que reescribe `.ics` y `exams/*.md` con el parser/serializador con pérdida de `frontmatter.ts` (02-lib #1/#3).
- Todas las escrituras de `data/*` ¿pasan por `SafeVault` o por el adaptador crudo? (`app.vault`).
