# Rendimiento · Fase 1 · cuellos de botella (Prompt 21)

Solo análisis: no se cambió código de `src/`. Medido en Chromium 153 (no hay WebKit en el contenedor), bóveda **L** (20 000 tarjetas, 54 000 repasos en `reviews.jsonl` de 3.1 MB, 2 000 notas, 2 605 archivos, 65 MB) salvo donde se indica. Las cifras de ms de reloj incluyen la sobrecarga del perfilador (CPU del hilo principal ×1.0–1.2; E/S del Worker sin cambio apreciable); para comparar antes/después se usa `npm run perf`, no este documento.

## Cómo se midió
- `e2e/rendimiento-perfil.mjs` (nuevo, solo mide): perfil de CPU del hilo principal con CDP `Profiler` (muestreo 0.2 ms) por escenario, más: tareas largas (`longtask`), pico de `JSHeapUsedSize`, y **número, tiempo acumulado y MB de cada operación al Worker de OPFS** (`read`, `write`, `list`, `exists`, `stat`, `remove`; se cuenta en `postMessage` y en la respuesta). El tiempo acumulado de un tipo de operación es suma de latencias (incluye cola); como el Worker ejecuta en serie (`opfs.worker.ts` `chain`), sirve para ver **cuánto trabajo de E/S** hay, no para sumarlo al reloj.
- Se perfila una compilación **sin minificar** (`vite build --minify false --outDir <scratch>`) para tener nombres de función; no se toca `dist/`. Uso: `DIST=<dir> OUTDIR=<dir> [ONLY=arranque,notas,ciclo,mover,zip500,restaurar,respaldo,nota5mb,quieto,changed,estudio,fsrs] node e2e/rendimiento-perfil.mjs`. Requiere el mismo puerto 4196 y los perfiles sembrados de `npm run perf` (OPFS es por origen).
- Trazas crudas (`.cpuprofile`, abribles en DevTools → Rendimiento → Cargar) en `tests/fixtures/rendimiento/perfiles/` (fuera de git). Resumen numérico de todas las corridas: `docs/rendimiento/01-perfiles.json`.
- «Quieto» = tras esperar a que termine la comprobación de integridad del arranque (la cola del Worker vacía). «Con contención» = lo que ve el usuario si actúa en los primeros ~8 s: es lo que midió la línea base.
- Aviso de método: la primera corrida de arranque salió de un service worker antiguo (código minificado de la línea base); se repitió con el SW vigente (`perfiles/arranque-L.cpuprofile`).

## Hallazgo transversal: el Worker de OPFS es una cola única
`opfs.worker.ts` ejecuta **una operación a la vez** (`chain`) y cada una cuesta ≈ 1.5–4 ms (resolver ruta con un `getDirectoryHandle` por nivel + `getFile`; `list` además hace `getFile()` por cada archivo, `handle-fs.ts:88`). Leer 2 000 archivos = ~5 s aunque se pidan «en paralelo»: **paralelizar lecturas no ayuda; lo que ayuda es hacer menos operaciones** (lotes dentro del Worker, no leer, o no repetir). Además cualquier lectura masiva en segundo plano (integridad, índice) hace cola delante de la acción del usuario.

## Los 10 cuellos, por impacto

Esfuerzo: S = horas · M = ~1 día · L = varios días. «Fase» es una propuesta (2 escritura/diario · 3 datos de repaso · 4 lecturas e índice · 5 render e interfaz · 6 invalidación de cachés y SW · 7 respaldo, memoria, arranque y paquete); el coordinador puede reasignar.

| # | Cuello | Ahorro medido (L) | Esf. | Fase | Modelo |
|---|---|---|---|---|---|
| 1 | Diario de SafeVault por archivo, en serie | restaurar −20 s de 30.7 s · zip de 500 −4.5 s de 6.1 s · mover 100 notas −6 s de 15.8 s | L | 2 | **opus** |
| 2 | `app.changed()` recarga y reanaliza todo | un solo marcador = 4 213 lecturas (29 MB) + 193 `list` + índice: ≈ −14 s de espera | L | 6 (+4) | **opus** |
| 3 | Abrir Notas lee las 2 000 notas y reconstruye el índice | −5 s de 6.2 s (9.9 s con contención) | L | 4 | **opus** (índice persistido) |
| 4 | Comprobación de integridad completa al arrancar (y tras cada cambio) | 2 218 lecturas ≈ 7.9 s de cola del Worker; Notas −3.7 s; estudio/respaldo contendidos | M | 4 | sonnet |
| 5 | Respaldo: leer todo en serie y zip en memoria | −4 s (collect 5.6 s de 6.7 s) y −130 MB de picos fuera del hilo | M | 7 | sonnet |
| 6 | Estudio: `appendLog` reescribe `reviews.jsonl` y `state.json` enteros | −85 ms de 88 ms de CPU por respuesta; 16.5 MB al Worker por respuesta | M | 3 | **opus** (FSRS incremental) |
| 7 | Hoy/Estadísticas: `dayKey` con `Intl.formatToParts` × 54 000 × 3 pasadas por render | arranque −0.4 s · ciclo de pantallas −1.1…2.0 s | S | 5 | sonnet |
| 8 | Mover notas: `rewriteNoteRefs` O(archivos × movidas) y lectura de todas las notas | −1.6 s de CPU + ~5 s de lecturas | M | 2 (con #1) | sonnet |
| 9 | Replay FSRS (100 k): `mash`/Alea de ts-fsrs y replay duplicado | −1.0 s (verify) y 1.1 s de tarea larga fuera del hilo | M | 3 | **opus** |
| 10 | Nota de 5 MB: buscar (`at` cuadrático) y abrir (DOMPurify de todo) | buscar −1.5 s de 2.1 s · abrir −1 s | S+M | 5 | sonnet |

### 1 · Diario por archivo, en serie  (impacto alto · L · Fase 2 · opus)
- **Causa**: `SafeVault.commit` (`src/vault/safe.ts:116`) hace por archivo 2 `write` (temporal + diario) + 1 `write` del destino + 2 `remove` = **5 viajes al Worker** y los bytes se envían dos veces; `applyPlan` (`src/io/import.ts:205`, `:229`) añade `exists` + `read` (para deshacer) y `buildPlan` otro `exists` por archivo; `SafeVault.move` (`safe.ts:177`) lee el archivo y vuelve a escribirlo entero con `commit` (6 operaciones + 1 lectura).
- **Evidencia (traza)**: restaurar L: 2 605 transacciones, **7 815 `write` + 5 210 `remove` + 5 210 `exists` ≈ 18 000 operaciones** (21.3 s + 4.3 s + 3.6 s acumulados) en 30.7 s de aplicar; 145.5 MB enviados al Worker por 64.7 MB de datos (el doble). Zip de 500: 1 500 `write` + 1 000 `remove` + 1 000 `exists` = 3 500 operaciones en 6.2 s; CPU del hilo principal solo 1.1 s. Mover 100 notas: 200 transacciones de diario, 600 `write`, 500 `remove`, 276 `exists`, 100 `stat`: ≈ 6 s de E/S de 15.8 s.
- **Hipótesis «un diario por archivo en serie»: CONFIRMADA.**
- **Qué atacar**: un diario por lote (varias entradas en `entries[]`, el formato ya lo admite) con los temporales escritos antes; un solo `exists`/`stat` por archivo; `previous` solo cuando el destino existe. `recover()` debe manejar N entradas.

### 2 · `app.changed()` lo recarga todo  (impacto alto · L · Fase 6 · opus)
- **Causa**: `app.changed` incrementa `version`; con eso se re-ejecutan `loadCollection` (`app.tsx:97-105`: parsea los 20 mazos y `reviews.jsonl` de 3 MB, `loadStates`→`parseLog`+`logKey`), `recheckIntegrity` (`app.tsx:129`) y, con Notas abierto, `useNotes` (`notes.tsx:97-107`, `useAsync` con `[app.version]`). Hay ≥ 20 `useAsync`/`useEffect` con `app.version` (`ui/links.tsx:17`, `data/extra.ts:69`, `notes.tsx:345`, `pdfs.tsx:101`, `spaces.tsx:93`, `calendar.tsx:60/62`, `simulacros.tsx:160/187/430`, `inbox.tsx:115`…).
- **Evidencia**: abrir una nota y pulsar «Marcar» (una escritura de ~100 B): **4 213 lecturas (29.1 MB), 193 `list`, 1 reinicio del índice y 3 escrituras**; ≈ 21 s de E/S acumulada en el Worker, y a los 14 s la cola seguía ocupada (`perfiles/changed-un-solo-marcador-L.cpuprofile`). Con Hoy abierto y solo cambiar de ruta a una nota: 2 003 lecturas + 82 `list` + índice.
- **Hipótesis «relectura y reparseo completos tras cada cambio»: CONFIRMADA. «useAsync que repite lecturas por app.version»: CONFIRMADA.**
- **Qué atacar**: `changed(scope)` con ámbito (decks | notes | settings | …) y que cada `useAsync` declare de qué ámbito depende; el cambio de un marcador no toca mazos ni integridad.

### 3 · Abrir Notas: lee 2 000 notas e indexa  (impacto alto · L · Fase 4 · opus)
- **Causa**: `useNotes` → `listNotes` (`walk('notes')`) + `linkIndex` (`notes/model.ts:119-132`: `readTextOr` de **cada nota**, en serie, para calcular retroenlaces) y luego `notesIndex.reset(data.texts)` (`notes.tsx:148`) que envía todos los textos al Worker de búsqueda y los reindexa (`notes/search-client.ts`, además guarda una copia `mirror` en el hilo principal).
- **Evidencia (quieto)**: navegación a Notas **6.2 s** (baseline 5.2 s mediana, p95 8.5 s): 2 001 lecturas (4.9 s acumulados), 82 `list` (0.7 s), `reset` 0.8 s en el Worker del índice; CPU del hilo principal solo 1.16 s (render del árbol ≈ 0.14 s). Con la integridad aún corriendo: 9.9 s (4 085 lecturas).
- **Qué atacar**: índice y retroenlaces persistidos en `.app/cache/` (reconstruibles, con firma por ruta+tamaño+mtime) y actualizados al guardar; leer solo lo que cambió; no volver a hacer `reset` completo al reabrir.

### 4 · Integridad completa al arrancar y tras cada cambio  (impacto medio-alto · M · Fase 4 · sonnet)
- **Causa**: `checkIntegrity` (`vault/integrity.ts:27`) hace `walk('')` y **lee y decodifica cada `.md/.json/.jsonl`**; se lanza al montar (`app.tsx:120`) y en cada `version > 0` (`app.tsx:129`).
- **Evidencia**: tras llegar a Hoy siguen **2 218 lecturas durante ≈ 7.9 s** (≈ 3.5 ms cada una) metidas en la cola única del Worker. Efecto medido sobre lo que el usuario hace en ese rato: Notas 9.9 s frente a 6.2 s quieto (−3.7 s); 91 lecturas ajenas por respuesta de estudio en la ventana (910 lecturas en 10 respuestas, 31 MB); `collectMs` del respaldo 12.2 s con contención. CPU del hilo principal pequeña (76 ms).
- **Qué atacar**: ejecutarla en reposo (`requestIdleCallback`/tras 10 s), una vez por sesión o por día, incremental por mtime/tamaño, y nunca por `changed()`. Reporta; no corrige (regla del proyecto) — no cambia.

### 5 · Respaldo  (impacto medio · M · Fase 7 · sonnet)
- **Causa**: `collectVault` (`io/zip.ts:49`) lee los 2 607 archivos en serie y los deja **todos** en memoria; `buildZip` (`zip.ts:58`) comprime con `fflate`; el `.zip` final (67.8 MB) también está entero en memoria.
- **Evidencia**: `collectMs` 12.2 s con contención (baseline 5.6 s quieto) por 4 691 lecturas (2 607 propias + 2 084 de la integridad), `zipMs` 0.9 s; el hilo principal ejecuta `deflateSync` 351 ms y 566 ms de tarea larga; memoria 81 MB de lecturas + 68 MB del zip (el `JSHeapUsed` del hilo principal marca solo 49 MB porque los buffers son externos).
- **Qué atacar**: leer por lotes dentro del Worker (una operación `readMany`), comprimir por trozos/streams y entregar un `Blob`; sin la contención de #4 ya baja a ~5.6 s.

### 6 · Estudio: `appendLog` reescribe todo  (impacto alto en el gesto · M · Fase 3 · opus)
- **Causa**: `appendLog` (`data/collection.ts:171`): `appendLines` lee `reviews.jsonl` entero, lo vuelve a escribir entero con `commit` (temporal + diario + destino); después `logKey` (`:57`) hace `JSON.stringify` de **54 000 entradas + checksum** y `serializeStates` (`:84`) serializa **20 000 estados (~6.8 MB)** y los escribe otra vez con `commit`.
- **Evidencia (10 respuestas, quieto)**: `appendLog` 879 ms de CPU del hilo principal = **88 ms por respuesta** (`serializeStates` 44 ms + `TextEncoder.encode` 38 ms + FNV 14 ms + `logKey` 24 ms); 2 transacciones de diario por respuesta; **165 MB enviados al Worker (16.5 MB por respuesta)** y 29 MB leídos (2.9 MB por respuesta); 10 tareas largas (máx 108 ms). La línea base mide 351 ms de mediana y 444 de p95 (el resto: render y guardado del Worker).
- **Qué atacar**: `reviews.jsonl` solo añade (append en el Worker, sin leer ni reescribir); `state.json` es caché reconstruible: escribirlo diferido (cada N respuestas o al ocultar la página; sin `beforeunload`) y con clave barata (longitud + última entrada) en vez de re-hashear todo el registro. `reviews.jsonl` sigue siendo la verdad.

### 7 · `dayKey` en Hoy y Estadísticas  (impacto medio, esfuerzo bajo · S · Fase 5 · sonnet)
- **Causa**: `dayKey` (`lib/days.ts:17`) llama a `Intl.DateTimeFormat.formatToParts` **por cada entrada del registro**; `Today` lo hace 3 veces por render sin `useMemo` (`screens/today.tsx:40,42,43`: `todayProgress`, `doneToday`, `activity` en `lib/stats.ts:25,44,57`) y `Stats` otra (`screens/stats.tsx:29`). 54 000 × 3 = 162 000 llamadas por render de Hoy.
- **Evidencia**: `dayKey` = **369–401 ms** en el arranque (30 % de los 1.3 s de CPU hasta Hoy; el arranque de L son 2.7 s), **1 123 ms** (quieto) a **2 000 ms** (con contención) en un ciclo Hoy→Mazos→Notas→Estadísticas→Hoy de 4.5 s de CPU, 740 ms durante el respaldo y 344 ms durante FSRS (Hoy se re-renderiza). Tareas largas del arranque (máx 489 ms) y del ciclo (máx 501 ms) son Hoy.
- **Qué atacar**: memorizar por `(log.length, today, tz, h)`; `dayKey` con aritmética de desfase UTC por zona (cache por intervalo de 24 h) y una sola pasada que calcule las tres estadísticas.

### 8 · Mover notas: reescritura de referencias  (impacto medio · M · Fase 2 · sonnet)
- **Causa**: `moveNotes` (`notes/move.ts:127`) recorre **todas** las notas y mazos y para cada archivo aplica `moved.reduce(rewriteNoteRefs)`: 100 movidas × 3 `new RegExp` por archivo ≈ **606 000 compilaciones** de expresiones; antes lee cada archivo con `readTextOr`. Además un `walk` del historial por nota (`move.ts:119`).
- **Evidencia**: `rewriteNoteRefs` **1 570 ms** inclusivos (285 ms propios + `esc` 155 ms + regex); `moveNotes` 1 719 ms de CPU; 4 486 lecturas (2 020 propias + integridad), 198 `list`.
- **Qué atacar**: prefiltrar con `text.includes(basename)` / `'[[' `, una sola expresión combinada para el lote, y leer solo notas que referencian (con el índice de #3).

### 9 · Replay FSRS  (impacto medio · M · Fase 3 · opus)
- **Causa**: `replay` (`srs/engine.ts:96`) reproduce los 100 000 repasos en el hilo principal; en ts-fsrs cada `next` con `enable_fuzz` crea un generador (`apply_fuzz` → `alea` → `Alea` → `mash`).
- **Evidencia (100 k)**: `replay` **2.79 s inclusivos en la traza** (1 055 ms según el gancho sin perfilador): `mash` **1 277 ms propios** (≈ 45 %), `applyReview` 2 284 ms; la tarea larga máxima fue 1.1 s; `verifyDeterminism` repite el replay (**1 017 ms**) y `loadStates` otro (1 788 ms con parseo y escritura). Pico 147 MB.
- **«Replay dos veces (replay + verifyDeterminism)»: PARCIAL.** En uso normal `loadStates` solo reproduce si la caché no casa (tras restaurar/importar: 510 ms medidos) y `verifyDeterminism` solo corre al pulsar «Comprobar» en Ajustes (`settings.tsx:372`); la doble pasada solo ocurre en ese botón y en el gancho de medición.
- **Qué atacar**: replay incremental desde un punto de control (estado + posición en el registro), en Worker/por trozos; verificación comparando la caché con una sola reconstrucción. El resultado debe seguir idéntico byte a byte.

### 10 · Nota de 5 MB: buscar y abrir  (impacto medio · S+M · Fase 5 · sonnet)
- **Buscar**: `rangesIn` (`notes/find.tsx:14`), la función `at` (`:20`) recorre **hacia atrás desde el último nodo de texto por cada coincidencia** (O(coincidencias × nodos)): **1 231 ms propios** de 1 898 ms en una sola tarea de 2.1 s; `foldMap` 394 ms; `findHits` 102 ms; pico 257 MB. Arreglo: búsqueda binaria en `starts` y plegar por tramos.
- **Abrir**: 2.2 s de CPU y tarea larga de 1.37 s: `renderMarkdownCached` → `DOMPurify.sanitize` **648 ms** (261 ms solo en `parseFromString`) + markdown-it (≈ 175 ms) + `NoteEditor` 969 ms inclusivos; pico 83 MB. Arreglo: sanear y pintar por tramos en reposo (los 40 bloques de arriba primero).
- Refutado en esta nota: re-render por tecla (ver tabla de hipótesis).

## Cuellos menores (no entran en los 10)
- `parseZip` (`io/zip.ts:80`) y `.apkg` (`io/apkg.ts:212`, `unzipSync`) descomprimen **todo** en memoria; hasta 1 GB por `LIMITS`. Restaurar L envía 145 MB al Worker. Se puede hacer por entradas (`Unzip` de fflate) y escribir según se descomprime.
- `main.tsx:26` hace `walk('decks')` + `walk('notes')` (95 `list`) solo para saber si hay datos; `list` hace `getFile()` por archivo (`handle-fs.ts:88`). Arranque total: **208 `list` y 460 lecturas** antes de que cese el ruido.
- Guardián de legibilidad `runGuard`/`panelContrast`: 92 ms en el arranque (`app.tsx` → `background.tsx`); `loadCollection` 140 ms (`parseDeck` 104, `ensureIds` 47); `Heatmap` 37 ms.
- `screens/profile.tsx` se importa estático y perezoso a la vez (aviso `INEFFECTIVE_DYNAMIC_IMPORT` del build): entra en el paquete inicial.
- Árbol de notas sin virtualizar (`notes.tsx:273`, `buildTree` en cada render): 0.14 s con 2 000 notas; escala mal pero hoy no es cuello.

## Veredicto de las hipótesis del prompt
| Hipótesis | Veredicto | Evidencia |
|---|---|---|
| Un diario SafeVault por archivo, en serie, al mover/importar | **Confirmada** | 200 / 500 / 2 605 transacciones; 5 operaciones por archivo; `safe.ts:116` |
| `walk()`/listados repetidos | **Confirmada** (impacto moderado) | 208 `list` al arrancar, 82 por visita a Notas, 193 tras un cambio; `list` hace `getFile` por archivo (`handle-fs.ts:88`) |
| Relectura y reparseo completos tras cada cambio (`app.changed`/`app.version`) | **Confirmada** | un marcador = 4 213 lecturas + 193 `list` + índice |
| Reconstrucción completa de FSRS e índice en el arranque | **Refutada en el arranque, parcial en el uso**: FSRS reproduce solo con caché inválida (restaurar: 510 ms); el índice no se reconstruye al arrancar sino **cada vez que se abre Notas** (2 001 lecturas + 0.8 s) |
| `replay` dos veces (replay + `verifyDeterminism`) | **Parcial** | solo en «Comprobar» de Ajustes y en el gancho (1.0 s extra); no en el uso normal |
| Hash/checksum de archivos grandes en el hilo principal | **Refutada** como cuello | los grandes van por trozos en el Worker; el FNV de `commit` cuesta 1.4 ms/MB: 91 ms en restaurar L, 14 ms por respuesta de estudio |
| zip/.apkg descomprimidos en memoria de una vez | **Confirmada por código y por bytes** (no por `JSHeapUsed`, que no cuenta buffers externos: 47.7 MB marcados con 145 MB enviados) | `io/zip.ts:80-117`, `io/apkg.ts:212` |
| `import()` cargados antes de hacer falta | **Refutada** (menor: `profile.tsx`) | pdfjs, mammoth, turndown, docx, sql.js, pdf-lib y add-ons son diferidos; 26 peticiones/358 KB en frío |
| Listas largas sin virtualizar (mazos, árbol de notas, explorador) | **Refutada como cuello hoy** | Mazos 103 ms; árbol de notas ≈ 140 ms con 2 000 notas; Explorar tope 400 filas (`explorar.tsx:84`) |
| Re-render de bloques de notas en cada tecla | **Refutada** | `ViewBlock` con `memo` + caché LRU; teclear 50 en bloque: 54–57 ms de mediana (1 y 5 MB), 0–6 tareas largas. Excepción: vista Markdown 5 MB (textarea gigante, 60 tareas largas): costo del navegador |
| Blob URL sin revocar | **Refutada** (matiz) | préstamos con revocación (`background.tsx:107-128`, `thumbs.ts:105-111`, `pdf.tsx:408-430`); solo `mediaUrl` sin préstamo (fondos) queda fija por diseño |
| `useAsync` que repite lecturas por `app.version` | **Confirmada** | ≥ 20 sitios; el caro es `useNotes` (2 003 lecturas por cambio) |

## Plan por fase (objetivos medibles; mismos criterios que `baseline.md`)
| Fase | Alcance | Objetivo medible (L salvo nota) | Línea base |
|---|---|---|---|
| 2 · Escritura por lotes | #1 y #8: un diario por lote, menos `exists`/`read`, `rewriteNoteRefs` por lote | mover 100 notas ≤ 2 escrituras de diario, < 1 s (M) y < 2 s (L); zip de 500 < 2 s; restaurar L < 10 s; `recover()` con N entradas probado | 4.9/10.2 s · 5.9 s · 29 s |
| 3 · Datos de repaso | #6 y #9: `appendLog` por append + `state.json` diferido; replay incremental/Worker | estudio p95 ≤ 100 ms y ≤ 1 escritura de diario por respuesta, 0 tareas largas > 50 ms en el gesto; FSRS 100 k sin tarea > 100 ms; `verifyDeterminism` idéntico byte a byte | 444 ms · 2 · 18 tareas · 946 ms |
| 4 · Lecturas e índice | #3 y #4: índice/retroenlaces persistidos, integridad en reposo e incremental, un solo `walk` por arranque | abrir Notas < 1 s; 0 lecturas masivas en los primeros 10 s tras Hoy; consulta de búsqueda sin cambio (≤ 20 ms) | 5.2 s (9.9 s con contención) · 2 218 lecturas |
| 5 · Render e interfaz | #7 y #10: Hoy/Estadísticas memorizados, `dayKey` barato, buscar con búsqueda binaria, abrir 5 MB por tramos | Hoy ≤ 20 ms de CPU por render con 54 000 repasos; ciclo de pantallas < 3 s; buscar en 5 MB < 300 ms sin tarea > 200 ms; abrir 5 MB < 1.5 s | 400 ms · 7.0 s · 1.9 s · 3.6 s |
| 6 · Invalidación de cachés y SW | #2: `changed(ámbito)` y dependencias declaradas; revisar el SW (versión) por si el cambio de caché lo requiere | un marcador/«Marcar» ≤ 5 lecturas y 0 `list`; ningún `changed()` de notas recarga mazos ni integridad | 4 213 lecturas · 193 `list` |
| 7 · Respaldo, memoria, arranque | #5, `parseZip` por entradas, arranque | respaldo L < 3 s y pico < 120 MB; Hoy interactivo < 1.5 s con L y sin tarea > 200 ms; paquete inicial ≤ 315 KB gzip y ≤ 26 peticiones | 6.7 s / 221 MB · 2.7 s · 315 KB |

Orden recomendado: 2 → 4 → 3 → 5 (en paralelo con 3) → 6 → 7. El #4 (integridad en reposo) y el #7 (`dayKey`) son baratos y mejoran todas las medidas siguientes; conviene hacerlos primero dentro de su fase.
