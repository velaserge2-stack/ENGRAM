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
(se completa abajo)
