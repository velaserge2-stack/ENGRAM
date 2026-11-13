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
