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
- `src/lib/` ajustes, días, estadísticas, exámenes/ritmo, pomodoro, `.ics`, consultas · `src/sim/` simulacros · `src/notes/` notas, Plaud, docx/pdf.
- `src/io/` importar (zip, CSV, `.apkg` en Worker: legado, compatibilidad y formato nuevo), extraer texto, compartir · `src/md/` Markdown seguro.
- `src/i18n/` idiomas (`index.ts` + `es|en|fr.json`; pseudoidioma `xx` en /design).
- `src/ink/` motor de tinta (modelo, capa, dibujos) · `src/pdf/` anotaciones y biblioteca · `src/lib/keys.ts` atajos.
- `src/ui/` kit, gráficas, fondos + guardián, `overlay.tsx` (capas), `tooltip.tsx`, `phonebar.tsx` (barra inferior del teléfono), `pressdrag.tsx` (pulsación larga y arrastrar) · `src/screens/` pantallas. `src/sw.js` plantilla del service worker.

## Comandos
- `npm run dev` · `npm run build` · `npm run preview`
- `npm test` (Vitest) · `npm run typecheck`
- `npm run build && npm run e2e && npm run e2e:flows && npm run e2e:design && npm run e2e:mejoras && npm run e2e:mejoras2 && npm run e2e:phone && npm run e2e:bloquec && npm run e2e:p5 && npm run e2e:p6 && npm run e2e:p7 && npm run e2e:p10` (Playwright; `PLAYWRIGHT_PATH` si está instalado globalmente, `BROWSER=webkit|chromium`)
- `node scripts/icons.mjs` regenera íconos desde `scripts/icon.svg`

## Fase actual
**Fases 1–11**, tema Cristal, **Mejoras 1** y **Mejoras 2 · A** en `main`. En la rama `claude/exciting-cerf-u1rtor`: Mejoras 2 · B (iPhone), C (Add-ons en Ajustes, perfil, papelera de mazos, fondos, almacenamiento), D (buscador de notas, mapa proporcional), E (lienzo conectado, exámenes) y F (calendario con horas), y el **prompt 5** completo (sonido ambiente, motor de tinta `src/ink/`, PDFs, notas manuscritas, atajos y mando; `docs/PROMPTS.md`). Pendiente de prueba en iPad, iPhone, Apple Pencil, teclado y mando reales. No unir a `main` (rama de despliegue) sin confirmación.
**Prompt 6** A y B en `main`: A (mover mazos, tarjetas y notas con deshacer: `src/data/move.ts`, `src/notes/move.ts`, `src/ui/pressdrag.tsx`) y B (Ajustes y Respaldo dentro de Perfil; Ajustes en acordeón con `FoldCtx`); C (Bandeja oculta tras el add-on `inbox`, apagado por defecto) y D (mini reproductor `MiniAmbient`: vista del mismo motor, con volumen general y pausa) en `mejoras-5`.
**Prompt 7** en la rama `mejoras-5`: 1 (el lienzo consume todo el zoom; `src/lib/canvaszoom.ts`, mínimo 0.1) 2 (el visor de PDF abre siempre por página) y 3 (firma del desarrollador abajo a la izquierda, tono elegido por el guardián).
**Prompt 10** en la rama `fix-apkg` (sin push hasta confirmación): `.apkg` del formato nuevo de Anki (`anki21b` con zstd vía `fzstd` solo en el Worker, esquema v18, `meta`/`media` protobuf, nunca el marcador falso), errores con código y hoja de importación con causa, resumen y «Ver mazos». Paquetes de ejemplo: `scripts/apkg-fixtures.py` → `tests/fixtures/apkg/`.

## Skills activas
Mantenimiento: webapp-testing, security-review (importadores), frontend-design (Cristal), ponytail. Máx. 5–6 a la vez.
