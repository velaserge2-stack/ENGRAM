# Asistente · 00 · Auditoría previa

Rama `asistente` desde `main` f882434. Solo lectura (esta fase no cambia código).

## 1 · Estado de main
- typecheck OK · `npm test` 93 archivos / 817 pruebas OK · build OK.
- Chunks más grandes: ~480 kB (142 kB gzip).
- docs/audit: las 88 `it.fails` están cerradas (LOG 2026-11-13). No queda deuda abierta de 03/04/05 que bloquee el chat.
- Deuda que sí afecta al chat:
  - `e2e:bancos` falla a veces; `e2e:p5` falla en main (audit/LOG:127).
  - No hay WebKit en el contenedor: el chat no se puede probar en Safari/iPad aquí.
  - `docs/rendimiento/PENDIENTE.md`: faltan pruebas en iPad y arreglar `e2e/rendimiento-perfil.mjs` (vite preview ignora `--outDir`; el perfil trae el SW de la semilla). Sin eso no se mide el coste del chunk del SDK con ese script.

## 2 · Ramas y conflictos
| Rama | Commits | Archivos que choca con el chat | Riesgo |
|---|---|---|---|
| `notas-pro` | +1 | app.tsx (+2), settings.ts (+4), theme-cristal.css (+19), screens/settings.tsx, i18n es/en/fr, package.json, CLAUDE.md | Alto: mismos archivos |
| `mejoras-2` | +1 | CLAUDE.md | Bajo |
| resto | — | ninguno | — |

Propuesta: unir `notas-pro` y `mejoras-2` a main antes de empezar, o rebasar `asistente` después.

## 3 · CLAUDE.md
- 16 356 bytes. «Fase actual» (l. 50–78) ocupa ~9,4 KB (57 %).
- Propuesta: mover el historial tal cual a `docs/FASES.md` y dejar ≤ 8 líneas (fase en curso, enlace, 2–3 reglas vivas); comandos e2e en una línea con enlace a `package.json`; auditoría cerrada → enlace a `docs/audit/LOG.md`. Se propone con diff, no se aplica sin tu visto bueno.
- Regla nueva: «Asistente: única excepción de red (`connect-src https://api.anthropic.com`), solo bajo demanda y con la clave del usuario».

## 4 · Archivos: confirmados, corregidos y huecos
| Pieza | Dónde | Estado |
|---|---|---|
| Registro de add-on | `addons.tsx:15` `MODULES()`, tipo :12, `hooks` :17-33 | Confirmado. **No existe** la función `registerView` |
| Carga diferida | `today.tsx:55,58` `import()` + `addonOn` | Patrón para el chat |
| Montaje global | `app.tsx:308-310`, :375 (ambient); firma `.dev-sign` :313 abajo-izq. | Confirmado |
| MiniAmbient | `ambient.tsx:175`, css:885-888 abajo-der. | Choca con la mascota |
| Capas | `overlay.tsx` `useLayer`:43, `Portal`:70, `Popover`:78 | Confirmado |
| Atajos | `lib/keys.ts` `ACTIONS`:12; `ui/keys.tsx` `useKeyScope`:56 | Confirmado |
| Ajustes | `settings.ts` `Settings`:15, `defaultSettings`:91, `mergeSettings`:144 → `.app/settings.json` | **Va dentro del zip**: no sirve para claves |
| Plegables | `kit.tsx:45` `FoldCtx`; Provider en `screens/settings.tsx:292-454` | `profile.tsx` no lo usa |
| z-index | `theme-cristal.css:17` | Falta `--z-chat` |
| Leer notas | `search-client.ts:53`, `store.ts:47`, `textcache.ts:53` | Confirmado |
| Leer PDF | `io/extract.ts` `extractText`:66, `pdfText`:23; `pdf/library.ts` `listPdfs`:30 | Confirmado |
| Mazos | `data/collection.ts` `loadCollection`:133; `data/ops.ts:25` `appendCard` | Confirmado |
| Exámenes | `lib/exams.ts` `parseExam`:32; `sim/parse.ts` `parseText`:92, `serializeBank`:219 | Confirmado |
| Calendario, leer | `lib/ics.ts` `fromICS`:174, `occurrences`:269 | Confirmado |
| Calendario, crear | **No hay función**; en línea en `screens/calendar.tsx` (`saveOwn`:71, `blank`:166) | **Hueco**: extraer `addEvent` a `calendar-edit.ts` |
| Calendario, editar/borrar | `calendar-edit.ts` `editOccurrence`:29, `deleteOccurrence`:18 | Confirmado |
| Crear nota | `notes/model.ts` `newNoteText`:101, `notePath`:51 (escritura en línea en notes.tsx:428) | Hueco menor: `createNote()` |
| Marca IA | `notes/model.ts` `withOrigin`:260; `cards/parse.ts` `origin`:36 | Confirmado |
| Deshacer | `data/move.ts` `Undo`:24, `undoMove`:30 (solo movimientos) | **Hueco**: no hay deshacer genérico de escrituras |
| Markdown | `md/render.ts:162` `renderMarkdown` (DOMPurify) | Confirmado |
| Compartir | `share/sheet.tsx:124` | Confirmado |
| Respaldo | `io/zip.ts:85` recorre todo `.app/`; no lee localStorage | Confirmado |
| SDK | `ai`, `@ai-sdk/anthropic` | **No están** en package.json |

Huecos por crear: `addEvent`, `createNote`, deshacer de escrituras, texto de PDF buscable (hoy solo `pdfText` por archivo), `--z-chat`, almacén de claves.

## 5 · Riesgos
| Riesgo | Mitigación |
|---|---|
| Regla «sin red» | Add-on apagado por defecto; red solo con add-on activo y clave puesta; aviso en Ajustes; regla en CLAUDE.md y DECISIONS.md |
| CSP `connect-src 'self'` (solo `index.html:19`) | Añadir `https://api.anthropic.com`. No hay otra CSP (vite.config, sw.js, `_headers`) |
| Service worker | `sw.js:29-31` ignora lo que no es GET o es de otro origen: no intercepta el POST a la API |
| SW precachea todos los chunks (`vite.config.ts:16-18`) | El SDK se bajaría al instalar aunque nadie use el chat; decidir si se excluye del precache |
| Peso del paquete | `import()` solo al abrir el chat; medir con build antes/después; tope propuesto 60 kB gzip |
| Llamada directa desde navegador | `anthropic-dangerous-direct-browser-access: true` en `createAnthropic({ headers })`; probar CORS en Safari |
| Claves en localStorage | `engrama.chat.keys`, fuera de `Settings` y `.app/` (no entra en zipVault); enmascaradas; nunca en logs |
| Inyección desde notas/PDF a herramientas | Toda escritura con vista previa + Aceptar + deshacer; rutas con `safeSegment` |
| XSS en respuesta | Solo `renderMarkdown`; mascota SVG estática |
| z-index | `--z-chat` entre `dock` y `popover`; `useLayer`/`Portal` |
| Solapes abajo-der./izq. | Mascota vs MiniAmbient y firma: desplazar o anclar arriba |
| phonebar | Hoja a pantalla completa en teléfono; `safe-area`; `e2e:phone` compare con add-on apagado |
| Conflicto con `notas-pro` | Unir antes (§2) |
| Deshacer incompleto | Sin el hueco de deshacer no se habilita ninguna herramienta que escribe |
| Atajo de teclado | `ACTIONS` + `useKeyScope`; revisar choques |

## 6 · Decisiones que necesito
1. ¿Aceptas la excepción a «sin red» y `connect-src 'self' https://api.anthropic.com`?
2. ¿Unimos `notas-pro` (y `mejoras-2`) a main antes de empezar, o rebaso después?
3. ¿El chunk del SDK fuera del precache del SW (se baja al abrir el chat por primera vez)?
4. Deshacer: ¿versiones (`snapshot`) o registro propio de «antes» por ruta?
5. Mascota: ¿abajo-derecha desplazando MiniAmbient, u otra posición?
6. Modelo por defecto y tope de gasto/tokens por mensaje: ¿lo fijas tú o configurable?
