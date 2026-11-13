# Auditoría · 05 · Correcciones aplicadas

Rama `auditoria`. Un commit por punto del PLAN de `03-criticos.md`. Cada punto pasó `npm run typecheck`, `npx vitest run` y `npm run build`. Al final de la tanda (puntos 1–5): `e2e`, `e2e:flows`, `e2e:mejoras`, `e2e:intentos` y `e2e:notaspro` en verde con `BROWSER=chromium` (no hay WebKit en el contenedor).

`it.fails` → `it`: **15** (de 88). Quedan **73**.

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
