# Auditoría · Etapa 1 · mapa del código

Fecha: 2026-11-14 (actualizado desde e949b30 hasta 32eaaa1; rama `rendimiento-2`). Solo lectura: sin cambios en código. Sin graphify (no instalado; ver LOG.md). Cifras: `src/` tiene 24 052 líneas en .ts/.tsx (sin contar CSS ni JSON). Dependencias entre carpetas calculadas leyendo los `import` relativos; los externos son los de `package.json` usados en cada carpeta.

Convención de lectura: `(root)` = archivos sueltos de `src/` (`app.tsx`, `state.tsx`, `theme.ts`, `nav.ts`, `main.tsx`, `sw-register.ts`).

## 1. Mapa por carpeta

Formato de dependencias: `carpeta -> destino(nº de imports)`.

### src/vault/ (12 archivos) · Adaptadores de almacenamiento y escritura segura
- Propósito: abrir la bóveda (OPFS, FS Access o memoria), escribir con diario y suma de verificación, revisar integridad.
- Principales: `open.ts`, `safe.ts`, `batch.ts` (vista de un lote), `types.ts`, `opfs.ts`/`opfs.worker.ts`, `fsaccess.ts`/`handle-fs.ts`, `memory.ts`, `integrity.ts`, `paths.ts`, `util.ts`.
- Exporta: Staged (batch.ts:15), Batch (batch.ts:23), FSAccessBackend (fsaccess.ts:10), WriteStrategy (handle-fs.ts:12), NameCodec (handle-fs.ts:21), asciiCodec (handle-fs.ts:28), HandleFS (handle-fs.ts:48), writeWithWritable (handle-fs.ts:375), IntegrityReport (integrity.ts:17), checkIntegrity (integrity.ts:35), MemoryBackend (memory.ts:7), rememberFolder (open.ts:48), reconnectFolder (open.ts:53), OpenedVault (open.ts:59), openVault (open.ts:67), OPFSBackend (opfs.ts:13), WorkerRequest (opfs.worker.ts:34), WorkerResponse (opfs.worker.ts:46), normalizePath (paths.ts:10), splitPath (paths.ts:27), basename (paths.ts:32), dirname (paths.ts:37), extname (paths.ts:42), withSuffix (paths.ts:49), JOURNAL_PATH (safe.ts:24), TMP_DIR (safe.ts:25), RecoveryReport (safe.ts:62), BatchOptions (safe.ts:127), batch (safe.ts:136), SafeVault (safe.ts:140), FileStat (types.ts:2), VaultAdapter (types.ts:15), BlobWriteOptions (types.ts:54), VaultError (types.ts:59), enc (util.ts:3), toBytes (util.ts:7), decodeText (util.ts:11), readText (util.ts:15), isNotFound (util.ts:26), readTextOr (util.ts:36), serialFile (util.ts:53), appendLines (util.ts:71), appendLinesAt (util.ts:83), walk (util.ts:96), FNV_INIT (util.ts:115), fnvUpdate (util.ts:117), fnvHex (util.ts:124), checksum (util.ts:125), CHUNK (util.ts:130), blobChecksum (util.ts:133), bytesEqual (util.ts:143).
- Depende de: i18n (2), lib (2). Es la capa más baja.
- Nota: `src/screens/settings.tsx:22` importa `FSAccessBackend` directamente para elegir carpeta (ver zonas críticas).
### src/cards/ (1 archivo) · Parser de mazos
- Propósito: convertir `decks/*.md` en tarjetas (`Q::`/`Respuesta:`), IDs y corrección de respuestas escritas.
- Principal: `parse.ts`.
- Exporta: NoteType (parse.ts:10), Rect (parse.ts:12), Note (parse.ts:19), CardRef (parse.ts:40), ParsedDeck (parse.ts:48), blocks (parse.ts:73), parseDeck (parse.ts:194), cardsOf (parse.ts:211), noteIdOf (parse.ts:225), newId (parse.ts:229), ensureIds (parse.ts:240), carryIds (parse.ts:261), replaceBlock (parse.ts:286), normalizeAnswer (parse.ts:298), levenshtein (parse.ts:307), TypedVerdict (parse.ts:321), checkTyped (parse.ts:323), autoGrade (parse.ts:334).
- Depende de: i18n (1), lib (1).
### src/srs/ (2 archivos) · FSRS, reproducción y cola
- Propósito: programar repasos con ts-fsrs, reconstruir estados desde el registro, construir la cola del día.
- Principales: `engine.ts`, `queue.ts`.
- Exporta: `applyReview` (engine.ts:74), `replay` (engine.ts:87), `parseLog` (engine.ts:113), `serializeEntry` (engine.ts:129), `scheduler`/`DEFAULT_PARAMS` (engine.ts:48,39), `buildQueue` (queue.ts:105), `nextCard` (queue.ts:152), `deckCounts` (queue.ts:75), `isLeech` (queue.ts:165), `atRisk` (queue.ts:170).
- Depende de: `ts-fsrs`; data (1), lib (1), cards (1), i18n (1).

### src/data/ (5 archivos) · Colección y operaciones sobre datos
- Propósito: cargar la colección (mazos, tarjetas, estados), escribir revisiones, crear/mover/borrar mazos y tarjetas, papelera de mazos.
- Principales: `collection.ts`, `ops.ts`, `move.ts`, `decktrash.ts`, `extra.ts` (intentos y exámenes).
- Exporta: REVIEWS (collection.ts:16), STATE (collection.ts:17), ARCHIVE (collection.ts:18), Deck (collection.ts:21), Collection (collection.ts:35), paramsKey (collection.ts:55), loadStates (collection.ts:91), loadCollection (collection.ts:133), appendLog (collection.ts:219), flushState (collection.ts:255), verifyDeterminism (collection.ts:278), DECK_TRASH (decktrash.ts:15), TrashEntry (decktrash.ts:18), withSubdecks (decktrash.ts:27), inFolder (decktrash.ts:33), trashPlan (decktrash.ts:38), trashDecks (decktrash.ts:43), listTrash (decktrash.ts:52), restoreTrash (decktrash.ts:62), purgeTrash (decktrash.ts:76), autoPurge (decktrash.ts:81), ATTEMPTS (extra.ts:9), RemovedLine (extra.ts:12), removeLine (extra.ts:18), insertLine (extra.ts:26), deleteAttempt (extra.ts:34), restoreAttempt (extra.ts:43), loadExtra (extra.ts:47), useExtra (extra.ts:67), Undo (move.ts:24), Clash (move.ts:25), undoMove (move.ts:30), canMoveTo (move.ts:57), clashOf (move.ts:62), rewriteSpaces (move.ts:114), removeBlock (move.ts:136), moveDeck (move.ts:156), moveDecks (move.ts:212), IdClash (move.ts:221), moveCards (move.ts:229), moveFolder (move.ts:282), safeName (ops.ts:12), createDeck (ops.ts:16), appendCard (ops.ts:25), setDeckMeta (ops.ts:40), stateOp (ops.ts:47), mediaRefs (ops.ts:72), resolveMedia (ops.ts:77).
- Depende de: vault (13), lib (8), cards (3), srs (3), i18n (2), notes (2), (root) (1).
### src/lib/ (25 archivos) · Ajustes, estadísticas, exámenes, sonido y utilidades
- Propósito: lógica de negocio sin interfaz: ajustes, días, estadísticas, exámenes y ritmo, Pomodoro, `.ics`, consultas, enlaces, atajos, sonido, paleta y contraste, encuadre de fotos, perfil, almacenamiento, rendimiento y mini-mapa del lienzo.
- Principales: `settings.ts`, `stats.ts`, `exams.ts`, `ics.ts`, `calendar-edit.ts`, `keys.ts`, `query.ts`, `links.ts`, `ambient.ts`, `noise.ts`, `palette.ts`, `framing.ts`, `minimap.ts`, `canvaszoom.ts`, `autosave.ts`, `frontmatter.ts`, `usage.ts`, `profile.ts`, `storage.ts`, `perf.ts`, `perfhooks.ts`, `imgview.ts`, `example.ts`, `pomodoro.ts`, `days.ts`.
- Exporta: audioSession (ambient.ts:36), AudioError (ambient.ts:44), onAudioError (ambient.ts:46), ambient (ambient.ts:152), player (ambient.ts:271), Autosaver (autosave.ts:5), createAutosave (autosave.ts:12), Scope (calendar-edit.ts:8), onDate (calendar-edit.ts:12), deleteOccurrence (calendar-edit.ts:18), editOccurrence (calendar-edit.ts:29), ZOOM_MIN (canvaszoom.ts:13), ZOOM_MAX (canvaszoom.ts:14), View (canvaszoom.ts:15), clampZoom (canvaszoom.ts:17), resist (canvaszoom.ts:20), zoomAt (canvaszoom.ts:27), WorldRect (canvaszoom.ts:41), onScreen (canvaszoom.ts:42), awakePanels (canvaszoom.ts:46), LITE_ZOOM (canvaszoom.ts:52), dayKey (days.ts:57), addDays (days.ts:68), weekdayMon (days.ts:74), Streaks (days.ts:79), streaks (days.ts:87), heatLevels (days.ts:109), heatGrid (days.ts:118), heatWeeks (days.ts:128), daysBetween (days.ts:134), exampleFiles (example.ts:2), Exam (exams.ts:20), parseExam (exams.ts:32), serializeExam (exams.ts:50), decksForTopic (exams.ts:56), TopicStat (exams.ts:64), topicStats (exams.ts:74), PaceStatus (exams.ts:96), Pace (exams.ts:98), pace (exams.ts:115), fmtDate (exams.ts:150), newPerDayMap (exams.ts:155), projectedRetention (exams.ts:168), examCids (exams.ts:183), FRAMING_PATH (framing.ts:7), Framing (framing.ts:9), DEFAULT_FRAMING (framing.ts:10), normFraming (framing.ts:14), parseFramings (framing.ts:19), isDefault (framing.ts:29), framedRect (framing.ts:32), framingStyle (framing.ts:41), Frontmatter (frontmatter.ts:9), ParsedDoc (frontmatter.ts:11), parseFrontmatter (frontmatter.ts:58), stringifyFrontmatter (frontmatter.ts:112), headOf (frontmatter.ts:119), rewriteDoc (frontmatter.ts:128), setKeys (frontmatter.ts:138), EventKind (ics.ts:11), KINDS (ics.ts:12), WEEKDAYS (ics.ts:13), StudyBlock (ics.ts:14), toICS (ics.ts:120), fromICS (ics.ts:174), occurrences (ics.ts:269), STEPS (imgview.ts:10), SAFARI_MAX_PX (imgview.ts:15), neededSide (imgview.ts:22), stepFor (imgview.ts:27), tooBig (imgview.ts:32), scaled (imgview.ts:34), imageSize (imgview.ts:47), reducedImage (imgview.ts:67), Scope (keys.ts:9), ActionDef (keys.ts:10), ACTIONS (keys.ts:12), RESERVED (keys.ts:67), KeyConfig (keys.ts:69), KEYMAP_PATH (keys.ts:70), defaultConfig (keys.ts:71), parseConfig (keys.ts:73), keysOf (keys.ts:88), padOf (keys.ts:91), bindingOf (keys.ts:97), isTyping (keys.ts:108), hasModifier (keys.ts:112), conflicts (keys.ts:115), resolve (keys.ts:134), padActions (keys.ts:148), PAD_NAMES (keys.ts:153), showKey (keys.ts:156), LinkKind (links.ts:13), LinkTarget (links.ts:15), LinkIndex (links.ts:23), Resolved (links.ts:30), parseUri (links.ts:38), makeUri (links.ts:50), resolveLink (links.ts:56), studyFilter (links.ts:72), ensureFileId (links.ts:78), buildLinkIndex (links.ts:88), Box (minimap.ts:10), MAP_W (minimap.ts:12), MapFit (minimap.ts:13), viewBox (minimap.ts:16), mapFit (minimap.ts:19), toMap (minimap.ts:31), toWorld (minimap.ts:33), mapBox (minimap.ts:35), centerOn (minimap.ts:40), SoundId (noise.ts:6), SOUNDS (noise.ts:7), generate (noise.ts:67), fadeGain (noise.ts:115), sleepAt (noise.ts:122), wav (noise.ts:129), mix (noise.ts:141), ColorName (palette.ts:16), COLOR_NAMES (palette.ts:17), COLOR_LABEL (palette.ts:19), contrast (palette.ts:35), readableOn (palette.ts:41), resolveColor (palette.ts:45), WORST_GLASS (palette.ts:61), accentVariant (palette.ts:64), perf (perf.ts:6), countGetPage (perf.ts:15), install (perfhooks.ts:20), Phase (pomodoro.ts:7), PomoConfig (pomodoro.ts:9), PomoState (pomodoro.ts:16), PomoSession (pomodoro.ts:30), PHASE_LABEL (pomodoro.ts:38), initial (pomodoro.ts:40), duration (pomodoro.ts:44), remaining (pomodoro.ts:48), start (pomodoro.ts:52), pause (pomodoro.ts:57), reset (pomodoro.ts:62), skip (pomodoro.ts:73), tick (pomodoro.ts:89), fmt (pomodoro.ts:96), parseSessions (pomodoro.ts:101), PROFILE_PATH (profile.ts:8), PHOTO_DIR (profile.ts:9), Profile (profile.ts:11), EMPTY_PROFILE (profile.ts:27), parseProfile (profile.ts:29), serializeProfile (profile.ts:40), initial (profile.ts:53), normUsername (profile.ts:58), usernameError (profile.ts:64), Row (query.ts:11), compile (query.ts:47), rows (query.ts:88), search (query.ts:110), SETTINGS_PATH (settings.ts:5), Background (settings.ts:9), Settings (settings.ts:15), ACCENT_USES (settings.ts:79), AccentUse (settings.ts:80), ACCENT_DEFAULT_USES (settings.ts:81), defaultSettings (settings.ts:91), mergeSettings (settings.ts:144), loadSettings (settings.ts:203), serializeSettings (settings.ts:212), backupDue (settings.ts:219), srsParams (settings.ts:227), studyLimits (settings.ts:231), MATURE (stats.ts:11), DayAct (stats.ts:13), Extra (stats.ts:20), activity (stats.ts:25), studyMs (stats.ts:39), todayProgress (stats.ts:44), doneToday (stats.ts:57), pending (stats.ts:70), trueRetention (stats.ts:92), accuracy (stats.ts:97), efficiency (stats.ts:110), newLearned (stats.ts:124), forecast (stats.ts:133), consistency (stats.ts:146), histogram (stats.ts:158), avgDaily (stats.ts:169), StorageInfo (storage.ts:2), requestPersist (storage.ts:9), storageInfo (storage.ts:19), isStandalone (storage.ts:34), formatBytes (storage.ts:41), Kind (usage.ts:5), KINDS (usage.ts:6), REGENERABLE (usage.ts:9), kindOf (usage.ts:11), DELETABLE (usage.ts:25), refsIn (usage.ts:28), countUses (usage.ts:40), orphans (usage.ts:56).
- Depende de: i18n (8), vault (8), data (5), srs (5), notes (3), cards (2), io (1), md (1). Externo: `ts-fsrs`.
### src/sim/ (3 archivos) · Simulacros (bancos de preguntas)
- Propósito: parsear bancos (MD, CSV, JSON), puntuar intentos, borrador de edición, papelera de bancos.
- Principales: `parse.ts`, `draft.ts`, `banktrash.ts`.
- Exporta: BANK_TRASH (banktrash.ts:16), BankTrashEntry (banktrash.ts:19), trashBank (banktrash.ts:23), listBankTrash (banktrash.ts:32), restoreBank (banktrash.ts:55), purgeBank (banktrash.ts:64), autoPurgeBanks (banktrash.ts:69), DraftQ (draft.ts:9), Draft (draft.ts:10), MAX_OPTIONS (draft.ts:12), emptyQ (draft.ts:15), bankToDraft (draft.ts:17), draftToBank (draft.ts:33), validate (draft.ts:38), move (draft.ts:45), Question (parse.ts:16), Bank (parse.ts:28), qid (parse.ts:35), legacyQid (parse.ts:42), pastResults (parse.ts:49), pastResult (parse.ts:56), finalize (parse.ts:72), parseText (parse.ts:92), parseBankMarkdown (parse.ts:164), parseBankCSV (parse.ts:175), parseBankJSON (parse.ts:195), summarize (parse.ts:208), serializeBank (parse.ts:219), MAX_MINUTES (parse.ts:238), clampMinutes (parse.ts:241), simConfig (parse.ts:244), isCorrect (parse.ts:253), Score (parse.ts:259), score (parse.ts:268), byTopic (parse.ts:281), timeLeft (parse.ts:294).
- Depende de: vault (3), i18n (1), lib (1), io (1).
### src/notes/ (20 archivos) · Notas: modelo, editor, búsqueda, imágenes, miniaturas
- Propósito: notas `.md` (carpetas materia/tema), guardado en vivo, historial de versiones, papelera, editor (formato, barra), búsqueda, fotos, miniaturas y Web Workers.
- Principales: `model.ts`, `store.ts` (documento compartido), `move.ts`, `format.ts`, `editorbar.tsx`, `history.ts`, `sources.ts`, `images.ts`, `imgsize.ts`, `imagebar.tsx`, `thumbs.ts`/`thumb-core.ts`/`thumb.worker.ts`, `search.ts`/`search-core.ts`/`search-client.ts`/`search.worker.ts`, `textcache.ts` (caché de textos), `io.ts` (exportar y importar docx/PDF), `find.tsx`.
- Exporta: BarState (editorbar.tsx:15), Action (editorbar.tsx:26), EditorBar (editorbar.tsx:43), pendingFind (find.tsx:7), FindBar (find.tsx:65), Sel (format.ts:7), Mark (format.ts:9), COLORS (format.ts:10), SIZES (format.ts:11), ALIGNS (format.ts:12), Align (format.ts:13), activeMarks (format.ts:47), toggleMark (format.ts:59), setSpanClass (format.ts:100), clearFormat (format.ts:119), paragraphAt (format.ts:136), onParagraph (format.ts:155), Style (format.ts:165), styleOf (format.ts:168), setStyle (format.ts:185), alignOf (format.ts:197), setAlign (format.ts:199), ListKind (format.ts:207), toggleList (format.ts:218), indent (format.ts:234), moveListItem (format.ts:248), Table (format.ts:271), makeTable (format.ts:274), tableAt (format.ts:279), fmt (format.ts:301), TableOp (format.ts:308), tableOp (format.ts:309), moveBlock (format.ts:335), duplicateBlock (format.ts:350), removeBlock (format.ts:351), mergeWithPrev (format.ts:352), listAt (format.ts:358), paraMap (format.ts:369), createHistory (history.ts:6), History (history.ts:40), ImageBar (imagebar.tsx:15), setPhotoQuality (images.ts:13), saveImage (images.ts:17), imageSize (imgsize.ts:6), compatibleMarkdown (io.ts:19), DocxOpts (io.ts:35), markdownToDocx (io.ts:42), htmlToMarkdown (io.ts:194), docxToMarkdown (io.ts:213), pdfToMarkdown (io.ts:219), DAILY (model.ts:15), NoteMeta (model.ts:19), noteMeta (model.ts:27), safeSegment (model.ts:37), notePath (model.ts:51), listNotes (model.ts:58), Tree (model.ts:62), buildTree (model.ts:67), TEMPLATES (model.ts:86), fillTemplate (model.ts:95), newNoteText (model.ts:101), wikilinks (model.ts:110), LinkIndex (model.ts:114), linkIndex (model.ts:120), unlinkedMentions (model.ts:136), outline (model.ts:142), snapshot (model.ts:155), versions (model.ts:165), readVersion (model.ts:169), trash (model.ts:173), trashList (model.ts:179), restore (model.ts:188), paragraphs (model.ts:197), coverage (model.ts:204), buildPrompt (model.ts:225), parseAiResponse (model.ts:244), withOrigin (model.ts:250), PlaudKind (model.ts:256), plaudKind (model.ts:258), plaudGroupKey (model.ts:271), srtToText (model.ts:280), localDate (model.ts:285), classNoteFromPlaud (model.ts:287), glossarySuggestions (model.ts:319), replaceAll (model.ts:339), suggestPlace (model.ts:347), dirOf (model.ts:362), NoteClash (move.ts:24), noteDir (move.ts:30), noteFolders (move.ts:36), rewriteNoteRefs (move.ts:47), refsRewriter (move.ts:68), noteClashes (move.ts:107), moveNotes (move.ts:121), moveNoteFolder (move.ts:201), notesIndex (search-client.ts:53), Filters (search-core.ts:7), Result (search-core.ts:8), searchCore (search-core.ts:10), fold (search.ts:26), tokenize (search.ts:28), SearchDoc (search.ts:43), createIndex (search.ts:45), Hit (search.ts:62), findHits (search.ts:65), snippet (search.ts:85), remapSources (sources.ts:11), onNoteSaved (store.ts:19), onNoteSaveFailed (store.ts:23), noteStore (store.ts:47), noteTexts (textcache.ts:53), THUMB_LONG (thumb-core.ts:7), makeThumb (thumb-core.ts:18), THUMBS_DIR (thumbs.ts:14), Shown (thumbs.ts:18), dimsOf (thumbs.ts:25), loadDims (thumbs.ts:30), remember (thumbs.ts:35), mediaThumbUrl (thumbs.ts:97), releaseThumb (thumbs.ts:106), clearThumbs (thumbs.ts:114), convertForExport (thumbs.ts:122), swapToOriginals (thumbs.ts:142).
- Depende de: vault (14), lib (9), i18n (4), ui (3), md (3), io (2), cards (1), data (1). Externos: `lucide-preact`, `preact`, `markdown-it`, `docx`, `turndown`, `minisearch`.
### src/md/ (2 archivos) · Markdown seguro e incrustaciones de imagen
- Propósito: render de Markdown con markdown-it y saneado con DOMPurify; sintaxis `![[foto|ancho|alineación|alt]]`.
- Principales: `render.ts`, `embed.ts`.
- Exporta: Align (embed.ts:10), Embed (embed.ts:11), parseEmbed (embed.ts:15), serializeEmbed (embed.ts:35), IMG_EXT (embed.ts:44), rewriteImageEmbed (embed.ts:49), nthImageEmbed (embed.ts:59), textBeside (embed.ts:72), removeImageEmbed (embed.ts:94), sanitize (render.ts:149), renderMarkdown (render.ts:162), renderMarkdownCached (render.ts:173), renderCacheSize (render.ts:185), renderInline (render.ts:187), renderCloze (render.ts:199), plainText (render.ts:207).
- Depende de: sin dependencias internas. Externos: `markdown-it`, `dompurify`.
### src/io/ (8 archivos) · Importar, exportar, compartir, Workers de .apkg
- Propósito: leer archivos del usuario (zip, CSV, .apkg, docx/PDF), crear respaldos `.zip`, entregar archivos (Web Share con descarga de respaldo).
- Principales: `import.ts` (plan de importación), `zip.ts` (respaldo), `csv.ts`, `apkg.ts` + `apkg.worker.ts` (Anki), `extract.ts`, `share.ts`, `limits.ts`.
- Exporta: SqlJs (apkg.ts:17), ApkgResult (apkg.ts:21), safeMediaName (apkg.ts:33), fieldToMd (apkg.ts:44), ApkgErrorCode (apkg.ts:65), ApkgError (apkg.ts:66), zstdDeclared (apkg.ts:76), unzstd (apkg.ts:90), pbFields (apkg.ts:111), metaVersion (apkg.ts:137), mediaEntries (apkg.ts:143), convertApkg (apkg.ts:204), parseCSV (csv.ts:2), CsvMapping (csv.ts:32), guessMapping (csv.ts:41), rowsToBlocks (csv.ts:58), pdfjs (extract.ts:11), PdfText (extract.ts:18), pdfText (extract.ts:23), docxToHtml (extract.ts:49), extractText (extract.ts:66), Kind (import.ts:20), kindOf (import.ts:22), placeLoose (import.ts:32), IncomingFile (import.ts:46), STREAM_FROM (import.ts:55), fromFileList (import.ts:58), Gathered (import.ts:67), GatherOptions (import.ts:79), isAnkiZip (import.ts:84), gather (import.ts:95), Resolution (import.ts:172), PlanItem (import.ts:174), buildPlan (import.ts:180), ApplyResult (import.ts:209), applyPlan (import.ts:216), undoImport (import.ts:256), mergeLog (import.ts:266), runApkgWorker (import.ts:282), LIMITS (limits.ts:2), Limits (limits.ts:14), DeliverResult (share.ts:7), download (share.ts:17), deliver (share.ts:29), stamp (share.ts:43), FORMAT_VERSION (zip.ts:14), Manifest (zip.ts:17), VaultFile (zip.ts:25), isExportable (zip.ts:33), countFiles (zip.ts:37), collectVault (zip.ts:49), buildZip (zip.ts:60), zipVault (zip.ts:79), ParsedZip (zip.ts:130), parseZip (zip.ts:139).
- Depende de: vault (10), i18n (4), lib (2), srs (2). Externos: `fflate`, `fzstd`, `sql.js` (WASM), `pdfjs-dist` y `mammoth` (`extract.ts`); `docx`/`turndown` se usan en notes/io.ts.
### src/i18n/ (4 archivos) · Textos es/en/fr
- Propósito: `t()`/`tn()`, idioma del dispositivo, pseudoidioma `xx` para /design.
- Principales: `index.ts`, `es.json`, `en.json`, `fr.json`.
- Exporta: Lang (index.ts:10), LANGS (index.ts:11), deviceLang (index.ts:24), setLang (index.ts:30), getLang (index.ts:38), locale (index.ts:43), raw (index.ts:61), t (index.ts:67), tn (index.ts:80), firstDayOfWeek (index.ts:88), errMsg (index.ts:100).
- Depende de: nada (solo JSON).
### src/ink/ (4 archivos) · Motor de tinta (Apple Pencil, lápiz)
- Propósito: modelo de trazos, borrado, lazo, capa de dibujo sobre notas y PDF.
- Principales: `model.ts` (`parseInk`, `eraseStrokes`, `lassoSelect`, `History`), `InkLayer.tsx`, `InkSurface.tsx`, `DrawingBlock.tsx`.
- Exporta: DRAW_RE (DrawingBlock.tsx:18), Paper (DrawingBlock.tsx:19), Drawing (DrawingBlock.tsx:20), PAGE_H (DrawingBlock.tsx:21), parseDrawing (DrawingBlock.tsx:25), drawingHeight (DrawingBlock.tsx:34), createDrawing (DrawingBlock.tsx:40), DrawingBlock (DrawingBlock.tsx:82), InkTools (InkLayer.tsx:7), defaultTools (InkLayer.tsx:8), paintInk (InkLayer.tsx:11), InkLayer (InkLayer.tsx:38), InkToolbar (InkLayer.tsx:197), useInkTools (InkSurface.tsx:8), InkSurface (InkSurface.tsx:17), Tool (model.ts:11), FingerMode (model.ts:12), Pt (model.ts:13), Stroke (model.ts:15), InkDoc (model.ts:16), emptyInk (model.ts:17), INK_COLORS (model.ts:20), SIZES (model.ts:21), strokeId (model.ts:24), parseInk (model.ts:26), outline (model.ts:37), svgPath (model.ts:43), eraseStrokes (model.ts:63), eraseArea (model.ts:69), lassoSelect (model.ts:95), moveStrokes (model.ts:99), straighten (model.ts:104), inkHeight (model.ts:112), acceptPointer (model.ts:120), History (model.ts:128).
- Depende de: i18n (2), (root) (2), ui (2), vault (2). Externos: `perfect-freehand`, `lucide-preact`, `preact`.
### src/pdf/ (4 archivos) · Visor, anotaciones y biblioteca de PDF
- Propósito: abrir PDF por rangos (pdfjs-dist bajo demanda), anotaciones en un JSON por documento, biblioteca, visor virtualizado.
- Principales: `open.ts`, `annots.ts`, `library.ts`, `virtual.ts`.
- Exporta: MarkKind (annots.ts:10), Rect (annots.ts:11), Mark (annots.ts:12), Sticky (annots.ts:13), PageAnn (annots.ts:14), Annots (annots.ts:15), annotsPath (annots.ts:17), legacyPath (annots.ts:18), emptyAnnots (annots.ts:19), emptyPage (annots.ts:20), fingerprint (annots.ts:23), fingerprintFile (annots.ts:28), samePdf (annots.ts:33), parseAnnots (annots.ts:35), fromLegacy (annots.ts:49), CharBox (annots.ts:65), snapToText (annots.ts:72), marksToMarkdown (annots.ts:99), PDF_META (library.ts:9), PdfMeta (library.ts:10), readMeta (library.ts:12), updatePdfMeta (library.ts:19), listPdfs (library.ts:30), pdfLink (library.ts:36), progress (library.ts:37), PDFDoc (open.ts:12), fileOf (open.ts:18), openPdfFile (open.ts:24), Heights (virtual.ts:12), visibleRange (virtual.ts:58), RenderQueue (virtual.ts:66), fitPixels (virtual.ts:98).
- Depende de: vault (3), ink (1), io (1), lib (1).
### src/share/ (3 archivos) · «Compartir estadísticas» (tarjeta PNG)
- Propósito: calcular cuentas de periodo puras y dibujar la tarjeta en Canvas 2D.
- Principales: `period.ts` (puro), `card.ts` (Canvas 2D), `sheet.tsx` (hoja, `import()` desde Hoy).
- Exporta: `summarize`/`periodRange`/`PERIODS` (period.ts), `compose` (card.ts:compose), `ShareSheet` (sheet.tsx).
- Depende de: lib (8), ui (3), i18n (2), (root) (2), srs (1), vault (1).

### src/tasks/ (2 archivos) · Add-on «Tareas» (`notes/Tareas.md`)
- Propósito: lista de tareas `- [ ]` con fecha 📅, editada como texto.
- Principales: `parse.ts` (puro), `tile.tsx` (mosaico, `import()`).
- Exporta: TASKS_PATH (parse.ts:9), Task (parse.ts:11), parseTasks (parse.ts:26), addTask (parse.ts:52), toggleTask (parse.ts:72), editTask (parse.ts:73), setLevel (parse.ts:75), removeTask (parse.ts:82), clearDone (parse.ts:92), moveTask (parse.ts:103), pendingCount (parse.ts:122), isOverdue (parse.ts:123), TasksCount (tile.tsx:29), TasksTile (tile.tsx:37).
- Depende de: i18n (1), (root) (1), ui (1), notes (1 → `noteStore`).
### src/stickies/ (2 archivos) · Add-on «Sticky notes» (`notes/Stickies/<id>.md`)
- Propósito: notas adhesivas como archivos de nota con frontmatter y orden.
- Principales: `model.ts` (puro), `tile.tsx` (mosaico, `import()`).
- Exporta: STICKY_DIR (model.ts:17), StickyColor (model.ts:18), STICKY_COLORS (model.ts:19), Sticky (model.ts:21), parseSticky (model.ts:36), serializeSticky (model.ts:50), sortStickies (model.ts:58), reorder (model.ts:66), newStickyPath (model.ts:77), stickyTitle (model.ts:85), asNote (model.ts:91), StickiesTile (tile.tsx:24).
- Depende de: notes (3, `noteStore`), lib (2), ui (2), i18n (1), (root) (1), md (1), vault (1).
### src/ui/ (13 archivos) · Kit visual, capas, fondos y guardián
- Propósito: componentes compartidos (Switch, Segmented, Sheet, Row…), capas flotantes, tooltip, barra inferior del teléfono, pulsación larga, fondos con guardián de legibilidad, avatar de perfil.
- Principales: `kit.tsx`, `overlay.tsx`, `background.tsx`, `tooltip.tsx`, `phonebar.tsx`, `pressdrag.tsx`, `keys.tsx`, `links.tsx`, `tray.tsx`, `charts.tsx`, `md.tsx`, `perfhud.tsx`, `avatar.tsx`.
- Exporta: useProfile (avatar.tsx:9), Avatar (avatar.tsx:16), BUILTINS (background.tsx:34), SOLIDS (background.tsx:99), forgetMediaUrl (background.tsx:104), mediaUrl (background.tsx:131), acquireMediaUrl (background.tsx:135), releaseMediaUrl (background.tsx:139), blurInto (background.tsx:180), paintBackground (background.tsx:210), backgroundImage (background.tsx:234), sampleBackground (background.tsx:241), importBackground (background.tsx:253), regenThumb (background.tsx:279), deleteBackground (background.tsx:294), BuiltinThumb (background.tsx:298), BackgroundLayer (background.tsx:309), glassInk (background.tsx:354), glassAlpha (background.tsx:360), panelContrast (background.tsx:365), GuardResult (background.tsx:378), guard (background.tsx:385), signContrast (background.tsx:443), toneSign (background.tsx:450), Bars (charts.tsx:13), Lines (charts.tsx:36), keymap (keys.tsx:11), useKeymap (keys.tsx:18), actionLabel (keys.tsx:24), Via (keys.tsx:25), useKeyScope (keys.tsx:56), GlobalKeys (keys.tsx:75), KeyFeedback (keys.tsx:98), ShortcutSheet (keys.tsx:124), Switch (kit.tsx:8), Segmented (kit.tsx:17), Row (kit.tsx:29), FoldCtx (kit.tsx:45), Group (kit.tsx:47), usePhone (kit.tsx:82), Sheet (kit.tsx:88), PageTitle (kit.tsx:112), Empty (kit.tsx:124), Num (kit.tsx:136), KV (kit.tsx:141), Ring (kit.tsx:151), Bar (kit.tsx:167), useLinkIndex (links.tsx:15), LinkChips (links.tsx:45), LinkPicker (links.tsx:72), startBlock (links.tsx:102), useLinkedEvents (links.tsx:135), LinkedEvents (links.tsx:152), hydrateAllMedia (md.tsx:32), Html (md.tsx:47), useLayer (overlay.tsx:43), modalOpen (overlay.tsx:68), Portal (overlay.tsx:70), Popover (overlay.tsx:78), PerfHud (perfhud.tsx:27), PhoneTabBar (phonebar.tsx:15), pressArmed (pressdrag.tsx:12), usePressDrag (pressdrag.tsx:14), TooltipLayer (tooltip.tsx:23), TrayItem (tray.tsx:14), shrinkToTray (tray.tsx:27), growIn (tray.tsx:41), MinButton (tray.tsx:46), Tray (tray.tsx:54), useHoyTray (tray.tsx:110), Minimizable (tray.tsx:134).
- Depende de: lib (10), i18n (8), (root) (7), vault (6), cards (1), srs (1), data (1), notes (1), screens (1 — revisar). Externos: `lucide-preact`, `preact`.
### src/screens/ (36 archivos) · Pantallas y hojas
- Propósito: todas las pantallas (Hoy, Mazos, Estudio, Notas, Calendario, Estadísticas, Ajustes, Perfil, Respaldo, Importar, Bandeja, Pomodoro, Add-ons, Explorar…) y sus hojas.
- Principales por tamaño: `notes.tsx` (1256), `spaces.tsx` (940), `pdf.tsx` (589), `simulacros.tsx` (577), `settings.tsx` (456), `decks.tsx` (403), `calendar.tsx` (353), `cardview.tsx` (332). Enrutado: `router.tsx` (`Screen`). Estudio: `study.tsx` (`Study`, `EditNote`). Mover: `move.tsx`, `notemove.tsx`. Respaldo: `backup.tsx` (`BackupSheet`). Importar: `import.tsx` (`ImportSheet`). Add-ons: `addons.tsx`. Bandeja: `inbox.tsx`.
- Exporta: Module (addons.tsx:6), MODULES (addons.tsx:15), addonOn (addons.tsx:36), AddonsGroup (addons.tsx:41), AmbientController (ambient.tsx:32), AmbientPlayer (ambient.tsx:71), MiniAmbient (ambient.tsx:175), APP_VERSION (backup.tsx:11), BackupSheet (backup.tsx:18), Calendar (calendar.tsx:49), decksForTopic (calendar.tsx:353, reexport), shuffle (cardview.tsx:17), CardViewProps (cardview.tsx:29), CardView (cardview.tsx:39), Occlusion (cardview.tsx:109), isInteractive (cardview.tsx:330), NotePreview (deck.tsx:54), CardForm (deck.tsx:74), AddCardSheet (deck.tsx:139), DeckEditor (deck.tsx:161), deckEmoji (decks.tsx:19), DeckPanel (decks.tsx:55), DeckOptions (decks.tsx:246), Decks (decks.tsx:341), Design (design.tsx:21), ExamEditor (examedit.tsx:19), ExamCard (exams.tsx:23), ExamSheet (exams.tsx:101), AddExamButton (exams.tsx:150), Explorar (explorar.tsx:20), Graph (graph.tsx:7), Heatmap (heatmap.tsx:12), ImportSheet (import.tsx:13), Inbox (inbox.tsx:113), InstallSteps (install.tsx:5), KeySettings (keysettings.tsx:16), MoveItems (move.tsx:13), useMoveTo (move.tsx:76), MoveDecksSheet (move.tsx:90), MoveCardsSheet (move.tsx:145), NoteItems (notemove.tsx:13), runNoteMove (notemove.tsx:30), useNoteMover (notemove.tsx:84), MoveNotesSheet (notemove.tsx:102), Notes (notes.tsx:113), NotePanel (notes.tsx:205), NewNotePanel (notes.tsx:215), PromptSheet (notes.tsx:1181), addDays (notes.tsx:1256, reexport), OcclusionEditor (occlusion.tsx:7), Palette (palette.tsx:21), PdfViewer (pdf.tsx:35), Pdfs (pdfs.tsx:16), usePomodoro (pomodoro.tsx:43), PomodoroPanel (pomodoro.tsx:143), ProfileScreen (profile.tsx:26), Screen (router.tsx:30), SettingsScreen (settings.tsx:248), Attempt (simulacros.tsx:23), loadAttempts (simulacros.tsx:48), SimEmbed (simulacros.tsx:71), Simulacros (simulacros.tsx:87), Spaces (spaces.tsx:91), Stats (stats.tsx:20), StorageSheet (storage.tsx:25), Study (study.tsx:35), EditNote (study.tsx:266), KIND_ICON (timegrid.tsx:7), kindLabel (timegrid.tsx:14), GridItem (timegrid.tsx:16), TimeGrid (timegrid.tsx:32), byDeckFn (today.tsx:19), Today (today.tsx:32), Welcome (welcome.tsx:8).
- Depende de: lib (66), ui (60), i18n (36), (root) (35), notes (28), vault (26), data (24), io (18), srs (9), md (8), cards (7), ink (6), pdf (6), sim (4), share (2), tasks (2), stickies (2). Externos: `lucide-preact`, `preact`, `minisearch`, `pdf-lib`. Es la carpeta de mayor acoplamiento.
### Archivos sueltos de src/ (7 .ts/.tsx + sw + CSS)
- `main.tsx` (39 líneas): arranque. `app.tsx` (383): componente raíz `App`, carga de colección y comprobación de integridad. `state.tsx` (108): `AppCtx`, `useApp`, `useRoute`, `go`/`href`, `parseHash`. `theme.ts` (97): `applyTheme`, `isPhone`, `trackPhone`, `trackKeyboard`, `watchFrames`. `nav.ts` (17): `TABS`. `sw-register.ts` (45) y `sw.js` (49): service worker. `env.d.ts` (32): tipos de entorno. `theme-cristal.css` (969): tema.
- Exporta: App (app.tsx:46), TABS (nav.ts:5), PomoCtl (state.tsx:11), AppCtx (state.tsx:22), Ctx (state.tsx:59), useApp (state.tsx:60), useAsync (state.tsx:63), routeFilePath (state.tsx:83), parseHash (state.tsx:85), useRoute (state.tsx:95), href (state.tsx:105), go (state.tsx:106), onUpdateReady (sw-register.ts:10), registerSW (sw-register.ts:21), resolvedMode (theme.ts:6), applyTheme (theme.ts:11), onSchemeChange (theme.ts:30), isPhone (theme.ts:41), trackPhone (theme.ts:44), trackKeyboard (theme.ts:52), medianFps (theme.ts:65), watchFrames (theme.ts:76).
- Depende de: lib (11), ui (9), vault (8), screens (8), i18n (3), data (2), notes (2), sim (1). Entre sí: 7 imports (app→state/nav/theme/sw-register, main→app/theme/sw-register).
- Nota: `PHONE_QUERY` (theme.ts:39) es constante interna, no exportada; la regla del teléfono se consulta con `isPhone()`/`trackPhone()`.
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
