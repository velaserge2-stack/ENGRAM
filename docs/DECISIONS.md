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

## Mejoras 1 (rama `mejoras-1`, 2026-11-11)

### 1 · Color de acento
- `settings.accent = { color, usos }`; por defecto `color: null` («Sin acento», idéntico a antes). Un `accent` antiguo en forma de cadena (fase 1) se lee como «sin acento».
- Se aplica con clases en `<html>` (`acc-nav`, `acc-progreso`, `acc-enlaces`, `acc-seleccion`, `acc-calor`, `acc-boton`, `acc-calendario`) y variables `--accent` (texto e iconos), `--accent-fill` y `--accent-fg` (rellenos). Nada más lee esas variables.
- Legibilidad: la variante de texto se aclara (oscuro) u oscurece (claro) hasta 4.5:1 contra el **peor vidrio que permite el guardián** (`#505050` / `#B9B9B9`, donde `--t2` queda justo en 4.5:1). Si se ajustó, Ajustes lo avisa y muestra ambos tonos.
- La prueba «sin color» acepta el acento solo en los selectores de los usos activos y comprueba que el botón principal sigue neutro si su uso está apagado.

### 2 · Vínculos del calendario
- `X-ENGRAMA-LINK:engrama://deck|note|topic|tag/<clave>` repetible. Mazos y notas usan un `id:` corto en el frontmatter, escrito solo la primera vez que se vinculan; temas (carpetas) y etiquetas usan su nombre.
- Resolución: `id` → ruta → nombre → nombre de archivo. Si nada coincide, chip «enlace roto» con «Reparar».
- `DESCRIPTION` = nota del usuario + «Vínculos: nombres…» (se regenera al exportar y se quita al importar). Las propiedades desconocidas del VEVENT se conservan (`extra`). Un `.ics` sin vínculos se lee igual que antes.
- El filtro de estudio admite varios destinos separados por `|` y `tag:`; «Iniciar bloque» crea el espacio `.app/spaces/bloque.json` con el estudio filtrado y hasta 2 notas.

### 3 · Notas más grandes
- Preferencias de vista (explorador, inspector, ancho del explorador, ancho de línea) en `localStorage` (`engrama.notesUI`): son por usuario y dispositivo, no datos de la bóveda; si el almacenamiento falla, valen solo para la sesión.
- Pantalla completa = una clase en `<body>`; el editor no se vuelve a montar. Los botones de vista usan `preventDefault` en `pointerdown` para no quitar el foco al bloque que se edita (así se conserva el cursor).
- Con menos de 1100 px el inspector se superpone; con menos de 760 px también el explorador.

### 4 · Paneles minimizables
- Se reutilizó `Panel.min` de los espacios: antes plegaba la ventana a su barra en el lienzo; ahora la manda a la bandeja. Un espacio guardado con `min: true` abre con ese panel en la bandeja (sin pérdida de datos).
- Orden de la bandeja en `Space.tray`; el tablero Hoy guarda `{min, hidden}` en `.app/spaces/_hoy.json` (los archivos `_*.json` no se listan como espacios).
- No se implementó reordenar arrastrando (era opcional). Al restaurar un panel en un mosaico lleno (3), el más antiguo minimizable pasa a la bandeja.

### 5 · Logo
- Fondo muestreado: `#000006` (no `#000`). La caja del logo en el original está desplazada hacia arriba e izquierda; los íconos la centran exactamente.
- `favicon.svg` no se generó: una vectorización de los degradados no sería fiel; se usan PNG de 32 y 16 px.
- Los PNG se generan con canal alfa pero totalmente opacos (verificado en la prueba).
- iOS guarda en caché el ícono de la pantalla de inicio: para ver el nuevo puede hacer falta quitar Engrama y volver a «Añadir a pantalla de inicio».

### Pendiente de validar en iPad real
- Acento en claro y oscuro sobre fondos reales; vincular y abrir desde el calendario; notas a ancho completo en horizontal, vertical y con Stage Manager; deslizar para mostrar u ocultar paneles; minimizar y restaurar con el pomodoro en marcha; recargar y comprobar que todo persiste; VoiceOver en los cuadritos; ícono nuevo en la pantalla de inicio.

## Mejoras 2 — bloque A

### 1 · Idiomas (es / en / fr)
- Tablas JSON en `src/i18n/{es,en,fr}.json` con claves semánticas `pantalla.slug`; sin dependencia nueva (`Intl` nativo). `t(clave, {params})` interpola `{x}`; los números pasan por `Intl.NumberFormat` (agrupa desde 5 cifras, para no partir años ni IDs). `tn(clave, n)` elige `.one/.other` (y `.zero` si existe) con `Intl.PluralRules`.
- `settings.lang`: `''` = automático (`navigator.languages[0]` → en/fr, si no es). Cambia al instante sin recargar: el `App` vuelve a montar las pantallas al cambiar de idioma; `<html lang>` se actualiza. Fechas y números con `locale()` (es-MX, en-US, fr-FR); primer día de semana con `Intl.Locale#weekInfo` (respaldo: en → domingo, resto → lunes) y se guarda en `weekStartsMonday` al elegir idioma.
- Las constantes de módulo con texto se volvieron funciones o *getters*, para no congelarse en el idioma del arranque.
- **No se traducen** los formatos de archivo ni el contenido del usuario: `Q::`, `Cloze:`, `MATCH::`, `ORD::`, `MC::`, `origen: ia`, `<!-- src -->`, `Caso::`/`Respuesta:`/`Explicación:`/`Tema:` de simulacros, carpeta `Diario`, encabezados `## Fuente`/`## Imágenes`, encabezados de notas Plaud, selectores CSS y SQL. Las plantillas de nota sí se muestran traducidas (su clave interna no cambia).
- Pseudoidioma `xx` (acentos + 40 % de relleno en «palabras» cortas) seleccionable en `/design` → «Idioma de prueba». La prueba E2E `e2e:mejoras2` recorre 12 pantallas a 1366, 1024 y 834 px sin scroll horizontal ni texto recortado. Para ello `.stack` usa `minmax(0, 1fr)` y los `.btn` dentro de `.wrap` pueden partir línea (en español no cambia nada visible).
- `tests/i18n.test.ts` falla si a un idioma le falta o le sobra una clave, si los `{marcadores}` no coinciden o si el código usa una clave inexistente; también fija el glosario (Otra vez/Again/Encore…).
- **Traducciones en/fr pendientes de revisión por hablante nativo.**
- Las pruebas E2E fijan `locale: 'es-MX'` (el navegador sin configurar es en-US y Engrama abriría en inglés).

### 2 · Capas y superposición
- Tokens `--z-base 0 · --z-panel 10 · --z-dock 100 · --z-popover 200 · --z-modal 300 · --z-toast 400 · --z-tooltip 500` en `:root`. Fuera de ellos solo quedan apilados locales (1–5) dentro de un componente.
- **Causa de los solapes:** las hojas se montaban dentro del panel que las abría; un ancestro con `backdrop-filter` (todo `.glass`) o `transform` (lienzo) se vuelve el bloque contenedor de `position: fixed`, así que la Papelera quedaba dentro del explorador y las opciones del mazo dentro del panel de Hoy. Ahora `src/ui/overlay.tsx` monta todo lo flotante en un **portal sobre `<body>`**.
- Pila de capas (`useLayer`): solo la de arriba recibe Esc y atrapa el foco (Tab/Mayús+Tab); al cerrar, el foco vuelve a quien la abrió. Se registra con `useLayoutEffect` para que exista desde el primer cuadro. `modalOpen()` silencia los atajos de estudio y simulacro mientras hay un modal.
- `Sheet` (todas las hojas de la app) = modal centrado de 560 px máx., velo `rgba(0,0,0,.5)`, vidrio `--glass-modal` al 88 % (el guardián parte de 0.88 en hojas); en anchos < 700 px sigue siendo hoja inferior. `Popover` = menú anclado (debajo o encima, dentro de la ventana; se cierra con Esc, tocar fuera o si el ancla se desplaza). Los menús «/» y «[[» del editor de notas pasaron a `Popover`.
- `.glass.strong[data-guard]` ahora usa el `--glass` que calcula el guardián (antes el vidrio fuerte ignoraba su ajuste).
- Hoy y Notas ya eran grid; se fijaron las columnas con `minmax(0, …)` para que el contenido largo no ensanche una columna sobre otra.
- Lienzo: `Panel.z` opcional (perezoso; un espacio antiguo sin `z` apila en orden de lista). Tocar un panel lo trae al frente y renumera 1…n. Un panel nuevo va al primer hueco libre de la vista (tamaño completo, luego 80 % y 60 %); si no hay, al hueco libre más cercano al centro (el lienzo es infinito) y la vista se desplaza hasta mostrarlo; la cascada de 32 px queda como último recurso. Abierto desde otro panel (`#/espacios/abrir/…`) se coloca a su lado, en el mismo espacio.
