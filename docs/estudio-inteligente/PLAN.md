# Estudio inteligente · plan (rama `estudio-inteligente`, desde `main`; no unir sin confirmación)

Base: auditoría de solo lectura (ver «Hallazgos»). Reglas del repo mandan (CLAUDE.md). Sin backend, sin telemetría; todo se calcula de `reviews.jsonl` / `exam-attempts.jsonl` (la verdad); nada de contadores duplicados. IA solo vía add-on Asistente, siempre con vista previa y revisión humana (`origen: ia`).

## Carriles (dueño único de archivos; cada uno en su worktree/rama)
| Carril | Rama | Alcance (MVP de esta tanda) | Archivos propios |
|---|---|---|---|
| **A · Analítica** | `ei-analitica` | 1 Detección de debilidades · 2 Mapa de dominio (materia>tema>subtema, de la ruta del mazo) · 3 Predicción 7/30/90 d · 4 Repaso cruzado (confusiones por co-fallo y por distractor elegido) · 5 Sesión adaptativa · 6 Detección de olvido (recaídas) · 7 Objetivos inteligentes (nuevas/día por examen y carga) | nuevo `src/lib/analytics.ts` (puro) · `src/srs/adaptive.ts` (nuevo; no toca `engine.ts` ni `nextCard`) · `src/screens/stats.tsx` · `src/screens/today.tsx` · `src/screens/study.tsx` (solo punto de entrada) · tests `tests/analytics-*.test.ts` · `e2e/analitica.mjs` |
| **B · Exámenes** | `ei-examenes` | Examen dinámico por temario · dificultad progresiva · adaptativo (más peso a temas fallados) · modo examen real (sin pistas ni feedback, tiempo) · análisis de distractores · comparar intentos · repetir falladas automático · equivalentes (selección + plantilla para IA) · generador IA con revisión pregunta a pregunta | nuevos `src/sim/pick.ts`, `src/sim/analysis.ts`, `src/sim/review.ts` · `src/screens/simulacros.tsx` · `src/chat/tools-exam.ts` (nuevo; solo exporta, NO se cablea) · tests `tests/sim-*.test.ts` · `e2e/examenes2.mjs` |
| **C · Asistente** | `ei-asistente` | Chat con contexto (abrir desde nota/PDF/mazo/espacio) · modo socrático · explicación multinivel · verificación de fuentes (página/nota) · conversión de clase → notas+tarjetas+preguntas+diagrama+simulacro · voz bidireccional (dictado + `speechSynthesis`) · **roles** Tutor / Examinador / Investigador / Creador / Analista | nuevos `src/chat/roles.ts`, `src/chat/context.ts`, `src/chat/tools-convert.ts`, `src/chat/voiceout.ts` · `src/chat/system.ts` · `src/chat/turn.ts` · `src/chat/panel.tsx` · `src/chat/conv.tsx` · `src/chat/tools.ts` · tests `tests/chat-roles*.test.ts` · `e2e/asistente2.mjs` |

## Reglas anti-pisado
1. Nadie toca: `engine.ts`/`replay` (determinismo FSRS), `package.json`, `CLAUDE.md`, `docs/DECISIONS.md`, `src/lib/settings.ts`, `src/app.tsx`, `src/screens/router.tsx`, `src/screens/addons.tsx`. **Solo el integrador** (yo) los edita al final.
2. i18n (es/en/fr, claves planas): cada carril añade SU bloque con prefijo propio (`analitica.*`, `examen2.*`, `asist2.*`) insertado justo tras la última clave de su zona (`stats.`, `simulacros.`, `chat.`), en los tres idiomas. Paridad probada por `npm test`.
3. B no cablea herramientas en `turn.ts`: exporta `makeExamTools(ctx)` y C (dueño de `turn.ts`) lo importa con `import()` cuando B lo entregue; hasta entonces C usa lo existente (`crear_examen`).
4. Datos nuevos: solo campos opcionales y perezosos (retrocompatibles). Prohibido cambiar `rating`/`op` de `LogEntry`. `qid` de bancos: casar también por `legacyQid`.
5. Cada carril: `npm run typecheck`, `npm test`, su e2e (con `flock /tmp/e2e.lock`) y `npm run e2e` + `e2e:uiaudit` antes de entregar. Commits pequeños en su rama; no unir a `main`.
6. Tokens: leer solo `docs/audit/MAPA.md` (sección de la carpeta), archivos nombrados arriba; no releer carpetas; reportes en modo caveman (≤ 25 líneas).

## Fases
0. Auditoría ✔ (agente de solo lectura).
1. Carriles A, B, C en paralelo (esta tanda).
2. Integrador: unir ramas en orden A → B → C a `estudio-inteligente`, resolver i18n/`package.json`, cablear `makeExamTools`, registrar scripts e2e, CLAUDE.md, DECISIONS.md.
3. Regresión completa y reporte; unir a `main` solo con confirmación.

## Hallazgos clave de la auditoría
- Datos ya disponibles: `CardState` (stability, difficulty, lapses, history 50), `reviews.jsonl` (rating, state) → recaída = `state===Review && rating===Again`; `retrievability()` (`engine.ts:162`) acepta fecha futura; `topicStats`/`decksForTopic`/`projectedRetention`/`pace` en `src/lib/exams.ts`; `Attempt.answers` guarda la opción elegida (sirve para distractores).
- No existe: etiquetas por tarjeta (tema = ruta del mazo o `tag:` del mazo), vínculos entre tarjetas, explicación por distractor, contexto inicial en el chat, TTS en el chat, selección de preguntas por tema/dificultad.
- Ya existe: modo `sim` (cronómetro, sin pistas), `practice`/`errors`, «crear tarjetas de las falladas», `crear_examen` con `origen: ia` + vista previa, `cites.ts` (fuentes), dictado.
- Riesgos: Groq `histTokens` 2000 (roles/contexto deben respetar `BUDGET`), `wantsWrite` por palabras clave (botones/roles internos deben forzar herramientas), `crear_examen` ≤ 15 / `crear_tarjetas` ≤ 30 por llamada (partir en propuestas).
