# Engrama

PWA de repetición espaciada (tipo Anki) + notas (tipo Obsidian) para Safari en iPad. Sin backend, sin cuentas, 100 % offline, interfaz es-MX. Especificación completa: `docs/SPEC.md` (manda sobre *qué* se construye). Decisiones y límites de Safari: `docs/DECISIONS.md`.

## Stack
TypeScript estricto · Vite 8 · Preact 11 (JSX vía `jsxImportSource`, sin Babel) · ts-fsrs · markdown-it + DOMPurify · minisearch · fflate · lucide-preact. Bajo demanda (`import()`/Worker): pdfjs-dist, mammoth, turndown, docx, sql.js. Vitest + Playwright (WebKit si existe; si no, Chromium).
Diseño: tema **Cristal** (`docs/DESIGN.md`, `src/theme-cristal.css`): la interfaz no tiene color; solo el fondo, los emojis y un **acento opcional** limitado a los usos que elige el usuario (`html.acc-*`). Logo: `assets/brand/logo-original.png` (no se modifica; todo se deriva con `scripts/icons.mjs`).

## Reglas no negociables
- Los archivos del usuario (`.md`, `.jsonl`, `.json`) son la fuente de verdad. IndexedDB solo como caché reconstruible.
- Toda escritura pasa por `SafeVault` (diario + temporal + suma de verificación). Nunca escribir directo al backend.
- La comprobación de integridad reporta; nunca borra ni corrige.
- Sin peticiones de red en tiempo de ejecución, sin telemetría (hay CSP en `index.html`).
- Sin SF Symbols, ni logotipo, nombre o marcas de Apple. Iconos: Lucide (ISC).
- Tarjetas generadas por IA: siempre revisión humana, `origen: ia`.
- Feature detection (`'x' in window`), nunca asumir el navegador. Sin `beforeunload`.
- `navigator.share` solo dentro del gesto, con el `File` ya construido (preparar → entregar).
- Contraste AA garantizado por el guardián de legibilidad; objetivos táctiles ≥ 44 px; inputs ≥ 16 px.
- Todo texto de interfaz pasa por `t()`/`tn()` de `src/i18n` (es/en/fr). Nunca se traducen formatos de archivo (`Q::`, `Respuesta:`, `origen: ia`…) ni contenido del usuario. Constantes de módulo con texto: funciones o *getters*.
- Teléfono: una sola regla (`PHONE_QUERY` en `theme.ts`); CSS solo bajo `html.is-phone`, JS con `isPhone()`/`usePhone()`. iPad y web no cambian: `MODE=compare npm run e2e:phone` contra una línea base debe dar 0 píxeles.
- Todo lo flotante (hojas, menús, popovers) pasa por `src/ui/overlay.tsx` (portal + pila); z-index solo con los tokens `--z-*`. Botones solo-icono: `aria-label` (el tooltip lo toma de ahí); sin `title` nativo.
- Sin color en la interfaz (croma ≤ 5 %) salvo el acento en sus usos activos: todo texto o control sobre el fondo va dentro de `.glass`. El contenido del usuario lleva `data-user-content`.
- Cambios de formato retrocompatibles y perezosos (p. ej. el `id:` del frontmatter solo se escribe al vincular).
- `reviews.jsonl` es la verdad de FSRS; `state.json` se reconstruye (`verifyDeterminism`).
- En estilos inline de Preact 11 los números NO llevan `px` automático: usar cadenas (`'12px'`).
- Código mínimo (ponytail), pero nunca recortar: escritura segura, integridad, determinismo FSRS, sanitización, accesibilidad.

## Mapa del código
- `src/vault/` VaultAdapter (OPFS en Worker, FS Access, memoria), `safe.ts` (diario), `integrity.ts`.
- `src/cards/parse.ts` parser de mazos · `src/srs/` FSRS, `replay`, cola · `src/data/` colección y operaciones.
- `src/lib/` ajustes, días, estadísticas, exámenes/ritmo, pomodoro, `.ics`, consultas · `src/sim/` simulacros · `src/notes/` notas, Plaud, docx/pdf; fotos: `images.ts` (guarda el original), `thumbs.ts` (`mediaThumbUrl`, caché `.app/thumbs/`), `imgsize.ts`, `imagebar.tsx`.
- `src/stickies/` add-on «Sticky notes» (`model.ts` frontmatter/orden, `tile.tsx` mosaico).
- `src/tasks/` add-on «Tareas» (`parse.ts` formato `- [ ]`/📅, `tile.tsx` mosaico).
- `src/share/` «Compartir estadísticas»: `period.ts` (cuentas puras), `card.ts` (Canvas 2D), `sheet.tsx` (hoja, con `import()`); `paintBackground` en `src/ui/background.tsx`.
- `src/md/embed.ts` sintaxis de imagen `![[foto|300|izq|alt …]]`.
- Editor de notas: `src/notes/format.ts` (edición pura: marcas, estilos, listas, tablas, bloques), `editorbar.tsx` (barra fija), `history.ts` (deshacer/rehacer), `sources.ts` (orígenes `#pN` al mover).
- `src/io/` importar (zip, CSV, `.apkg` en Worker: legado, compatibilidad y formato nuevo), extraer texto, compartir · `src/md/` Markdown seguro.
- `src/i18n/` idiomas (`index.ts` + `es|en|fr.json`; pseudoidioma `xx` en /design).
- `src/ink/` motor de tinta (modelo, capa, dibujos) · `src/pdf/` anotaciones y biblioteca · `src/lib/keys.ts` atajos.
- `src/ui/` kit, gráficas, fondos + guardián, `overlay.tsx` (capas), `tooltip.tsx`, `phonebar.tsx` (barra inferior del teléfono), `pressdrag.tsx` (pulsación larga y arrastrar) · `src/screens/` pantallas. `src/sw.js` plantilla del service worker.

## Comandos
- `npm run dev` · `npm run build` · `npm run preview`
- `npm test` (Vitest) · `npm run typecheck`
- `npm run build && npm run e2e && npm run e2e:flows && npm run e2e:design && npm run e2e:mejoras && npm run e2e:mejoras2 && npm run e2e:phone && npm run e2e:bloquec && npm run e2e:p5 && npm run e2e:p6 && npm run e2e:p7 && npm run e2e:p10 && npm run e2e:p12 && npm run e2e:p15 && npm run e2e:glass && npm run e2e:adherencia && npm run e2e:p14 && npm run e2e:reproductor && npm run e2e:pdf && npm run e2e:share && npm run e2e:tasks && npm run e2e:stickies && npm run e2e:intentos` y `npm run e2e:perf` (Playwright; `PLAYWRIGHT_PATH` si está instalado globalmente, `BROWSER=webkit|chromium`)
- `node scripts/icons.mjs` regenera íconos desde `scripts/icon.svg`

## Fase actual
**Fases 1–11**, tema Cristal, **Mejoras 1** y **Mejoras 2 · A** en `main`. En la rama `claude/exciting-cerf-u1rtor`: Mejoras 2 · B (iPhone), C (Add-ons en Ajustes, perfil, papelera de mazos, fondos, almacenamiento), D (buscador de notas, mapa proporcional), E (lienzo conectado, exámenes) y F (calendario con horas), y el **prompt 5** completo (sonido ambiente, motor de tinta `src/ink/`, PDFs, notas manuscritas, atajos y mando; `docs/PROMPTS.md`). Pendiente de prueba en iPad, iPhone, Apple Pencil, teclado y mando reales. No unir a `main` (rama de despliegue) sin confirmación.
**Prompt 6** A y B en `main`: A (mover mazos, tarjetas y notas con deshacer: `src/data/move.ts`, `src/notes/move.ts`, `src/ui/pressdrag.tsx`) y B (Ajustes y Respaldo dentro de Perfil; Ajustes en acordeón con `FoldCtx`); C (Bandeja oculta tras el add-on `inbox`, apagado por defecto) y D (mini reproductor `MiniAmbient`: vista del mismo motor, con volumen general y pausa) en `mejoras-5`.
**Prompt 7** en la rama `mejoras-5`: 1 (el lienzo consume todo el zoom; `src/lib/canvaszoom.ts`, mínimo 0.1) 2 (el visor de PDF abre siempre por página) y 3 (firma del desarrollador abajo a la izquierda, tono elegido por el guardián).
**Prompt 10** en `main`: `.apkg` del formato nuevo de Anki (`anki21b` con zstd vía `fzstd` solo en el Worker, esquema v18, `meta`/`media` protobuf, nunca el marcador falso), errores con código y hoja de importación con causa, resumen y «Ver mazos». Paquetes de ejemplo: `scripts/apkg-fixtures.py` → `tests/fixtures/apkg/`. Un `.zip` con colección de Anki se importa como Anki.
**Prompt 12** en `main`: crear una nota solo pide el título; sin materia → `notes/<Título>.md` («Sin clasificar»), solo materia → `notes/<Materia>/<Título>.md` («Sin tema»); `safeSegment` para nombres.
**Prompt 11** en la rama `perf-pdf-lienzo` (no unir a `main` sin confirmación): PDF pesados por trozos (`SafeVault.writeStream`, recuperable) y por rangos (`src/pdf/open.ts`), visor virtualizado (`src/pdf/virtual.ts`: alturas, ventana, cola de 2, presupuesto de píxeles), miniaturas perezosas, Lienzo sin re-renders en el gesto y con culling (`awakePanels`). `?perf` muestra contadores (`src/lib/perf.ts`, `src/ui/perfhud.tsx`); `npm run e2e:perf` mide y comprueba (fixtures con `node scripts/perf-fixtures.mjs`). Cifras en `docs/perf/` y `docs/DECISIONS.md`.
**Prompt 15** en la rama `fix-minimapa` (desde `main`; no unir sin confirmación): minimapa del lienzo interactivo (`src/lib/minimap.ts`: límites = paneles visibles ∪ vista; tocar centra, arrastrar mueve, tocar un panel lo trae al frente; teclado; plegable con `minimap: false` opcional en el espacio). `npm run e2e:p15`. Fallo previo anotado: «Ajustar al contenido» no responde al ratón (captura del puntero del lienzo).
**Notas-Pro** en `main` (unido con el prompt 17): paquete 1 = Fase A (fotos: original byte a byte, miniaturas en caché, `![[foto|ancho|izq|alt …]]`, barra de imagen, exportar originales), en espera de prueba en iPad. Siguen los paquetes 2–4 (add-ons de notas apagados por defecto). `npm run e2e:notaspro`.
**Prompt 17** en `main` (rama `barra-editor`): barra fija del editor de notas (formato, `++subrayado++`, tamaño `{.grande}`, alineación ` {.centro}`, listas, tablas, imagen, mover bloques, deshacer/rehacer, atajos «Editor»). `npm run e2e:barra`.
**Reproductor** en la rama `fix-reproductor` (desde `main`): `navigator.audioSession = 'playback'` en el gesto, la música se desbloquea en el mismo clic (`player.prime()`), errores de `play()` con aviso (`onAudioError`), «Probar sonido», y `MiniAmbient` como una sola pieza de vidrio fija abajo a la derecha. `npm run e2e:reproductor`.
**Prompt 14** en la rama `fix-lienzo-rendimiento`: asa de redimensionar hija de `.win` (esquina visible aunque el panel se desplace; bordes y 44 px con dedo), notas pesadas (DOMPurify con configuración fija, caché LRU de HTML saneado por bloque `renderMarkdownCached`, bloques con `memo`, tramos de 40 con `content-visibility` en notas de > 80 bloques, medios al acercarse con préstamo de URLs `acquireMediaUrl`/`releaseMediaUrl`, índice ~1 s tras escribir, aviso de nota gigante) e imágenes del lienzo con versión reducida en `.app/cache/img/` (`src/lib/imgview.ts`). Fixtures: `node scripts/note-fixtures.mjs`; `npm run e2e:p14` y `npm run e2e:notas-perf`.
**PDF de notas** en la rama `fix-pdf-negro`: el papel siempre es claro (`@media print`: `html` blanco, tokens de papel en ambos modos, sin vidrio) y se imprime solo la nota (`.print-target` + `html.printing-note`, también desde un panel y con Cmd+P). `npm run e2e:pdf` (Chromium + `pdftoppm`/`pdftotext`).
**Adherencia** en la rama `fix-adherencia-minimizar` (desde `main`): el botón minimizar del mapa recortado queda en la esquina del panel (`.mh:has(> .heat-panel.fit)`). `npm run e2e:adherencia`.
**Vidrio** en la rama `fix-glass` (desde `main`; no unir sin confirmación): «Añadir examen» como `btn primary` dentro de vidrio (Hoy: píldora `.exam-add`; Estadísticas: encabezado `row glass panel`), `.glass.strong` sigue a la intensidad, modo ligero sin sombras grandes y aviso de 3 s con acción. Medición en `e2e/glass-perf.mjs`; contraste del botón en `npm run e2e:glass`.
**Borrar intentos** en la rama `fix-borrar-intento` (desde `main`): papelera por fila en «Intentos» y «Borrar este intento» en Resultados, con confirmación y deshacer (`deleteAttempt`/`restoreAttempt` en `src/data/extra.ts`); «Descartar» el simulacro a medias; «Ver todos». `npm run e2e:intentos`.

**Prompt 19** en la rama `compartir-stickies-tareas` (desde `main`; no unir ni subir sin confirmación): 1 = «Compartir estadísticas» (botón en Hoy, hoja con vista previa, Canvas 2D con el fondo activo y el vidrio del tema, logo sin recuadro `public/brand/logo-mark.png`, Web Share con descarga de respaldo). `npm run e2e:share` (unido a `main`). 2 = add-on «Tareas» (`src/tasks/`: `parse.ts` puro, `tile.tsx` con `import()`; archivo `notes/Tareas.md`), `npm run e2e:tasks`. 3 = add-on «Sticky notes» (`src/stickies/`: `model.ts` puro, `tile.tsx` con `import()`; `notes/Stickies/<id>.md`), `npm run e2e:stickies`. En espera de prueba en iPhone/iPad.

## Skills activas
Mantenimiento: webapp-testing, security-review (importadores), frontend-design (Cristal), ponytail. Máx. 5–6 a la vez.
