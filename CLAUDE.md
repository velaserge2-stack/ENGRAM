# Engrama

PWA de repetición espaciada (tipo Anki) + notas (tipo Obsidian) para Safari en iPad. Sin backend, sin cuentas, 100 % offline, interfaz es-MX. Especificación completa: `docs/SPEC.md` (manda sobre *qué* se construye). Decisiones y límites de Safari: `docs/DECISIONS.md`.

## Stack
TypeScript estricto · Vite 8 · Preact 11 (JSX vía `jsxImportSource`, sin Babel) · fflate · lucide-preact · Vitest · Playwright (WebKit si existe; si no, Chromium).
Próximas fases: ts-fsrs, markdown-it, CodeMirror 6, minisearch… siempre con `import()` dinámico.

## Reglas no negociables
- Los archivos del usuario (`.md`, `.jsonl`, `.json`) son la fuente de verdad. IndexedDB solo como caché reconstruible.
- Toda escritura pasa por `SafeVault` (diario + temporal + suma de verificación). Nunca escribir directo al backend.
- La comprobación de integridad reporta; nunca borra ni corrige.
- Sin peticiones de red en tiempo de ejecución, sin telemetría (hay CSP en `index.html`).
- Sin SF Symbols, ni logotipo, nombre o marcas de Apple. Iconos: Lucide (ISC).
- Tarjetas generadas por IA: siempre revisión humana, `origen: ia`.
- Feature detection (`'x' in window`), nunca asumir el navegador. Sin `beforeunload`.
- `navigator.share` solo dentro del gesto, con el `File` ya construido (preparar → entregar).
- Contraste AA; objetivos táctiles ≥ 44 px; inputs ≥ 16 px.
- En estilos inline de Preact 11 los números NO llevan `px` automático: usar cadenas (`'12px'`).
- Código mínimo (ponytail), pero nunca recortar: escritura segura, integridad, determinismo FSRS, sanitización, accesibilidad.

## Mapa del código
- `src/vault/` VaultAdapter: `opfs.worker.ts` (OPFS en Worker), `fsaccess.ts`, `memory.ts`, `safe.ts` (diario), `integrity.ts`, `open.ts` (elige backend).
- `src/io/` importar (`import.ts`), zip con `manifest.json` (`zip.ts`), compartir/descargar (`share.ts`).
- `src/lib/` ajustes, días/rachas, autoguardado, paleta y contraste, resumen.
- `src/screens/` Hoy, Mazos, Ajustes, Importar, Respaldo, Bienvenida. `src/sw.js` plantilla del service worker (lo genera `vite.config.ts`).

## Comandos
- `npm run dev` · `npm run build` · `npm run preview`
- `npm test` (Vitest) · `npm run typecheck`
- `npm run build && npm run e2e` (Playwright; `PLAYWRIGHT_PATH` si está instalado globalmente, `BROWSER=webkit|chromium`)
- `node scripts/icons.mjs` regenera íconos desde `scripts/icon.svg`

## Fase actual
**Fase 1 (Base) terminada**, pendiente de validar en iPad real. Siguiente según orden sugerido: **Fase 2** (parser de tarjetas, editor, FSRS, `reviews.jsonl`, reconciliación por ID).

## Skills activas
Fases 1–2: superpowers, Context7, webapp-testing, security-review, ponytail (máx. 5–6 a la vez).
