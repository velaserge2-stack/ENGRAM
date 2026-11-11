# Engrama

PWA de repetición espaciada (tipo Anki) + notas (tipo Obsidian) para Safari en iPad. Sin backend, sin cuentas, 100 % offline, interfaz es-MX. Especificación completa: `docs/SPEC.md` (manda sobre *qué* se construye). Decisiones y límites de Safari: `docs/DECISIONS.md`.

## Stack
TypeScript estricto · Vite 8 · Preact 11 (JSX vía `jsxImportSource`, sin Babel) · ts-fsrs · markdown-it + DOMPurify · minisearch · fflate · lucide-preact. Bajo demanda (`import()`/Worker): pdfjs-dist, mammoth, turndown, docx, sql.js. Vitest + Playwright (WebKit si existe; si no, Chromium).
Diseño: tema **Cristal** (`docs/DESIGN.md`, `src/theme-cristal.css`): la interfaz no tiene color; solo el fondo y los emojis.

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
- Sin color en la interfaz (croma ≤ 5 %): todo texto o control sobre el fondo va dentro de `.glass`. El contenido del usuario lleva `data-user-content`.
- `reviews.jsonl` es la verdad de FSRS; `state.json` se reconstruye (`verifyDeterminism`).
- En estilos inline de Preact 11 los números NO llevan `px` automático: usar cadenas (`'12px'`).
- Código mínimo (ponytail), pero nunca recortar: escritura segura, integridad, determinismo FSRS, sanitización, accesibilidad.

## Mapa del código
- `src/vault/` VaultAdapter (OPFS en Worker, FS Access, memoria), `safe.ts` (diario), `integrity.ts`.
- `src/cards/parse.ts` parser de mazos · `src/srs/` FSRS, `replay`, cola · `src/data/` colección y operaciones.
- `src/lib/` ajustes, días, estadísticas, exámenes/ritmo, pomodoro, `.ics`, consultas · `src/sim/` simulacros · `src/notes/` notas, Plaud, docx/pdf.
- `src/io/` importar (zip, CSV, `.apkg` en Worker), extraer texto, compartir · `src/md/` Markdown seguro.
- `src/ui/` kit, gráficas, fondos + guardián · `src/screens/` pantallas. `src/sw.js` plantilla del service worker.

## Comandos
- `npm run dev` · `npm run build` · `npm run preview`
- `npm test` (Vitest) · `npm run typecheck`
- `npm run build && npm run e2e && npm run e2e:flows && npm run e2e:design` (Playwright; `PLAYWRIGHT_PATH` si está instalado globalmente, `BROWSER=webkit|chromium`)
- `node scripts/icons.mjs` regenera íconos desde `scripts/icon.svg`

## Fase actual
**Fases 1–11 implementadas** + tema Cristal. Pendiente: validación en iPad real (lista en `docs/DECISIONS.md`) y los límites anotados allí.

## Skills activas
Mantenimiento: webapp-testing, security-review (importadores), frontend-design (Cristal), ponytail. Máx. 5–6 a la vez.
