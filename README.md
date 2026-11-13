# Engrama

Tarjetas de estudio con repetición espaciada (FSRS) y notas, como app web instalable (PWA) para **Safari en iPad**. Sin servidores, sin cuentas, sin analítica, 100 % offline. Interfaz en español (es-MX) con el tema **Cristal**: neutro, de vidrio, sobre el fondo que tú eliges.

**Tus datos son archivos de texto que te pertenecen**: mazos y notas en Markdown, historial en JSONL, calendario en `.ics`. Si la app desaparece, los archivos siguen sirviendo.

## Qué hace
| Área | Resumen |
|---|---|
| **Estudio** | FSRS (`ts-fsrs`) con 4 botones y el intervalo previsto en cada uno, «¿Por qué esta fecha?» (D, S, R, últimas respuestas), pasos de aprendizaje, sanguijuelas, enterrar/suspender, deshacer (⌘Z), modo recuperación tras ausencias, editar durante el repaso, lectura en voz alta. |
| **Tarjetas** | Básica, inversa, escribir respuesta («casi correcto» sin acentos), cloze con pistas, lista (con y sin orden), opción múltiple, unir (arrastrar o tocar), ordenar, oclusión de imagen (dedo o Pencil). Editor visual, Markdown, CSV/TSV y `.apkg` de Anki con historial. |
| **Hoy** | Panel de mazos (Nuevas / Aprendiendo / Vencidas), pomodoro, Progreso de hoy, Pendientes, Hecho hoy, mapa de adherencia, exámenes con cuenta regresiva y ritmo. |
| **Estadísticas** | Retención real, precisión, eficiencia, nuevas aprendidas, pronóstico de 30 días, consistencia, distribuciones S/D, carga estimada según la retención, tarjetas en riesgo. |
| **Exámenes** | `exams/*.md` con temas, meta de retención y días de repaso final: ritmo (en ritmo / ajustado / atrasado), temas pendientes, retención proyectada, «Ajustar plan». |
| **Simulacros** | Importa Markdown, CSV, JSON y, con mejor esfuerzo, TXT, DOCX y PDF; vista previa obligatoria (nunca adivina la respuesta); modos simulacro / práctica / repaso de errores; tiempo con `endAt` (sobrevive a cerrar Safari); resultados por tema y «crear tarjetas de las falladas». |
| **Calendario** | Mes, semana y día con horas, agenda; clases, actividades, estudio y exámenes con repetición (diaria, semanal por días, mensual) y excepciones; arrastrar para mover o cambiar duración; capas de pronóstico, exámenes, simulacros y tiempo; plan semanal sugerido; `.ics` en hora local con alarmas. |
| **Notas** | Materia → Tema → Notas (estructura fija), editor por bloques con «/», enlaces `[[`, propiedades como formulario, plantillas, diarias, historial de versiones, papelera, buscador ⌘K, exportar `.md` / `.docx` / PDF, importar `.docx` y `.pdf`. Grafo y enlaces entrantes ocultos por defecto. |
| **Bandeja** | Todo entra aquí primero: archivos de Plaud (resumen, transcripción, SRT, audio; se agrupan por grabación), fotos, PDF y Word. Flujo de 4 pasos: asignar → limpiar (glosario, reemplazar en toda la clase) → tarjetas (copiar prompt → pegar → revisar una por una) → archivar. |
| **PDFs** | Biblioteca con miniaturas y progreso; resaltador inteligente con Apple Pencil (se ajusta a las líneas), subrayado, tachado, tinta y notas guardadas aparte; exportar PDF anotado o resumen `.md`. |
| **Espacios** | Paneles en mosaico (1–3) o lienzo infinito con paneo y zoom, conectados con sus secciones: nota (el mismo editor y documento), mazo, tema, simulacros, PDF, documento, hoja CSV, imagen, pomodoro, estadísticas y calendario. |

## Instalar en el iPad
1. Abre la URL de la app en **Safari** (debe ser `https://`; ver *Publicar*).
2. Toca **Compartir** → **Añadir a pantalla de inicio**.
3. Abre Engrama desde su ícono. Desde ese momento funciona sin conexión.

## Respaldar (importante)
Safari guarda tu bóveda en un espacio privado que **no se ve en Archivos**. Exporta regularmente:
**Respaldo → Preparar respaldo (.zip) → Guardar en Archivos**. Para restaurar: **Importar** → el `.zip` (vista previa y «deshacer importación»). La app te lo recuerda si pasan más de 7 días.

## Importar desde Anki
En Anki: **Archivo → Exportar → «Paquete de mazos de Anki (.apkg)»**, elige el mazo y marca **«Incluir programación»** si quieres traer tu historial de repasos. En Engrama: **Mazos → Importar archivo** → el `.apkg` → revisa el resumen (mazos · tarjetas · imágenes · repasos) → **Importar** → **Ver mazos**.

- Sirve **con y sin** «Compatibilidad con versiones antiguas»: se lee el formato nuevo (`collection.anki21b`, comprimido con zstd, esquema v18), el de compatibilidad (`collection.anki21`) y el antiguo (`collection.anki2`). El marcador «Please update to the latest Anki version…» que traen los paquetes nuevos nunca se importa.
- Si el archivo llega como `.zip` (pasa al descargarlo o compartirlo), también se reconoce por su contenido.
- Si un paquete no se puede leer, la hoja dice por qué y qué hacer (por ejemplo, volver a exportar marcando «Compatibilidad con versiones antiguas»).
- Límites: se convierten Básica, Inversa (y «ambos»), Cloze; las plantillas de tarjeta personalizadas, el CSS y los campos con LaTeX o JavaScript de Anki no se reproducen (se importa el texto de los campos). Las notas con el primer campo vacío se omiten y se cuentan.

## Formato de la bóveda
```
decks/<Carpeta>/<Mazo>.md     mazos (Q::/A::, Cloze:, MC::, … con ^id)
notes/<Materia>/<Tema>/*.md   notas de clase       notes/Diario/AAAA-MM-DD.md
exams/*.md                    exámenes reales      exams-bank/*.md   bancos de simulacro
calendar/estudio.ics          bloques de estudio   inbox/            bandeja
media/  docs/                 imágenes, audio, PDF, DOCX
.app/reviews.jsonl            historial (fuente de verdad de FSRS)
.app/state.json               caché reconstruible  .app/settings.json  ajustes
```
Ejemplos en `examples/` (bóveda, PDF, DOCX, exportaciones de Plaud, notas de Obsidian, bancos de simulacro).

## Desarrollo
```bash
npm install
npm run dev            # servidor local
npm test               # pruebas unitarias (Vitest)
npm run build          # typecheck + build en dist/
npm run e2e            # humo: bienvenida → estudio → offline → respaldo → reimportar
npm run e2e:flows      # simulacro, bandeja Plaud, notas, espacios con PDF, calendario .ics
npm run e2e:design     # "sin color" y legibilidad en 5 fondos × 2 modos
npm run e2e:mejoras    # acento, vínculos del calendario, notas grandes, bandeja, logo
npm run e2e:mejoras2   # idiomas (pseudoidioma sin desbordes), capas, minimizar, tooltips
npm run e2e:bloquec    # perfil, papelera de mazos, fondos, almacenamiento, buscador, mapa…
npm run e2e:p5         # sonido, tinta (Pencil simulado), PDFs, manuscritas, atajos y mando
npm run e2e:p6         # mover mazos/tarjetas/notas, Perfil, Bandeja como add-on, mini reproductor
npm run e2e:p7         # lienzo estático al alejar, PDF por página, firma
npm run e2e:p10        # .apkg de Anki: legado, compatibilidad, formato nuevo y archivos basura
npm run e2e:perf       # PDF de 800 páginas y lienzo de 30 paneles (antes: node scripts/perf-fixtures.mjs)
npm run e2e:p14        # asa de los paneles, notas enormes (buscar, imprimir, exportar, guardado idéntico) e imágenes grandes
npm run e2e:pdf        # exportar nota a PDF: papel claro en oscuro/claro y con cualquier fondo, solo la nota, pagina
npm run e2e:p15        # minimapa del lienzo: tocar, arrastrar, teclado, plegar
npm run e2e:phone      # iPhone: 6 tamaños × es/fr; MODE=baseline|compare para 0 píxeles en iPad y web
```
Las pruebas E2E usan WebKit de Playwright si está instalado (`npx playwright install webkit`); si no, Chromium.

## Tema y diseño
Ver `docs/DESIGN.md` (tokens, guardián de legibilidad, cómo añadir un tema cambiando solo los tokens) y la página `#/design`.

## Publicar (GitHub Pages)
`.github/workflows/ci.yml` corre pruebas y build en cada push y publica `dist/` en Pages al hacer push a `main`. Activa **Settings → Pages → Source: GitHub Actions**. Rutas relativas y ruteo por hash: funciona en una subcarpeta.

## Límites conocidos de Safari
- Sin `showDirectoryPicker`: la bóveda vive en el almacenamiento privado (OPFS); exportar es la única copia visible.
- Sin `beforeinstallprompt`, Background Sync, notificaciones push fiables ni vibración. Los recordatorios son dentro de la app y con las alarmas del `.ics`.
- `navigator.share` solo dentro de un toque: el respaldo se prepara y luego se entrega.
- Una web no puede leer ni escribir en el Calendario de iOS.
- Más detalle y lo que falta validar en un iPad real: `docs/DECISIONS.md`.

## Licencias de terceros
Preact, fflate, fzstd, ts-fsrs, markdown-it, minisearch, turndown, docx, sql.js, perfect-freehand, pdf-lib (MIT) · Lucide (ISC) · DOMPurify (MPL-2.0 / Apache-2.0) · pdfjs-dist (Apache-2.0) · mammoth (BSD-2). Sin SF Symbols ni recursos de Apple.
