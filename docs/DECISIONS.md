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

### 3 · Minimizar todos los paneles
- Todos los tipos de panel de los espacios son minimizables (también estudio, nota, imagen y simulacro). Minimizar desmonta el panel: el estudio se reconstruye desde la colección al volver y el panel de nota guarda (con `SafeVault`) lo que estuviera editando al desmontarse.
- El simulacro sigue corriendo porque su reloj es una marca de tiempo (`endAt` en `.app/exam-current.json`); el cuadrito lee ese archivo y muestra el tiempo restante cada segundo. El panel de simulacro ofrece «Continuar simulacro» si hay un intento en curso.
- «Minimizar todos» / «Restaurar todos» en el dock (iconos) y en la cabecera del espacio (texto). En mosaico, restaurar devuelve los 3 más recientes (el límite del mosaico); en el lienzo, todos.
- En Hoy también se minimizan el panel de mazos y cada tarjeta de examen (ids `mazos` y `ex:<ruta>` en `_hoy.json`).

### 4 · Tooltip
- Una sola capa (`src/ui/tooltip.tsx`, montada en `App`) escucha por delegación: cualquier `button`/`a[href]`/`[role=button]` con `aria-label` y sin texto visible, o con `data-tip`, muestra un tooltip de vidrio con **el mismo texto que lee VoiceOver** (ya traducido). Así no hubo que tocar cada botón ni añadir otro texto que traducir.
- Puntero: 400 ms. Teclado: al instante si el foco es `:focus-visible`. Táctil: pulsación larga de 500 ms; el `click` que sigue se descarta (no se ejecuta la acción) y se evita el menú contextual. Moverse más de 10 px cancela. Los cuadritos de la bandeja no usan la pulsación larga para el tooltip porque ya abre su menú.
- Se oculta con Esc, al desplazar, al tocar fuera, al cambiar de pantalla o al perder el foco; se coloca encima (o debajo si no cabe) y nunca sale de la pantalla. `aria-hidden` para que VoiceOver no lo lea dos veces. `--z-tooltip`.
- Se quitaron todos los `title` nativos de la interfaz; donde aportaban información que no está en el `aria-label` (próximos bloques de un mazo, día de racha, problemas de una pregunta, fecha de un repaso, celda de hoja larga) pasaron a `data-tip`.

### Límites encontrados (bloque A)
- En este contenedor no hay WebKit de Playwright: las pruebas E2E corrieron en Chromium. La causa de los solapes (`backdrop-filter` crea bloque contenedor para `position: fixed`) es la misma en Safari; hay que confirmarlo en el iPad.
- iOS no expone «hover»: en el iPad con dedo el tooltip solo sale con pulsación larga; con trackpad o ratón, al pasar el puntero.
- `Intl.Locale#weekInfo` existe en Safari 17+; en versiones anteriores se usa el respaldo (en → domingo, resto → lunes).

### Pendiente de validar en iPad real (bloque A)
- Cambiar de idioma en Ajustes y ver Hoy, Estudiar, Calendario y Notas sin recargar; fechas y primer día de la semana en inglés.
- Abrir la Papelera de Notas y las opciones de un mazo desde Hoy: centradas, con velo, Esc o tocar fuera las cierra.
- Lienzo: añadir 6 paneles sin que se encimen; tocar uno lo trae al frente.
- Minimizar todos / restaurar todos con un simulacro en marcha (el cuadrito descuenta); minimizar el estudio y volver.
- Pulsación larga en los botones de la barra superior: aparece la ayuda y no se ejecuta la acción.

## Mejoras 2 — correcciones de la auditoría (antes del bloque B)
- Simulacros: `summarize()` comparaba los problemas con los textos en español, pero `finalize()` los guarda ya traducidos; en en/fr la vista previa no contaba las preguntas sin respuesta o con una sola opción. Ahora compara con el texto traducido (prueba de regresión en `tests/sim.test.ts`).
- Textos que quedaban fuera de `t()`: errores del frontmatter y del parser de mazos, el prefijo «Línea N», «(sin título)» de los `.ics`, la pantalla de error al arrancar y «X de Y» del espacio usado.
- `VaultError` sigue con mensajes técnicos en la capa de la bóveda (así el Worker de OPFS no carga las tablas de idiomas); `errMsg(e)` de `src/i18n` los traduce por su `code` donde llegan a la interfaz.
- CI corre también `e2e:mejoras2`.

## Mejoras 2 — bloque B (iPhone)

### Qué quedó
- **Una sola regla de teléfono** en `src/theme.ts`: `PHONE_QUERY = (max-width: 600px), (max-height: 500px) and (orientation: landscape)`. `trackPhone()` pone `html.is-phone` antes del primer pintado (desde `main.tsx`) y lo actualiza al girar; `usePhone()` (en `ui/kit.tsx`) la expone a los componentes. Todo el CSS nuevo va al final de `theme-cristal.css` y cuelga de `.is-phone` (o de elementos que solo existen en teléfono); no se tocó ninguna regla existente.
- **Barra inferior** (`src/ui/phonebar.tsx`, solo se monta en teléfono): Hoy · Mazos · Estudiar · Notas · Más. «Más» es una hoja con Explorar, Simulacros, Calendario, Espacios, Estadísticas, Ajustes y Respaldo; una sección de «Más» marca «Más» como activa. Se oculta con el teclado en pantalla (`html.kb-open`, desde `visualViewport`). Perfil se añadirá en el bloque C.
- **Barra superior** en teléfono: sin la píldora de secciones; Respaldo y Ajustes (clase `ph-hide`) pasan a «Más». No es fija en teléfono: con píldoras sueltas, el contenido se veía entre ellas al desplazar.
- **Hojas y modales**: siempre inferiores y a todo el ancho (también en horizontal, donde el ancho supera 700 px), con el área segura superior respetada.
- **Una columna**: Calendario, Explorar y el historial de versiones (rejillas con estilo en línea) llevan la clase `phone-stack`, que solo actúa en teléfono.
- **Tablas compactas**: el cuadro de mazos usa `table-layout: fixed` con columnas numéricas de 3.6 rem (máx. 17 vw, para que el nombre no desaparezca con texto grande) y encabezados que parten línea; el nombre se recorta con «…».
- **Estudio**: tarjeta y botones de calificación compactos (los 4 botones caben en 375 px); los botones de la cabecera bajan de línea.
- **Espacios**: un panel a la vez; el dock deja de ser fijo y su barra «Añadir panel» se desplaza en horizontal. Los demás paneles (visibles o minimizados) son cuadritos en el riel, que pasa arriba en horizontal; tocar uno lo muestra. En teléfono el lienzo se muestra como mosaico de un panel y se oculta el selector de modo. Elegir qué panel se ve no se guarda: el espacio solo cambia si el usuario minimiza, restaura o añade.
- **Rendimiento**: vidrio con 14 px de desenfoque (22 px en hojas) en lugar de 28/40.
- Campos ≥ 16 px (el editor de código bajaba a 15 px), objetivos de la barra inferior de 52 px, `100dvh` y `env(safe-area-inset-*)` en la barra inferior, avisos, bandeja flotante y dock.

### Pruebas (`npm run e2e:phone`, `e2e/phone.mjs`)
- `MODE=check` (por defecto, en CI): 6 tamaños (375×667, 390×844, 393×852, 430×932, 440×956, 852×393) × es y fr × 12 pantallas sin scroll horizontal, campos ≥ 16 px y navegación ≥ 44 px; texto 0.8× y 1.6× en francés a 375 px; barra inferior, hoja «Más», hojas inferiores, final de página por encima de la barra y Espacios con un panel a la vez.
- `MODE=audit`: capturas de los 6 tamaños y lista de fallos (así se hizo la auditoría inicial).
- `MODE=baseline` / `MODE=compare` con `BASE_DIR`: **diferencia de 0 píxeles** en iPad y web (1366×768, 1024×768, 834×1194; 12 pantallas cada uno). La línea base se tomó con el código anterior al bloque B. Resultado: 0 píxeles en las 36 capturas.
- Para que la comparación sea reproducible: reloj fijo (`page.clock`), bóveda de ejemplo, carga limpia de cada pantalla, puntero fuera de los botones, ayudas emergentes ocultas y el uso real del almacenamiento enmascarado. En Chromium además se rasteriza en un solo hilo y sin GPU (`--num-raster-threads=1`…): con varios hilos, el borde de los iconos y del vidrio desenfocado variaba algunos píxeles entre dos capturas del mismo estado.

### Auditoría inicial (antes de corregir)
- Barra de secciones con 9 iconos de 40 px (< 44 px) y pantalla partida en tres filas de píldoras arriba (logo, secciones, acciones).
- Scroll horizontal en Hoy y Mazos (cuadro de mazos, hasta 57 px) y en Estudiar (botones de calificación y cabecera, hasta 70 px).
- Calendario: el mes quedaba en una columna de ~60 px junto al panel del día (rejilla de 2 columnas fija).
- Espacios: riel de 72 px a la izquierda y paneles en mosaico ilegibles; preajustes y dock comprimidos.
- En horizontal (852×393), la barra superior fija ocupaba 1/6 de la altura y se encimaba sobre el contenido.
- Hojas centradas en horizontal (ancho ≥ 700 px) en lugar de inferiores.
- Fechas de la lista de Notas partidas en dos líneas.

### Límites encontrados
- No hay WebKit de Playwright en este contenedor: todo corrió en Chromium. En CI la prueba corre en WebKit; ahí la comparación de píxeles no se usa (la línea base es local).
- Isla dinámica, barra de inicio y teclado real solo se pueden validar en un iPhone: Playwright no simula `env(safe-area-inset-*)`.

### Pendiente de validar en un iPhone real
- Instalada en pantalla de inicio: nada bajo la isla dinámica ni bajo la barra de inicio; barra inferior por encima del indicador de inicio.
- Escribir en una nota o en una hoja con el teclado abierto (la barra inferior se oculta y el campo queda visible).
- Girar a horizontal y volver; Espacios con un PDF y estudio; estudiar con una mano.
- Tamaño de texto grande y francés en Hoy, Estadísticas y Ajustes.

## Mejoras 2 — bloque C (ajustes y datos)

### 6 · Add-ons dentro de Ajustes
- La lista de módulos es la sección «Add-ons» de Ajustes (`AddonsGroup`). `#/addons`, `#/ajustes/addons`, la paleta y el botón «Extras» de Espacios abren Ajustes desplazado hasta esa sección; los enlaces antiguos siguen funcionando.

### 7 · Perfil
- `profile/perfil.md`: frontmatter (`nombre`, `emoji`, `foto`, `carrera`, `institucion`, `anio`, `lema`; claves en español como el resto de formatos, no se traducen) y la bio en el cuerpo. Foto recortada al centro a 512 px en `media/.app/perfil/`; al cambiarla se borra la anterior.
- Encabezado con avatar (foto → emoji → inicial → icono), bio, estudios, lema y tres cifras (racha actual, tarjetas totales, horas de estudio = misma cuenta que las estadísticas). Avatar en la barra superior (en teléfono, «Perfil» en «Más»), fila en Ajustes y saludo «Hola, <primer nombre>» en el subtítulo de Hoy.
- Viaja en el respaldo como cualquier archivo de la bóveda; no hay red.

### 8 · Borrar mazos
- Borrar = mover el `.md` a `.app/papelera-mazos/<id>/` con `meta.json` (rutas, fecha, tarjetas y repasos). Primero se escribe el meta: si la app se cierra a medias, la papelera sabe qué había.
- **El historial no se mueve**: `reviews.jsonl` solo se agrega (regla de FSRS). Mientras el mazo está en la papelera sus tarjetas cuentan como archivadas; al restaurarlo, los IDs vuelven y la reproducción da exactamente el mismo estado (prueba en `tests/decktrash.test.ts`). «Eliminar definitivamente» borra el archivo, nunca el historial.
- Submazos = carpeta con el mismo nombre del mazo (`decks/Cardio.md` + `decks/Cardio/…`). En selección múltiple una carpeta se lleva todo lo que contiene.
- Restaurar sobre un nombre ocupado usa «(2)». Vaciado automático al abrir la app tras `deckTrashDays` (30 por defecto; 0 = nunca), configurable en la propia papelera.
- Los vínculos del calendario se resuelven contra los mazos actuales: uno borrado aparece como «enlace roto» con «Reparar» (mecanismo de Mejoras 1, sin cambios).

### 9 · Fondos
- «Gestionar» en la galería: selección múltiple, eliminar (si el fondo está en uso vuelve «Bruma») y «Encuadrar».
- Encuadre `{x, y, zoom}` por fondo en `.app/fondos.json` (posición 0–100 % y zoom 1–3×). `framedRect` (en `lib/framing.ts`) es la única cuenta: CSS (`object-position` + `scale` desde el mismo punto), muestra del guardián de legibilidad y miniatura regenerada. La regla CSS solo actúa con `img[style]`: sin encuadre se ve igual que antes.

### 10 · Almacenamiento
- Ajustes → Almacenamiento → Administrar: desglose por tipo (PDF, documentos, hojas, fotos, fondos, audio, caché regenerable, datos), lista de `media/` y `docs/` (no `media/.app/`, que tiene sus propias pantallas) ordenable, selección múltiple y borrado definitivo con confirmación.
- «Usado en N lugares»: referencias en notas, mazos, bancos, exámenes, bandeja, plantillas y espacios (`![[x]]`, `[[x]]`, `](x)`, `src: x#p`, rutas en JSON), por ruta o por nombre. Al borrar, el renderizador ya mostraba un aviso en lugar del medio; ahora dice «Archivo eliminado: x».
- Huérfanos solo en `media/`: un PDF de `docs/` sin enlaces es parte de la biblioteca, no basura.
- Cachés regenerables: `.app/state.json` (se reconstruye desde `reviews.jsonl`) y `.app/cache/`. `reviews.jsonl` nunca es caché.

## Mejoras 2 — bloque D (notas y mapa de calor)

### 11 · Buscador en Notas
- `src/notes/search.ts` (puro): plegado sin acentos con mapa de posiciones al original, tokens que conservan `120/80`, `37.5`, `5-HT`, `mg/dL` (y sus partes), números exactos (sin prefijo ni difuso), palabras con prefijo y difuso leve desde 5 letras, AND entre términos.
- MiniSearch (ya en el stack) en un Worker (`search.worker.ts`; si no hay Worker, el mismo núcleo en el hilo principal). Se reconstruye desde los archivos al abrir Notas y se actualiza al guardar cada nota. 500 notas: la búsqueda tarda milisegundos (prueba unitaria).
- Resultados con fragmento y coincidencias resaltadas (en gris: la interfaz no tiene color), filtros de materia, tema y fecha (`fecha:` del frontmatter). Abrir un resultado monta la nota con «Buscar en esta nota» ya en la primera coincidencia.
- «Buscar en esta nota» (botón o ⌘F): contador, siguiente/anterior, Intro/Mayús+Intro, Esc. Resalta con la CSS Custom Highlight API (Safari 17.2+); sin ella, selecciona la coincidencia actual.
- Bug previo corregido: «＋ Escribe o usa / para insertar…» no abría un bloque al final de la nota.

### 12 · Mapa de adherencia
- `heatWeeks()`: semanas desde la primera actividad (mín. 8, máx. 53). Celdas fijas de 13 px; el panel usa `width: fit-content`. «Ver año completo» recupera 53 semanas y la navegación por año.
- Meses con `Intl` y «menos» traducido (eran textos fijos en español).

### Pendiente de validar en iPad/iPhone real (C y D)
- Foto de perfil desde Fotos (HEIC), encuadre con pellizco, borrar un fondo en uso, liberar espacio y ver el cambio en «Espacio usado».
- Búsqueda con 500 notas reales; resaltado con la Highlight API en Safari 17/18/26.

## Mejoras 2 — bloque E (lienzo conectado y simulacros)

### 13 · Espacios vacíos
- Se quitaron los preajustes («PDF + tarjetas», «Clase», «Repaso») del formulario y del estado vacío. Los espacios ya guardados en `.app/spaces/` se abren igual.
- «＋ Añadir panel» es un menú (Popover del gestor de capas) con: nota nueva, nota existente, mazo, tema, simulacro/examen, PDF, documento, hoja, imagen, pomodoro, estadísticas, calendario y estudio. La colocación sigue las reglas del bloque A. Tipos nuevos de panel (`mazo`, `tema`, `calendario`) perezosos: un espacio antiguo no los tiene y abre igual.

### 14 · Paneles conectados (una sola fuente)
- **NoteStore** (`src/notes/store.ts`): un documento en memoria por nota, con suscriptores y un único autoguardado. El editor de notas (pestaña y panel) lee y escribe ahí; tras cada guardado se hacen la instantánea del historial y la actualización del índice de búsqueda (`onNoteSaved`). Si el archivo cambia por fuera y no hay cambios pendientes, se vuelve a leer; mover o borrar una nota olvida su documento tras guardar.
- El panel de nota es el **mismo editor** (`NotePanel` = `NoteEditor` con `embedded`: sin explorador ni pantalla completa). «＋ Nueva nota» crea la nota de verdad con el formulario de Notas (materia, tema, plantilla).
- **Mazo**: `DeckEditor` (añadir y editar tarjetas) y `Study` filtrado (los repasos van al mismo `reviews.jsonl`), con el mismo engranaje (`DeckOptions`). **Tema**: carpeta de submazos (`decks/<carpeta>/`) o etiqueta (`tag:x`) con el Explorador y el estudio filtrados.
- **DeckStore / ExamStore**: no hizo falta duplicar tiendas. Los mazos ya son una sola colección en memoria (`app.col`) y los simulacros leen y escriben sus archivos (`exams-bank/`, `.app/exam-current.json`); el panel de simulacros es la pantalla completa de Simulacros con **ruta local** (contexto `SimNav`; los enlaces `#/simulacros/…` del panel se interceptan).

### 15 · Editor visual de exámenes
- `src/sim/draft.ts`: el borrador marca la correcta **por opción** (no por letra), así añadir, quitar o reordenar opciones no pierde la respuesta; las letras se asignan al guardar. Valida con las mismas reglas que el analizador (`finalize`).
- Se guarda con `serializeBank` en `exams-bank/<nombre>.md` (no se pisa un archivo existente: «(2)»). La prueba de ida y vuelta garantiza que editar el `.md` a mano y usar el editor son equivalentes; el caso compartido se escribe una sola vez.

## Mejoras 2 — bloque F (calendario)

### 16 · Clases y actividades con horas
- Modelo (`src/lib/ics.ts`), todo opcional: `kind` (`X-ENGRAMA-KIND`), `allDay` (`VALUE=DATE`), `floating`, `byday`, `MONTHLY`, `exdate` (`EXDATE`), `location` (`LOCATION`; antes se conservaba como propiedad desconocida, ahora es campo y se sigue escribiendo igual).
- **Horas locales flotantes** (`DTSTART:20261116T080000`, sin «Z») para todo lo que se guarda desde el formulario o la cuadrícula: una clase a las 8:00 sigue a las 8:00 aunque cambie la zona. Los eventos antiguos en UTC se leen y reescriben igual hasta que se editan (cambio perezoso).
- Ocurrencias: diaria, semanal con días elegidos, mensual (los meses sin ese día se saltan, p. ej. el 31), `UNTIL` y `EXDATE`; la hora se conserva en hora local.
- «Solo este día» = `EXDATE` en la serie (+ una entrada suelta con los cambios al editar); «toda la serie» = cambiar la base conservando su fecha de inicio (`src/lib/calendar-edit.ts`).
- Semana y Día: cuadrícula de 24 h (desplazada a las 7:00), pasos de 15 min, carriles para entradas simultáneas; tocar crea 1 h, arrastrar en vacío fija la duración, arrastrar mueve (también de día), el asa inferior cambia la duración. Mes y Agenda muestran las entradas con su icono de tipo. Vínculos y «Iniciar bloque» son los de Mejoras 1.

### Pruebas (E y F)
- Unitarias: NoteStore (dos vistas, un guardado, recarga externa sin pisar), borrador de examen (ida y vuelta, opciones, validación), `RRULE`/`EXDATE`/`BYDAY`/`MONTHLY`, hora flotante, eventos antiguos, «solo este día / toda la serie».
- `e2e:bloquec`: espacio vacío y menú completo; escribir en un panel de nota y verlo en Notas (y al revés); estudiar 5 tarjetas desde un panel de mazo y verlo en Hoy (también tras recargar); crear un examen desde el panel sin salir del espacio; crear un examen de 5 preguntas, hacerlo y ver resultados; clase semanal los lunes 8–10 + estudio 17–18 vinculado + borrar un lunes, correcto en Mes, Semana, Día y Agenda y al reabrir; tocar y arrastrar en la cuadrícula.
- Las E2E antiguas que usaban preajustes ahora crean un espacio vacío y añaden los paneles con el menú.

### Pendiente de validar en iPad/iPhone real (E y F)
- Notas largas en un panel del lienzo con el teclado en pantalla; dos paneles de la misma nota a la vez.
- Arrastrar entradas en la cuadrícula con el dedo (desplazamiento vertical frente a arrastre) y el `.ics` con BYDAY/EXDATE en el Calendario de Apple.

## Prompt 5 — Pencil, PDFs, sonido ambiente y control por teclado/mando

### A · Sonido ambiente (add-on, apagado por defecto)
- Sonidos generados en el dispositivo (`src/lib/noise.ts`): blanco, rosa (Kellet), marrón, lluvia (rosa + gotas), viento (marrón filtrado con ráfagas), olas (envolvente de 8 s) y ventilador. Bucles de 12 s con fundido cruzado (sin «clic»), PRNG con semilla, normalizados y acotados.
- `src/lib/ambient.ts`: Web Audio en primer plano (mezcla en vivo, volumen por sonido, desvanecimiento exacto). El `AudioContext` se crea solo dentro del toque en «Reproducir» (nada suena al abrir la app) y se reanuda al volver a primer plano.
- **Pantalla bloqueada**: Safari suspende el `AudioContext` en segundo plano. Modo experimental «Seguir sonando con la pantalla bloqueada»: la mezcla se renderiza a un bucle WAV y suena con `<audio>` + Media Session (título y controles). **Sin validar en iPad real.** Límites conocidos: iOS ignora `volume` en `<audio>` (allí el desvanecimiento no se oye: solo se detiene al final) y los temporizadores de JS no corren con la pantalla bloqueada, así que el apagado programado se aplica al volver.
- Música propia en `media/audio/` (lista, bucle, aleatorio, duración por metadatos, Media Session). Spotify/Apple Music no (DRM): solo un enlace opcional «Abrir mi app de música».
- Apagado 15/30/60 min o al terminar el pomodoro, con 5 s de desvanecimiento. «Solo durante el enfoque» silencia en los descansos (la alarma del pomodoro va aparte). «Atenuar al estudiar» baja el volumen mientras suena la voz (`speechSynthesis`, evento `engrama-duck`) o el audio de una tarjeta.
- Icono en la barra superior (en teléfono, en «Más») y panel del lienzo minimizable.

### B · Motor de tinta (`src/ink/`)
- Un solo componente para PDF y notas. Trazos vectoriales `{x, y, presión}` normalizados al ancho de la superficie; contorno con `perfect-freehand` (MIT, ~10 KB); grosor según presión (con ratón o dedo, presión simulada).
- Pointer Events + `getCoalescedEvents()`; trazo en curso en su propio lienzo y la base se repinta al soltar (renderizado incremental). Hover del Pencil: vista previa del cursor si el dispositivo lo entrega.
- **Rechazo de palma**: por defecto solo dibuja el Pencil y el dedo desplaza y hace zoom (`touch-action: pan-x pan-y pinch-zoom`; en iOS se cancela con `preventDefault` solo el toque `touchType === 'stylus'`). Con «el dedo dibuja», `touch-action: none` y se ignora el dedo mientras el lápiz está apoyado o hasta 500 ms después. Ajustes → Apple Pencil y tinta.
- Herramientas: bolígrafo, resaltador (translúcido, multiplicar, debajo del texto), borrador por trazo y por área (recorre el tramo entre muestras), lazo para seleccionar y mover, regla. Paleta propia de la tinta (la tinta puede tener color). Deshacer/rehacer ilimitado por sesión. Barra flotante movible.
- Safari no expone el doble toque ni el apretón del Pencil Pro: no se usan. Latencia: medir en iPad real (aquí solo Chromium sin lápiz).

### C · PDFs (`#/pdfs`)
- Biblioteca: originales intactos en `docs/`; miniaturas en `.app/cache/pdf-thumbs/` (caché), progreso, última página y etiquetas en `.app/pdfs.json`; importar desde Archivos o arrastrando.
- Visor (el mismo de los paneles): continuo o por página, zoom, miniaturas, índice (`getOutline`), búsqueda, última página recordada.
- **Resaltador inteligente**: al soltar un trazo de resaltador, se toman las cajas de carácter de la capa de texto de pdf.js dentro de la banda del trazo, se agrupan por línea y se amplía a palabras completas (`snapToText`); si no hay texto debajo, queda como trazo libre. También subrayado y tachado; bolígrafo; notas adhesivas; panel «Resaltados»; selección → tarjeta, cita en nota con enlace a la página, buscar.
- `docs/<nombre>.pdf.annots.json`: rectángulos en fracción de la página y tinta en «anchos» + rotación; huella del PDF (tamaño y sumas de inicio y final): si cambia se avisa y no se pierde nada. El formato de la fase 9 (`.app/annotations/`) se lee y se migra al guardar. Almacenamiento no ofrece borrar los `.annots.json` (van con su PDF).
- Exportar PDF aplanado con `pdf-lib` (MIT; carga diferida, solo al exportar) y resumen de resaltados en `.md`.
- Se añadió «PDFs» a la navegación (pestaña nueva; en teléfono, dentro de «Más»).

### D · Notas manuscritas
- Menú «/» → «Dibujo / manuscrito» (lienzo en línea que crece hacia abajo y se redimensiona) o «Página de cuaderno» (papel liso, rayado, cuadriculado o de puntos; zoom; «＋ Página»). Mismo motor de tinta.
- `media/dibujo-<id>.ink.json` (trazos) + `media/dibujo-<id>.png` (miniatura). La nota guarda `![[dibujo-<id>.png]]`: el `.md` sigue mostrando el dibujo sin la app, la impresión/PDF lo incluye, el DOCX lo incrusta con su proporción y el JSON viaja en el respaldo. No se indexa; los resultados de búsqueda muestran la miniatura.
- Scribble: la tinta solo vive en sus lienzos; los campos de texto no se tocan (validar en iPad). **Texto desde tinta: no disponible** — no hay OCR/reconocimiento de escritura local aceptable en la web sin enviar datos fuera (Vision no existe en Safari web).

### E · Atajos de teclado, clicker y mando
- `src/lib/keys.ts` (puro): acciones por ámbito con valores de fábrica, formato `mod+shift+n`, secuencias `g h`, reservados del sistema/Safari, conflictos, mapeo del mando estándar. `src/ui/keys.tsx`: ámbitos (`useKeyScope`), globales con secuencias, Gamepad API (flanco de subida por `requestAnimationFrame`), indicador y sonido opcional. Ajustes → Atajos: reasignar (captura síncrona), restablecer, conflictos, «Asignar botones».
- Las teclas sin modificador no se disparan en campos de texto ni con un modal abierto.
- Marcar (`*`) y «no la sé» (`F`) se guardan en `.app/marcas.json`: no tocan `reviews.jsonl`.
- Safari puede no entregar eventos del mando con la PWA en segundo plano o la pantalla bloqueada; no hay vibración web en iPad.

### Pruebas
- Unitarias: ruido (sin NaN, acotado, bucle), desvanecimiento y apagado, tinta (contorno y zoom, borrador, lazo, regla, historial, palma), cuaderno, anotaciones (ajuste a líneas y palabras, coordenadas, migración, huella, resumen), biblioteca, atajos (normalización, conflictos, secuencias, mando).
- `e2e:p5` (Chromium aquí; WebKit en CI) con eventos `pointerType: "pen"` simulados: sonido sin reproducción automática y con mezcla, palma, PDF de 120 páginas con 5 resaltados ajustados, tinta en el margen tras recargar, exportar; fórmula a mano entre dos párrafos, reabrir, imprimir; 20 tarjetas solo con teclado, clicker, mando simulado, reasignar y persistir, escribir en una nota sin disparar atajos.
- Comparación de píxeles contra la línea base previa al prompt 5: las únicas diferencias son las zonas nuevas (pestaña «PDFs» en la barra superior y secciones nuevas de Ajustes).
- Corrección de paso: un Popover ya no se cierra por el desplazamiento que llega justo al abrirlo (250 ms de gracia).

### Pendiente de validar con Apple Pencil, teclado Bluetooth y mando reales
- Audio con la pantalla bloqueada (modo experimental), latencia de la tinta, palma apoyada, resaltado ajustado en PDF reales (columnas, PDF escaneados sin capa de texto), PDF de 300+ páginas, exportaciones en Archivos, Scribble en títulos y buscadores, mando MFi/Xbox/PlayStation.

### Barra de secciones en iPad (opción b, confirmada por el usuario)
- Entre 601 y 1100 px (iPad, nunca teléfono) Respaldo y Ajustes (y Sonido ambiente, si el add-on está activo) salen de la barra superior y quedan en un botón «⋯» (menú del gestor de capas). A 1024 px se ven todas las secciones, PDFs incluida; por encima de 1100 px (iPad 11" horizontal, escritorio) no cambia nada.
- A 834 px (iPad vertical) la barra mejora (305 px visibles frente a 235) pero sigue sin caber entera (466 px): sigue siendo desplazable con el dedo. Para que quepa haría falta además quitar otro control (p. ej. el minipomodoro o el avatar) o pasar la barra a una segunda fila; pendiente de decidir.

## Prompt 6 · Bloque A — Mover mazos, tarjetas y notas (rama `mejoras-4`)

### A1 · Mazos, submazos y tarjetas (`src/data/move.ts`, `src/screens/move.tsx`)
- Un mazo es `decks/<carpeta>/<archivo>.md` y sus submazos viven en `decks/<carpeta>/<nombre>/`: mover = mover esos archivos uno a uno por SafeVault (no se reescribe el contenido). Los IDs `^xxxx` no cambian, así que `reviews.jsonl`, `state.json` y `verifyDeterminism` quedan igual; el frontmatter (`color`, `new_per_day`, `id:`) viaja con el archivo.
- Se reescribe lo que nombra mazos por jerarquía: `temas:` de los exámenes, vínculos `engrama://topic/<carpeta>` y `engrama://deck/<ruta>` del calendario, y los paneles «mazo»/«tema» del lienzo (`.app/spaces/*.json`). Los vínculos por `id` no se tocan (siguen resolviendo).
- Selector «Mover a…» (hoja): árbol de mazos y carpetas, «Nivel superior», «＋ Nuevo mazo aquí» opcional; excluye el propio mazo y sus descendientes; el sitio actual aparece como «aquí». Nombre repetido: **Renombrar** («Nombre (2)», cambia `deck:`) / **Fusionar** (las notas se agregan al mazo existente con sus IDs; los submazos pasan a su carpeta) / Cancelar.
- Entradas: engranaje (Opciones del mazo), menú contextual (pulsación larga de 450 ms o clic derecho), deslizar la fila («Mover»), arrastrar y soltar (pulsación larga + arrastrar, Pointer Events, `src/ui/pressdrag.tsx`; el destino «Nivel superior» aparece en la cabecera del panel para no desplazar las filas), y selección múltiple («Seleccionar» → «Mover (n)», que es también la alternativa de tocar-y-elegir). Un submazo seleccionado junto a su padre viaja con él.
- Tarjetas: «Mover a mazo…» en el navegador (selección) y en la lista del mazo (que es también el panel de mazo del lienzo). Se mueve la nota completa (todas sus tarjetas de cloze) con su ID; si el destino ya tiene ese ID: **Omitir** u **Duplicar con ID nuevo** (sin historial; el original se queda).
- Deshacer: cada operación devuelve un registro (movimientos inversos y textos previos) y el aviso muestra «Deshacer» durante 8 s (`app.toast(msg, action)`; los avisos sin acción no cambian).

### A2 · Notas y temas (`src/notes/move.ts`, `src/screens/notemove.tsx`)
- `vault.move` por nota; se reparan solo las referencias por **ruta**: `[[Materia/Tema/Nota]]` y `[[notes/…]]` (con `#ancla` o `|alias`), `[texto](notes/….md)`, `<!-- src: notes/….md#pN -->` de las tarjetas, `engrama://note/<ruta>` del calendario y los paneles «nota» del lienzo. `[[Título]]` y los vínculos por `id:` siguen resolviendo sin cambios. Imágenes y dibujos están en `media/` y no se mueven. El historial `.app/history/<ruta>/` viaja con la nota; la papelera no se toca. `materia:`/`tema:` del frontmatter se actualizan solo si la nota ya los tenía.
- Selector con el árbol existente (temas y subcarpetas; las materias se pueden elegir para crear dentro «＋ Nuevo tema aquí»; «＋ Nueva materia»). Las notas solo caen en un tema (o en una carpeta que ya tenga notas sueltas): no se crea anidación por cuenta propia. Un tema entero se mueve a otra materia. Para una sola nota, el campo «Título» de la hoja anterior se conserva (renombrar al mover).
- Nombre repetido: **Renombrar** («Nota (2)») / **Reemplazar** (la existente va a la papelera de notas, restaurable) / Cancelar.
- Antes de mover se guarda lo pendiente y se olvida el documento en NoteStore; después se actualiza el índice de búsqueda (quitar ruta vieja, indexar la nueva) y, si la nota abierta se movió, se navega a su ruta nueva. Funciona igual desde la pestaña Notas y desde los paneles (mismo NoteStore).
- Entradas: barra de acciones de la nota (botón «Mover a otra materia o tema»), menú contextual en el árbol (pulsación larga o clic derecho), arrastrar una nota a un tema o un tema a una materia, y selección múltiple en el árbol. **Deslizar** una fila del árbol no se usa: en Notas, deslizar ya oculta/muestra el explorador y el inspector (se respeta lo existente); la pulsación larga no dispara ese gesto.

### Pruebas
- Unitarias: mover submazo (Cardiología/ECG → Urgencias) con historial, estado, frontmatter, exámenes y calendario intactos y `verifyDeterminism`; destinos inválidos; renombrar/fusionar; selección con padre e hijo; carpeta sin mazo propio; mover tarjetas (ID e historial; omitir/duplicar); deshacer. Notas: reescritura de rutas, nota con imágenes/enlaces entrantes/src:/historial/calendario, renombrar/reemplazar, tema entero, destinos sin el Diario, deshacer.
- `e2e:p6` (Chromium aquí; WebKit en CI): engranaje, deshacer, menú contextual, arrastrar y soltar, selección múltiple, tarjeta desde el navegador y desde la lista del mazo, `verifyDeterminism` desde Ajustes; nota desde la barra de acciones, buscador en la nueva ubicación, deshacer, menú contextual del árbol, tema arrastrado a otra materia, varias notas a la vez.
