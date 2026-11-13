# Auditoría · Etapa 1 · mapa del código

Fecha: 2026-11-13. Rama `auditoria`. Solo lectura: sin cambios en código. Sin graphify (no instalado; ver LOG.md). Cifras: `src/` tiene 22 061 líneas en .ts/.tsx (sin contar CSS ni JSON). Dependencias entre carpetas calculadas leyendo los `import` relativos; los externos son los de `package.json` usados en cada carpeta.

Convención de lectura: `(root)` = archivos sueltos de `src/` (`app.tsx`, `state.tsx`, `theme.ts`, `nav.ts`, `main.tsx`, `sw-register.ts`).

## 1. Mapa por carpeta

Formato de dependencias: `carpeta -> destino(nº de imports)`.

### src/vault/ (11 archivos) · Adaptadores de almacenamiento y escritura segura
- Propósito: abrir la bóveda (OPFS, FS Access o memoria), escribir con diario y suma de verificación, revisar integridad.
- Principales: `open.ts`, `safe.ts`, `types.ts`, `opfs.ts`/`opfs.worker.ts`, `fsaccess.ts`/`handle-fs.ts`, `memory.ts`, `integrity.ts`, `paths.ts`, `util.ts`.
- Exporta: `openVault` (open.ts:67), `storedFolder`/`rememberFolder`/`reconnectFolder` (open.ts:39-53), `SafeVault` (safe.ts:42), `JOURNAL_PATH`/`TMP_DIR` (safe.ts:19-20), `VaultAdapter` (types.ts:15), `OPFSBackend` (opfs.ts:9), `FSAccessBackend` (fsaccess.ts:10), `HandleFS` (handle-fs.ts:48), `MemoryBackend` (memory.ts:7), `checkIntegrity` (integrity.ts:27), utilidades `readTextOr`, `walk`, `checksum` (util.ts).
- Depende de: i18n (2), lib (1). Es la capa más baja.
- Nota: `src/screens/settings.tsx:22` importa `FSAccessBackend` directamente para elegir carpeta (ver zonas críticas).

### src/cards/ (1 archivo) · Parser de mazos
- Propósito: convertir `decks/*.md` en tarjetas (`Q::`/`Respuesta:`), IDs y corrección de respuestas escritas.
- Principal: `parse.ts`. Exporta `parseDeck` (parse.ts), `ensureIds`, `replaceBlock`, `cardsOf`, `newId`, `checkTyped`, `autoGrade`, `levenshtein`, `normalizeAnswer`.
- Depende de: i18n (1), lib (1).

### src/srs/ (2 archivos) · FSRS, reproducción y cola
- Propósito: programar repasos con ts-fsrs, reconstruir estados desde el registro, construir la cola del día.
- Principales: `engine.ts`, `queue.ts`.
- Exporta: `applyReview` (engine.ts:74), `replay` (engine.ts:87), `parseLog` (engine.ts:113), `serializeEntry` (engine.ts:129), `scheduler`/`DEFAULT_PARAMS` (engine.ts:48,39), `buildQueue` (queue.ts:105), `nextCard` (queue.ts:152), `deckCounts` (queue.ts:75), `isLeech` (queue.ts:165), `atRisk` (queue.ts:170).
- Depende de: `ts-fsrs`; data (1), lib (1), cards (1), i18n (1).

### src/data/ (5 archivos) · Colección y operaciones sobre datos
- Propósito: cargar la colección (mazos, tarjetas, estados), escribir revisiones, crear/mover/borrar mazos y tarjetas, papelera de mazos.
- Principales: `collection.ts`, `ops.ts`, `move.ts`, `decktrash.ts`, `extra.ts` (intentos y exámenes).
- Exporta: `loadCollection` (collection.ts:80), `appendLog` (collection.ts:140), `verifyDeterminism` (collection.ts:149), `loadStates`/`serializeStates` (collection.ts:60,76), constantes `REVIEWS`/`STATE`/`ARCHIVE` (collection.ts:14-16), `createDeck` (ops.ts:15), `appendCard` (ops.ts:24), `saveDeckText` (ops.ts:44), `stateOp` (ops.ts:51), `moveDeck`/`moveDecks`/`moveCards`/`moveFolder`/`undoMove` (move.ts:155,208,223,264,29), `trashDecks`/`restoreTrash`/`autoPurge` (decktrash.ts:43,62,81), `deleteAttempt`/`restoreAttempt`/`useExtra` (extra.ts).
- Depende de: vault (12), lib (8), cards (3), srs (3), i18n (2), (root) (1).

### src/lib/ (24 archivos) · Ajustes, estadísticas, exámenes, sonido y utilidades
- Propósito: lógica de negocio sin interfaz: ajustes, días, estadísticas, exámenes y ritmo, Pomodoro, `.ics`, consultas, enlaces, atajos, sonido, mini-mapa del lienzo.
- Principales: `settings.ts`, `stats.ts`, `exams.ts`, `ics.ts`, `calendar-edit.ts`, `keys.ts`, `query.ts`, `links.ts`, `ambient.ts`, `minimap.ts`, `canvaszoom.ts`, `autosave.ts`, `frontmatter.ts`, `usage.ts`, `profile.ts`, `storage.ts`, `perf.ts`, `imgview.ts`.
- Exporta: `loadSettings`/`defaultSettings`/`srsParams`/`studyLimits` (settings.ts), `createAutosave` (autosave.ts:Autosaver), `toICS` (ics.ts:72), `fromICS` (ics.ts:104), `occurrences` (ics.ts:183, RRULE/EXDATE), `editOccurrence`/`deleteOccurrence` (calendar-edit.ts:29,18), `parseExam`/`pace`/`topicStats` (exams.ts), `parseFrontmatter`/`stringifyFrontmatter` (frontmatter.ts), `resolveLink`/`buildLinkIndex` (links.ts), `search`/`compile` (query.ts), `ambient`/`player` (ambient.ts).
- Depende de: i18n (7), vault (6), srs (4), data (3), cards (2), md (1).

### src/sim/ (3 archivos) · Simulacros (bancos de preguntas)
- Propósito: parsear bancos (MD, CSV, JSON), puntuar intentos, borrador de edición, papelera de bancos.
- Principales: `parse.ts`, `draft.ts`, `banktrash.ts`. Exporta `parseBankMarkdown`/`parseBankCSV`/`parseBankJSON` (parse.ts), `score` (parse.ts), `draftQuestion`/`validate` (draft.ts), `autoPurgeBanks` (banktrash.ts).
- Depende de: vault (3), i18n (1), lib (1), io (1).

### src/notes/ (19 archivos) · Notas: modelo, editor, búsqueda, imágenes, miniaturas
- Propósito: notas `.md` (carpetas materia/tema), guardado en vivo, historial de versiones, papelera, editor (formato, barra), búsqueda, fotos, miniaturas y Web Workers.
- Principales: `model.ts`, `store.ts` (documento compartido), `move.ts`, `format.ts`, `editorbar.tsx`, `history.ts`, `sources.ts`, `images.ts`, `imgsize.ts`, `imagebar.tsx`, `thumbs.ts`/`thumb-core.ts`/`thumb.worker.ts`, `search*.ts`/`search.worker.ts`, `io.ts` (exportar docx/PDF, importar docx/PDF), `find.tsx`.
- Exporta: `noteStore` (store.ts:29), `onNoteSaved` (store.ts:18), `notePath` (model.ts:51), `newNoteText` (model.ts:101), `snapshot`/`versions`/`trash`/`restore` (model.ts:154,164,172,187), `moveNotes`/`noteClashes` (move.ts:83,69), `rewriteNoteRefs` (move.ts:45), `markdownToDocx`/`pdfToMarkdown` (io.ts:42,219), `mediaThumbUrl` (thumbs.ts).
- Depende de: vault (11), lib (9), i18n (4), ui (3), md (3), data (1), io (1), cards (1).

### src/md/ (2 archivos) · Markdown seguro e incrustaciones de imagen
- Propósito: render de Markdown con markdown-it y saneado con DOMPurify; sintaxis `![[foto|ancho|alineación|alt]]`.
- Principales: `render.ts`, `embed.ts`. Exporta `renderMarkdown`/`renderMarkdownCached` (render.ts), `sanitize` (render.ts), `parseEmbed`/`serializeEmbed`/`EMBED_RE` (embed.ts:parseEmbed, EMBED_RE).
- Depende de: `markdown-it`, `dompurify`. Sin dependencias internas.

### src/io/ (8 archivos) · Importar, exportar, compartir, Workers de .apkg
- Propósito: leer archivos del usuario (zip, CSV, .apkg, docx/PDF), crear respaldos `.zip`, entregar archivos (Web Share con descarga de respaldo).
- Principales: `import.ts` (plan de importación), `zip.ts` (respaldo), `csv.ts`, `apkg.ts` + `apkg.worker.ts` (Anki), `extract.ts`, `share.ts`, `limits.ts`.
- Exporta: `gather` (import.ts:94), `buildPlan` (import.ts:178), `applyPlan` (import.ts:204), `undoImport` (import.ts:238), `mergeLog` (import.ts:246), `runApkgWorker` (import.ts:264), `isAnkiZip` (import.ts:83), `collectVault`/`buildZip`/`parseZip` (zip.ts:49,58,80), `parseCSV`/`rowsToBlocks`/`guessMapping` (csv.ts), `convertApkg` (apkg.ts:188), `deliver`/`download` (share.ts:29,17), `LIMITS` (limits.ts:2).
- Depende de: vault (8), i18n (4), lib (2), srs (2). Externos: `fflate`, `fzstd`, `sql.js` (WASM), `mammoth`/`turndown`/`docx` vía notes/io.ts.

### src/i18n/ (4 archivos) · Textos es/en/fr
- Propósito: `t()`/`tn()`, idioma del dispositivo, pseudoidioma `xx` para /design.
- Principales: `index.ts`, `es.json`, `en.json`, `fr.json`. Exporta `t` (index.ts:72), `tn` (index.ts:85), `setLang`/`getLang`/`onLang` (index.ts:30,38,42), `raw` (index.ts:66), `allKeys` (index.ts:114), `errMsg` (index.ts:105), `firstDayOfWeek` (index.ts:93).
- Depende de: nada (solo JSON).

### src/ink/ (4 archivos) · Motor de tinta (Apple Pencil, lápiz)
- Propósito: modelo de trazos, borrado, lazo, capa de dibujo sobre notas y PDF.
- Principales: `model.ts` (`parseInk`, `eraseStrokes`, `lassoSelect`, `History`), `InkLayer.tsx`, `InkSurface.tsx`, `DrawingBlock.tsx`.
- Exporta: `parseInk`/`emptyInk` (model.ts), `eraseStrokes`/`eraseArea`/`lassoSelect`/`moveStrokes` (model.ts), `InkLayer`/`InkToolbar` (InkLayer.tsx), `DrawingBlock` (DrawingBlock.tsx).
- Depende de: i18n (2), (root) (2), ui (2), vault (2). Externo: `perfect-freehand`, `lucide-preact`.

### src/pdf/ (4 archivos) · Visor, anotaciones y biblioteca de PDF
- Propósito: abrir PDF por rangos (pdfjs-dist bajo demanda), anotaciones en un JSON por documento, biblioteca, visor virtualizado.
- Principales: `open.ts`, `annots.ts`, `library.ts`, `virtual.ts`.
- Exporta: `PDFDoc`/`PdfLib` y carga (open.ts), `RANGE_CHUNK` (open.ts:16), `parseAnnots`/`emptyAnnots`/`annotsPath`/`legacyPath`/`fromLegacy`/`marksToMarkdown` (annots.ts), `PDF_META`/`updatePdfMeta` (library.ts), `Heights`/`visibleRange`/`RenderQueue` (virtual.ts).
- Depende de: vault (3), ink (1), io (1), lib (1).

### src/share/ (3 archivos) · «Compartir estadísticas» (tarjeta PNG)
- Propósito: calcular cuentas de periodo puras y dibujar la tarjeta en Canvas 2D.
- Principales: `period.ts` (puro), `card.ts` (Canvas 2D), `sheet.tsx` (hoja, `import()` desde Hoy).
- Exporta: `summarize`/`periodRange`/`PERIODS` (period.ts), `compose` (card.ts:compose), `ShareSheet` (sheet.tsx).
- Depende de: lib (8), ui (3), i18n (2), (root) (2), srs (1), vault (1).

### src/tasks/ (2 archivos) · Add-on «Tareas» (`notes/Tareas.md`)
- Propósito: lista de tareas `- [ ]` con fecha 📅, editada como texto.
- Principales: `parse.ts` (puro), `tile.tsx` (mosaico, `import()`).
- Exporta: `parseTasks`, `addTask`, `toggleTask`, `editTask`, `moveTask`, `clearDone`, `isOverdue` (parse.ts). `TASKS_PATH` (parse.ts:1).
- Depende de: i18n (1), (root) (1), ui (1), notes (1 → `noteStore`).

### src/stickies/ (2 archivos) · Add-on «Sticky notes» (`notes/Stickies/<id>.md`)
- Propósito: notas adhesivas como archivos de nota con frontmatter y orden.
- Principales: `model.ts` (puro), `tile.tsx` (mosaico, `import()`).
- Exporta: `parseSticky`/`serializeSticky`/`sortStickies`/`reorder`/`newStickyPath` (model.ts), `STICKY_DIR` (model.ts).
- Depende de: notes (3, `noteStore`), lib (2), ui (2), i18n (1), (root) (1), md (1), vault (1).

### src/ui/ (12 archivos) · Kit visual, capas, fondos y guardián
- Propósito: componentes compartidos (Switch, Segmented, Sheet, Row…), capas flotantes, tooltip, barra inferior del teléfono, pulsación larga, fondos con guardián de legibilidad.
- Principales: `kit.tsx`, `overlay.tsx`, `background.tsx`, `tooltip.tsx`, `phonebar.tsx`, `pressdrag.tsx`, `keys.tsx`, `links.tsx`, `tray.tsx`, `charts.tsx`, `md.tsx`, `perfhud.tsx`.
- Exporta: `useLayer`/`Portal`/`Popover`/`modalOpen` (overlay.tsx:43,70,78,68), `Sheet`/`usePhone`/`FoldCtx`/`Row` (kit.tsx), `paintBackground`/`BackgroundLayer`/`guard` (background.tsx), `usePressDrag`/`pressArmed` (pressdrag.tsx), `PhoneTabBar` (phonebar.tsx), `deleteBackground` (background.tsx:294).
- Depende de: i18n (8), lib (8), (root) (6), vault (4), notes (1), srs (1), cards (1), data (1), screens (1 — `ui/tray.tsx` o similar; revisar).

### src/screens/ (35 archivos) · Pantallas y hojas
- Propósito: todas las pantallas (Hoy, Mazos, Estudio, Notas, Calendario, Estadísticas, Ajustes, Perfil, Respaldo, Importar…) y sus hojas.
- Principales por tamaño: `notes.tsx` (1230), `spaces.tsx` (938), `pdf.tsx` (588), `simulacros.tsx` (577), `settings.tsx` (465), `decks.tsx` (403), `calendar.tsx` (350), `cardview.tsx` (332). Enrutado: `router.tsx` (`Screen`). Estudio: `study.tsx` (`Study`, `speak`). Mover: `move.tsx`, `notemove.tsx`. Respaldo: `backup.tsx` (`BackupSheet`). Importar: `import.tsx` (`ImportSheet`).
- Depende de: lib (66), ui (59), i18n (35), (root) (35), vault (26), notes (25), data (24), io (18), srs (9), md (8), cards (7), ink (6), pdf (6), sim (4). Es la carpeta de mayor acoplamiento.

### Archivos sueltos de src/ (6 .ts/.tsx + sw)
- `main.tsx` (37 líneas): arranque. `app.tsx` (364): componente raíz `App`, carga de colección y comprobación de integridad. `state.tsx` (98): `AppCtx`, `useApp`, `useRoute`, `go`/`href`, `parseHash`. `theme.ts` (97): `applyTheme`, `PHONE_QUERY`, `isPhone`, `trackKeyboard`, `watchFrames`. `nav.ts` (18): `TABS`, `Route`. `sw-register.ts` (45) y `sw.js` (49): service worker. `env.d.ts`: tipos de entorno. `theme-cristal.css` (967): tema.
- Depende de: screens (11), lib (10), ui (8), vault (8), i18n (3), data (3), sim (1), notes (1).

### Grafo de dependencias entre carpetas (resumen)

```
vault  -> i18n, lib
cards  -> i18n, lib
srs    -> i18n, data, lib, cards
data   -> vault, lib, cards, srs, i18n, (root)
lib    -> i18n, vault, srs, data, cards, md
notes  -> vault, lib, i18n, ui, md, io, cards, data
md     -> (solo externos)
io     -> vault, i18n, lib, srs
sim    -> vault, i18n, lib, io
ink    -> i18n, (root), ui, vault
pdf    -> vault, ink, io, lib
share  -> lib, ui, i18n, (root), srs, vault
tasks  -> i18n, (root), ui, notes
stickies -> notes, lib, ui, i18n, (root), md, vault
ui     -> i18n, lib, (root), vault, notes, srs, cards, data, screens
screens-> lib, ui, i18n, (root), vault, notes, data, io, srs, md, cards, ink, pdf, sim
(root) -> screens, lib, ui, vault, i18n, data, sim, notes
```

A nivel de carpeta sí hay ciclos (p. ej. `lib <-> data`, `srs <-> data`, `ui <-> screens`, `ui <-> notes`, `screens <-> (root)`). Madge (etapa 0) reporta 0 ciclos entre archivos; los ciclos de carpeta son de acoplamiento y deben revisarse en la etapa 2 (`ui -> screens` en particular, por ser una dependencia invertida).

## 2. Flujos clave

**2.1 Arrancar y abrir la bóveda**
- `src/main.tsx:14-27`: `boot()` activa teclado y teléfono, registra el SW, llama `openVault()` (main.tsx:18), carga ajustes, aplica tema y renderiza `<App>` (main.tsx:27).
- `src/vault/open.ts:67-95`: prueba en orden: carpeta de FS Access guardada si hay permiso `readwrite` (open.ts:72-76; si no, `folderNeedsPermission`), luego OPFS (open.ts:82, Worker `opfs.ts:17`), y por último memoria (open.ts:90, aviso «nada se guarda» en `open.detail`). Crea `new SafeVault(raw)` (open.ts:93) y llama `recover()` (open.ts:94).
- `app.tsx:92` carga la colección; `app.tsx:104-109` revisa integridad (solo informa) y purga papeleras; `app.tsx:207` carga atajos.

**2.2 Escribir con SafeVault y recuperar tras un fallo**
- `src/vault/safe.ts:66` `write` y `:81` `writeStream` (archivos grandes por trozos) pasan por `serial()` (cola de una operación a la vez) y `commit()` (safe.ts:56).
- `commit()`: escribe el temporal en `.app/tmp/` (safe.ts:57), registra la intención en `.app/journal.json` con ruta, tamaño y suma (safe.ts:59, `checksum`), aplica el cambio y borra diario y temporal (safe.ts:62-63).
- `recover()` (safe.ts:145): si el diario está corrupto (safe.ts:154) no toca el destino; si el temporal coincide en tamaño y suma, completa la escritura (safe.ts:164-171); si no, descarta. Al final borra `.app/tmp` (safe.ts:184).
- `checkIntegrity` (vault/integrity.ts:27) solo lista problemas; ignora diario y temporales.

**2.3 Repasar una tarjeta (cola → FSRS → reviews.jsonl → state.json)**
- Cola: `buildQueue` (srs/queue.ts:105) y `nextCard` (queue.ts:152), con límites de `studyLimits` (lib/settings.ts).
- Respuesta: `study.tsx:93` llama `applyReview` (srs/engine.ts:74, ts-fsrs), luego `study.tsx:95` `appendLog`.
- Persistencia: `data/collection.ts:140` `appendLog` lee `.app/reviews.jsonl` (collection.ts:141), añade la línea (collection.ts:143) y escribe `.app/state.json` (collection.ts:145) con la clave de parámetros.
- Reconstrucción: `loadCollection` (collection.ts:80) y `loadStates` (collection.ts:60) reconstruyen con `replay` (srs/engine.ts:87) desde el registro si el caché no coincide.
- Determinismo: `verifyDeterminism` (collection.ts:149) compara `replay` con el caché; se invoca desde Ajustes (settings.tsx:372). Deshacer: `study.tsx:113`.

**2.4 Importar (.md, .zip, CSV, .apkg en Worker)**
- Entrada: `screens/import.tsx` (`ImportSheet`) → `fromFileList` (io/import.ts:57) → `gather` (import.ts:94): clasifica por `kindOf` (import.ts:21), detecta colección Anki con `isAnkiZip` (import.ts:83), abre zips con `parseZip` (io/zip.ts:80, límites de `io/limits.ts`).
- CSV: `parseCSV` (io/csv.ts:2) → `rowsToBlocks` (csv.ts:57) → tarjetas.
- `.apkg`: `runApkgWorker` (io/import.ts:264) crea `new Worker('apkg.worker.ts')` (import.ts:269) → `convertApkg` (io/apkg.ts:188) con `sql.js` y `fzstd`; errores con código (`ApkgErrorCode`, apkg.ts:49).
- Plan y escritura: `buildPlan` (import.ts:178) marca `new | same | conflict`; `applyPlan` (import.ts:204) escribe por `SafeVault`; `undoImport` (import.ts:238); `mergeLog` (import.ts:246) fusiona el historial FSRS.

**2.5 Crear y mover notas (y mazos)**
- Notas: `screens/notes.tsx:416-418` (`notePath` model.ts:51 + `newNoteText` model.ts:101 + `app.vault.write`). Nota diaria: notes.tsx:119-121. Sin materia → `notes/Sin clasificar`; ver `notePath`.
- Mover notas: `screens/notemove.tsx:30` `runNoteMove` → `notes/move.ts:83` `moveNotes` (clashes en `noteClashes`, move.ts:69; reescritura de enlaces `rewriteNoteRefs`, move.ts:45; deshacer con `Undo`).
- Mover mazos y tarjetas: `screens/move.tsx:36` `runMove` → `data/move.ts`: `moveDecks` (move.ts:208), `moveCards` (move.ts:223), `moveFolder` (move.ts:264); reescritura de referencias en `rewriteDeckRefs` (move.ts:75) y `rewriteSpaces` (move.ts:112); deshacer con `undoMove` (move.ts:29).
- Crear mazo: `data/ops.ts:15` `createDeck`; añadir tarjeta: `ops.ts:24` `appendCard`.

**2.6 Exportar / respaldo**
- `screens/backup.tsx:18` `BackupSheet`: `collectVault` (io/zip.ts:49, sin diario ni cachés: `isExportable` zip.ts:33) → `buildZip` (zip.ts:58, `manifest.json` con formato `engrama-vault`) → `deliver` (io/share.ts:29: Web Share con `File` ya construido, o descarga).
- Exportación de notas a docx/PDF: `notes/io.ts:42` `markdownToDocx` y `notes/io.ts:19` `compatibleMarkdown`.
- Recordatorio de respaldo: `lib/settings.ts` (`backupDue`).

**2.7 Sincronización entre paneles (noteStore)**
- `src/notes/store.ts:29` `noteStore`: un solo documento en memoria por ruta (`docs` Map, store.ts:14). `set` (store.ts ~39) notifica a los listeners y programa el guardado con `createAutosave`. `subscribe` (store.ts) suscribe y vacía al quedarse sin listeners. `refresh` (store.ts:54) recarga si cambió por fuera y no hay cambios pendientes. `forget` (store.ts:61) olvida tras mover o borrar.
- Consumidores: `screens/notes.tsx:614-615`, `stickies/tile.tsx` (líneas 38-76), `tasks/tile.tsx` (líneas 18-25).
- Guardado: `store.ts` escribe con `vault.write` y luego `afterSave` (historial, índice), registrado con `onNoteSaved` (store.ts:18).
- **DeckStore y ExamStore: no existen** en `src/` (búsqueda por nombre sin resultados). Los mazos se sincronizan por recarga completa: `app.tsx` mantiene un contador `version` (app.tsx:108, 115) y vuelve a llamar `loadCollection`. Los exámenes se leen con `loadExams`/`useExtra` (`data/extra.ts`) y `parseExam` (lib/exams.ts). Sin `BroadcastChannel` ni evento `storage`.

**2.8 Calendario (.ics, RRULE/EXDATE)**
- Modelo y texto: `lib/ics.ts` `toICS` (ics.ts:72) escribe `RRULE:FREQ=…;BYDAY=…;UNTIL=…` (ics.ts:81) y `EXDATE` (ics.ts:82); `fromICS` (ics.ts:104) lee `EXDATE` (ics.ts:157) y `RRULE` (ics.ts:158-160).
- Expansión: `occurrences` (ics.ts:183): `MONTHLY` (ics.ts:196), `DAILY`/`WEEKLY` con `BYDAY` (ics.ts:205), filtra `EXDATE` (ics.ts:186-187).
- Edición de una ocurrencia: `lib/calendar-edit.ts` `deleteOccurrence` (:18) y `editOccurrence` (:29) con alcance `one | series` (crean EXDATE y una entrada suelta).
- Pantalla: `screens/calendar.tsx:45` `Calendar`. Enlaces: `lib/links.ts` `resolveLink` (:55).

## 3. Zonas críticas (un error aquí puede perder datos)

- `src/vault/safe.ts` (commit :56, write :66, recover :145): único camino de escritura segura; un fallo en el orden diario→temporal→aplicación o en `recover` pierde o corrompe archivos del usuario.
- `src/vault/handle-fs.ts` (remove :110-117, move :200-216, writeWithWritable :231): escritura directa a FS Access; `remove('')` borra todo y `move` elimina el destino antes de mover.
- `src/vault/opfs.worker.ts` (remove :93, :105) y `src/vault/opfs.ts` (Worker y reintentos): el borrado y el temporal viven en el Worker, fuera de la lógica de `SafeVault`.
- `src/vault/fsaccess.ts` / `src/vault/open.ts` (:72-95): selección de backend; elegir mal (memoria) hace que nada se guarde.
- `src/vault/integrity.ts` (:27): debe solo reportar; cualquier corrección aquí rompe la regla del proyecto.
- `src/data/collection.ts` `appendLog` (:140-146): lee `reviews.jsonl` con `readTextOr(…, '')` (collection.ts:141), así que un error de lectura **sustituye el historial completo por la última línea**. Es el hallazgo de riesgo más alto de esta etapa (pérdida de historial FSRS). Confirmar en la etapa 2.
- `src/data/collection.ts` `loadCollection` (:80-100): escribe IDs en las tarjetas al cargar (`ensureIds` en collection.ts:90, `vault.write` en collection.ts:94). Es una escritura en la ruta de lectura.
- `src/data/collection.ts` `loadStates`/`verifyDeterminism` (:60, :149): si `state.json` se corrompe, `replay` lo reconstruye; un error de `replay` afecta a todo el repaso.
- `src/srs/engine.ts` `applyReview`/`replay` (:74, :87): determinismo FSRS; cualquier cambio altera las fechas de repaso de todos.
- `src/data/move.ts` (`rewriteDeckRefs` :75, `rewriteSpaces` :112, `removeBlock` :134, `moveDeck` :155): reescribe muchos archivos a la vez con deshacer; un fallo a mitad deja referencias rotas.
- `src/notes/move.ts` (`moveNotes` :83, `rewriteNoteRefs` :45): mismo riesgo para notas y enlaces `[[…]]`.
- `src/notes/store.ts` (:29-70): autoguardado y `forget`; `forget` tras mover o borrar puede descartar cambios pendientes si no se espera a `flush`.
- `src/notes/model.ts` `snapshot` (:154-160): borra versiones antiguas (`prev.slice(49)`); `trash`/`restore` (:172, :187) son la única red de seguridad de notas.
- `src/data/decktrash.ts` (`trashDecks` :43, `purgeTrash` :76, `autoPurge` :81): borrado definitivo tras N días (`deckTrashDays`); `src/sim/banktrash.ts` igual para bancos.
- `src/io/import.ts` `applyPlan` (:204) y resolución `replace` (`Resolution`, :170): puede sobrescribir archivos del usuario al importar.
- `src/io/zip.ts` `parseZip` (:80) y `src/io/limits.ts`: lectura de respaldos ajenos; límites de tamaño y de número de archivos (zip bomb).
- `src/io/apkg.ts` `unzstd` (:74), `convertApkg` (:188) y `src/io/apkg.worker.ts`: entrada no confiable; `sql.js` ejecuta consultas sobre el archivo.
- `src/io/extract.ts`: extracción de texto de documentos (sin pruebas, cobertura 2 %, etapa 0).
- `src/io/csv.ts` `rowsToBlocks` (:57) y `src/md/render.ts` `sanitize`: entrada no confiable hacia el DOM; `sanitize` debe conservar DOMPurify con configuración fija.
- `src/notes/images.ts` (`saveImage`, images.ts:17): guarda el original byte a byte; un error aquí pierde la foto original.
- `src/notes/thumbs.ts` (`clearThumbs` :116) y `src/ui/background.tsx` `deleteBackground` (:294): borran archivos de caché y, en el segundo caso, un fondo subido por el usuario.
- `src/screens/settings.tsx:409-411`: elige carpeta con `FSAccessBackend.pick()` y recarga la página; fuera de `openVault`.
- `src/screens/storage.tsx:89`: «Vaciar cachés» (solo debe tocar `.app/` cachés, no datos del usuario; verificar en etapa 2).
- `src/pdf/annots.ts` (`parseAnnots`, `fromLegacy`, `legacyPath`): anotaciones del usuario y migración de formato.
- `src/ink/model.ts` (`parseInk`, `eraseStrokes`): dibujos del usuario; un parseo que descarte trazos pierde contenido.
- `src/tasks/parse.ts` y `src/stickies/model.ts` (`serializeSticky`): reescriben líneas o archivos del usuario.
- `src/data/extra.ts` (`removeLine`, `insertLine`, `deleteAttempt`, `restoreAttempt`): borran intentos y líneas de exámenes.
- `src/lib/settings.ts` (`serializeSettings`, `mergeSettings`): ajustes de la bóveda; un fallo deja la app sin idioma o sin carpeta.
- `src/lib/imgview.ts` y `src/notes/thumbs.ts`: no deben escribir sobre el original (`.app/cache/img/`, `.app/thumbs/`).

## 4. Zonas de riesgo

### 4.1 Los 15 archivos más largos de src/ (líneas)

| # | Archivo | Líneas | Nota |
|---|---|---|---|
| 1 | src/screens/notes.tsx | 1230 | 42 imports; editor, lista y vista de notas |
| 2 | src/theme-cristal.css | 967 | CSS del tema (no TS) |
| 3 | src/screens/spaces.tsx | 938 | lienzo; 36 imports |
| 4 | src/screens/pdf.tsx | 588 | visor de PDF |
| 5 | src/screens/simulacros.tsx | 577 | simulacros |
| 6 | src/ui/background.tsx | 466 | fondos + guardián de legibilidad |
| 7 | src/screens/settings.tsx | 465 | ajustes; 25 imports |
| 8 | src/screens/decks.tsx | 403 | lista de mazos |
| 9 | src/notes/format.ts | 379 | edición pura del editor |
| 10 | src/share/card.ts | 377 | Canvas 2D |
| 11 | src/app.tsx | 364 | raíz de la app |
| 12 | src/notes/model.ts | 358 | modelo de notas (mezcla lógica, Plaud, IA, papelera) |
| 13 | src/screens/calendar.tsx | 350 | calendario |
| 14 | src/screens/cardview.tsx | 332 | vista de tarjeta |
| 15 | src/lib/ambient.ts | 326 | sonido ambiente |

### 4.2 Los 15 archivos con más imports (líneas `^import`)

| # | Archivo | Imports |
|---|---|---|
| 1 | src/screens/notes.tsx | 42 |
| 2 | src/app.tsx | 39 |
| 3 | src/screens/spaces.tsx | 36 |
| 4 | src/screens/settings.tsx | 25 |
| 5 | src/screens/simulacros.tsx | 19 |
| 6 | src/screens/pdf.tsx | 19 |
| 7 | src/screens/calendar.tsx | 19 |
| 8 | src/screens/study.tsx | 18 |
| 9 | src/screens/today.tsx | 17 |
| 10 | src/screens/decks.tsx | 17 |
| 11 | src/screens/deck.tsx | 17 |
| 12 | src/screens/stats.tsx | 16 |
| 13 | src/screens/inbox.tsx | 14 |
| 14 | src/screens/explorar.tsx | 14 |
| 15 | src/share/sheet.tsx | 13 |

Lectura: `screens/notes.tsx` y `app.tsx` son los nodos de mayor acoplamiento y también los de mayor tamaño; cualquier cambio en `vault`, `data` o `lib` los toca. `app.tsx` concentra la carga de datos, la integridad y el contexto.

## 5. Convenciones existentes

- **Nombres**: archivos en minúsculas, `kebab` solo en `calendar-edit.ts`, `search-core.ts`, `thumb-core.ts`, `search-client.ts`. Componentes `PascalCase` en `.tsx`. Workers con sufijo `.worker.ts`. Pruebas: `tests/*.test.ts` (Vitest) y `e2e/*.mjs` (Playwright).
- **Textos de interfaz**: `t()` y `tn()` de `src/i18n/index.ts` (`t` :72, `tn` :85). Constantes de módulo con texto se evitan (se usan funciones o getters: p. ej. `srs/engine.ts:10`, `RATING_LABEL` con `get`).
- **`data-user-content`**: marca el contenido del usuario en la interfaz (p. ej. títulos de nota y mazo). Verificar cobertura en la etapa 2.
- **Tokens `--z-*`**: definidos en `src/theme-cristal.css`; los flotantes pasan por `src/ui/overlay.tsx` (`useLayer` :43, `Portal` :70, `Popover` :78, `modalOpen` :68).
- **Teléfono**: una sola regla `PHONE_QUERY` (`src/theme.ts:39`). En JS, `isPhone()` (theme.ts:41) o `usePhone()` (`ui/kit.tsx`). En CSS, solo bajo `html.is-phone`.
- **Estilos inline de Preact**: números sin `px` automático; se escriben como cadenas (`'12px'`), p. ej. en `ui/kit.tsx` y `screens/notes.tsx`.
- **Add-ons con `import()` perezoso**: `tasks/tile.tsx`, `stickies/tile.tsx`, `share/sheet.tsx` (desde `screens/today.tsx`). Los add-ons apagados por defecto se activan desde el `addons` de ajustes (`screens/addons.tsx`).
- **Escritura**: solo a través de `app.vault` (`SafeVault`), salvo `screens/settings.tsx:409` (ver zonas críticas). `vault.write` (`safe.ts:66`) es el punto de entrada.
- **Workers**: `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })` en `vault/opfs.ts:17`, `notes/thumbs.ts:51`, `notes/search-client.ts:20`, `io/import.ts:269`.
- **Biblioteca de archivos**: rutas de la bóveda como constantes (`REVIEWS`, `STATE`, `ARCHIVE` en `data/collection.ts:14-16`; `JOURNAL_PATH`/`TMP_DIR` en `vault/safe.ts:19-20`; `TASKS_PATH`, `STICKY_DIR`, `FRAMING_PATH`, `DECK_TRASH`, `THUMBS_DIR`).
- **Sin red ni almacenamiento del navegador para datos**: `localStorage` solo para preferencias de vista (`screens/notes.tsx:55-74`); IndexedDB solo para la carpeta FS Access (`vault/open.ts:21`).
- **Sin `beforeunload`** y sin `title` nativo en botones solo-icono (regla de CLAUDE.md; verificar en etapa 2).
- **Pruebas de lógica pura** en `tests/` para `srs`, `cards`, `io`, `lib` (cobertura 72 %; etapa 0).
