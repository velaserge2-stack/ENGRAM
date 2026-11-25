# Auditoría · landing como pantalla real de la PWA

Fecha: 2026-11-25 · rama `landing-preview` · solo lectura (único archivo escrito: este). Referencias `archivo:línea` verificadas en el código leído; lo marcado **(verificar)** no se pudo comprobar sin ejecutar.

## 1. Arranque

- `src/main.tsx` `boot()`: `trackKeyboard()`, `trackPhone()`, `registerSW()` (antes de abrir la bóveda), `openVault()`, `loadSettings(vault)`, `applyTheme`, `requestPersist()` solo si `welcomeDone`, luego `hasData` = ¿hay archivos en `decks/` o `notes/` (`walk`). Renderiza `<App opened hasData>` en `#app`. Error de arranque → texto `main.no_se_pudo_abrir_la_boveda`.
- `src/vault/open.ts` `openVault()` (l.67): orden de backend: 1) carpeta real FS Access si hay handle guardado y permiso `granted`; 2) OPFS (`OPFSBackend.open()`); 3) `MemoryBackend` (modo temporal). Siempre `new SafeVault(raw)` + `recover()`.
- Handles de carpeta: IndexedDB `engrama-handles` / store `h` / clave `vault-dir` (`open.ts` l.9–11). Nada en localStorage para la bóveda.
- **Decisión NUEVO vs. CON DATOS**: no hay flag de «primera vez» en el almacenamiento del navegador. Es `settings.welcomeDone` dentro de la bóveda: archivo `.app/settings.json` (`src/lib/settings.ts` l.6 `SETTINGS_PATH`; l.132 default `welcomeDone: false`; l.226 `loadSettings`: si no existe → defaults). `app.tsx` l.244: si `!settings.welcomeDone` → renderiza `<Welcome/>` en lugar de la app.
- Pantalla de primera vez: `src/screens/welcome.tsx`. Botones: «Empezar» (l.40, `start(false)`), «Con bóveda de ejemplo» (l.41, `start(true)`), «Restaurar respaldo» (abre hoja `import`). `start()` escribe los ejemplos con `vault.write` (l.15), luego `app.changed()` y `app.update({welcomeDone:true}, true)`. Crear/elegir bóveda: no hay pantalla separada; la carpeta real se elige en Ajustes (`rememberFolder`).
- Detección de modo instalado: `src/lib/storage.ts` l.34–39 `isStandalone()` = `navigator.standalone === true` || `matchMedia('(display-mode: standalone)')`. Welcome la usa (l.10, l.31) para ocultar los pasos de instalación. No hay `beforeinstallprompt` en `src/` (grep vacío).
- Router: hash puro. `src/state.tsx` l.95 `useRoute()` (escucha `hashchange`), l.105 `href()`, l.106 `go()`. Resolución en `src/screens/router.tsx` `Screen` (l.30). Tabs en `src/nav.ts` (`TABS`). `src/app.tsx` l.64 `useRoute()`, l.259 `tabId`.
- Vite: `vite.config.ts` `base: './'` (rutas relativas, subcarpeta). Plugin propio `engrama-sw` (`generateBundle`) genera `sw.js` con lista de assets precache y `VERSION` = hash del contenido.
- CI: `.github/workflows/ci.yml` build → `upload-pages-artifact` → `deploy-pages@v4` (GitHub Pages, subruta). Los e2e corren en CI con `BROWSER=webkit` (solo subconjunto en el paso visible, l.27–38).
- Service worker: `src/sw-register.ts` `registerSW()`: solo si `import.meta.env.PROD`; `register('sw.js', {scope:'./'})`; aviso «Actualizar» con `SKIP_WAITING`. `src/sw.js`: precache `ASSETS` en `install`; `fetch` cache-first; **navegación** → siempre devuelve el `./` cacheado (l.~29), o sea el index para cualquier ruta/hash. Lo SDK de IA (`ai`, `zod`…) se excluyen del precache (`SDK_RE`, vite.config.ts).

## 2. Bóveda de ejemplo

- `src/lib/example.ts` `exampleFiles()` l.3: `import.meta.glob('../../examples/boveda/**/*.{md,ics}', {query:'?raw'})`. Lazy, solo texto. Se llama desde `welcome.tsx` l.15 y `settings.tsx` l.456 (añadir más tarde, no sobrescribe: `if (!exists)`).
- Contenido real de `examples/boveda/`: `decks/Cardiología.md`, `decks/Neurología/EVC.md`, `decks/Neurología/Cefaleas.md`, `notes/Cardiología/ECG/Clase 1 - ECG básico.md`, `templates/Clase.md`. **No hay exámenes ni `.ics`** (el glob los admite, pero no existen). `examples/simulacros/` y `examples/plaud/` están fuera de la bóveda.
- Efectos de escribirla: `vault.write` → backend real (OPFS/FS). Para un demo en memoria: basta con `new MemoryBackend()` + `SafeVault` y escribir esos mismos `.md` (ningún otro paso toca IDB/OPFS).
- **Efectos secundarios a bloquear en un modo demo** (si la app corre dentro de la landing):
  - `openVault()` → IDB (`engrama-handles`) y OPFS. Forzar `MemoryBackend`.
  - `registerSW()` (`main.tsx` l.11) → omitir.
  - `requestPersist()` (`welcome.tsx` l.13; `main.tsx` l.20) → omitir.
  - `localStorage`: `src/chat/keys.ts` l.24/31 (**claves de API reales del usuario**, mismo origen), `src/chat/usage.ts` l.13/19, `src/screens/notes.tsx` l.75/82 (preferencias de notas), `src/vault/errinfo.ts` l.21/29. Un demo en el mismo origen puede leer las claves: bloquear o no cargarlas.
  - `location.hash` (`go()`): choca con el router de la landing si comparten documento.
  - `applyTheme`/`trackPhone`/`trackKeyboard` y clases en `<html>` (`html.is-phone`, `acc-*`): globales.
  - Asistente (`src/chat/*`): `keyview.tsx` llama `listModels` (red) → deshabilitar en demo.

## 3. Componentes: ¿se pueden renderizar solos?

- Todo consume `useApp()` (`state.tsx` l.59–60: `Ctx = createContext(null)`; `useApp = useContext(Ctx)`). Sin Provider → `null` → crash. Para aislar un componente hay que montar un `Ctx.Provider` con el shape completo de `AppCtx` (vault, collection, settings, update, changed, toast, openSheet…). Shape exacto: `state.tsx` ~l.30–58 **(verificar campos)**.
- `src/chat/dock.tsx`: usa `useApp` (l.4), `history`, `keys` (`loadKeys`, localStorage), `providers`, `voice`, `Quick`, `logos`. **No aislable** sin mock de keys y de `voice`.
- `src/chat/mascot.tsx`: solo `history` (`getStatus`, `messages`, `subscribe`) + CSS propia. **Aislable** (con un store falso del historial).
- `src/chat/quick.tsx`: `useApp` (l.5, l.22) y `cleanAction` de `lib/settings`. Requiere ctx.
- `src/chat/keyview.tsx`: `useApp`, `keys`, `models` (red), `overlay`. Requiere ctx + red mock.
- `src/chat/logos.tsx`: solo tipo `ProviderId` → **aislable** (SVG/JSX puro).
- `src/screens/study.tsx` l.211–220: botones de calificación `.grade` (Otra/Difícil/Bien/Fácil con `aria-label` de intervalo) dentro de `.grades.glass`. Dependen de la sesión FSRS y del ctx → mockear una tarjeta pre-cargada, o recrear el markup con las mismas clases (más barato).
- Gráficas `src/ui/charts.tsx`: `Bars` (l.13) y `Lines` (l.36) son funciones de props puras → **aislables**. `design.tsx` l.48 ya usa `Ring`/`Bar` con datos fijos (precedente).
- Diagramas: `src/diagrams/view.tsx` importa `parse`, `layout`, `measure`, `edges`, `types`; `mount.ts` l.4 `DiagramView`. `measure.ts` mide texto con el navegador **(verificar: canvas/DOM)**. Mostrar un diagrama fijo es viable si `parseDiagram` recibe texto literal; sin ctx.
- Nota: `src/screens/notes.tsx` y `today.tsx` son pantallas completas con ctx: no componentes sueltos.

## 3b. Opciones para mostrar pantallas reales

**Opción A · mismo documento (montar `App` con vault en memoria dentro de la landing)**
- Riesgos: `App` es monolítico (`app.tsx` ~400 líneas, hooks globales, `history`, `saver`, toasts, SW update). Choca con el router de la landing (`hashchange`, `location.hash` de `go()`), con `base.css` y `theme-cristal.css` (estilos globales, `html.is-phone`, `html.acc-*`), con el `:root` de tokens. Mismo origen → comparte **localStorage** con la app real: la landing sería JS con acceso a `keys.ts` (claves). Peso: entra todo el bundle inicial (265 KB JS / 88 KB gzip; ver §5).
- Ventaja: sin iframe; tamaño de contenedor flexible.
- Veredicto: **no recomendada**.

**Opción B · iframe a la misma app con `?demo`**
- `index.html` l.19: CSP `default-src 'self'`, `script-src 'self'`, `connect-src` solo 4 hosts de IA, `object-src 'none'`. La app no tiene `frame-src` ni `frame-ancestors`; el iframe la carga como hijo, eso no lo bloquea. La landing (`preview.html`) necesita CSP propia con `frame-src 'self'` (si no, `default-src` la bloquea: `frame-src` cae a `default-src`).
- Iframe con `sandbox="allow-scripts"` **sin** `allow-same-origin`: origen opaco → **no hay** acceso a localStorage, IDB, OPFS ni SW del origen real. Aislamiento de datos fuerte. Con `?demo` → `MemoryBackend` (ya lo hace `openVault` si OPFS falla; hay que forzarlo). **Riesgo**: en origen opaco los módulos `type=module` de `./assets/` son peticiones CORS; GitHub Pages suele devolver `Access-Control-Allow-Origin: *` **(verificar en despliegue, Safari incluido)**. Si falla, alternativa: `allow-same-origin` + `?demo` que anula todas las escrituras y no lee claves (más débil: el mismo origen sigue accesible desde el iframe).
- SW: el iframe de origen opaco no es controlado por el SW (correcto: no debe cachear demo). La app real sí precachea su `index`; la navegación a `./?demo=1` devuelve el index cacheado (el SW ignora el query), así que funciona offline.
- Peso: carga diferida (`IntersectionObserver` o clic), el iframe no entra en el paquete inicial de la landing. Coste: ~265 KB JS + CSS para la primera visita al demo.
- Sin cambios de estilo cruzados: cada documento tiene su CSS. Móvil: `height` fijo del iframe o `aspect-ratio`; `viewport-fit`.
- Veredicto: **recomendada**.

## 4. PWA e instalación

- Manifest `public/manifest.webmanifest`: `name`/`short_name` «Engrama», `lang` es-MX, `id` y `scope` `./`, `start_url` `./#/hoy`, `display` `standalone`, `theme_color`/`background_color` `#000006`, iconos `icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (purposes separados: `any`, `maskable`). Sin `screenshots` ni `shortcuts`.
- `public/icons/`: `apple-touch-icon.png` y favicons referenciados en `vite.config.ts` (`publicFiles`) pero **no** en el manifest.
- Instalación: no hay lógica Chromium (`beforeinstallprompt`: 0 hits). Única UI: `src/screens/install.tsx` `InstallSteps` (l.5): pasos iOS «Toca Compartir → Añadir a pantalla de inicio». Usada en `welcome.tsx` l.32 y `settings.tsx`. i18n: claves `settings.toca`, `settings.compartir`, `settings.en_la_barra_de_safari`, `welcome.instalala_en_tu_ipad`.
- iOS Safari: **no hay prompt de instalación** (ni `beforeinstallprompt`). Solo instrucciones manuales.
- iOS (conocimiento de plataforma, no verificable aquí): la PWA instalada tiene **almacenamiento separado** del de Safari (otro contexto: IDB/OPFS/localStorage/SW no se comparten). Un usuario que prueba en Safari y luego instala la PWA **empieza de cero** en la PWA. Y «Compartir → Añadir» no existe en otros navegadores iOS (Chrome iOS usa su propio menú). Implicación: el demo y la landing no deben prometer que los datos pasan a la PWA.
- `isStandalone()` detecta la PWA instalada; en el navegador normal la landing debe mostrar instalación; en la PWA, saltar la landing (ya lo hace `welcome.tsx` l.31 para los pasos; falta decidir si la landing se salta).

## 5. i18n, tema y paquete

- Idiomas: `src/i18n/index.ts` + `es.json`, `en.json`, `fr.json`; pseudo `xx` solo en /design. Claves por punto: `welcome.empezar`, `welcome.con_boveda_de_ejemplo`. Para la landing: añadir claves en los 3 JSON (regla CLAUDE.md: todo texto por `t()`/`tn()`). Hay que verificar si hay test de paridad de claves **(verificar: `tests/`)**.
- Landing actual (`docs/landing/`): maqueta es-only, texto literal, `lang="es"`. Migrar a `t()` obliga a tocar 3 JSON.
- Tema: `src/theme-cristal.css` (global, `html.is-phone`). `docs/landing/base.css` (7,7 KB) tiene tokens propios → **duplicación**; reutilizar `theme-cristal.css` evita divergencia pero acopla la landing a la app.
- Lazy `src/welcome/`: viable con `import()` desde `main.tsx` o `app.tsx` (precedente: `app.tsx` l.43–45 `lazy(() => import(...))`). Solo se carga si `!welcomeDone`.
- Paquete inicial: `dist/index.html` → `assets/index-B8qN1YpG.js`: **264 878 B** (88 199 B gzip). `dist/` es de 2026-11-24 (puede estar desfasado; regenerar con `npm run build` antes de medir). `pdf.worker` (1,27 MB), `sql-wasm` (688 KB) van bajo demanda.
- Para no inflar: la landing debe ser chunk separado (`import()`), el demo iframe no en el paquete inicial, y evitar importar `theme-cristal.css` desde la landing si se usa iframe.

## 6. Riesgos y lo que NO se debe romper

- **e2e que dependen de la primera vez**: 35 scripts contienen `Con bóveda de ejemplo` (grep en `e2e/`): `smoke.mjs` (l.55, l.135 — `npm run e2e`), `flows.mjs` (l.44), `p5 p6 p7 p10 p12 p14 p15 p16 bloquec mejoras mejoras2 phone design adherencia barra glass glass-perf notaspro notes-perf reproductor pdf share stickies tasks intentos bancos diagramas diagramas-zoom chat perf break-ui papelera ui-audit-notas ui-audit-integral`. Todos hacen `page.goto(URL_)` a la raíz `http://localhost:4173/` esperando «Bienvenido a Engrama» y clic en «Con bóveda de ejemplo».
- Si la raíz pasa a ser la landing, **todos fallan**. Opciones de bajo riesgo:
  1. Flag de test: la landing solo se muestra si no hay `?app` (o `?skip`) en la URL. Cambiar los 35 `goto(URL_)` por `goto(URL_ + '?app')`: cambio mecánico, un solo patrón.
  2. Landing en otra ruta (p. ej. `#/bienvenida` o `sobre.html`) y el primer arranque sin datos redirige solo si la URL es `./`. Evita tocar e2e, pero el `Welcome` actual sigue siendo el flujo de test.
  3. No cambiar nada del `Welcome` y poner la landing como capa previa solo para visitantes sin `?app`.
- Recomendación de test: añadir en `e2e/smoke.mjs` un caso «landing visible sin `?app`» y «`?app` lleva a Bienvenida», para que la regla quede fijada.
- **Índice raíz**: el deploy es subruta (`base './'`). La landing de la maqueta es `preview.html` (archivo aparte). Si se publica como `index.html`, hay que mover la app a `app/` (cambia `start_url`, `scope`, precache del SW y `sw-register`) o servir la landing en el mismo SPA. Decidir antes.
- **CSP**: la landing (si es `index.html`) hereda la CSP de `index.html`; el demo iframe necesita `frame-src 'self'` en esa CSP. No añadir `unsafe-inline` ni hosts nuevos.
- **Cuentas simuladas** («Crear cuenta: solo correo, simulado»): CLAUDE.md prohíbe formularios que recojan credenciales bajo pretexto falso. Un formulario de correo que no guarda nada y lo dice claramente en la UI (y en `docs/landing/` ya hay aviso «esta página no envía nada») es aceptable; uno que parezca real, no. No guardar el correo en ningún almacenamiento.
- **Pantalla real y datos**: el demo nunca debe escribir en OPFS/IDB ni leer `chat/keys` (§2).
- **Accesibilidad y reglas**: `aria-label` en botones solo icono; objetivos táctiles 44 px; inputs ≥ 16 px; contraste AA; texto de interfaz con `t()`; z-index solo tokens `--z-*`; nada de `beforeunload`.
- **Sin red**: `connect-src` no cambia; el demo no pide nada a la red (la landing no debe cargar fuentes/imágenes externas).
- **Feature detection**: `'serviceWorker' in navigator`, `matchMedia` ya detectados; mantener.
- `navigator.share`: no usar en la landing.

## 7. Recomendación de arquitectura

1. Mantener una sola app: la raíz sigue siendo la app; la landing es un chunk lazy `src/welcome/` que se muestra solo si `!welcomeDone` y no hay `?app` (regla de test de §6).
2. Pantallas reales en la landing mediante **iframe a `./?demo=1`** con `sandbox="allow-scripts"` (origen opaco), cargado al entrar en vista.
3. En `main.tsx`, si `?demo`: `MemoryBackend` + `SafeVault` con `examples/boveda`, sin `registerSW`, sin `requestPersist`, sin `applyTheme` global, sin chat (`keys`/`usage` vacíos, `listModels` deshabilitado).
4. Verificar en GitHub Pages y Safari iPad que los módulos cargan en origen opaco (CORS); si no, fallback `allow-same-origin` con el bloqueo de escritura y de claves.
5. Landing en la misma CSP con `frame-src 'self'`; mantener `index.html` intacto.
6. «Iniciar sesión → instalar» = la landing enlaza a `#/entrar`; «Instalar» muestra `InstallSteps` (iOS) y, si existe, el evento `beforeinstallprompt` (feature detect, Chromium).
7. «Crear cuenta» simulado: sin almacenamiento, con aviso visible, y redirección a la página Instalar.
8. Textos a `t()` en es/en/fr; medir con `npm run build` y `perf` antes y después (objetivo: landing ≤ +10 KB gzip en el paquete inicial, demo fuera).
