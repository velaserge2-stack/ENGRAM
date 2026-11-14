# Prompt 21 · estado: **completado** (fases 0–9)

Fases 0–2 en `main` (PR #27); fase 3 en `main` (PR #28); fases 4–9 en la rama `rendimiento-2`. Resultado final: `resultado.md`. Informes: `03a-lotes.md`, `04-fsrs.md`, `05-busqueda.md`, `06-interfaz.md`, `07-memoria.md`.

## Lo que queda (no hecho, con su motivo)
- **Abrir una nota de 5 MB por tramos** (~4 s): hay que forzar el pintado completo al buscar en la nota, imprimir y editar un bloque aún sin pintar; ver `05-busqueda.md`.
- **Restaurar e importar sin renombrar los archivos nuevos** (escribirlos directo con un diario que los borra si no se confirmó): ~1/3 menos de operaciones, pero cambia la recuperación.
- **Crear el respaldo con una lectura en lote dentro del Worker** (`readMany`) y **descomprimir el zip por entradas** (`Unzip` de fflate) para bajar el pico al importar.
- **`e2e/rendimiento-perfil.mjs`**: `vite preview` ignora `--outDir` y el perfil copiado trae el service worker de la semilla; arreglarlo antes de volver a usarlo (ver `06-interfaz.md`).
- **Medición en el iPad**: arranque en frío, mover 100 notas, importar el zip grande, cerrar la app a mitad, memoria con fotos grandes, varias pestañas y almacenamiento lleno.

---
Historial de este archivo (estado al detener el primer agente):

# Prompt 21 · lo que falta

Estado al detenerlo (2026-11-13): hechas y verificadas las fases 0, 1 y 2 (en `main`). Avance ≈ 35 %.

## Hecho
- **Fase 0 · línea base:** `scripts/vault-gen.mjs` (bóvedas S/M/L reproducibles, 100 k repasos, zip de 500 y `.apkg`), `npm run perf` (`e2e/rendimiento.mjs`, ganchos solo con `?perf`), `docs/rendimiento/baseline.{json,md}` con objetivos.
- **Fase 1 · cuellos de botella:** `docs/rendimiento/01-cuellos.md` (los 10 mayores con trazas) y `e2e/rendimiento-perfil.mjs`.
- **Fase 2 · arranque y paquete:** `docs/rendimiento/02-arranque.md`.
  - Integridad en reposo: Notas tras arrancar −39 %.
  - `dayKey` en caché: Hoy −78 %, Estadísticas −53 %.
  - Pantallas con `import()`: paquete inicial 313.5 → 225.8 KB gzip (−28 %).
  - Verificación: 0 píxeles en el teléfono; `e2e`, `flows`, `design` y `mejoras` en verde.

## Fase 3 (Prompt 21-B, rama `rendimiento-2`)
Hecha y medida: ver `03a-lotes.md`. **En pausa obligatoria** hasta la prueba en el iPad (mover 100 notas, importar el zip grande, cerrar la app a mitad, poca memoria).

## Fase 4 (rama `rendimiento-2`)
Hecha y medida: ver `04-fsrs.md`. Falta del objetivo: p95 de estudio ≤ 100 ms (queda ~200 ms de interfaz → fase 6).

## Fase 5 (rama `rendimiento-2`)
Hecha y medida: ver `05-busqueda.md`. Queda: abrir la nota de 5 MB por tramos (forzando el pintado completo al buscar, imprimir y editar).

## Fase 6 (rama `rendimiento-2`)
Hecha y medida: ver `06-interfaz.md`. Queda: estudio p95 ≤ 100 ms (~200 ms de interfaz).

## Interrumpido (resuelto en la fase 3)
- **Fase 3a · diario por lotes en SafeVault** (cuello #1). Trabajo a medias, **sin medición ni E2E**, guardado en la rama `rendimiento-3a-wip` (commit 04d6abe). **No unir así.** Toca `src/vault/safe.ts`, `src/vault/batch.ts` (nuevo), `src/notes/move.ts`, `src/data/move.ts`, `src/io/import.ts`, `src/screens/move.tsx`, `src/screens/notemove.tsx` y `tests/batch.test.ts`. Retomarla con Opus: revisar el diff, completar las pruebas de recuperación con fallos inyectados en cada paso (todo o nada, diario v1 compatible), medir y correr la batería.

## Falta (en orden)
1. **Fase 3a (Opus).** Terminar lo de arriba.
   - Una operación de varios archivos escribe un solo diario.
   - Renombrar en vez de copiar, con feature detection.
   - Un solo `app.changed()` por operación.
   - Objetivos: mover 100 notas, de 200 escrituras al diario y 10.2 s (L) a un lote; restaurar L, de 2 606 escrituras y 29 s, mucho menos.
2. **Fase 3b (Sonnet).**
   - `rewriteNoteRefs` sin crear ~606 000 RegExp al mover notas (cuello #8, 1.6 s de CPU).
   - Respaldo por partes en Worker, sin cachés reconstruibles (cuello #5, pico de 221 MB).
   - Caché de `walk()`/listados con invalidación por operación.
   - Importar zip/`.apkg` en Worker con progreso real y Cancelar (que deshacer siga valiendo).
   - Repaso de seguridad si cambian los importadores.
3. **⏸ Pausa** para probar en el iPad: mover 100 notas, importar el zip grande, cerrar la app a mitad y probar con poca memoria.
4. **Fase 4 · FSRS (Opus).**
   - `appendLog` no reescribe `reviews.jsonl` y `state.json` enteros en cada respuesta (cuello #6: 88 ms y 16.5 MB por respuesta).
   - Puntos de control: `state.json` con desplazamiento y hash, y replay solo de lo nuevo, **idéntico bit a bit** (`verifyDeterminism`, 100 k repasos, líneas dañadas, fuera de orden, zonas horarias).
   - Replay FSRS más barato (cuello #9: el generador `mash`/Alea es el 45 %).
   - Parseo de mazos en Worker con caché versionada.
5. **Fase 5 · búsqueda.**
   - Índice minisearch incremental y persistido en IndexedDB (reconstruible, con versión y hash). Cuello #3: abrir Notas en L tarda 5–6 s por 2 001 lecturas y el `reset` del índice. Diseño con Opus, implementación con Sonnet.
   - `at()` cuadrático en `find.tsx` (cuello #10: buscar en una nota de 5 MB tarda 1.9 s).
   - DOMPurify en notas muy grandes.
6. **Fase 6 · interfaz (Sonnet; Opus si hay carreras).**
   - `app.changed()` lo recarga todo (cuello #2: un «Marcar» hace 4 213 lecturas, 29 MB y 193 `list`).
   - Suscripciones por dato en vez de `app.version` global.
   - Virtualizar solo si mide mejora: la fase 1 vio que el árbol de notas cuesta ~140 ms.
7. **Fase 7 · memoria y ciclo de vida en Safari (Sonnet).**
   - Respaldo y archivos grandes sin copias.
   - Cachés con tope (LRU).
   - Workers inactivos se cierran y reanudan.
   - Comprobar al volver de segundo plano.
8. **Fase 8 · verificación.**
   - Repetir toda la línea base con su tabla antes/después.
   - Batería completa: test, typecheck, build, todas las `e2e:*`, `e2e:phone` con 0 píxeles, `verifyDeterminism`, integridad, recuperación de lotes y claves i18n.
   - break-ui con la bóveda L y datos hostiles.
9. **Fase 9 · limpieza y documentación.**
   - Limpiar solo el diff.
   - `CLAUDE.md` («Fase actual» y mapa), `docs/DECISIONS.md` (diario por lotes, puntos de control de FSRS, índice persistido, descartes) y `docs/PROMPTS.md` (guardar el Prompt 21).
   - Entrega final: tabla antes/después, optimizaciones descartadas con su motivo, tokens por modelo y límites de Safari.

## Notas
- Las cifras son de Chromium en el contenedor (no hay WebKit). La medición definitiva hay que hacerla en el iPad: arranque en frío, mover 100 notas y memoria con fotos grandes.
- La optimización «useProfile/Avatar a `src/ui/avatar.tsx`» (commit 29c2a3c) solo ahorra un 0.6 %. Se conserva porque es el requisito para cargar Perfil con `import()` (fase 2, punto 4).
- El `.apkg` de 5 000 tarjetas del generador necesita el paquete Python `anki` en un venv fuera del repo; sin él, se omite.
