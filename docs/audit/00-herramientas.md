# Auditoría · Etapa 0 · herramientas automáticas

Fecha: 2026-11-13. Rama `auditoria`. Sin cambios en código, `package.json` ni `package-lock.json`.

Comandos exactos usados (en la raíz del repo):

```
npx tsc --noEmit -p tsconfig.json --noUnusedLocals --noUnusedParameters
npx knip        (sin configuración nueva; valores por defecto)
npx madge --circular --extensions ts,tsx src
npx jscpd src --min-lines 15 --reporters console
npm i --no-save @vitest/coverage-v8@5.1.0   (misma versión que vitest 5.1.0)
npx vitest run --coverage --coverage.reporter=text-summary --coverage.reporter=json-summary --coverage.reportsDirectory=<scratchpad>/coverage
npx vitest run --coverage ... --testTimeout=60000   (segunda pasada, ver sección 5)
npm run build
```

Clasificación: **seguro de eliminar** (sin uso fuera de su archivo, verificado con grep en src/, tests/, e2e/, scripts/); **revisar** (el nombre aparece en src/ y no se pudo descartar en 1 minuto, o requiere cambio de dependencias); **falso positivo probable** (uso por tests/e2e/scripts, carga dinámica, archivo de herramienta o de ejemplo).

## 1. TypeScript con `--noUnusedLocals --noUnusedParameters`

10 errores, todos en `src/`, todos de imports o parámetros sin uso. Ninguno en tests/.

| Archivo:línea | Hallazgo | Clasificación |
|---|---|---|
| src/screens/calendar.tsx:13 | 'go' is declared but its value is never read. (TS6133) | seguro de eliminar |
| src/screens/calendar.tsx:132 | 'a' is declared but its value is never read. (TS6133) | seguro de eliminar |
| src/screens/exams.tsx:1 | 'locale' is declared but its value is never read. (TS6133) | seguro de eliminar |
| src/screens/inbox.tsx:1 | 'locale' is declared but its value is never read. (TS6133) | seguro de eliminar |
| src/screens/notes.tsx:2 | 'Network' is declared but its value is never read. (TS6133) | seguro de eliminar |
| src/screens/simulacros.tsx:11 | 'createDeck' is declared but its value is never read. (TS6133) | seguro de eliminar |
| src/screens/spaces.tsx:20 | 'renderMarkdown' is declared but its value is never read. (TS6133) | seguro de eliminar |
| src/screens/study.tsx:21 | 'modalOpen' is declared but its value is never read. (TS6133) | seguro de eliminar |
| src/ui/background.tsx:8 | 'Settings' is declared but never used. (TS6196) | seguro de eliminar |
| src/ui/links.tsx:3 | 'Link2' is declared but its value is never read. (TS6133) | seguro de eliminar |

## 2. Knip (archivos, exportaciones, tipos, dependencias)

Resumen: 6 archivos sin uso, 1 devDependency sin uso, 3 binarios no listados, 87 exportaciones y 12 tipos exportados sin uso (99 en total en la tabla).

### Archivos sin uso

| Archivo · hallazgo | Clasificación |
|---|---|
| `.claude/skills/systematic-debugging/condition-based-waiting-example.ts` · ejemplo incluido en la skill | falso positivo probable |
| `e2e/glass-perf.mjs` · lo ejecuta `node e2e/glass-perf.mjs` (docs/DECISIONS.md) | falso positivo probable |
| `scripts/examples.mjs` · genera ejemplos binarios para pruebas manuales (docs/PROMPTS.md) | falso positivo probable |
| `scripts/icons.mjs` · comando de CLAUDE.md | falso positivo probable |
| `scripts/note-fixtures.mjs` · fixtures de CLAUDE.md | falso positivo probable |
| `scripts/perf-fixtures.mjs` · fixtures de CLAUDE.md | falso positivo probable |

### Dependencias

| Archivo:línea · hallazgo | Clasificación |
|---|---|
| `package.json:61` · `@types/markdown-it` sin uso. `markdown-it` 15 trae sus propios tipos (`types` en su package.json). Confirmar con `npm run typecheck` antes de quitarla | revisar |
| `e2e/pdf.mjs` · binarios `pdftoppm`, `pdftotext`, `pdfinfo` no declarados (son del sistema) | falso positivo probable |

### Exportaciones y tipos sin uso

> Nota del coordinador (muestreo de 4: `REVIEWS`, `EMBED_RE`, `qid`, `IntegrityProblem`): casi todas se usan **dentro de su propio archivo**. «Seguro de eliminar» aquí significa **quitar `export`**, no borrar el símbolo; la etapa 4 debe comprobarlo uno por uno.

Regla aplicada: sin referencias fuera de su archivo y sin ningún nombre en src/ → seguro de eliminar (quitar `export`; borrar el símbolo solo si "usos locales" es 1, es decir, solo su declaración). Referenciado solo desde tests/e2e/scripts → falso positivo probable. Nombre que aparece en src/ en otro contexto (p. ej. variable local) → revisar.

| Archivo:línea · símbolo (tipo) | Usos locales | Hallazgo | Clasificación |
|---|---|---|---|
| src/cards/parse.ts:65 · isCardStart (export) | 1 | sin uso externo | seguro de eliminar |
| src/cards/parse.ts:76 · blocks (export) | 3 | sin uso externo | revisar (nombre presente en src/) |
| src/data/collection.ts:14 · REVIEWS (export) | 4 | sin uso externo | seguro de eliminar |
| src/data/collection.ts:15 · STATE (export) | 4 | sin uso externo | revisar (nombre presente en src/) |
| src/data/collection.ts:16 · ARCHIVE (export) | 3 | sin uso externo | seguro de eliminar |
| src/data/collection.ts:44 · paramsKey (export) | 2 | sin uso externo | revisar (nombre presente en src/) |
| src/data/collection.ts:60 · loadStates (export) | 2 | sin uso externo | seguro de eliminar |
| src/data/collection.ts:76 · serializeStates (export) | 3 | sin uso externo | seguro de eliminar |
| src/data/extra.ts:45 · loadExtra (export) | 2 | sin uso externo | seguro de eliminar |
| src/data/extra.ts:59 · loadExams (export) | 2 | sin uso externo | seguro de eliminar |
| src/data/move.ts:67 · renamePrefix (export) | 3 | sin uso externo | seguro de eliminar |
| src/data/move.ts:75 · rewriteDeckRefs (export) | 3 | sin uso externo | seguro de eliminar |
| src/data/move.ts:134 · removeBlock (export) | 2 | sin uso externo | revisar (nombre presente en src/) |
| src/data/ops.ts:44 · saveDeckText (export) | 1 | sin uso externo | seguro de eliminar |
| src/i18n/index.ts:42 · onLang (export) | 1 | sin uso externo | seguro de eliminar |
| src/i18n/index.ts:66 · raw (export) | 4 | sin uso externo | revisar (nombre presente en src/) |
| src/i18n/index.ts:114 · allKeys (export) | 1 | sin uso externo | seguro de eliminar |
| src/ink/DrawingBlock.tsx:23 · pngPath (export) | 4 | sin uso externo | seguro de eliminar |
| src/ink/DrawingBlock.tsx:65 · renderPng (export) | 3 | sin uso externo | seguro de eliminar |
| src/ink/model.ts:85 · pointInPolygon (export) | 2 | sin uso externo | seguro de eliminar |
| src/io/extract.ts:8 · MAX_DOC_BYTES (export) | 2 | sin uso externo | seguro de eliminar |
| src/io/import.ts:21 · kindOf (export) | 2 | sin uso externo | revisar (nombre presente en src/) |
| src/io/share.ts:9 · canShareFile (export) | 2 | sin uso externo | seguro de eliminar |
| src/io/share.ts:17 · download (export) | 3 | sin uso externo | revisar (nombre presente en src/) |
| src/io/zip.ts:13 · FORMAT (export) | 4 | sin uso externo | seguro de eliminar |
| src/io/zip.ts:14 · FORMAT_VERSION (export) | 3 | sin uso externo | revisar (nombre presente en src/) |
| src/io/zip.ts:15 · MANIFEST (export) | 4 | sin uso externo | seguro de eliminar |
| src/lib/ambient.ts:35 · audioSession (export) | 9 | sin uso externo | falso positivo probable (usado en tests/e2e/scripts) |
| src/lib/exams.ts:185 · todayKey (export) | 1 | sin uso externo | seguro de eliminar |
| src/lib/ics.ts:44 · LINKS_MARK (export) | 3 | sin uso externo | seguro de eliminar |
| src/lib/imgview.ts:10 · STEPS (export) | 2 | sin uso externo | revisar (nombre presente en src/) |
| src/lib/imgview.ts:39 · cachePath (export) | 2 | sin uso externo | seguro de eliminar |
| src/lib/palette.ts:3 · PALETTE (export) | 5 | sin uso externo | seguro de eliminar |
| src/lib/palette.ts:29 · luminance (export) | 2 | sin uso externo | seguro de eliminar |
| src/lib/palette.ts:61 · fillFor (export) | 1 | sin uso externo | seguro de eliminar |
| src/lib/query.ts:88 · rows (export) | 2 | sin uso externo | revisar (nombre presente en src/) |
| src/lib/settings.ts:85 · deviceTimeZone (export) | 2 | sin uso externo | seguro de eliminar |
| src/md/embed.ts:46 · EMBED_RE (export) | 4 | sin uso externo | seguro de eliminar |
| src/md/render.ts:192 · clozeText (export) | 2 | sin uso externo | seguro de eliminar |
| src/notes/format.ts:30 · wordAt (export) | 4 | sin uso externo | seguro de eliminar |
| src/notes/format.ts:301 · fmt (export) | 3 | sin uso externo | revisar (nombre presente en src/) |
| src/notes/model.ts:356 · dirOf (export) | 1 | sin uso externo | revisar (nombre presente en src/) |
| src/notes/search-client.ts:35 · toSearchDoc (export) | 3 | sin uso externo | seguro de eliminar |
| src/notes/search.ts:16 · foldMap (export) | 3 | sin uso externo | seguro de eliminar |
| src/notes/search.ts:39 · queryTerms (export) | 3 | sin uso externo | seguro de eliminar |
| src/notes/thumb-core.ts:7 · THUMB_LONG (export) | 2 | sin uso externo | falso positivo probable (usado en tests/e2e/scripts) |
| src/notes/thumbs.ts:16 · HUGE (export) | 2 | sin uso externo | seguro de eliminar |
| src/notes/thumbs.ts:22 · typeOf (export) | 5 | sin uso externo | seguro de eliminar |
| src/pdf/library.ts:9 · PDF_META (export) | 3 | sin uso externo | seguro de eliminar |
| src/pdf/open.ts:16 · RANGE_CHUNK (export) | 3 | sin uso externo | seguro de eliminar |
| src/screens/ambient.tsx:13 · MUSIC_DIR (export) | 3 | sin uso externo | seguro de eliminar |
| src/screens/calendar.tsx:350 · decksForTopic (export) | 2 | sin uso externo | revisar (nombre presente en src/) |
| src/screens/cardview.tsx:109 · Occlusion (export) | 2 | sin uso externo | revisar (nombre presente en src/) |
| src/screens/deck.tsx:39 · buildBlock (export) | 2 | sin uso externo | seguro de eliminar |
| src/screens/decks.tsx:283 · DeleteDecks (export) | 3 | sin uso externo | seguro de eliminar |
| src/screens/design.tsx:13 · TEST_BGS (export) | 3 | sin uso externo | seguro de eliminar |
| src/screens/move.tsx:18 · destinations (export) | 2 | sin uso externo | seguro de eliminar |
| src/screens/move.tsx:30 · hasClash (export) | 2 | sin uso externo | seguro de eliminar |
| src/screens/move.tsx:36 · runMove (export) | 3 | sin uso externo | seguro de eliminar |
| src/screens/move.tsx:50 · ClashSheet (export) | 2 | sin uso externo | seguro de eliminar |
| src/screens/notemove.tsx:21 · noteDestinations (export) | 2 | sin uso externo | seguro de eliminar |
| src/screens/notemove.tsx:30 · runNoteMove (export) | 3 | sin uso externo | seguro de eliminar |
| src/screens/notes.tsx:1230 · addDays (export) | 2 | sin uso externo | revisar (nombre presente en src/) |
| src/screens/pdfs.tsx:65 · thumbFromFile (export) | 3 | sin uso externo | seguro de eliminar |
| src/screens/pomodoro.tsx:13 · POMO_LOG (export) | 5 | sin uso externo | seguro de eliminar |
| src/screens/study.tsx:25 · speak (export) | 3 | sin uso externo | seguro de eliminar |
| src/share/card.ts:57 · ICON (export) | 3 | sin uso externo | revisar (nombre presente en src/) |
| src/sim/banktrash.ts:45 · freeBankPath (export) | 2 | sin uso externo | seguro de eliminar |
| src/sim/draft.ts:24 · draftQuestion (export) | 3 | sin uso externo | seguro de eliminar |
| src/sim/parse.ts:35 · qid (export) | 2 | sin uso externo | seguro de eliminar |
| src/srs/engine.ts:170 · rAt (export) | 1 | sin uso externo | seguro de eliminar |
| src/srs/queue.ts:66 · reviewsToday (export) | 2 | sin uso externo | seguro de eliminar |
| src/state.tsx:75 · parseHash (export) | 3 | sin uso externo | seguro de eliminar |
| src/tasks/parse.ts:39 · taskLine (export) | 3 | sin uso externo | seguro de eliminar |
| src/theme.ts:39 · PHONE_QUERY (export) | 2 | sin uso externo | seguro de eliminar |
| src/ui/background.tsx:442 · SIGN_ALPHA (export) | 2 | sin uso externo | seguro de eliminar |
| src/ui/charts.tsx:2 · Defs (export) | 2 | sin uso externo | seguro de eliminar |
| src/ui/links.tsx:13 · CAL_PATH (export) | 2 | sin uso externo | seguro de eliminar |
| src/ui/links.tsx:23 · liveData (export) | 2 | sin uso externo | seguro de eliminar |
| src/ui/links.tsx:39 · openLink (export) | 2 | sin uso externo | seguro de eliminar |
| src/ui/links.tsx:123 · linkedBlocks (export) | 2 | sin uso externo | seguro de eliminar |
| src/ui/tray.tsx:108 · HOY_STATE (export) | 3 | sin uso externo | seguro de eliminar |
| src/vault/handle-fs.ts:26 · identityCodec (export) | 2 | sin uso externo | seguro de eliminar |
| src/vault/open.ts:39 · storedFolder (export) | 3 | sin uso externo | seguro de eliminar |
| src/vault/paths.ts:41 · joinPath (export) | 1 | sin uso externo | seguro de eliminar |
| src/vault/util.ts:3 · enc (export) | 2 | sin uso externo | revisar (nombre presente en src/) |
| src/vault/util.ts:27 · readJson (export) | 1 | sin uso externo | seguro de eliminar |
| src/data/move.ts:22 · UndoOp (type) | 2 | sin uso externo | seguro de eliminar |
| src/io/import.ts:19 · Kind (type) | 3 | sin uso externo | revisar (nombre presente en src/) |
| src/io/import.ts:169 · ItemStatus (type) | 3 | sin uso externo | seguro de eliminar |
| src/lib/frontmatter.ts:8 · FMValue (type) | 6 | sin uso externo | seguro de eliminar |
| src/lib/settings.ts:7 · GlassMode (type) | 2 | sin uso externo | seguro de eliminar |
| src/nav.ts:18 · Route (type) | 1 | sin uso externo | seguro de eliminar |
| src/notes/format.ts:270 · ColAlign (type) | 6 | sin uso externo | seguro de eliminar |
| src/notes/history.ts:40 · History (type) | 1 | sin uso externo | revisar (nombre presente en src/) |
| src/pdf/annots.ts:13 · Sticky (type) | 2 | sin uso externo | revisar (nombre presente en src/) |
| src/pdf/open.ts:11 · PdfLib (type) | 2 | sin uso externo | seguro de eliminar |
| src/state.tsx:9 · SheetId (type) | 3 | sin uso externo | seguro de eliminar |
| src/vault/integrity.ts:12 · IntegrityProblem (type) | 2 | sin uso externo | seguro de eliminar |

Nota: `src/io/share.ts` (`download`), `src/data/move.ts` (`removeBlock`), `src/i18n/index.ts` (`raw`), `src/lib/query.ts` (`rows`), `src/notes/format.ts` (`fmt`) y `src/cards/parse.ts` (`blocks`) tienen nombres genéricos: la coincidencia en src/ es casi segura de ser otra variable; se dejan en revisar por prudencia. `Occlusion`, `ICON`, `Defs`, `Kind`, `FORMAT_VERSION` aparecen en JSON de i18n o en comentarios, no como importaciones.

## 3. Madge (ciclos)

0 ciclos en 149 archivos de `src/`. Madge emitió 2 avisos de procesamiento que no se revisaron en detalle (no afectan al resultado). Sin hallazgos que clasificar.

## 4. jscpd (duplicados, mínimo 15 líneas)

0 clones en 145 archivos (28 682 líneas). Sin hallazgos que clasificar.

## 5. Cobertura (Vitest 5.1.0 + @vitest/coverage-v8 5.1.0, --no-save)

Primera pasada: 1 fallo, `tests/p14.test.ts > tiene límite (LRU)`, por **timeout de 5 s** (20 050 iteraciones con instrumentación de cobertura). Segunda pasada con `--testTimeout=60000`: **45/45 archivos y 310/310 pruebas pasan**. Es un problema de tiempo bajo cobertura, no un fallo funcional; conviene subirle el timeout en el test o marcarlo como lento.

Total (src/): líneas 72.49 % (3 629/5 006) · sentencias 68.49 % · ramas 62.32 % · funciones 65.19 %.

Los 25 módulos con menor cobertura de líneas (de 78 archivos que aparecen en el informe; los que no aparecen no los importó ninguna prueba y cuentan como 0 %):

| Módulo | Líneas | Clasificación de la baja cobertura |
|---|---|---|
| src/ink/InkLayer.tsx | 0.67 % (1/149) | Componente de tinta, sin prueba de DOM |
| src/io/extract.ts | 2.04 % (1/49) | Extracción de texto de docs; revisar seguridad (ver security-review) |
| src/ui/kit.tsx | 2.85 % (1/35) | Kit de UI, cubierto solo por e2e |
| src/vault/handle-fs.ts | 5.83 % (7/120) | FS Access; cubierto solo en navegador real |
| src/ui/keys.tsx | 6.09 % (5/82) | Atajos de teclado |
| src/ui/overlay.tsx | 6.77 % (4/59) | Capas/overlay; cubierto por e2e |
| src/ink/InkSurface.tsx | 8.33 % (1/12) | Superficie de tinta |
| src/ink/DrawingBlock.tsx | 13.58 % (11/81) | Bloque de dibujo; incluye `renderPng` sin uso (ver knip) |
| src/theme.ts | 13.72 % (7/51) | Tema y `PHONE_QUERY` |
| src/ui/background.tsx | 14.33 % (39/272) | Fondos y guardián de legibilidad |
| src/state.tsx | 15.38 % (4/26) | Estado global; `parseHash` sin uso (ver knip) |
| src/lib/stats.ts | 29.54 % (26/88) | Estadísticas: lógica pura, prioridad para pruebas unitarias |
| src/lib/exams.ts | 34.21 % (26/76) | Exámenes/ritmo: lógica pura, prioridad |
| src/lib/perf.ts | 42.85 % (3/7) | Contadores de rendimiento (`?perf`) |
| src/lib/imgview.ts | 45.45 % (20/44) | Versiones reducidas de imágenes |
| src/data/extra.ts | 53.84 % (14/26) | Intentos y exámenes (borrar/restaurar intentos) |
| src/notes/thumbs.ts | 60.67 % (54/89) | Miniaturas de fotos |
| src/lib/query.ts | 62 % (31/50) | Consultas de bloques |
| src/io/import.ts | 68.34 % (95/139) | Importadores |
| src/lib/palette.ts | 68.75 % (22/32) | Paleta; `PALETTE`, `luminance`, `fillFor` sin uso externo (ver knip) |
| src/lib/ambient.ts | 69.15 % (148/214) | Sonido ambiente |
| src/lib/pomodoro.ts | 75.86 % (22/29) | Pomodoro |
| src/srs/queue.ts | 79.12 % (72/91) | Cola FSRS; núcleo del repaso, conviene reforzar |
| src/i18n/index.ts | 84.31 % (43/51) | i18n; `onLang` y `allKeys` sin uso (ver knip) |
| src/data/move.ts | 85.71 % (144/168) | Mover datos con deshacer |

Clasificación: la baja cobertura no es un hallazgo de código muerto. Se marca **revisar** en `src/lib/stats.ts`, `src/lib/exams.ts`, `src/srs/queue.ts` y `src/io/extract.ts` porque son lógica pura o de seguridad sin pruebas directas.

## 6. Bundle (`npm run build`, 10 mayores de dist/assets)

Build correcto. Aviso de Vite: `src/screens/profile.tsx` se importa dinámicamente desde `router.tsx` y también estáticamente desde `app.tsx` y `today.tsx`, así que no se separa en un chunk (INEFFECTIVE_DYNAMIC_IMPORT). Es un hallazgo a revisar en la etapa de rendimiento.

| Archivo | Bytes | Gzip -9 | Contenido probable |
|---|---|---|---|
| pdf.worker.min-CIqJB0yW.mjs | 1 271 915 | 378 121 | pdfjs-dist (worker del visor de PDF) |
| sql-wasm-browser-CXIAVl5-.wasm | 688 197 | 336 373 | sql.js (WASM) |
| c-q0SBnR3m.js | 480 783 | 140 467 | pdfjs-dist (fragmento de PDF) |
| c-fC1qBoUJ.js | 419 672 | 174 969 | sql.js (glue JS) |
| apkg.worker-CTlFtxlf.js | 364 433 | 125 638 | Worker de `.apkg` (fzstd, sql.js, protobuf) |
| c-EQfwdVFY.js | 308 085 | 93 825 | mammoth (importación de .docx) |
| index-B179pEzO.js | 302 917 | 97 043 | Núcleo de la app (minisearch, fzstd, Preact) |
| c-zaKWRy-B.js | 300 873 | 101 082 | docx (exportación de .docx) |
| c-DprDKu-9.js | 282 176 | 82 242 | fragmento con referencias a docx |
| c-vHBr1k2M.js | 104 537 | 33 859 | fragmento sin identificar |

Identificación por cadenas de texto (grep), no por análisis de módulos: los nombres de paquete son aproximados. Los 3 mayores (pdfjs, sql.js) están bajo demanda (`import()`/Worker), como exige CLAUDE.md. Hallazgo: el bundle de PDF y el de sql.js suman ~2,1 MB sin comprimir y no se carga en el arranque; no es un problema de arranque si la carga es perezosa. Clasificación: **revisar** (confirmar que el chunk de sql.js no entra en el arranque). Los archivos de `dist/` no se versionan.
