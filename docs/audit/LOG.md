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
