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
| **Calendario** | Mes, semana, día y agenda; capas de pronóstico, exámenes, simulacros, tiempo, bloques arrastrables, tareas con fecha e importados; plan semanal sugerido; `.ics` con alarmas. |
| **Notas** | Materia → Tema → Notas (estructura fija), editor por bloques con «/», enlaces `[[`, propiedades como formulario, plantillas, diarias, historial de versiones, papelera, buscador ⌘K, exportar `.md` / `.docx` / PDF, importar `.docx` y `.pdf`. Grafo y enlaces entrantes ocultos por defecto. |
| **Bandeja** | Todo entra aquí primero: archivos de Plaud (resumen, transcripción, SRT, audio; se agrupan por grabación), fotos, PDF y Word. Flujo de 4 pasos: asignar → limpiar (glosario, reemplazar en toda la clase) → tarjetas (copiar prompt → pegar → revisar una por una) → archivar. |
| **Espacios** | Paneles en mosaico (1–3) o lienzo infinito con paneo y zoom: PDF (capa de texto, búsqueda, resaltado y tinta con Pencil guardados aparte), documento, hoja CSV, imagen, nota, estudio, pomodoro. Crear tarjeta o cita desde el PDF guarda la página de origen. |

## Instalar en el iPad
1. Abre la URL de la app en **Safari** (debe ser `https://`; ver *Publicar*).
2. Toca **Compartir** → **Añadir a pantalla de inicio**.
3. Abre Engrama desde su ícono. Desde ese momento funciona sin conexión.

## Respaldar (importante)
Safari guarda tu bóveda en un espacio privado que **no se ve en Archivos**. Exporta regularmente:
**Respaldo → Preparar respaldo (.zip) → Guardar en Archivos**. Para restaurar: **Importar** → el `.zip` (vista previa y «deshacer importación»). La app te lo recuerda si pasan más de 7 días.

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
npm test               # 103 pruebas unitarias (Vitest)
npm run build          # typecheck + build en dist/
npm run e2e            # humo: bienvenida → estudio → offline → respaldo → reimportar
npm run e2e:flows      # simulacro, bandeja Plaud, notas, espacios con PDF, calendario .ics
npm run e2e:design     # "sin color" y legibilidad en 5 fondos × 2 modos
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
Preact, fflate, ts-fsrs, markdown-it, minisearch, turndown, docx, sql.js (MIT) · Lucide (ISC) · DOMPurify (MPL-2.0 / Apache-2.0) · pdfjs-dist (Apache-2.0) · mammoth (BSD-2). Sin SF Symbols ni recursos de Apple.
