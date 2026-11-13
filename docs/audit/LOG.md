# Auditoría · bitácora (Prompt 13)

Rama `auditoria` (desde `main` 11b1906). Coordinador en esta sesión; cada etapa se delega a un subagente con el modelo indicado.

## Etapa previa · skills (2026-11-13)

| Skill | Fuente | Versión / commit | Licencia | Resultado |
|---|---|---|---|---|
| ponytail | DietrichGebert/ponytail, copiada en `.claude/skills/ponytail` | commit 911ce21 del proyecto | MIT | Ya disponible; no se reinstala |
| superpowers (depuración) | obra/superpowers → `.claude/skills/systematic-debugging` | commit 911ce21 | MIT | Ya disponible (la parte de depuración sistemática); no se reinstala la colección |
| webapp-testing | anthropics/skills → `.claude/skills/webapp-testing` | commit 911ce21 | Apache-2.0 | Ya disponible |
| break-ui | emilkowalski/skills → `.claude/skills/break-ui` | commit 911ce21 | MIT | Ya disponible |
| security-review | Incluida en Claude Code | — | — | Disponible en la sesión |
| code-simplifier | anthropics/claude-plugins-official (plugin) | — | — | **Pendiente**: los comandos `/plugin` los tiene que escribir el usuario. Solo hace falta en la etapa 4b; la skill incluida `simplify` sirve de alternativa |
| deslop | brianlovin/agent-config | — | sin verificar | **Pendiente**: desde este contenedor no se puede clonar GitHub fuera del repositorio del proyecto, así que no se pudo leer su `SKILL.md` ni su licencia. No se instaló. Solo hace falta en la etapa 4b |
| graphify | PyPI `graphifyy` 0.9.108 (revisado sin instalar) | 0.9.108 | Apache-2.0 / MIT | **No instalada**, por tres señales. (1) `llm.py` envía contenido a APIs externas de IA (Anthropic, OpenAI, DeepSeek, Moonshot, Gemini, Azure) para la extracción semántica si hay una clave configurada. (2) Escribe fuera del proyecto (`~/.graphify/`, `~/.cache/graphify/`, carpetas de skills de varios agentes) e imprime enlaces comerciales con utm. (3) Su `Project-URL` es `Graphify-Labs/graphify`, no el `safishamsi/graphify` del prompt. Código privado y comercial: queda a decisión del usuario. Las etapas 2–4b leen el código con `grep` |

Activas para la auditoría (≤ 6): ponytail, systematic-debugging, webapp-testing, break-ui, security-review.

## Etapa 0 · herramientas (2026-11-13) · subagente Haiku

- Ejecutado: `tsc --noUnusedLocals/--noUnusedParameters`, `knip`, `madge --circular`, `jscpd` (min 15 líneas), cobertura Vitest con `@vitest/coverage-v8@5.1.0` (`--no-save`) y `npm run build`. Detalle y comandos en `docs/audit/00-herramientas.md`.
- tsc: 10 errores (imports y parámetros sin uso en src/), todos seguro de eliminar.
- knip: 6 archivos sin uso (falso positivo probable), 1 devDependency (`@types/markdown-it`, revisar), 3 binarios no listados (falso positivo probable) y 99 exportaciones/tipos sin uso: 77 seguro de eliminar, 2 falso positivo probable, 20 revisar.
- madge: 0 ciclos. jscpd: 0 clones. tsc: 10 imports/parámetros sin uso, todos seguro de eliminar.
- Cobertura: 72.49 % de líneas en src/. Una prueba (`p14`, LRU) supera los 5 s bajo cobertura; pasa con `--testTimeout=60000` (310/310). Build correcto con un aviso de import dinámico ineficaz en `profile.tsx`.
- Fallos de herramientas: ninguno, salvo el timeout de `p14` descrito arriba.

## Etapa 1 · mapa (2026-11-13) · subagente Haiku

- Mapeado `src/` por carpeta (dependencias calculadas desde los `import`), flujos clave con `archivo:línea`, zonas críticas y los 15 archivos más largos y con más imports. Detalle en `docs/audit/MAPA.md` (276 líneas).
- Hallazgo de riesgo alto para la etapa 2: `appendLog` (`src/data/collection.ts:141`) usa `readTextOr(…, '')`, así que un error de lectura puede sustituir `reviews.jsonl` por la última línea. Sin confirmar aún.
- Mapa: DeckStore y ExamStore no existen; la sincronización entre paneles es `noteStore` (`src/notes/store.ts`) más recarga por contador en `app.tsx`.
- graphify / etapa 1b omitida: no se instaló (ver tabla de skills arriba); el grafo de dependencias se calculó con un script de lectura de `import`.

## Etapa 2.1 · src/lib (2026-11-13) · subagente Sonnet

- Revisados los 24 módulos de `src/lib/`. Informe en `docs/audit/02-lib.md`: 17 hallazgos (3 altos, 7 medios, 7 bajos).
- Altos: `ensureFileId` reescribe el frontmatter perdiendo líneas que el parser no entiende y sobrescribe la nota con un archivo casi vacío si la lectura falla; la ida y vuelta de `frontmatter.ts` altera números (`1.0`→`1`), barras invertidas y vacíos.
- Pruebas: `tests/audit-lib.test.ts` con 14 `it.fails` (todas reproducen el error); cambiarlas a `it()` al corregir. Sin cambios en `src/`.

## Etapa 2.2 · cards/srs/data (2026-11-13) · subagente Sonnet

- Revisados `cards/parse`, `srs/engine`, `srs/queue` y `data/*` (collection, ops, extra, decktrash, move). Informe en `docs/audit/02-data.md`: 14 hallazgos (3 altos, 5 medios, 6 bajos).
- Altos: el patrón `readTextOr(…, '')` seguido de escritura destruye datos con una lectura fallida en `appendLog` (historial FSRS), `appendCard`/`setDeckMeta` (mazo) y `restoreAttempt` (intentos); además `appendLog` pierde entradas si se solapan dos llamadas.
- Pruebas: `tests/audit-data.test.ts` con 17 `it.fails` (cambiar a `it()` al corregir). Sin cambios en `src/`. Sección «para etapa 3» en el informe.

## Etapa 2.3 · notes/sim/io (2026-11-13) · subagente Sonnet

- Revisados `notes/*`, `sim/*`, `io/*` y la lógica pura de `md`, `share/period`, `tasks`, `stickies`, `ink`, `pdf`. Informe en `docs/audit/02-notes-io.md`: 26 hallazgos (3 altos, 13 medios, 10 bajos).
- Altos: `noteStore.load/refresh` cachea `''` ante una lectura fallida y el autosave pisa la nota; `rewriteNoteRefs` convierte `[[Título]]` en `[[Materia/Título]]` al mover una nota suelta (enlaces rotos); la importación admite `.app/journal.json` y `.app/tmp/*`.
- Pruebas: `tests/audit-notes-io.test.ts` con 30 `it.fails` (cambiar a `it()` al corregir). Sin cambios en `src/`. Sección «para etapa 3» en el informe (zip con cabeceras mentirosas, `.apkg`, sanitización, NoteStore, memoria en Safari).

## Etapa 2.4 · vault (2026-11-13) · subagente Sonnet
Informe en `docs/audit/02-vault.md`: 10 hallazgos (2 alta, 4 media, 4 baja); 8 `it.fails` en `tests/audit-vault.test.ts`.
Raíz del patrón `readTextOr(…, '')`: `util.ts` atrapa todas las excepciones; corrección central: solo `VaultError` `not-found`.
Alta: `move(a, a)` borra el archivo y `HandleFS.move` borra recursivamente un destino-carpeta. Código de error de cuota del Worker llega numérico.

## Etapa 2.5 · screens/ui (2026-11-13) · subagente Sonnet
- Revisados efectos y manejadores asíncronos de `screens/` (notes, spaces, study, deck, pdf, pdfs, pomodoro, simulacros, inbox, backup, settings), `ui/md|background`, `app.tsx`, `state.tsx`. Informe en `docs/audit/02-ui.md`: 16 hallazgos (3 altos, 6 medios, 7 bajos).
- Altos: el patrón `readTextOr(…, '')` + escritura vuelve en `simulacros.finish` (historial de intentos), `DeckEditor` (mazo; además sin `key`/`alive` al cambiar de ruta) y anotaciones de PDF; `study.answer` deja `busy` fijo si falla la escritura.
- Pruebas: `tests/audit-ui.test.ts` con 2 `it.fails` (doble `decodeURIComponent` en `spaces.tsx:111`). Sin cambios en `src/`. Sección «para etapa 3» en el informe.
