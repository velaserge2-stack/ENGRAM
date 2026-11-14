# Rendimiento · bitácora (Prompt 21)

Rama `rendimiento` desde `main` 5141ff6 (incluye la auditoría y sus correcciones). Coordinador en esta sesión; cada fase se delega a un subagente con el modelo indicado.

## Herramientas (2026-11-13)
- Skills (ya instaladas en `.claude/skills/`, no se reinstalan): ponytail, systematic-debugging (superpowers), webapp-testing, break-ui; security-review incluida en Claude Code.
- graphify: no instalada. En la auditoría se vio que envía contenido a APIs externas de IA si hay clave (ver `docs/audit/LOG.md`). En su lugar se usa `docs/audit/MAPA.md`. No se instala una alternativa (codebase-memory-mcp, code-review-graph) sin permiso del usuario.
- code-simplifier y deslop: no disponibles en el contenedor; en la fase 9 se aplican sus criterios a mano.
- Navegador: en el contenedor solo hay Chromium (no hay WebKit), así que todas las cifras son de Chromium. La memoria se mide con CDP.
- Se reutiliza: `e2e:perf` + `scripts/perf-fixtures.mjs` (PDF pesados, lienzo; Prompt 11), `e2e:notas-perf` + `scripts/note-fixtures.mjs` (notas e imágenes; Prompt 14), y las cifras de `docs/perf/` (incluido el vidrio).

| Tarea | Dificultad | Modelo | Tokens aprox. | Resultado |
|---|---|---|---|---|
| Fase 0 · línea base | media | sonnet | ~250k | Generador de bóvedas S/M/L, banco `npm run perf`, `baseline.json` y `baseline.md` con 10 objetivos con evidencia; contadores solo con `?perf` |
| Fase 1 · cuellos de botella | media | opus | ~350k | `e2e/rendimiento-perfil.mjs` (perfil CPU + operaciones al Worker por escenario), `01-cuellos.md` (10 cuellos con evidencia, hipótesis y plan por fase) y `01-perfiles.json`; trazas crudas fuera de git en `tests/fixtures/rendimiento/perfiles/` |
| Fase 2 · arranque y paquete | media | opus | ~400k | 4 commits: integridad en reposo (Notas tras Hoy -39 %), `dayKey` cacheado (Hoy -78 %, Estadísticas -53 %), perfil fuera de la entrada (-0.6 %), pantallas y hojas con `import()` (paquete inicial -28 % gzip, 315 → 226 KB); ninguna descartada; `02-arranque.md`; e2e y `e2e:phone` 0 píxeles |
| Detenido a petición del usuario | — | coordinador | — | Fases 0–2 a main; 3a a medias en `rendimiento-3a-wip`; ver PENDIENTE.md |

## Prompt 21-B (continuación, fases 3+)
Rama `rendimiento-2` desde `main` 974174a con el WIP `04d6abe` (cherry-pick). **Coordinador: Opus** (la sesión estaba configurada así, no en Sonnet); la fase 3 se hizo en línea, sin subagentes: lo difícil (lote y recuperación) es nivel opus, pero 3b (referencias, respaldo, progreso) habría podido ir a sonnet más barato. Mediciones en segundo plano con `npm run perf` (sin modelo).

| Tarea | Dificultad | Modelo | Tokens aprox. | Resultado |
|---|---|---|---|---|
| F3a · revisión del WIP y pruebas | difícil | opus | ~120k | Diseño correcto; corregido el deshacer tras un lote fallido (move.tsx, notemove.tsx); prueba nueva de muerte durante la recuperación |
| F3a · caché de carpetas (OPFS) | difícil | opus | ~40k | `HandleFS` con caché invalidada al borrar y reintento ante NotFound; `tests/dircache.test.ts` |
| F3b · #8 referencias en una pasada | media | opus (en línea) | ~20k | `refsRewriter`; equivalencia con 300 casos aleatorios |
| F3b · #5 respaldo por partes | media | opus (en línea) | ~25k | `zipVault`; equivalencia de contenido con el respaldo anterior |
| F3b · importar con progreso y Cancelar | media | opus (en línea) | ~20k | `BatchOptions` en el lote; Cancelar antes del diario no cambia nada |
| F3b · caché de listados | media | — | — | Pasa a la fase 6 (ver `03a-lotes.md`) |
| F3 · ajustes tras medir | media | opus (en línea) | ~30k | Caché sin vaciados por «no existe», `buildPlan` con un listado por raíz, respaldo con lectura solapada, progreso a un render por fotograma |
| F3 · mediciones (11 estados × M/L × 5) | fácil | — (script en segundo plano) | ~15k | Tablas en `03a-lotes.md`: mover 100 notas −53 %/−49 %, zip 500 −35 %, restaurar L −49 %, respaldo −45 % de memoria; diarios 200/500/2 606 → 1 |
| F4 · añadir sin reescribir (`appendAt`, diario v3) | difícil | opus (en línea) | ~40k | 4 operaciones pequeñas por respuesta en vez de reescribir 16.5 MB; recuperación idempotente |
| F4 · punto de control de FSRS + `state.json` diferido | difícil | opus (en línea) | ~60k | Reconstrucción por tarjeta, idéntica bit a bit (100 k hostiles, 4 zonas horarias); estudio L −63 % mediana, −69 % p95, 0 tareas largas, 1 diario por respuesta (`04-fsrs.md`) |
| F4 · replay en Worker, mazos en Worker | — | — | — | Descartados (ver `04-fsrs.md`) |
| F5 · caché de textos de notas (IndexedDB, firma del listado) | media | opus (en línea) | ~30k | Abrir Notas L 6.2 → 1.2 s (−81 %), M 1.36 → 0.41 s (−70 %) desde la segunda visita (`05-busqueda.md`) |
| F5 · buscar en la nota (búsqueda binaria) | media | opus (en línea) | ~10k | Nota de 5 MB 2.88 → 1.25 s (−57 %); 1 MB −25 % |
| F5 · no reconstruir el índice al volver | media | opus (en línea) | ~5k | Revertido: sin mejora medible en la navegación (regla < 5 %) |
| F5 · índice persistido en IndexedDB; abrir nota de 5 MB por tramos | — | — | — | Descartado el primero (el costo está en el Worker, no en el camino del usuario); el segundo queda pendiente por su efecto en buscar/imprimir |
