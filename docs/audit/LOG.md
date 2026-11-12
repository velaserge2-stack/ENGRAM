# Registro de auditoría

## 2026-11-12 · Instalación de skills (alcance de proyecto: `.claude/skills/`)

Método: se clonó cada repositorio, se leyó su `SKILL.md` y los scripts que acompaña, y se copiaron a `.claude/skills/<nombre>/` exactamente esos archivos con su licencia (equivale a `npx skills add` para Claude Code, sin instalar otra herramienta). Claude Code carga `.claude/skills/` al iniciar la sesión: quedan disponibles desde la siguiente sesión.

| Skill | Fuente | Versión / commit | Licencia | Revisión | Resultado |
|---|---|---|---|---|---|
| ponytail | github.com/DietrichGebert/ponytail (`skills/ponytail`) | 96608e0 (paquete 5.3.3) | MIT | Solo instrucciones (52 líneas). No se instalaron el plugin, los hooks ni la línea de estado del repositorio: solo el `SKILL.md`. | Instalada |
| superpowers → systematic-debugging | github.com/obra/superpowers (`skills/systematic-debugging`) | 22f0b46 | MIT | Instrucciones + `find-polluter.sh` (biseca pruebas con `npm test`, solo local). No se instaló la colección completa. | Instalada |
| webapp-testing | github.com/anthropics/skills (`skills/webapp-testing`) | 2c5958e | Apache-2.0 | Instrucciones + `with_server.py` (levanta el servidor local y espera el puerto; sin red externa). | Instalada |
| break-ui | github.com/emilkowalski/skills (`skills/break-ui`) | f7ce8c0 | MIT | Instrucciones + catálogo de datos extremos. Sin scripts. | Instalada |
| security-review | Incluida en Claude Code (`/security-review`) | — | — | Ya disponible en la sesión. | No se reinstaló |
| graphify | github.com/safishamsi/graphify · PyPI `graphifyy` | 52cb282 · CLI 0.9.108 | **Apache-2.0** (relicenciada; el código previo sigue bajo MIT, `LICENSE-MIT`) | Ver nota. | Instalada (CLI + skill) |
| code-simplifier | Plugin oficial `anthropics/claude-plugins-official` | — | — | Se instala con comandos `/plugin` que solo puede escribir el usuario. | Pendiente del usuario |
| deslop | `brianlovin/agent-config` | — | No verificada | El repositorio no es accesible desde aquí (ni `agent-config` ni `claude-config`): no se pudo leer su `SKILL.md` ni su licencia. | No instalada |

### Nota sobre graphify
- Requisitos: `uv` 0.x y Python 3.13 presentes. `uv tool install graphifyy` → `~/.local/share/uv/tools/graphifyy/` y `~/.local/bin/graphify`, `graphify-mcp` (fuera del proyecto; el contenedor es efímero, hay que reinstalar el CLI en cada sesión nueva).
- Red: el análisis de código es local (tree-sitter). Solo llama a una API LLM (Anthropic, OpenAI, Gemini, DeepSeek, Kimi, Azure, Bedrock) si encuentra su clave en el entorno; aquí no hay ninguna. Para impedirlo aunque aparezca una, `.claude/settings.json` fija `GRAPHIFY_BACKEND=off`. Los enlaces a «Graphify Cloud» solo se imprimen; `GRAPHIFY_NO_TIPS=1` los oculta. No se encontró telemetría.
- **`graphify install --project` hizo más de lo documentado para ese modo**: además de `.claude/skills/graphify/` y `.claude/CLAUDE.md` (registro de una línea), escribió una sección «## graphify» en el `CLAUDE.md` raíz y registró hooks `PreToolUse` (Bash, Grep, Read, Glob) y `SessionStart` en `.claude/settings.json`. **Se revirtieron ambos** (CLAUDE.md restaurado con git; hooks eliminados): obligaban a consultar el grafo antes de cada lectura y fallarían en sesiones sin el CLI.
- No se ejecutó `/graphify` (queda para la etapa 1b). Generará `graphify-out/`, ya añadida a `.gitignore`.
- Sus aristas `INFERRED` y `AMBIGUOUS` no son evidencia: verificar con el código antes de reportar. Medir el ahorro real de tokens; la cifra 71.5× es del propio proyecto.
