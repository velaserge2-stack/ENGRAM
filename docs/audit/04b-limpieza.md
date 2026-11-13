# Etapa 4b · limpieza de texto sobrante

Las skills code-simplifier y deslop no estaban disponibles; se aplicaron sus criterios a mano (ponytail). No había TODO/FIXME pendientes ni código comentado en `src/` (solo dos `TODO` que son la palabra «todo» en mayúsculas dentro de comentarios con sentido).

El código ya documenta casi todo el porqué (Safari, Prompts, seguridad, formatos). Se eliminaron solo rótulos que repiten lo que el código muestra.

| Módulo | Comentarios eliminados | Código eliminado |
|---|---|---|
| src/lib | 2 (`settings.ts`: rótulos «estudio (FSRS)», «pomodoro») | 0 |
| src/srs + src/data | 3 (`queue.ts` «refinar al minuto»; `data/move.ts` «calendario», «exámenes») | 0 |
| src/screens + app | 4 (`study.tsx`, `calendar.tsx`, `app.tsx` ×2) | 0 |
| notes/sim/io/md/share/tasks/stickies/ink/pdf, vault, ui | 0 | 0 |

Total: 9 líneas, solo comentarios. Simplificaciones de código: ninguna.

## Dudé (conservados)
- Rótulos de grupo en `lib/keys.ts` («globales», «repaso», «simulacros», «tinta») y `share/card.ts` («1. fondo», «3. contenido», emparejados con «2.» que sí explica): navegación de listas largas.
- Separadores `// ───── sección ─────` en `notes/format.ts`, `notes/model.ts`, `ui/background.tsx`.
- Los pasos `(1)/(2)` del guardián en `ui/background.tsx` y los comentarios de `notes/format.ts:68-81`: explican el orden de decisiones.
- JSDoc de una línea en `ui/*`, `share/*`, `tasks/*`: documentan intención o unidades, no repiten el nombre.

## Verificación
typecheck, vitest (316 pass / 88 expected fail), build, `e2e`, `e2e:flows` y `e2e:phone` compare (0 píxeles en 36 capturas) en verde.
