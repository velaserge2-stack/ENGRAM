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

## Prompt 6 · Bloque B — Perfil como centro: Ajustes y Respaldo dentro

### B3 y B5 · Ajustes y Respaldo en Perfil
- Ajustes y Respaldo salen de la barra superior, del menú «⋯» de iPad y de «Más» en el teléfono. El «⋯» de iPad (601–1100 px) queda solo para Sonido ambiente y solo aparece si ese add-on está activo.
- Perfil (avatar en la barra; «Más → Perfil» en el teléfono) tiene dos filas nuevas: «Ajustes» (navega a `#/ajustes`, que sigue funcionando igual, también desde la paleta y los atajos) y «Respaldo» (abre la misma hoja de respaldo, con los días desde el último). Ajustes tiene «Volver al perfil». En Ajustes, el avatar (y «Más → Perfil») queda marcado como sección actual.
- El aviso de respaldo pendiente sigue abriendo la hoja de respaldo.
- B3 y B5 van en un solo commit (tocan las mismas líneas de la barra y del menú «Más»).
- **Barra a 834 px (iPad vertical)**: sin Ajustes ni Respaldo se ven 359 px de 466 px de secciones (antes 305): todavía no cabe entera y sigue siendo desplazable con el dedo. No se cambió nada más de la barra, como se pidió.

### B4 · Ajustes en acordeón
- `Group` (en `ui/kit.tsx`) solo se vuelve plegable dentro de `FoldCtx`, que únicamente provee la pantalla de Ajustes: el resto de la app no cambia. Mismo contenido y orden; cada sección tiene un `id` estable (también Atajos y Add-ons), que es la clave del estado.
- Cabecera = botón con título, resumen de una línea (idioma, modo y vidrio, acento, retención y nuevas al día, parámetros, pomodoro, etiquetas, espacio usado, último respaldo, integridad, dedo/lápiz, atajos personalizados, add-ons activos, instalación, versión) y chevron. `aria-expanded`/`aria-controls`, foco visible, Intro/Espacio; el cuerpo plegado es `inert` (no recibe foco).
- Animación con `grid-template-rows` (0fr → 1fr) y opacidad, ~240 ms; sin animación con `prefers-reduced-motion`. Desplegar una sección empuja las de abajo de forma continua.
- Por defecto todas plegadas; «Desplegar todo / Plegar todo». Estado recordado en `.app/settings.json` (`settingsOpen`, cambio retrocompatible). `#/ajustes/<sección>` (p. ej. `addons`, `atajos`) abre esa sección.
- En la comparación de píxeles la pantalla Ajustes cambia (es lo pedido); el resto no.

## Prompt 7 — Lienzo estático, PDF por página y firma (rama `mejoras-5`)

### 1 · El lienzo consume todo el zoom (`src/lib/canvaszoom.ts`, `src/screens/spaces.tsx`)
- **Causa real encontrada** (no había ningún `transform` en un ancestro común de barra, riel, dock y lienzo; tampoco listeners pasivos: Preact registra `onWheel` en el propio elemento, y ahí Chromium y WebKit no lo hacen pasivo):
  1. **Pellizco sobre un panel**: `onPointerDown` del lienzo sale si el toque empieza en un `.win`, y el cuerpo del panel tiene desplazamiento propio, que corta la herencia de `touch-action: none`. Ese pellizco nadie lo consumía y Safari lo tomaba como **zoom de página**: toda la interfaz se encogía. Con el lienzo lleno de paneles, esto pasa casi siempre al alejar.
  2. **Safari no manda `Ctrl+rueda` para el pellizco del trackpad**: manda `gesturestart/gesturechange/gestureend`, que no se escuchaban; el zoom de página se los quedaba.
  3. **En el tope** el ancla se calculaba con el factor sin limitar aunque `k` ya estuviera en 0.2: el contenido seguía deslizándose aunque el zoom no cambiara.
- Corrección, solo dentro del contenedor del lienzo: listeners nativos `{ passive: false }` para `wheel`, `gesturestart/change/end` (WebKit) y `touchmove` con dos dedos; `preventDefault()` siempre, también en el tope y sobre los paneles. El pellizco del fondo sigue con Pointer Events (dos punteros: distancia y punto medio, `touch-action: none` solo en `.canvas-wrap`); el de `gesturechange` se aplica cuando no hay pellizco de punteros en curso (trackpad de Safari y dos dedos sobre un panel).
- Quién consume: sobre un panel con zoom propio (`data-own-zoom`: el visor de PDF) el lienzo le envía el factor (`ownzoom`) y cambia el zoom del PDF; sobre el resto, el lienzo. Fuera del lienzo nada cambia (la sección PDFs y las notas siguen como estaban).
- `zoomAt` (puro): `clamp` a [0.1, 3], ancla con el factor **realmente aplicado** (en el tope no se mueve nada) y resistencia en el último tramo (0.1–0.2 y 2–3): el factor se amortigua (`f ** t`, `t` ≥ 0.15) para que se note el límite. **Mínimo 0.1** (antes 0.2): un lienzo de ~10 000 px cabe en el ancho de un iPad y un panel de 480 px queda en 48 px, todavía un objetivo distinguible; más abajo solo serían puntos y habría que componer demasiados paneles.
- Sin rebote: `html.in-canvas` (solo mientras se ve el lienzo) y `.canvas-wrap` con `overscroll-behavior: none` (`body` ya lo tenía). **No** se tocó el `viewport` (`maximum-scale`/`user-scalable=no`): no hizo falta y afectaría la accesibilidad global.
- Sin animaciones nuevas (el zoom sigue al gesto), así que `prefers-reduced-motion` no aplica. Minimapa, «Ajustar al contenido» y paneo con dos dedos/rueda no cambian.
- Límites de Safari: `gesture*` solo existe en WebKit (en Chromium las pruebas los simulan); en iPadOS la página puede seguir haciendo zoom si el pellizco empieza **fuera** del lienzo (barra, riel), que es el comportamiento normal de la web y no se bloquea; validar en iPad real con dedos y con trackpad.

### 2 · Visor de PDF: «Ver por página» al abrir (`src/screens/pdf.tsx`)
- Un solo cambio: el estado inicial del modo del visor pasa de `'scroll'` a `'page'`. Es el mismo componente en la sección PDFs, en los paneles del lienzo y en cualquier otro sitio, así que todos arrancan por página.
- El modo nunca se guardó (ni en ajustes ni en `.app/pdfs.json`): no hubo nada que ignorar ni borrar. Cambiar a continuo es manual y dura lo que dura esa apertura; cada apertura vuelve a por página.
- La última página recordada (`.app/pdfs.json → last`) se respeta: se abre por página en esa página. Los accesos a una página concreta (`?p=12` en la sección, `#p12` en el panel del lienzo) abren por página en esa página.
- En modo por página siguen igual anotaciones y tinta, resaltador inteligente, miniaturas, índice, búsqueda, zoom, «Anterior/Siguiente» y el contador «n / total» (las pruebas de `e2e:p5` ya trabajaban sobre la página 1, que es la que se ve por página).

### 3 · Firma del desarrollador (`src/app.tsx`, `src/ui/background.tsx`, CSS)
- `<div class="dev-sign" aria-hidden="true">` estático en `app.tsx` (texto `app.desarrollador`: «Desarrollador: SergeV» / «Developer: SergeV» / «Développeur : SergeV»; el nombre no se traduce). La misma línea aparece como texto normal en Ajustes → Acerca de.
- Texto plano sobre el fondo (no es vidrio): Helvetica Neue 11 px, sin color (blanco o negro), `pointer-events: none`, `user-select: none`, `-webkit-touch-callout: none`. Posición fija con `env(safe-area-inset-left/bottom)`.
- **Capa**: `z-index: calc(var(--z-base) - 1)`, encima del velo del fondo y **debajo de todo lo demás**. Así nunca tapa contenido ni controles; al desplazarse, lo que pasa por su esquina queda encima. Al terminar la página queda en el margen inferior de `.app`, libre.
- **Esquina ocupada**: en el teléfono sube sobre la barra inferior (`--tabbar-h + 14px`). En Espacios con paneles minimizados, la bandeja flotante ocupa la esquina y la firma sube por encima (`body:has(.tray.floating)`). El dock de Espacios está centrado y no la alcanza. Los avisos (toast) son temporales y pueden pasar por encima un momento.
- Se oculta con `body.focus` (estudio y simulacro en curso, que usan el mismo modo de concentración), en notas a pantalla completa (`body.notes-full`) y al imprimir.
- **Legibilidad**: el guardián (`toneSign`) mira el fondo que hay debajo y elige el tono claro u oscuro. El halo neutro del tono opuesto son tres sombras apiladas (`0 0 1px / 2px / 4px`), casi opacas junto a las letras. Opacidad: 0,38 el tono claro y **0,45 el oscuro** (con 0,38, el negro sobre blanco solo llega a ≈ 2,7:1). Contraste estimado ≥ 3:1 sobre los 5 fondos de prueba en los dos modos, incluido el peor caso de rayas blanco/negro.
- La comparación de píxeles de `e2e:phone` oculta la firma (`.dev-sign{display:none}`, igual que los tooltips): es la única zona excluida.

## Prompt 6 · Bloque C — Bandeja oculta tras un add-on (rama `mejoras-5`)
- Nuevo add-on «Bandeja de entrada» (`inbox`) en Ajustes → Add-ons, **apagado por defecto**.
- Apagado: sin icono ni contador en la barra superior ni en el dock de Espacios, sin «Procesar bandeja» en la paleta, no se recorre `inbox/` para contar pendientes y `#/bandeja` redirige a Hoy (`location.replace`, sin dejar entrada en el historial). La Bandeja nunca estuvo en «Más», en el riel ni en los avisos de Hoy. El pie de «Sin clasificar» en Notas ya no sugiere «envíalas a la Bandeja».
- Los datos de `inbox/` no se tocan; al encender el add-on todo vuelve (icono, contador, ruta y comando). Almacenamiento sigue contando las citas desde `inbox/`.
- La página /design conserva la píldora de Bandeja como muestra del componente.

## Prompt 6 · Bloque D — Mini reproductor de sonido ambiente (rama `mejoras-5`)
- `MiniAmbient` (`src/screens/ambient.tsx`) es una vista del mismo estado de `ambient.ts`: sin otro motor ni otro `AudioContext`. El panel de Sonido ambiente no cambia.
- El motor gana dos cosas mínimas: **volumen general** por sesión (`ambient.setVolume`, que también aplica a la música propia y se multiplica por la atenuación) y **pausa/reanudar** (`ambient.pause/resume`: detiene como «Detener», pero recuerda que se puede reanudar con los mismos sonidos y el mismo modo). «Detener» desde el panel borra la pausa.
- **Aparece solo mientras algo suena**, o si se pausó desde el propio mini reproductor (para poder reanudar). Desaparece al detener.
- Dónde está:
  - iPad y web: en la barra superior, junto al icono de Sonido ambiente. Entre 601 y 1100 px el icono vive en «⋯» y el mini reproductor queda en la barra.
  - Teléfono: píldora flotante a la derecha, sobre la barra inferior, sin taparla.
- **Compacto**: píldora de vidrio con tres barras de nivel monocromas (animadas solo con `transform`; estáticas con `prefers-reduced-motion`), título corto (las capas activas o la pista) y pausa.
- **Extendido**: se abre con el cursor o el lápiz encima (Pointer Events que no son táctiles), con el foco del teclado (`:focus-visible`) o, sin hover, al tocar. Se contrae al salir (300 ms de gracia), con Esc o al tocar fuera. Va en `Popover` de `overlay.tsx` (portal y pila, `--z-popover`), siempre dentro de la pantalla. La animación es de resorte, solo `transform`/`opacity`. Contenido:
  - título;
  - pausa/reanudar;
  - anterior/siguiente si hay música;
  - volumen general;
  - cada capa activa con su volumen (se guarda igual que en el panel);
  - minutos que quedan del temporizador;
  - «Abrir panel».
- Accesibilidad: objetivos ≥ 44 px, `aria-expanded`, estado anunciado con `aria-live`. Las etiquetas pasan por `t()` (es/en/fr).
- Límites de Safari: el AudioContext solo se reanuda dentro de un toque, y «Reanudar» lo es. En segundo plano (pantalla bloqueada) `<audio>.volume` no tiene efecto en iOS, así que el volumen general solo cambia el sonido en primer plano.
- Barra a 834 px tras ocultar la Bandeja: 449 de 466 px de secciones visibles (antes 359). Faltan 17 px para que quepa entera; sigue siendo desplazable.

## Prompt 10 — Importar `.apkg` del formato nuevo de Anki (rama `fix-apkg`)

### Causa real (reproducida, no supuesta)
- Con paquetes generados por la **biblioteca oficial de Anki** (`pip install anki`, `scripts/apkg-fixtures.py`):
  - **formato nuevo** (por defecto en Anki ≥ 2.1.50): `meta` = 3, `collection.anki21b` (zstd, esquema **v18**), `media` en protobuf comprimido con zstd, medios numerados también en zstd, y `collection.anki2` = **marcador falso** de esquema 11 con una sola nota «Please update to the latest Anki version, then import the .colpkg/.apkg file again.»;
  - **compatibilidad**: `meta` = 2, `collection.anki21` sin comprimir (v11), y también el marcador falso en `collection.anki2`.
- El importador abría `anki21 ?? anki2`. Con un paquete nuevo había `anki2` (el marcador), así que importaba **esa nota en `decks/Default.md`** y nada más: «se sube pero no aparece». `anki21b` nunca se leía (la rama que avisaba del formato nuevo era inalcanzable porque el marcador siempre existe).
- `rows()` tragaba todos los errores y la hoja mostraba «1 archivos» o «0 archivos» sin causa. La recarga de la colección tras confirmar **sí** funcionaba (`app.changed()`): los mazos aparecen sin recargar la app, también los jerárquicos (`decks/A/B/C.md`); no hubo que corregirla.

### Cambios
- **Colección**: se lee `meta` (protobuf) y se prueba `anki21b` → `anki21` → `anki2`, identificando zstd (`28 B5 2F FD`) o SQLite (`SQLite format 3\0`) por la firma. El marcador falso (≤ 1 nota con ese texto) se descarta; si es lo único legible, error **«formato nuevo»**. Ninguna colección legible → error «dañado».
- **zstd**: `fzstd` 0.1.1 (**MIT**, ~24 KB sin comprimir, ~7 KB gzip), descompresión por trozos con **tope de salida** (`LIMITS.maxUnzstdBytes` = 1 GB; para cada medio, el menor entre ese y `maxFileBytes`). Solo lo importa `src/io/apkg.ts`, que solo carga el Worker: no está en el bundle principal (comprobado en `dist/`).
- **Protobuf**: decodificador mínimo propio (`pbFields`: varint y longitud delimitada; el resto se salta) para `meta` (versión) y `media` (`MediaEntries { MediaEntry { name = 1, size = 2, sha1 = 3, legacy_zip_filename = 255 } }`; la entrada *i* está en el archivo `i` del zip salvo que traiga `legacy_zip_filename`). No se añadió ninguna librería de protobuf.
- **Esquemas v11 y v18** detectados por `sqlite_master` (`notetypes` ⇒ v18). En v18 los mazos y tipos de nota salen de sus tablas; nombres jerárquicos con `\x1f` (o `::` en v11); cloze por el campo 1 (`kind`) del `config` protobuf del tipo de nota, por el nombre o por `{{c1::` en el primer campo; «inversa/ambos» por el nombre o por tener dos plantillas.
- **Errores**: `rows()` distingue «la tabla no existe» (se usa la alternativa) de un error real (aviso con la tabla y el motivo). Se informa «Esquema Anki v11/v18: N notas, M mazos, K medios»; las notas con primer campo vacío se omiten **contadas**; 0 notas o 0 mazos escritos es un error explícito (`empty`) con la causa; «Default»/«Por defecto» con tarjetas se escribe con el nombre del archivo. Tope de **notas** (`LIMITS.maxApkgNotes` = 300 000). Un medio que no se puede descomprimir se omite con aviso. Los nombres de medios siguen saneados (sin `/`, `\`, `:` ni `.` inicial).
- `revlog`: mismo mapeo a `reviews.jsonl` (`src: 'anki'`, ease 1–4, ≤ 60 s, `mergeLog` sin duplicar); ahora solo para tarjetas de notas que sí se importan.
- **Hoja de importación** (`src/screens/import.tsx`, único componente de interfaz tocado): mensaje principal (icono + negrita, `role="alert"`, sin color) cuando no hay nada que importar, con causa y paso siguiente por código de error; resumen «mazos · tarjetas · imágenes y audios · repasos» antes de confirmar; «Ver mazos» después; spinner (`prefers-reduced-motion` lo detiene) mientras se lee; un fallo del Worker da un error claro. El conteo de tarjetas cuenta las dos de una nota inversa.

### Paquete de Anki que llega como `.zip` (probado con el archivo real del usuario)
- El `.apkg` real que fallaba (formato nuevo, 407 notas, 20 mazos, 143 imágenes) llegó **con extensión `.zip`** (pasa al descargarlo o compartirlo desde Archivos). La importación lo trataba como un respaldo de Engrama y dejaba sus 147 archivos sueltos en `docs/`, sin ningún mazo ni aviso.
- Ahora un `.zip` (o archivo sin extensión) cuyo índice contiene `collection.anki2`, `collection.anki21` o `collection.anki21b` se importa como paquete de Anki (`isAnkiZip`: solo lee los nombres del índice, no descomprime). Los `.zip` de bóveda no cambian. El mazo «Default» toma el nombre del archivo sin `.apkg`/`.colpkg`/`.zip`.
- Con el archivo real: «20 mazos · 407 tarjetas · 143 imágenes y audios · 0 repasos» (el paquete no traía programación) y el árbol `DÉCIMO SEMESTRE/TRAUMATOLOGÍA/01…21` aparece en Mazos.

### Límites conocidos
- Plantillas de tarjeta personalizadas, CSS, LaTeX/MathJax y JavaScript de Anki no se reproducen: se importa el texto de los campos (HTML → Markdown sencillo). Tipos de nota con más de dos plantillas o campos se convierten como «básica» (primer campo = pregunta, resto = respuesta).
- `.colpkg` (colección completa) se trata igual que `.apkg`.
- El audio de los campos (`[sound:…]`) se importa como medio y se enlaza; reproducirlo depende del navegador.
- zstd: antes de descomprimir se lee la cabecera del primer marco (ventana y tamaño declarados) y se rechaza si supera el tope, para que `fzstd` no reserve memoria de más; los marcos siguientes se vigilan contando la salida.
- Validar en iPad con un `.apkg` real grande (memoria del Worker al descomprimir colecciones de cientos de MB).

## Prompt 12 — Crear notas pidiendo solo el título (rama `fix-notas`)

### Decisión de ubicación (la más simple y retrocompatible)
- **Materia y tema** → `notes/<Materia>/<Tema>/<Título>.md` (como siempre).
- **Solo materia** → `notes/<Materia>/<Título>.md`. `noteMeta` ahora la marca como estructurada con `tema: ''` y `buildTree` la pone **dentro de su materia**, en el grupo «Sin tema» (que va primero). Antes esta ruta caía en «Sin clasificar»: las notas sueltas de dos niveles que ya existían (p. ej. importadas de Obsidian) ahora se ven dentro de su materia; **ninguna cambia de ruta**.
- **Sin materia** → `notes/<Título>.md`, el nivel raíz que `noteMeta` ya trataba como suelto: grupo «Sin clasificar» (traducido). **Tema sin materia** no crea carpetas (nunca `notes//Tema/…`): la nota va a «Sin clasificar» y el tema queda en su frontmatter; el formulario lo avisa con un texto suave, sin bloquear.
- `notes/Diario/<fecha>.md` sigue siendo especial (`DAILY`), y lo de 4 o más niveles sigue en «Sin clasificar».
- No se crean carpetas que no se pidieron. Frontmatter: `materia`/`tema` solo si tienen valor (al crear, al mover y al archivar desde la Bandeja); el lector ya toleraba su ausencia.
- Nombres (`safeSegment`): sin caracteres prohibidos ni puntos iniciales, ≤ 200 bytes UTF-8 sin partir un emoji y conservando el sufijo « (2)», para que los duplicados de títulos larguísimos no choquen.

### Formulario y otros lugares
- «Nueva nota» (Notas, `⌘N`, paleta y panel de nota del lienzo, que usan el mismo `NewNote`): **Título** primero, con foco (se enfoca en el cuadro siguiente a abrir la hoja, porque el gestor de capas enfoca la hoja) y único `required`; Materia y Tema «(opcional)», vacíos por defecto (ya no `tree[0]`); Intro crea. En iPad, Safari solo abre el teclado si el foco llega dentro del toque: puede hacer falta tocar el campo.
- El calendario solo crea **notas diarias** (sin formulario): no cambió.
- «Mover a…» (la hoja que reemplazó al formulario con Materia y Tema `required`): «Sin clasificar» (raíz) y una materia sin tema son destinos válidos de una nota; `moveNotes` acepta destino vacío. El explorador acepta soltar una nota en una materia («Sin tema») o en «Sin clasificar».
- Bandeja (add-on): asignar materia y tema es opcional; archivar sin materia deja la nota en «Sin clasificar» (antes usaba carpetas «Sin materia/General»).
- Cabecera de la nota y vista «Todo»: rotulan «Sin clasificar» y «Sin tema» en vez de dejar el hueco.
- Sin cambios: buscador, wikilinks, backlinks, grafo, papelera, historial, vínculos del calendario, `src:`, exportación, índice y paneles (todos trabajan por ruta o título y ya aceptaban rutas de 1 o 2 segmentos). Las plantillas no usan `{{materia}}`/`{{tema}}`.

## Prompt 11 — Rendimiento con PDF pesados y Lienzo (rama `perf-pdf-lienzo`)

### Medición (`npm run e2e:perf`, `?perf`)
- `scripts/perf-fixtures.mjs` genera PDF de 50, 300 y 800 páginas (9.6 / 38 / 96 MB, con imágenes de ruido para que no se compriman) en `tests/fixtures/perf/` (no se versionan). `e2e/perf.mjs` mide importar, abrir, continuo, desplazarse, miniaturas, buscar y un lienzo de 30 paneles; tareas largas (`longtask` en Chromium, huecos de rAF > 50 ms en cualquiera), memoria (`performance.memory` con `--enable-precise-memory-info`, solo Chromium) y los contadores de `src/lib/perf.ts` (`getPage`, lecturas por rango, páginas dibujadas, renders de panel). Al final comprueba los criterios de aceptación y falla si alguno no se cumple.
- Resultados completos: `docs/perf/perf-antes.json` (línea base, `main`) y `docs/perf/perf-despues.json`. Chromium headless en el contenedor; los números de WebKit en iPad serán otros, por eso existe `?perf`.

| PDF de 800 páginas (96 MB) | Antes | Después |
|---|---|---|
| Importar: tareas largas · pico de memoria JS | 4 (máx. 149 ms) · 294 MB | 0 · 10 MB |
| Abrir hasta ver la página 1 · memoria · bytes leídos | 918 ms · 295 MB · el archivo entero | 845 ms · 12 MB · 1.8 MB |
| Continuo: páginas en el DOM · canvas · MP · `getPage` | 800 · 1601 · 815.5 · 799 | 3 · 2 · 1 · 2 |
| Continuo: tarea más larga | 1219 ms | 0 |
| Desplazarse 30 saltos: tiempo · tareas largas · páginas · canvas | 28 s · 46 (máx. 524 ms) · 800 · 1602 | 5.1 s · 0 · 6 · 4 |
| Miniaturas montadas | 800 | 13 |
| Buscar en 800 páginas: tiempo · tarea más larga | 3.3 s · 543 ms | 2.3 s · 0 (cancelable; 2.ª vez desde caché) |

| Lienzo, 30 paneles | Antes | Después |
|---|---|---|
| Renders de `Window` durante paneo y zoom | 1170 | 0 |
| Paneles con contenido montado a 100 % | 4 (cualesquiera, también fuera de la vista) | 3 (solo los de la vista; 0 fuera) |
| Al 10 % | 4 cuerpos completos | 0 (tarjetas ligeras) |

### 1 · Subir por trozos (`SafeVault.writeStream`)
- `writeStream(path, blob)` escribe al temporal con `raw.writeBlob` en trozos de 4 MB (OPFS: en el Worker con `SyncAccessHandle`; FS Access: `createWritable`), calcula la suma FNV-1a por trozos, anota en el diario `{ op: 'write', stream: true, sum, size }`, mueve el temporal al destino y borra el diario. Si se corta, `recover()` termina el movimiento si el temporal está completo (suma correcta) o lo da por hecho si el destino ya la tiene. Sin `writeBlob` (memoria), cae a `write` normal. Pruebas: corte simulado (`MemoryBackend.failAfter`) y recuperación.
- Progreso y «Cancelar» (`AbortSignal`; en OPFS se avisa al Worker, que borra el temporal). Antes de importar se compara el tamaño con `navigator.storage.estimate()` y se avisa si no cabe; `QuotaExceededError` → código `quota` con mensaje claro. Se quitó el aviso «más de 50 MB».
- Importar (`.zip`, Bandeja y PDFs): los binarios de ≥ 8 MB ya no se leen enteros a memoria; viajan como `Blob` hasta `writeStream`. La miniatura y la proporción de página se obtienen al importar, por rangos.

### 2 · Abrir por rangos (`src/pdf/open.ts`)
- `PDFDataRangeTransport` sobre `File.slice()` (trozos de 256 KB), `disableAutoFetch` y `disableStream`: pdf.js pide solo lo que necesita (xref, página 1). Sin `blob:` URL (la CSP `connect-src 'self'` sigue intacta y no hay `fetch`). La huella del PDF para las anotaciones usa cabeza (256 KB) + cola (64 KB) + tamaño, no el archivo entero.
- `page.cleanup()` tras cada render y `doc.destroy()` al cerrar.

### 3 · Visor virtualizado (`src/pdf/virtual.ts`, `src/screens/pdf.tsx`)
- Tabla de alturas con sumas prefijas (proporción común + excepciones guardadas en la biblioteca como `aspects`), ventana visible ±2 en el DOM y **canvas solo para la visible ±1**; espaciadores arriba/abajo; scroll en rAF sin medir el DOM; al corregir la proporción de una página por encima, se compensa el scroll.
- Cola de render (2 a la vez, la central primero, cancelable) y presupuesto de píxeles (40 MP en total, 16 MP por página; la del foco puede pasarse y se re-renderiza a resolución completa cuando hay sitio). Al salir de la ventana: `canvas.width = height = 0`, capa de texto vacía; la capa de tinta solo existe si se anota o la página tiene trazos (antes había 2 canvas de tinta por página).
- Miniaturas laterales virtualizadas (caché de 60) y búsqueda cancelable con caché de texto en `.app/cache/pdf-text/<hash>-<tamaño>.json` (reconstruible).

### 4 · Biblioteca
- Miniaturas con `IntersectionObserver` + cola de 1, por rangos; se generan al importar. Nada se renderiza fuera de la vista.

### 5 · Lienzo (`src/screens/spaces.tsx`, `src/lib/canvaszoom.ts`)
- Durante el gesto la vista vive en una ref y se aplica en rAF al plano, al porcentaje y al minimapa; `setV` + guardar solo al terminar (soltar, `gestureend`, o 150 ms sin rueda). `Window` va con `memo` y una API estable (las funciones leen el espacio vigente de una ref), sin `scale` como prop.
- Arrastrar mueve con `transform` y redimensionar cambia ancho/alto directo en el DOM; se confirma una sola vez al soltar (antes, un guardado por cada `pointermove`).
- Culling: un panel monta su contenido solo si su rectángulo cruza la vista (+200 px); de esos, máximo 4 despiertos con prioridad del foco (`awakePanels`, probado). Bajo 35 % de zoom, tarjeta ligera (icono y título grandes) en lugar del contenido.
- `will-change: transform` solo mientras dura el gesto (`.canvas-wrap.moving`): con él fijo, Safari conserva una capa enorme rasterizada a la escala con que se creó (texto borroso tras el zoom y memoria de GPU constante); al quitarlo, se vuelve a rasterizar nítido una vez. En Chromium headless no hay diferencia medible en tareas largas; validar en iPad con `?perf`.

### Modo `?perf`
Abrir la app con `?perf` (p. ej. `https://…/engrama/?perf#/pdfs`) muestra en una esquina: páginas de PDF en el DOM, canvas (y megapíxeles), `getPage`, lecturas por rango (MB), páginas dibujadas, paneles con contenido / total, renders de panel, tareas largas (si el navegador las expone), cuadros > 50 ms y memoria JS (si existe). «Reiniciar» pone los contadores en cero. Sin el parámetro no se monta nada.

**Para repetir en iPad / iPhone** (Safari, app instalada o no):
1. Pasa un PDF grande (≥ 300 páginas, ≥ 50 MB) a Archivos. Abre la app con `?perf` al final de la dirección.
2. PDFs → Importar: la barra avanza y «Cancelar» responde; la app no se congela. Anota «Tareas largas» / «Cuadros > 50 ms».
3. Abre el PDF: la página 1 aparece sin esperar al archivo entero; «Páginas de PDF» ≤ 7, «Canvas» ≤ 5, «Lecturas por rango» unos pocos MB.
4. «Ver continuo» y desliza rápido hasta la mitad y más allá: las cifras de páginas y canvas no crecen; vuelve arriba y la página 1 se redibuja.
5. Miniaturas y Buscar (prueba «Cancelar» a la mitad).
6. Espacios → Lienzo con 20–30 paneles: pellizca y pasea. «Renders de panel» no sube durante el gesto; «Paneles con contenido» solo cuenta los que ves. Aleja por debajo de 35 %: tarjetas ligeras. Arrastra y redimensiona un panel.
7. Si algo se siente lento, toma captura del recuadro y dime en qué paso.

### Límites conocidos de Safari
- WebKit no expone `longtask` ni `performance.memory`: en iPad se usan los cuadros > 50 ms y los contadores propios.
- `SyncAccessHandle` existe en Safari ≥ 15.2 solo dentro de un Worker (así se usa). `File.slice()` de un archivo elegido en Archivos puede invalidarse si iOS lo libera: el visor siempre abre la copia de la bóveda (OPFS), nunca el archivo original.
- Safari limita la memoria de canvas por pestaña (≈ 384 MB en iPad): por eso el presupuesto de 40 MP y liberar a tamaño 0.

## Prompt 15 — Minimapa del lienzo (rama `fix-minimapa`, desde `main`)

### Causas reales (reproducidas con `e2e:p15` antes de corregir)
- **Era decorativo**: `aria-hidden` y sin manejadores; tocarlo no hacía nada (la vista no se centraba).
- **Sus punteros llegaban al lienzo**: `canvas-wrap` solo ignoraba `.win`, así que arrastrar sobre el minimapa hacía el paneo normal del lienzo, que en el minimapa se ve como sentido contrario.
- **Límites solo de paneles** (y del origen): al alejarse o desplazarse lejos, el rectángulo de vista salía del recuadro (`overflow: hidden`) y desaparecía.
- **Tamaño no reactivo**: el rectángulo leía `wrap.current.clientWidth/Height` en el render y el tamaño solo se actualizaba con `resize` de la ventana.
- **Paneles minimizados** dibujados (usaba `sp.panels` y no `visible(sp)`): con uno minimizado salían 7 de 6.

### Cambios
- `src/lib/minimap.ts` (puro, `tests/minimap.test.ts`): límites = unión de paneles visibles y vista con 4 % de margen, escala centrada, conversión minimapa ↔ mundo y `centerOn` (no cambia el zoom).
- `spaces.tsx`: el minimapa detiene sus punteros (y `canvas-wrap` ignora `.minimap`), con `setPointerCapture`. Tocar centra la vista en el punto; agarrar el rectángulo lo arrastra desde donde se tomó; tocar un panel lo trae al frente, le da el foco y lo centra (en un solo guardado). Usa el mismo `preview`/`end` del paneo: rAF durante el gesto y `save` al soltar. Los límites se congelan durante el arrastre y se recalculan al soltar con una transición de 0.25 s (sin ella con `prefers-reduced-motion`). Tamaño del lienzo con `ResizeObserver` (girar, Stage Manager); sin él, `resize`. Cajas de paneles memoizadas por posición y tamaño.
- Interactivo y accesible: `role="group"`, `aria-label` «Minimapa del lienzo», `tabIndex`, foco visible, tooltip (`data-tip`); flechas desplazan la vista un 10 % y Intro centra el panel enfocado. El panel enfocado se marca con un relleno más marcado (sin color).
- Plegable: botón de 44 px a su izquierda; `minimap: false` se guarda en `.app/spaces/<id>.json` solo al plegar (campo opcional; si falta, se muestra). Con 0 o 1 panel visible no se muestra. `z-index: var(--z-panel)`.

### Fallo previo encontrado, sin tocar (fuera de este prompt)
- **«Ajustar al contenido» no responde al ratón** (en Chromium): el `pointerdown` de `canvas-wrap` captura el puntero también sobre sus botones, y el `click` acaba en el lienzo, no en el botón. Con el dedo en iPad no se pudo verificar aquí. El arreglo sería ignorar `button` en ese `pointerdown` (igual que ya ignora `.win` y ahora `.minimap`); queda pendiente de confirmación.

### Límites de Safari / a validar en iPad real
- `ResizeObserver` existe desde Safari 13.1; el respaldo con `resize` no detecta Stage Manager.
- Arrastrar con dedo y con Apple Pencil, con 6+ paneles, en vertical y horizontal (WebKit de Playwright no está instalado en el contenedor: las e2e corrieron en Chromium).

## Notas-Pro — paquete 1 · Fase A: fotos (rama `notas-pro`, desde `main`)

### Antes de empezar (verificado)
- Ya existían y se reutilizan: `NoteStore` (`src/notes/store.ts`), historial de versiones, papelera, «Esquema», `expandQueries`, `pressdrag.tsx`, `?perf` (`src/lib/perf.ts`), `e2e:perf`, `SafeVault.writeStream`, `Popover`/`useLayer`/`Portal` (`src/ui/overlay.tsx`), `.app/cache/` como caché regenerable (excluida del zip y contada en Almacenamiento).
- No había otro prompt pendiente que tocara esto: «solo título» (P12), «mover» (P6), `.apkg` (P10), rendimiento PDF/lienzo (P11) y minimapa (P15) ya están en `main`. No existe una caché de HTML por bloque ni `content-visibility` en notas.

### Original + miniatura (A1)
- `saveImage` guarda **el archivo tal cual** (cualquier formato, HEIC incluido), por `SafeVault.writeStream` (por trozos y con diario; nunca `writeBlob` del backend, que se salta el diario). No decodifica para guardar; solo lee los primeros 256 KB para anotar la proporción.
- Ajuste **Calidad de las fotos**: `Original` (por defecto) / `Optimizada` (el comportamiento anterior: máx. 2000 px, JPEG 0.88). Solo afecta a las fotos nuevas.
- **Una sola caché y una sola función**: `.app/thumbs/` y `mediaThumbUrl()` (`src/notes/thumbs.ts`). Se eligió `.app/thumbs/`, como pide el prompt, en lugar de `.app/cache/img/`; por eso `REGENERABLE` y la exportación de la bóveda la tratan igual que `.app/cache/`. Las miniaturas de PDF (`.app/cache/pdf-thumbs`) son otra cosa (páginas renderizadas con pdf.js) y no se tocaron.
- Reglas de `mediaThumbUrl`: original ≤ 1 MB, GIF o SVG → se muestra tal cual (las fotos guardadas antes ya venían comprimidas, así que se ven igual que antes); mayor → miniatura JPEG 0.7 de lado ≤ 1200 px. Se generan **de una en una** (lectura incluida) en un Worker con `OffscreenCanvas`. Si no hay Worker u `OffscreenCanvas`, se hace en la ventana con `createImageBitmap(…, { resizeWidth })`, que mantiene la proporción. Si eso falla, se decodifica entera y se reduce por pasos de la mitad. Si nada funciona pero el navegador sabe mostrarla, se muestra el original (contorno discontinuo si pasa de 25 MB); si no sabe (HEIC fuera de Safari), aparece un marcador con el nombre y «abrir el original».
- La orientación EXIF se lee del encabezado (`imageSize`) para calcular la proporción de fotos verticales.
- Las URL se cuentan por uso (`mediaThumbUrl`/`releaseThumb`) y se revocan 20 s después del último uso (al reescribir un bloque se vuelve a pedir la misma enseguida). `Html` carga con `IntersectionObserver` (margen 800 px) y libera al desmontarse.
- **Sin saltos al desplazarse**: la proporción se guarda en `.app/thumbs/dims.json` (también caché) desde el momento de guardar la foto. Una `<img>` sin `src` es texto en línea y no respeta `aspect-ratio`, así que las fotos pendientes se dibujan como un recuadro neutro de su tamaño.
- Ajustes → Almacenamiento: tamaño de `media/`, tamaño de la caché con «Vaciar» (no borra ninguna foto) y aviso si se supera el 80 % de la cuota.

### Sintaxis (A3)
- `![[foto.jpg|300|izq|alt Texto]]`: tras el nombre, opciones con `|` en cualquier orden. Tamaño `N` (px, entero entre 40 y 4000) o `N%` (5–100); el primero válido manda. Alineación `izq|der|centro` (alias `left|right|center`).
- **Regla del alt**: empieza por `alt ` y va siempre al final; todo lo que sigue, incluidos los `|`, es el texto. No puede contener `]` (se quita al guardar).
- Lo desconocido o fuera de rango se ignora al mostrar y se conserva literal al guardar (detrás de tamaño y alineación). `parseEmbed`/`serializeEmbed`/`rewriteImageEmbed` en `src/md/embed.ts`.
- `![[nota|alias]]` (no imagen) sigue mostrándose como antes («!» + enlace).
- Render: `width` (como antes) + `data-w` + `data-align`. DOMPurify admite solo `data-media`, `data-wl`, `data-kind`, `data-w` y `data-align`, más los atributos estándar. Se añadieron `ALLOW_DATA_ATTR: false` y `FORBID_ATTR: ['style']`: antes cualquier `data-*` y `style` pasaban, también en el HTML de `.docx` importado.
- **Nada existente cambia**: `flow-root`, limpiar flotados y el contenedor de paneles solo se activan con `:has(img[data-align])`; una nota sin la sintaxis nueva produce exactamente el mismo HTML y CSS (comprobado con `MODE=compare e2e:phone`).
- En `html.is-phone`, en ventanas < 480 px y en paneles del lienzo < 480 px (container query), las flotadas pasan a ancho completo.
- «Texto al lado» = el embed al inicio de un párrafo (mismo bloque de `splitBlocks`): el texto fluye junto a la imagen. Cada bloque es su propio `.md`, así que una imagen no flota sobre el bloque siguiente.

### Barra de imagen (A4)
- `src/notes/imagebar.tsx`: alineación, S/M/L (33/50/75 %) y ancho completo, «Texto al lado» y texto alternativo. El asa de la esquina (dedo o Pencil, `setPointerCapture`, `touch-action: none` solo en el asa, mín. 80 px, máx. el ancho de la nota) escribe px al soltar, o 100 % si llega al borde. Con el teclado: Intro sobre la imagen la selecciona; ←/→ cambian el tamaño ±10 %.
- No usa `Popover` porque el asa debe quedar fija en la esquina de la imagen y un ancestro `.glass` (con `backdrop-filter`) la encerraría. Barra y asa son hermanas en el mismo `Portal`, con `useLayer` (Esc) y su propio «tocar fuera».
- Cada acción es **una escritura** por `NoteStore`; ⌘Z (fuera de campos de texto) la deshace con una pila de 50 pasos por nota. No había deshacer en la vista de documento; dentro de un bloque en edición sigue el deshacer nativo del campo.
- No se añadieron ⌘⇧L/E/R (eran opcionales).
- Pegar fuera de un bloque, soltar archivos y «/imagen» guardan el original y abren la barra.

### Exportar (A2)
- `.md` + zip: ya leía de `media/`, así que lleva el original (no se tocó). La exportación de la bóveda excluye `.app/thumbs/`.
- `.docx`: embeds en cualquier parte del párrafo, proporción real (`imageSize`) y `|ancho` (px hasta 600, o % de 600). Sin ancho: el natural hasta 420 px, como antes. `izq/der` flotan con texto alrededor (`wp:anchor`, cuadrado); `centro` centra el párrafo; el alt va al `.docx`.
- HEIC/HEIF/AVIF → JPEG y WebP/SVG → PNG, **solo para el .docx**. La hoja de exportación lista las convertidas. Si el navegador no las decodifica, se omiten.
- PDF/imprimir («PDF (imprimir)»): las miniaturas se cambian por los originales de uno en uno, esperando a que carguen; tras imprimir se restauran y se liberan, con `afterprint` y un respaldo de 2 min porque iOS no siempre lo avisa. Con ⌘P directo se imprimen las miniaturas de 1200 px.

### Rendimiento medido (Chromium sin GPU en el contenedor; no es un iPad)
- Paquete inicial: **288,0 → 293,9 KB gzip (+5,9 KB)**. El Worker de miniaturas va aparte (bajo demanda).
- 30 fotos de 2,6 MB en una nota: al abrir solo cargan 2 de 30; el alto total no salta (12 695 → 12 885 px, +1,5 %). Al desplazar la nota entera: cuadros p50 34 ms, p95 50 ms, máx. 69 ms (con rasterizado por software). Ninguna se muestra con su original (máx. 1200 px). Cifras en `e2e/out/np-30fotos.json`.
- Foto de 12 MP (9,8 MB): se ve la miniatura de 1200 px; el original solo se carga al imprimir.

### Límites y pendientes de validar en iPad real
- No hay WebKit en este contenedor: Safari no se probó aquí. Hay que confirmar si `createImageBitmap` con `resizeWidth` reduce en Safari antes de decodificar (si no, hay fallbacks) y si `OffscreenCanvas` funciona en el Worker (Safari 16.4+).
- Memoria con fotos de 12 MP reales (HEIC de la cámara), Pencil en el asa y `afterprint` en iOS.
- En las pruebas automáticas, si se teclea «/ima» + Intro sin pausa, el menú «/» a veces no recibe el Intro (fallo previo de `BlockInput`, no tocado; la prueba teclea a ritmo humano).

## Prompt 17 — Barra de herramientas del editor de notas (rama `barra-editor`, desde `main`)

### Antes de empezar (verificado)
- Ya existían y se reutilizan: el editor por bloques (`BlockInput`, `splitBlocks`, `NoteStore`), la barra de formato que aparece al seleccionar texto, el menú «/» (`SLASH`), `insertAtCursor`, `[texto]{.color}`, `saveImage`, `overlay.tsx` y `keys.ts`.
- **Notas-Pro · Fase A no estaba en `main`** (sigue en `notas-pro`, pendiente de prueba en iPad). Para no duplicar la sintaxis `![[foto|ancho|izq]]`, su barra de imagen ni su asa, `barra-editor` = `main` + ese commit. **Unir `barra-editor` a `main` trae también la Fase A.**

### Sintaxis nueva
- `++subrayado++`, `[texto]{.grande .rojo}` (varias clases de dos listas cerradas) y ` {.centro|der|justificado}` al final de un párrafo o título. Ver `docs/SPEC.md` §4.
- Se extendió el mismo mecanismo que `==resaltado==` y `[texto]{.color}` (regla en línea de markdown-it). La alineación es una regla del núcleo que quita la marca del texto y pone la clase `al-*` en el `<p>`/`<hN>`. Se omite en los párrafos internos de las listas, así que en una lista la marca queda literal.
- Sanitización: un gancho de DOMPurify deja en `class` solo una lista cerrada (`callout`, `callout-t`, `wl`, `cloze`, `hidden`, `c-*`, `t-*`, `al-*`, `language-*`); cualquier otra clase se descarta. Se probó con textos hostiles.
- Exportar: el «.md compatible» convierte las marcas a HTML o las quita; el `.docx` lleva subrayado, tamaño (medios puntos 19/28/36) y alineación del párrafo.

### Edición (puro, `src/notes/format.ts`)
- Alternar marcas sin cortar `[[ ]]`, `![[ ]]` ni código en línea. Sin selección, actúa sobre la palabra bajo el cursor. No se envuelven los espacios de los bordes. Si la selección cruza líneas, se marca línea por línea, después de la viñeta, `>` o `#`.
- Color y tamaño editan la misma marca `[…]{…}`; volver a elegir el mismo valor lo quita.
- Estilo de párrafo: normal, H1–H3, cita, código o callout; conserva la alineación.
- Listas, tareas y sangría; mover un elemento de lista con sus hijos.
- Tablas GFM: insertar 1×1 a 6×6, filas, columnas, alineación de columna y «Ajustar columnas» (texto alineado). La fila de encabezado es obligatoria en GFM, así que no se ofrece quitarla.
- Bloques: mover (también «sección completa» bajo un título, desde «Más»), duplicar, eliminar y combinar con el anterior.

### Barra (`src/notes/editorbar.tsx`)
- Es parte del editor: `position: sticky` arriba de la nota (bajo la barra superior; arriba del todo en pantalla completa, en iPhone y dentro de un panel de Espacios), con una sola superficie `.glass strong` y `--z-panel` (por debajo de hojas y modales).
- Un renglón de alto constante con desplazamiento horizontal. «Más» (menú «/» y mover sección) y plegar siempre a la vista en el extremo.
- Plegada = franja del mismo alto con deshacer, rehacer, negrita y desplegar, así que plegar no mueve el texto. El estado se guarda en `engrama.notesUI` (por dispositivo). Por defecto está plegada si la ventana mide menos de 560 px de alto o el panel de Espacios menos de 420 px.
- Sin bloque en edición, los botones de texto quedan desactivados al 38 % (no se ocultan). Los de bloque actúan sobre el último bloque tocado. En la vista Markdown actúa sobre el párrafo del cursor.
- Botones de 44×44, `aria-pressed` en los alternables, un solo tab-stop con flechas/Inicio/Fin. El tooltip toma el `aria-label`, que incluye el atajo configurado.
- `visualViewport` desplaza la barra lo que la vista visible se haya movido (teclado del iPad/iPhone). No se puede probar aquí: hay que verlo en el dispositivo.
- El estado (marcas activas, estilo, tabla bajo el cursor) se recalcula con una pausa de 60 ms tras `selectionchange`/teclas/clic, no en cada evento.
- La barra flotante de selección (cloze/básica) se conserva y usa las mismas funciones (`toggleMark`, `setSpanClass`).

### Historial (`src/notes/history.ts`)
- Deshacer/rehacer por nota, en memoria: cada acción de la barra es un paso y lo tecleado seguido (< 1 s) se agrupa. ⌘Z/⌘⇧Z usan este historial también dentro del campo del bloque, porque el campo controlado pierde el deshacer nativo al reescribirse.
- Sustituye la pila propia de la barra de imagen (Notas-Pro · A4).
- El historial de versiones en disco no cambió.

### Atajos (ámbito nuevo «Editor» en Ajustes → Atajos)
- ⌘B, ⌘I, ⌘U, ⌘⇧X (tachado), ⌘⇧H (resaltar), **⌘⇧K enlace** (⌘K es la paleta), ⌘⌥1/2/3 (títulos), ⌘⌥↑/↓ (mover bloque), ⌘Z/⌘⇧Z y **⌘⌥B plegar la barra** (⌘⇧T lo reserva Safari).
- Solo actúan en el editor activo (puede haber varios: pestaña y paneles del lienzo) y con el foco dentro de él.
- `bindingOf` usa la tecla física con ⌥, porque en Mac ⌥1 escribe «¡». Ningún atajo existente usaba ⌥ con letras o números, así que no cambia nada.

### Mover sin romper tarjetas ni enlaces
- Mover copia el bloque tal cual: los `^id` de tarjetas y los `[[nota#sección]]` no cambian.
- La **cobertura de párrafos** usa el número de párrafo (`<!-- src: nota.md#pN -->`). Tras cada acción de la barra (y al deshacer/rehacer) se empareja cada párrafo por contenido (`paraMap`) y se reescribe N en los mazos que lo citan, por SafeVault (`src/notes/sources.ts`). Lo tecleado no lo hace, igual que antes.

### Fallos previos encontrados
- **Corregido:** un `BlockInput` ya desmontado podía cerrar con su temporizador de «perder foco» la edición del bloque siguiente (y `onSelect` leía un campo ya desmontado). Pasaba al cambiar de bloque deprisa y con la barra se volvía frecuente. Se corrigió con una comprobación de `ref.current`.
- **Sin tocar (fuera de este prompt):** en `main`, Intro al final de un bloque no añade la línea nueva, porque el `\n` final se pierde al volver a dividir el texto en bloques. Shift+Intro tampoco. Se escribe una línea nueva en medio del texto o en la vista Markdown.

### Tamaño y pruebas
- Paquete inicial (gzip): `main` 288,0 KB → con Notas-Pro · A 293,9 KB → con la barra **297,9 KB (+4,0 KB)**. La barra, el historial y las funciones de edición van en el fragmento de Notas, que se carga bajo demanda. Al paquete inicial solo entran el render (subrayado, tamaño, alineación y el filtro de clases) y los atajos nuevos.
- Batería completa en verde (Chromium; no hay WebKit en el contenedor): `typecheck`, 262 pruebas unitarias, `e2e`, `flows`, `design`, `mejoras`, `mejoras2`, `phone`, `bloquec`, `p5`, `p6`, `p7`, `p10`, `p12`, `p15`, `perf`, `notaspro` y `barra` (72 comprobaciones). `MODE=compare e2e:phone` contra `main`: 0 píxeles en 36 capturas. Esas capturas no abren ninguna nota, así que la barra no aparece en ellas; no hay diferencia esperada.

### No hecho o pendiente
- Arrastrar bloques por un asa (era opcional).
- Quitar la fila de encabezado de una tabla (GFM la exige).
- Cambiar el tipo de tarjeta o de callout desde la barra (el callout entra como `[!note]`; el tipo se cambia en el texto).
- No probado en WebKit ni en un iPad real: teclado virtual (`visualViewport`), Pencil, Stage Manager y gesto de selección de iOS.
## Mini prompt — Mini reproductor unificado y que suene (rama `fix-reproductor`)

### Causas (verificadas en el código; el oído solo en un dispositivo real)
- **Sin `navigator.audioSession`**: la mezcla en vivo usa Web Audio, que Safari en iPhone/iPad trata como «ambiente»: el **interruptor de silencio** la apaga y puede ir al auricular. Ahora, dentro del gesto de Reproducir, Reanudar, Probar sonido y de la música: `navigator.audioSession.type = 'playback'` (Safari 16.4+, con detección; en otros navegadores no existe).
- **La música llamaba a `play()` después de leer todos los archivos** (`await mediaUrl` por pista): en Safari el gesto ya se había perdido y el `.catch(() => {})` lo escondía. Ahora `player.prime()` crea el `<audio>` y lo «desbloquea» con 50 ms de silencio (`blob:` WAV, permitido por la CSP `media-src blob:`) **en el mismo clic**; después se leen las pistas y se reproduce en ese elemento. En Chromium con `--autoplay-policy=user-gesture-required` el primer `play()` ocurre ~1 ms tras el clic; Chromium conserva la activación unos segundos, así que el fallo original solo se ve en Safari.
- **Errores tragados**: un `play()` rechazado (`NotAllowedError`, `NotSupportedError`) ahora avisa con la causa (`onAudioError` → toast traducido) y deja el estado en «detenido»; `AbortError` (cambiar de pista) no es un error.
- **Silencio pegado**: «Solo durante el enfoque» silenciaba si la fase del pomodoro no era «trabajo» aunque el pomodoro estuviera **detenido** (por ejemplo, parado en un descanso): ahora solo silencia con el pomodoro en marcha. `master` arranca en el volumen objetivo al reproducir.
- **Contexto suspendido o «interrumpido»** (bloqueo, llamada, cambio de salida, AirPods): se reanuda en `visibilitychange`, `statechange` del `AudioContext` y `devicechange` de `navigator.mediaDevices`, solo si se estaba reproduciendo.
- **«Probar sonido»** en el panel: un tono de 0.4 s a volumen bajo; si el contexto no queda en `running`, el aviso dice su estado.
- **Media Session única** para ambiente y música (reproducir/pausar actúan sobre lo que sonaba; anterior/siguiente sobre la música).
- **Descartado**: selector de salida (`setSinkId`): sin permiso de micrófono los dispositivos no tienen nombre, así que no se ofrece (no se piden permisos extra). Volumen por defecto: Reproducir sigue desactivado hasta subir un volumen y dice por qué; el mini solo aparece si algo suena o quedó en pausa.

### Mini reproductor: una sola pieza
- `MiniAmbient` es **una superficie `.glass`** (un solo `backdrop-filter`) que crece en el mismo contenedor (antes: píldora + `Popover` aparte). Píldora: barras, título y reproducir/pausar; expandido: una línea por motor (ambiente y música), anterior/siguiente, progreso de la pista, volumen general y de capas, «Abrir panel». Se expande con el cursor (150 ms), el foco del teclado o un toque; se pliega al salir (300 ms), con Esc o al tocar fuera. Nunca inicia audio al pasar el cursor.
- Posición fija en la esquina inferior derecha (por `Portal`, `--z-dock`), por encima del teclado (`--kb-inset`); en el lienzo sube por encima del minimapa y su botón. Crece hacia arriba: la esquina no se mueve. En el teléfono sigue sobre la barra inferior.
- Pruebas: `tests/ambient.test.ts` (silencio/atenuación, reanudación, rechazo → aviso y detenido, `audioSession`) y `npm run e2e:reproductor`.

### Sin verificar sin audio real
Que suene de verdad por el altavoz con el interruptor de silencio activado y desactivado, con AirPods/Bluetooth y al cambiar de salida en plena reproducción (iPad/iPhone), y en Mac/Windows. WebKit no está instalado en el contenedor: las e2e corrieron en Chromium.
## Mini prompt — Minimizar del panel «Adherencia» (rama `fix-adherencia-minimizar`)
En la versión recortada (`.heat-panel.fit`, ancho ajustado) el botón seguía anclado a `.mh`, que ocupa toda la fila, y quedaba fuera del vidrio; ahora `.mh:has(> .heat-panel.fit) { width: fit-content }` lo deja en la esquina del panel (solo CSS; `:has()` ya se usaba; Safari ≥ 15.4). Ningún otro panel de Hoy tiene un hijo de ancho ajustado dentro de `.mh`. `npm run e2e:adherencia`; en `e2e:phone`, Hoy solo cambia en la franja de 36 px del botón.
## Mini prompt — Rendimiento del vidrio y botón «Añadir examen» (rama `fix-glass`, desde `main`)

### Medición (`node e2e/glass-perf.mjs`, Chromium headless con GPU por software; WebKit no está instalado)
| Escenario | Superficies con `backdrop-filter` visibles | fps | Sin ningún `backdrop-filter` (experimento) | Sin sombras (experimento) | Sin `saturate` (experimento) |
|---|---|---|---|---|---|
| Hoy, 6 mosaicos, foto de 2400 px, desplazando | 12 | 28 | 61 | 36 | 29 |
| Espacios, 4 paneles, paneo y zoom | 10 (0 dentro del lienzo, también durante el gesto) | 59 | 61 | 61 | 60 |
| Notas, nota larga (400 bloques), desplazando | 10 | 44 | 61 | 47 | 46 |

El pintado en el hilo principal es casi nulo (1–4 ms); el costo es el desenfoque de las superficies que se mueven sobre el fondo fijo, que se rehace en cada fotograma (composición). En Espacios no hay costo: `.canvas-wrap` es `.glass.flat` y la regla `.glass .glass` ya quita el desenfoque de los paneles (desde antes), y `will-change` del plano ya solo existe durante el gesto (Prompt 11).

### Aplicado
- **«Intensidad del vidrio» gobierna también `.glass.strong`** (y su versión de iPhone): `blur(calc(40px * min(1, var(--k) / .7)))`. Al valor por defecto (70 %) es exactamente 40 px (0 píxeles de diferencia); al 0 % no hay desenfoque y el costo baja. Antes las superficies fuertes ignoraban el control.
- **Modo ligero**: además de quitar todo `backdrop-filter` (comprobado en 7 pantallas), cambia la sombra grande por una corta.
- **Aviso de modo ligero**: ya existía (`watchFrames`, 1 s y < 40 fotogramas). Ahora mide ~3 s con la **mediana** de los intervalos (sin falsos avisos si se deja de desplazar), escucha también el desplazamiento dentro de paneles y la nota trae la acción «Activar modo ligero» (nunca se activa solo; una vez por sesión).

### Descartado (con motivo)
- **Tope de ~4 superficies con desenfoque** y **bajar el radio de `.glass.strong`**: cambian el aspecto en reposo (las superficies planas o menos difuminadas se ven distintas) y la regla es 0 píxeles. Son las que más ahorrarían fuera del lienzo (Hoy 28 → 61 fps sin desenfoque); quedan como decisión de diseño pendiente.
- **Vidrio «congelado» durante gestos (`is-gesturing`)**: en el lienzo los paneles ya no tienen desenfoque (medido: 0 durante el gesto), así que no aporta. Aplicarlo al desplazamiento de página haría parpadear el vidrio a plano al desplazar.
- **Quitar `saturate`**: sin efecto medible (28 → 29 fps).
- **Promover capas** (`translateZ(0)` en el fondo, `isolation` en barras): dentro del ruido (28 → 31, 44 → 41).
- **Sombras más simples fuera del modo ligero**: +8 fps en Hoy, pero cambian el aspecto en reposo.
- **iPhone (`is-phone`) con menos desenfoque**: cambia el aspecto en iPhone, que también debe quedar en 0 píxeles.
- **`contain`/`content-visibility` en listas y paneles fuera de pantalla**: los paneles fuera de pantalla ya no montan contenido (Prompt 11); las notas largas lo tienen en la rama del Prompt 14 (aún no en `main`).

### «Añadir examen» (causa verificada)
Era un `.btn` suelto sobre el fondo (relleno de ~6 %, sin `.glass`): con los 5 fondos de prueba × 2 modos fallaban las 20 combinaciones (botón contra su alrededor 1–2:1; texto de 1:1 a 2:1 cuando el modo forzado no coincide con el fondo). El encabezado «Exámenes» de Estadísticas, a su lado, tenía el mismo problema.
- `AddExamButton` → `btn primary` (relleno invertido, sin color) con `Plus`.
- **Hoy**: dentro de una píldora `.glass` (`.exam-add`, la cubre el guardián) y, si no hay exámenes próximos, con una ayuda («Añade tu próximo examen…», es/en/fr).
- **Estadísticas**: el encabezado «Exámenes» + botón pasa a `row glass panel`, como el resto de secciones. Tamaño normal (44 px), no `small` (36 px): las dos variantes pasan contraste, pero `small` incumple el objetivo táctil.
- Prueba `e2e:glass`: las 20 combinaciones × 2 pantallas pasan (botón ≥ 3:1 con su alrededor, texto ≥ 4.5:1, medido en píxeles de la captura).
- **Auditoría** de `.btn` fuera de `.glass` en 13 pantallas: solo «Añadir examen» (Hoy, Estadísticas) y los botones «Minimizar …» de los mosaicos de Hoy, que en el DOM están fuera del vidrio pero se dibujan sobre la esquina del mosaico (que sí es vidrio) y se leen bien. No se añade la regla global de respaldo `.btn:not(.glass .btn)`: cambiaría esos botones sin necesidad.

### Píxeles (`MODE=compare npm run e2e:phone` contra `main`)
27 de 36 capturas de iPad y web con 0 píxeles de diferencia. Cambian solo Hoy (+77 px de alto: la píldora con la ayuda), Estadísticas (+38 px: el encabezado de vidrio) y «bandeja» (sin el add-on muestra Hoy), por el arreglo del botón. La suite de iPhone pasa. Rendimiento con los ajustes por defecto: igual dentro del ruido (Hoy 28 → 27 fps, Espacios 59 → 55, Notas 44 → 40, en `docs/perf/vidrio-*.json`), porque las reducciones que ahorrarían cambian el aspecto; con el modo ligero, 61 fps en los tres.

### Límites y lo que falta validar en iPad real
- La medición definitiva es en el dispositivo: fotogramas al desplazar Hoy sobre una foto y al hacer paneo con 4 paneles. Chromium headless compone por software y exagera el costo del desenfoque.
- El Chromium de las pruebas no aplica `prefers-reduced-transparency` aunque se emule: la regla CSS sigue igual que antes, sin verificar aquí.

## Prompt 14 — Asa de redimensionar, notas pesadas e imágenes grandes (rama `fix-lienzo-rendimiento`)

Medición: `node scripts/note-fixtures.mjs` (N1 = 500 bloques/104 KB, N2 = 3 000/654 KB, N3 = 10 000/2.2 MB, con listas, tablas, callouts, wikilinks, 30 imágenes de 1–3 MP, 5 dibujos y bloques `query`; imágenes de 2, 12, 24 y 48 MP en JPG y PNG) y `npm run e2e:notas-perf`. Chromium headless (WebKit no está instalado en el contenedor). Cifras completas en `docs/perf/notas-*.json` e `imagenes-*.json`.

### 1 · Asa de redimensionar
- **Causa (reproducida)**: el asa estaba dentro de `.win-body`, el contenedor que se desplaza; al bajar por una nota subía con el contenido (74 333 px por debajo del borde del panel al final de N1).
- **Cambio**: las asas son hijas de `.win`: esquina (dibujo de 22 px como antes; zona de 44 px con puntero grueso) y bordes derecho e inferior. `preventDefault` + `setPointerCapture`: no desplazan la nota ni abren el teclado. No se muestran en pausa ni en el teléfono. En paneles con nota, 22 px de relleno inferior para que el asa no tape la última línea; **solo en notas**: aplicado a todos, volvía desplazables los paneles de imagen y el paneo con 4 imágenes bajaba de ~55 a ~45 fps (cada área desplazable es otra capa).
- `npm run e2e:p14` (asa): nota, PDF, documento y hoja; escala 1, 0.5 y 2; scroll arriba, a mitad y al final; ratón, táctil y Pencil.

### 2 · Notas pesadas
- **Causa (perfil de CPU)**: cada tecla volvía a convertir y sanear **todos** los bloques, y DOMPurify reprocesaba su configuración en cada llamada (≈ 2 s de los 4 s por tecla en N2).
- **Cambios**: instancia de DOMPurify con la configuración fijada una vez (mismas reglas, prueba de igualdad); caché LRU de HTML ya saneado por bloque (`renderMarkdownCached`, 20 000 entradas); bloques con `memo`; consultas `query` solo cuando cambian sus datos; cobertura y esquema con el texto «asentado» (400 ms); tramos de 40 bloques con `content-visibility: auto` en notas de más de 80 bloques (en las cortas nada cambia; al imprimir se pintan todos; «Buscar en esta nota» recoloca la coincidencia al llegar); imágenes de la nota al acercarse a la pantalla, con préstamo de URLs (`acquireMediaUrl`/`releaseMediaUrl`: se revocan al cerrar la nota) y carga de todas antes de imprimir; índice de búsqueda ~1 s tras la última tecla; aviso suave en notas de más de 1.5 MB o 5 000 bloques.
- **El archivo guardado es idéntico byte a byte** al de la rama base tras la misma edición (`npm run e2e:p14` guardado, comparado con sha256).

| Pestaña Notas | Antes | Después |
|---|---|---|
| N1: abrir · tecla p50 / p95 | 553 ms · 231 / 483 ms | 251 ms · 22 / 58 ms |
| N2: abrir · tecla p50 / p95 | 1 687 ms · 1 365 / 2 922 ms | 702 ms · 15 / 22 ms |
| N3: abrir · tecla p50 / p95 | 5 821 ms · 4 274 / 8 512 ms | 1 810 ms · 19 / 43 ms |
| N2 en dos paneles del lienzo: tecla p50 / p95 | 2 506 / 4 931 ms | 20 / 82 ms |
| «Ver Markdown» en N3: tecla p50 | — | 44 ms (usable: sin aviso) |
| Desplazar (fps) N1 / N2 / N3 | 30 / 32 / 31 | 30 / 28 / 32 |
| `blob:` creadas al abrir | 29 | 0 |
| Memoria tras 5 min escribiendo y desplazando N2 | — | 56 → 59 MB (estable) |

El desplazamiento queda igual: Chromium headless no pasa de ~30 fps al desplazar una página en este contenedor, también con N1. Buscar en N3 tarda lo mismo (~1.5 s; recorre 75 000 nodos de texto). Las `blob:` crecen hasta el número de imágenes de la nota mientras está abierta (30 en la prueba) y se devuelven al cerrarla.

### 3 · Imágenes grandes en el lienzo
- **Causa**: el panel ponía el original completo (hasta 48 MP: ~190 MB decodificados) y su `blob:` no se liberaba nunca.
- **Cambio** (`src/lib/imgview.ts`): versión al ancho del panel × densidad (escalones 640/1 280/2 560 px) en `.app/cache/img/` (regenerable; nunca en `media/` ni sobre el original), medidas leídas de la cabecera sin decodificar, versión mayor al acercar y original solo con «Ver original» (no si supera ~16.7 MP, límite de Safari: aviso). Zoom y arrastre propios (`data-own-zoom`, como el PDF). Las URL se devuelven al cerrar o dormir el panel. `saveImage` ya reducía a 2 000 px al importar; las imágenes que ya estaban no se tocan.

| Imagen en un panel | Antes | Después |
|---|---|---|
| Mostrar 12 MP JPG · 48 MP PNG (primera vez) | 66 · 1 280 ms | 125 · 683 ms |
| Píxeles decodificados | el original (hasta 48 MP) | 0.3 MP (640 × 480) |
| Reabrir (p50) | 10 ms (original retenido) | 33 ms (desde la caché) |
| `blob:` retenidas tras abrir y cerrar 20 | 6 (originales de hasta 25 MB) | 0 |
| Paneo y zoom con 1 / 2 / 4 imágenes (fps) | 49 / 50 / 51 | 50 / 55 / 55 |

### Descartado o pendiente
- **Dibujos como miniatura hasta tocarlos**: con 5 dibujos por nota el impacto no fue medible; montarlos solo al tocar cambiaría el trazo directo con Pencil (el primer trazo se perdería).
- **«Dividir en varias notas»**: pendiente; el aviso de nota gigante sugiere dividirla.
- **`width`/`height` en las imágenes de la nota** para evitar saltos: las medidas no están en el Markdown; los tramos con `contain-intrinsic-size: auto` recuerdan la altura medida.
- **Límites de Safari**: `content-visibility` desde Safari 18; `navigator.share`/impresión con Cmd+P no espera a las imágenes perezosas (el botón de imprimir sí); `createImageBitmap` con `resizeWidth` puede ignorarse en Safari antiguos y entonces se reduce dibujando en un lienzo.

### Fallo intermitente encontrado en la regresión (y corregido)
`e2e:mejoras` (renombrar una nota) y `e2e:p6` (mover a «Arritmias») fallaban a veces: al abrir «Nueva nota», el foco pasaba al título en el siguiente fotograma aunque ya se estuviera escribiendo en Materia o Tema, y ese texto acababa en el título (y se perdía). Con las notas más rápidas, la prueba escribía justo en ese fotograma. Ahora el título solo toma el foco si no se está ya en otro campo. Tras el arreglo: `e2e:mejoras` 10/10 y `e2e:p6` 5/5 (antes ~1 de 4 y ~2 de 3 fallos).

### Lista para iPad real
Nota larga desplazada y asa en un panel del lienzo (dedo y Pencil); nota de ~1 MB en pestaña y en panel; foto de 12 MP y de 48 MP en un panel; paneo y zoom con 4 paneles; escribir con el teclado en pantalla.

## Mini prompt — Exportar nota a PDF con las hojas negras (rama `fix-pdf-negro`)
**El papel siempre es claro.** Causas reales (reproducidas con `page.pdf` de Chromium y `pdftoppm`): (1) `html { background: #000 }` se imprimía en cada hoja con «gráficos de fondo» (Safari los guarda por defecto): 99 % de píxeles negros en oscuro y 74 % en claro; (2) se imprimía la app entera (explorador, barra de la nota, inspector) con su rejilla de pantalla, y la nota quedaba en una columna de una letra: 148 páginas y texto incompleto. Cambio, solo en `@media print`: `html, body` blancos con `color-scheme: light`, tokens de papel en `:root` y `[data-glass]` (ambos modos), sin vidrio ni `backdrop-filter`, bloques de código, tablas, citas y callouts claros con borde fino, colores de texto legibles en papel; y el botón «PDF / imprimir» marca su nota (`.print-target` + `html.printing-note`; Cmd+P marca la nota abierta en `beforeprint`, `afterprint` lo quita): se oculta todo lo que no la contiene y sus contenedores dejan de ser rejillas, scroll o capas fijas, así que pagina (5 páginas para una nota de ~70 bloques), también desde un panel de Espacios. `npm run e2e:pdf`: {oscuro, claro} × {foto, sólido} × `printBackground` {sí, no} con ≤ 1.2 % de píxeles oscuros por página y el texto completo. Sin verificar: el diálogo «Guardar como PDF» de Safari en iPad (el PDF de la prueba es de Chromium).
- Encontrado de paso, sin tocar: abrir un archivo con `#/espacios/abrir/…` a veces crea el panel dos veces (también en `main`, ~1 de 6 en `e2e:p14`). Y en `e2e:p14` la prueba del asa movía el lienzo solo si la esquina salía por la derecha o por abajo; ahora la lleva siempre a un punto fijo (a veces un panel nuevo quedaba fuera por la izquierda).
## Unión de Notas-Pro · A y Prompt 17 con Prompt 14 (rendimiento de notas e imágenes)
- **Medios en notas (`src/ui/md.tsx`)**: estructura del Prompt 14 (un solo `IntersectionObserver` para toda la app, `hydrateAllMedia` antes de imprimir, préstamo de URL para el audio). Las imágenes usan la miniatura de la Fase A (`mediaThumbUrl`, caché `.app/thumbs/`), con el alto reservado (`dims.json`) y el marcador para formatos que el navegador no muestra.
- **Bloques**: tramos con `content-visibility` y `ViewBlock` memorizado del Prompt 14. El bloque lleva además `data-block` y el toque sobre una imagen la selecciona (callback estable, para no romper el `memo`).
- **Imprimir**: primero `hydrateAllMedia` (Prompt 14), después el cambio a originales de uno en uno (Fase A).
- **Sanitización**: el Prompt 14 sanea con una instancia propia de DOMPurify (`DOMPurify()` con la configuración fijada una vez). El filtro de clases del Prompt 17 se registra en esa misma instancia: en la instancia por defecto no se aplicaba. Lo cubren las pruebas de sanitización.
- **Dos cachés de imágenes, a propósito y por ahora**:
  - `.app/thumbs/` (Fase A): miniatura de 1200 px para notas.
  - `.app/cache/img/` (Prompt 14): versiones de 640/1280/2560 px según el ancho del panel del lienzo, con «Ver original».
  - Las dos son regenerables y ninguna viaja en el respaldo.
  - Unificarlas (una función con escalones, el `imageSize` con orientación EXIF de la Fase A y la conversión de HEIC) es una refactorización pendiente, que no se hizo dentro de una unión.
  - Ya no es cierto que `saveImage` reduzca a 2000 px: ahora guarda el original salvo con «Calidad: Optimizada». Por eso la versión reducida del lienzo importa más.
- **Borrar intentos de simulacro** (`fix-borrar-intento`): `deleteAttempt` quita solo la línea con ese `id` de `.app/exam-attempts.jsonl` (las dañadas se quedan; si el `id` no está, no escribe) vía SafeVault; el deshacer (toast de 8 s) guarda la línea en memoria y la reinserta en su posición, byte a byte. Sin copia en papelera: un intento es un registro derivado, no contenido del usuario, y el diario de SafeVault ya protege la escritura. Pendiente aparte: el calendario coloca los simulacros por el día local del navegador, no por la zona y hora de inicio de día de Ajustes.

## Prompt 19 · 1: «Compartir estadísticas»

- **Canvas 2D propio, sin `html2canvas`/`html-to-image`.** Copiar el DOM no reproduce `backdrop-filter` en Safari, arrastra fuentes y estilos externos, y añadiría una dependencia. Dibujar directo es más pequeño (la hoja y el compositor ocupan unos 5 KB gzip y se cargan con `import()` al pulsar el botón), da píxeles exactos (1080×1920, 1080×1350 y 1080×1080 a 1×) y no captura la pantalla.
- **El fondo no se duplica.** `paintBackground` (en `src/ui/background.tsx`) es la misma cuenta que usa el guardián de legibilidad para su muestra: fondo integrado dibujado a la mitad del ancho (como la capa), foto con `framedRect`, desenfoque con el 1.08 de la capa y velo de atenuación. La foto se decodifica una vez mientras la hoja está abierta y se suelta al cerrar.
- **Desenfoque.** Se usa `ctx.filter = blur()` si el navegador lo aplica (se comprueba leyéndolo de vuelta). Si no, se reduce la imagen y se vuelve a ampliar con suavizado: una aproximación barata que se ve igual en todos los navegadores.
- **Contraste.** El compositor mide el panel ya desenfocado (celdas de 24 px) con `panelContrast` y sube la opacidad del vidrio en pasos de 0.04 (hasta 0.96) hasta que el texto secundario llega a 4.5:1. El color del fondo nunca se toca. `e2e:share` lo comprueba con 5 fondos × 2 modos.
- **Cifras.** Canvas 2D no tiene `font-variant-numeric`, así que las cifras usan la pila de fuentes de la app tal cual. La jerarquía se da por tamaño y peso; los números largos se encogen hasta caber en su columna.
- **Sin publicación directa a Instagram.** No existe API web para publicar. «Compartir» llama a `navigator.share({ files })` dentro del gesto, con el `File` ya preparado (con espera de 220 ms tras cada cambio de opciones). La hoja del sistema es la que ofrece Instagram. Sin `share` de archivos, o con `NotAllowedError`, se descarga y se avisa. `AbortError` (el usuario canceló) no es un error.
- **Marca en la imagen.** `public/brand/logo-mark.png` se deriva en `scripts/icons.mjs`. El alfa sale de la luminancia sobre el fondo muestreado (`#000006`) con una clave suave, y el color se des-premultiplica, así que no queda halo oscuro. Se recorta a la caja del logo con 4 % de margen y 512 px de lado mayor. El original `assets/brand/logo-original.png` no cambia (mismo hash). En la imagen, el alfa se usa como máscara y se pinta con el color de texto del tema activo (`--t1`: blanco en oscuro, negro en claro). Esta variante **monocroma existe solo para la imagen compartida**: el logo de la interfaz (con su recuadro oscuro) no cambia. Las partes del símbolo que en el original se funden con el negro quedan como transparencia, que es como se ven en el original.
- **Privacidad.** Por defecto, nombre y foto solo si existen en el perfil; carrera y lema, apagados. Las opciones se guardan en `settings.json` → `share`: campo nuevo, opcional y normalizado (valores inválidos vuelven al defecto).
- **Teléfono.** El botón queda solo con icono y la hoja en una columna, ambos bajo `html.is-phone`. En `e2e:phone` cambia solo el encabezado de Hoy (el botón nuevo), en iPad y web; es la diferencia esperada.
- **@usuario (revisión del Prompt 19).** Clave de frontmatter `usuario` en `profile/perfil.md`, en español como las demás, perezosa (solo se escribe con valor; los perfiles viejos se leen igual). Se guarda sin `@` y se muestra con `@`. Validación local (3–30 caracteres, letras con acentos, números, `_` y `.`, sin `..` ni punto en los extremos). No hay cuentas ni unicidad: es una etiqueta para las imágenes.
- **Lugar sin GPS.** «¿Dónde estás estudiando?» es solo texto que escribe el usuario: `navigator.geolocation` y la geocodificación necesitarían red y expondrían la ubicación real. Los últimos 5 lugares viven en `settings.json` → `share.places` (en el dispositivo, borrables con «Olvidar lugares»). El campo se limpia al cerrar salvo «Recordar el último lugar» (apagado), para no compartir sin querer un lugar viejo. En la imagen va bajo el nombre/@usuario, dentro del encabezado (así respeta la zona segura de Historia), recortado a 40 grafemas.
- **Iconos vectoriales en la imagen.** El fuego de la racha y el pin del lugar son los trazos de Lucide (ISC) dibujados con `Path2D` (grosor 2 en la caja de 24, como en la app), no emojis: se ven igual en todo dispositivo. El fuego usa el color de texto del tema, nunca el acento, y se atenúa con racha 0. Se mide el número antes de colocarlo.
- **Campos nuevos a 44 px.** Los campos de texto de la app miden 40 px (`.input`); los dos nuevos (@usuario y lugar) suben a 44 solo dentro de `.at-input`, como hizo Tareas, sin tocar los demás.

## Prompt 19 · 2: add-on «Tareas»

- **Archivo `notes/Tareas.md`** (en lugar de `tasks/tareas.md`): así aparece en Notas, se busca, se enlaza con `[[Tareas]]`, se exporta y se respalda como cualquier nota, sin un árbol aparte. El mosaico y el editor de Notas comparten el mismo documento de `noteStore`, así que lo que se escribe en uno aparece al instante en el otro, y se guarda con SafeVault.
- **Formato Markdown estándar**: `- [ ]`/`- [x]` (también `*`/`+` y `[X]` al leer), subtareas con 2 a 4 espacios o un tabulador (un nivel) y fecha opcional ` 📅 AAAA-MM-DD` al final, la sintaxis prevista en Notas Pro. Notas Pro aún no tiene analizador de tareas, así que este (`src/tasks/parse.ts`) es el que debe reutilizar. Solo se reescriben las líneas de tarea que el usuario toca; títulos, texto libre y frontmatter quedan igual. Activar el add-on no crea el archivo: se crea con la primera tarea.
- **Orden**: el archivo manda. En «Todas», las hechas de primer nivel se muestran en su propio bloque al final, sin moverlas en el archivo. Reordenar (asa con Pointer Events o Alt + ↑/↓) solo cambia hermanas del mismo bloque contiguo, con sus subtareas; nunca cruza texto libre.
- **Borrar** se puede deshacer desde el aviso. «Borrar completadas» pide confirmación. Las vencidas llevan icono y el texto «Vencida», no solo un tono.
- **Sin integración con Calendario ni con «Pendientes»** por ahora: no es barata sin tocar su modelo de datos. Queda para después.
- **Apagado = cero costo**: `src/tasks/tile.tsx` se carga con `import()` solo si el add-on está activo; el contador de la bandeja sale del mismo fragmento (`TasksCount`).

## Prompt 19 · 3: add-on «Sticky notes»

- **Cada sticky es una nota**: `notes/Stickies/<id>.md` (id = instante en base 36), con frontmatter `sticky: true`, `orden`, y opcionalmente `color`, `fijada` y `archivada`; las claves desconocidas se conservan. El explorador de Notas la muestra en la carpeta «Stickies» como cualquier otra (sin árbol duplicado), así que se busca, se enlaza, se exporta, se respalda y se abre en el editor completo. Se escribe por `noteStore` (el mismo documento que en Notas, guardado con SafeVault).
- **Eliminar** la manda a la papelera de notas (`trash`) y «Deshacer» la restaura. **Convertir en nota** la mueve a `notes/<primera línea>.md` (`safeSegment`, con sufijo si ya existe) y quita solo las claves de sticky. Los enlaces `[[…]]` que apuntaban a la sticky no se reescriben (son raros); queda anotado. **Archivar** la oculta del mosaico, con un botón «n archivadas» para verlas.
- **Color = contenido del usuario**: se elige por sticky entre la paleta de Notas (`COLORS`); por defecto, neutra. El color pinta solo el «papel» (`data-user-content`), como pastel opaco con texto `#111` (≥ 12:1, sin depender del fondo, porque no lo deja ver). El asa y el menú quedan neutros y sin color de interfaz.
- **Un solo `backdrop-filter`** (el del mosaico): las stickies no llevan desenfoque propio. Sin rotación (la opción de rotarlas queda fuera, porque no aporta y complica el arrastre).
- **Reordenar**: arrastrando el asa (Pointer Events con captura) o con Alt + flechas; se renumera `orden` de 10 en 10 y solo se escriben las que cambiaron. Las fijadas van siempre primero y no se mezclan con las demás.
- **Límite**: se muestran 50 y «Mostrar n más»; dentro de cada sticky, tope de alto con desplazamiento.
- **Fuera por ahora**: soltar una sticky en el lienzo de Espacios. El panel de nota existente ya puede abrirla desde «Abrir en Notas», pero arrastrar entre Hoy y el lienzo no es barato.
- **Apagado = cero costo**: `src/stickies/tile.tsx` se carga con `import()` solo si el add-on está activo.
- **Tamaño** (gzip, contra `main` con la función 1 ya unida). La entrada de JS pasa de 91.7 KB a 96.2 KB.
  - Las claves nuevas de es/en/fr explican ~2.3 KB; los tres idiomas van en la entrada.
  - Otros ~2 KB son módulos ya existentes (atajos `lib/keys` y `ui/keys`, `io/csv` y unos iconos) que el empaquetador sacó de un fragmento compartido y metió en la entrada: se mueven, no se duplican. Ocurre en cuanto el mosaico de stickies usa el render de Markdown (`ui/md`). Ni importarlo de forma diferida ni un archivo de vista aparte lo cambió, y usar solo `md/render` subía markdown-it entero (+11 KB), así que se dejó el import directo.
  - El CSS pasa de 14.0 a 14.7 KB.
  - Los fragmentos de Tareas y Sticky notes pesan ~3.2 y ~3.4 KB y solo se descargan con su add-on activo (`e2e:tasks` y `e2e:stickies` comprueban que, apagados, no se piden).


## Simulacros: borrar bancos

- **Borrar bancos de preguntas** (`fix-borrar-banco`): papelera propia `.app/papelera-bancos/<id>/` (`src/sim/banktrash.ts`) con el patrón de la de mazos: `meta.json` primero y luego `vault.move` (SafeVault escribe el destino y después quita el original), vaciado automático con los mismos `deckTrashDays`, restaurar sin sobrescribir («Nombre (restaurado).md»). No hay papelera general en Ajustes/Almacenamiento, así que va plegada al final de Simulacros y solo aparece si tiene algo. Viaja en el respaldo (todo `.app/` salvo cachés) e integridad solo la lee. Intentos, «Reintentar errores» y el simulacro en curso usan su copia de las preguntas: no dependen del archivo. Lápiz y papelera a 44 px (no `small`: la regla de objetivos táctiles manda).

## Prompt 21-B · rendimiento (fases 3–7)
Detalle y cifras en `docs/rendimiento/03a-lotes.md` a `07-memoria.md`.
- **Diario por lotes** (`vault.batch`, `src/vault/batch.ts`, diario v2): una operación de varios archivos anota en memoria, escribe todos los temporales, **un** diario con la intención y aplica renombrando (borrados al final). Recuperación: si a alguna escritura le falta su temporal íntegro y nada se aplicó aún, se revierte; si no, se completa (cada paso es idempotente). Un diario v1 se sigue recuperando. Si el lote falla, no hay nada que deshacer: sus pasos nunca llegaron al disco.
- **Añadir sin reescribir** (`appendAt` en los backends, `SafeVault.append`, diario v3): el diario lleva los datos (pocas líneas) y su suma; aplicar = truncar en `at` y escribir, idempotente. `reviews.jsonl`, intentos y pomodoro ya no se leen ni se reescriben enteros al añadir.
- **Punto de control de FSRS** (`state.json` v2 = `at` + suma FNV del prefijo de `reviews.jsonl`): si el prefijo casa, solo se reconstruyen las tarjetas que aparecen después, cada una con todas sus entradas. Es idéntico bit a bit porque el estado de una tarjeta solo depende de sus entradas (probado con 100 000 repasos hostiles y cuatro zonas horarias). Se guarda diferido (15 s sin respuestas, al ocultar, `pagehide`) y nunca con una respuesta en vuelo.
- **Caché de textos de notas** en IndexedDB, validada por la firma del listado (tamaño + fecha de modificación): reconstruible y con versión. Solo la usan vistas de lectura y, con lectura estricta, la reescritura de referencias al mover.
- **`app.changed('notes')`**: lo que solo toca notas no recarga la colección ni la integridad. Todas las vistas escuchan los dos contadores.
- **Caché de carpetas** en el Worker de OPFS (no en la carpeta del usuario): se invalida al borrar y se reintenta sin caché ante `NotFoundError`.
- **Descartado**: paralelizar operaciones (el Worker de OPFS hace una a la vez); índice de búsqueda persistido (su costo está en el Worker, no en el camino del usuario); no reconstruir el índice al volver a Notas (sin mejora medible: revertido); replay y mazos en Worker (el replay completo ya no está en el camino normal; parsear mazos cuesta ~140 ms); caché de listados (con una carpeta del usuario, otra app cambia archivos por fuera); virtualizar listas (no son cuello).
