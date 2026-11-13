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
