# PROMPT: "Engrama", PWA de tarjetas de estudio + notas, para Safari en iPad

## 0. Rol y objetivo
Eres un ingeniero front-end senior y diseñador de producto. Construye **Engrama**, una app web instalable (PWA) que se usa en **Safari de iPadOS 26** (modo "Añadir a pantalla de inicio" y también en pestaña normal). Es un repetidor espaciado tipo Anki más un módulo de notas tipo Obsidian. Sin backend, sin cuentas, sin analítica, 100 % offline, interfaz en español (es-MX).

Principio rector: **los datos son archivos de texto que el usuario posee**. La app es solo un editor/lector de esos archivos. Si la app desaparece, los `.md` siguen siendo útiles.

Trabaja por fases (sección 14). Al terminar cada una, resume qué quedó, qué probaste y qué límites de Safari encontraste. No avances sin confirmar.

---

## 1. Realidades de Safari/iPadOS (diseña alrededor de esto)
| Capacidad | Estado en Safari iPad | Decisión |
|---|---|---|
| `showDirectoryPicker`, `showOpenFilePicker`, `showSaveFilePicker` | NO soportadas | No depender de ellas; usar solo si existen (feature detection) |
| OPFS (`navigator.storage.getDirectory()`) | Sí (desde Safari 15.2) | Bóveda de trabajo por defecto |
| Escritura en OPFS | `createSyncAccessHandle` solo en Worker; `createWritable` llegó con Safari 26 | Escribir desde un Worker con `createSyncAccessHandle`; usar `createWritable` si existe |
| `<input type="file" multiple>` y `webkitdirectory` | Sí | Importar archivos y carpetas (probar en dispositivo real) |
| Descargar con `<a download>` + Blob | Sí | Respaldo de exportación |
| `navigator.share({files})` / `canShare` | Sí, solo desde gesto del usuario | Exportar → "Guardar en Archivos" |
| `beforeinstallprompt` | NO existe | Mostrar guía manual: Compartir → Añadir a pantalla de inicio |
| Background Sync, File Handling API | NO | No usar |
| Web Speech `speechSynthesis` | Sí (requiere gesto previo) | Lectura en voz alta |
| Pointer Events con `pointerType:"pen"` y presión | Sí | Dibujo/oclusión con Apple Pencil |
| Almacenamiento puede ser expulsado | Riesgo real | `navigator.storage.persist()`, respaldos recordados, y verificar que las PWA instaladas están exentas del límite de 7 días de ITP |

Regla: toda funcionalidad se detecta (`'x' in window`), nunca se asume el navegador.

---

## 2. Stack
- TypeScript estricto, Vite, Preact (o vanilla con Web Components). Ruteo por hash para funcionar en subcarpeta (GitHub Pages): configurar `base` y el `scope` del service worker en consecuencia.
- Editor: CodeMirror 6 (funciona bien con teclado en pantalla, Scribble y teclado externo).
- Markdown: markdown-it + plugins propios (callouts, wikilinks, spans de color, cloze). KaTeX opcional y cargado bajo demanda.
- Repetición espaciada: `ts-fsrs` (FSRS).
- Zip: `fflate`. Búsqueda: `minisearch`. Grafo: `d3-force` sobre `<canvas>`. Documentos: `docx` (exportar .docx), `mammoth` + `turndown` (importar .docx), `pdfjs-dist` (importar .pdf), iconos Lucide. Cargar estas bibliotecas bajo demanda (import dinámico) y verificar sus licencias.
- Pruebas: Vitest (lógica) + Playwright con motor **WebKit** (aproximación de Safari en CI). Aun así, la validación final es en un iPad real.
- Cero dependencias que hagan peticiones de red en tiempo de ejecución. Todo se empaqueta.

---

## 3. Arquitectura de almacenamiento
Capa `VaultAdapter` con interfaz única: `list(path)`, `read(path)`, `write(path, data)`, `remove(path)`, `move(a,b)`, `exists(path)`, `stat(path)`.

Backends:
1. **OPFSBackend** (por defecto en Safari). Todo acceso en un **Worker dedicado**; la UI habla con él por mensajes.
2. **FSAccessBackend** (solo si existe `showDirectoryPicker`, p. ej. Chrome/Edge de escritorio): carpeta real elegida por el usuario.
3. **MemoryBackend** (pruebas).

Reglas de robustez:
- **Autoguardado** con debounce de 500 ms y guardado inmediato en `visibilitychange` (hidden) y `pagehide`. No usar `beforeunload` (no es fiable en iOS).
- **Escritura segura**: escribir primero a un archivo temporal o a un diario (`.app/journal.json`) y luego confirmar; al arrancar, recuperar o descartar transacciones incompletas.
- IndexedDB solo como **caché de índices** (búsqueda, backlinks, grafo), reconstruible desde los archivos. Nunca como fuente de verdad.
- `navigator.storage.persist()` al primer uso y mostrar el resultado en Ajustes junto con `storage.estimate()`.
- **Comprobación de integridad** al abrir: contar archivos, validar frontmatter y reportar archivos corruptos sin borrarlos.
- Recordatorio de respaldo: si pasan más de N días sin exportar, mostrar un aviso discreto. Opción de recordatorio semanal.

Estructura de la bóveda:
```
decks/<Mazo>.md
decks/<Carpeta>/<Submazo>.md
notes/**/*.md
media/**            (imágenes, audio)
templates/*.md
exams-bank/*.md     (bancos de preguntas de simulacro)
exams/*.md          (fechas de examen real y temas)
docs/**             (PDF, DOCX, hojas abiertos en paneles)
calendar/estudio.ics (eventos y bloques de estudio)
.app/exam-attempts.jsonl, .app/pomodoro.jsonl, .app/spaces/, .app/annotations/
.app/state.json     (estado FSRS por tarjeta, indexado por ID)
.app/reviews.jsonl  (un repaso por línea, solo se agrega)
.app/settings.json
.app/journal.json
```

---

## 4. Formato de archivos (legible y editable a mano)
Mazo = un `.md` con frontmatter:
```
---
deck: Cardiología
tags: [ecg, urgencias]
new_per_day: 15
---
Q:: ¿Qué derivaciones ven la pared inferior?
A:: [II, III y aVF]{.azul} ^c01a
Cloze: La {{c1::fibrilación auricular}} no tiene ondas P. ^c02b
IO: ![[ecg-bloqueo.png]] <!-- io: 10,20,30,12; 55,40,20,10 --> ^c03c
```
- Cada tarjeta termina con un **ID de bloque** `^xxxx` (generado por la app si falta).
- Tipos: básica (`Q::`/`A::`), cloze (`{{c1::texto::pista}}` con varios números), oclusión de imagen (rectángulos en porcentaje).
- **Reconciliación por ID**: si el usuario edita el archivo a mano, la app compara por ID y conserva historial y programación. Texto cambiado = misma tarjeta; ID nuevo = tarjeta nueva; ID que desaparece = tarjeta archivada (no borrada) durante 30 días.
- Markdown extendido: tablas, listas de tareas, `> [!note]` callouts, `[[wikilinks]]`, `![[embeds]]`, KaTeX, `==resaltado==` y color con `[texto]{.naranja}`. Colores: azul, verde, índigo, naranja, rosa, rojo, morado, turquesa, menta, amarillo.

- **Marcas del editor de notas** (Prompt 17; todas legibles en cualquier editor y retrocompatibles):
  - Subrayado `++texto++` (no se activa dentro de una palabra: `c++`, `i++`; ni en código).
  - Tamaño relativo con la misma sintaxis de clase que el color: `[texto]{.pequeno}`, `{.grande}`, `{.muygrande}`; se combinan con el color en una sola marca: `[texto]{.rojo .grande}`. Una clase fuera de la lista deja todo literal.
  - Alineación de un párrafo o título con una marca al final: `Texto {.centro}`, `## Título {.der}`, `{.justificado}` (izquierda = sin marca). En listas, tablas y código la marca queda literal.
  - Imágenes: `![[foto.jpg|300|izq|alt Texto]]` (Notas-Pro · A3).

---

## 4b. Tipos de tarjeta (además de básica y cloze)
Todos se escriben en el mismo `.md` del mazo, con ID de bloque, y también se pueden crear desde un editor visual (sin escribir sintaxis):
- **Inversa**: `QR:: pregunta` / `A:: respuesta` genera dos tarjetas (ida y vuelta).
- **Escribir respuesta**: `T:: pregunta` / `A:: respuesta`; compara sin distinguir mayúsculas ni acentos y permite "casi correcto".
- **Lista**: `L:: Capas de la piel` seguido de `- Epidermis`, `- Dermis`, `- Hipodermis`. Modo "recordar todos" (se revelan uno a uno o se escriben); `LO::` si el orden importa.
- **Opción múltiple**: `MC:: pregunta` seguido de `- [x] correcta` y `- [ ] distractor` (una o varias correctas; opciones en orden aleatorio).
- **Unir (arrastrar y unir)**: `MATCH:: título` seguido de pares `izquierda => derecha`. Se arrastra cada elemento a su pareja.
- **Ordenar**: `ORD:: título` con los elementos en el orden correcto; la app los muestra mezclados.
- **Imagen**: oclusión (ya descrita) y **etiquetar imagen** (arrastrar etiquetas a puntos de una imagen).
- Interacción táctil con **Pointer Events** (el arrastrar y soltar HTML5 es poco fiable en iOS), con alternativa de "tocar uno y luego su pareja" para accesibilidad y teclado.
- Calificación: para lista, unir y ordenar, FSRS recibe un resultado automático según los fallos (0 fallos = Bien, o Fácil si fue rápido; 1–2 = Difícil; más = Otra vez), que el usuario puede cambiar.
- **Importar mazos con vista previa visual**: Markdown nativo, CSV/TSV (columnas pregunta, respuesta, tipo, etiquetas, imagen) y, en fase posterior, .apkg. Antes de confirmar se muestran las tarjetas ya renderizadas, con los errores marcados.

---

## 5. Importar y exportar (el puente con la app Archivos)
Importar (botón + arrastrar y soltar):
- `.md` sueltos (mazos o notas), carpetas completas (`webkitdirectory`), `.zip` de bóveda, `.csv`/`.txt` (columnas pregunta,respuesta,etiquetas) con asistente de mapeo.
- Fase 5: `.apkg` de Anki con `sql.js` en un Worker (notas, cloze, medios, historial opcional).
- Vista previa antes de confirmar y detección de duplicados por ID/contenido, con opciones omitir, reemplazar o duplicar.

Exportar:
- Un mazo (`.md`), todo un mazo con medios (`.zip`), bóveda completa (`.zip`), `.csv`.
- Flujo: construir el Blob → si `navigator.canShare({files})` es verdadero, llamar `navigator.share` **dentro del gesto del toque** (si no, descarga con `<a download>`). En el iPad aparece la hoja "Guardar en Archivos".
- El `.zip` incluye un `manifest.json` con versión de formato, fecha y conteos, para validar al reimportar.

Nota honesta en Ajustes: *"Safari guarda tu bóveda en un espacio privado que no se ve en Archivos. Exporta regularmente para tener una copia visible."*

---

## 6. PWA y detalles de Safari
- `manifest.webmanifest`: `display: standalone`, `start_url`, `scope`, `theme_color`, `background_color`, íconos 192/512 y máscara.
- `<head>`: `apple-touch-icon` 180×180, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style: black-translucent`, `viewport` con `viewport-fit=cover`, `theme-color` para claro y oscuro.
- Service worker: caché del "app shell" con versión, estrategia cache-first con actualización en segundo plano y aviso "Nueva versión disponible → Actualizar". Sin dependencias remotas.
- Pantalla de bienvenida con instrucciones **manuales** para instalar (no existe `beforeinstallprompt`) y detección de `navigator.standalone` para ocultarlas una vez instalada.
- CSS crítico: `height: 100dvh`; `padding` con `env(safe-area-inset-*)`; `-webkit-backdrop-filter` junto a `backdrop-filter`; `overscroll-behavior: none` en el contenedor; `touch-action: manipulation` en botones; `-webkit-tap-highlight-color: transparent`; **inputs con `font-size: 16px` mínimo** para evitar el zoom automático; manejar el teclado en pantalla con `visualViewport`.
- Teclado externo: atajos con `metaKey` (⌘): ⌘O cambio rápido, ⌘P paleta de comandos, ⌘N nueva nota, ⌘Enter mostrar respuesta, 1–4 calificar, ⌘Z deshacer.
- Pencil: Pointer Events (`pen`, `pressure`), `touch-action: none` solo en lienzos de dibujo/oclusión; en campos de texto dejar que Scribble funcione de forma nativa.
- Audio y síntesis de voz: iniciar siempre tras un gesto del usuario.

---

## 7. Diseño (estilo Apple, hecho con cuadrados)

**Tipografía** (nada que descargar; Helvetica Neue ya viene en iPadOS):
```css
:root{
  --font: "Helvetica Neue", Helvetica, -apple-system, "SF Pro Text", Arial, sans-serif;
  --emoji: "Apple Color Emoji", "Noto Color Emoji";
}
body{ font-family: var(--font), var(--emoji); font-size:17px; line-height:1.4; }
```
Escala: título grande 34/Bold · título 1 28/Medium · título 2 22/Medium · título 3 20/Regular · cuerpo 17 · nota 13 · pie 12. Pesos 300/400/500/700. Tracking ligeramente negativo en títulos. Opción de "tamaño de texto" en Ajustes (equivalente a Dynamic Type) con `rem`.

**Emojis**: usar siempre emoji de texto del sistema; en iPad se ven como Apple. **No** incluir imágenes ni fuentes de emoji de Apple (no están licenciadas fuera de sus plataformas). Fuera de Apple cae a Noto Color Emoji. Selector de emojis con búsqueda (solo metadatos, sin imágenes).

**Color** (valores aproximados; Apple no publica hex garantizados). Claro: azul `#007AFF`, verde `#34C759`, índigo `#5856D6`, naranja `#FF9500`, rosa `#FF2D55`, rojo `#FF3B30`, morado `#AF52DE`, turquesa `#30B0C7`, menta `#00C7BE`, amarillo `#FFCC00`. Oscuro: `#0A84FF`, `#30D158`, `#5E5CE6`, `#FF9F0A`, `#FF375F`, `#FF453A`, `#BF5AE0`, `#40C8E0`, `#63E6E2`, `#FFD60A`. Fondos primario/secundario/agrupado como en Ajustes de iOS. Todo con variables CSS y `prefers-color-scheme`. Texto con contraste AA.

**Forma**: mosaicos cuadrados (`aspect-ratio: 1`), también 2×1 y 2×2, en una cuadrícula bento. Esquinas concéntricas: mosaico 28 px, elementos internos 20 px, chips 999 px. Sombras suaves, sin bordes duros. Números muy grandes, etiquetas pequeñas.

**Glassmorfismo / Liquid Glass**: se aplica a la capa de navegación (barra lateral, barra de pestañas, barras de herramientas, hojas modales) **y a los paneles y mosaicos del tablero "Hoy"**, incluido el cuadro de mazos, que flotan sobre el fondo elegido por el usuario:
```css
.glass{
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255,255,255,.28);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.35), 0 8px 30px rgba(0,0,0,.12);
}
@media (prefers-reduced-transparency: reduce){ .glass{ background: var(--bg); backdrop-filter:none; } }
```
Las superficies donde se **lee o escribe mucho** (tarjeta de estudio, editor de notas, tablas largas) van **opacas** para legibilidad. El cuadro de mazos usa vidrio con un velo de mayor opacidad (≈ 70 %) para que los números se lean siempre. Un control "Intensidad del vidrio" en Ajustes (0–100 %) ajusta desenfoque y transparencia. Respetar `prefers-reduced-motion` y `prefers-contrast`.

**Identidad Apple (casi idéntica, sin copiar activos protegidos)**
- Principios: claridad, deferencia al contenido y profundidad. Mucho espacio en blanco, jerarquía por tamaño y peso, nunca por bordes pesados.
- Patrones nativos de iPadOS: título grande que se colapsa al desplazar, listas agrupadas con inserción (como Ajustes), controles segmentados, interruptores estilo iOS, barra de búsqueda en píldora, hojas inferiores con "grabber" y detents, menús contextuales con pulsación larga, acciones al deslizar en filas, barra de pestañas flotante en cápsula, transiciones tipo resorte y de "morphing" entre vistas.
- Esquinas continuas (squircle): usar `border-radius` generoso y, donde sea posible, `corner-shape: squircle` con fallback.
- Iconos: set propio de trazo uniforme y esquinas redondeadas (p. ej. Lucide, licencia ISC) con peso acorde a Helvetica Neue. **No usar SF Symbols** (su licencia limita el uso a software para plataformas Apple; verificar) **ni el logotipo, nombre o marcas de Apple** en la interfaz ni en el nombre de la app.
- Colores del sistema, modo claro/oscuro automático, estados de foco y selección con el acento del usuario.
- Revisión final: comparar cada pantalla con Ajustes, Notas y Archivos de iPadOS para alinear espaciados (múltiplos de 4/8 px), tamaños y comportamiento.

**Layout iPad**: split view (barra lateral colapsable + contenido + inspector opcional), redimensionable para Stage Manager y Split View. Pestañas: Hoy · Mazos · Estudiar · Simulacros · Calendario · Notas · Espacios · Estadísticas · Add-ons · Ajustes.

**Interacción**: objetivos táctiles ≥ 44 px, animaciones de resorte cortas (150–300 ms), sin depender de hover, retroalimentación al presionar, gestos de deslizar al calificar, VoiceOver con etiquetas `aria-*` correctas.

**Pantalla Hoy**: cuadrícula bento con mosaicos de color vivo: vencidas, nuevas, racha, retención real, tiempo de hoy y el **mapa de adherencia** en mosaico grande, más una tarjeta por examen con cuenta regresiva y estado de ritmo (detalle en la sección 9b).

**Compartir estadísticas (Prompt 19 · 1)**: botón en el encabezado de Hoy (dentro del vidrio del encabezado; en teléfono, solo icono). Abre una hoja con vista previa, formato (Historia 1080×1920 con ~250 px libres arriba y abajo, Vertical 1080×1350 por defecto, Cuadrada 1080×1080), periodo (Hoy · 7 días · 30 días · Este año · Todo, con el corte de día y la zona horaria de Ajustes) y qué mostrar (nombre, foto/emoji, carrera/lema, horas, flashcards, racha, días, retención, mini mapa, marca), recordado en `settings.json` → `share`. La imagen se compone en el dispositivo con Canvas 2D: el fondo activo con su encuadre, desenfoque y atenuación; un panel de vidrio del tema activo con opacidad suficiente para ≥ 4.5:1; abajo, el logo sin recuadro teñido con el color de texto y «Engrama». «Compartir» abre la hoja del sistema con el PNG (preparar → entregar); sin soporte, descarga. Nada se sube a ningún servidor; no hay publicación directa en Instagram (no existe API web).

---

## 8. Estudio
- FSRS con botones Otra vez / Difícil / Bien / Fácil, retención objetivo 90 % (configurable), tarjetas nuevas por día, límites de repasos, enterrar, suspender, sanguijuelas, deshacer.
- "El día siguiente empieza a las 4:00" (configurable) y zona horaria del dispositivo (America/Monterrey por defecto).
- Pantalla limpia de una tarjeta por vez; cálculo de siguiente intervalo mostrado en cada botón.
- Cada repaso se agrega a `reviews.jsonl` con `{id, ts, rating, ms, due_before, state}`.

**Interpretación de respuestas (el corazón de la app; prioridad máxima)**
La app decide cuándo volver a mostrar cada tarjeta según la probabilidad de que el usuario ya la haya olvidado. Usar FSRS (`ts-fsrs`), que modela tres valores por tarjeta: **Dificultad (D)**, **Estabilidad (S**: días que tardan en bajar al 90 % las probabilidades de recordarla) y **Recuperabilidad (R**: probabilidad actual de recordarla).
- **Cuatro botones, no más** (el algoritmo está calibrado para cuatro). Etiquetas con significado: **Otra vez** (la olvidé; es el "muy difícil"), **Difícil** (la recordé con mucho esfuerzo), **Bien** (la recordé), **Fácil** (la recordé sin esfuerzo; es el "muy fácil"). Cada botón muestra el **intervalo siguiente previsto** (p. ej. "10 min · 3 d · 8 d · 19 d").
- Efecto de cada respuesta: **Otra vez** = olvido (lapso): la estabilidad cae mucho, la tarjeta pasa a reaprendizaje con pasos cortos (configurables, 10 min por defecto), sube la dificultad y suma un lapso. **Difícil** = el intervalo crece poco y sube la dificultad. **Bien** = intervalo normal. **Fácil** = intervalo mayor y baja la dificultad.
- La fecha depende de la **retención deseada** (90 % por defecto): la tarjeta vuelve cuando su R esperada cae a ese valor. En Ajustes mostrar una **estimación de carga** calculada con el historial ("a 85 % ≈ X repasos/día; a 90 % ≈ Y; a 95 % ≈ Z").
- **Repasar antes o después de la fecha** no rompe nada: se calcula con la R real del momento de repasar, no con la fecha planeada.
- Botón **"¿Por qué esta fecha?"** en cada tarjeta: muestra D, S, R actual, últimas 10 respuestas, lapsos y una frase ("Vuelve en 8 días porque tu estabilidad actual es de 8 días con 90 % de retención").
- **Aprendizaje de tarjetas nuevas**: pasos configurables (1 min, 10 min por defecto) y graduación a repaso.
- **Sanguijuelas**: tras N lapsos (8 por defecto) marcar la tarjeta y sugerir dividirla, añadir imagen o mnemotecnia, o suspenderla.
- **Tarjetas en riesgo**: lista de las que hoy tienen R baja o tendencia a fallar.
- **Atrasos y regreso tras una ausencia (modo recuperación)**: si hay más de N vencidas, ordenar por menor R primero, aplicar un tope diario y repartir el resto en los días siguientes mostrando "Te pondrás al día en 5 días". Nunca presentar una avalancha sin opciones.
- **Parámetros personalizados**: usar los de FSRS por defecto; tras ≥ 1 000 repasos ofrecer "optimizar parámetros" con el historial del usuario. Evaluar un optimizador WASM compatible con Safari (p. ej. `fsrs-rs-browser`; verificar). Si no es viable, permitir exportar el historial para optimizar en otra herramienta e importar los parámetros.
- Opcional (apagado por defecto): **sugerir** un botón según el tiempo de respuesta, resaltado pero nunca aplicado solo.
- Las tarjetas interactivas (lista, unir, ordenar, opciones) usan la calificación automática de la sección 4b.
- **Determinismo**: `reviews.jsonl` es la fuente de verdad y `state.json` es una caché; el estado de cada tarjeta debe poder **reconstruirse** reproduciendo el historial. Pruebas unitarias con secuencias de respuestas y comparación con resultados de referencia de `ts-fsrs`.

---

## 9. Add-ons integrados (sistema de módulos)
Cada módulo: `{id, nombre, versión, descripción, hooks}`. Hooks: `onCardShown`, `onAnswer`, `renderDashboardTile`, `registerCommand`, `registerView`. Pantalla "Add-ons" con interruptores y ajustes por módulo. Activados de fábrica:
1. **Mapa de adherencia** (estilo GitHub): 53×7 cuadritos redondeados, 5 niveles del color de acento, racha actual y máxima, % de días estudiados, filtro por mazo, tocar un día muestra sus repasos, leyenda "menos–más".
2. **Estadísticas FSRS**: retención real (true retention), pronóstico de 30 días, distribución de estabilidad/dificultad, historial por tarjeta.
3. **Oclusión de imagen**: máscaras con dedo o Pencil, modos ocultar-uno/ocultar-todos.
4. **Cloze** con pistas y varios números.
5. **Editar durante el repaso**.
6. **Navegador avanzado**: consultas `tag:ecg due:<3 is:leech deck:Cardio`, columnas ordenables, edición por lotes, vista previa.
7. **Lectura en voz alta** (Web Speech, idioma por mazo).
8. **Etiquetas de color** y jerarquía `padre/hijo`.
9. **Resumen del día** (vencidas, nuevas, tiempo, retención).

---

## 9b. Panel de progreso, examen y personalización (prioridad alta)
Referencia visual: un tablero tipo "Hoy" con mosaicos (racha, plan de estudio, barra de tiempo del semestre, tabla de mazos Nuevas/Aprendiendo/Vencidas, gráfica de consistencia, anillos de retención/eficiencia, mapa de calor, resumen "Estudiaste X tarjetas en Y minutos hoy"). Replica la idea con el diseño de la sección 7, no la apariencia exacta. Barra superior: Mazos · Añadir · Explorar · Estadísticas · Respaldo (en lugar de "Sync").

Todo se calcula desde `reviews.jsonl` y `state.json`; nada se guarda duplicado. Cada repaso registra `ms` (tiempo de respuesta), con tope de 60 s por tarjeta para ignorar pausas.

**A. Mapa de calor de días**
- Cuadritos redondeados, una columna por semana, 5 niveles del color de acento; selector de métrica (tarjetas o minutos), navegación por año (‹ ○ ›), etiquetas de meses, leyenda menos–más, tocar un día abre su detalle (tarjetas, minutos, mazos).
- Debajo: "Días estudiados: N (x %)", "Racha más larga", "Racha actual".

**B. Tiempo y tarjetas**
- Hoy, semana y total: tarjetas, tiempo (min/h), segundos por tarjeta, repasos totales. Frase resumen: "Estudiaste 177 tarjetas en 41 min hoy (14 s/tarjeta)".
- Gráfica de **consistencia**: tarjetas por día de los últimos 30 días (línea) con promedio móvil de 7 días.

**C. Racha**
- Un día cuenta si se repasan ≥ N tarjetas (N configurable, por defecto 1), usando el corte de día de las 4:00.
- Muestra racha actual, máxima y si hoy ya cuenta; aviso suave por la tarde si hoy aún no cuenta (sin notificaciones push; solo dentro de la app).

**D. Exámenes y ritmo**
- Botón "Añadir examen". Cada examen es un archivo `exams/<nombre>.md` con frontmatter: `fecha`, `temas` (lista de mazos, submazos o etiquetas), `meta_retencion` (90 % por defecto), `dias_repaso_final` (7 por defecto), `tarjetas_minimas_por_dia` (opcional).
- Cuenta regresiva: "Faltan 42 días" y barra de tiempo transcurrido desde que lo creaste.
- Cada **tema** muestra: tarjetas totales, nuevas restantes, cobertura (% ya vistas), dominio (% con retrievability FSRS ≥ meta) y estado. Un tema está **completo** cuando no tiene nuevas y su retrievability media ≥ meta.
- **Contador de temas**: "Te faltan 7 de 18 temas".
- **Ritmo**:
  - `necesario/día` = nuevas restantes ÷ (días hasta el examen − días de repaso final).
  - `real/día` = promedio de nuevas introducidas en los últimos 7 días (usa 14 si hay pocos datos).
  - Estado: **En ritmo** (real/necesario ≥ 1, verde), **Ajustado** (0.8–1, naranja), **Atrasado** (< 0.8, rojo). Con menos de 3 días de datos, mostrar "Aún calculando".
  - Mensaje accionable: "Necesitas 24 nuevas/día y llevas 15; te faltan 9/día" y "Al ritmo actual terminas el temario el 3 dic, 5 días después del examen".
  - **Retención proyectada** el día del examen (simulación FSRS) frente a la meta, y **carga futura** de repasos por día (alerta si supera, por ejemplo, 1.5 × tu promedio).
  - Botón "Ajustar plan": propone nuevas/día necesarias y las aplica al límite diario de los mazos del examen si el usuario acepta.
- Varios exámenes a la vez: tarjeta por examen en Hoy, ordenados por fecha.
- Pruebas unitarias del cálculo de ritmo con casos: sin datos, al día, atrasado, examen mañana, examen ya pasado.

**E. Eficiencia y retención** (explicar cómo se calculan en un "¿cómo se calcula?")
- **Retención** (anillo): repasos con Bien/Fácil sobre repasos de tarjetas maduras (intervalo ≥ 21 días), últimos 30 días.
- **Precisión** (barra): % de repasos Bien/Fácil sobre todos los repasos.
- **Eficiencia** (barra): segundos por tarjeta comparado con tu mediana de 30 días (más rápido que tu mediana = barra llena), junto con tarjetas por minuto.
- **Nuevas aprendidas** (anillo): % de las nuevas introducidas en 30 días que ya están en estado de repaso.

**F. Fondo personalizable**
- Ajustes → Apariencia → Fondo: colores sólidos, degradados y fondos de malla suaves en la paleta de la app, o **imagen propia** (selector de archivos/Fotos), redimensionada a máx. 2400 px y guardada en `media/.app/fondos/`.
- Controles: desenfoque, oscurecer/aclarar, y vista previa en vivo. Opción por sección o global.
- El fondo va detrás de la capa de vidrio; el contenido (tarjetas de estudio, notas) conserva fondo opaco para legibilidad. Calcular el contraste del texto sobre el fondo elegido y avisar si es bajo.
- Se guarda en `settings.json` y viaja en la exportación de la bóveda.

**F2. Colores personalizables por elemento**
- Ajustes → Apariencia → Colores. Cada elemento tiene su propio color y todos se pueden restablecer individualmente o en bloque:
  - Color de acento global (botones, enlaces, selección).
  - Cada **mosaico** del tablero (vencidas, nuevas, racha, retención, tiempo, examen).
  - Cada **mazo** y cada **etiqueta** (el color del mazo se guarda en su frontmatter como `color: naranja` o `color: "#FF9500"`, para que viaje con el archivo).
  - Escala del **mapa de calor** (un color base; los 5 niveles se derivan con `color-mix`).
  - Los 4 botones de calificación (Otra vez / Difícil / Bien / Fácil).
  - Estados de ritmo del examen (En ritmo / Ajustado / Atrasado) y el color de cada examen.
  - Color de resaltado y de los spans `[texto]{.color}` en Markdown.
- Selector: los 10 colores de la paleta de la app como círculos, más selector libre (`<input type="color">`) y campo hex.
- **Temas preestablecidos**: Vibrante (por defecto), Pastel, Monocromo, Alto contraste y Apto para daltonismo; se pueden usar como base y luego modificar elemento por elemento.
- Claro/oscuro: cada color tiene variante para ambos modos. Si el usuario elige un hex, derivar automáticamente la variante del otro modo (ajustando luminosidad) y mostrar ambas en la vista previa.
- Legibilidad: el color del texto sobre cada mosaico (blanco o negro) se elige automáticamente para cumplir contraste AA; si el color elegido no lo permite, avisar y sugerir el ajuste más cercano.
- El color nunca es el único indicador: los estados de ritmo llevan además icono y texto.
- Todo se guarda en `settings.json` con variables CSS (`--accent`, `--tile-*`, `--heat-*`, `--grade-*`) y viaja en la exportación de la bóveda. Vista previa en vivo sin recargar.

**G. Mazos y acciones**
- **Cuadro de mazos** como en las capturas: un panel grande de esquinas redondeadas (28 px) con **efecto vidrio** (desenfoque del fondo, borde interior translúcido, sombra suave), título "Mazos" y columnas Nuevas / Aprendiendo / Vencidas con números de color. Jerarquía expandible (＋/－), fila resaltada al tocar, engranaje por mazo (opciones, color, exportar, renombrar), punto de color del mazo a la izquierda. Filas de ≥ 44 px, separadores finos y deslizar para acciones rápidas (estudiar, suspender, exportar). Debe verse bien sobre cualquier fondo elegido.
- Pie de pantalla: "Obtener compartidos" (importar desde Archivos), "Crear mazo", "Importar archivo".

**H. Módulos opcionales (apagados por defecto)**
Nivel/XP, desafío diario ("repasa 30 tarjetas hoy") y "dato del día" con una lista que el usuario escribe en `notes/datos.md`.

---

## 9c. Simulacros (exámenes de práctica con tiempo)
No confundir con "Exámenes" de la sección 9b (fecha del examen real y ritmo de estudio). Los **Simulacros** son pruebas de opción múltiple con cronómetro. Pestaña propia: "Simulacros".

**Importar un archivo y convertirlo en examen**
- Formatos: **Markdown nativo** (el más fiable), **CSV/XLSX** (columnas: pregunta, a, b, c, d, e, correcta, explicación, tema), **JSON**, y en modo "mejor esfuerzo" **TXT, DOCX y PDF** (se extrae el texto y se aplica el mismo analizador).
- Formato nativo:
```
---
examen: Cardiología, parcial 1
minutos: 60
aleatorio: true
---
Caso:: Hombre de 58 años con dolor torácico opresivo de 40 minutos...
1. ¿Cuál es el diagnóstico más probable?
   A) Pericarditis aguda
   B) Infarto con elevación del ST
   C) Disección aórtica
   Respuesta: B
   Explicación: ...
   Tema: Cardiología/IAM
```
- Reglas del analizador: numeración `1.` o `1)`; opciones `A)`, `A.`, `a)`; la correcta se indica con `Respuesta: B` (o varias, `B, D`), con `*` al final de la opción o con una clave al final (`Clave: 1-B, 2-A`); `Caso::` aplica a las preguntas siguientes hasta el próximo caso; imágenes con `![[img.png]]`; `Tema:` y `Explicación:` opcionales.
- **Vista previa obligatoria**: "38 preguntas detectadas; 2 sin respuesta marcada; 1 con una sola opción". Las preguntas dudosas se muestran resaltadas en un editor de tabla para corregir; lo no resuelto queda como borrador y no entra al simulacro. Nunca adivinar la respuesta correcta.
- Los PDF/DOCX escaneados o con columnas complejas pueden fallar: avisar y sugerir pegar el texto o usar el formato nativo.

**Banco y armado**
- Los exámenes importados forman un **banco de preguntas** (`exams-bank/<nombre>.md`) con temas. "Crear simulacro": elegir bancos y temas, número de preguntas, minutos, solo falladas o solo no vistas, orden aleatorio de preguntas y opciones.

**Modos**
- **Simulacro**: cronómetro visible, sin retroalimentación hasta el final, navegador de preguntas en cuadritos (respondida, marcada, sin responder), marcar para revisar, terminar con confirmación y envío automático al acabar el tiempo.
- **Práctica**: retroalimentación y explicación inmediatas, sin tiempo.
- **Repaso de errores**: solo preguntas falladas o marcadas.
- Opciones de puntaje: sin penalización (por defecto) o con penalización configurable; umbral de aprobado.

**Robustez** (Safari puede cerrar la pestaña): guardar el intento tras cada respuesta; el tiempo restante se calcula con marcas de tiempo (`endAt`), no con un contador que corre en segundo plano; al reabrir ofrecer "Continuar simulacro". Atajos con teclado externo: A–E para responder, ←/→ para navegar, M para marcar.

**Resultados**
- Puntaje y porcentaje, tiempo total y por pregunta, desglose por tema (barras), comparación con intentos anteriores y revisión pregunta por pregunta con explicación.
- Botones: **"Crear tarjetas de las falladas"** (una tarjeta de opción múltiple o básica por pregunta, con la explicación) y **"Repetir solo las falladas"**.
- El tiempo del simulacro suma al tiempo de estudio, al mapa de calor y a la racha; el puntaje por tema alimenta el **dominio** de los temas del examen real (sección 9b).
- Intentos en `.app/exam-attempts.jsonl`.
- Pruebas unitarias del analizador con archivos de ejemplo bien y mal formados.

---

## 9d. Pomodoro (panel de enfoque)
- Ciclos configurables (25 min trabajo, 5 descanso, descanso largo de 15 tras 4 ciclos), anillo de progreso con el diseño de la sección 7, iniciar/pausar/saltar, etiqueta opcional de lo que se estudia (materia, mazo o examen).
- Disponible como **panel** (sección 10d), como **mosaico** del tablero Hoy y como **minicontrol** en la barra superior. Modo enfoque: oculta la barra lateral.
- **Safari suspende los temporizadores en segundo plano**: guardar `endAt` y recalcular al volver (`visibilitychange`); nunca depender de `setInterval` para llevar la cuenta. Usar la API **Screen Wake Lock** para mantener la pantalla encendida si está disponible (verificar en Safari 26). Sonido solo tras un gesto inicial del usuario; no depender de vibración (no existe en iOS Safari) ni de notificaciones push.
- Cada sesión se guarda en `.app/pomodoro.jsonl` y suma al tiempo de estudio, al mapa de calor y a las estadísticas (tiempo de enfoque por día y por materia).

---

## 9e. Calendario
Pestaña "Calendario" con vistas **Mes / Semana / Día / Agenda**. Capas que se activan o desactivan:
1. **Pronóstico de repasos**: tarjetas que vencerán cada día (por mazo), con barras o puntos de color; resaltar los días de carga alta.
2. **Exámenes reales** (sección 9b): fecha, cuenta regresiva y estado de ritmo.
3. **Simulacros** programados y realizados (con puntaje).
4. **Pomodoros y tiempo de estudio** por día; días con racha.
5. **Bloques de estudio**: eventos creados por el usuario (materia, tema, duración, nota), arrastrables para moverlos (Pointer Events), repetibles (diario/semanal) y marcables como hechos. "Iniciar bloque" abre el espacio correspondiente y el pomodoro.
6. **Tareas con fecha** y acceso a la **nota diaria** de cada día.
7. **Eventos importados** (p. ej. el horario de clases desde `.ics`).

- Panel de día: agenda, tarjetas vencidas y sugerencia de qué estudiar.
- **Plan semanal sugerido**: con la fecha del examen real y los temas pendientes, la app propone bloques repartidos hasta la fecha; el usuario los acepta o edita. No se crea nada sin confirmación.
- **Alerta de sobrecarga**: si un día proyectado supera 1.5 × el promedio, sugerir mover tarjetas nuevas a otros días.
- Datos en `calendar/estudio.ics` (iCalendar estándar). Importar `.ics` y exportar `.ics` (Compartir → Archivos o Calendario de Apple, con alarmas `VALARM` para recordatorios fuera de la app). Biblioteca: `ical.js` (verificar licencia).
- **Límites de Safari (no prometer lo imposible)**: una web no puede leer ni escribir en el Calendario de iOS ni enviar notificaciones push fiables. Los recordatorios son dentro de la app al abrirla y mediante las alarmas del `.ics`.
- Semana empieza en lunes (configurable), zona horaria del dispositivo, corte de día a las 4:00 para repasos.
- Diseño: vista de mes con cuadritos como el mapa de calor, panel de vidrio, color por materia.

---

## 10. Sección de notas (tipo Obsidian)
Explorador de archivos, editor Markdown con vista en vivo, wikilinks con autocompletado, **backlinks y menciones sin enlazar**, **vista de grafo** (filtros por carpeta/etiqueta, zoom táctil), **notas diarias** con calendario, **plantillas** (`{{fecha}}`, `{{titulo}}`, `{{hora}}`), **cambio rápido** (⌘O), **paleta de comandos** (⌘P), **esquema/outline**, **panel de etiquetas**, **marcadores**, búsqueda global, propiedades (frontmatter) editables, callouts. Mini-Dataview: bloque `query` que lista notas o tarjetas por etiqueta/fecha/mazo. Puente notas→tarjetas: seleccionar texto → "Crear cloze" / "Crear básica" → elegir mazo.

---

## 10b. Notas: más intuitivas que Obsidian, con PDF, .md y .docx
**Intuitividad** (el usuario no debería necesitar saber Markdown ni configurar plugins):
- **Editor en vivo tipo documento**: se escribe y se ve formateado al instante. Menú "/" para insertar bloques (título, lista, tabla, tarea, cita, callout, imagen, tarjeta de estudio), barra flotante al seleccionar texto (negrita, color, resaltado, enlace, "Crear tarjeta"). Interruptor "Ver Markdown" para quien lo prefiera.
- **Lo esencial ya viene activado y con nombres claros** (Enlaces, Etiquetas, Esquema, Diaria, Plantillas, Grafo), sin "plugins core/community" ni ajustes previos.
- **Un solo buscador ⌘K** que une cambio rápido, búsqueda y comandos.
- **Panel derecho unificado** con pestañas: Esquema · Enlaces entrantes · Propiedades · Grafo local.
- **Propiedades como formulario** (chips para etiquetas, selector de fecha, lista de mazos relacionados), no YAML a la vista.
- **Enlazar fácil**: escribir `[[` o seleccionar texto → "Enlazar a nota…" con opción de crear la nota allí mismo.
- **Arrastrar y soltar** para mover notas y carpetas; pulsación larga = menú contextual; deslizar = acciones.
- **Pegado inteligente**: pegar imagen la guarda en `media/`; pegar URL ofrece título; pegar desde Word/Pages limpia el formato a Markdown.
- **Historial de versiones** por nota (instantáneas automáticas) y papelera con restauración.
- **Plantillas con galería** visual: Clase, Resumen, Caso clínico, Repaso de examen, Cornell, Nota diaria.
- Vacíos útiles: cada pantalla vacía explica qué hacer con un botón; recorrido inicial de 4 pasos.

**Exportar notas** (una nota, varias, carpeta o toda la bóveda; desde el menú Compartir de la nota):
- **.md**: Markdown con frontmatter y medios (`.zip` si hay imágenes). Opción "Enlaces compatibles": convertir `[[wikilinks]]` a enlaces Markdown estándar. Los colores `[texto]{.rojo}` se conservan o se convierten a HTML según opción.
- **.docx**: generado en el navegador (biblioteca `docx`, MIT). Debe conservar títulos, listas, tablas, tareas, citas, callouts (como cuadro con borde), imágenes, enlaces, resaltado y colores de texto; ecuaciones como imagen o texto de respaldo.
- **.pdf**: dos estrategias, evalúa en iPad real y elige:
  1. Hoja de estilos de impresión (`@page`, márgenes, saltos de página, encabezados) + `window.print()`, que da el mejor texto seleccionable; guiar al usuario hacia "Guardar en Archivos" en la vista de impresión de Safari.
  2. Generación directa (jsPDF/pdf-lib) con vista previa como alternativa si la anterior resulta incómoda.
- Todas entregan el archivo con `navigator.share` → "Guardar en Archivos", con descarga como respaldo.

**Importar notas**:
- **.md** (frontmatter, wikilinks, callouts de Obsidian, etiquetas `#tag`) y **bóveda de Obsidian en .zip** (respetando carpetas y `media/`).
- **.docx**: `mammoth` → HTML → `turndown` → Markdown; imágenes extraídas a `media/`.
- **.pdf**: `pdfjs-dist` para extraer texto y estructura básica (títulos por tamaño de fuente); se guarda el PDF original como adjunto y la nota con el texto extraído. Sin OCR: los PDF escaneados se adjuntan sin texto, y se avisa.
- Al terminar: **informe de importación** ("12 notas importadas, 3 elementos no convertidos") con vista previa antes de confirmar y opción de deshacer toda la importación.
- Procesar en Workers; límites de tamaño; tratar todo archivo como no confiable y sanitizar el HTML resultante.

Pruebas: ida y vuelta .md→.docx→.md y .md→.pdf conservan títulos, listas, tablas e imágenes; archivos de ejemplo de Word, PDF y Obsidian en `examples/`.

---

## 10c. Orden sin revoltijo y flujo de clases (prioridad del usuario)
El usuario NO quiere el desorden de Obsidian (carpetas libres, enlaces por todos lados). Diseña las notas con **estructura fija y guiada**:

**Estructura**
- Jerarquía de 3 niveles, visible siempre: **Materia → Tema/Clase → Notas**. No hay carpetas libres ni anidación arbitraria.
- Cada nota pertenece a una clase; cada materia tiene su mazo (o submazos) vinculado. Etiquetas desde una **lista controlada** (se crean en Ajustes, no al vuelo).
- Grafo y backlinks existen pero **ocultos por defecto** (se activan en Ajustes). Una sola vista "Todo" con filtros por materia, estado y fecha.
- **Plantilla fija de nota de clase**: Fuente · Resumen · Puntos clave · Imágenes · Tarjetas · Pendientes. Se rellena sola al crear la nota.

**Bandeja de entrada**
- Todo lo que entra (archivos de Plaud, fotos, capturas, PDF, notas importadas) cae primero en la **Bandeja**, con contador de pendientes. Nada se archiva solo en una materia sin confirmación.
- Flujo "Procesar" en 4 pasos, un elemento a la vez: **1) Asignar** materia y tema (la app sugiere por nombre/fecha) → **2) Limpiar** (corregir términos, quitar relleno) → **3) Crear tarjetas** → **4) Archivar**.

**Plaud (por archivos, sin API)**
- Plaud permite exportar: audio (MP3, WAV), transcripción (TXT, SRT, DOCX, PDF), resumen (TXT, Markdown, DOCX, PDF) y mapa mental (PNG, Markdown). No tiene API pública para usuarios; los plugins no oficiales usan ingeniería inversa y pueden romperse. **No depender de ninguna API de Plaud.**
- El importador acepta esos archivos (soltarlos en la Bandeja o desde el selector de archivos), detecta si es resumen, transcripción o mapa mental, y crea **una nota de clase** con el resumen arriba y la transcripción **plegada** debajo; el audio queda como adjunto opcional. Si llegan varios archivos de la misma grabación, los agrupa por nombre/fecha.
- Las transcripciones tienen errores con términos técnicos: incluir un **glosario personal** (lista de términos correctos) y "Buscar y reemplazar en toda la clase".

**Fotos y capturas**
- Añadir desde la cámara/Fotos (`<input type="file" accept="image/*">`), pegar del portapapeles (evento `paste`) y arrastrar desde otra app en Split View (probar en iPad real). Se guardan en `media/` (redimensionadas a máx. 2000 px; original opcional) y se insertan en la nota o en el frente/reverso de una tarjeta. Recorte y anotaciones básicas con Pencil. Oclusión de imagen sobre ellas. OCR queda fuera del inicio (evaluar Tesseract.js más adelante).

**Tarjetas desde notas (sin agentes, sin backend)**
- **Modo A, manual**: seleccionar texto → cloze o básica.
- **Modo B, "Copiar prompt"** (principal): la app arma un prompt (instrucciones + formato `Q::`/`A::`/cloze + el texto de la nota) y lo copia para pegarlo en la herramienta de IA que el usuario ya use. Luego "Pegar respuesta": la app valida el formato y muestra una **vista previa con aceptar / editar / descartar** por tarjeta. Solo lo aceptado se agrega.
- **Modo C, API directa** (opcional, apagado por defecto): clave del usuario guardada localmente, con aviso de riesgos. No es prioridad.
- Reglas: **nunca** agregar tarjetas generadas sin revisión humana (contenido médico: puede haber errores); marcar `origen: ia` en cada tarjeta; mostrar junto a la tarjeta el párrafo de origen (`src:` apunta a la nota y al bloque) para poder verificarla; la nota muestra cuántas tarjetas tiene y qué párrafos aún no están cubiertos.

**Importar notas existentes**: asistente que propone materia y tema para cada nota y envía a la Bandeja las dudosas.

---

## 10d. Espacios, paneles y lienzo infinito (con visores de PDF, DOCX y hojas)
**Principio**: construir en dos niveles, primero el barato y útil, después el vistoso.
- **Nivel 1: Espacios con paneles en mosaico.** 1, 2 o 3 paneles con divisores arrastrables, y espacios guardados por materia o examen en `.app/spaces/<nombre>.json`. Preajustes: "PDF + tarjetas", "Clase: notas + PDF", "Repaso". En iPad ya existen Split View y Stage Manager; esto debe aportar lo que ellos no: que el PDF, las tarjetas y las notas compartan datos (crear una tarjeta desde el PDF, por ejemplo).
- **Nivel 2: Lienzo infinito.** Los mismos paneles como ventanas libres sobre un plano con paneo y zoom con dos dedos, minimapa y "ajustar al contenido". Máximo de **4 paneles activos**; los demás se "duermen" (se muestra una captura) para cuidar la memoria. Implementar con transformaciones CSS sobre contenedores del DOM, no con un `<canvas>` global. En el lienzo, desactivar el zoom de página de Safari (`touch-action` y gestos solo en esa zona).

**Tipos de panel**: Estudio, Simulacro, Nota, **PDF**, **Documento (.docx)**, **Hoja (.xlsx/.csv)**, Imagen, Pomodoro, Estadísticas.

**PDF** (`pdfjs-dist`, Apache-2.0)
- Renderizar por página bajo demanda y liberar las páginas fuera de pantalla; escala con `devicePixelRatio` ≤ 2 y respetar el límite de tamaño de canvas de Safari (alrededor de 16 megapíxeles; verificar). Avisar con PDF de más de ~50 MB.
- Capa de texto seleccionable, búsqueda, miniaturas, resaltado y dibujo con Pencil guardados **aparte** (`.app/annotations/<archivo>.json`), sin modificar el PDF original; exportar PDF anotado más adelante (`pdf-lib`).
- Seleccionar texto → "Crear tarjeta" o "Insertar cita en nota", guardando el origen (`src: archivo.pdf#p12`) para volver a la página.
- Probar con un PDF de 200 páginas en un iPad real antes de dar por buena la fase.

**Documento (.docx)**: solo lectura, con `mammoth` → HTML sanitizado. **Hoja de cálculo (.xlsx/.csv)**: solo lectura con una biblioteca de lectura de hojas (p. ej. SheetJS Community, verificar licencia), pestañas por hoja, filas virtualizadas, límite de ~50 000 filas con aviso, fórmulas mostradas como el último valor calculado. **Editar DOCX o XLSX está fuera de alcance**: para eso se exporta y se abre en otra app. Las tablas sencillas se hacen dentro de las notas.

Los archivos abiertos se guardan en `docs/` de la bóveda (almacenamiento privado de Safari; mostrar el espacio usado con `navigator.storage.estimate()`).

---

## 11. Rendimiento
Listas virtualizadas, trabajo pesado (FSRS por lotes, índice de búsqueda, parseo) en Workers, carga diferida del grafo y de KaTeX, imágenes redimensionadas al importar (máx. 2000 px) y miniaturas en caché. Objetivo: abrir en < 1.5 s con 5 000 tarjetas en un iPad reciente.

## 12. Privacidad y seguridad
Sin red en tiempo de ejecución, sin telemetría. Sanitizar el HTML renderizado (DOMPurify o lista blanca propia) porque los archivos pueden venir de terceros. Los `.apkg` y zips importados se tratan como datos no confiables (límites de tamaño y de profundidad).

## 13. Pruebas
- Unitarias: parser de tarjetas, reconciliador por ID, escritor/diario, FSRS, consultas del navegador.
- Playwright WebKit: flujos de importar → estudiar → exportar → reimportar.
- Lista de verificación manual en iPad real: instalar en pantalla de inicio, modo avión, cerrar y reabrir 24 h después, rotación, Stage Manager, teclado externo, Pencil, `navigator.share` hacia Archivos.

## 14. Fases y criterios de aceptación
1. **Base**: PWA instalable, VaultAdapter (OPFS en Worker), importar/exportar `.md`/`.zip`, sistema de diseño y pantalla Hoy. *Criterio*: funciona offline y los datos sobreviven al cerrar Safari.
2. **Mazos y estudio**: parser, editor, FSRS con toda la sección "Interpretación de respuestas" (botones con intervalo previsto, "¿Por qué esta fecha?", sanguijuelas, modo recuperación), registro de repasos, reconciliación por ID. *Criterio*: reconstruir el estado desde `reviews.jsonl` da exactamente el mismo estado que `state.json`.
3. **Progreso y examen**: todo lo de la sección 9b (mapa de calor, tiempo y tarjetas, racha, exámenes con ritmo y temas pendientes, eficiencia y retención, fondo personalizable) más estadísticas FSRS. *Criterio*: con un `reviews.jsonl` de prueba de 90 días, los números coinciden con los calculados a mano y el estado de ritmo cambia correctamente al variar la fecha del examen.
4. **Notas**: enlaces, backlinks, grafo, diarias, plantillas, buscador ⌘K y todo lo de la sección 10b (editor en vivo, exportar/importar .md, .docx y .pdf, historial de versiones). La estructura Materia → Tema → Notas de la sección 10c rige desde esta fase; grafo y backlinks ocultos por defecto.
5. **Avanzado**: oclusión de imagen, navegador avanzado, voz, importar `.apkg`.
6. **Flujo de clases** (sección 10c): estructura Materia → Tema → Notas, Bandeja de entrada, importador de archivos de Plaud, fotos y capturas, tarjetas desde notas con "Copiar prompt" y revisión. *Criterio*: un resumen y una transcripción exportados de Plaud llegan a la Bandeja, se procesan en menos de 2 minutos hasta quedar archivados con tarjetas revisadas, y la nota muestra su cobertura. (Si el usuario prioriza este flujo, puede hacerse antes del grafo y backlinks de la fase 4.)
7. **Simulacros y tarjetas avanzadas** (secciones 4b y 9c): tarjetas de lista, opciones, unir y ordenar; banco de preguntas, importador con vista previa, modo simulacro con tiempo, resultados y "crear tarjetas de las falladas". *Criterio*: un archivo de 40 preguntas en el formato nativo y uno en .docx de prueba se importan, se corrigen en la vista previa y se completan como simulacro; cerrar Safari a mitad del examen y reabrir conserva las respuestas y el tiempo restante correcto.
8. **Pomodoro** (sección 9d). *Criterio*: el temporizador mantiene el tiempo correcto tras bloquear la pantalla y volver, y las sesiones suman al tiempo de estudio y al mapa de calor.
9. **Espacios** (sección 10d, nivel 1): paneles en mosaico con visores de PDF, documento y hoja. *Criterio*: un PDF de 200 páginas se abre junto a las tarjetas sin que Safari se cierre, y crear una tarjeta desde texto seleccionado guarda la página de origen.
10. **Lienzo infinito** (sección 10d, nivel 2). *Criterio*: paneo y zoom fluidos (≥ 50 fps) con 4 paneles activos en iPad.

11. **Calendario** (sección 9e). *Criterio*: el pronóstico de repasos de los próximos 30 días coincide con la simulación de FSRS; un bloque de estudio exportado a `.ics` se abre correctamente en el Calendario de Apple.

**Orden de ejecución sugerido**: 1, 2, 3, 7, 8, 11, 6, 9, 4, 10, 5. Cada fase se prueba en un iPad real antes de la siguiente.

Criterios globales: exportar la bóveda a `.zip` y reimportarla produce mazos, notas y estadísticas idénticas; editar un mazo a mano y reimportarlo no borra historial; sin errores en consola; contraste AA; README con límites conocidos de Safari y del almacenamiento privado.

## 14b. Skills por fase y memoria del proyecto
**Reglas**: usar pocas skills a la vez (5–6 como máximo); cargar solo las de la fase en curso; leer el `SKILL.md` de cada una antes de instalarla; no instalar colecciones completas; revisar licencia y procedencia (los nombres pueden engañar). Instalación típica: `npx skills add <repositorio> --skill <nombre>` (confirmar el comando exacto en cada repositorio). Usar **una sola** skill como guía principal de diseño; no mezclar varias que se contradigan.

| Fases | Skills |
|---|---|
| 1–2 (base, mazos, estudio, FSRS) | superpowers (planear primero, pruebas primero), Context7 (documentación actualizada de `ts-fsrs`, `pdfjs-dist`, `docx`, `mammoth`), webapp-testing (Playwright con motor **WebKit**), security-review (importación de archivos), **ponytail** (código mínimo; ver regla abajo) |
| 3 (progreso, tablero, diseño) | ponytail, superpowers y webapp-testing siguen activas; añadir frontend-design como guía principal y, de `emilkowalski/skills`, apple-design y mobile-native. Sumar gestures y animation-performance solo cuando el trabajo lo pida (para no pasar de 6 activas). Al cerrar la fase, **una** auditoría: Impeccable `audit` o Vercel Web Design Guidelines |
| 7–8 (simulacros, pomodoro) | gestures (arrastrar y unir), break-ui (datos extremos: nombres largos, listas vacías, exámenes enormes), webapp-testing |
| 4 y 6 (notas, flujo de clases) | frontend-design, mobile-native, security-review para los importadores de .docx, .pdf y .zip |
| 9–10 (espacios, lienzo) | gestures, animation-performance, choreograph; probar con un PDF grande |
| Opcional | skills de documentos de Anthropic (docx, pdf) solo para crear archivos de ejemplo |

**Regla para ponytail (código mínimo)**: este documento (`docs/SPEC.md`) manda sobre *qué* se construye; ponytail decide *cómo* hacerlo con el menor código. Preferir lo que ya ofrece la plataforma o una biblioteca de la lista de stack (`ts-fsrs`, `fflate`, `markdown-it`, etc.) antes que escribir algo propio, y no añadir dependencias nuevas sin justificarlo. **Nunca recortar**: la escritura segura y el diario de recuperación, la comprobación de integridad, el determinismo de FSRS (reconstruir estado desde `reviews.jsonl`), la sanitización de HTML y de archivos importados, ni la accesibilidad. Ante duda sobre si algo "sobra", preguntar antes de eliminarlo.

**No usar**: ECC, agentmemory, OpenViking, skills de ciberseguridad ni scientific-agent-skills para construir la app (MarkItDown/LiteParse pueden usarse fuera de la app para convertir PDF escaneados a texto).

**Memoria del proyecto (en lugar de herramientas de memoria externas)**
- Guardar este documento como `docs/SPEC.md`.
- Crear un `CLAUDE.md` corto (máx. ~60 líneas) con: nombre y objetivo de Engrama, stack, reglas no negociables (archivos del usuario como fuente de verdad, sin red en ejecución, sin SF Symbols ni marcas de Apple, tarjetas generadas por IA siempre revisadas), comandos de prueba, **fase actual** y **skills activas**.
- Al terminar cada fase: actualizar `CLAUDE.md` y añadir a `docs/DECISIONS.md` lo decidido y los límites de Safari encontrados.

---

## 15. Entregables
Código fuente, README (instalación en iPad paso a paso, cómo respaldar), carpeta `examples/` con una bóveda de ejemplo, y una lista de pendientes/límites encontrados en Safari.
