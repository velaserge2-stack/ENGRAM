# LOG Prompt 23 (Asistente)

- Fase 0 · Explore/haiku (confirmar archivos) + Plan/opus (auditoría) · `00-auditoria.md` · sin cambios de código.
- Skills: instaladas ponytail, break-ui, systematic-debugging, webapp-testing. impeccable, apple-design y caveman NO instaladas aún (se revisan origen/licencia/red antes, en la fase 1).
- Fase 1a · opus(Plan, contrato) + sonnet (núcleo) · src/chat/* + 24 pruebas verdes · SDK instalado
- Fase 1b · sonnet · Ajustes+CSP+precache+i18n+e2e:chat verdes (Chromium); vitest 847 · ~151K
- Fase 2 · sonnet · panel compacto/grande, streaming, rotación visible, teléfono; e2e:chat 4/4, phone compare 0 px (add-on apagado) · ~203K
- Fase 3a · sonnet · lectura+citas (~168K) · Fase 4 · sonnet · mascota (~88K) · Fase 3b · sonnet · escritura+preview+undo (~191K) · seguridad opus lectura (~121K)
- Fase 5a · sonnet · arreglos de seguridad (9 hallazgos) + pruebas · ~140K
- Fase 5b · sonnet · arreglos de escritura (undo seguro, cola, wantsWrite, tope) + break-ui + phone compare (33/36 a 0 px; 3 = fila nueva en Add-ons) · ~160K · opus seguridad escritura ~102K

## Tabla final por fase (modelo y tokens aproximados)
| Fase | Modelo | Tokens aprox. |
|---|---|---|
| 0 · auditoría (Explore + Plan) | haiku + opus | no registrado |
| 1a · núcleo (`src/chat/*`) | opus (Plan, contrato) + sonnet | no registrado |
| 1b · Ajustes, CSP, precache, i18n | sonnet | ~151K |
| 2 · panel de chat | sonnet | ~203K |
| 3a · lectura y citas | sonnet | ~168K |
| 4 · mascota | sonnet | ~88K |
| 3b · escritura, vista previa, deshacer | sonnet | ~191K |
| 3 · revisión de seguridad (lectura) | opus | ~121K |
| 5a · arreglos de seguridad | sonnet | ~140K |
| 5b · arreglos de escritura + break-ui | sonnet | ~160K |
| 5b · revisión de seguridad (escritura) | opus | ~102K |

Total registrado ≈ 1,32 M tokens (sin 0 ni 1a).

## Skills
- Instaladas: ponytail, break-ui, systematic-debugging, webapp-testing, security-review.
- NO instaladas: impeccable, apple-design, caveman. Pendiente revisar origen, licencia y si hacen red.

## Sin verificar
- Docs oficiales de Google y Groq no accesibles: límites gratuitos, modelo `gemini-3.5-flash`, forma de errores, CORS y políticas de datos.
- Safari, iPad e iPhone reales; teclado virtual real (solo viewport reducido).
- Tool-calling y calidad de citas con Gemini/Groq reales (solo simulados en `e2e/chat.mjs` y `tests/chat-tools.test.ts`).
- Anki no aplica a este add-on.
- `e2e:phone`: 33 de 36 capturas a 0 px; las 3 de Add-ons difieren por la fila nueva del add-on.
- reduced-motion en teléfono sin confirmar.
- Fase 3 con APIs reales: pendiente.
- Ramas `notas-pro` y `mejoras-2` NO fusionadas por decisión (`origin/notas-pro` y `origin/mejoras-2` no están en `main`). `asistente` sin unir a `main`.
- Fix probar · paso 1 haiku (mapa de errores) · paso 2 sonnet (detail seguro, kinds model/timeout, línea técnica) ~112K
- Fix probar · paso 3 sonnet (modelo configurable + listar modelos; defecto Gemini gemini-flash-latest 🔸) ~128K
- Fix examen · sonnet (systematic-debugging): no reproducible en memoria/Chromium; línea técnica de error en la vista previa + tests ~110K
- Borrar · sonnet · borrar_nota/mazo/banco/evento con confirmación y papelera ~173K
- Borrar · opus revisión (~106K) · sonnet arreglos 7 hallazgos (~114K)
- Crear · sonnet · crear_nota, crear_diagrama, registrar_examen con vista previa y deshacer ~197K
- Proveedores · sonnet · OpenRouter + Kimi (openai-compatible), 4 claves, CSP 4 hosts ~134K
