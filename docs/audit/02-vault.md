# Etapa 2.4 · errores de lógica en `src/vault/`

Archivos: util, paths, memory, handle-fs, opfs, opfs.worker, fsaccess, safe, integrity, open. Pruebas: `tests/audit-vault.test.ts` (8 `it.fails` + 3 controles que pasan).
Hallazgos: alta 2 · media 4 · baja 4.

## Raíz de «`readTextOr(…, '')` y luego escribir»
`src/vault/util.ts:19-25` · `readTextOr` atrapa TODAS las excepciones (io, quota, permiso, TypeError, no-existe) y devuelve el valor por defecto; no distingue «no existe» de «falló la lectura». Cualquier error transitorio de disco se convierte en «archivo vacío» y el siguiente guardado lo pisa. Corrección mínima central: `catch (e) { if (e instanceof VaultError && e.code === 'not-found') return fallback; throw e; }` (y que el Worker/HandleFS mapeen NotFoundError a `not-found`; ver 4). Prueba: «readTextOr solo debe devolver…».

## Alta
1. `src/vault/safe.ts:112-120` (SafeVault.move) · `move(a, a)` escribe `a` y luego `remove(a)`: el archivo desaparece (el diario además lo repetiría al recuperar). También `memory.ts:79-89` (`set(b)` + `delete(a)`; en carpetas igual) y `handle-fs.ts:176` (`remove(to)` antes de mover: con `to===from` borra el origen). · Reproducir: `write('x.md')`, `move('x.md','x.md')` → `exists` false. Basta un renombrado a un título idéntico. Prueba: «SafeVault.move(a, a)» y «MemoryBackend.move(a, a)».
2. `src/vault/handle-fs.ts:176` (HandleFS.move, archivo) · `await this.remove(to)` es recursivo: si `to` es una carpeta existente la borra entera antes de mover (MemoryBackend no, así que las pruebas no lo ven); además el reemplazo no es atómico (borra el destino y luego mueve). · Reproducir (OPFS/FS Access real): carpeta `notes/X/` con archivos y `move('tmp.md','notes/X')`. Sin prueba (necesita handles reales): sospecha confirmada por lectura.

## Media
3. `src/vault/util.ts:10-12,15` (`readText`/`decodeText` no estricto) · bytes UTF-8 inválidos (Latin-1) se leen con U+FFFD sin error; guardar la nota los destruye (la integridad lo reporta, pero el editor reescribe). · Reproducir: archivo `h\xe9l.md`, `readText` → «h�l». Prueba: «readText sobre UTF-8 inválido».
4. `src/vault/opfs.worker.ts:131` + `opfs.ts:22-23` · el Worker envía `code: err.code ?? err.name`; en `DOMException` `code` es numérico (22 Quota, 8 NotFound), así que nunca llega `'QuotaExceededError'`/`'NotFoundError'` y todo es `io`. `pdfs.tsx:124` espera `code === 'quota'` (solo se salva por `err.name`, que no existe en VaultError): «sin espacio» sale como error genérico y `readTextOr`/not-found por DOMException no se detecta. · Reproducir: disco lleno al importar un PDF. Prueba: «el Worker de OPFS debe informar código de texto» (da 22).
5. `src/vault/handle-fs.ts:26-33,50-52` · `asciiCodec.enc` codifica cada carácter no ASCII como `%XX%XX` (6 por «á»), pero `paths.ts:5` limita a 255 caracteres antes de codificar: un título de 100 «á» pasa `normalizePath` y genera un nombre de 600 que el navegador rechaza (se vuelve error crudo o, con TypeMismatch, «no existe»). · Reproducir: nota con título largo con muchas tildes. Prueba: «el nombre codificado para OPFS…».
6. `src/vault/handle-fs.ts:43-45,100-117` · `isNotFound` trata `TypeMismatchError` como «no existe»: nombres inválidos (el propio comentario dice que Chromium lo usa) hacen que `read`→«No existe», `exists`→false y `remove` tenga éxito sin borrar nada. Además `write` sobre una ruta que es carpeta (o con un padre archivo) lanza un `DOMException` crudo, no `VaultError`. Sospecha (necesita handles reales).

## Baja
7. `src/vault/memory.ts:43-46` · `write('a')` cuando existe `a/b.md` no falla (HandleFS sí): el backend de pruebas/modo temporal diverge del real y las pruebas no ven errores de tipo archivo/carpeta. Prueba: «MemoryBackend.write sobre una ruta que ya es carpeta».
8. `src/vault/safe.ts:62-66,98-100`, `opfs.ts:73-90`, `paths.ts` · `write/move/list/read/stat/hash/file` llaman a `normalizePath` fuera de una promesa: una ruta inválida lanza síncrono en vez de rechazar; `.catch()` no la atrapa. Prueba: «las rutas inválidas deben rechazar la promesa».
9. `src/vault/handle-fs.ts:182-184` y `memory.ts` · mover carpetas pierde las subcarpetas vacías (solo se mueven archivos) y no avisa; mover una carpeta a un destino que es archivo no se comprueba. Sospecha.
10. `src/vault/paths.ts:20` y `handle-fs.ts:list` · `normalizePath` fuerza NFC, pero `list` en FS Access devuelve nombres tal cual del disco: un archivo con nombre NFD (creado en macOS) se lista con ruta NFD que luego no se encuentra en Windows/Linux (en `remove('')` se omite sin error). Sospecha (solo carpeta real en Chrome; Safari iPad usa OPFS NFC). Además se permiten `: * ? < > |` y control en nombres, que fallan en FS Access sobre Windows.

## Descartado / correcto
`checkIntegrity` solo lee y reporta (prueba control); `blobChecksum` = `checksum` pasando el límite de 4 MB; codec biyectivo con `%`; `remove` no falla si no existe; `readJson` distingue no-existe de corrupto (lanza).

## Para etapa 3
- Cortes en cada paso de `commit` y `writeStream`; diario obsoleto tras `apply()` fallido (cuota) con `tmp` huérfano; `recover` si el destino cambió entre el corte y el arranque.
- `fh.move` nativo: reemplazo no atómico; copia de respaldo tras un movimiento a medias.
- Dos pestañas: `createSyncAccessHandle` (NoModificationAllowedError) y diario compartido; cola `serial` es por instancia, no por pestaña.
- `list` hace `getFile()` por entrada (carrera si un archivo desaparece: rompe todo el listado).
- Mover carpetas a medias (fallo en el hijo n) sin diario.
- Cuota: `write` del tmp lleno y destino truncado por `truncate(0)`.
