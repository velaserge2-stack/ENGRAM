# Auditoría · 05 · Correcciones aplicadas

Rama `auditoria`. Un commit por punto del PLAN de `03-criticos.md`. Cada punto pasó `npm run typecheck`, `npx vitest run` y `npm run build`. Al final de la tanda (puntos 1–5): `e2e`, `e2e:flows`, `e2e:mejoras`, `e2e:intentos` y `e2e:notaspro` en verde con `BROWSER=chromium` (no hay WebKit en el contenedor).

`it.fails` → `it`: **15** (de 88) en los puntos 1–5 y **9** en los puntos 6–10: **24** en total. Quedan **64**.

## Plan 1 · Lectura estricta (`5a2b1cf`)

Qué cambió:
- `src/vault/util.ts:20` `isNotFound` (VaultError `not-found` o DOMException `NotFoundError`/`TypeMismatchError`); `:30` `readTextOr` solo devuelve el valor por defecto en ese caso y propaga cualquier otro fallo.
- `src/vault/opfs.worker.ts:133` envía el código de texto (`VaultError.code`) o el nombre del DOMException, no el numérico (22).
- `src/vault/opfs.ts:7` `codeOf`: `NotFoundError`/`TypeMismatchError` → `not-found`, `QuotaExceededError` → `quota`, conserva `invalid-path`.
- `src/notes/store.ts:34` una lectura fallida no se queda cacheada en `loading`; `:58` `refresh` ignora el fallo (solo lectura).
- `src/pdf/library.ts:13` `readMeta` propaga la lectura fallida (JSON dañado sigue siendo `{}`).
- Solo lectura con `.catch` explícito: paleta, calendario (importados y tareas), stickies, `buildLinkIndex`, `linkIndex`. `storage.tsx` sigue estricto (cuenta usos antes de borrar).
- `src/app.tsx:95` aviso si la colección no se puede leer; `:106` aviso para cualquier `VaultError`/DOMException no atrapado (`unhandledrejection`). Claves `app.no_se_pudo_cargar_la_coleccion` y `app.error_de_almacenamiento` en es/en/fr.
- `HandleFS` sin cambios: ya lanza `VaultError('not-found')` o el DOMException original.

Pruebas a `it()` (9): vault «readTextOr solo debe…», «código de texto (QuotaExceededError)»; data «appendCard…», «setDeckMeta…», «restoreAttempt…»; críticos «loadStates no reconstruye…»; lib «ensureFileId no sustituye…»; notes-io «noteStore.load…», «updatePdfMeta…».

Riesgos residuales: un mazo ilegible hace fallar `loadCollection` entera (aviso, sin escribir); antes se archivaban sus tarjetas. Sigue `it.fails` «un mazo ilegible al cargar no archiva…» porque ahora lanza: falta cargar el resto y avisar del mazo concreto. Los llamadores con `void …` de escrituras dependen del aviso global. `FSAccessBackend` no traduce `QuotaExceededError` a `VaultError('quota')` (llega el DOMException).

## Plan 2 · SafeVault tras un apply fallido (`005e132`)

Qué cambió (`src/vault/safe.ts`):
- `:102` `apply`: el paso 3 se reintenta una vez; si vuelve a fallar, `stuck = true` y el diario y el temporal se conservan.
- `:95` `settle`: antes de cada operación de la cola, si hay diario pendiente se aplica (`replay`); si tampoco puede, la operación se niega con `VaultError('io')` en vez de pisar el diario.
- `:205` `recover` = `:217` `replay` + limpieza de `.app/tmp` (no se limpia con un diario pendiente). Un fallo de E/S al aplicar ya no descarta la entrada; solo se descarta con suma distinta o temporal ausente.
- `writeStream`: el `move` del temporal pasa por `apply` (reintenta solo si el temporal sigue ahí).

Pruebas a `it()` (1): críticos «un apply fallido (destino truncado)…». Se cambió su `rejects` por `.catch`, porque con el reintento la escritura se cumple; la aserción que importa (`a.md ∈ {v1, v2}`) no cambia. Nuevas en `tests/vault.test.ts`: reintento fallido + recuperación en la siguiente escritura, negativa a escribir + rehacer al arrancar, `writeStream` con `move` fallido.

Riesgos residuales: con un fallo persistente (disco lleno) todas las escrituras se niegan hasta que haya espacio; las lecturas siguen. El Worker colgado (sin respuesta) sigue bloqueando la cola (03 §6.1, plan 14).

## Plan 3 · Diario validado e importación (`d9e4d51`)

Qué cambió:
- `src/vault/safe.ts:70` `validEntry`: solo `op ∈ {write, move}`, `tmp` con forma `.app/tmp/<id>`, `size`/`hash` con tipo, `path`/`from` normalizados, fuera de `.app/tmp` y distintos del diario; `stream` solo en `write`. `:235` un `move` cuyo `from` es carpeta se descarta. Las inválidas van a `discarded`.
- `src/io/zip.ts:155` `parseZip` descarta `!isExportable` tras leer el manifiesto; `src/io/import.ts:167` `gather` filtra lo mismo (carpeta y archivos sueltos).

Pruebas a `it()` (2): críticos «recover no ejecuta un diario ajeno…»; notes-io «importar un zip no admite .app/journal.json…». Nueva en `tests/vault.test.ts` con entradas inválidas mezcladas con una válida.

Riesgos residuales: 03 §2.5 (diario viejo reaplicado sobre una edición externa más nueva en FS Access) sigue sin comparar `mtime`.

## Plan 4 · Un solo escritor (`ae53d2b`)

Qué cambió (`src/vault/safe.ts`):
- `:50` la cola es compartida por backend (`WeakMap<raw, Promise>`), no por instancia.
- `:89` con `navigator.locks` (detección de característica) cada operación, incluido `recover`, toma el cerrojo `engrama-vault`. Sin `locks` (Node, pruebas) solo la cola compartida, como antes.

Pruebas a `it()` (1): críticos «dos pestañas…». Se ajustó: con un solo escritor A espera a B, así que A se lanza sin esperar, se comprueba que el diario de B sigue y que A no escribió, y al soltar B, A termina. Nueva: con `navigator.locks` simulado cada operación pide el cerrojo.

Riesgos residuales: no se añadió el aviso «abierta en otra pestaña» (BroadcastChannel): sin `locks` (Safari < 15.4) dos pestañas siguen sin coordinarse. Una pestaña suspendida a mitad de operación retiene el cerrojo. El leer-modificar-escribir de nivel superior (p. ej. `appendLines`) se serializa por pestaña, no entre pestañas.

## Plan 5 · appendLines (`65b2a6c`)

Qué cambió:
- `src/vault/util.ts:41` `serialFile` (cola por bóveda y ruta) y `:56` `appendLines` (lectura estricta, añade el salto que falte, acepta una función para filtrar según lo que hay). Va en `vault/util` porque lo usan data, io y screens.
- Lo usan `src/data/collection.ts:141` (`appendLog`), `src/io/import.ts` `mergeLog` (sin duplicados), `src/screens/simulacros.tsx:329` y `src/screens/pomodoro.tsx:75`. `deleteAttempt`/`restoreAttempt` (`src/data/extra.ts:35,44`) usan la misma cola.

Pruebas a `it()` (2): data «dos appendLog simultáneos…» y «appendLog no sustituye reviews.jsonl si la lectura falla». En esta última la aserción original (3 líneas tras una lectura que siempre falla) exigía añadir sin leer; ahora comprueba que rechaza, que quedan las 2 líneas y que al reintentar quedan 3. Nueva de `appendLines` en `tests/vault.test.ts`.

Riesgos residuales: entre pestañas, dos `appendLines` al mismo archivo aún pueden intercalar lectura y escritura (cada escritura es atómica por el cerrojo, el par leer+escribir no). Si `appendLog` falla, `study` no tiene `try/finally` (plan 6).

## Plan 6 · Historial robusto (`e902b2f`)

Qué cambió:
- `src/srs/engine.ts:122,134` `parseLog`: `ts` finito en [0, 2200) y exactamente una de calificación 1–4 u `op` conocida (`suspend`/`unsuspend`/`bury`/`forget`/`undo`); lo demás cuenta como `bad`. Límite inferior 0 (no 2000): los historiales importados y las pruebas usan ts pequeños, que siguen siendo fechas válidas.
- `src/srs/engine.ts:83` `applyReview`: si `ts` es anterior al último repaso (o al «olvidar» de una nueva), usa ese instante + 1 ms y lo escribe en la entrada. `replay` ordena por ts y aplica lo mismo: vivo == replay (y el +1 ms evita que deshacer por `id@ts` anule dos repasos).
- `src/screens/study.tsx:90` `answer` con `try/finally` (`busy` nunca queda en `true`); `:96` y `:118` si el historial no se escribe, el estado en memoria vuelve atrás (en `answer` y `doUndo`).

Pruebas a `it()` (2): críticos «ts fuera de rango», «reloj atrasado». Nuevas: vivo == replay con reloj atrasado y tras olvidar; `parseLog` descarta op desconocida, sin calificación ni op, y calificación con op.

Riesgos residuales: un reloj adelantado (ts futuro < 2200) sigue «arrastrando» los repasos siguientes de esa tarjeta hasta esa fecha (+1 ms cada uno). `doUndo` sigue sin guarda de doble toque.

## Plan 7 · Clave fuerte de state.json (`1a17234`)

Qué cambió:
- `src/srs/engine.ts:10` `ENGINE_VERSION` = `FSRSVersion` de ts-fsrs + versión de `replay` (subir el `+n` si cambia `replay`).
- `src/data/collection.ts:57` `logKey` = nº de entradas + FNV de TODAS las entradas leídas (JSON por línea) + `ENGINE_VERSION` + `paramsKey`. Más simple que la suma de los bytes: `appendLog` no relee el archivo y la caché queda ligada al historial con el que se calcularon los estados (si otra pestaña añadió líneas, no casa y se reconstruye). Una clave del formato anterior solo provoca una reconstrucción.

Pruebas a `it()` (1): críticos «la caché state.json se invalida…». Nueva: reutiliza tras `appendLog` y reconstruye con una clave vieja.

Riesgos residuales: cada `appendLog` serializa todo el historial para la suma (O(n), del mismo orden que el leer+escribir de `appendLines`). FNV-32: colisión ≈ 1/4·10⁹ por edición, además del recuento.

## Plan 8 · IDs únicos y mazo ilegible (`92654be`)

Qué cambió:
- `src/data/collection.ts:93` el historial se lee antes de `ensureIds`; `taken` = IDs de nota del historial + `:94` IDs de los mazos de `.app/papelera-mazos` (`:162` `trashTexts`, solo lectura) + los de `decks/`.
- `src/data/ops.ts:30` `appendCard` añade los IDs del historial.
- `src/data/collection.ts:132` un ID repetido (entre mazos o en el mismo) cuenta solo la primera copia; la segunda queda en el archivo con aviso en los errores del mazo (`collection.id_repetido`, es/en/fr).
- Pendiente del plan 1: `:100` un mazo ilegible se omite en esta sesión; `:145` `archive.json` no se toca (ni archivar ni desarchivar) mientras haya alguno; `state.json` sigue saliendo del historial completo (sus tarjetas conservan el estado); nada se reescribe. `Collection.unreadable` y aviso `app.mazos_ilegibles` (es/en/fr) en `src/app.tsx:95`.

Pruebas a `it()` (3): críticos «un ID nuevo no reutiliza…»; data «un ID repetido en dos mazos…», «un mazo ilegible al cargar no archiva…» (ampliada: el resto carga, aviso, archivo intacto). Nueva: `appendCard` con ID del historial. `tests/move.test.ts` cambia de forma: la copia con `^e1` repetido que escribe a mano sigue en el archivo (3 notas) pero ya no entra al estudio (2 tarjetas, aviso).

Riesgos residuales: con un mazo ilegible, `ensureIds` de los demás no conoce sus IDs sin historial (≈ n/60 M por ID nuevo). `appendCard(…, null)` no conoce el historial.

## Plan 9 · NoteStore sin carreras (`ba46c62`)

Qué cambió:
- `src/lib/autosave.ts:18,26` `pending` cuenta el guardado en vuelo; `flush` devuelve el último guardado y rechaza si falló (temporizador y ocultar la página solo lo registran).
- `src/notes/store.ts:66,69` `refresh` aplica lo leído solo si el texto no cambió mientras leía y no hay guardado pendiente ni en vuelo.
- `src/notes/store.ts:77` `forget` guarda, libera el saver (oyentes) y, con un panel suscrito, deja la entrada cerrada: `:46` `set` no guarda, `:58` se borra con el último oyente, `:37` `load` la reabre desde el disco.
- `src/screens/notes.tsx:208` `NotePanel` monta `NoteEditor` con `key={props.path}`.

Pruebas a `it()` (3): críticos «refresh durante un guardado…», «forget con un panel…»; lib «flush informa del fallo…». Nuevas: lectura de `refresh` que termina tras el guardado; reabrir tras `forget`.

Riesgos residuales: un guardado fallido por temporizador solo se ve en consola hasta el siguiente `flush` (desmontar, mover, papelera), que sí rechaza y llega al aviso global. Teclear en un panel cerrado solo avisa en consola (el panel debería remontarse con la ruta nueva).

## Plan 10 · DeckEditor en NoteStore (`b29ce1e`)

Qué cambió:
- `src/screens/deck.tsx:163` `DeckEditor` usa `noteStore` (load, subscribe, set, flush) y se refresca con `app.version`; `key` en `src/screens/router.tsx:36` y `src/screens/spaces.tsx:802`.
- `src/data/ops.ts:27` `appendCard` añade sobre el documento abierto (con lo tecleado sin guardar) y guarda ya; si no está abierto, escribe en disco.
- `src/data/collection.ts:110` tras `ensureIds`, `refresh` del documento abierto.
- `src/notes/store.ts:21` los mazos no pasan por `afterSave` (versiones e índice de notas); `:43` `peek` = `null` en una entrada cerrada.

Pruebas: sin `it.fails` (02-ui #2 es e2e). Nuevas: `appendCard` con mazo abierto y cambios sin guardar; IDs de `loadCollection` en el editor abierto.

Riesgos residuales: si el editor del mazo tiene cambios sin guardar cuando `loadCollection` añade IDs, `refresh` no los aplica y el guardado del editor los quita (se regeneran distintos en la siguiente carga). `moveCards`, `setDeckMeta` y `moveDeck` siguen escribiendo en disco (el editor se entera por `app.version`).

Verificación de la tanda 6–10: typecheck, vitest (354 + 64 esperadas), build; `e2e`, `e2e:flows`, `e2e:mejoras`, `e2e:mejoras2`, `e2e:barra`, `e2e:p14`, `e2e:p6` en verde con `BROWSER=chromium` a la primera.
