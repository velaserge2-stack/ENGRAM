# Almacenamiento tras importar un .apkg (medición, Chromium)

Paquete sintético: 299,6 MB (421 medios: 20 de 14 MB + 400 de 50 KB, sin comprimir; 299,5 MB de medios). Script: `scratchpad/alm.mjs`.
Cifras en MB. OPFS = suma de `getFile().size`. Pantalla = Ajustes → Almacenamiento (cifra grande · «usado de» = `estimate()`).

| Paso | media/ | .app/tmp | .app (resto) | OPFS total | estimate() | Cache Storage | Pantalla (bóveda · estimate) |
|---|---|---|---|---|---|---|---|
| 0 Antes (bóveda de ejemplo) | 0 | 0 | 0,0 | 0,0 | 1,2–5,7 | 5,5 (SW) | 3,3 KB · 6,6 |
| 1 Tras importar | 299,5 | 0 | 0,0 (journal vacío) | 299,5 | 306,5 | 5,5 | 299,5 · 306,6 |
| 2 Tras recargar | 299,5 | 0 | 0,0 | 299,5 | 306,6 | 5,5 | 299,5 · 306,6 |
| 3a Mismo paquete otra vez | 299,5 | 0 | 0,0 | 299,5 | 306,6 | 5,5 | 299,5 · 306,6 |
| 4b Cancelar a ~1,5 s | 0 | 0 | 0,0 | 0,0 | 6,1 | 5,5 | 3 KB · 6,9 |
| 4c Cerrar página a mitad (163 MB ya escritos) y reabrir | 0 | 0 | 0,0 | 0,0 | 6,8 | 5,5 | 3,3 KB · 7,6 |

Proporción espacio usado / medios: 306,6 / 299,5 = **1,02** (el 0,02 es Cache Storage del service worker + IndexedDB ≈ 6 MB fijos). Tras 3a, 4b, 4c: sin crecimiento.

Pico durante la importación (muestreo cada 200 ms): `.app/tmp` crece de forma lineal hasta 297 MB y se renombra a `media/` al confirmar; el pico de OPFS es 1,0x el tamaño de los medios (nunca 2x). Los temporales no se duplican.

Hallazgos
- No hay basura en ningún escenario probado: sin temporales huérfanos, sin duplicados (el segundo import marca «423 idénticos (se omiten)» y deshabilita Importar), sin respaldos, sin `trash/history/thumbs/cache` y sin crecimiento de Cache Storage.
- Cancelar y cerrar a mitad se limpian por completo (en 4c la recuperación del diario al abrir deja 0 MB).
- La cifra de la pantalla es suma de archivos de la bóveda (`walk`), así que 14 GB en pantalla serían 14 GB reales de archivos, no un artefacto de `estimate()`.

No reproducido / hipótesis para lo de 14 GB (no medidas)
- Medios comprimidos en el paquete real (formato nuevo de Anki, zstd por medio, o deflate): lo que se escribe es el tamaño descomprimido; un .apkg de 760 MB puede contener muchos más GB (audio WAV, vídeo, PNG). Comprobar la suma de tamaños sin comprimir del `.apkg` real.
- Importaciones repetidas de paquetes con medios del mismo nombre pero distinto contenido («ya existen con otro contenido»): no probado.
- Comportamiento de WebKit/iOS (no hay WebKit aquí): OPFS en Worker y la recuperación tras matar la app pueden diferir.

## Arreglos
- `SafeVault.recover()`: con un diario atascado solo se conservan los temporales que cita (`writes[].tmp`, `moves[].via`, `entries[].tmp`); el resto de `.app/tmp` se borra (antes se conservaba todo).
- `HandleFS.move()`: tras un `move` nativo sin error se re-resuelven origen y destino sin caché. Destino sin origen: listo; ambos con igual tamaño: se borra el origen; distinto tamaño: error; sin destino: se copia desde el origen re-resuelto (antes copiaba el archivo sobre sí mismo).
- `buildPlan`: un medio perezoso existente se compara primero por tamaño exacto (`exactSize`: deflate o sin comprimir; zstd no lo sabe) y solo se descomprime si coincide.
- Almacenamiento: desglose por carpeta (`folderBreakdown`, `.app/` por subcarpeta) y «Liberar temporales (N MB)» si no hay diario pendiente; con diario, aviso de que se resuelve al reiniciar.
- Pruebas: `tests/almacenamiento.test.ts`; Playwright `scratchpad/alm-fix.mjs`.
