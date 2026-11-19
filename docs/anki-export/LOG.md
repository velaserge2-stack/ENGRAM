# LOG Prompt 21 (Exportar Anki)

Tarea · dificultad · modelo · resultado · tokens aprox.

- Skills: instaladas break-ui, ponytail, systematic-debugging, webapp-testing, security-review (integrada). Faltan graphify, superpowers completo, code-simplifier, deslop: no instaladas (graphify: sin red/claves; se usa docs/audit/MAPA.md). code-simplifier/deslop solo Fase 6.
- Fase 0 · fácil · haiku · CONTRATO.md creado (53 líneas) · ~114K
- Fase 1 · media · sonnet · map.ts + 9 tests verdes · ~108K
- Fase 2 · difícil · opus · write.ts + worker.ts + 6 tests verdes · ~114K
- Fase 3 · difícil · opus · sched.ts + 4 tests verdes · ~101K
- Fase 4 · media · sonnet · botón+hoja+i18n+e2e:p16 verdes (Chromium) · ~120K
- Fase 5 · media · sonnet · extremos, seguridad (3 arreglos), suite completa verde (Chromium) · ~123K
- Fase 6a · difícil · opus · revisión del diff: 3 arreglos (Default, oclusión, Worker) · ~117K

## Resumen por modelo y tokens (aprox.)
| Fase | Modelo | Tokens aprox. |
|---|---|---|
| 0 | haiku | 114K |
| 1 | sonnet | 108K |
| 2 | opus | 114K |
| 3 | opus | 101K |
| 4 | sonnet | 120K |
| 5 | sonnet | 123K |
| 6a | opus | 117K |
| **Total** | | **≈ 797K** |

- Ahorro estimado frente a usar solo opus: ≈ 50 % (estimación con precios relativos aproximados: Haiku ≈ 0,07× y Sonnet ≈ 0,2× el de Opus; ≈ 410K equivalentes frente a ≈ 797K). No incluye caché ni diferencias de salida.
- code-simplifier y deslop no se instalaron (sin comando verificado). La simplificación la cubrió la revisión opus de la Fase 6a.
- Sin verificar: Anki real (escritorio/AnkiMobile/AnkiDroid), iPad/Safari, WebKit, `e2e:phone` MODE=compare (sin línea base).
