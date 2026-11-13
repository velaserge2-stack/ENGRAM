# Auditoría · Etapa 4 · reducción de código (ponytail)

Fecha: 2026-11-13. Rama `auditoria`. Alcance aprobado: A (10 imports/parámetros sin uso) y B (exportaciones «seguro de eliminar» de knip). Sin cambios de comportamiento, formato ni textos.

## Resultado
- `git diff --shortstat 4d08965..HEAD -- src`: 56 archivos, +69 / −127 líneas (neto −58).
- Sin dependencias quitadas (`@types/markdown-it` queda: «revisar»).
- Entrada JS (`dist/assets/index-*.js`): antes 302 917 B / 97 043 B gzip -9; después 302 891 B / 97 053 B gzip (−26 B sin comprimir; la diferencia de gzip es ruido).
- Cobertura de líneas: antes 72.49 % (3 629/5 006); después 72.51 % (3 725/5 137), mismo comando que la etapa 0 (`--testTimeout=60000`).
- Vitest: 316 pasan, 88 fallos esperados (sin cambio) antes de cada commit; typecheck y build verdes.
- e2e: `npm run e2e` OK, `npm run e2e:flows` OK, `e2e:phone` en modo compare: **0 píxeles** de diferencia en 36 capturas (línea base generada desde `4d08965`). No apareció el error intermitente de import dinámico.

## A · imports y parámetros sin uso (commit 1)
`go` (calendar), parámetro `a` → `()` (calendar), `locale` (exams, inbox), `Network` (notes), `createDeck` (simulacros), `renderMarkdown` (spaces), `modalOpen` (study), `Settings` (background), `Link2` (links). El parámetro `a` era de un `.map` sin uso: se quitó (no hay aridad esperada).
`tsc --noUnusedLocals --noUnusedParameters` queda en 0 errores en `src/` (queda 1 en `tests/audit-criticos.test.ts`: import `STATE` sin uso, fuera de alcance).

## B · exportaciones
Código borrado (sin ningún uso, pequeño): `isCardStart`, `saveDeckText` (+ import `ensureIds`), `onLang`, `allKeys`, `todayKey`, `fillFor` (+ helper privado `mix`, que solo usaba), `rAt` (+ import `forgetting_curve`), `joinPath`, `readJson`, tipo `Route`.
Solo se quitó `export` (el símbolo se usa en su archivo): 58 símbolos en `src/data, ink, io, lib, md, notes, pdf, screens, sim, tasks, ui, vault` y `state.tsx`/`theme.ts` (entre otros `EMBED_RE`, `PHONE_QUERY`, `MUSIC_DIR`, `DeleteDecks`, `ClashSheet`, `IntegrityProblem`, `SheetId`). Verificados con grep (palabra completa) en src/, tests/, e2e/, scripts/ e `index.html`; sin usos externos.
Los commits por carpeta se verificaron en conjunto (typecheck, vitest y build tras aplicar todos), no uno por uno: quitar `export` sin importadores no puede romper un subconjunto.

## Preguntas para el usuario (no tocado)
1. Marcados «seguro» pero **importados por `tests/audit-*.test.ts`** (conservan `export`): `REVIEWS`, `ARCHIVE`, `loadStates`, `loadExtra`, `PDF_META`, `runNoteMove`, `qid`, `reviewsToday`, `parseHash` (y `STATE`, «revisar»). ¿Se mantienen exportados por las pruebas de auditoría o se prefiere que las pruebas usen otra vía?
2. Todo lo marcado «revisar» o «falso positivo probable» en `00-herramientas.md` (p. ej. `blocks`, `STATE`, `paramsKey`, `raw`, `kindOf`, `download`, `fmt`, `dirOf`, `History`, `Sticky`, `audioSession`, `THUMB_LONG`) queda igual.
3. `@types/markdown-it` (revisar), scripts/e2e que knip llama «sin uso», y el aviso INEFFECTIVE_DYNAMIC_IMPORT de `profile.tsx`.
4. `tests/audit-criticos.test.ts` importa `STATE` sin usarlo.
5. Ninguna corrección de `02-*.md` ni `03-criticos.md` se aplicó (requieren aprobación).
