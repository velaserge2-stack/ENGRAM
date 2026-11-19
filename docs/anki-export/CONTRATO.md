# Contrato · exportar mazos a .apkg (lectura del código)

Rama `anki-exportar`. Solo lectura; este archivo es el único escrito.

## 1. sql.js y fflate (importador)
- sql.js solo en el Worker: `src/io/apkg.worker.ts:3-4` (`sql.js/dist/sql-wasm-browser.js` + `?url` del `.wasm`); `:9` `initSqlJs({ locateFile: () => wasmUrl })`. Tipos en `src/env.d.ts:24-32`.
- Carga perezosa: el hilo principal nunca importa sql.js; crea el Worker en `src/io/import.ts:335` (`new Worker(new URL('./apkg.worker.ts', import.meta.url), { type: 'module' })`), vía `runApkg` (`import.ts:333`), expuesto como `runApkgWorker(bytes, history, name)` (`:326`) y `runApkgFile(file, history, name)` (`:328`).
- Protocolo: entrada `{ bytes? | file?, history, name? }`; salida `{ ok, result | error, code }`.
- Interfaz mínima de tipos: `SqlDb` (`src/io/apkg.ts:12-15`: `exec`, `close`) y `SqlJs` (`:17-19`: `Database` constructor). Para escribir hará falta añadir `export()` y `run()`; hoy no existen en los tipos.
- Conversión pura, probable en Node: `convertApkg(bytes, SQL, withHistory, fileName)` (`apkg.ts:204`).
- fflate (`apkg.ts:7`): `unzipSync`, `strFromU8`. `zipblob.ts:6`: `Inflate`. `zip.ts:6`: `AsyncZipDeflate, strToU8, unzip, zip, Zip, ZipDeflate, ZipPassThrough, Zippable`.
- `fzstd` solo lo lee el formato nuevo (`apkg.ts:8`); el exportador v11 no lo necesita.
- Límites: `src/io/limits.ts` (`LIMITS`: `maxApkgBytes`, `maxApkgEntryBytes`, `maxApkgTotalBytes`, `maxRatio`, `maxFiles`).

## 2. Modelo, colección y ficheros
- `NoteType` (`src/cards/parse.ts:10`): `basic | reverse | type | cloze | io | list | olist | mc | match | order`.
- `Note` (`parse.ts:19`), `CardRef` (`:40`: `cid`, `note`, `ord`), `ParsedDeck` (`:48`); `parseDeck` (`:194`), `cardsOf` (`:211`), `noteIdOf` (`:225`), `newId` (`:229`), `ensureIds` (`:240`).
- ID de bloque: `ID_RE` (`parse.ts:~20`), ` ^id` al final de la línea. ID de tarjeta `cid` = nota + ordinal (`c01a`, `c01a:r`, `c02b:c2`).
- Mazos: `decks/<Carpeta>/<Mazo>.md` (`loadCollection` recorre `decks`, `src/data/collection.ts:133-134`).
- `Deck` (`collection.ts:21`), `Collection` (`:35`): `decks`, `byCid`, `states`, `log`, `archived`.
- Lectura: `loadCollection(vault, params, now)` (`collection.ts:133`); `loadStates(vault, params)` (`:91`).
- Historial: `.app/reviews.jsonl` (`REVIEWS`, `:16`), una `LogEntry` JSON por línea (`appendLog`, `:219`). `LogEntry` (`src/srs/engine.ts:15`): `id`, `ts`, `rating?`, `ms?`, `due_before?`, `state?`, `ivl?`, `op?`, `ref?`, origen.
- Caché `.app/state.json` (`STATE`, `collection.ts:17`): `{ v:2, key, at, head, cards }` (`:130`); `cards` = `CardState` (`engine.ts:63`: `card`, `suspended`, `buried`, `history`). Solo caché; `ENGINE_VERSION` en `engine.ts:10`.
- Medios: `media/<nombre>` en la raíz de la bóveda (`src/notes/images.ts:23,43`); `resolveMedia(vault, name, index?)` (`src/data/ops.ts`, ~línea 76); `mediaRefs(text)` (`ops.ts:72`, sintaxis `![[...]]`).
- Escritura: siempre por `SafeVault` (CLAUDE.md); no hay escritor de .apkg.

## 3. Pantalla Mazos y compartir
- Botón «Importar archivo»: `src/screens/decks.tsx:206` (`app.openSheet('import')`, dentro de `.footer-pills`, `:203-208`). Su hoja: `ImportSheet` (`src/screens/import.tsx:13`).
- Botón «Exportar» por mazo: `decks.tsx:124` (`deck.exportar`), función `exportDeck` (~`:150`) que entrega un `.md` con `deliver`.
- Patrón preparar → entregar: `decks.tsx:168` (`pendingFile`) y hoja `decks.tsx:210-218` (`Sheet` + botón `backup.guardar_en_archivos`).
- Hojas: `Sheet` (`src/ui/kit.tsx:88`: `title`, `onClose`, `children`, `actions?`, `wide?`). Capas: `useLayer` (`src/ui/overlay.tsx:43`), `Portal` (`:70`), `Popover` (`:78`).
- Compartir (`src/io/share.ts`): `download(file)` (`:17`), `deliver(file)` (`:29`, devuelve `'shared' | 'downloaded' | 'cancelled'`), `stamp()` (`:43`). `navigator.share` solo dentro del gesto (ver `backup.tsx:28,42`).

## 4. i18n
- `src/i18n/es.json`, `en.json`, `fr.json` (2044 claves en es). Claves planas con punto: `<área>.<frase_en_snake_case>`, p. ej. `"decks.importar_archivo": "Importar archivo"` (`es.json:419`), `"apkg.coleccion_ilegible"`.
- Uso: `t(key, params)` (`src/i18n/index.ts:67`), `tn(key, n, params)` (`:80`), `raw(key)` (`:61`). Parámetros con `{nombre}`.
- Paridad: `tests/i18n.test.ts`.

## 5. Prueba de importación (e2e/p10.mjs)
- Arranca `vite preview` en el puerto 4184; Playwright con `webkit` y respaldo `chromium`. Helper `check(cond, msg)`; `errors` recoge `pageerror`/consola.
- `fresh()` crea contexto con `acceptDownloads: true` (útil para la descarga del exportado). `openImport` va a `#/mazos`, pulsa «Importar archivo» y `upload` usa `.sheet input[type=file]`.
- Fixtures: `tests/fixtures/apkg/{legado,compat,nuevo,basura}.apkg`, generados por `scripts/apkg-fixtures.py` (Python).
- Esperado hoy: resumen `2 mazos · 6 tarjetas · 1 imágenes y audios · 6 repasos de historial`. Para ida y vuelta: exportar → descargar → subir en contexto nuevo → mismas cifras.

## 6. Referencias que NO existen (no inventar)
- Ningún `exportApkg`, `apkgExport`, escritor de sql.js ni `scripts/apkg-export*` en `src/` ni `scripts/` (`grep` solo da hits del importador).
- `docs/anki-export/CONTRATO.md` no existía; `docs/anki-export/LOG.md` existe y titula «Prompt 21 (Exportar Anki)», pero no contiene el contrato.
- `SqlDb` no declara `export()` ni `run()`.
- `docs/PROMPTS.md` y `docs/SPEC.md` solo describen importar `.apkg` (Prompt 10; Fase 5); no hay especificación de exportar.
- No se leyó el texto completo del prompt de la tarea, solo su resumen: si el prompt cita otros nombres, no están verificados.

## Convenciones y decisiones
**Fase 1 · `src/io/apkgexport/map.ts` (puro, probado en `tests/apkgexport-map.test.ts`)**
- `mapDeck(deckName, parsedDeck, { used? }) → { deckName, deckId, notes: AnkiNote[], media: Map<original, saneado>, converted, skipped }`. `used` (Set de ids) se comparte entre mazos para evitar colisiones; en colisión el id sube de 1 en 1 (determinista según el orden).
- `AnkiNote { id, guid, model: 'basic'|'reversed'|'cloze', fields, tags, sfld, csum, cards: {id, ord}[], media: string[], src }`. `ord`: 0/1 (reversa), `n-1` (cloze).
- `MODELS`: ids fijos `1700000000001/2/3` (`Basic`, `Basic (and reversed card)`, `Cloze`; campos Front/Back, Text/Back Extra). `deckNameOf('decks/A/B.md') → 'A::B'`.
- `ankiId(seed, used?)`: SHA-1 → ms de epoch (1,4e12–1,68e12). `guidFrom(id)`: base 91, 10 caracteres, del `^id`. `sha1(str)`: síncrono. `csum` = primeros 8 hex de SHA-1 del `sfld` (primer campo sin HTML).
- `mediaName(original)`: solo basename, sin controles ni `..`/`:|?*<>`; si cambió, sufijo `-<6 hex del original>` (estable); `Media` en `![[…]]` y `![](…)` (no http/data) → `<img src>`; audio → `[sound:…]`. El llamador (fase 2) debe leer `media/<original>` y guardarlo con el nombre saneado.
- `converted` cuenta por tipo las notas que pasan a Basic (list, olist, mc, match, order, type, io). `io` solo conserva la imagen (sin rectángulos). `skipped`: sin `^id` o con errores de formato.
- HTML: markdown-it `html:false`; solo se reconoce Markdown estándar (`==`, `++`, colores `{.x}` se aplanan; wikilinks → texto). Sin etiquetas, `on*` ni `javascript:` del usuario.

**Fase 2 · `src/io/apkgexport/write.ts` + `worker.ts` (probado en `tests/apkgexport-write.test.ts`, ida y vuelta con `convertApkg` y `PRAGMA integrity_check` en Python)**
- `buildApkg({ SQL, decks: MapResult[], readMedia(original) → Uint8Array|undefined (o Promise), sched?, revlog?, onProgress?({phase:'notes'|'media'|'zip', done, total}), now? }) → Promise<{ bytes, stats: { decks, notes, cards, media, revlog, converted, skipped, missingMedia } }>`.
- `sched?: Map<idTarjetaAnki:number, AnkiSched>`; `AnkiSched = { type, queue, due, ivl, factor, reps, lapses }` (sin entrada: nueva, `type 0, queue 0, due` = posición 1, 2…). `due` de repaso = días desde `crt`; `crtOf(now)` = medianoche UTC en s (lo que se escribe en `col.crt`).
- `revlog?: AnkiRevlog[]`; `AnkiRevlog = { id (ms), cid (id de tarjeta de Anki), ease 1–4, ivl, lastIvl, factor, time (ms), type 0–3 }`; se escribe con `usn -1`.
- Id de tarjeta de Anki ↔ `cid` de Engrama: `note.cards[i]` con `note.src` → `src` (basic, ord 0), `src:r` (reversa ord 1), `src:c<ord+1>` (cloze).
- Esquema v11 (`collection.anki2`, `ver 11`, `schedVer 2`): `col`, `notes`, `cards`, `revlog`, `graves` + 7 índices `ix_*`; mazos Default (1), los exportados y sus padres (`A` de `A::B`); `dconf` 1. `col.mod/scm` en ms; `notes/cards.mod` en s.
- Zip con `Zip` de fflate: `collection.anki2` y `media` con DEFLATE; medios `0`,`1`… con STORE; `mtime = now` (mismo input y `now` → mismos bytes).
- Errores: `ApkgExportError('apkg_export_too_big')` si notas > `maxApkgNotes`, colección o un medio > `maxApkgEntryBytes`, o total > min(`maxApkgTotalBytes`, 1,5 GB). Medio sin bytes: se omite y suma `missingMedia`.
- Worker: entrada `ExportRequest { decks, media: Map<original, Uint8Array>, sched?, revlog? }`; salida `{ progress }`… y `{ ok:true, result:{ bytes, stats } }` (bytes transferidos) o `{ ok:false, error, code }` (`apkg_export_too_big` | `apkg_export_failed`).
- Tipos: `SqlDb` (exportado en `apkg.ts`) añade `run`, `prepare` (`SqlStmt`: `run`, `free`) y `export`; `initSqlJs` en `env.d.ts` devuelve `SqlJs`.

**Fase 3 · `src/io/apkgexport/sched.ts` (puro, probado en `tests/apkgexport-sched.test.ts`, con ida y vuelta `buildSched → buildApkg → convertApkg`)**
- `buildSched({ states, log }, cardIdMap, crt) → { sched: Map<idAnki, AnkiSched>, revlog: AnkiRevlog[] }`; `cardIdMapOf(decks)` construye `cid → idAnki` con la regla de write.ts. Solo se usa si la casilla «Incluir historial» está marcada.
- Estado: New → sin entrada (nueva de write.ts) salvo suspendida/enterrada (`type 0, queue −1|−2, due 0`); Learning `type 1, queue 1`; Review `type 2, queue 2`; Relearning `type 3, queue 1`. Suspendida `queue −1`, enterrada (`buried` ≠ null) `−2`.
- `due`: (re)aprendizaje = `floor(card.due / 1000)` (s de epoch); repaso = `floor((due_s − crt) / 86400)` (negativo si vencida).
- `ivl` = `max(1, round(scheduled_days || stability))` días; 0 en aprendizaje. `factor` = `round(1300 + (10 − D)/9 · 1700)` ‰, D acotada 1–10 (1 → 3000, 10 → 1300). `reps`, `lapses` del estado FSRS.
- revlog: entradas con `rating`, sin `op`, no deshechas (`undo` con `ref` = ts) y con `cid` en el mapa; orden (ts, índice). `id = max(ts, id previo + 1)` ms; `ease` = rating; `type` por `state` previo: 0/1 → 0, 2 → 1 (o 3 si ts < `due_before` − 1 día), 3 → 2; sin `state`: 0 la primera de la tarjeta, 1 después.
- `ivl` de la fila = (`due_before` del repaso siguiente de la tarjeta, o `card.due` si es el último) − ts: días redondeados si ≥ 1 día, si no −segundos. `lastIvl` = `ivl` de la fila anterior de la tarjeta (0 la primera). `factor` = el actual de la tarjeta (0 si `type 0`). `time` = ms acotado a 1..3 600 000.
- Límite conocido: `left` de las tarjetas en aprendizaje queda en 0 (write.ts); Anki la trata como paso final.
