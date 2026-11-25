# PDF + anotador + errores menores · plan (rama `pdf-mejoras`, desde `main`; no unir sin confirmación)

**Fuera de alcance: todo `src/chat/**` y `src/demo/chat.ts`** (el usuario lo da por bueno: NO se toca).
Reglas del repo mandan (CLAUDE.md). Retrocompatible: marcas y tinta existentes (`*.annots.json` v:1, `.app/annotations/` legado) deben verse igual. Sin color nuevo en la interfaz (Cristal), contraste AA, objetivos ≥44 px, inputs ≥16 px, `t()` para todo texto, z-index solo con `--z-*`.

## Carriles (dueño único; cada uno en su worktree/rama)
| Carril | Rama | Alcance | Archivos propios |
|---|---|---|---|
| **V · Visor** | `pdf-visor` | A1 carrera `RenderQueue.cancel`/`add` (hojas en blanco) · A2/A3 zoom sin parpadeo y con debounce (escala CSS mientras se re-renderiza) · A4 `TextLayer` cancelable · A5 número de página que solapa · A6 prioridad por distancia y ventana · A7 `memo(Page)`, callbacks estables, `SearchBox` aparte, efecto `ownzoom` con deps · A9 `prompt()`/`confirm()` de la nota adhesiva → `Sheet` y buscador ≥44 px · A12 CSS duplicado `.pdf-text/.textLayer` · A10 dpr de tinta | `src/pdf/virtual.ts`, `src/pdf/open.ts`, `src/screens/pdf.tsx` (**único dueño**), `tests/pdfvirtual.test.ts`, CSS `.pdf-text .textLayer .pdf-page .pdf-slot .pdf-side` |
| **A · Anotador** (fase 1, sin `pdf.tsx`) | `pdf-anotador` | Herramienta **Marcador** libre (`marker`): trazo ancho semitransparente, `multiply`, que raya sobre CUALQUIER cosa (texto, imagen, escaneado), sin ajustarse al texto; el resaltador inteligente sigue existiendo · vista previa en vivo con el mismo grosor · mejor UI (barra, estado activo, selector de grosor/color ≥44 px, icono de marcador, subrayado/tachado con el color elegido, no fijo) · A8 rendimiento de tinta (un rAF coalescido, rect cacheado, no repintar todo el trazo) · atajo `ink.marker` · guardado retrocompatible (`marker` como `highlighter`+`free:true` para que una build vieja no lo pierda) | `src/ink/*`, `src/pdf/annots.ts`, `src/lib/keys.ts`, `tests/ink.test.ts`, `tests/pdfannots.test.ts`, CSS `.ink-* .pdf-mark* .pdf-sticky*`, i18n `ink2.*`. **Fase 2** (tras unir V): cableado en `pdf.tsx` (`onInk` sin snap para `marker`, `exportPdf` con multiply, selección con color elegido) |
| **U · Barrido UI** | `barrido-ui` | Errores menores en `src/ui/*`, `src/screens/*` (**excepto `pdf.tsx`**), `src/lib/*` y CSS global: objetivos <44 px (`.btn.small`, `.btn.icon.small`, `.tog`, `.chip`, checkboxes) con área de toque ampliada sin cambiar el aspecto; `links.tsx:144` día UTC→local con `dayKey`; listeners/intervalos sin limpiar (`perfhud.tsx:41`…); `confirm()` nativos → `Sheet` solo si es simple; `pdf.tsx` NO | esos directorios, `src/theme-cristal.css` (secciones globales: `.btn`, `.tog`, `.chip`, `.count`), tests propios |
| **D · Barrido datos** | `barrido-datos` | Errores menores en `src/notes`, `src/sim`, `src/srs`, `src/data`, `src/io`, `src/diagrams`, `src/vault`, `src/stickies`, `src/tasks`, `src/share`: bugs reales primero (fechas/zonas, ids, errores tragados, cleanup), luego i18n/accesibilidad. Prohibido tocar determinismo FSRS (`engine.ts`/`replay`) | esos directorios, tests propios |

## Anti-pisado
1. Nadie toca: `src/chat/**`, `package.json`, `CLAUDE.md`, `docs/DECISIONS.md`, `src/app.tsx`, `src/lib/settings.ts` (solo yo, al final).
2. `src/screens/pdf.tsx`: **solo V** en fase 1; A hace el cableado en fase 2 (rama sobre `pdf-visor` ya unida).
3. i18n (es/en/fr): V usa `pdfx.*` insertado tras la última clave `pdf.`; A `ink2.*` tras la última `ink.`; U/D `misc2.*` tras la última clave `storage.`/`stats.` respectivamente (U tras `storage.`, D tras `stats.`); paridad por `npm test`.
4. CSS compartido (`theme-cristal.css`): cada carril solo sus selectores; no reordenar ni reformatear.
5. Cada carril: `npx tsc --noEmit`, `npx vitest run`, e2e propio y `npm run e2e` + `e2e:uiaudit` (+ `e2e:p5`, `e2e:perf` V/A; `e2e:phone` U) con `flock /tmp/e2e.lock`; commits pequeños en su rama; sin unir a main. Reportes caveman ≤25 líneas.
6. Tokens: leer solo `docs/audit/MAPA.md` (sección de la carpeta) y los archivos nombrados.

## Fases
0. Auditoría ✔ · 1. V, A(fase 1), U, D en paralelo · 2. Integrador: unir V→A→U→D, A fase 2 (cableado), i18n/CSS, regresión completa · 3. Reporte; unir a `main` solo con confirmación.

## Hallazgos clave (auditoría)
- Hojas en blanco/parpadeo: `RenderQueue.cancel` no saca el trabajo de `active` y `add` lo descarta (virtual.ts); el cleanup libera el canvas ante cualquier cambio de deps (pdf.tsx ~512-559).
- Traba al bajar/zoom: `setZoom` por evento → re-render de todas las páginas; `Page` sin `memo`; estado de búsqueda/`bump` en el padre.
- Traba al escribir con Pencil: `drawLive` repinta todo el trazo en cada `pointermove`, `getBoundingClientRect` por punto, `persist` re-renderiza el visor. Con teclado: `prompt()`/`confirm()` nativos y buscador <44 px.
- Resaltador: depende de `snapToText`/capa de texto; en escaneados no hay `.textLayer`; `mix-blend-mode` ausente en `.ink-layer` y aislado por su `z-index`; subrayado/tachado con color fijo; vista previa fina que salta a 4×.
- Base limpia: tsc 0 errores, i18n con paridad, sin `console.log`, TODO ni `any`.
- Riesgos: marcas antiguas intactas (test), canvas extra con blend en iPad (medir `e2e:perf`), PDF escaneado de prueba generado con pdf-lib.
