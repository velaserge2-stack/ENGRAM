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

## Plan 11 · Mover sin pérdida (`116b38a`)

Qué cambió:
- `src/data/move.ts` `moveCards`: calcula todo, escribe el destino antes que los orígenes y, si una escritura falla, deshace lo escrito y relanza. Los registros de deshacer (`write`/`remove` en `data/move.ts` y `notes/move.ts`) se anotan después de escribir: una escritura atómica fallida no cambió nada.
- `src/screens/move.tsx` (`runMove`, `MoveCardsSheet`) y `src/screens/notemove.tsx` (`runNoteMove`): `try/catch` que deshace el registro parcial, `app.changed()` siempre y aviso `move.fallo` (es/en/fr); `moveNoteFolder` recibe el registro compartido.
- `move(a, a)` no hace nada en `SafeVault`, `MemoryBackend` y `HandleFS`; `HandleFS.move` no borra un destino que sea carpeta.
- `moveNotes`: cambio solo de mayúsculas mira la carpeta por nombre exacto y mueve vía temporal.
- `rewriteNoteRefs`: `[[Título]]` de una nota suelta no se reescribe (el resolvedor va por título).

Pruebas a `it()` (4): críticos «moveCards…»; vault «SafeVault.move(a, a)», «MemoryBackend.move(a, a)»; notes-io «mover una nota suelta…». Nuevas en `move.test.ts` y `notemove.test.ts`.

Riesgos residuales: si el deshacer automático también falla (p. ej. SafeVault bloqueado tras un apply fallido, plan 2), queda lo hecho hasta el fallo y el aviso; `moveDeck` con `merge` sigue sin comprobar IDs repetidos.

## Plan 12 · .apkg hostil (`6ff174f`)

Qué cambió (`src/io/apkg.ts`):
- Rutas de mazos sin `.`/`..` ni punto inicial, ≤ 120 caracteres y ≤ 12 niveles; nombres que se sanean igual reciben «(2)».
- `fieldToMd`: líneas que empiezan con una marca del parser (`Q::`, `A::`, `Cloze:`…) llevan un espacio delante; `# ` se escapa; `<!--` decodificado no crea metadatos; `&#x27;`/`&apos;`. No se escapa el `^` final: sin cortes de bloque, el ID añadido siempre es el último.
- Medios: mapa nombre original → guardado (`safeMediaName`, también sin `[]|#^`) y sin colisiones.
- `unzipSync` con tope total, de entradas y de razón (medios), con aviso; `Map` por `nid` en el historial.

Pruebas a `it()` (5): críticos «..::X», «campo con Q::»; notes-io «nombre de un medio», «dos mazos de Anki», «fieldToMd decodifica &#x27;». Nuevas en `apkg.test.ts`.

Riesgos residuales: el tope total es de 1 GB (el del zip); en un iPad con poca memoria puede seguir siendo mucho.

## Plan 13 · Calendario (`7726d20`)

Qué cambió (`src/lib/ics.ts`, `src/screens/calendar.tsx`):
- `occurrences` salta aritméticamente hasta `from` (sin DST); con `COUNT` cuenta desde el inicio.
- `INTERVAL` (también con `BYDAY`), `COUNT` y `YEARLY`, exportados. Campos opcionales nuevos (`interval`, `count`, `overridden`): los .ics guardados se leen igual.
- `RECURRENCE-ID`: la ocurrencia original no se pinta (`overridden`, no se exporta como EXDATE); la excepción usa `uid#día` en memoria y el UID de la serie al exportar.
- `TRIGGER` con W/D/H/M; `TZID` con `Intl` (zona inexistente → hora local); `unesc` en una pasada; importar no pisa `estudio.ics` ni otro importado.

Pruebas a `it()` (6): críticos «DAILY de hace 16 años», «RECURRENCE-ID», «TRIGGER -P1D», «TZID»; lib «título con \n literal», «INTERVAL=2». Nuevas en `ics.test.ts`.

No hecho: conservar el `RRULE` original completo (`BYMONTHDAY`, `BYSETPOS`…): los importados se guardan como texto y no se reescriben; `EXDATE` con hora UTC real en DST (03 §7.5).

## Plan 14 · Workers con salida (`8612545`)

Qué cambió:
- `src/vault/opfs.ts`: vigilante por inactividad (el Worker serializa, así que un plazo por operación contaría la espera): con pendientes y sin mensajes en 20 s, rechaza con `io`, termina y recrea el Worker.
- `src/notes/search-client.ts`: `onerror` resuelve pendientes, termina el Worker y repuebla el índice local desde una copia (`mirror`).
- `src/io/extract.ts` + `src/screens/spaces.tsx` (`DocxView`): imágenes nombradas por contenido; solo se escribe la que falta.

Pruebas: nuevas en `tests/workers.test.ts` (Worker simulado). Sin `it.fails` (requería dispositivo).

Riesgos residuales: una operación legítima de más de 20 s sin progreso (lectura enorme) se cortaría; `writeBlob` envía progreso y no se ve afectado.

## Plan 15 · Frontmatter sin pérdida (`549614f`)

Qué cambió:
- `src/lib/frontmatter.ts` `setKeys(text, patch)`: solo las líneas de esas claves; el resto byte a byte (bloques, mapas, comentarios, CRLF, BOM).
- Lo usan `ensureFileId`, `moveNotes`, `rewriteDeckRefs`, `renameDeckText`, `setDeckMeta`; el editor de notas conserva el frontmatter al editar el cuerpo y `setFm` solo toca claves cambiadas.
- `scalar`/`fmt`: números solo canónicos (`1.0`, `007` quedan texto), comillas en una pasada, `''` → `""`, `#…` entre comillas.

Pruebas a `it()` (4): lib «ensureFileId no pierde líneas», «barra invertida», «números con forma de texto», «valor que empieza con #». Nuevas en `frontmatter.test.ts`.

Pendiente: inbox, stickies, exams y profile siguen con parse + stringify (archivos de Engrama).

Verificación de la tanda 11–15: typecheck, vitest (385 + 45 esperadas), build; `e2e`, `e2e:flows`, `e2e:mejoras`, `e2e:mejoras2`, `e2e:p6`, `e2e:p10`, `e2e:p12`, `e2e:notaspro` en verde con `BROWSER=chromium` a la primera.

## Menores · lib/data/vault/ui

`it.fails` → `it`: 22 de 22 (lib 6, data 10, vault 4, ui 2). Ninguno resultó «no era error».
- lib · etiqueta `engrama://tag/ecg`: corregido (`resolveLink` compara también `path` sin `tag:`).
- lib · zona horaria inválida: corregido (`mergeSettings` cae a la del dispositivo).
- lib · `pomo` y números de Ajustes: corregido (`mergeSettings` acota `pomo`, `newPerDay`, `reviewLimit`, `maxInterval`, `streakMin`, umbrales, `backupReminderDays`; `app.update` pasa por `mergeSettings`, así que la UI también queda acotada al confirmar el campo). Formato de `settings.json` sin cambios. Prueba nueva.
- lib · `pace` con fecha inválida y `fmtDate`: corregido (ritmo «calculando»; `fmtDate` devuelve el texto tal cual). Textos «días tarde»/«a tiempo» ahora con `t()` (`exams.dias_tarde`, `exams.a_tiempo`, es/en/fr).
- lib · pomodoro con minutos negativos al acortar el trabajo: corregido (`Math.max(0, …)`).
- data · ` ^10` como ID: corregido (un ID de solo dígitos no cuenta; `newId` siempre pone letra).
- data · CRLF en `ensureIds`/`replaceBlock`: corregido (conserva el fin de línea del cuerpo).
- data · oclusión `10,20,,40`: corregido (campo vacío invalida el rectángulo).
- data · `checkTyped`: corregido («casi correcto» solo con ≥ 4 caracteres; respuesta solo de símbolos idéntica es correcta).
- data · deshacer y cupos: corregido (`newIntroducedToday`/`reviewsToday` descuentan `op:'undo'`).
- data · `stateOp` con fallo de escritura: corregido (restaura el estado en memoria).
- data · `loadExtra` con tiempos negativos o no numéricos: corregido (0).
- data · `withSubdecks`: corregido (usa la ruta del archivo, no el `deck:` del frontmatter).
- vault · rutas inválidas síncronas: corregido (métodos `async` en SafeVault, OPFS y FSAccess).
- vault · `MemoryBackend.write` sobre carpeta: corregido (falla como HandleFS).
- vault · nombre > 255 al codificar para OPFS: corregido en `normalizePath` (mide el nombre codificado; un segmento largo con muchas tildes se rechaza con `invalid-path`). Prueba reescrita para afirmar ese invariante.
- vault · `readText` con UTF-8 inválido: corregido sin lanzar (lee estricto y, si falla, como windows-1252: Latin-1 queda legible y se guarda como UTF-8). Limitación: un archivo UTF-8 con un solo byte dañado se lee todo como windows-1252.
- ui · `#/espacios/abrir/…` decodificada dos veces: corregido (`routeFilePath`).
- ui · `study.answer` con `busy` fijo: ya corregido en el plan 8 (try/finally).
- ui · Wake Lock del pomodoro: corregido (libera si ya no corre; lo pide de nuevo al volver a primer plano). Sin prueba (necesita navegador).
- ui · `inbox.archive` doble toque: corregido (guarda con `useRef`); `body.replace` con función (`$&` en nombres). Sin prueba (pantalla).
- ui · campos numéricos de Ajustes: corregido (ver arriba). Simulacros (`numero`, `minutos`, `penalización`, `aprobado`): pendiente, es UI con estado local y no hay validación pura que probar.
- ui · textos fijos sin `t()`: corregido título de Media Session de `ambient.ts` (`addons.n_ambient`).
- pendiente · `inbox.archive` atómico (mover archivos antes de escribir la nota), `deck.tsx` `createObjectURL`, miniaturas de `pdf.tsx`/`pdfs.tsx`, `backup.tsx` sin `catch`, `spaces.tsx` `saveT` único: no son pequeños o necesitan navegador.

## Menores · notes/io/sim (2026-11-13)

`it.fails` → `it`: 23 en `tests/audit-notes-io.test.ts` (0 «no era error»). `readMeta`/`updatePdfMeta` ya estaban corregidos (plan 1).
- sim · lista numerada en «Explicación:» (7): corregido (en modo explicación, «N. » abre pregunta solo si después vienen opciones).
- sim · opción en negritas (8): corregido (`*` final solo marca si no es parte de `**`).
- sim · caso heredado al reimportar (9): corregido (`serializeBank` escribe `Caso::` vacío al cortar el caso; archivos viejos se leen igual).
- sim · id compartido (10): corregido (la primera conserva su id; repetidas `-2`, `-3`). qid con emoji: `codePointAt`; solo cambia el id de preguntas que contienen emoji (resto idéntico); sus intentos viejos quedarían como «en blanco».
- sim · `isCorrect` con repetidas (21) y JSON > 6 opciones (20): corregidos (conjunto; clave `fromCharCode(65+k)`).
- notes · `clearFormat` (12), `compatibleMarkdown` con `|` y `#ancla` (11), `suggestPlace` con tema vacío (22), fecha Plaud local (23), `srtToText`/`plaudGroupKey` (24), `saveImage` mismo ms (16): corregidos. Pendiente de 23: `materia:`/`tema:` vacíos en el frontmatter Plaud (sin prueba; formato).
- md · `[[Nota#Sec]]` enlaza a «Nota» (13), `plainText` sin borrar `_ = >` normales (25): corregidos.
- tasks/stickies/ink · CRLF (15), `stickyTitle` (25), `parseInk` sin size/tool/color (26): corregidos.
- stickies/tile y ink/DrawingBlock (14): corregido (lectura fallida no se trata como vacío; no se escribe encima). `pdf/library`: ya estaba.
- io · separador CSV (17) y `.MD` (18): corregidos.
- pendiente · apkg O(n²) (6), `restore`/`snapshot`/miniaturas y demás sospechas del informe (sin prueba).
