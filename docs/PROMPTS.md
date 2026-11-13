
ESTOS SON TODOS LOS PROMPTS QUE SE HAN UTILIZADO, USALOS COMO CONTEXTO PARA ENTENDER LA CONSTRUCCION DE LA APP Y REFUERZALO LEYENDO EL REPOSITORIO DE GITHUB.

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

# PROMPT 2: Tema visual "Cristal" para Engrama
Interfaz seria y neutra (sin colores) sobre fondos personalizables, para Safari en iPad

## 0. Contexto y alcance
Engrama es una PWA de estudio (tarjetas con repetición espaciada, simulacros, notas, calendario, pomodoro, paneles) que se usa en **Safari de iPadOS 26**. Este prompt define **solo la capa visual**: un sistema de diseño y un tema llamado **"Cristal"**. Se aplica sobre la estructura funcional que ya existe en `docs/SPEC.md` y **sustituye** su sección de diseño (paleta vibrante y colores por elemento) por lo descrito aquí. Implementa el diseño con **tokens CSS** para que el tema se pueda cambiar: "Cristal" es el tema por defecto y el tema "Vibrante" de la especificación original queda como alternativa futura.

Las 3 capturas adjuntas son la **referencia visual**: (1) un entorno de paneles con ventanas de vidrio oscuro sobre un fondo de ilustración, con riel lateral y dock inferior; (2) una pantalla de mazos oscura con tarjetas de estadísticas y un pomodoro; (3) la misma pantalla en versión clara sobre un fondo de colores intensos. **Reproduce la composición, el efecto de vidrio y el comportamiento. No copies las ilustraciones de fondo, los textos, los nombres ni las marcas de las capturas.**

## 1. Idea central
**La interfaz no tiene color. El color lo ponen únicamente el fondo que elige el usuario y los emojis.**
- Toda la interfaz (texto, bordes, botones, gráficas, estados) es neutra: blanco, negro y grises, con transparencias.
- La jerarquía se logra con tamaño, peso tipográfico, opacidad, relleno vs. contorno, iconos y posición; nunca con tono.
- Los paneles son de vidrio esmerilado sobre un fondo personalizable. Aspecto sobrio, tranquilo y profesional.
- Los nombres de mazo pueden llevar emoji (nativos del sistema; en iPad se ven como Apple), que son el único detalle de color dentro de la interfaz.

## 2. Qué tomar de cada captura
**Captura 1 (paneles):** ventanas de vidrio oscuro con barra de título (nombre, chip de estado, controles de bloquear, minimizar, expandir y cerrar); **riel vertical de "Espacios"** a la izquierda con miniaturas cuadradas; **barra superior** flotante con cronómetro de enfoque y buscador; **dock inferior** con "＋ Añadir panel" e iconos por tipo de panel; pastillas de "Extras" y "Bandeja".
**Captura 2 (oscura):** navegación superior en **píldora segmentada** (Mazos · Añadir · Explorar · Estadísticas · Respaldo); **panel de mazos** de vidrio con columnas Nuevas / Aprendiendo / Vencidas y jerarquía ＋/－; **tres tarjetas de estadísticas** debajo; **pomodoro** arriba a la derecha (25:00 con botones redondos); **tres botones en píldora** al pie (Importar compartidos, Crear mazo, Importar archivo).
**Captura 3 (clara):** la misma composición en vidrio claro; fila seleccionada como **píldora blanca**; fondo muy desenfocado detrás del panel. Aviso importante: en esta captura la columna "Vencidas" casi no se lee sobre el fondo rosa. **Ese es el problema que el guardián de legibilidad (sección 6) debe impedir.**

## 3. Tokens de diseño
```css
:root{
  --font:"Helvetica Neue",Helvetica,-apple-system,"SF Pro Text",Arial,sans-serif;
  --emoji:"Apple Color Emoji","Noto Color Emoji";
  --r-panel:28px; --r-inner:20px; --r-row:14px; --r-pill:999px;
  --hair:.5px; --blur:28px; --sat:160%;
  --ease:cubic-bezier(.2,.8,.2,1);
}
/* Oscuro */
[data-glass="dark"]{
  --glass:rgba(24,24,27,.58);        /* panel */
  --glass-strong:rgba(20,20,22,.78); /* lectura */
  --border:rgba(255,255,255,.16);
  --hilite:inset 0 1px 0 rgba(255,255,255,.14);
  --t1:rgba(255,255,255,.94); --t2:rgba(255,255,255,.64); --t3:rgba(255,255,255,.38);
  --fill:rgba(255,255,255,.12); --fill-sel:rgba(255,255,255,.18);
  --line:rgba(255,255,255,.09); --shadow:0 12px 40px rgba(0,0,0,.35);
  --inverse-bg:#fff; --inverse-fg:#111;
}
/* Claro */
[data-glass="light"]{
  --glass:rgba(255,255,255,.52);
  --glass-strong:rgba(255,255,255,.80);
  --border:rgba(255,255,255,.65);
  --hilite:inset 0 1px 0 rgba(255,255,255,.7);
  --t1:rgba(0,0,0,.90); --t2:rgba(0,0,0,.60); --t3:rgba(0,0,0,.36);
  --fill:rgba(0,0,0,.06); --fill-sel:rgba(255,255,255,.85);
  --line:rgba(0,0,0,.08); --shadow:0 12px 40px rgba(0,0,0,.12);
  --inverse-bg:#111; --inverse-fg:#fff;
}
.glass{
  background:var(--glass);
  -webkit-backdrop-filter:blur(var(--blur)) saturate(var(--sat));
  backdrop-filter:blur(var(--blur)) saturate(var(--sat));
  border:var(--hair) solid var(--border);
  box-shadow:var(--hilite),var(--shadow);
  border-radius:var(--r-panel); color:var(--t1);
}
```
Modo **Auto** (sigue al sistema con `prefers-color-scheme`) además de Oscuro y Claro fijos. Cifras siempre con `font-variant-numeric: tabular-nums`. Esquinas continuas (`corner-shape: squircle` con alternativa). Espaciados en múltiplos de 4/8 px.

## 4. Reglas de "sin color"
- Ningún texto, borde, fondo, icono ni gráfica de la interfaz usa tono: solo grises, blanco y negro con transparencia. El único acento es el **invertido** (relleno blanco con texto oscuro en vidrio oscuro, y al revés en claro).
- **Estados sin color**: valor cero al 38 % de opacidad; valor distinto de cero al 100 %; "Vencidas" > 0 en negrita; elemento seleccionado = píldora de relleno más claro; elemento activo = relleno invertido; deshabilitado = 38 % de opacidad; error = icono + texto en negrita + borde más grueso (no rojo); éxito = icono de verificación.
- **Botones de calificación** (Otra vez / Difícil / Bien / Fácil): mismo tamaño, cada uno con su icono y su intervalo previsto debajo; **Bien** va con relleno invertido y los otros en contorno. Sin verdes, rojos ni naranjas.
- **Mapa de calor**: 5 niveles de blanco (oscuro) o negro (claro) con alfa .08 / .2 / .35 / .55 / .85.
- **Gráficas**: líneas y barras en blanco/negro con distintos grosores, trazos (continuo, punteado) y rellenos de trama; leyenda con forma, no con color.
- **Estado de ritmo del examen** (en ritmo / ajustado / atrasado): icono distinto (✓, ◐, ⚠) + texto + barra con relleno completo, parcial o contorno.
- **Iconos**: set propio de trazo uniforme (p. ej. Lucide, ISC), 1.5 px, monocromos. Sin SF Symbols ni logotipos de Apple.
- Excepción **opcional y apagada por defecto**: "Color semántico para errores y acciones destructivas". Si se activa, afecta solo a eso.
- El usuario no elige colores de interfaz: personaliza el **fondo** y, si quiere, el emoji de cada mazo.

## 5. Fondos personalizables
- **Fuentes**: imagen propia (Fotos o Archivos con `<input type="file" accept="image/*">`; iOS suele convertir HEIC a JPEG al seleccionar, verificar), **fondos integrados originales** (degradados de malla suaves, ruido, patrones geométricos, generados en código; no incluir ilustraciones de terceros) y color sólido.
- Se redimensionan a un máximo de 2400 px, se guardan en `media/.app/fondos/` (almacenamiento privado de Safari) con miniatura de 256 px y se incluyen en la exportación de la bóveda.
- **Galería "Fondos"**: cuadrícula de miniaturas cuadradas, botón "＋ Añadir imagen", vista previa en vivo antes de aplicar.
- **Controles**: desenfoque del fondo (0–40 px), oscurecer/aclarar (−50 % a +50 %), intensidad del vidrio (0–100 %: ajusta transparencia y desenfoque de los paneles), y modo de vidrio (Auto / Oscuro / Claro).
- **Fondo por espacio o materia** (opcional): cada espacio puede tener el suyo; si no, usa el global. El **modo enfoque** oscurece y desenfoca el fondo automáticamente.
- Sin vídeo ni fondos animados en esta versión.
- Cambiar de fondo debe ser instantáneo, sin recargar.

## 6. Guardián de legibilidad (obligatorio)
Un fondo vistoso nunca debe volver ilegible un panel.
- Al aplicar un fondo, reducirlo a una muestra de 64×64 px en un `<canvas>` y calcular la **luminancia media detrás de cada panel** (por su posición y tamaño).
- Calcular el contraste estimado entre el texto (`--t1` y `--t2`) y el fondo compuesto (fondo + velo de vidrio). Si es **< 4.5:1** para texto normal, el guardián lo corrige automáticamente en este orden: (1) subir la opacidad del velo del panel, (2) cambiar el modo de vidrio de ese panel a claro u oscuro, (3) oscurecer o aclarar el fondo. Mostrar un aviso discreto: "Ajustamos el vidrio para que se lea mejor".
- Recalcular al cambiar el fondo, el tamaño de panel o el modo.
- Las **superficies de lectura larga** (tarjeta de estudio, editor de notas, simulacro, tablas largas) usan `--glass-strong` (≥ 78 % de opacidad) y desenfoque mayor.
- Regla dura: el texto de la interfaz nunca baja de 4.5:1 y el de 24 px o más nunca baja de 3:1.

## 7. Componentes
1. **Barra superior** (píldora segmentada, centrada y flotante): Mazos · Añadir · Explorar · Simulacros · Calendario · Estadísticas · Respaldo. Elemento activo con píldora de relleno que se desliza con resorte; sin subrayados de color. En iPad con poco ancho se compacta en iconos.
2. **Panel de mazos** (`.glass`, 28 px): encabezado "Mazo / Nuevas / Aprendiendo / Vencidas" en `--t2`; filas de ≥ 44 px con ＋/－ para jerarquía, nombre con emoji opcional y tres cifras tabulares alineadas a la derecha; fila seleccionada = píldora de relleno claro; engranaje por fila al seleccionarla; deslizar para acciones rápidas (estudiar, suspender, exportar).
3. **Tres tarjetas de estadísticas** (debajo del panel de mazos):
   - **Progreso de hoy**: Estudiadas · Tiempo (min) · Ritmo (s/tarjeta) · Promedio (tarjetas/min) · % de aciertos.
   - **Pendientes**: Nuevas · Aprendiendo · Vencidas · Total · Vencen mañana · Tiempo estimado (min).
   - **Hecho hoy**: Nuevas aprendidas · Repeticiones de aprendizaje · Repasos vencidos · Maduradas · Conteo de "Otra vez".
   Título centrado, filas etiqueta a la izquierda y valor a la derecha, cifras tabulares.
4. **Pomodoro** (arriba a la derecha): tiempo grande (40 px, peso ligero), tres botones circulares de vidrio (iniciar/pausar, reiniciar, estadísticas) y debajo "Hoy: n · Estudio: 25 min · Descanso: 5 min". Mismo componente como panel y como minicontrol.
5. **Botones inferiores** en píldora de vidrio: Importar compartidos · Crear mazo · Importar archivo. Tamaño táctil ≥ 44 px.
6. **Riel de Espacios** (izquierda): píldora vertical de vidrio con miniaturas cuadradas de 48 px; el espacio activo lleva un anillo blanco/negro de 2 px; botón ＋ para crear uno.
7. **Ventanas de panel** (PDF, notas, tarjetas, simulacro, hoja, etc.): barra de título de 44 px con nombre, chip de estado en contorno y controles (bloquear, minimizar, expandir, cerrar) en iconos monocromos; arrastrable por la barra; esquina de redimensionado; la ventana enfocada se distingue por borde más claro y sombra más profunda, no por color.
8. **Dock inferior** (píldora de vidrio): "＋ Añadir panel" e iconos por tipo de panel; a los lados, pastillas "Extras" y "Bandeja" con contador en blanco/negro.
9. **Pantalla de estudio**: tarjeta central en `--glass-strong`, texto grande y legible, botones de calificación (sección 4) en una barra inferior de vidrio, fondo del espacio atenuado automáticamente.
10. **Simulacros, calendario, notas, ajustes**: mismos componentes (listas agrupadas en vidrio, píldoras, filas de ≥ 44 px, hojas inferiores con "grabber"). Calendario y mapa de calor con cuadritos en escala de grises.
11. **Formularios y controles**: interruptores estilo iOS en escala de grises (encendido = relleno invertido), controles deslizantes, campos con contorno de 0.5 px.

## 8. Rendimiento en iPad (el vidrio es caro)
- Un `backdrop-filter` por panel; **no anidar** paneles con desenfoque dentro de otros con desenfoque (los internos usan solo relleno translúcido).
- No animar el radio del desenfoque; animar solo `transform` y `opacity`.
- Máximo ~4 paneles grandes con desenfoque activos a la vez; los demás pasan a relleno translúcido sin desenfoque.
- **Modo ligero** en Ajustes: sin desenfoque (relleno translúcido más opaco). Activarlo solo si el usuario lo pide, o sugerirlo si se detectan fotogramas lentos (medir con `requestAnimationFrame`).
- Respetar `prefers-reduced-transparency`, `prefers-reduced-motion` y `prefers-contrast`.
- Objetivo: ≥ 50 fps al desplazar y al arrastrar con 3 paneles de vidrio sobre un fondo de foto en un iPad real.
- Fondos grandes como `<img>`/`background` en una capa fija propia; no usar `background-attachment: fixed` (no funciona en iOS).

## 9. Tipografía y emoji
- Helvetica Neue (ya incluida en iPadOS, sin cargar fuentes). Título grande 34/Bold, título 1 28/Medium, título 2 22/Medium, cuerpo 17/Regular, nota 13, pie 12. Pesos 300/400/500/700.
- En vidrio sobre fondos vivos, usar pesos ≥ 400 para texto pequeño; evitar el peso 300 por debajo de 20 px.
- Emojis nativos del sistema con la pila `"Apple Color Emoji","Noto Color Emoji"`. No incluir imágenes ni fuentes de emoji de Apple.

## 10. Accesibilidad
Contraste AA mínimo garantizado por el guardián; foco visible con anillo de 2 px blanco/negro; objetivos táctiles ≥ 44 px; tamaño de texto ajustable; etiquetas `aria-*` y compatibilidad con VoiceOver; ninguna información depende solo del color (aquí no hay color, así que el diseño ya es apto para daltonismo).

## 11. Entregables y pruebas
1. `theme-cristal.css` (tokens y componentes) y el gestor de fondos con el guardián de legibilidad.
2. Una **página de demostración** (`/design`) que muestre todos los componentes sobre **5 fondos de prueba** (blanco, negro, rayas de alto contraste, degradado vivo, foto) en claro y oscuro.
3. **Prueba automática de "sin color"**: recorre el DOM y falla si algún color de texto, borde, fondo, sombra o icono de la interfaz tiene saturación > 5 %, excluyendo el fondo del usuario, los emojis y el contenido importado.
4. **Prueba de legibilidad**: con los 5 fondos, ningún texto de panel queda por debajo de 4.5:1.
5. Capturas de referencia en Playwright con **WebKit** y revisión final en un iPad real (rendimiento y desenfoque).
6. README con cómo añadir un tema nuevo cambiando solo los tokens.

## 12. Orden de trabajo
1) Tokens y componente `.glass`. 2) Gestor de fondos y galería. 3) Guardián de legibilidad. 4) Barra superior y panel de mazos. 5) Tarjetas de estadísticas y pomodoro. 6) Estudio y botones de calificación. 7) Ventanas, riel de espacios y dock. 8) Modo ligero, accesibilidad y pruebas. Skills sugeridas: frontend-design como guía principal, apple-design y mobile-native de `emilkowalski/skills`, y una auditoría final (Impeccable `audit`).

# PROMPT 3: Mejoras 1 para Engrama (ya desplegada)
Cinco cambios puntuales. Nada más.

## 0. Contexto y reglas de alcance
Engrama ya está desplegada y en uso (PWA en Safari de iPad). Antes de escribir código:
1. Lee `CLAUDE.md`, `docs/SPEC.md`, `docs/DECISIONS.md` y el prompt del tema visual "Cristal" si está en `docs/`. Explora la estructura actual del repositorio.
2. Responde con un **plan corto**: qué archivos tocarás por cada mejora y qué riesgos ves. Espera mi confirmación solo si algo del plan contradice la especificación.

**Reglas estrictas**
- Implementa **únicamente** lo descrito aquí. No refactorices, no renombres, no reorganices carpetas, no cambies el diseño de lo que no se menciona y no añadas dependencias nuevas sin justificarlo.
- **No romper datos existentes**: los archivos de la bóveda ya creados (mazos, notas, `calendar/estudio.ics`, `.app/*`) deben seguir abriéndose igual. Cualquier cambio de formato debe ser **retrocompatible** y aplicarse de forma perezosa (solo cuando el usuario use la función nueva), sin migraciones masivas.
- Mantén el estilo del tema "Cristal": interfaz neutra, vidrio, Helvetica Neue, iconos monocromos, objetivos táctiles ≥ 44 px.
- Un commit por mejora, en una rama aparte (`mejoras-1`). No hagas push a la rama de despliegue hasta que yo pruebe en el iPad.
- Al terminar: actualiza `CLAUDE.md` (estado) y `docs/DECISIONS.md` (decisiones y límites de Safari encontrados).
- Skills sugeridas: ponytail (mínimo código), apple-design y mobile-native, webapp-testing en WebKit.

---

## 1. Color de acento (solo para ciertas cosas)
Hoy la interfaz es neutra, sin color. Añade **un único color de acento opcional** que el usuario elige y que se aplica solo donde él decida.

- Ajustes → Apariencia → **Color de acento**: los 10 colores de la paleta como círculos, un selector libre (`<input type="color">`) con campo hex, y la opción **"Sin acento"** (valor por defecto, equivale al aspecto actual).
- Debajo, la lista **"Dónde usar el acento"** con interruptores. Opciones: elemento activo de la barra superior · anillo y barra de progreso (pomodoro y ritmo del examen) · enlaces y wikilinks en notas · selección de texto y cursor · mapa de calor · botón principal (p. ej. "Bien") · etiquetas y bloques del calendario. Por defecto, al elegir un color se activan solo: enlaces, progreso y mapa de calor.
- Vista previa en vivo, sin recargar. Se guarda en `settings.json` (`accent: {color, usos: [...]}`) y viaja en la exportación de la bóveda.
- Implementación con variables CSS (`--accent`, `--accent-fg`) que **solo** usan los elementos de la lista; lo demás sigue neutro.
- **Legibilidad**: el acento usado como texto o icono debe cumplir contraste ≥ 4.5:1 sobre el vidrio. Reutiliza el guardián de legibilidad para generar una variante clara y otra oscura del color elegido, y avisa si tuvo que ajustarlo.
- Actualiza la prueba automática de "sin color": debe permitir el acento **solo** en los elementos de la lista activada y seguir fallando ante cualquier otro color.

**Criterio de aceptación**: con "Sin acento" nada cambia; con un acento y tres usos activos, solo esos elementos cambian de tono, en claro y oscuro, y la prueba de "sin color" pasa.

## 2. Calendario: vincular temas de mazos y notas
Las entradas del calendario (bloques de estudio, tareas y eventos) deben poder **vincularse** a mazos, temas y notas.

- En el editor de un evento o bloque: botón **"Vincular"** que abre un selector con pestañas **Mazos y temas** (mazo, submazo o etiqueta) y **Notas** (con búsqueda). Permite varios vínculos por evento. Se muestran como **chips** con icono y nombre; al tocar uno se abre su destino (mazo → lista de estudio filtrada; nota → la nota en un panel). Escribir `[[` en la descripción autocompleta mazos y notas (reutiliza el autocompletado de wikilinks existente).
- **En el día del calendario**: cada entrada con vínculos muestra los datos vivos (p. ej. "Cardiología: 34 vencidas") y atajos para abrir la nota o el mazo.
- **"Iniciar bloque"**: además de lo que ya hace, abre las notas vinculadas y lanza una sesión de estudio filtrada a los mazos, submazos o etiquetas vinculados.
- **Vínculo inverso**: en el inspector de la nota, sección "Eventos vinculados" (próximos y pasados); en el detalle de cada mazo, un indicador con los próximos eventos vinculados. Sin pantallas nuevas.
- **Identificadores estables**: los vínculos usan un `id` corto en el frontmatter del mazo o de la nota (p. ej. `id: k7f3q`), que se **genera la primera vez que se vincula** (no se migra todo). Si un archivo no tiene `id`, resuelve por nombre o ruta como alternativa. Si un vínculo no se puede resolver (archivo borrado o renombrado sin `id`), muestra el chip como "enlace roto" con opción **"Reparar"** (elegir de nuevo el destino).
- **Almacenamiento**: en `calendar/estudio.ics` guarda cada vínculo en una propiedad repetible `X-ENGRAMA-LINK:engrama://deck/<id>` o `engrama://note/<id>`, y escribe los nombres legibles en `DESCRIPTION` para que se vean al abrir el `.ics` en otras apps. Las propiedades desconocidas se conservan al importar y exportar.

**Criterio de aceptación**: un bloque con un mazo y dos notas vinculados muestra sus datos en el día, "Iniciar bloque" abre lo vinculado, la nota muestra el evento en su inspector, renombrar la nota (con `id`) no rompe el vínculo, y un `.ics` antiguo sin vínculos sigue importándose sin errores.

## 3. Espacio de notas más grande
- En la pestaña **Notas**, el editor ocupa por defecto todo el ancho disponible. Quita o amplía el límite de ancho de línea actual y ofrece en el panel de formato tres anchos: **Cómodo · Ancho · Completo** (por defecto **Ancho**). Se recuerda por usuario.
- El **explorador** (izquierda) y el **inspector** (derecha) se pueden **ocultar o mostrar** con un botón o con un gesto de deslizar; recuerdan su estado y su ancho (el ancho del explorador se ajusta arrastrando). Cuando el espacio es poco, el inspector se muestra **encima** del editor en lugar de apretarlo.
- Botón **"Pantalla completa de notas"**: el editor ocupa toda la pantalla (oculta barra superior, riel y dock) con un botón claro para salir.
- Como panel dentro de un espacio, el panel de notas arranca con **al menos el 60 % del área útil** y su tamaño mínimo aumenta.
- Probar en horizontal y vertical, y con las ventanas de Stage Manager de distintos tamaños.

**Criterio de aceptación**: en un iPad en horizontal, con explorador e inspector ocultos, el texto usa todo el ancho; la pantalla completa se activa y se sale sin perder el cursor ni el texto sin guardar.

## 4. Paneles minimizables como cuadritos
Algunos paneles deben poder **minimizarse** para no abrumar la vista y quedar como **cuadritos** que se tocan para reactivarlos.

- **Paneles minimizables**: Pomodoro, Estadísticas, tarjetas de estadísticas ("Progreso de hoy", "Pendientes", "Hecho hoy"), mini calendario, Bandeja, y los visores de PDF, documento y hoja. **No** se minimizan la tarjeta de estudio en una sesión activa ni un simulacro en curso.
- Cada panel minimizable tiene un botón **minimizar** en su barra de título. Al pulsarlo, el panel se encoge con una animación de resorte (solo `transform` y `opacity`) hacia un **cuadrito de 48 px** en una **bandeja de paneles** (fila de cuadritos de vidrio junto al dock, o en el riel lateral cuando hay poco espacio).
- El cuadrito muestra el **icono del panel** y, si aplica, un dato vivo en miniatura: el pomodoro muestra el tiempo restante en tabulares; Bandeja, un contador; Estadísticas, nada.
- **Tocar el cuadrito** restaura el panel en su posición y tamaño anteriores. **Pulsación larga** abre un menú: Restaurar · Cerrar. Opcional: arrastrar para reordenar los cuadritos.
- **Lo que está en marcha sigue en marcha**: minimizar el pomodoro no lo detiene (el tiempo se calcula con `endAt`, como ya está implementado).
- El estado (minimizado o no, orden) se guarda **por espacio** en `.app/spaces/<nombre>.json` y se restaura al abrir.
- Si la bandeja se llena, los cuadritos adicionales se agrupan en un cuadrito "＋n" que abre una lista.
- Funciona igual en el tablero "Hoy" y dentro de los espacios con paneles.

**Criterio de aceptación**: minimizar el pomodoro corriendo y volver a abrirlo muestra el tiempo correcto; al recargar la app los cuadritos siguen donde estaban; con el Voice-Over activado, cada cuadrito tiene una etiqueta clara ("Pomodoro, minimizado, 12:30 restantes").

---

## 5. Logo e icono de la app
El usuario adjunta el **logo oficial de Engrama**: un PNG cuadrado de 1254 × 1254 px, en escala de grises (formas geométricas con degradado, plateado/blanco) sobre fondo casi negro. Úsalo como logo en toda la app y genera el icono a partir de él.

**Reglas**
- Guarda el archivo **sin modificar** en `assets/brand/logo-original.png` (no lo redibujes, no lo recolorees, no lo deformes, no lo reinterpretes). Todo lo demás se deriva de ese original.
- No uses ningún logotipo, símbolo ni nombre de Apple, ni SF Symbols.
- El logo es en escala de grises, así que respeta el tema "Cristal" (sin color). Excluye las imágenes del logo y del icono de la prueba automática de "sin color".

**Icono de la PWA**
- Genera a partir del original, centrando el logo sobre el **mismo fondo casi negro** del archivo (toma el color exacto muestreando una esquina de la imagen; no asumas `#000`):
  - `apple-touch-icon` de **180 × 180** (cuadrado, **sin transparencia**; iOS aplica solo las esquinas redondeadas).
  - Iconos del manifiesto de **192 × 192** y **512 × 512**, y una versión **maskable de 512 × 512** con el logo dentro de la zona segura (≈ 60 % del ancho, bien centrado).
  - Favicon (**32 × 32** y **16 × 16**, y `favicon.svg` solo si se puede obtener una vectorización fiel; si no, PNG).
- El logo ocupa cerca de la mitad del lienzo; para el icono, escálalo a ≈ 60 % del ancho y **recentra óptimamente** (el original está ligeramente desplazado hacia arriba).
- Actualiza `manifest.webmanifest` (`icons`, `background_color` y `theme_color` con el color de fondo muestreado) y las etiquetas `<link rel="apple-touch-icon">` y de favicon en `index.html`. Invalida la caché del service worker con una versión nueva para que el iPad tome el icono nuevo (en iOS puede ser necesario quitar y volver a "Añadir a pantalla de inicio"; menciónalo en el resumen).
- Opcional: `apple-touch-startup-image` para la pantalla de arranque con el logo centrado sobre el fondo, solo si no complica el despliegue.

**Dónde aparece el logo dentro de la app**
- Barra superior o riel: versión pequeña (≈ 28 px) dentro de un **recuadro oscuro redondeado**; en modo claro **no se invierte ni se recolorea**, se mantiene el recuadro oscuro.
- Pantalla de carga y de bienvenida: logo centrado con el nombre "Engrama" en Helvetica Neue (peso medio) debajo.
- Ajustes → "Acerca de": logo, nombre y versión.
- Servir una versión optimizada (WebP/PNG de ≤ 256 px) para la interfaz; no cargar el original de 1254 px en pantalla.

**Criterio de aceptación**: el icono se ve nítido y centrado en la pantalla de inicio del iPad, sin bordes ni transparencias negras raras; el favicon se distingue en la pestaña; el manifiesto valida sin avisos de iconos; la prueba de "sin color" sigue pasando.

---

## 6. Pruebas y entrega
- Pruebas unitarias del resolvedor de vínculos (con `id`, sin `id`, enlace roto, `.ics` antiguo) y de la lectura y escritura de `X-ENGRAMA-LINK`.
- Pruebas en WebKit (Playwright) de los flujos nuevos, y la prueba de "sin color" y la de legibilidad del tema Cristal sin regresiones.
- Lista de verificación manual en iPad real: acento en claro y oscuro, vincular y abrir desde el calendario, notas a ancho completo, minimizar y restaurar con pomodoro en marcha, y recargar la app para comprobar que todo persiste.
- Entrega un resumen corto: qué cambió por mejora, qué archivos tocaste y qué **no** tocaste.


# PROMPT 4: Mejoras y correcciones (debugs) para Engrama
iPhone, capas y solapamientos, idiomas, perfil, lienzo conectado, calendario con horas y más

## 0. Contexto y reglas
Engrama ya está desplegada (PWA). Funciona bien en **iPad** y en **web**; en **iPhone** se ve mal. Antes de escribir código:
1. Lee `CLAUDE.md`, `docs/SPEC.md`, `docs/DECISIONS.md` y los prompts anteriores que estén en `docs/` (tema "Cristal", `mejoras-1`).
2. Explora el repositorio y responde con un **plan corto por bloque**: archivos a tocar, riesgos y qué ya existe y se puede reutilizar.

**Reglas estrictas**
- Implementa solo lo descrito aquí. **No refactorices** lo que funciona, no renombres, no cambies lo que no se pide, y no añadas dependencias sin justificarlas.
- **Retrocompatibilidad de datos**: mazos, notas, `calendar/estudio.ics`, `.app/*` y fondos existentes deben seguir abriéndose. Los cambios de formato se aplican de forma perezosa, sin migraciones masivas.
- **Reutiliza componentes y datos**: si algo ya existe (editor de notas, lista de mazos, banco de preguntas, vínculos del calendario de `mejoras-1`), reutilízalo; no lo dupliques.
- Mantén el tema "Cristal" (interfaz neutra, vidrio, Helvetica Neue, iconos monocromos, objetivos táctiles ≥ 44 px).
- Trabaja por **bloques (A a F)**. Rama `mejoras-2`, un commit por punto. Al terminar cada bloque: resumen corto (qué cambió, qué archivos tocaste y cuáles **no**), y **espera mi prueba en el dispositivo** antes de seguir. No hagas push a la rama de despliegue sin mi confirmación.
- Todo texto nuevo de interfaz debe pasar por el sistema de idiomas (punto 1) desde el primer momento.
- Al final de cada bloque actualiza `CLAUDE.md` y `docs/DECISIONS.md`.
- Skills sugeridas: ponytail, webapp-testing (WebKit, con dispositivos iPhone), mobile-native, apple-design, break-ui (nombres larguísimos, listas vacías, cifras enormes) y, al cierre, una auditoría (Impeccable `audit`).

Bloque A. Base y correcciones de interfaz

## 1. Idiomas: español, inglés y francés
- Sistema de traducción con tablas por idioma (`es`, `en`, `fr`) en JSON, sin textos fijos en el código. Selector en **Ajustes → Idioma**; por defecto sigue el idioma del dispositivo si es uno de los tres y, si no, español. Se guarda y se aplica al instante, sin recargar.
- Fechas, horas, números y primer día de la semana con `Intl` según el idioma; plurales con `Intl.PluralRules`; actualizar `<html lang>`.
- Traducir toda la interfaz, incluidos tooltips, mensajes de error, avisos y nombres de botones. **El contenido del usuario (notas, mazos, tarjetas) no se traduce.**
- Glosario base: Nuevas / New / Nouvelles · Aprendiendo / Learning / En apprentissage · Vencidas / Due / À réviser · Otra vez / Again / Encore · Difícil / Hard / Difficile · Bien / Good / Bien · Fácil / Easy / Facile · Mazo / Deck / Paquet.
- El francés y el inglés ocupan más espacio: ningún texto debe desbordarse ni cortarse. Prueba con un **pseudo-idioma** más largo (+40 %).
- Pruebas: una prueba que falle si falta una clave en cualquiera de los tres idiomas. Marca las traducciones como "pendientes de revisión por hablante nativo" en `docs/DECISIONS.md`.
- **Criterio**: cambiar de idioma traduce todas las pantallas sin recargar y sin desbordes.

## 2. Capas, solapamientos y ventanas emergentes
Hay paneles que se encimen y ventanas transparentes difíciles de leer. Corrige de raíz con un sistema único.
- **Tokens de capa**: `--z-base:0; --z-panel:10; --z-dock:100; --z-popover:200; --z-modal:300; --z-toast:400; --z-tooltip:500`. Los paneles libres del lienzo usan dinámicamente la banda 10–99.
- **Gestor de capas** (`OverlayManager`) con portales: modales, menús, hojas y avisos se dibujan en la raíz, no dentro del panel que los abre.
- **Modales y ajustes**: centrados, con **velo oscuro** detrás, relleno de vidrio **más opaco** (`--glass-strong`, ≥ 85 %) para que no se transparente el contenido de abajo, foco atrapado, cierre con Esc o tocando fuera, ancho máximo ≈ 560 px. En teléfono se muestran como **hoja inferior**.
- **Casos concretos a corregir**:
  - La **Papelera** de Notas se encima sobre el panel de Materias: debe abrirse como modal centrado (o como vista que reemplaza el contenido), nunca dibujarse encima del explorador.
  - Los **ajustes de mazo abiertos desde Hoy**: modal centrado, más opaco, con velo.
  - Revisa **todos** los menús, popovers y paneles que se abran encima de otros y pásalos por el gestor.
- **Diseños fijos** (Hoy, Notas): paneles en rejilla/flex para que no puedan traslaparse.
- **Lienzo (Espacios)**:
  - Al abrir un panel o archivo nuevo, se coloca en el **mayor espacio libre visible**; si no cabe, en cascada (desplazado 32 px) y siempre dentro de la pantalla. Si se abre desde otro panel, aparece **junto a él**. Nunca queda tapando por completo a otro.
  - **Al tocar o hacer clic en cualquier panel, pasa al frente** (`pointerdown` sube su capa); normaliza los valores de z-index cuando crezcan demasiado.
- Pruebas (WebKit): abre cada modal y menú y comprueba que está dentro de la pantalla, tiene velo y no deja ver texto legible de lo que hay debajo; abre 6 paneles seguidos en un espacio y comprueba que no se traslapan mientras haya espacio.
- **Criterio**: no queda ningún caso de ventana encimada o ilegible en Hoy, Notas, Mazos, Calendario y Espacios.

## 3. Minimizar todos los paneles
- **Todos** los paneles pueden minimizarse (esto **reemplaza** la exclusión de `mejoras-1`, que dejaba fuera la tarjeta de estudio y el simulacro en curso). Al minimizar una sesión de estudio o un simulacro, el estado se conserva y el **cronómetro del simulacro sigue corriendo**; su cuadrito muestra el tiempo restante.
- Botones **"Minimizar todos"** y **"Restaurar todos"** en el dock y en el menú del espacio. Cada panel conserva su botón individual.
- Los cuadritos siguen la especificación de `mejoras-1` (bandeja, tocar para restaurar, pulsación larga con menú, agrupar en "＋n", estado guardado por espacio).
- **Criterio**: minimizar todo deja solo la bandeja; restaurar todo devuelve cada panel a su sitio; el pomodoro y el simulacro mantienen el tiempo correcto.

## 4. Mensaje con el nombre al pasar el cursor por un icono
- Componente `Tooltip` para **todo botón que sea solo icono**: un aviso pequeño de vidrio con el nombre traducido, que aparece tras ~400 ms de cursor encima (ratón o trackpad), al enfocar con teclado y, **en pantallas táctiles, con pulsación larga** (~500 ms) sin ejecutar la acción. Se coloca evitando los bordes, se oculta al desplazar o al tocar fuera, usa la capa `--z-tooltip`.
- El texto es el mismo del `aria-label` y viene de las tablas de idiomas. No usar el atributo `title` nativo.
- **Criterio**: ningún icono sin nombre en ningún idioma; los avisos no tapan el elemento que describen.
- 
BLOQUE B. iPhone

## 5. Versión móvil (iPhone)
Hoy se ve bien en iPad y mal en iPhone. **Restricción principal: no modificar el aspecto ni el comportamiento de iPad ni de web.**
- Define "teléfono" con una sola regla: `(max-width: 600px), (max-height: 500px) and (orientation: landscape)` (un iPad nunca cumple ninguna de las dos). **Todo el CSS y JS nuevo para móvil va bajo esa condición** (o bajo una clase `is-phone` asignada con esa misma regla). No toques reglas globales.
- **Protección contra regresiones**: antes de empezar este bloque, toma capturas con Playwright (WebKit) de las pantallas principales a **1366×768** (web), **1024×768** y **834×1194** (iPad). Al terminar, vuelve a capturarlas: la diferencia debe ser **cero píxeles**.
- **Primero audita**: captura cada pantalla en **375×667, 390×844, 393×852, 430×932, 440×956** y en horizontal **852×393**, y entrégame la lista de fallos. Después corrige.
- Lo que debe verse y funcionar bien (adaptar, no rediseñar):
  - Una sola columna; **barra inferior** con Hoy · Mazos · Estudiar · Notas · Más (la hoja "Más" abre Simulacros, Calendario, Espacios, Estadísticas, Perfil, Ajustes).
  - Modales y ajustes como **hojas inferiores**; paneles como hojas de pantalla completa; en Espacios, **un panel a la vez** con la bandeja de cuadritos.
  - Tablas y tarjetas de estadísticas compactas, **sin desplazamiento horizontal de la página** (`scrollWidth ≤ innerWidth`).
  - Campos de texto con **fuente ≥ 16 px** (evita el zoom automático), `100dvh`, áreas seguras (`env(safe-area-inset-*)`), teclado en pantalla con `visualViewport`, objetivos táctiles ≥ 44 px.
  - Vidrio con menos desenfoque en teléfono (rendimiento).
  - El mapa de calor cabe dentro de su tarjeta.
- Revisa los tres idiomas (el francés es más largo) y los tres tamaños de texto.
- **Criterio**: sin desbordes horizontales, sin contenido bajo la isla dinámica ni la barra de inicio, todas las funciones alcanzables con una mano, y diferencia cero en iPad y web. Pruebas finales en un **iPhone real**.

BLOQUE C. Ajustes y datos

## 6. Add-ons dentro de Ajustes
- Quita "Add-ons" de la navegación principal y colócalo en **Ajustes** como sección titulada **"Add-ons"**, con la lista y los interruptores de siempre.

## 7. Perfil del usuario
- Nuevo apartado **Perfil**, accesible desde el avatar en la barra superior y desde Ajustes. Campos (todos opcionales): **foto o emoji de avatar**, **nombre**, **bio**, estudios (carrera o programa, institución, año) y **meta o lema**.
- Encabezado destacado con avatar, nombre, bio y **tres cifras** (racha actual, tarjetas totales, horas de estudio). En Hoy, saludo con el nombre ("Hola, …").
- Datos en `profile/perfil.md` (frontmatter + bio) y la foto en `media/.app/perfil/`; se incluyen en la exportación de la bóveda y **nunca salen del dispositivo**.
- **Criterio**: el perfil se edita, persiste, se exporta y se muestra en Hoy; sin foto se muestra la inicial o el emoji.

## 8. Borrar mazos (y recuperarlos)
- En el **engranaje del mazo**, al final de las opciones: **"Eliminar mazo…"**. Al borrar un mazo con submazos se listan todos.
- Confirmación clara con cifras ("Se moverán a la Papelera: 120 tarjetas y 340 repasos"), botones **Cancelar** y **Mover a la Papelera**.
- **Papelera de mazos** (accesible desde Mazos): restaurar o **eliminar definitivamente**; vaciado automático a los 30 días (configurable). El historial de repasos viaja con el mazo y se restaura con él.
- Modo de selección múltiple para borrar varios de una vez.
- Los vínculos del calendario hacia un mazo borrado se muestran como "enlace roto" con opción de reparar.
- **Criterio**: un mazo creado por error se borra en dos toques, se puede restaurar íntegro y no deja referencias rotas en silencio.

## 9. Fondos: borrar y reencuadrar
- En la galería de fondos: **eliminar** cualquier fondo subido (confirmación; si está en uso, vuelve al fondo integrado por defecto), con selección múltiple.
- **Mover la fotografía**: editor de encuadre con vista previa de los paneles encima; **arrastrar** para reposicionar y **pellizcar o deslizador** para acercar; botón **Restablecer**. Guarda posición y escala por fondo en `.app/fondos.json` y aplícalas en todas las vistas con `background-position` y escala. Recalcula el guardián de legibilidad al cambiar el encuadre y regenera la miniatura.
- **Criterio**: un fondo subido por error se elimina; otro se recentra y se ve igual al volver a abrir la app.

## 10. Almacenamiento: borrar datos pesados
- **Ajustes → Almacenamiento**: uso total (`navigator.storage.estimate()`) y desglose por tipo (PDF, documentos, hojas, fotos, fondos, audio, caché).
- Lista de archivos **ordenable por tamaño**, con selección múltiple y **borrado definitivo con confirmación**. Si un archivo está usado en notas o tarjetas, mostrar "Usado en N lugares" y pedir confirmación; al borrarlo, esos lugares muestran un marcador "archivo eliminado" en lugar de romperse.
- Detecta **archivos huérfanos** (sin uso) y ofrece limpiarlos; botón para vaciar cachés regenerables.
- Sugerir **exportar antes de borrar**.
- **Criterio**: se libera espacio verificable y ninguna nota queda con una imagen rota sin aviso.

---

BLOQUE D. Notas y mapa de adherencia

## 11. Buscador en Notas
- Barra de búsqueda siempre visible en la sección Notas (también en teléfono). Busca **palabras y números clave** en el contenido de todas las notas, con tolerancia a **acentos y mayúsculas**.
- La indexación **conserva números y símbolos**: `120/80`, `37.5`, `5-HT`, `pH 7.4`, `mg/dL`. La búsqueda de un número es exacta por defecto.
- Resultados con **fragmento y coincidencias resaltadas**, materia y tema de la nota, ordenados por relevancia; tocar uno abre la nota **en la posición exacta** de la coincidencia. Filtros por materia, tema y fecha.
- Además, **"Buscar en esta nota"** con siguiente/anterior y contador.
- Índice incremental que se actualiza al guardar (en un Worker); debe poder reconstruirse desde los archivos.
- **Criterio**: buscar "120/80" o "pH" encuentra las notas que lo contienen y abre la posición correcta; con 500 notas la respuesta es casi instantánea.

## 12. Mapa de adherencia proporcional
- El panel **no ocupa un año completo por defecto**. Muestra desde la **primera fecha con actividad** hasta hoy, con un mínimo de **8 semanas** y un máximo de 12 meses; las celdas son pequeñas de tamaño fijo y el panel **crece según los días acumulados** (se ajusta a su contenido, sin grandes zonas vacías).
- Botón para **"Ver año completo"**. Mantén los resúmenes (racha, días estudiados) y el detalle al tocar un día.
- **Criterio**: un usuario con 10 días de actividad ve un panel pequeño; con 1 año, el panel completo.

---

BLOQUE E. Lienzo conectado y simulacros

## 13. Espacios sin opciones predeterminadas
- Un espacio nuevo está **vacío**. Elimina los preajustes ("PDF + tarjetas", "Clase", "Repaso", etc.); no se abre nada solo. Los espacios que el usuario ya guardó se conservan.
- El menú **"＋ Añadir panel"** ofrece todo lo que se puede abrir, sin restricciones: Nota (nueva o existente), Mazo, Tema, Simulacro/Examen, PDF, Documento, Hoja, Imagen, Pomodoro, Estadísticas, Calendario. Cada elemento se coloca con las reglas de la sección 2.

## 14. Paneles conectados con sus secciones (una sola fuente de datos)
Un panel del lienzo es una **vista del mismo dato**, no una copia. Lo que se hace en el panel es lo mismo que se hace en su sección original, y los cambios aparecen en ambos lados al instante.
- **Nota**: botón **"＋ Nueva nota"** que la crea de verdad en la bóveda (en la Bandeja o en la materia y tema que el usuario elija) y la abre como panel; también se puede abrir una nota existente con buscador. Se escribe con el **mismo editor completo** (menú "/", imágenes, enlaces, "Buscar en esta nota"). Si la misma nota está abierta en la pestaña Notas y en el lienzo, ambas se mantienen sincronizadas en vivo (un único documento en memoria, un solo guardado) sin pisarse.
- **Mazo o tema** (mazo, submazo o etiqueta): lista de tarjetas con búsqueda, **añadir y editar tarjetas, estudiar** (los repasos cuentan igual) y el engranaje con las mismas opciones del apartado Mazos.
- **Simulacros y exámenes**: ver y editar el banco, **crear** o **importar** exámenes (punto 15), **hacer el simulacro** dentro del panel y ver resultados, igual que en su apartado.
- Implementación: tiendas compartidas (`NoteStore`, `DeckStore`, `ExamStore`) con suscripción a cambios; **reutiliza los componentes existentes** dentro de los paneles.
- **Criterio**: escribir en un panel de nota y ver el texto aparecer en la pestaña Notas sin recargar (y al revés); estudiar 5 tarjetas desde un panel de mazo actualiza los contadores de Hoy; todo sobrevive a recargar.

## 15. Crear y subir exámenes en la misma pantalla
- En Simulacros (y en su panel del lienzo): **"＋ Nuevo examen"** con un **editor visual**: título, minutos, orden aleatorio, y por pregunta: enunciado (con imagen opcional), opciones (añadir, quitar, reordenar), **marcar correcta(s)** (una o varias), explicación, tema, y caso compartido para varias preguntas. Duplicar y reordenar preguntas; validación antes de guardar (p. ej. "pregunta sin respuesta correcta").
- También **"Subir examen"** con el importador ya existente (vista previa y correcciones).
- Se guarda en `exams-bank/<nombre>.md` en el formato nativo, de modo que editar el archivo a mano y usar el editor visual sean equivalentes.
- **Criterio**: crear un examen de 5 preguntas en la app, hacerlo como simulacro y ver los resultados, sin tocar archivos.

---
BLOQUE F. Calendario

## 16. Clases y actividades con horas, enlazadas a temas
- Crear entradas con **hora de inicio y fin** tocando una franja del día o la semana (arrastrar para fijar la duración). Formulario: título, **tipo** (Clase · Actividad · Estudio · Examen · Otro, distinguidos con iconos, sin color), fecha, hora de inicio y fin, "todo el día", **repetición** (ninguna, diaria, semanal con días elegidos, mensual) con fecha de fin, lugar, notas y recordatorio.
- **Editar y borrar**: arrastrar para mover o cambiar duración; al editar o borrar una repetición, elegir "solo este día" o "toda la serie".
- **Enlazar horas con temas**: cualquier franja puede vincularse a mazos, temas, etiquetas o notas con el mecanismo de vínculos de `mejoras-1` (sección 2). Si todavía no está implementado, impleméntalo siguiendo ese documento; **no lo dupliques**. Un bloque de "Estudio" vinculado a un tema muestra sus tarjetas vencidas y, con "Iniciar", abre la sesión de estudio y las notas de ese tema.
- Almacenamiento en `calendar/estudio.ics` con `RRULE` para repeticiones y `EXDATE` para excepciones. Usa **horas locales flotantes** (sin zona) para que una clase a las 8:00 siga siendo a las 8:00. Los eventos antiguos siguen funcionando. Las vistas Mes, Semana, Día y Agenda muestran las entradas.
- **Criterio**: crear una clase semanal los lunes de 8:00 a 10:00, un bloque de estudio de 17:00 a 18:00 vinculado a un tema, borrar solo un lunes, y verlo todo correcto en las cuatro vistas y al reabrir la app.

---

## 17. Pruebas y entrega
- Pruebas unitarias: traducciones completas, resolvedor de vínculos, expansión de `RRULE`/`EXDATE`, indexación de números y símbolos, papelera de mazos, almacenamiento de encuadres de fondo.
- Pruebas en WebKit (Playwright) de cada bloque, incluyendo dispositivos iPhone, la regresión de **diferencia cero** en iPad y web (Bloque B) y las pruebas existentes de "sin color" y legibilidad del tema Cristal, sin regresiones.
- Lista de verificación manual en **iPhone, iPad y navegador de escritorio**.
- Entrega, por bloque, un resumen corto: qué cambió, qué archivos tocaste, qué **no** tocaste, y los límites de Safari que encontraste.


# PROMPT 5: Pencil, PDFs, sonido ambiente y control por teclado/mando para Engrama

## 0. Contexto y reglas
Engrama ya está desplegada (PWA en Safari, iPad principalmente). Este prompt añade cuatro funciones. Antes de escribir código:
1. Lee `CLAUDE.md`, `docs/SPEC.md`, `docs/DECISIONS.md` y los prompts anteriores en `docs/` (Cristal, mejoras-1, mejoras-2).
2. Explora el repositorio y responde con un **plan corto por bloque**: archivos a tocar, qué se reutiliza y riesgos.

**Reglas estrictas**
- Implementa solo lo descrito. **No refactorices** lo que funciona. No añadas dependencias sin justificar licencia (solo MIT/Apache/BSD/ISC) y peso.
- **Retrocompatibilidad**: archivos, notas, mazos y `.app/*` existentes siguen abriéndose. Nada de lo nuevo modifica los archivos originales del usuario.
- **No modificar** el aspecto ni el comportamiento actual de iPad, web ni iPhone fuera de lo pedido. Todo lo nuevo táctil/Pencil se activa solo donde se usa.
- Reutiliza componentes: visor de PDF existente, editor de notas, lienzo de Espacios (paneles conectados de mejoras-2), tema Cristal, Tooltip, OverlayManager, sistema de idiomas es/en/fr (todo texto nuevo pasa por él).
- Rama `mejoras-3`, un commit por punto. Al terminar cada bloque: resumen corto (qué cambió, archivos tocados y **no** tocados) y **espera mi prueba en iPad** antes de seguir.
- Skills sugeridas: ponytail, webapp-testing (WebKit), apple-design, break-ui y una auditoría final.
- Seguridad de datos: todo vive en la bóveda local; nada sale del dispositivo.

---
 
 BLOQUE A. Add-on: Música / Ruido blanco / Relajante

## 1. Add-on "Sonido ambiente"
- Se activa desde **Ajustes → Add-ons** (interruptor, igual que los demás). Cuando está activo aparece un **mini reproductor** (icono en el dock/barra superior que abre un panel pequeño, también disponible como panel del lienzo y minimizable a cuadrito).
- **Sonidos generados en el dispositivo** (Web Audio API, sin archivos ni derechos de autor): ruido blanco, rosa y marrón; lluvia; viento; olas; ventilador. Cada uno con **volumen propio**, y la posibilidad de **mezclar varios** (p. ej. lluvia + ruido marrón) con deslizadores.
- **Música propia del usuario**: importar archivos de audio (mp3, m4a, wav) a la bóveda (`media/audio/`), crear listas simples, reproducir en bucle o aleatorio. Metadatos básicos (título, duración).
- **Temporizador de apagado** (15/30/60 min, o "al terminar el pomodoro") con **desvanecimiento** suave de 5 s.
- **Integración con el pomodoro**: opción "sonar solo durante el enfoque y silenciar en el descanso" (apagada por defecto). La alarma del pomodoro siempre se oye por encima.
- **Atenuar al estudiar**: opción para bajar el volumen automáticamente mientras se muestra una tarjeta con audio/pronunciación, si existe.
- Limitaciones de Safari que debes respetar y documentar:
  - El audio solo puede iniciarse tras un **toque del usuario**; maneja el estado `suspended` del `AudioContext` y reanuda al volver a primer plano.
  - Para que **siga sonando con la pantalla bloqueada o en segundo plano**, prueba una reproducción vía elemento `<audio>` + **Media Session API** (título, controles de bloqueo). Si Safari lo impide para audio generado, documenta la alternativa (renderizar un bucle de ruido a un buffer y reproducirlo con `<audio>`) y dime qué funcionó realmente.
  - No se puede integrar Spotify ni Apple Music (DRM). Añade un botón opcional "Abrir mi app de música" que solo abre el enlace; no inventes integraciones.
- Mini reproductor en estilo Cristal: monocromo, controles grandes (≥ 44 px), tooltips y textos en es/en/fr.
- **Criterio**: mezclar lluvia + ruido marrón, bloquear la pantalla y que siga sonando (o que esté documentado qué límite de Safari lo impide); el apagado programado desvanece y detiene; no hay sonido al abrir la app sin interacción.

---
BLOQUE B. Apple Pencil: base común

## 2. Motor de tinta compartido
Un solo componente de tinta que usan PDFs (bloque C) y notas manuscritas (bloque D). No lo dupliques.
- **Pointer Events** (`pointerType === "pen"`), con `pressure`, `tiltX/tiltY`, y `getCoalescedEvents()` para trazos suaves; `touch-action: none` solo dentro del lienzo de tinta (no rompe el desplazamiento del resto de la app).
- **Rechazo de palma**: mientras hay un lápiz activo o recién usado (~500 ms), ignorar los toques de dedo sobre la superficie de tinta. Ajuste "Dedo dibuja / Dedo solo desplaza / Solo Pencil" (por defecto: **solo Pencil dibuja, el dedo desplaza y hace zoom**).
- Trazos suavizados con `perfect-freehand` (MIT) u otra librería justificada; grosor según presión.
- **Herramientas**: bolígrafo, resaltador (translúcido, bajo el texto), borrador (por trazo y por área), lazo para seleccionar/mover, regla opcional. Grosores y paleta de colores propia de la tinta (la tinta puede tener color; la interfaz sigue neutra). Deshacer/rehacer ilimitado por sesión.
- Barra de herramientas flotante de vidrio, movible, que no tapa el contenido; atajos con tooltips.
- Latencia: dibujar en un `<canvas>` en capa propia con renderizado incremental; objetivo ≤ 1 fotograma de retraso perceptible. Mide en iPad real y reporta.
- Almacenamiento: los trazos se guardan **vectoriales** (puntos, presión, color, grosor) en JSON; nunca como imagen rasterizada salvo en exportación.
- Notas honestas: Safari **no** expone el doble toque ni el apretón del Apple Pencil Pro; no los prometas. Si el hover del Pencil está disponible en el dispositivo, úsalo para una vista previa del cursor, sin depender de él.
- **Criterio**: escribir con Pencil con presión variable, apoyando la palma sin que se marque nada, y el dedo sigue desplazando y haciendo zoom.

---

BLOQUE C. Apartado de PDFs con subrayado

## 3. Sección "PDFs"
- Nuevo apartado **PDFs** (biblioteca): lista/cuadrícula con miniaturas, buscador por nombre, carpetas (o etiquetas) y progreso de lectura. Importar desde Archivos de iPadOS (`<input type=file>`) y arrastrando. Los originales quedan **intactos** en `docs/`.
- **Visor** (reutiliza el existente con pdfjs-dist): continuo y por página, zoom por pellizco, índice/marcadores, miniaturas, buscar texto, última página recordada. Se abre también como **panel del lienzo** (junto a mazos/notas).
- **Subrayar con Apple Pencil**:
  - Herramienta **Resaltador inteligente**: al deslizar el Pencil sobre el texto, resalta **las líneas de texto reales** (usa la capa de texto de pdfjs para ajustar a las palabras) con colores seleccionables; también **subrayado** y **tachado**.
  - **Bolígrafo libre** para anotar en márgenes y dibujar, con el motor del bloque B.
  - **Texto seleccionado → acciones**: crear tarjeta (cita como anverso), copiar a una nota con enlace de vuelta a la página, o buscar. Las anotaciones se pueden listar en un panel lateral ("Resaltados") ordenado por página y clicables.
  - Notas adhesivas (texto) opcionales sobre la página.
- **Guardado sin tocar el original**: las anotaciones van en un archivo auxiliar `docs/<nombre>.pdf.annots.json` (coordenadas normalizadas a la página y rotación, de modo que sobrevivan a zoom y orientación). Si el PDF se reemplaza por otra versión, avisa y no pierdas las anotaciones.
- **Exportar PDF con anotaciones** ("aplanado") para compartir: usando `pdf-lib` (MIT) u otra librería justificada; también exportar solo el resumen de resaltados a `.md`.
- Rendimiento: renderizado por páginas visibles, PDFs de 300+ páginas fluidos en iPad; las anotaciones se dibujan en capas por página.
- **Criterio**: abrir un PDF de 100+ páginas, resaltar con Pencil cinco líneas de texto ajustándose a ellas, escribir en el margen, cerrar y reabrir la app y que todo siga ahí; exportar un PDF con las anotaciones visibles.

---
BLOQUE D. Notas manuscritas con Apple Pencil

## 4. Escribir a mano en las notas
- En el editor de notas, un bloque nuevo (menú "/" → **Dibujo/Manuscrito**) inserta un **lienzo de tinta** dentro de la nota, redimensionable, que crece hacia abajo mientras se escribe. Debe poder mezclarse con texto Markdown antes y después.
- También **nota manuscrita de página completa** (tipo cuaderno): fondo liso, rayado, cuadriculado o de puntos; zoom y desplazamiento; páginas ilimitadas.
- **Scribble de iPadOS**: en campos de texto normales (título, buscador, tarjetas), no interfieras con Scribble del sistema (escribir con Pencil y que lo convierta en texto); comprueba que funciona y avísame si algo lo bloquea.
- **Texto desde tinta (opcional, solo si es viable)**: no prometas OCR local. Evalúa una librería de reconocimiento sin enviar datos fuera (p. ej. a través de Vision no está disponible en web); si no hay una opción local aceptable, déjalo como "no disponible" y documenta por qué.
- Guardado: trazos vectoriales dentro de la bóveda, vinculados a la nota (`notes/<nota>.ink.json` o bloque con identificador `^id`), y la nota `.md` mantiene una referencia legible (`![[dibujo-<id>]]`) más una miniatura PNG en `media/` para vistas previas y exportación.
- **Exportar**: a PDF y DOCX, la tinta se aplana como imagen; en `.md`, como imagen + conserva el JSON como archivo adjunto en la exportación de la bóveda.
- **Buscador**: los dibujos no se indexan; muestra su miniatura en resultados si la nota coincide por otro texto.
- Funciona también como **panel del lienzo** (Espacios) sincronizado con la sección Notas, igual que las demás notas (mismo documento, un solo guardado).
- **Criterio**: escribir una fórmula a mano dentro de una nota entre dos párrafos, reabrir la app y verla intacta, exportar la nota a PDF con el dibujo visible.

---
BLOQUE E. Atajos de teclado y control con mando/clicker

## 5. Control del repaso sin tocar la pantalla
Nota de interpretación: "Anki controller" se entiende como **poder estudiar las tarjetas con teclado Bluetooth, mando o clicker**, sin mirar la pantalla ni tocar. Si te refieres a otra cosa concreta, ajústalo.
- **Atajos de teclado en el repaso** (configurables, con estos valores por defecto): `Espacio`/`Intro` = mostrar respuesta; `1` Otra vez, `2` Difícil, `3` Bien, `4` Fácil; `Espacio` también = "Bien" cuando la respuesta ya se muestra (ajuste opcional); `Z` deshacer; `E` editar tarjeta; `S` posponer (enterrar); `*` marcar; `F` marcar como "no la sé / favorita"; `Esc` salir.
- **Atajos globales**: `Cmd/Ctrl+K` paleta de comandos (buscar y ejecutar acciones y abrir notas, mazos, PDFs), `Cmd/Ctrl+F` buscar en la sección actual, `Cmd/Ctrl+N` nueva nota, `Cmd/Ctrl+Shift+N` nueva tarjeta, `G` luego `H/M/N/C/S` para ir a Hoy/Mazos/Notas/Calendario/Simulacros (estilo secuencia, sin chocar con escribir en campos), `?` muestra la **hoja de atajos**.
- **Simulacros**: `1–5`/`A–E` para elegir opción, `J/K` o flechas para pregunta siguiente/anterior, `M` marcar para revisar.
- **PDFs y tinta**: `P` bolígrafo, `H` resaltador, `E` borrador, `Cmd/Ctrl+Z` deshacer.
- **Reglas**: los atajos de una sola tecla **no se disparan** mientras se escribe en un campo de texto o editor; no pises atajos del sistema ni de Safari; todos configurables en **Ajustes → Atajos** (reasignar, restablecer, detección de conflictos), guardados en `.app/atajos.json`.
- **Mando y clicker**:
  - **Gamepad API** (mandos MFi/Xbox/PlayStation emparejados con el iPad): asignación por defecto A = mostrar/Bien, B = Otra vez, X = Difícil, Y = Fácil, cruceta = navegar, menú = deshacer; pantalla de **"Asignar botones"** donde se pulsa un botón del mando para asignarlo a cada acción.
  - **Clickers / pasadores de diapositivas Bluetooth** y pedales: suelen enviar teclas (`PageUp/PageDown`, flechas, `Intro`); permite asignarlas a las mismas acciones desde la misma pantalla.
  - Si Safari no entrega los eventos del mando cuando la PWA está en segundo plano o con la pantalla bloqueada, documéntalo; no lo prometas.
- **Retroalimentación**: indicador discreto del último botón pulsado y **sonido/hápticos opcionales** (en iPad no hay vibración web: no lo prometas; solo sonidos opcionales).
- **Accesibilidad**: todo el repaso utilizable solo con teclado, foco visible, orden lógico, `aria-label`s en es/en/fr.
- **Criterio**: estudiar 20 tarjetas solo con teclado Bluetooth (o mando) sin tocar la pantalla; reasignar una tecla y que persista; escribir en una nota no dispara ningún atajo.

---
## 6. Pruebas y entrega
- Pruebas unitarias: generador de ruido (sin NaN, volumen acotado), temporizador de apagado, almacenamiento y reconstrucción de anotaciones (`.annots.json`), conversión de coordenadas entre zoom/rotación, resolución de conflictos de atajos, mapeo de mando.
- Pruebas en WebKit (Playwright) con eventos de puntero simulados `pointerType: "pen"`; comprobar rechazo de palma, atajos que no se disparan al escribir y que **no cambia nada en iPad/web/iPhone fuera de las zonas nuevas** (diferencia de captura cero en las pantallas existentes).
- Lista de verificación manual **con Apple Pencil real**, teclado Bluetooth y, si está disponible, un mando: audio con pantalla bloqueada, latencia de tinta, resaltado ajustado al texto, PDF grande, exportaciones.
- Entrega, por bloque: resumen corto, archivos tocados y no tocados, y **qué límites de Safari encontraste** (audio en segundo plano, mando, Pencil Pro, OCR).
- Actualiza `CLAUDE.md` y `docs/DECISIONS.md` al cerrar cada bloque.

# PROMPT 6: Mover mazos y notas, Ajustes y Respaldo dentro de Perfil, Bandeja oculta y mini reproductor
Debug y mejoras para Engrama (ya desplegada)

## 0. Contexto y reglas
Engrama ya está desplegada (PWA). Antes de escribir código: leer `CLAUDE.md`, `docs/SPEC.md`, `docs/DECISIONS.md` y los prompts anteriores; explorar el repositorio y responder con un plan corto por bloque.

Reglas: implementar únicamente lo descrito; sin refactorizar, renombrar ni añadir dependencias sin justificar (MIT/Apache/BSD/ISC). Retrocompatibilidad de datos y cambios de formato perezosos. **Nada se pierde al mover**: `reviews.jsonl`, `state.json`, IDs `^xxxx`, `id:` de frontmatter, vínculos del calendario, `src:` de las tarjetas y `[[wikilinks]]` siguen funcionando. Toda escritura por `SafeVault`; todo texto por `t()`; lo flotante por `overlay.tsx` con `--z-*`; botones solo-icono con `aria-label`. Tema Cristal; pruebas de «sin color» y legibilidad pasan. iPad y web no cambian fuera de lo pedido (`MODE=compare npm run e2e:phone`). Bloques A–D en la rama `mejoras-4`, un commit por punto, resumen por bloque y esperar prueba en dispositivo; no hacer push ni unir a `main` sin confirmación. Actualizar `CLAUDE.md` y `docs/DECISIONS.md` al cerrar cada bloque.

## BLOQUE A. Mover mazos, tarjetas y notas
### 1. Mover mazos y submazos
- «Mover a…» en el engranaje del mazo, en el menú contextual (pulsación larga) y al deslizar la fila. Selector (hoja) con el árbol de mazos: cualquier mazo o submazo existente como destino (el mazo se vuelve su submazo) o «Nivel superior». Elegir destino es opcional; se puede crear uno nuevo («＋ Nuevo mazo aquí») pero nunca se exige. Excluye el propio mazo y sus descendientes; ante nombre duplicado: Renombrar / Fusionar / Cancelar.
- Arrastrar y soltar en la lista (Pointer Events, con alternativa de tocar para seleccionar y luego el destino). Selección múltiple.
- Mover tarjetas entre mazos (navegador, lista del mazo, panel de mazo del lienzo): una o varias → «Mover a mazo…». Conservan ID, historial y programación; si el ID ya existe en el destino: omitir / duplicar con ID nuevo.
- Reconciliación por ID; no archivar ni duplicar; `verifyDeterminism` igual. Conservar `color`, `new_per_day`, `id:`; actualizar vínculos del calendario y `temas` de exámenes o dejarlos resolver por `id`. Deshacer (aviso con «Deshacer»).
- Criterio: mover «Cardiología/ECG» a «Urgencias» (existente) y una tarjeta a otro submazo, sin crear nada nuevo, conserva ID, historial y vínculos; reconstruir desde `reviews.jsonl` coincide con `state.json`.

### 2. Mover notas `.md` entre carpetas y subcarpetas
- Estructura Materia → Tema → Notas. «Mover a…» en cada nota (menú contextual, deslizar, barra de acciones) con selector del árbol existente: cualquier Materia/Tema existente o uno nuevo creado en el selector (opcional); subcarpetas existentes también; no crear anidación por cuenta propia. Varias notas a la vez y un tema completo a otra materia. Arrastrar y soltar en el explorador (con alternativa tocar-y-elegir); pulsación larga = menú contextual.
- Nada se rompe (usar `vault.move`): `[[wikilinks]]` por título (o `id`), enlaces por ruta actualizados; vínculos del calendario con `id:` válidos, los de ruta se reparan o quedan como «enlace roto» con Reparar; `src:` de tarjetas actualizados; imágenes y dibujos siguen resolviendo; historial y papelera se conservan; índice de búsqueda actualizado. Nombre repetido: Renombrar / Reemplazar / Cancelar. Deshacer. Igual en Notas y en paneles (mismo `NoteStore`).
- Criterio: mover una nota con imágenes, enlaces entrantes y un bloque de calendario vinculado a otro tema; todo funciona y el buscador la encuentra en su nueva ubicación.

## BLOQUE B. Perfil como centro: Ajustes y Respaldo dentro
### 3. Ajustes dentro de Perfil
- Quitar Ajustes de la barra superior, del menú «⋯» de iPad y de «Más». En Perfil, fila «Ajustes» que redirige a la pantalla actual (`#/ajustes` sigue funcionando) y «Volver al perfil». Atajos y paleta siguen llevando a la misma ruta.
### 4. Ajustes con secciones plegables
- No cambiar contenido ni orden; convertir las secciones en acordeón (chevron, título, resumen de una línea). Animación corta con `transform`/`opacity` o `grid-template-rows`, respetando `prefers-reduced-motion`. Por defecto plegadas (la primera vez puede abrirse una). «Desplegar todo» / «Plegar todo». Estado recordado por usuario. `aria-expanded`, `aria-controls`, foco visible, teclado. Igual en teléfono.
- Criterio: lista limpia de secciones plegadas; desplegar una no mueve bruscamente las demás; persiste tras recargar.
### 5. Respaldo dentro de Perfil
- Quitar Respaldo de la barra, de «⋯» y de «Más». Fila «Respaldo» en Perfil hacia la pantalla existente; el recordatorio sigue llevando ahí. Comprobar la barra a 834 px y reportar si cabe entera; no cambiar nada más de la barra.

## BLOQUE C. Bandeja oculta
### 6. Ocultar la Bandeja por ahora
- Quitar icono/contador de la barra, de «Más», del dock/riel y avisos. Interruptor en Ajustes → Add-ons «Bandeja de entrada», apagado por defecto: apagado no se muestra, no cuenta pendientes y `#/bandeja` redirige a Hoy. Los datos de `inbox/` no se tocan; al encenderlo todo vuelve.

## BLOQUE D. Sonido ambiente: mini reproductor flotante
### 7. Mini reproductor que se extiende al pasar el cursor
- No cambiar el panel de Sonido ambiente. Añadir un mini reproductor que aparece solo mientras algo suena, junto al icono de Sonido ambiente (en teléfono, píldora flotante sobre la barra inferior). Compacto: píldora de vidrio con barras de nivel monocromas, título corto y pausa. Se extiende (hacia abajo, resorte, solo `transform`/`opacity`) con hover del cursor o lápiz, con foco de teclado y, sin hover, al tocar; se contrae al salir (~300 ms de gracia) o al tocar fuera. Extendido: título, pausa/reanudar, siguiente/anterior (música), volumen general, capas activas con su volumen, temporizador restante y «Abrir panel».
- Vista del mismo estado de `ambient.ts` (sin otro motor ni `AudioContext`). Desaparece al detener. Capas `--z-*`, tooltips, es/en/fr, ≥ 44 px, `aria-live`, `prefers-reduced-motion`. No tapar la barra ni salir de pantalla; en teléfono no depende del hover.
- Criterio: con lluvia sonando aparece; al pasar el cursor se extiende y permite pausar y cambiar volumen sin abrir el panel; al detener desaparece; nada suena al abrir la app.

## 8. Pruebas y entrega
Unitarias (mover mazo/submazo, destinos inválidos, duplicados, mover tarjetas, `verifyDeterminism`, mover nota y tema, deshacer, rutas antiguas, plegables, add-on de Bandeja); WebKit (mover mazo, tarjeta y nota; Perfil → Ajustes/Respaldo; acordeón; Bandeja; mini reproductor con hover y toque; diferencia cero; «sin color» y legibilidad; tres idiomas y pseudoidioma; nombres larguísimos y jerarquías profundas). Lista manual en iPad, iPhone y escritorio. Entrega por bloque con archivos tocados y no tocados y límites de Safari.

---

# PROMPT 7: Lienzo estático al alejar, PDF por página y firma del desarrollador
Debug y mejoras menores para Engrama (ya desplegada)

## 0. Contexto y reglas
Leer `CLAUDE.md`, `docs/SPEC.md`, `docs/DECISIONS.md` y los prompts anteriores; plan corto por punto (causa probable, archivos, riesgos). Implementar **únicamente** lo descrito; sin refactorizar, renombrar ni añadir dependencias. Retrocompatibilidad (espacios `.app/spaces/*.json`, anotaciones de PDF y ajustes siguen abriéndose; cambios perezosos, sin migraciones). Todo texto por `t()` (es/en/fr). Tema Cristal (sin color, ≥ 44 px), pruebas de «sin color» y legibilidad sin regresiones. iPad, iPhone y web no cambian fuera de lo pedido (`MODE=compare npm run e2e:phone`, diferencia cero en pantallas no tocadas). Rama `mejoras-5`, un commit por punto; resumen por punto (qué cambió, archivos tocados y no tocados) y esperar prueba en dispositivo; no hacer push ni unir a `main` sin confirmación. Actualizar `CLAUDE.md` y `docs/DECISIONS.md`; guardar el prompt en `docs/PROMPTS.md`.

## 1. Interfaz estática al alejar en el lienzo infinito
Síntoma: al alejar (pellizco o `Ctrl/⌘ + rueda`) toda la interfaz (barra, riel, dock, paneles) se mueve o encoge por un instante; debe quedarse fija y solo el contenido del lienzo se aleja/acerca.
Causas probables a verificar: en el zoom mínimo/máximo el gesto deja de consumirse y Safari lo toma como zoom de página o rebote; el `viewport` no bloquea el zoom de página y `touch-action`/`preventDefault` no cubren `gesturestart/change/end` ni `touchmove` de dos dedos; listeners pasivos ignoran `preventDefault`.
Corrección: listeners `{ passive: false }` en el contenedor del lienzo para `wheel` (Ctrl/⌘), `gesture*` y `touchmove` de dos dedos, con `preventDefault()` siempre sobre el lienzo, incluso en el tope. Pellizco con Pointer Events (dos punteros, distancia y punto medio), `touch-action: none` solo en el lienzo, `clamp` y ancla en el punto medio. Bajar el mínimo (p. ej. 0.1, justificado) con resistencia cerca del tope. Sin rebote ni zoom de página solo en Espacios (`overscroll-behavior: none`); evitar `maximum-scale`/`user-scalable=no` salvo que sea imprescindible (documentar y pedir confirmación). No cambiar otras pantallas; sobre un panel con zoom propio manda el panel, sobre el fondo vacío manda el lienzo. Mantener minimapa, «ajustar al contenido», paneo; `prefers-reduced-motion`. Barra, riel, dock y bandeja fuera de la capa transformada.
Pruebas: unitarias (clamp, ancla, resistencia); WebKit: `Ctrl+wheel` más allá del mínimo con `visualViewport.scale === 1`, posiciones fijas sin cambiar ni un píxel, `defaultPrevented`; `gesturechange` y dos punteros táctiles; capturas antes/después.
Criterio: en iPad real, alejar hasta el tope y seguir pellizcando no mueve ni encoge la barra, el riel ni el dock.

## 2. Visores de PDF: «Ver por página» por defecto
El visor arranca en «por página» siempre al abrir (sección PDFs, paneles del lienzo y cualquier otro lugar; un solo cambio). El botón permite pasar a continuo durante la sesión; no se recuerda la elección (si hay un modo guardado, se ignora para el inicio sin borrarlo). Se mantiene la última página recordada; los accesos a una página concreta (`src: archivo.pdf#p12`, resaltado, búsqueda) abren esa página en modo por página. Siguen funcionando anotaciones, tinta, resaltador inteligente, miniaturas, índice, búsqueda, zoom, flechas, atajos y «n / total». Prueba: PDF nuevo, con página recordada y desde `#p12` (sección y panel); actualizar `e2e:p5` sin perder cobertura.
Criterio: cualquier PDF se abre por página en todos los lugares; continuo es manual y no persiste.

## 3. Firma discreta del desarrollador
Texto pequeño en la esquina inferior izquierda: «Desarrollador: SergeV» / «Developer: SergeV» / «Développeur : SergeV» (SergeV no se traduce). Cristal: sin color, Helvetica Neue, ≈ 11–12 px, opacidad ≈ 38 %, sin fondo ni borde, `pointer-events: none`, `user-select: none`, `aria-hidden="true"`; la línea también en Ajustes → Acerca de como texto normal. Posición fija con `env(safe-area-inset-left/bottom)`, capa baja (`--z-base` o justo encima), nunca sobre modales, dock, hojas, tooltips ni la barra del teléfono; si algo ocupa la esquina, queda detrás sin taparlo o se desplaza lo mínimo (reportar). Verificar en Hoy, Mazos, Estudio, Notas, PDFs, Calendario, Espacios, Simulacros y Ajustes (iPad, web, iPhone vertical/horizontal); oculta en estudio y en notas a pantalla completa. Legibilidad sobre los 5 fondos de prueba (≥ 3:1 estimado o sombra neutra) y «sin color». Elemento estático en `app.tsx`; si hace falta, excluir solo esa zona de la comparación de píxeles.
Criterio: la firma se ve en la esquina inferior izquierda en todas las pantallas, no tapa ni es tapada, no es seleccionable ni tocable, y se oculta en estudio y notas a pantalla completa.

## 4. Pruebas y entrega
Unitarias, WebKit (iPad e iPhone), diferencia cero en pantallas no tocadas, «sin color» y legibilidad, claves de idioma. Lista manual en iPad real. Entrega por punto con archivos tocados y no tocados, causa real del punto 1 y límites de Safari.

---

# PROMPT 10: Corregir la importación de `.apkg` de Anki (formato nuevo) y errores visibles
Debug para Engrama (ya desplegada)

## 0. Contexto y síntoma
Al subir un `.apkg` de Anki «se sube pero no aparece en los mazos». Hipótesis a verificar antes de corregir: (1) las versiones recientes de Anki exportan el formato nuevo (`collection.anki21b` con zstd, `meta`, `media` protobuf comprimido) y `collection.anki2` es un marcador falso («Please update to the latest Anki version…»); (2) `src/io/apkg.ts` abre `anki21 ?? anki2` y puede importar el marcador o fallar con una base comprimida; (3) `rows()` traga todos los errores; (4) con 0 mazos la hoja de importación no dice nada claro. Leer CLAUDE.md, SPEC §5, DECISIONS, `apkg.ts`, `apkg.worker.ts`, `import.ts`, `import.tsx`, `tests/apkg.test.ts`; reproducir con paquetes de los tres formatos (legado, compatibilidad, nuevo) y reportar la causa real antes de corregir.
Reglas: solo lo descrito; no tocar el parser de tarjetas, los importadores `.md`/`.zip`/CSV, la vista previa ni deshacer; mismo formato de salida. Datos no confiables (SPEC §12): conservar `MAX_APKG`, `LIMITS`, límite por archivo, profundidad, HTML→texto y renombrado seguro; añadir tope de descompresión zstd y de nº de notas. Dependencias solo si son imprescindibles y MIT/Apache/BSD/ISC (candidata `fzstd`, solo en el Worker); protobuf con decodificador mínimo propio. Sin red; WASM de sql.js empaquetado. Texto por `t()` (es/en/fr). Cristal; diferencia cero fuera de la hoja de importación. Rama `fix-apkg`, un commit por punto, sin push ni merge sin confirmación. Actualizar CLAUDE.md, DECISIONS y guardar el prompt.

## 1. Elegir la colección correcta
Leer `meta`; preferencia `anki21b` → `anki21` → `anki2`; descomprimir si empieza con `28 B5 2F FD`, abrir directo si es `SQLite format 3\0`. Detectar el marcador falso y no importarlo; si es lo único, informar que el paquete es del formato nuevo. Si nada es legible, error claro y accionable.

## 2. Soportar el formato nuevo (`anki21b`)
zstd en el Worker con límite de salida (≤ 1 GB, en `LIMITS`). Esquema v18 (`notetypes`, `fields`, `templates`, `decks`, `deck_config`; mazos con `\x1f`) y v11, detectando por `sqlite_master`. Cloze (nombre, `config` protobuf o `{{c1::`), inversa y ambos. `media` nuevo (protobuf zstd; archivos numerados en zstd) con decodificador mínimo; medio ilegible se omite con aviso. `revlog` igual que hoy (`src: 'anki'`, ease 1–4, ≤ 60 s, `mergeLog`).

## 3. Dejar de tragarse los errores
`rows()` distingue «tabla inexistente» de «error real» (aviso con motivo). Reportar el esquema detectado (v11/v18, notas, mazos, medios). Advertir si hay notas y 0 mazos o 0 notas, con la causa probable. Contar y avisar las notas con primer campo vacío. No escribir «Default» vacío; si tiene tarjetas, nombrarlo como el archivo.

## 4. Hoja de importación
Con 0 mazos y 0 archivos: mensaje principal visible (icono + negrita, sin color) con causa y paso siguiente. Si funciona: resumen («3 mazos · 1 240 tarjetas · 86 imágenes · 5 310 repasos») antes de confirmar y «Ver mazos» después. Verificar `app.changed()` y recarga de la colección (incluidos `decks/A/B/C.md`). Progreso mientras se descomprime; si el Worker falla, mensaje claro sin congelar.

## 5. Pruebas
Unitarias (selección de colección, marcador falso, v11/v18, `\x1f`, cloze/básica/inversa, medios nuevos y legados, `revlog`, tope de descompresión, corrupto, vacío, 0 notas, rutas `../`). Paquetes de ejemplo generados con un script reproducible en `scripts/` y guardados en `tests/fixtures/apkg/`. WebKit: importar cada paquete → resumen → confirmar → Mazos → estudiar → deshacer; archivo basura `.apkg` → error claro. Regresión completa y diferencia cero.

## 6. Entrega
Causa real, qué cambió, archivos tocados y no tocados, dependencias (nombre, licencia, peso), límites conocidos. Actualizar la ayuda de importación y el README con «cómo exportar desde Anki».

---

# PROMPT 12: Crear notas pidiendo solo un dato (el título)
Debug y mejora para Engrama (ya desplegada)

## 0. Contexto y problema
El formulario `NewNote` obliga a rellenar Materia, Tema o clase y Título (`required`), y `notePath` siempre construye `notes/<Materia>/<Tema>/<Título>.md`; `noteMeta` solo considera estructurada una nota de 3 niveles. Objetivo: que crear una nota solo exija el **título**; Materia y Tema opcionales; una nota sin materia/tema no se pierde ni se esconde. Leer CLAUDE.md, SPEC §10b y §10c, DECISIONS, `src/notes/model.ts`, `src/notes/store.ts`, `src/screens/notes.tsx` (NewNote y mover), `spaces.tsx`, `calendar.tsx`, `inbox.tsx`; plan corto.
Reglas: solo lo descrito; sin migrar notas ni renombrar rutas; las existentes (3 niveles, Diario, sueltas) se abren igual. Materia → Tema → Notas sigue siendo lo recomendado, ya no obligatorio. Texto por `t()` (es/en/fr), Cristal, ≥ 44 px, diferencia cero fuera del formulario y la vista afectada. SafeVault; nunca sobrescribir (sufijo «(2)»). Rama `fix-notas`, un commit por punto, sin push ni merge sin confirmación; actualizar CLAUDE.md, DECISIONS y guardar el prompt.

## 1. Formulario «Nueva nota»
Título: único `required`, primero y con foco. Materia y Tema opcionales (datalist, «Opcional», etiquetas «(opcional)»). Tema sin materia: no bloquear; decidir y documentar. Sin valor inicial `tree[0]`: vacío salvo contexto (`initial`). Plantilla limpia sin materia/tema (sin «undefined», sin propiedades vacías). Crear con Intro. Mismo comportamiento en Notas, panel del lienzo, calendario, paleta (`⌘N`) y cualquier otro uso de `NewNote`/`notePath`.

## 2. Dónde se guarda una nota sin materia o sin tema
Propuesta: sin materia ni tema → `notes/<Título>.md` («Sin clasificar»); solo materia → `notes/<Materia>/<Título>.md`, mostrada dentro de su materia en «Sin tema» (ajustar `noteMeta`/`buildTree` sin romper `Diario`); materia y tema → como hoy. No crear carpetas no pedidas; nunca `notes//Tema/…`. `notePath` limpia caracteres y usa «sin título»; pruebas de duplicados, emoji, acentos y 200+ caracteres. Frontmatter `materia`/`tema` solo con valor; el lector tolera su ausencia.

## 3. Todo lo que debe seguir funcionando con notas «sin clasificar»
Explorador y vista «Todo» (grupos «Sin clasificar» y «Sin tema» con contador; mover entre grupos; «Mover a…» acepta destino vacío). Mover nota con Materia y Tema opcionales y «Sin clasificar» como destino. Buscador, wikilinks, backlinks, grafo, papelera, historial, vínculos del calendario, `src:`, exportación, índice y paneles. Cobertura de tarjetas, «Copiar prompt», «Crear tarjeta». `suggestPlace`/Bandeja: asignar es opcional, archivar sin materia válido. Importación sin estructura forzada. Tras crear se abre la nota (rutas de 1, 2 y 3 segmentos, caracteres especiales, panel del lienzo).

## 4. Pruebas
Unitarias (`notePath`, `noteMeta`, `buildTree` con los cuatro casos y la diaria; plantilla sin materia/tema; retrocompatibilidad con la bóveda de ejemplo). WebKit: crear con solo el título (Notas, panel del lienzo, calendario), con solo materia, completa; mover de «Sin clasificar» a materia/tema y de vuelta; recargar; buscar; exportar e importar `.zip` con las tres variantes. Regresión y diferencia cero; tres idiomas y pseudoidioma.

## 5. Entrega
Resumen, archivos tocados y no tocados, decisión de ubicación y otros lugares que exigían materia/tema. Criterio: escribir solo un título y Crear abre la nota al instante, aparece en «Sin clasificar» y se puede mover después; ninguna nota existente cambia de lugar ni de aspecto.

---

# PROMPT 14: Asa de redimensionar del panel de nota + rendimiento de notas e imágenes grandes
Debug y optimización para Engrama (ya desplegada)

## 0. Contexto y síntomas
1. **Bug**: al abrir una **nota en un panel del lienzo** (Espacios), la zona para **agrandar el panel** (la esquina de redimensionar) **se queda atrás al bajar** por la nota: tras desplazarse, ya no se puede redimensionar el panel.
2. **Rendimiento de notas**: con notas **muy pesadas** (muchos bloques, tablas, imágenes, dibujos) la edición, el desplazamiento y la apertura se **enlentecen**.
3. **Rendimiento de imágenes en el lienzo**: abrir **imágenes grandes** en un panel del lienzo es lento (y el lienzo se ralentiza al paneo/zoom).

Antes de escribir código:
1. Lee `CLAUDE.md`, `docs/SPEC.md` (§10b, §10d, §11), `docs/DECISIONS.md`, `src/screens/spaces.tsx` (`Win`/`.win-resize`, `PanelBody`, `ImageView`), `src/theme-cristal.css` (`.win`, `.win-body`, `.win-resize`, `.canvas-plane`), `src/screens/notes.tsx` (editor por bloques, `BlockInput`, `FindBar`, guardado), `src/ui/md.tsx` (`Html`), `src/md/render.ts`, `src/notes/store.ts`, `src/notes/images.ts`, `src/ui/background.tsx` (`mediaUrl`) y `src/ink/DrawingBlock.tsx`.
2. **Mide antes de optimizar** (punto 2.1) y responde con un **plan corto**: causa real de cada síntoma, archivos a tocar, riesgos y objetivos numéricos. Espera mi confirmación solo si algo contradice una regla no negociable.

**Reglas estrictas**
- Implementa **únicamente** lo descrito. No refactorices lo que funciona ni cambies formatos de archivo (`.md`, `.ink.json`, `media/`): **los archivos del usuario siguen siendo la fuente de verdad** y una nota se guarda **idéntica** byte a byte a como la dejaría hoy.
- **No recortes** escritura segura (`SafeVault`, diario), integridad, sanitización (DOMPurify; todo HTML sigue pasando por ella, también lo que se guarde en caché), determinismo de FSRS ni accesibilidad (VoiceOver, teclado, foco, `aria-*`).
- **iPad, iPhone y web no cambian** en aspecto ni comportamiento fuera de lo descrito (`MODE=compare npm run e2e:phone` con diferencia cero). El comportamiento de redimensionar y mover paneles sigue igual cuando no se ha desplazado el contenido.
- Todo texto nuevo por `t()` (es/en/fr; la prueba de claves debe seguir pasando). Tema Cristal (sin color, objetivos ≥ 44 px donde ya aplique). Sin dependencias nuevas salvo justificación (MIT/Apache/BSD/ISC) y peso.
- Rama `fix-lienzo-rendimiento`, un commit por punto. No hagas push ni unas a `main` sin mi confirmación. Actualiza `CLAUDE.md` y `docs/DECISIONS.md` (decisiones, medidas antes/después y límites de Safari) y guarda este prompt en `docs/PROMPTS.md`.
- Skills sugeridas: ponytail (código mínimo), webapp-testing (WebKit), break-ui (notas enormes, imágenes enormes, listas vacías), superpowers (reproducir primero, luego corregir).

## 1. Bug: el asa de redimensionar se queda atrás al desplazar la nota
**Causa probable (verifícala y reporta lo que encuentres)**: en `spaces.tsx` el asa `<div class="win-resize">` está **dentro** de `.win-body`, y `.win-body` es el contenedor que **hace el scroll** (`overflow: auto; position: relative`). Un elemento con `position: absolute` dentro de un contenedor con scroll se coloca respecto a **su contenido**, no al área visible: al desplazar la nota, el asa **sube con el contenido** y sale de la vista. Lo mismo puede ocurrir con cualquier otro panel con scroll (PDF, documento, hoja, mazo, simulacro).

**Corrección**: asa hija de `.win` (o de un envoltorio `.win-frame`), fija en la esquina inferior derecha visible, sobre el contenido (z-index con tokens), `touch-action: none` solo en el asa; relleno inferior/derecho para no tapar la última línea ni la barra; zona táctil ≥ 44×44 px (dibujo de 22 px) y bordes derecho/inferior y esquina redimensionables; mínimos actuales (nota 480×360, resto 260×200) y escala del lienzo; arrastrar el asa nunca desplaza la nota ni abre el teclado (`setPointerCapture`); un solo lugar para todos los paneles; en `is-phone` sigue oculta; en pausa no se muestra. **Pruebas (WebKit)**: nota de 200 bloques desplazada al final y a mitad, asa dentro del área visible antes y después, redimensionar en cada posición con escala 1, 0.5 y 2, con ratón, táctil y `pen`; repetir con PDF, documento y hoja. **Criterio**: con una nota larga desplazada hasta el final, el asa sigue en la esquina visible y permite agrandar y achicar el panel.

## 2. Rendimiento de notas pesadas
**2.1 Medir primero**: generador reproducible (N1 500 bloques ~100 KB, N2 3 000 ~600 KB, N3 10 000 ~2 MB, con párrafos, listas, tablas, callouts, wikilinks, 30 imágenes de 1–3 MP, 5 dibujos y bloques `query`); medir antes y después apertura, latencia al teclear, fps al desplazar, memoria (heap, nodos DOM, `blob:` vivas) y «Buscar en esta nota», en pestaña y en panel (también dos paneles de la misma nota). Objetivos iniciales: abrir N2 < 1 s; teclear < 50 ms en N2 y < 100 ms en N3; ≥ 50 fps al desplazar N2; memoria estable tras 5 min.
**2.2 Causas probables a verificar**: `renderMarkdown(expandQueries(...))` de todos los bloques en cada render; `setBody` reconstruye el texto en cada tecla; `Html` rehidrata medios por bloque; `FindBar` con `dep={text + mode}`; `snapshot` e `notesIndex.upsert` con el texto completo en cada guardado.
**2.3 Optimizaciones (solo las que la medición justifique)**: renderizar solo lo visible (`content-visibility` + `contain-intrinsic-size` o virtualización) sin romper Buscar, imprimir/exportar, buscador global, esquema ni VoiceOver; HTML por bloque en caché (LRU, ya saneado) y bloques memoizados; consultas `query` solo al cambiar sus datos; no reconstruir el documento en cada tecla (guardado idéntico); índice e historial diferidos; `FindBar` con debounce; imágenes perezosas con `decoding="async"`, sin saltos y revocando `blob:`; dibujos como miniatura hasta tocarlos; una sola copia por nota (pestaña + panel); modo «Ver Markdown» usable o aviso; aviso suave en notas gigantes (> 1.5 MB o > 5 000 bloques) con «Dividir en varias notas» opcional (puede quedar pendiente). **Criterio**: N2 fluida y rápida, N3 usable con aviso, todas las funciones intactas y archivo idéntico.

## 3. Rendimiento de imágenes en paneles del lienzo
**3.1 Causas a verificar**: `ImageView` pone el original completo en `<img>`; Safari lo decodifica entero; el lienzo escala con transformaciones; cada apertura puede crear una `blob:` nueva; límite de memoria de Safari (~16 MP).
**3.2 Optimizaciones**: versión reducida al tamaño mostrado × `devicePixelRatio` (tope ≈ 2 y ≈ 2 560 px) en caché regenerable (`.app/cache/img/…`, nunca en `media/`), original solo al acercar mucho o «Ver original»; zoom y desplazamiento propios con Pointer Events; aviso y versión reducida obligatoria para imágenes enormes; decodificación asíncrona y marcador de carga; capa promovida solo durante el gesto y paneles fuera de pantalla o dormidos sin imagen decodificada (máximo 4 activos); `saveImage` ≤ 2 000 px sin tocar originales ya existentes; revocar `blob:` sin fugas (20 aperturas); pruebas con 2, 12, 24 y 48 MP en JPG y PNG y paneo/zoom con 1, 2 y 4 paneles. **Criterio**: 12 MP en < ~1 s sin congelar, paneo/zoom con 4 paneles ≥ 50 fps, memoria estable, original intacto.

## 4. Pruebas y entrega
Unitarias (caché de HTML, texto guardado idéntico, tamaño de la versión reducida, límites de Safari, revocación de URLs, posición del asa). WebKit: asa, benchmarks N1/N2/N3 e imágenes, buscar e imprimir una nota enorme, exportar `.md`/`.docx`/`.pdf`, misma nota en pestaña y panel, recargar; sin regresiones en `npm test`, `e2e`, `e2e:flows`, `e2e:mejoras`, `e2e:mejoras2`, `e2e:bloquec`, `e2e:p5` y `e2e:phone` (diferencia cero); idiomas y pseudoidioma. Lista manual para iPad real. Entrega: causas reales, cambios, archivos tocados y no tocados, tabla antes/después, optimizaciones descartadas y límites de Safari.
# PROMPT 15: Arreglar el minimapa del lienzo (Espacios)
Debug para Engrama (ya desplegada)

## 0. Contexto y síntoma
En **Espacios** (lienzo infinito), el **minimapa** (mini navegador de la esquina inferior derecha) **no funciona**: no permite moverse por el lienzo.

Antes de escribir código:
1. Lee `CLAUDE.md`, `docs/SPEC.md` (§10d), `docs/DECISIONS.md`, `src/screens/spaces.tsx` (el lienzo: `canvas-wrap`, `canvas-plane`, estado de vista `v`/`setV`/`commit`, `fit`, `front`, `visible`, y el bloque `<div class="minimap …>`) y `src/theme-cristal.css` (`.minimap`, `.canvas-wrap`).
2. Responde con un **plan corto**: causa real, archivos a tocar y riesgos. Espera mi confirmación solo si algo contradice una regla no negociable.

**Reglas estrictas**
- Implementa **únicamente** esto. No refactorices el lienzo ni cambies el paneo, el zoom, los paneles, "Ajustar al contenido" ni el formato de `.app/spaces/<nombre>.json` (cambios retrocompatibles y perezosos).
- Todo texto nuevo por `t()` (es/en/fr; la prueba de claves debe seguir pasando). Tema Cristal: sin color (usa relleno, opacidad y grosor, no tono), objetivos táctiles ≥ 44 px donde aplique, z-index solo con los tokens `--z-*`.
- iPad, iPhone y web no cambian fuera del minimapa (`MODE=compare npm run e2e:phone` con diferencia cero). En `is-phone` el minimapa no aplica (un solo panel a la vez).
- Sin dependencias nuevas. Accesibilidad intacta (teclado, foco, VoiceOver).
- Rama `fix-minimapa`, un commit por punto. No hagas push ni unas a `main` sin mi confirmación. Actualiza `CLAUDE.md` y `docs/DECISIONS.md`; guarda este prompt en `docs/PROMPTS.md`.
- Skills sugeridas: ponytail, webapp-testing (WebKit), superpowers (reproducir primero, luego corregir).

## 1. Causas probables (verifícalas y reporta lo que encuentres)
- **Es solo decorativo**: `<div class="minimap glass" aria-hidden="true">` no tiene ningún manejador de puntero; tocar o arrastrar no navega.
- **Sus eventos suben al lienzo**: el `onPointerDown` de `canvas-wrap` solo ignora lo que viene de `.win`, así que arrastrar sobre el minimapa **hace paneo del lienzo en sentido contrario**.
- **Límites incompletos**: `minX/minY/maxX/maxY` solo cuentan los paneles. Si el usuario se desplaza o aleja más allá de ellos, el **rectángulo de vista (`<b>`) queda fuera** del minimapa (`overflow: hidden`) y desaparece.
- **No reactivo al tamaño**: el rectángulo usa `wrap.current.clientWidth/Height` leídos en el render (no un estado), así que no se actualiza al rotar el iPad, redimensionar la ventana o cambiar Stage Manager.
- **Incluye paneles minimizados**: usa `p.sp.panels` completo, mientras que el lienzo dibuja solo `visible(p.sp)`.
- Posible solapamiento con "Ajustar al contenido" (abajo a la izquierda) o con el asa de redimensionar de un panel.

## 2. Corrección (mínima, reutilizando el sistema de vista existente)
- **Aislar los eventos**: el minimapa detiene `pointerdown/move/up` (o `closest('.minimap')` en el manejador del lienzo); `pointer-events: auto`, `touch-action: none`, `z-index` por encima de paneles y asa, por debajo de modales.
- **Navegación**: tocar un punto centra la vista; arrastrar el rectángulo (o cualquier punto) desplaza el lienzo en el sentido correcto, con `setPointerCapture`, con dedo, ratón y Apple Pencil; el zoom no cambia; al soltar se guarda la vista como el paneo.
- **Límites correctos**: unión de los paneles visibles y del rectángulo de vista con un pequeño margen; `mk` con esos límites; fijos durante el arrastre y suavizados al soltar.
- **Reactividad**: tamaño del contenedor en un estado con `ResizeObserver` sobre `canvas-wrap`.
- **Contenido**: solo paneles visibles; el enfocado con relleno más claro (sin color); tocar un panel lo trae al frente y lo centra (`front` + `commit`).
- **Plegable**: botón para plegar/mostrar; estado por espacio en `.app/spaces/<nombre>.json` como campo opcional (si falta, se muestra). Con 0 o 1 panel no se muestra.
- **Accesibilidad**: sin `aria-hidden`; rol y `aria-label` traducido ("Minimapa del lienzo"); flechas desplazan la vista e Intro centra el panel enfocado; tooltip y foco visible.
- **Rendimiento**: DOM ligero (`<i>` y `<b>`), sin `canvas` global; cajas de paneles memoizadas por posición y tamaño.

## 3. Pruebas
- **Unitarias**: límites y escala (unión con la vista; 0, 1 y N paneles; panel enorme; coordenadas negativas) y conversión minimapa ↔ lienzo con zoom entre 0.2 y 3.
- **WebKit (Playwright)** con 6 paneles y con dedo, ratón y `pointerType: 'pen'`: 1) tocar una esquina centra la vista; 2) arrastrar el rectángulo mueve el lienzo en el sentido correcto; 3) el rectángulo sigue visible tras desplazarse muy lejos y con el zoom al mínimo; 4) sin paneo inverso; 5) tocar un panel lo trae al frente y lo centra; 6) rotar o redimensionar actualiza el rectángulo; 7) los minimizados no aparecen; 8) pellizco, rueda y "Ajustar al contenido" siguen funcionando; 9) la vista y el plegado se conservan al recargar.
- **Regresión**: `npm test`, `e2e`, `e2e:bloquec` y `e2e:phone` (diferencia cero); "sin color" y legibilidad; tres idiomas y pseudoidioma (+40 %).
- **Verificación manual en iPad real**: dedo y Apple Pencil, 6+ paneles, vertical y horizontal.

## 4. Entrega
Resumen corto: causas reales, qué cambió, archivos tocados y no tocados, y límites de Safari.

**Criterio de aceptación**: tocar o arrastrar el minimapa mueve la vista del lienzo de forma predecible, el rectángulo de vista nunca desaparece y no hay paneo inverso.

---

# PROMPT NOTAS-PRO (v2) · Fotos con posición y tamaño + add-ons de notas tipo Obsidian
Versión mejorada. Mismo alcance que el original, con orden de ejecución, puntos de control, dependencias corregidas y salvaguardas de datos, memoria y tamaño.

## 0. Lectura previa y reglas
Lee primero `CLAUDE.md`, `docs/SPEC.md` (§4 Markdown extendido, §9 Add-ons, §10), `docs/DECISIONS.md` y `docs/PROMPTS.md`. Todas las «Reglas no negociables» de `CLAUDE.md` siguen vigentes. Trabaja en la rama **`notas-pro`** desde `main`; **no unas a `main` sin mi confirmación**.

**Antes de escribir código, verifica y reporta en un plan corto (≤ 25 líneas):**
1. **Qué ya existe** (busca en `src/screens/notes.tsx`, `src/notes/`, `src/lib/query.ts`, `src/lib/frontmatter.ts`, `src/lib/links.ts`, `src/md/render.ts`, `src/ui/md.tsx`) y se reutiliza: pestaña «Esquema», plantillas, notas diarias (`notes/Diario/AAAA-MM-DD.md`), grafo, historial, papelera, `expandQueries`, `NoteStore`. Si algo ya está, no lo dupliques.
2. **Referencias que podrían no existir en mi rama**: este prompt menciona `src/ui/pressdrag.tsx`, el script `e2e:perf`, el contador `?perf` y las pruebas `e2e:*`. **Compruébalo**: si falta algo, **no lo inventes**; di cuál falta y propón la alternativa mínima (por ejemplo, usar Pointer Events ya existentes para la pulsación larga).
3. **Otros prompts míos que pueden estar pendientes** y tocan lo mismo: *Notas con solo título obligatorio* (materia/tema opcionales), *Mover mazos y notas*, *Rendimiento de notas e imágenes en el lienzo y minimapa*, *Importación `.apkg`*. Revisa `docs/PROMPTS.md` y las ramas; **no pises** ni dupliques su trabajo (ver sección 6, «Compatibilidad»).

**Reglas específicas**
- Cada función nueva de notas (Fases B–J) es un **módulo en `MODULES()`** de `src/screens/addons.tsx` (id, nombre, versión, descripción, hooks), **apagado por defecto** (`defaultOn: false`), que **no modifica mis archivos** al activarse ni desactivarse. **Apagado = cero costo**: su código se carga con `import()` solo al activarlo (no entra al paquete inicial) y no registra listeners, índices ni atajos. Fase A **no es add-on**: es del núcleo del editor.
- Todo texto por `t()`/`tn()` con claves en `es.json`, `en.json` y `fr.json` (la prueba de claves debe seguir pasando). Nunca se traducen formatos de archivo.
- **Sin red en tiempo de ejecución.** Librerías pesadas (KaTeX, Mermaid) solo con `import()` bajo demanda, **empaquetadas** (sin CDN), verificando la CSP de `index.html`, la licencia (MIT/Apache/BSD/ISC) y el peso.
- Escrituras siempre por `SafeVault`; si una nota está abierta, **por `NoteStore`** (un solo documento en memoria, sin pisar lo que se escribe). Formatos retrocompatibles y perezosos: **no reescribir notas existentes** sin que el usuario edite.
- Objetivos táctiles ≥ 44 px, inputs ≥ 16 px, sin color en la interfaz salvo el acento, flotantes por `src/ui/overlay.tsx`, z-index solo con `--z-*`, teléfono solo bajo `html.is-phone`. `MODE=compare npm run e2e:phone` debe seguir dando **0 píxeles** en iPad y web.
- **Código mínimo** (ponytail): reutiliza antes de construir y no añadas dependencias sin justificarlas. **Presupuesto de tamaño**: el paquete inicial (sin `import()`) no crece más de **~10 KB gzip** en total; reporta el tamaño antes y después de cada fase.
- Las pruebas nuevas se agrupan en `npm run e2e:notaspro` (no uses un número de prompt en el nombre).

## 1. Orden de ejecución y puntos de control
Trabaja **por paquetes** y, al terminar cada uno, **resume y espera mi prueba en dispositivo real** antes de seguir. Un commit pequeño por fase.

| Paquete | Fases | Por qué en este orden |
|---|---|---|
| **1** | **A** (fotos) | Es del núcleo y la de mayor riesgo para los datos. Se prueba primero en iPad (memoria con fotos de 12 MP). |
| **2** | **I1** (fechas en lenguaje natural) → **B** (tareas) → **C** (consultas) → **I2** (navegación) | **B y D dependen del analizador de fechas** de I; por eso se construye primero. |
| **3** | **D** (periódicas) → **H** (plantillas) → **G** (etiquetas) → **J** (linter) → **E** (vista previa) | De menos a más riesgo para los archivos; G y J modifican muchas notas y van tarde. |
| **4** | **F** (fórmulas y diagramas) → **K** (mapas mentales y diagramas visuales) | F es la más pesada (runtime y CSP). K reutiliza lo que F deja listo (bloques cercados, carga bajo demanda, exportar SVG→PNG) y va al final. |

---

## Fase A · Fotos: original guardado, miniatura ligera y acomodo libre

### A1. Guardar el original y mostrar una miniatura
Hoy `saveImage` (`src/notes/images.ts`) solo conserva el archivo tal cual cuando mide ≤ 2000 px y es PNG/JPEG/WebP/GIF; en cualquier otro caso lo reduce a 2000 px y lo recomprime a JPEG 0.88 (el original se pierde y no puede salir original al exportar). Además `mediaUrl` (`src/ui/background.tsx`) carga todos los bytes en un Blob, y eso pesa con muchas fotos.
- `saveImage` guarda **el archivo original byte por byte** en `media/<id>.<ext>` (incluye HEIC y cualquier formato; sin recomprimir ni decodificar para guardar: **no uses `createImageBitmap` sobre el original solo para guardarlo**).
- **Miniatura** (lado mayor ~1200 px, JPEG ~0.7) en `.app/thumbs/<id>.jpg`: **caché reconstruible** (si falta se regenera al verla; si se borra la carpeta, nada se pierde). Usa `createImageBitmap(file, { resizeWidth, resizeHeight })` y **verifica si Safari lo soporta** en mi versión; si no, o si falla, cae a un canvas con tope de tamaño por pasos; si tampoco, muestra el original (con aviso suave si es enorme). Genera las miniaturas **de una en una** y fuera del hilo de la interfaz cuando sea posible (Worker/`OffscreenCanvas`).
- **Formatos que el navegador no decodifica** (p. ej. HEIC en Chrome/Windows/Electron): se guarda el original igual, y la miniatura muestra un marcador con el nombre del archivo y la opción de abrirlo; no es un error.
- Un solo módulo `mediaThumbUrl(vault, path)` lo usan el editor, la vista de nota, los paneles de Espacios y el buscador, con carga **perezosa** (`IntersectionObserver`) y **revocación** de los Blob URL que ya no se usen. **Si ya existe (o llegará) otra caché de miniaturas** (p. ej. `.app/cache/img/`), **usa una sola ubicación y una sola función**; elige `.app/thumbs/` y deja anotado en `DECISIONS.md`.
- **Almacenamiento**: guardar originales aumenta el uso (una foto de 12 MP ≈ 3–6 MB). Añade en Ajustes → Almacenamiento: tamaño de `media/` y de `.app/thumbs/` (caché, con «Vaciar») y un ajuste **«Calidad de las fotos: Original (por defecto) / Optimizada (máx. 2000 px)»**, que **no** afecta a las ya guardadas. Aviso suave si `navigator.storage.estimate()` supera el 80 %.
- Imágenes guardadas antes (ya comprimidas): sin migración; si miden más de ~1 MB se genera su miniatura al verlas.
- Todas las llamadas a `saveImage` (Bandeja, Espacios, editor de exámenes, pegar/arrastrar, Plaud) guardan el original y muestran miniatura.

### A2. Exportar siempre el original
- **`.md` + zip** (`prep('md')`): entra el **original**, no la miniatura (`.app/thumbs/` **nunca** va en el zip de notas; en la exportación de la bóveda se excluye por ser caché).
- **`.docx`** (`src/notes/io.ts`, `ImageRun`): usa el original. **No estires**: añade `imageSize(bytes)` (ancho/alto del encabezado: PNG IHDR, JPEG SOF; GIF y WebP si es simple) y respeta el `|ancho` de la nota y la proporción real. **Excepción necesaria**: Word no incrusta de forma fiable **HEIC ni WebP**; para esos, el `.docx` (y el PDF) usan una **conversión a JPEG/PNG hecha solo al exportar**, y el `.md`/zip siguen llevando el original. Avisa en el informe de exportación qué imágenes se convirtieron.
- **PDF / imprimir** (`print-only`, `beforeprint`): sustituir la miniatura por el original (o la versión convertida) y **esperar a que carguen** antes de imprimir; cárgalas **de una en una** para cuidar la memoria con muchas fotos grandes.
- **Prueba**: en `.docx` y zip, el archivo de imagen es **idéntico byte a byte** al de `media/` (salvo las convertidas, que se listan).

### A3. Sintaxis de tamaño y posición
Extiende `![[foto.jpg|300]]` (ya existe `|ancho`) a un formato retrocompatible, con `|` entre opciones y **orden libre**:
```
![[foto.jpg]]                 natural (ajustada al ancho de la nota), sin cambio
![[foto.jpg|300]]             ancho 300 px (comportamiento actual)
![[foto.jpg|40%]]             40 % del ancho de la nota
![[foto.jpg|300|izq]]         izquierda; el texto fluye a la derecha
![[foto.jpg|300|der]]         derecha; el texto fluye a la izquierda
![[foto.jpg|50%|centro]]      centrada, sin texto a los lados
```
- Alias `left|right|center`. Un valor desconocido se ignora **sin romper la nota** y se conserva literal al guardar.
- En `src/md/render.ts`, el `<img>` lleva `data-w` y `data-align`. **Valida** el ancho (número finito; px entre 40 y 4000; % entre 5 y 100) y la alineación (lista cerrada) antes de generar HTML. **Añade `data-w` y `data-align` a la lista permitida de DOMPurify** (`ADD_ATTR`, hoy solo incluye `data-media`, `data-wl`, `data-kind`, `target`) y prueba que **ningún otro atributo ni `style` inline** pasa.
- CSS en `src/theme-cristal.css`: `.md img[data-align=izq]` flota a la izquierda con margen; `der` a la derecha; `centro` en bloque centrado. `.md` usa `display: flow-root`. Títulos, tablas, bloques de código y callouts **limpian** el flotado. En `html.is-phone` y en anchos < 480 px las flotadas pasan a ancho completo y centradas. Dentro de **paneles de lienzo estrechos**, lo mismo.
- **Texto al lado**: un embed al **inicio de un párrafo** hace que ese texto fluya junto a la imagen (`![[foto.jpg|240|izq]] Texto…`). Permite embeds al inicio de un bloque de texto **sin romper** `splitBlocks`, la búsqueda, la cobertura de párrafos de las tarjetas ni el **«Buscar en esta nota»**; y que la altura de bloque siga siendo estable (reserva `width`/`height` o `aspect-ratio` para que el desplazamiento no salte).

### A4. Controles en el editor
- Al tocar una imagen en vista de documento aparece una **barra flotante** (por `overlay.tsx`): **Izquierda · Centro · Derecha**; tamaño **S / M / L / ancho completo**; y un **asa de arrastre** en la esquina para cambiar el tamaño con dedo o Pencil (mín. 80 px, máx. el ancho de la nota; `setPointerCapture`; `touch-action: none` solo en el asa). Al soltar, **reescribe el embed en el Markdown** (un solo cambio en el historial, con ⌘Z).
- Acción **«Texto al lado»**: con izquierda o derecha, mueve el embed al inicio del párrafo siguiente (o crea uno) y abre el cursor ahí.
- `/imagen` del menú «/», pegar y arrastrar usan el nuevo guardado; tras insertar, la barra aparece lista para elegir lugar y tamaño.
- Accesibilidad: cada control con `aria-label`; operable con teclado (flechas = tamaño; ⌘⇧L/E/R opcional según `src/lib/keys.ts`, sin chocar con atajos existentes) y **texto alternativo editable** (se guarda como `![[foto.jpg|300|izq|alt texto]]` **solo si se edita**; define y documenta la regla para que un `|` en el alt no rompa el formato).

### A5. Criterios de aceptación
- Insertar una foto de **12 MP** no sube la memoria de forma notable ni cierra Safari; **30 fotos** en una nota se desplazan con fluidez (mide con `?perf` si existe, o con una medición propia reportada).
- Cerrar y reabrir conserva posiciones y tamaños (están en el `.md`).
- Exportar `.md`/`.docx`/PDF: foto original (o la conversión listada), misma posición y tamaño relativo.
- Abrir el `.md` en un editor de texto: legible, sin pérdida.
- **Nada existente cambia**: las notas con imágenes ya guardadas se ven igual.

---

## Fase I1 · Fechas en lenguaje natural (función pura; la usan B y D)
- `src/lib/` (función pura con pruebas): `hoy`, `mañana`, `pasado mañana`, `el lunes`, `próximo viernes`, `en 3 días`, `15 de diciembre` → fecha ISO, con **corte de día a las 4:00**, zona horaria del dispositivo y primer día de la semana de los ajustes. Reconocimiento en **es** (obligatorio); deja la estructura lista para en/fr sin implementarlos ahora. Entrada ambigua o no reconocida → `null` (nunca adivinar). Casos: fin de año, 29 de febrero, horario de verano.

## Fase B · Tareas agregadas (módulo `tasks`)
- Lee todos los `- [ ]` / `- [x]` de `notes/**` y muestra una vista con filtros: pendientes/hechas, materia/tema, nota de origen y **vencimiento**.
- **Rendimiento**: no leas todas las notas en cada apertura. Mantén un **índice de tareas como caché reconstruible** (`.app/cache/tasks.json`), actualizado al guardar cada nota (`onNoteSaved`) y reconstruible desde los archivos; carga diferida de la vista.
- Vencimiento en el propio texto: `- [ ] Repasar ECG 📅 2026-11-20` o `[vence:: 2026-11-20]`; reconoce las expresiones de I1. Agrupa en **Vencidas / Hoy / Esta semana / Sin fecha**.
- Tocar una tarea abre su nota **en ese párrafo**. Marcarla desde la vista **edita el archivo** (la casilla en la nota) **por `NoteStore`/`SafeVault`**, sin duplicar estado, y **sin romper** el texto si la nota cambió entre tanto (si la línea ya no coincide, no escribas y avisa).
- Integración opcional: tareas con fecha en la capa de Calendario y en «Pendientes» de Hoy (hook `renderDashboardTile`). Funciona con notas **sin materia ni tema**.

## Fase C · Consultas tipo Dataview (módulo `note-queries`)
- Reutiliza el motor de `src/lib/query.ts` y `expandQueries` (`notes.tsx`). Bloque en una nota (cercado con tres comillas invertidas y la etiqueta `consulta`):
```
lista notas donde materia:Cardiología sin:tarjetas
tabla titulo, materia, modificada donde tag:ecg orden:modificada
```
- Campos: `materia`, `tema`, `tag`, `titulo`, propiedades del frontmatter, `modificada`, `tarjetas` (cobertura), `enlaces`. Operadores simples (`:`, `<`, `>`, `sin:`).
- **Solo lectura, calculado al renderizar** (nada duplicado en disco). Resultados con **tope** (p. ej. 200 filas con «ver más») y **caché por nota** invalidada al cambiar los datos de entrada, para no recalcular en cada tecla. Errores de sintaxis → aviso legible, **nunca rompen la nota**. Sin `eval` ni código arbitrario; todo HTML por DOMPurify.

## Fase I2 · Navegación (módulo `nav-tools`)
- **Recientes**: últimas notas abiertas (persistidas en `.app/`), en el explorador y en ⌘K.
- **Nota de inicio**: elegir la nota que se abre al entrar a Notas.
- Si el «Esquema» ya cubre el TOC, solo verifica que salte a la sección (no lo rehagas).

## Fase D · Notas periódicas (módulo `periodic-notes`)
- Además de `notes/Diario/AAAA-MM-DD.md`: semanal (`notes/Semanal/AAAA-Wnn.md`, **semana ISO 8601**, cambio de año correcto), mensual (`notes/Mensual/AAAA-MM.md`) y de **semestre** (`notes/Semestre/AAAA-n.md`, fechas configurables).
- Cada tipo con su plantilla de `templates/` y botones «Hoy / Esta semana / Este mes» en Notas; navegación anterior/siguiente. Se crean **solo al pedirlas**.
- La semanal puede **precargar** (como texto editable, nunca automático) los exámenes de esa semana (`exams/*.md`) y las tareas vencidas (de B, si está activo). Corte de día a las 4:00.

## Fase H · Plantillas con variables y captura rápida (módulo `quick-capture`)
- Botón «Nota nueva con plantilla» (también en el menú «/»). Variables en `templates/*.md`: `{{fecha}}`, `{{hora}}`, `{{titulo}}`, `{{materia}}`, `{{tema}}`, `{{semana}}`, `{{semestre}}`, `{{cursor}}`. Se expanden **al crear**, no después; variables desconocidas se dejan literales; las plantillas existentes siguen funcionando. Sin ejecución de código.
- Captura de un toque: título + materia/tema recordados de la última nota → crea y abre el editor. **Materia y tema son opcionales** (si faltan, la nota queda sin clasificar y las variables vacías no dejan texto sobrante).

## Fase G · Gestor de etiquetas (módulo `tag-manager`)
- Lista de etiquetas de **notas** con conteo (inspecciona dónde se guardan hoy: frontmatter `tags`, `#etiqueta` en texto, o ambos), con jerarquía `padre/hijo`. No toques etiquetas dentro de bloques de código ni de texto que no sea una etiqueta real.
- **Renombrar** y **fusionar** en todas las notas, con **vista previa** (qué archivos cambian y cuántas veces) y **confirmación**. Aplica **en lote como una sola operación** (diario de `SafeVault`): si falla a la mitad, se recupera sin dejar notas a medias; guarda una **versión en el historial** de cada nota para **deshacer**. Nunca cambiar nada sin confirmar.

## Fase J · Linter de notas (módulo `note-linter`)
- Normaliza **bajo demanda** (botón en la nota y «revisar toda la materia»), **nunca automáticamente**: espacios, saltos de línea, encabezados, listas, frontmatter ordenado y claves conocidas, `![[ ]]` bien formados. **No modifica** el contenido de bloques de código, de `consulta`/`mermaid`/fórmulas ni **claves desconocidas** del frontmatter.
- Siempre muestra un **diff previo** y pide confirmar; guarda versión en el historial para deshacer. Opción de aplicar solo a notas importadas de Plaud/Word. **Idempotente**: aplicarlo dos veces no cambia nada.
- La comprobación de integridad sigue **solo reportando**; el linter es una acción distinta y explícita.

## Fase E · Vista previa al pasar sobre un enlace (módulo `link-preview`)
- Ratón: hover con retraso breve. iPad/teléfono: **pulsación larga** sobre `[[enlace]]` (usa `src/ui/pressdrag.tsx` **si existe**; si no, Pointer Events con temporizador de ~500 ms); el toque normal sigue navegando.
- Vista previa por `overlay.tsx` con el inicio de la nota, botón «Abrir» y, si procede, «Editar aquí» (mismo documento de `NoteStore`, no una copia). Cierra con Escape o tocando fuera. Teclado: accesible con foco y Enter.

## Fase F · Fórmulas y diagramas (módulo `math-diagrams`)
- **Fórmulas**: `$…$` en línea y `$$…$$` en bloque con **KaTeX bajo demanda**, con fuentes **incluidas en el build** (sin CDN). Si falla, se muestra el texto original. Un `$` suelto (precios, «5 $») **no** debe activarse: define y documenta la regla.
- **Diagramas**: bloque ```` ```mermaid ````. Mermaid es pesado: carga **solo al abrir una nota con ese bloque**; verifica que **no exige relajar la CSP** (`script-src 'self'`, sin `unsafe-eval`) y su peso. **Si no cabe sin relajar la CSP o es demasiado pesado, no lo uses**: implementa un renderizador mínimo propio de flujogramas (`A --> B`) y dímelo en el resumen. **Si ya construiste la Fase K, no hagas dos renderizadores: los flujogramas usan el de K.**
- **Offline**: comprueba (modo avión) que los fragmentos dinámicos y las fuentes quedan en la caché del service worker (la lista de `sw.js` se genera desde el build).
- **Exportar**: `.md` conserva el texto fuente; `.docx`/PDF muestran fórmula o diagrama como imagen (SVG→PNG al exportar). Si no se puede, deja el texto fuente con aviso.

---

## Fase K · Mapas mentales y diagramas dentro de las notas (módulo `mind-maps`)
Quiero **hacer mapas mentales en Notas** (una caja central con ramas, cajitas que se agregan y se mueven) y **diagramas** (cajas conectadas con flechas), **sin perder el estilo gráfico de la app** (tema Cristal). Debe sentirse parte de la interfaz, no un widget pegado.

### K1. Formato: texto legible dentro del `.md` (la nota sigue siendo la fuente de verdad)
Dos bloques cercados con tres comillas invertidas, **texto plano legible en cualquier editor** (nada de JSON ni imágenes incrustadas):
````
```mapa
Cardiología
- Anatomía
  - Cámaras
  - Válvulas
- Fisiología
  - Ciclo cardiaco
```
````
````
```diagrama
[Inicio] --> [Triaje]
[Triaje] --> {¿Inestable?}
{¿Inestable?} -- sí --> [Reanimación]
{¿Inestable?} -- no --> (Observación)
```
````
- `mapa`: árbol por **sangría** (la primera línea es la caja central). Opcional por nodo, al final de la línea y solo si se movió a mano: `{x=120,y=-40}`; **sin esa marca, el acomodo es automático**. Los enlaces `[[nota]]` dentro de un nodo siguen funcionando.
- `diagrama`: nodos `[rectángulo]`, `(redondeado)`, `{decisión}`; flechas `-->` con etiqueta opcional `-- texto -->`; acomodo automático por capas.
- Retrocompatible y perezoso: **no se reescribe ninguna nota** hasta que el usuario edite. Línea desconocida o mal formada → se ignora **sin romper la nota** y se conserva literal al guardar. Define y documenta la gramática en `docs/SPEC.md` y en `DECISIONS.md`.

### K2. Estilo gráfico (tema Cristal, sin color)
- **Sin color en la interfaz**: la jerarquía se hace con **relleno, tamaño, grosor y trazo**, no con tono. Caja central: más grande, relleno invertido (`--inverse-bg`/`--inverse-fg`, como `btn primary`). Nivel 1: relleno `--fill` y borde `--border-strong`. Niveles siguientes: más pequeños y finos. Conectores: curvas suaves con trazo `--border-strong` que **se adelgaza** por nivel. Decisión en diagramas: forma distinta (rombo/píldora), no color. El **acento** (croma ≤ 5 %) solo para el nodo seleccionado y el foco.
- El contenedor del mapa es **una sola superficie `.glass`**; **los nodos NO llevan `backdrop-filter`** (cada uno sería un desenfoque más y rompería el presupuesto de rendimiento): relleno translúcido plano. Todo con variables CSS del tema, de modo que **claro, oscuro y modo ligero** funcionen solos y cumplan contraste (texto ≥ 4.5:1, bordes ≥ 3:1 en los 5 fondos de prueba).
- Tipografía y radios de la app, sin SF Symbols ni marcas de Apple. Iconos de `lucide-preact`. Animaciones solo `opacity`/`transform` y apagadas con `prefers-reduced-motion`.
- Se renderiza **como componente de Preact** (nodos en HTML + un solo `<svg>` para las líneas), **no** como HTML pasado por DOMPurify con `style` inline: el texto de los nodos entra como texto plano (nunca como HTML) y no se relaja la CSP ni la lista de atributos permitidos.

### K3. Edición visual (además del texto)
- Menú «/» → «Mapa mental» y «Diagrama»; crea un bloque con una caja central lista para escribir. Botón «Editar como texto» siempre disponible (la otra vista del mismo bloque).
- Toque en un nodo = seleccionar; **barra flotante** (por `overlay.tsx`) con: **hijo**, **hermano**, **renombrar**, **eliminar** (con confirmación si tiene ramas), **plegar/desplegar**. Doble toque o Intro = renombrar en el sitio. **Arrastrar un nodo** a otro lo reubica como su hijo; arrastrarlo al espacio libre guarda su posición (`{x,y}`). En diagramas: arrastrar desde el asa de un nodo a otro crea la flecha; tocar una flecha permite etiquetarla o borrarla.
- Cada cambio **reescribe el texto del bloque** en el Markdown por **`NoteStore`** (un solo cambio en el historial, ⌘Z funciona) y **nunca duplica estado** aparte del texto.
- **Paneo y zoom** dentro del bloque (dos dedos / rueda), botón «Ajustar», sin capturar el desplazamiento de la nota cuando el gesto no empieza en el mapa (`touch-action: none` solo dentro del lienzo del mapa).
- **Accesibilidad**: el árbol es **navegable con teclado** (flechas; Tab = hijo, Intro = hermano, Supr = eliminar, Espacio = plegar), con `role="tree"`/`treeitem`, `aria-label` traducido por nodo y una **alternativa de texto** (el bloque como lista con sangría) para VoiceOver. Objetivos táctiles ≥ 44 px, inputs ≥ 16 px.
- **iPhone** (`html.is-phone`): el mapa se ve y se edita con toques simples (sin arrastre libre); se puede abrir a **pantalla completa** por `overlay.tsx`.

### K4. Rendimiento y límites
- Carga bajo demanda con `import()` **solo al abrir una nota con un bloque `mapa`/`diagrama`** o al insertar uno (apagado = cero costo, igual que el resto). **Sin librerías nuevas** (nada de d3, Mermaid ni dagre): acomodo propio simple (árbol radial/horizontal y capas); **≤ ~8 KB gzip** cargados bajo demanda.
- Renderiza solo si el bloque está cerca de la pantalla (`IntersectionObserver`); mientras no, muestra un marcador con la altura reservada. **Tope** de ~200 nodos por bloque (aviso legible si se pasa; no se rompe nada). El acomodo se **memoriza** por contenido y no se recalcula en cada tecla ni en cada fotograma de arrastre.
- Sin `eval` ni código arbitrario.

### K5. Integración y exportación
- **Búsqueda y «Buscar en esta nota»** indexan el texto de los nodos. Dentro del **lienzo de Espacios**, un panel de nota muestra el mapa en vista de lectura (con su propio «Ajustar»).
- **Exportar**: `.md` conserva el **texto fuente**; `.docx`/PDF/imprimir muestran el mapa como **imagen** (SVG→PNG al exportar, en **tema claro fijo** con colores resueltos, no variables CSS, y a buena resolución). Botón «Exportar mapa» como **PNG/SVG** suelto. Si no se puede renderizar, deja el texto fuente con aviso.
- **No** crea tarjetas ni llama a ninguna IA solos. (Idea futura, fuera de alcance: convertir una rama en tarjetas **con revisión humana**.)

### K6. Criterios de aceptación
- Crear un mapa desde «/», agregar 10 cajitas, mover una rama, plegarla, cerrar y reabrir: todo queda **como texto** en el `.md` y se ve igual.
- Abrir el `.md` en un editor de texto: se entiende sin pérdida.
- El mapa **se ve nativo** (Cristal, sin color) en claro, oscuro y modo ligero, en iPad, web y iPhone; `MODE=compare npm run e2e:phone` sigue en **0 píxeles** fuera de los mapas, y la prueba de «sin color» (croma ≤ 5 %) pasa.
- Un bloque mal formado no rompe la nota. Módulo apagado = no se carga su código.

---

## 6. Compatibilidad con otros cambios míos
- **Notas sin materia/tema** (si ya se implementó «solo título obligatorio»): B, C, D, G, H y J deben funcionar con notas en `notes/<Título>.md` y en `notes/<Materia>/<Título>.md`.
- **Mover notas**: los embeds, consultas y etiquetas siguen válidos tras mover; no uses rutas absolutas dentro del texto de la nota.
- **Rendimiento de notas e imágenes en el lienzo** (si ya se implementó): reutiliza su caché de HTML por bloque y su carga diferida; las imágenes flotantes no deben romper la virtualización (`content-visibility`) ni el cálculo de alturas.
- **Importación `.apkg`**: las imágenes de los mazos importados van a `media/` como hoy; no las reprocesas con A1.

## 7. Pruebas y entrega
- **Vitest** (`tests/`): `imageSize` (PNG, JPEG, GIF, WebP, archivo corrupto), analizador de `|ancho|alineación|alt` (orden libre, valores inválidos, `%`), regeneración de miniaturas, export con bytes idénticos (y lista de convertidas), sanitización (`data-w`/`data-align` permitidos, nada más), fechas (todos los casos de I1), tareas y su índice, consultas (errores y tope), notas periódicas (semana ISO, cambio de año, corte 4:00), renombrar/fusionar etiquetas (con deshacer), variables de plantilla, linter idempotente, **gramática de `mapa`/`diagrama` (ida y vuelta texto → modelo → texto idéntico, líneas inválidas, sangrías mixtas, tope de nodos, acomodo estable)**.
- **E2E** `npm run e2e:notaspro`: foto grande → izquierda con texto al lado → redimensionar → exportar → verificar original; tareas con vencimiento; consulta; nota semanal; pulsación larga sobre enlace; fórmula y diagrama; **mapa mental: crear, agregar cajitas, mover, plegar, exportar a `.docx`/PNG y verificar que el `.md` solo tiene texto**; plantilla con variables; **módulo apagado = no se carga su código** (comprueba las peticiones de fragmentos).
- Ejecuta toda la batería de `CLAUDE.md` (incluye `e2e:phone` con `MODE=compare` = 0 píxeles, `e2e:design` y, si existe, `e2e:perf`) y `npm run build`; reporta el **tamaño del paquete antes y después**.
- Actualiza `CLAUDE.md` («Fase actual», mapa del código), `docs/DECISIONS.md` (miniaturas como caché, sintaxis de imagen, ajuste de calidad, conversiones al exportar, por qué KaTeX/Mermaid bajo demanda, formato `mapa`/`diagrama` como texto y renderizador propio en lugar de librerías) y `docs/PROMPTS.md`.
- Al terminar **cada paquete**, dime: qué reutilizaste y qué construiste, decisiones tomadas, qué **no** pudiste verificar sin un iPad real (Pencil, pulsación larga, memoria con fotos de 12 MP), tamaño del paquete, y qué quedó fuera.
- Commits pequeños por fase, todos en `notas-pro`.

---

# PROMPT 17: Barra de herramientas del editor de notas (formato, tablas, imágenes, listas, orden)

## 0. Objetivo
En **Notas**, una **barra de menú fija** encima del documento que se está editando, para dar formato sin escribir Markdown a mano: **negrita, cursiva, subrayado, tachado, resaltado, color, tamaño de letra, títulos, listas, tareas, citas, tablas, imágenes (con lugar y tamaño), enlaces, alineación de párrafo, mover párrafos, deshacer/rehacer**, etc. Todo sigue guardándose como **Markdown legible** en el `.md` (la nota es la fuente de verdad) y **se ve nativo en el tema Cristal**.

## 1. Lectura previa (y plan corto antes de escribir código)
Lee `CLAUDE.md`, `docs/SPEC.md` (§4 Markdown extendido), `docs/DESIGN.md`, `docs/DECISIONS.md`, `src/screens/notes.tsx`, `src/md/render.ts`, `src/ui/md.tsx`, `src/ui/overlay.tsx`, `src/lib/keys.ts`, `src/notes/store.ts`, `src/notes/images.ts`.

**Lo que ya existe (reutilízalo, no lo dupliques)** en `notes.tsx`:
- El editor es **por bloques**: `BlockInput` (un `<textarea>` por bloque) con modo `doc`/`md`; `splitBlocks`; `NoteStore` (un solo documento en memoria).
- Una **barra flotante de formato que solo aparece al seleccionar texto** (`role="toolbar"`, `aria-label` «Formato»): negrita (`wrap('**')`), resaltar (`==`), color (`[x]{.azul}`), enlazar a nota (`[[ ]]`), crear cloze/básica.
- El menú «/» (`SLASH()`): títulos, listas, tarea, tabla, cita, callout, imagen, dibujo, cuaderno, tarjeta, código, enlace.
- `insertAtCursor` (imagen, HTML→Markdown pegado, enlace por URL).

**Responde con un plan de ≤ 25 líneas**: qué se reutiliza, qué se construye, cómo se opera sobre el bloque activo, y qué referencias de este prompt no existen en la rama (**no las inventes**). Revisa también `docs/PROMPTS.md` y las ramas: los prompts **Notas Pro (Fase A: fotos con `|ancho|alineación`, Fase K: mapas mentales)** y **Notas con solo título obligatorio** pueden tocar lo mismo. **No dupliques**: esta barra solo **llama** a esa lógica cuando exista (ver §5).

## 2. Reglas estrictas
- Rama **`barra-editor`** desde `main`. Un commit pequeño por punto. **No unas a `main` ni hagas push sin mi confirmación.**
- **Formatos retrocompatibles y perezosos**: no se reescribe ninguna nota hasta que el usuario edite. Todo lo nuevo se guarda como Markdown/sintaxis que se lea bien en cualquier editor de texto; nada de HTML crudo ni estilos en línea.
- **Escrituras por `NoteStore`/`SafeVault`**, un cambio = una entrada de historial (⌘Z/⌘⇧Z funcionan); nunca estado duplicado fuera del texto.
- Texto de interfaz por `t()`/`tn()` (es/en/fr; la prueba de claves debe seguir pasando; se prueba también el pseudo-idioma +40 %). Nunca se traducen formatos de archivo.
- **Tema Cristal, sin color en la interfaz** (croma ≤ 5 %): la barra va **dentro de una superficie `.glass`**; botones con relleno/borde/estado activo por **opacidad y relleno invertido**, no por tono. Solo iconos de `lucide-preact` (sin SF Symbols). Botones solo-icono con `aria-label` (sin `title`); flotantes por `src/ui/overlay.tsx` y z-index con `--z-*`.
- Objetivos táctiles ≥ 44 px, inputs ≥ 16 px. Teléfono solo bajo `html.is-phone`. **iPad y web no cambian fuera de la barra**: `MODE=compare npm run e2e:phone` = **0 píxeles** salvo el área de la barra (documenta la diferencia esperada).
- Contenido del usuario con `data-user-content`; todo HTML por DOMPurify. Si agregas atributos o clases nuevas al render, agrégalas **a la lista permitida** y **prueba que nada más pasa** (ni `style` en línea).
- Sin dependencias nuevas. Código mínimo (ponytail) sin recortar accesibilidad ni escritura segura.
- Skills sugeridas: ponytail, webapp-testing (WebKit), frontend-design (Cristal), superpowers.

## 3. La barra
**Ubicación y permanencia (requisito clave): la barra es ESTÁTICA y nunca desaparece mientras haya una nota abierta.**
- Es **parte fija del editor**, anclada arriba (`position: sticky; top: 0`) **dentro del área de la nota**, no un flotante que aparece y se esconde. **No** se oculta al desplazarse, al perder el foco, al cerrar el teclado, al salir de la edición de un bloque, al cambiar entre `doc` y `md`, ni al abrir paneles laterales (Esquema, Enlaces, Propiedades, Grafo, Tarjetas).
- **Botón «Plegar/Desplegar barra»** (icono de chevron, `aria-label` y `aria-expanded`), **siempre visible en un extremo de la barra**. Plegar **no la oculta**: la reduce a una **franja fina y fija** (≥ 44 px de alto táctil, o ~28 px con ratón) que conserva el botón de desplegar, **deshacer/rehacer** y **negrita**, y se queda anclada en el mismo sitio. Así nunca desaparece del todo. Estado **plegado/desplegado recordado** (en ajustes de la interfaz, por dispositivo; por defecto **desplegada**), con atajo (p. ej. ⌘⇧T si está libre). Plegar y desplegar **no mueve el texto** de forma brusca (mantén la posición de lectura) y se anima solo con `opacity`/`transform`, apagado con `prefers-reduced-motion`. En iPhone y en paneles estrechos de Espacios, por defecto **plegada** si el espacio es muy corto.
- **Sin selección o sin bloque en edición, los botones se quedan visibles pero desactivados** (`disabled`, 38 % de opacidad, estado legible), nunca se esconden. Así su lugar y tamaño no cambian y el documento **no salta** de posición.
- Debe verse en **todos los contextos donde se edita una nota**: pestaña de Notas, nota en panel de Espacios (versión compacta que siempre está), pantalla completa y modo `md`. En **solo lectura** (nota de la papelera, vista de historial) se muestra desactivada o se sustituye por una franja de aviso, pero no desaparece sin explicación.
- Altura **constante** (un solo renglón con desplazamiento horizontal, grupos separados por divisores); si no caben todos los botones, el **resto vive en «Más»**, que siempre está en la barra. No se parte en varias líneas ni cambia de altura.
- Va **encima** del contenido y de las barras flotantes (con `--z-*`), pero **por debajo** de hojas y modales; **no tapa** el contenido ni el teclado virtual del iPad: se mantiene visible **encima del teclado** usando `visualViewport` (en iPad con teclado abierto sigue a la vista, sin saltos).
- La barra flotante de selección actual (cloze/básica) **se conserva aparte**; la estática no depende de ella.

**Cómo opera**: sobre el **bloque que se está editando** y su selección (el `textarea` activo). Los botones usan `onMouseDown={e => e.preventDefault()}` para no perder el foco (como la barra flotante actual). Si no hay bloque en edición, los botones de bloque (título, lista, cita…) actúan sobre el **último bloque enfocado**; los de texto se desactivan con estado visible. La barra flotante actual al seleccionar texto **se conserva** (cloze/básica) y comparte las mismas funciones (una sola implementación de `wrap`/`toggle`).

**Comportamiento «alternar»**: aplicar negrita sobre texto ya en negrita **la quita**; el botón activo refleja el formato en el cursor (`aria-pressed`). Sin selección, aplica a la palabra bajo el cursor. Las acciones son **idempotentes** y no rompen bloques de código ni `![[ ]]`/`[[ ]]`.

### Grupos y botones (propuesta; ajusta con el plan)
1. **Historial**: deshacer · rehacer.
2. **Estilo de párrafo** (selector): Texto normal · Título 1 · Título 2 · Título 3 · Cita · Código · Callout (tipos existentes).
3. **Texto**: **Negrita** · *Cursiva* · <u>Subrayado</u> · ~~Tachado~~ · `Código en línea` · ==Resaltar== · Color (paleta existente, `[texto]{.color}`) · **Tamaño** (Pequeño · Normal · Grande · Muy grande) · «Quitar formato».
4. **Párrafo**: alinear Izquierda · Centro · Derecha · Justificado · Sangría +/− (al nivel de lista si es lista).
5. **Listas**: viñetas · numerada · **tarea** `- [ ]` · cambiar de tipo de lista · subir/bajar nivel.
6. **Insertar**: **Tabla** · **Imagen** · **Enlace** (URL o `[[nota]]`) · Línea divisoria · Fecha de hoy · Callout · Bloque de código · Dibujo/cuaderno (los existentes) · «Más» (menú «/» completo, para no recargar la barra).
7. **Orden**: **Mover párrafo/bloque arriba · abajo** · Duplicar · Eliminar bloque (con deshacer) · Combinar con el anterior.
8. **Vista**: alternar `doc`/`md` (ya existe) · buscar en la nota (ya existe).

## 4. Sintaxis nueva (mínima, retrocompatible; define y documenta en `docs/SPEC.md` §4 y `DECISIONS.md`)
Antes de definirla, **mira cómo ya se parsean `==`, `[x]{.color}` y los callouts** y extiende ese mismo mecanismo:
- **Subrayado**: usa una marca legible, p. ej. `++texto++` (renderiza `<u>`). Comprueba que **no choque** con listas, `c++`/`i++` en código ni con `[[ ]]`; fuera de bloques de código; valor desconocido = se deja literal.
- **Tamaño**: reutiliza la sintaxis de clase existente: `[texto]{.grande}` · `{.muygrande}` · `{.pequeno}` (lista cerrada, sin tamaños arbitrarios). Escala relativa (`em`) en `theme-cristal.css`, que respeta el tamaño de fuente del usuario.
- **Alineación de párrafo**: una marca al final del bloque que no ensucie el texto, p. ej. ` {.centro}` / `{.der}` / `{.justificado}`. Lista cerrada; en `html.is-phone` se respeta igual. Si es difícil, déjalo como **mejora opcional** y dilo.
- Cada marca nueva: **validada** (lista cerrada), **sanitizada** (`class` permitido solo para esa lista, nada más) y **probada** con textos hostiles.
- Si algo ya existe con otro nombre, **usa el existente** y no inventes otro.

## 5. Imágenes: lugar y tamaño
- Botón **Imagen** → selector de archivo/cámara/portapapeles usando el **mismo `saveImage`** que ya usan «/», pegar y arrastrar (no crees otra ruta de guardado). Inserta en el bloque actual.
- Al seleccionar una imagen (tocar) aparece su **barra flotante** (por `overlay.tsx`): **Izquierda · Centro · Derecha**, tamaño **S / M / L / ancho completo**, texto alternativo y eliminar.
- **Si el prompt Notas Pro (Fase A) ya está implementado**: usa **su** sintaxis (`![[foto.jpg|300|izq]]`), su asa de redimensionar y sus validaciones; esta barra solo los **expone**. **Si no lo está**: implementa solo lo mínimo con la sintaxis actual `![[foto.jpg|ancho]]` más la alineación `|izq|centro|der` (orden libre, valores desconocidos ignorados sin romper la nota, atributos nuevos en DOMPurify y probados) y avisa que Notas Pro deberá **reutilizarlo**, no rehacerlo. Imágenes nunca estiradas; reserva de alto para que el scroll no salte.

## 6. Tablas
- **Insertar tabla** con selector de tamaño (columnas × filas, p. ej. rejilla hasta 6×6) → tabla Markdown (GFM).
- Con el cursor dentro de una tabla, la barra muestra un **grupo contextual**: agregar/eliminar fila y columna, **alineación de columna** (`:---`, `:---:`, `---:`), fila de encabezado, y «Ajustar columnas» (reformatea el texto de la tabla alineado, sin cambiar contenido). Si es demasiado, entrega primero insertar + fila/columna y deja lo demás como siguiente paso.
- Tablas largas/anchas: desplazamiento horizontal en pantallas estrechas (como hoy).

## 7. Mover y corregir el orden
- **Mover bloque arriba/abajo** (botones y atajos), manteniendo la selección y el foco; funciona con listas (mueve el elemento con sus hijos) y con encabezados (opción «mover sección completa»).
- **Arrastrar y soltar** bloques por un asa (opcional; con Pointer Events y `setPointerCapture`; fuera del textarea). Con lectores de pantalla: los botones de mover anuncian la nueva posición.
- **No rompe** `^bloque` IDs de tarjetas, vínculos `[[nota#sección]]` ni la cobertura de párrafos: probar mover un párrafo con tarjeta vinculada.

## 8. Atajos, accesibilidad y teclado
- Atajos en `src/lib/keys.ts` **sin chocar** con los existentes: ⌘B, ⌘I, ⌘U, ⌘K (enlace) si no está tomado (si ⌘K es la paleta, usa otro y dilo), ⌘⇧X tachado, ⌘⇧H resaltar, ⌘⌥1/2/3 títulos, ⌘⌥↑/↓ mover bloque, ⌘Z/⌘⇧Z. Visibles en el tooltip de cada botón (viene del `aria-label`).
- `role="toolbar"` con **navegación por flechas** (un solo tab-stop), `aria-pressed` en los alternables, foco visible, anunciado a VoiceOver; funciona con teclado físico, mando y Apple Pencil.
- Respeta `prefers-reduced-motion` y `prefers-contrast`.

## 9. iPad, iPhone y rendimiento
- **iPad**: barra completa y **siempre visible**; no se mueve ni se esconde al aparecer el teclado (usa `visualViewport`). Probar en horizontal/vertical y con Stage Manager.
- **iPhone** (`html.is-phone`): barra **compacta, siempre visible** y desplazable, anclada arriba del teclado cuando está abierto, con los grupos más usados primero y «Más» para el resto; sin cambios fuera de ese modo.
- **Rendimiento**: la barra no provoca re-render del documento entero; calcula el estado activo solo al cambiar la selección (`selectionchange` con *debounce*). Carga las partes pesadas (selector de tabla, paleta) bajo demanda. No agrega más de ~6 KB gzip al paquete inicial; reporta el tamaño antes y después.
- **Una sola superficie de vidrio** para toda la barra (sin `backdrop-filter` por botón). Al ser permanente y fija sobre contenido que se desplaza, usa relleno translúcido estable y evita repintados costosos (revisa con el prompt de rendimiento del glassmorphism si ya está aplicado).
- **Dentro del lienzo (Espacios)**: en un panel de nota estrecho, la barra pasa a una versión compacta (solo iconos, resto en «Más») que **sigue siempre visible** dentro del panel y no rompe el redimensionado ni el paneo (queda **fuera** del área desplazable del contenido, como el asa de redimensionar del bug anterior).

## 10. Pruebas
- **Vitest**: funciones puras de edición (alternar negrita/cursiva/subrayado/tachado/resaltado con y sin selección; quitar formato; títulos; cambio de tipo de lista; sangría; insertar/editar tabla y alineaciones; mover bloque/sección; imagen con alineación y tamaño) con **ida y vuelta** (texto → acción → texto esperado), idempotencia, selecciones que cruzan `[[ ]]`/código, Unicode/emoji y textos hostiles; sanitización de las marcas nuevas (solo lo permitido).
- **WebKit (Playwright)**: **la barra permanece visible** (`isVisible`, misma posición y altura; plegada queda la franja con el botón de desplegar, y el estado sobrevive a recargar) al desplazar una nota larga, al enfocar y desenfocar bloques, al cambiar `doc`↔`md`, al abrir y cerrar cada panel lateral, con el teclado virtual simulado, en panel de Espacios y en iPhone; sin selección sus botones aparecen desactivados, no ausentes; abrir una nota; usar cada grupo de la barra; ⌘Z/⌘⇧Z tras cada acción; insertar imagen y alinearla a izq/centro/der; insertar tabla 3×3 y agregar fila/columna; mover un párrafo; recargar y verificar que **todo quedó en el `.md`**; la barra no tapa el contenido con el teclado virtual simulado; teléfono y lienzo.
- **Regresión**: `npm test`, `typecheck`, `build`, `e2e`, `e2e:flows`, `e2e:design`, `e2e:phone` (**0 píxeles** fuera de la barra), pruebas de «sin color» y legibilidad, claves i18n (es/en/fr y +40 %).
- Verificación manual en **iPad real** (teclado virtual, Apple Pencil, gesto de selección, pulsación larga) y iPhone.

## 11. Entrega
Resumen corto: qué reutilizaste y qué construiste, sintaxis nueva (con ejemplos), botones entregados y los que quedaron para después (con motivo), tamaño del paquete antes/después, qué **no** pudiste verificar sin un iPad real. Actualiza `CLAUDE.md` («Fase actual», mapa del código), `docs/SPEC.md` §4, `docs/DECISIONS.md` y guarda este prompt en `docs/PROMPTS.md`.

**Criterio de aceptación**: la barra está **siempre visible** en cualquier nota abierta (desplegada o plegada a una franja, nunca oculta); sin escribir una sola marca de Markdown, puedo dar formato (incluido subrayado y tamaño), insertar y acomodar imágenes, crear tablas y listas, y reordenar párrafos desde una barra que se ve y se siente parte de Engrama; la nota queda como texto limpio en el `.md`.
# MINI PROMPT: Mini reproductor unificado + que SÍ suene por los altavoces

Lee `CLAUDE.md`. Rama `fix-reproductor`. Arregla **solo** esto: no cambies sonidos, mezcla, add-ons ni otras pantallas; sin dependencias nuevas. Texto nuevo por `t()` (es/en/fr). Tema Cristal sin color (la jerarquía con relleno/opacidad/tamaño), flotantes por `src/ui/overlay.tsx`, z-index con `--z-*`, objetivos ≥ 44 px, `aria-label` en botones solo-icono, teléfono solo bajo `html.is-phone`; `MODE=compare npm run e2e:phone` = 0 píxeles fuera del reproductor. Skills: ponytail, webapp-testing, superpowers (reproduce primero, luego corrige).

## Problemas
1. **No se escucha nada** (ni sonido ambiente ni música) por los altavoces.
2. **El mini reproductor no se ve como UNO**: debe ser **un solo componente** (una píldora de vidrio que se expande al pasar el mouse/tocar), no piezas sueltas ni dos controles separados para «ambiente» y «música».

## 1. Sonido: reproduce y diagnostica antes de tocar (`src/lib/ambient.ts`, `src/lib/noise.ts`, `src/screens/ambient.tsx`, el mini reproductor)
Con Playwright (WebKit si existe) y `window.__ambient.state()`, comprueba si hay `AudioContext` en `running`, el nivel del `master` y si `play()` de los `<audio>` se rechaza. **Reporta la causa real**. Sospechas a verificar: falta `navigator.audioSession` (`type = 'playback'` dentro del gesto, con detección); `play()` fuera del gesto (el `await mediaUrl` antes de `player.play`, y nunca iniciar audio por hover: desbloquear `<audio>`/`AudioContext` sincrónicamente en el clic); errores tragados con `.catch(() => {})` (aviso traducido y estado «detenido»); silencio por estado (`muted`/`duckOn` pegados; `master.gain` y `bg.volume` en 1 al reproducir; `fadeOut` restaura); contexto suspendido/interrumpido (`ctx.resume()` en `visibilitychange`, `statechange`, al tocar Reproducir y en `devicechange`); volumen en 0 por defecto (nivel inicial razonable o mostrar el motivo); selector de salida con `setSinkId` solo con detección; botón «Probar sonido» (tono de ~0.4 s, dice por qué si el contexto no está `running`).

## 2. Mini reproductor: que se vea y funcione como UNO
Un solo componente con dos estados (píldora `.glass` con lo que suena, play/pausa y volumen; expandido en el mismo contenedor con pista o mezcla, anterior/siguiente, play/pausa, progreso, volumen y «Abrir panel completo»); una sola fuente de estado (ambiente y música como dos líneas del mismo mini); un solo `backdrop-filter`, sin color; expandir con hover/foco/toque (~150 ms) y cerrar al salir, `Esc` lo pliega, foco visible, `prefers-reduced-motion` solo con `opacity`; posición única y estable en una esquina inferior sin tapar barras ni botones (minimapa, «Ajustar», dock, teclado), sin saltar al expandirse, visible solo si algo suena o está en pausa con pista cargada; `role="group"` con `aria-label`, `aria-live="polite"` en el cambio de pista, Media Session coherente con ambos motores; en `html.is-phone` usa la barra existente.

## 3. Pruebas y entrega
Vitest (`target()` mute/duck, reanudación, `play()` rechazado → aviso y «detenido»); Playwright con salida falsa y política de autoplay: tras un clic, contexto `running` y `master` > 0, la música arranca en el mismo clic, el hover no inicia audio, el mini es un solo bloque (píldora y expandido, claro/oscuro), «sin color» y legibilidad. Verificación manual en dispositivo real (interruptor de silencio, altavoz, AirPods/Bluetooth, cambio de salida; Mac/Windows). Entrega: causas reales, cambios, archivos y qué no se pudo verificar sin audio real; `docs/DECISIONS.md` (gestos, `audioSession`) y este prompt en `docs/PROMPTS.md`.

**Criterio**: tocar Reproducir hace que **suene por los altavoces** (también con el modo silencio en iOS), y el mini reproductor se ve y se comporta como **una sola pieza** de vidrio.

---

# MINI PROMPT: Exportar nota a PDF sale con las hojas negras

Lee `CLAUDE.md`. Rama `fix-pdf-negro`. Arregla **solo** la impresión/exportación a PDF de notas (`window.print()` en `src/screens/notes.tsx`; reglas `@media print` y `print-only` en `src/theme-cristal.css`). **No cambies** el aspecto en pantalla (`MODE=compare npm run e2e:phone` = 0 píxeles), ni el formato de las notas, ni `.docx`/`.md`. Sin dependencias nuevas. Texto nuevo por `t()`. Skills: ponytail, webapp-testing, superpowers (reproduce primero).

**Síntoma**: al exportar una nota a PDF (imprimir → «Guardar como PDF»), las hojas salen negras.

**Causas probables (verificar con un PDF real)**: `html { background: #000 }` impreso en cada hoja; `color-scheme: dark`; tokens del tema oscuro sin sobreescribir en impresión (texto blanco sobre blanco, fondos oscuros de bloques); se imprime la app completa y los contenedores con scroll no se paginan; fondos de imagen/canvas, `will-change`/`backdrop-filter` rasterizados como cajas negras.

**Reproduce primero** con Playwright (`page.emulateMedia({ media: 'print' })`, `page.pdf` con `printBackground` true y false, `pdftoppm`, % de píxeles oscuros) en tema oscuro y claro, con fondo de foto y sólido, y reporta la causa real.

**Corrección (solo en `@media print`)**: tema de papel (`html, body` blancos, `color-scheme: light`, tokens claros en `:root` y `[data-glass]`); imprimir solo la nota (ocultar el resto, liberar `height`/`overflow`/`position` para paginar; clase `printing-note` antes de `window.print()` y quitada en `afterprint`, sin `beforeunload`); bloques claros con borde fino, colores legibles en papel, imágenes `max-width: 100%` y `break-inside: avoid`, sin sombras ni `backdrop-filter`; `@page { margin: 18mm 16mm }`, `h1–h3 { break-after: avoid }`, `orphans/widows: 3`; nunca el fondo del usuario; imprimir los originales esperando a que carguen; desde un panel de Espacios, solo esa nota.

**Pruebas y entrega**: PDF en {oscuro, claro} × {foto, sólido} × `printBackground` {true, false} sin páginas con > 5 % de píxeles oscuros, texto completo (`pdftotext`), varias páginas para una nota larga, tabla y código completos; antes/después; pantalla sin cambios (`e2e:design`, `e2e:phone` = 0 píxeles), `npm test`, `typecheck`, `build`, `e2e`. Entrega: causa real, cambio, archivos y capturas; lo que no se puede verificar sin Safari real; una línea en `docs/DECISIONS.md` (el papel siempre es claro).

---

# PROMPT 19: «Compartir estadísticas» (imagen para Instagram) + Sticky notes + Tareas en Hoy

Tres funciones en **Hoy**: (1) botón **«Compartir estadísticas»** que genera una imagen lista para Instagram con **el fondo que el usuario tiene en ese momento**; (2) **Sticky notes**; (3) **Tareas** que se llenan y se tachan. Sticky notes y Tareas son **add-ons apagados por defecto** que, al activarse, aparecen como **mosaicos minimizables** en Hoy.

- Rama `compartir-stickies-tareas`, un commit por función; no unir a `main` ni hacer push sin confirmación; plan de ≤ 25 líneas primero.
- Sin red en tiempo de ejecución, sin telemetría, sin dependencias nuevas (Canvas 2D propio). Sin marcas de Apple; iconos de Lucide; la pila de fuentes de la app.
- Todo texto por `t()`/`tn()` (es/en/fr); escrituras por `SafeVault`/`NoteStore`; tema Cristal sin color; controles sobre el fondo dentro de `.glass`; 44 px; flotantes por `overlay.tsx`; teléfono bajo `html.is-phone`; `e2e:phone` = 0 px salvo lo nuevo.
- Apagado = cero costo: Sticky notes y Tareas con `import()` al activarse; el generador de imagen al pulsar el botón.

## 1. «Compartir estadísticas» (núcleo, siempre visible)
- 1.1 Botón en el encabezado de Hoy, junto a la racha y «Estudiar», dentro de vidrio, `aria-label` traducido; en teléfono, solo icono. No es add-on.
- 1.2 Hoja (por `overlay.tsx`): vista previa, formato (Historia 1080×1920 con ~250 px libres arriba y abajo, Vertical 1080×1350 por defecto, Cuadrada 1080×1080; 1×), periodo (Hoy · 7 días · 30 días · Este año · Todo, con corte a las 4:00 y zona horaria), qué mostrar (nombre, foto/emoji, carrera/institución/lema, horas, tarjetas, racha, retención, mini mapa, marca), «Compartir» y «Guardar imagen». Privacidad por defecto prudente.
- 1.3 Contenido: encabezado (foto circular o emoji o inicial + nombre recortado + línea secundaria), «Horas estudiadas» («42 h 15 min», «5 h») y «Flashcards estudiadas» en grande, secundarias (racha, retención, días), mini mapa de adherencia sin color, y abajo el **logo sin su recuadro negro + «Engrama»** y el rango de fechas. El logo se deriva en `scripts/icons.mjs` (`public/brand/logo-mark.png`, alfa por diferencia con el fondo, sin halo, original intacto) y se pinta con `--t1` del tema (variante monocroma solo para la imagen; anotar en `DECISIONS.md`). «Engrama» ≥ 120 px del borde inferior en Historia. Periodo vacío: estado honesto y «Compartir» desactivado.
- 1.4 Fondo = el fondo activo (foto, integrado o sólido) con su encuadre, desenfoque y atenuación, reutilizando la lógica de `BackgroundLayer`/`sampleBackground` (sin captura de pantalla); vidrio igual al de la app según tema e intensidad; texto ≥ 4.5:1 subiendo la opacidad del vidrio; alternativa «Neutro».
- 1.5 PNG `engrama-estadisticas-AAAA-MM-DD.png`; Web Share con preparar → entregar (`canShare`, `share` dentro del gesto); sin soporte o con `NotAllowedError`, descarga con aviso; cancelar no es error; no afirmar publicación directa en Instagram.
- 1.6 `alt` con el resumen, foco atrapado, `Esc`, 44 px; un solo trabajo a la vez; revocar Blob URL.

## 2. Add-on «Sticky notes» (`sticky-notes`, apagado por defecto)
Mosaico `Minimizable` (id `sticky`) en Hoy; cada sticky = `notes/Stickies/<id>.md` (frontmatter `sticky: true`, `orden`, `color`), por `NoteStore`/`SafeVault`; crear, editar en el sitio (Markdown seguro), reordenar por arrastre, fijar, archivar, eliminar con deshacer, convertir en nota, abrir en Notas; tarjetas de vidrio (un solo `backdrop-filter`); color por sticky elegido por el usuario (paleta de notas), neutro por defecto, contraste ≥ 4.5:1; máx. ~50 visibles.

## 3. Add-on «Tareas» (`tasks`, apagado por defecto)
Mosaico `Minimizable` (id `tareas`) con contador de pendientes; archivo Markdown estándar (`- [ ]` / `- [x]`, fecha opcional `📅 AAAA-MM-DD`); añadir, tachar con animación (sin ella con `prefers-reduced-motion`), editar, eliminar con deshacer, reordenar, fecha y vencidas (con icono/texto), «Borrar completadas» con confirmación, filtro, subtareas opcionales; casilla accesible y teclado (Espacio, Supr, ↑/↓). Integración con Calendario/Pendientes solo si es barata.

## 4. Orden
1 → 2 → 3; resumir y esperar prueba en dispositivo real al terminar la función 1.

## 5. Pruebas y entrega
Logo derivado (alfa, esquinas transparentes, sin negros opacos, hash del original igual); Vitest (horas/plural, periodos con corte y zona, recorte de nombres, zonas seguras, formatos de tareas y stickies, idempotencia); WebKit/Chromium (tamaños exactos, fondo = fondo activo, contraste en 5 fondos, interruptores, vacío, `navigator.share` con `File` y descarga, sin red; tareas y stickies; add-ons apagados sin código cargado); regresión completa y `e2e:phone`; tamaño del paquete antes/después; documentar lo no verificable sin dispositivo (Instagram instalado, «Guardar en Fotos», memoria con foto grande en iPad).
