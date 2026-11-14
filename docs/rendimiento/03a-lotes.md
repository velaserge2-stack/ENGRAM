# Fase 3 · Mover, importar y exportar (Prompt 21-B)

Rama `rendimiento-2` desde `main` 974174a. Retoma `rendimiento-3a-wip` (04d6abe), revisado entero antes de seguir. Cifras de **Chromium** en el contenedor (no hay WebKit): sirven para comparar antes/después, no son las del iPad.

## 3a · Diario por lotes en SafeVault

### Diseño
- `vault.batch(async (tx) => …)` (`src/vault/safe.ts`) y la vista `Batch` (`src/vault/batch.ts`). Dentro del lote, `tx.write/move/remove` solo se **anotan** en memoria; las lecturas (`read`, `list`, `stat`, `exists`) ya ven el estado final. Si la función lanza, no se escribe nada.
- Por ruta se guarda solo el estado final: datos nuevos, «el contenido de `src` en disco» (un movimiento es un renombrado, sin copiar ni releer) o borrado. **Invariante**: el origen de un renombrado nunca es destino de otro paso; si algo vuelve a escribir en ese origen, su contenido se copia antes a memoria. Así cada paso es idempotente y la recuperación no es ambigua.
- Confirmar = **temporales** de todo lo escrito (con tamaño y suma) → **un diario v2** con la intención (`writes`, `moves`, `removes`, `dirs`) → aplicar en orden seguro (temporal → destino por renombrado; movimientos; borrados al final; carpetas solo si quedaron vacías) → borrar el diario. Una sola escritura de diario por operación, como pide el prompt.
- Cambiar solo mayúsculas (`caso.md` → `Caso.md`) pasa por un temporal (`via`): en un disco sin distinción de mayúsculas, renombrar directo borraría el origen.
- Anidado: `batch()` dentro de un lote usa ese mismo lote. Sin `SafeVault` (pruebas, memoria) se ejecuta directo.
- Usado en: `moveNotes`/`moveNoteFolder` y `runNoteMove` (`src/notes/move.ts`, `src/screens/notemove.tsx`), mover mazos, carpetas y tarjetas (`src/data/move.ts`, `src/screens/move.tsx`), `applyPlan`/`undoImport` (importar zip/bóveda y restaurar el respaldo, `src/io/import.ts`), `undoMove`. Un solo `app.changed()` por operación; el deshacer sigue igual (también es un lote).

### Recuperación (regla)
El diario v2 solo existe si **todos** los temporales ya se escribieron. Al arrancar (o antes de la siguiente operación si un `apply` falló con la app viva):
1. Si el diario no tiene la forma que escribe `commitBatch` (rutas fuera de lugar, temporales fuera de `.app/tmp`) → se descarta sin tocar nada.
2. Si alguna escritura no tiene su temporal íntegro (tamaño y suma) **y aún no se aplicó nada** → se **revierte**: el lote entero se descarta, ningún destino se tocó.
3. Si no → se **completa**: cada paso comprueba qué falta (idempotente) y lo hace.
4. Solo con el disco dañado a mitad de aplicar (se aplicó algo y un temporal falta o no verifica) se completa lo posible y se reporta lo perdido en `RecoveryReport.discarded`.
5. Al terminar se borran el diario y `.app/tmp/` entero (sin huérfanos). Un fallo de E/S durante la recuperación conserva el diario y lo reintenta (`stuck`).
6. Un **diario v1** (una entrada por archivo, de versiones anteriores) se sigue recuperando como antes.

La integridad (`checkIntegrity`) solo reporta: las pruebas comprueban que no cambia ningún archivo.

### Revisión del trabajo a medias (qué se corrigió)
- `move.tsx` y `notemove.tsx` llamaban a `undoMove` cuando el lote fallaba. Con un lote todo o nada su registro describe pasos que **nunca** llegaron al disco: deshacerlos no hacía nada en el caso normal (el primer movimiento inexistente hacía fallar el deshacer entero), pero con un `apply` atascado podía deshacer a medias. Se quitó.
- Prueba nueva: la **recuperación también muere** en cada uno de sus pasos y la siguiente termina igual (todo o nada, sin diario ni temporales).

### Pruebas (`tests/batch.test.ts`)
- Vista del lote: lecturas ven lo pendiente; si la función lanza no se escribe nada; resultado idéntico a las operaciones sueltas con un solo diario; cadena a→b, c→a; carpetas borradas solo si quedan vacías; mover 30 notas = 1 diario (antes 2 por nota).
- Muerte en **cada** operación del backend (diario, cada temporal, cada `apply`, borrar el diario) y «reabrir» (`new SafeVault` + `recover`): el estado es exactamente el de antes o el de después, sin diario ni `.app/tmp`; la integridad no cambia nada.
- Muerte en cada paso de la **recuperación** y nueva recuperación.
- Temporal dañado antes de aplicar → revierte. Diario v2 plantado → rutas fuera de lugar descartadas, carpetas con archivos no se borran. Diario v1 antiguo → se recupera. `apply` fallido con la app viva → se reintenta comprobando.
- Cancelar (3b) mientras se escriben los temporales → nada cambia.

## Menos operaciones al Worker: caché de carpetas (OPFS)
Cada operación resolvía la ruta con un `getDirectoryHandle` **por nivel** (el hallazgo transversal de la fase 1: 1.5–4 ms por operación, el Worker hace una a la vez). `HandleFS` guarda los manejadores de carpeta ya resueltos (`cacheDirs`, solo en el Worker de OPFS: es privado; en una carpeta del usuario otra app podría borrarla por fuera).
- Borrar invalida esa ruta y lo de dentro.
- Un manejador de una carpeta que ya no existe **lanza `NotFoundError`** (nunca escribe en una carpeta «fantasma»): ante eso se vacía la caché y se reintenta una vez sin ella. Un «no existe» se confirma sin la caché (sin vaciarla) y solo si así aparece se vacía: cubre que otra pestaña borre y recree una carpeta (el cerrojo `engrama-vault` es por operación, las pestañas se turnan).
- `move` nativo (`FileSystemFileHandle.move`, con detección) ya existía en `handle-fs.ts`: renombrar sin copiar; si no hay, copia por trozos.
- `tests/dircache.test.ts`: mismo resultado que sin caché en un guion de escribir, mover archivos y carpetas, borrar y recrear; otra instancia borra y recrea la carpeta y la caché no escribe en la borrada; leer y escribir 60 notas anidadas con menos de 1/5 de los `getDirectoryHandle`.

## 3b
- **#8 `rewriteNoteRefs`** → `refsRewriter(moved)`: una expresión por forma (`[[…]]`, `](…)`, `<!-- src: -->`) con todos los orígenes y un mapa al destino, compilada una vez por lote, y un prefiltro (`[[`, `](`, `src:`) antes de cada expresión. Equivalencia con la reducción en orden: `tests/refs-equiv.test.ts` (300 casos aleatorios con semilla; prefijos, espacios, acentos, anclas, alias, `%20`).
- **#5 Respaldo** → `zipVault` (`src/io/zip.ts`): lee un archivo, lo pasa a un `Zip` de fflate en streaming y lo suelta; lo grande se comprime en un Worker de fflate (`AsyncZipDeflate`), lo pequeño en el hilo principal (un Worker por nota costaría más), lo ya comprimido va tal cual. Las piezas forman un `Blob`. Mismas exclusiones (`.app/tmp`, diario, `.app/cache/`, `.app/thumbs/`). La hoja sigue con preparar → entregar. `tests/zipvault.test.ts`: mismos archivos, bytes y manifiesto que `collectVault` + `buildZip`.
- **Importar con progreso real y Cancelar**: `applyPlan(…, { onProgress, signal })` → `SafeVault.batch`. El progreso cuenta archivos confirmados («Importando… 120 de 500»). Cancelar funciona mientras se escriben los temporales: se borran y la bóveda no cambia («Importación cancelada: no se cambió nada.»). Escrito el diario ya no se cancela (aplicar son renombrados y es lo seguro). Deshacer la importación sigue valiendo.
- **Descompresión en Worker**: ya lo hacía `parseZip` con `unzip` asíncrono de fflate (sus propios Workers) y el `.apkg` con `apkg.worker.ts`. Sin cambios.
- **Caché de `walk()`/listados**: no entra en esta fase. En mover, importar y respaldo cada operación lista una sola vez, así que no hay nada que medir aquí; donde se repiten listados es al recargar tras `app.changed()` (193 `list`, cuello #2), y su invalidación va con las suscripciones por dato de la fase 6. Además, con la carpeta del usuario (File System Access) otra app puede cambiar archivos por fuera: una caché invalidada solo por nuestras operaciones serviría listados viejos.
- **security-review** de lo que cambió en importadores: rutas siguen pasando por `normalizePath` (rechaza `\0`, `..`, absolutas, barra invertida normalizada, nombres demasiado largos) y la recuperación v2 por `safeTarget`; `LIMITS` (archivos, tamaño total y por archivo, razón de compresión, profundidad) sin cambios.

## Medición
`npm run perf` con `ONLY=importar,mover,respaldo`, `SIZES=M,L`, 5 corridas (mediana), Chromium en el contenedor. Cada commit se midió en su propio worktree, uno tras otro (sin nada más corriendo). La línea base se repitió en esta máquina sobre `main` 974174a (las cifras de `baseline.md` son de otra sesión).

### Antes/después (estado final de la fase 3 contra `main`)
| Métrica | `main` | Fase 3 | Cambio | Objetivo (`01-cuellos.md`) |
|---|---|---|---|---|
| Mover 100 notas · M | 5.6 s · 200 diarios | 2.6 s · 1 diario | **−53 %** | < 1 s · ≤ 2 diarios: diarios sí, tiempo no |
| Mover 100 notas · L | 11.3 s · 200 diarios | 5.8 s · 1 diario | **−49 %** | < 2 s: no |
| Mover un mazo de 5 000 · M / L | 0.31 / 0.61 s · 1 diario | 0.20–0.31 / 0.61 s | = | (ya era 1 diario) |
| Importar zip de 500 | 6.1 s · 500 diarios | 3.9 s · 1 diario | **−35 %** | < 2 s: no |
| Restaurar el respaldo de L | 35.1 s · 2 606 diarios | 18.0 s · 1 diario | **−49 %** | < 10 s: no |
| Crear el respaldo de L | 8.5 s · pico 204 MB | 6.7–8.2 s · pico 100–120 MB | −4 a −21 % · **−45 % de memoria** | −4 s y −130 MB: memoria casi, tiempo no |

### Por optimización (cada fila contra el estado anterior)
| Commit | Cambio medido | Veredicto |
|---|---|---|
| Lote (3a, `026649e`+`0fad4c7`) | mover M −22 %, L −8 %; zip 500 −17 %; restaurar −18 %; diarios 200/500/2 606 → 1 | se queda |
| Caché de carpetas (`bb0c5c1`) | mover M −9 %, L −9 %; restaurar −18 %; crear respaldo −25 %; zip 500 +7 % (luego corregido) | se queda |
| Referencias en una pasada (#8, `5e32e55`) | mover M −33 %, L −27 % | se queda |
| Respaldo por partes (#5, `ac20bd9`) | pico −42 % pero **+37 % de tiempo** (comprimía entre lecturas, en serie) | se corrige con `c5b411f` |
| Progreso y Cancelar (`2c39bbf`) | restaurar **+26 %** (un render por archivo) | se corrige con `6ebee05` |
| Caché sin vaciados por «no existe» (`75a8563`) | restaurar −32 %; mover L −16 % | se queda |
| `buildPlan` con un listado por raíz (`ca89fcf`) | zip 500 −18 %; restaurar −9 % | se queda |
| Respaldo con lectura solapada (`c5b411f`) | crear respaldo −21 % | se queda |
| Progreso a un render por fotograma (`6ebee05`) | zip 500 −14 %; restaurar −9 % (= sin la regresión) | se queda |

Crear el respaldo varía mucho entre corridas con el mismo código (6.7–8.2 s, pico 93–120 MB): el tiempo lo dominan 2 607 lecturas en serie al Worker.

### Lo que no llegó al objetivo, y por qué
- **Mover 100 notas** sigue leyendo **todas** las notas y mazos (≈ 2 000 lecturas) para reescribir referencias. Saber qué notas enlazan a las movidas sin leerlas necesita el índice persistido de la fase 5; entonces bajará solo.
- **Restaurar e importar** son 2 operaciones por archivo nuevo (temporal + renombrar) más la lectura del zip. Quitar el renombrado de los archivos nuevos (escribirlos directo con un diario de «deshacer» que los borra si no se confirmó) ahorraría ~1/3, pero cambia la recuperación: queda propuesto, no hecho.
- **Crear el respaldo** está limitado por las lecturas en serie: una operación `readMany` dentro del Worker (una petición para muchos archivos) es el siguiente paso.

## Descartado
- Paralelizar lecturas o escrituras (máx. 4): el Worker de OPFS ejecuta una operación a la vez (fase 1); pedir en paralelo solo encola. No se implementó.
- Caché de listados en esta fase: ver 3b.

## Tras la fase 3: lectura en lote y zip por entradas
Chromium solo (no hay WebKit en el contenedor). Bóveda L, mediana de 5 corridas, cada estado en su propio worktree (`npm run build` aparte). Línea base = `9ddcbf4`.

### A · `readMany` en el Worker de OPFS (conservado)
Operación opcional `readMany(paths)` en `VaultAdapter`: un mensaje al Worker, varios archivos, búferes transferidos. La implementan el Worker/cliente OPFS y `MemoryBackend`; `SafeVault.readMany` la delega al backend crudo (solo lectura, sin diario) o lee uno a uno. `zipVault` lee por lotes de ≤ 32 archivos y ≤ 16 MB (lo grande va solo) y pide el lote siguiente antes de comprimir el actual. Mismo contenido de salida (`tests/zipvault.test.ts`).

| Métrica (L) | Antes | Después | Cambio |
|---|---|---|---|
| `respaldo-crear` mediana (ms) | 7 404 (7 309–8 315) | 6 813 (6 530–7 115) | **−8 %**; los 5 «después» quedan por debajo de los 5 «antes» |
| pico de memoria, mediana | 123 MB | 121 MB | sin cambio |
| `respaldo-restaurar` (no tocado) | 19 058 | 18 481 | ruido |

### B · zip por entradas con `Unzip` (descartado, revertido)
Se implementó: directorio central con `unzip` y filtro que devuelve `false` (mismos límites y avisos, mismo orden), y descompresión de solo las entradas aceptadas con `Unzip` + `UnzipPassThrough`/`UnzipInflate`/`AsyncUnzipInflate` (por tamaño), con tope de bytes **reales** por entrada. Salió igual en 11 casos de equivalencia, pero:

| Métrica | Antes | Después | Cambio |
|---|---|---|---|
| `importar-zip-500-archivos` mediana (ms) | 4 760 | 4 094 | −14 % |
| `importar-zip-500-archivos` pico, mediana | 15.9 MB | 16.8 MB | sin ganancia |
| `respaldo-restaurar` L mediana (ms) | 19 058 | 21 074 | **+10.6 %** |
| `respaldo-restaurar` L pico, mediana | 25.3 MB | 45.4 MB | peor (variable: 24–57 MB) |
| tarea larga máxima al restaurar | 0.24–0.29 s | 1.7–2.0 s | peor |

Motivo: el objetivo era memoria y no bajó (el resultado sigue reteniendo todos los archivos, que es lo que domina el pico); las entradas del respaldo propio van con descriptor de datos (sin tamaño en la cabecera local), así que se inflan en el hilo principal y bloquean 2 s. Se revirtió `src/io/zip.ts` a la versión de `unzip` entero. Hallazgo útil: `Unzip.push` con el zip entero (2 607 entradas) desborda la pila; hay que alimentarlo por trozos.

Se conserva `tests/parsezip-equiv.test.ts` (referencia `legacyParse` + 12 casos: normal, manifiesto, carpeta envolvente, `..`, absolutas, `\`, `\0`, profundidad, basura de sistema, tamaño y total excedidos, razón de compresión, más archivos que el límite, entradas en flujo y > 512 KB, 4 000 entradas, zip corrupto, cabecera que miente) como red de seguridad para cualquier cambio futuro de `parseZip`.

**Revisión de seguridad (a mano, de la versión descartada; no está en el código):** rutas, `\0` y `..` seguían pasando por `normalizePath` después de descomprimir, sin cambios; límites de cantidad, tamaño, total y razón se aplicaban con los mismos datos del directorio central y el mismo orden de avisos; los bytes reales por entrada quedaban acotados a lo declarado (igual que `unzip`, que trunca); nombres duplicados y entradas locales no listadas en el directorio central se ignoraban. Sin hallazgos; el único defecto fue la pila de `Unzip.push` (corregido con trozos de 64 KB). Como no se integró, la versión en uso conserva el comportamiento ya auditado.
