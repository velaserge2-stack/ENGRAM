# Decisiones y límites encontrados

## Fase 1 · Base (2026-11-11)

### Qué quedó
- **PWA**: `manifest.webmanifest` (standalone, scope/start_url relativos), íconos 180/192/512 + máscara, metas de iOS, `viewport-fit=cover`, `theme-color` claro/oscuro, CSP estricta sin red externa.
- **Service worker** generado en el build (`vite.config.ts` → `sw.js`): lista exacta del app shell y versión = hash del contenido. Cache-first; el SW nuevo espera y la UI muestra "Nueva versión disponible → Actualizar" (`SKIP_WAITING`). Se busca actualización al volver a la app (`visibilitychange`), porque Safari no tiene Background Sync.
- **VaultAdapter** con tres backends: OPFS en Worker dedicado (por defecto), File System Access (solo si existe `showDirectoryPicker`; el handle se recuerda en IndexedDB y se pide permiso de nuevo con un gesto) y memoria ("modo temporal" con aviso si OPFS no responde, p. ej. navegación privada).
- **Escritura segura** (`SafeVault`): temporal → diario con tamaño y suma FNV-1a → destino → limpiar. Al arrancar `recover()` rehace o descarta y la UI informa. Operaciones serializadas.
- **Integridad** al abrir: conteo por carpeta, UTF-8 estricto, frontmatter, JSON/JSONL. Solo reporta.
- **Importar**: `.md`, carpetas (`webkitdirectory`), `.zip` (detectado también por firma `PK` si llega sin extensión), imágenes/audio. Clasificación por frontmatter (`deck:` → `decks/`). Vista previa con estado nuevo/igual/ya existe y resolución omitir/reemplazar/duplicar global o por archivo. **Deshacer importación** completo.
- **Exportar**: bóveda `.zip` con `manifest.json` (formato, versión, fecha, conteos) y un mazo `.md`. Sin diario ni temporales.
- **Diseño**: tokens CSS claro/oscuro, vidrio con intensidad configurable, `prefers-reduced-transparency/motion/contrast`, bento de Hoy, cuadro de mazos de vidrio denso, listas agrupadas, interruptores, segmentados, hojas con grabber, título grande que se colapsa, barra lateral (≥ 861 px) o barra de pestañas flotante.
- **Hoy**: resumen, vencidas, nuevas (conteo preliminar), racha, tiempo, retención (pendiente), respaldo, mapa de adherencia 53×7 desde `reviews.jsonl` con corte de día a las 4:00 y zona horaria.
- **Ajustes**: persistencia (`storage.persist()` + `estimate()`), nota honesta de Safari, respaldo y recordatorio, tema, tamaño de texto, vidrio, acento, inicio del día, racha mínima, integridad, guía de instalación manual.

### Decisiones
- **Preact sin Babel**: Vite 8 compila JSX con `jsxImportSource: preact` del `tsconfig`. Menos dependencias.
- **Frontmatter propio** (subconjunto YAML: escalares, `[a, b]`, listas `- x`) en vez de una librería YAML: la SPEC no lista una y los archivos de Engrama son simples. Lo que no entiende lo reporta.
- **Respaldo en dos pasos** (Preparar → Guardar en Archivos): `navigator.share` exige activación transitoria y construir el zip es asíncrono; llamar a `share` tras `await` largos falla con `NotAllowedError` en Safari. Si falla igual, cae a `<a download>`.
- **Mosaicos**: vidrio con tinte del color del mosaico y número en color de texto (no texto blanco sobre color sólido). Blanco sobre `#007AFF`/`#34C759`/`#FF9500` no llega a AA (4.02/2.2/2.1). Los "chips" de icono usan blanco o negro según contraste. Para rellenos con texto (botón primario, selección) se usa `--accent-fill`, una variante hasta 20 % más oscura que alcanza 4.5:1 con blanco; si no se puede (amarillo, verde), texto negro.
- **Conteo de tarjetas preliminar** por prefijo de línea hasta que llegue el parser real (fase 2). Etiquetado así en la UI.
- **Mover archivos** = copiar + borrar (con diario): `FileSystemHandle.move()` no es fiable en todos los Safari.
- **FSAccessBackend** sin diario adicional: va envuelto en `SafeVault` igual que OPFS.

### Límites encontrados (navegadores)
- **Chromium (Playwright 1243) rechaza nombres de ARCHIVO no ASCII en OPFS** (`getFileHandle('Cardiología.md', {create:true})` → `TypeMismatchError`; los directorios sí funcionan). Solución: el Worker de OPFS codifica cada segmento con `encodeURIComponent` si no es ASCII seguro (biyectivo; los nombres con `%` siempre se codifican). OPFS es privado: el usuario nunca ve esos nombres y las exportaciones usan las rutas lógicas. **Verificar en Safari** si también aplica (la codificación es inocua si no).
- `clients.claim()` dispara `controllerchange` en la primera instalación del SW: solo se recarga si ya había un controlador (actualización real).
- Safari 15.x: los métodos de `FileSystemSyncAccessHandle` devolvían promesas; se usa `await` en todos (inocuo en versiones nuevas).
- WebKit de Playwright no está instalado en este entorno: la E2E corrió en Chromium. En CI con `npx playwright install webkit` corre en WebKit.

### Pendiente de validar en iPad real
- Instalar en pantalla de inicio, modo avión, cerrar y reabrir 24 h después (persistencia y exención de ITP de 7 días para PWA instaladas).
- `navigator.share({files})` con `.zip` → "Guardar en Archivos".
- `webkitdirectory` desde Archivos (puede no ofrecer carpetas en iPadOS).
- `navigator.storage.persist()` en Safari: resultado real instalada vs. pestaña.
- Que la codificación de nombres OPFS funcione igual en Safari y que la estrategia sea `createSyncAccessHandle`.
- Rotación, Stage Manager, Split View, teclado externo.

## Fases 2–11 y tema Cristal (2026-11-11)

### Fase 2 · Mazos y estudio
- Parser propio por bloques (`src/cards/parse.ts`): un bloque empieza con prefijo y acaba en línea en blanco; el `^id` va al final. IDs de tarjeta: `id`, `id:r` (inversa), `id:cN` (cloze), `id:oN` (oclusión). Los IDs faltantes se añaden al cargar y el archivo se reescribe vía SafeVault.
- **Determinismo**: `replay(reviews.jsonl)` reconstruye todo; `state.json` guarda una clave (nº de entradas, último ts, parámetros) y se invalida sola. El fuzz de ts-fsrs usa una semilla derivada del momento y del estado, así que reproducir da exactamente lo mismo (probado contra ts-fsrs directo y en Ajustes → «Comprobar determinismo»).
- Deshacer, suspender, enterrar y olvidar son entradas del historial (`op`), no ediciones: el historial solo se agrega.
- Reconciliación: el texto cambiado conserva el ID; un ID que desaparece se anota en `.app/archive.json` y se muestra 30 días; su historial nunca se borra.
- Modo recuperación: con más de N vencidas se ordena por menor R y se topa el día; se muestra «te pondrás al día en X días».
- Optimizador de parámetros: no hay uno WASM empaquetado. Se exporta el historial en CSV (formato de los optimizadores FSRS) y se pegan los parámetros.
- **Editor**: no se usa CodeMirror 6. Mazos: formulario visual + Markdown en `<textarea>`; notas: editor por bloques (cada párrafo renderizado se vuelve editable al tocarlo) con menú «/», barra de selección y autocompletado `[[`. Así funciona Scribble de forma nativa y el paquete es mucho menor. No es WYSIWYG pleno; anotado como pendiente.

### Fase 3 · Progreso y examen
- Tiempo de estudio = repasos (tope de 60 s) + simulacros; el pomodoro cuenta si fue mayor, para no sumar dos veces la misma media hora.
- Retención proyectada del examen: simulación FSRS suponiendo «Bien» en cada vencimiento, sin fuzz.
- Estimación de carga por retención: Σ 1/intervalo(S, r) de las tarjetas en repaso.
- El «Fondo personalizable» y los «Colores por elemento» de la SPEC quedan sustituidos por Cristal (no hay colores de interfaz que elegir).

### Fases 4 y 6 · Notas, bandeja y Plaud
- Estructura fija `notes/<Materia>/<Tema>/<Nota>.md`; lo que no encaja aparece como «Sin clasificar» con la opción «Mover».
- Historial: instantánea como máximo cada 5 min de edición (50 por nota) en `.app/history/`; papelera en `.app/trash/`.
- Callouts plegables (`> [!quote]- …`) se renderizan como `<details>`: así la transcripción de Plaud queda plegada en Markdown estándar.
- Plaud: sin API. Agrupación por nombre base sin sufijos (`_summary`, `_transcript`, `.srt`, «mapa mental»…). SRT → texto sin marcas de tiempo.
- Tarjetas desde notas: modo A (selección → cloze/básica, `src: nota#pN`) y modo B (copiar prompt → pegar → aceptar/editar/descartar una por una, con `origen: ia`). El modo C (API directa) no se implementó (opcional y no prioritario).
- Cobertura por párrafo: por `#pN` explícito o, para tarjetas de IA, por solapamiento de términos (≥ 40 %). Es heurística.
- `.docx`: export con `docx`, import con mammoth → DOMPurify → turndown (con regla propia de tablas). La prueba de ida y vuelta conserva títulos, listas, tablas, negritas y tareas.
- PDF de una nota: hoja de impresión + `window.print()` (texto seleccionable). No se añadió jsPDF.

### Fase 5 · Avanzado
- `.apkg`: sql.js (WASM) en un Worker. Soporta `collection.anki2`/`anki21`; el formato nuevo `anki21b` (zstd) se rechaza con instrucciones («Compatibilidad con versiones antiguas»). El revlog se convierte a nuestro historial y FSRS lo reproduce.
- KaTeX no se incluyó (opcional en la SPEC); las fórmulas quedan como texto.

### Fases 7, 8 y 11
- Simulacros: el intento se guarda tras cada respuesta en `.app/exam-current.json`; el tiempo es `endAt − ahora`. Se corrigió una carrera con teclas rápidas (A → → → B) usando una referencia al intento vigente.
- `.xlsx` no se lee (SheetJS en npm está desactualizado y con avisos): se pide CSV, en simulacros y en el visor de hojas.
- Pomodoro: `endAt` persistido en la bóveda; si una fase termina con la pantalla bloqueada se cierra en su `endAt` exacto. Wake Lock si existe; sonido con WebAudio tras el primer toque.
- Calendario: iCalendar mínimo propio (VEVENT, RRULE DAILY/WEEKLY, VALARM) en vez de ical.js. Los `.ics` importados son de solo lectura y conservan su archivo en `calendar/`.

### Fases 9 y 10 · Espacios y lienzo
- PDF: render por página con IntersectionObserver (±600 px) y liberación del lienzo fuera de pantalla; escala ≤ 2× y tope de 16 MP por página. Capa de texto con `TextLayer` de pdf.js y CSS mínimo propio. Anotaciones en `.app/annotations/`.
- Lienzo: transformaciones CSS sobre paneles DOM; máx. 4 activos (los demás se pausan con un aviso; no se toma captura real del DOM).
- El fondo por espacio (opcional) no se implementó.

### Tema Cristal
- Ver `docs/DESIGN.md`. La prueba «sin color» usa croma (máx − mín RGB) porque la saturación HSL marca como coloreados los grises casi negros de los propios tokens.
- **Bug encontrado**: un temporizador del guardián creado antes de cambiar de fondo se ejecutaba después con el modo anterior y aplicaba el velo equivocado (paneles grises con texto blanco sobre negro). Ahora el guardián siempre lee el estado vigente y los temporizadores se cancelan al cambiar.
- Títulos, encabezados de grupo y barras que estaban directamente sobre el fondo pasaron a vidrio: en modo claro sobre fondos oscuros eran ilegibles y el guardián no los cubría.
- La entrada «emoji por mazo» se guarda en el frontmatter (`emoji:`) para que viaje con el archivo.

### Pruebas
- Unitarias (103): parser, FSRS y reproducción, cola y recuperación, reconciliación, ritmo (sin datos, al día, ajustado, atrasado, mañana, pasado), estadísticas con 90 días, simulacros bien y mal formados, `.ics`, notas/Plaud/glosario, `.docx` ida y vuelta, `.apkg`, Markdown seguro, consultas.
- E2E (Chromium aquí; WebKit en CI): humo, flujos de las fases 4–11 y diseño (10 combinaciones de fondo/modo).

### Pendiente de validar en iPad real (además de lo de la fase 1)
- Rendimiento del vidrio (≥ 50 fps con 3 paneles sobre una foto) y del lienzo con 4 paneles.
- PDF de 200 páginas junto a las tarjetas sin que Safari cierre la pestaña.
- `TextLayer` de pdf.js y selección de texto con el dedo en Safari.
- Pencil: presión en la tinta del PDF y en el editor de oclusión.
- Que el `.ics` exportado se abra en Calendario con sus alarmas.
- Screen Wake Lock en Safari 26, HEIC al elegir fotos y `capture` de la cámara.
- Arrastrar desde otra app en Split View hacia la bandeja.
