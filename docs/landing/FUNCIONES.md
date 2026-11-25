# Engrama · funciones (hoy)

Fuente: código y docs del repo a 2026-11-25. Cada dato lleva su archivo entre `[]`.
Núcleo = siempre activo. Add-on = interruptor en Ajustes; apagado = no carga su código.

## 1 Repaso
- Repaso espaciado FSRS (`ts-fsrs`): 4 botones con el intervalo previsto en cada uno. Núcleo. [src/srs/engine.ts, README.md]
- Historial `reviews.jsonl` es la verdad; `state.json` se reconstruye. [CLAUDE.md]
- «¿Por qué esta fecha?»: estabilidad, dificultad, últimas respuestas. Deshacer (⌘Z), modo recuperación tras ausencias. [README.md]
- Tipos: básica, inversa (2 tarjetas), escribir respuesta («casi correcto»), cloze con pistas, lista, opción múltiple, unir, ordenar, oclusión y etiquetar imagen. [docs/SPEC.md §4b, README.md]
- Estadísticas: retención real, pronóstico 30 días, distribuciones, tarjetas en riesgo. Núcleo. [README.md]
- Add-ons encendidos: mapa de adherencia 53×7 (`heatmap`), resumen del día (`summary`), lectura en voz alta (`tts`), navegador con `tag:`/`due:`/`is:leech` (`browser`), editar durante el repaso (`edit-review`), etiquetas `padre/hijo` (`tags`). [src/screens/addons.tsx]
- Pomodoro y modo enfoque (fondo oscuro en estudio). [README.md, docs/DESIGN.md]
- Apagados: reto de 30 tarjetas, XP, dato al azar. [src/screens/addons.tsx]

## 2 Mazos e Anki
- Mazos en Markdown (`decks/…/<Mazo>.md`) con ID de bloque. [docs/SPEC.md §4, README.md]
- Importar `.apkg`: formato nuevo (`anki21b`, zstd, esquema v18), `anki21`, `anki2`; también `.zip`. Hoja de resumen antes de confirmar. [README.md, src/io/apkg.ts]
- Exportar `.apkg` formato v11 (Básica y Cloze), historial opcional. [README.md, src/io/apkgexport/]
- Importar CSV/TSV con vista previa. [docs/SPEC.md §4b]
- Límite: sin plantillas, CSS, LaTeX ni JS de Anki. [README.md]
- Papelera de mazos con deshacer. [src/data/decktrash.ts]

## 3 Notas
- Materia → Tema → Notas; diario en `notes/Diario/`. [README.md]
- Editor de bloques con «/», vista en vivo y barra fija (formato, listas, tablas, imagen, mover bloques, deshacer). [docs/SPEC.md §10, CLAUDE.md]
- Enlaces `[[wikilinks]]`, backlinks, menciones sin enlazar, plantillas `{{fecha}}`. [docs/SPEC.md §10]
- Grafo oculto por defecto. Historial de versiones, papelera, buscador ⌘K (minisearch). [README.md, package.json]
- Fotos: guarda el original; miniaturas en caché; `![[foto|300|izq]]`. [CLAUDE.md, src/md/embed.ts]
- Diagramas: tipos mapa, flujo y diagrama; bloques ```` ```mapa ````; escribir en el sitio; 8 colores por nodo; exportar PNG/SVG/PDF. [src/notes/diagramtype.ts, CLAUDE.md]
- Exportar nota a `.md`, `.docx` o PDF; importar `.docx` y `.pdf`. [README.md]

## 4 PDF y tinta
- Biblioteca de PDF con miniaturas y progreso. Resaltador, subrayado, tinta; notas aparte del PDF. [README.md]
- Presión del Apple Pencil en la tinta (`pointerType === 'pen'`). [src/ink/InkLayer.tsx]
- Exportar PDF anotado o resumen `.md`. [README.md]
- PDF pesados por trozos y rangos; visor virtualizado. [CLAUDE.md]

## 5 Exámenes y simulacros
- Exámenes `exams/*.md`: temas, meta de retención, repaso final. Ritmo: en ritmo / ajustado / atrasado; «Ajustar plan». [README.md]
- Simulacros: importa Markdown, CSV, JSON; TXT, DOCX y PDF con mejor esfuerzo. Vista previa obligatoria. [README.md]
- Modos simulacro, práctica y repaso de errores; tiempo con `endAt` (sobrevive a cerrar Safari). [README.md]
- Resultados por tema; «crear tarjetas de las falladas». Intentos con papelera. [README.md, CLAUDE.md]
- Bancos de simulacro con papelera propia. [src/sim/banktrash.ts]

## 6 Calendario y tareas
- Mes, semana y día con horas; arrastrar para mover o cambiar duración. [README.md]
- Repetición diaria, semanal o mensual, con excepciones. Capas de pronóstico y exámenes. [README.md]
- Exportar `.ics` con alarmas. La web no escribe en el Calendario de iOS. [README.md]
- Add-on apagado `tasks` (`- [ ]` y 📅, `notes/Tareas.md`). [src/tasks/, src/screens/addons.tsx]
- Add-on apagado `sticky-notes` (`notes/Stickies/`). [src/stickies/]
- Add-on apagado `inbox`: Plaud, fotos, PDF y Word en 4 pasos. README la describe como pestaña; el código la oculta. [README.md, src/screens/addons.tsx]

## 7 Espacios y lienzo
- Mosaico de 1–3 paneles o lienzo infinito con paneo y zoom. [README.md, CLAUDE.md]
- Paneles: nota, mazo, tema, simulacros, PDF, documento, CSV, imagen, pomodoro, estadísticas, calendario. [README.md]
- Minimapa: tocar centra, arrastrar mueve, plegable. [src/lib/minimap.ts]

## 8 Asistente GREX (add-on `assistant`, apagado)
- 4 proveedores: Gemini, Groq, OpenRouter, Kimi. Hasta 4 claves propias. [src/chat/providers.ts, src/chat/keys.ts MAX_KEYS]
- Hosts exactos: generativelanguage.googleapis.com, api.groq.com, openrouter.ai, api.moonshot.ai. [CLAUDE.md]
- Lee: `leer_mazo`, `leer_nota`, `leer_pdf`, `buscar_notas`, `listar_mazos`, `listar_examenes`, `ver_calendario`. [src/chat/tools.ts]
- Propone con vista previa, Aceptar y deshacer: `crear_nota`, `crear_tarjetas`, `crear_examen`, `crear_diagrama`, `agregar_evento`, `modificar_evento`, `registrar_examen`. [src/chat/tools-write.ts]
- Borrar (`borrar_mazo`, `borrar_nota`, `borrar_banco`, `borrar_evento`): a la papelera, tras confirmar. [CLAUDE.md, src/chat/delete.ts]
- Dictado con el del sistema; acciones rápidas editables. [src/chat/dictbtn.tsx, CLAUDE.md]
- Límites por proveedor en código: Gemini 10 rpm/250 rpd; Groq 30/1000; OpenRouter 20/50; Kimi 20/1000. [src/chat/providers.ts]
- Clave solo en este navegador, fuera del respaldo. Sin clave o apagado: cero peticiones. [README.md]

## 9 Datos y privacidad
- Fuente de verdad: `.md`, `.jsonl`, `.json`, `.ics` en la carpeta de la bóveda. [CLAUDE.md, README.md]
- Sin backend, sin cuentas, sin telemetría; CSP en `index.html`. [README.md, CLAUDE.md]
- 100 % offline tras instalar la PWA. [README.md]
- Escrituras por `SafeVault`: diario, temporal y suma de verificación. [src/vault/safe.ts]
- Integridad: informa, nunca borra ni corrige. [src/vault/integrity.ts, CLAUDE.md]
- Respaldo `.zip` (formato 1) con vista previa y deshacer importación. [src/io/zip.ts, README.md]

## 10 Experiencia
- Tema Cristal: la interfaz no tiene color; solo fondo, emojis y acento opcional. [docs/DESIGN.md]
- 10 fondos integrados dibujados en código, o imagen propia. [docs/DESIGN.md, src/ui/background.tsx]
- Guardián de legibilidad: contraste AA en cada panel de vidrio. [docs/DESIGN.md]
- Idiomas: español (es-MX), inglés, francés. [src/i18n/index.ts]
- Sonido ambiente con apagado a 15/30/60 min o al terminar el pomodoro. [src/lib/noise.ts]
- Compartir estadísticas como imagen (Canvas 2D). [CLAUDE.md, src/share/]
- Versión teléfono bajo `(max-width: 600px)`; iPad y web sin cambios. [src/theme.ts, CLAUDE.md]
- Atajos de teclado y mando. [CLAUDE.md, src/lib/keys.ts]
- PWA instalable en pantalla de inicio de Safari. [README.md]
- Objetivos táctiles ≥ 44 px; respeta reducción de movimiento y transparencia. [docs/DESIGN.md, CLAUDE.md]

## NO decir (no existe)
- Cuentas, inicio de sesión, perfiles. [CLAUDE.md]
- Sincronización en la nube, backend, servidor. [README.md]
- App nativa de App Store: es una PWA. [README.md]
- Precios, planes, suscripción. [sin fuente en el repo]
- Calendario de iOS, notificaciones push, Background Sync, vibración. [README.md]
- Elegir carpeta con `showDirectoryPicker` en Safari. [README.md]

## Sin probar en dispositivos reales
- Safari, iPad, iPhone, Apple Pencil, teclado y mando reales. [CLAUDE.md, README.md]
- Anki real (escritorio, AnkiMobile, AnkiDroid). [docs/SPEC.md §5b, CLAUDE.md]
- Asistente con APIs reales y dictado real. [CLAUDE.md]
- Funciones de ramas aún no unidas a `main` (p. ej. `compartir-stickies-tareas`, `claude/exciting-cerf-u1rtor`). [CLAUDE.md]

## Claims verificables
- «Sin cuenta.» [CLAUDE.md]
- «Tus datos son archivos de texto que te pertenecen.» [README.md]
- «100 % sin conexión; el asistente solo si tú lo enciendes con tu clave.» [README.md, CLAUDE.md]
- «Sin telemetría ni peticiones de red al usarla.» [CLAUDE.md]
- «Repaso con FSRS, con 4 botones y el intervalo de cada uno.» [src/srs/engine.ts]
- «Importa tus mazos de Anki, incluido el historial si lo marcas.» [README.md]
- «Hasta 4 claves propias de IA, guardadas solo en tu navegador.» [src/chat/keys.ts, README.md]
