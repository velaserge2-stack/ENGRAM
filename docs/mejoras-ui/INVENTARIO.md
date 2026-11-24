# Inventario · mejoras-ui (solo lectura)

Rama `mejoras-ui`. Refs = archivo:línea. Verificado por lectura; sin probar en navegador.

## 1. Barra superior
- Componente `TopBar` = `src/app.tsx:321`. Montaje `app.tsx:260` (`<TopBar tab={tabId} />`). Cuerpo `app.tsx:341` (`header.topbar.no-print`).
- Orden: logo `brand-mark` → `nav.seg-nav.glass` (TABS de `src/nav.ts:5`) → `.spacer` → añadir (+) → **temporizador** `.mini-pomo` `app.tsx:356` (mm:ss, `p.state` de PomoCtl) → buscar (`app.tsx:305` sheet palette; botón sin línea exacta, ~357-360) → bandeja (addon `inbox`) → «⋯» `.more-pill` `app.tsx:366-375` → auriculares `app.tsx:376` (`.ph-hide .mid-hide`) → `<MiniAmbient />` `app.tsx:377` → avatar `.avatar-pill.ph-hide` `app.tsx:378`.
- CSS base: `theme-cristal.css:116` (`.topbar` sticky, z `--z-dock`), `:117-122` seg-nav y slider, `:125` spacer, `:217` `.mini-pomo`, `:599-600` brand, `:692` avatar.
- Etiquetas: `.seg-nav a .lbl` visible en grande por defecto (`:122`). Regla ≤1440 px: oculta `.lbl` salvo la activa (`:123`). ≤700 px: oculta todas y `.topbar` envuelve (`:124`). Pestaña activa: `aria-current` en `app.tsx:343-351` (`.seg-nav`); `data-tip` solo si no activa.
- iPad vs grande: solo CSS. `html:not(.is-phone) .topbar .mid-hide` oculta auriculares y `.more-pill` aparece, entre 601-1100 px (`theme-cristal.css:817-820`). No hay clase de «iPad»; es media query.
- Teléfono: `html.is-phone .topbar` static, `.seg-nav` oculto (`:614-616`); usa `PhoneTabBar` `app.tsx:306` (`src/ui/phonebar.tsx`, `.phone-tabbar` `theme-cristal.css:619`).
- Búsqueda: `app.tsx` botón palette (sheet `palette`, `app.tsx:305`). Atajo `GlobalKeys` `app.tsx:307`.
- Dato: en `.topbar` el `.mini-pomo` y auriculares viven en el mismo grupo `pill glass` (no hay contenedor propio).

## 2. Mini reproductor `MiniAmbient`
- Componente `src/screens/ambient.tsx:175`. Render con `Portal` (`src/ui/overlay.tsx:70`: `createPortal` a `document.body`). Clase: `.mini-amb glass` + `.docked` (`app.tsx:377`, sin prop) o `.floating` (`app.tsx:310`, solo teléfono con `floating`) + `.on` / `.open` (`ambient.tsx:213`).
- Montaje doble: `app.tsx:309` `AmbientController` (sin UI); `app.tsx:310` móvil flotante; `app.tsx:377` escritorio/iPad docked.
- CSS (`theme-cristal.css`): `:873` base flex column-reverse, `max-width:230px`; `:874` `.open` 300 px; `:885` **`.mini-amb.docked { position:fixed; right:16px; bottom:16px+kb }`**; `:887` `html.in-canvas .mini-amb.docked` sube a `bottom:176px`; `:888` `.floating` `right:12px; bottom: tabbar-h+18px`.
- «Casi en medio a la izquierda»: **ninguna regla fija `left`**. Docked usa `right`. Causa no hallada por lectura. Candidatos a verificar en DOM (`getBoundingClientRect`): (a) `.tray.floating` que sí va a la izquierda `theme-cristal.css:585` (`left:16px; bottom:16px`); (b) `.dev-sign` `:861` (izquierda, abajo); (c) `.mini-amb` con `right` pero ancho auto en un contenedor con `transform`/`backdrop` (portal evita esto). Recomendado medir antes de tocar.
- Dependientes de su posición: `src/chat/chat.css:5-6` (`body:has(.mini-amb)` sube el chat 54 px; `.open` desplaza `.chat-fab` 310 px a la izquierda); `chat.css:44` oculta `.chat-fab` en teléfono si abierto.
- Mini-reproductor y temporizador están en esquinas distintas hoy (temporizador arriba, mini abajo derecha).

## 3. Chat (Asistente)
- FAB: `src/chat/panel.tsx:43` (`button.chat-fab.glass.strong`), con `<Mascot>` `:44`. Panel: `chat.css:12` `.chat-panel` fixed `z --z-chat(150)`.
- Variables: `chat.css:2` `--chat-base:16px; --chat-lift:0; --chat-sr; --chat-sb`. `:3` en canvas base 176 px (solo compact). `:8` FAB `bottom = sb + base + lift + kb-inset`. `:13` `.compact`, `:15` `.large` (lateral, `top:12px`, `width: min(760px, 100vw-280px)`).
- `--chat-lift`: `:5` +54 px con mini presente; `:6` abierto → right +310 px. `--kb-inset` lo añade `src/theme.ts:57`.
- Teléfono: `chat.css:42-45` (`inset:0`, FAB encima de tabbar).
- Uso por proveedor: `src/chat/conv.tsx:102` `Meter` (función), `:107` `bar(loadUsage(), id, limits, now, warnAt)`, `:111` `div.chat-usage` (barra `.chat-bar`). CSS `chat.css:22-24`. Cálculo puro: `src/chat/usage.ts:69` `bar()`; `:11` `loadUsage`; `:25` `record`; `:55` `fromHeaders`. Storage `engrama.chat.usage` (`usage.ts:4`).
- Conversación: `src/chat/conv.tsx` default export `Conversation` (~línea 119); mascota `conv.tsx:129` (`useMascotState`), `:153` `<Mascot>`. Estilos de burbujas en `chat.css` (no revisado línea a línea).
- Mascota: `src/chat/mascot.tsx:14` `mascotState`, `:21` `useMascotState`, `:35` `Mascot`; CSS `src/chat/mascot.css` (`.mascot` `:2`, `.head`/`.eye`/`.mouth` `:4-6`).
- «Vuela»: causa probable = `position:fixed` + `--chat-lift` que cambia con `body:has(.mini-amb)` y con `.open` (saltos al abrir el mini) y `--kb-inset` (teclado). Sin `transition` en `bottom`/`right` del FAB.

## 4. Notas (pantalla y solapes)
Pantalla `src/screens/notes.tsx`: contenedor `.notes` grid `:168`; divisor `:192`; árbol en `.tree-over` (narrow) `:187`; inspector `aside.insp` `:1023` (`.insp-over` si overlay); botón salir `.notes-exit` `:1021`; editor `EditorBar` `:983`; diagrama `:538-565` (`.diag-grip` `:565`).
Position fixed/sticky/absolute (CSS en `theme-cristal.css`):
| Elemento | Regla | Pos. / z |
|---|---|---|
| `.topbar` | `:116` sticky | top 8px, z-dock 100 |
| `.editorbar` | `:323`, `:324`, `:341` sticky | top 72px+vv-top (panel: top 0); z-panel 10 |
| `.find-bar` | `:720` sticky | top 64px, z 3 → **solape**: bajo `.editorbar` (top 72, z 10) |
| `.rail` (solo Espacios) | `:379` sticky | top 80 |
| `.dock` (Espacios) | `:409` sticky | bottom 12 |
| `.img-bar` | `:396` sticky | bottom 0 |
| `.img-handle` | `:359` fixed | z popover 200 |
| `.insp-over` | `:471` fixed | top 72, right 12, z 200 |
| `.tree-over` | `:472` fixed | top 72, left 12, z 200 |
| `.notes-exit` | `:478` fixed | top 10, right 12, z 100 |
| `.key-feedback` | `:815` fixed (`src/ui/keys.tsx:119`) | top 72, right 16, z toast 400 → **solape** con `.insp-over` (mismo sitio) |
| `.toast` | `:282` fixed | bottom 28 centrado, z 400 |
| `.ink-toolbar` | `:769` sticky | top 8, z popover |
| `.minimap` / `.minimap-toggle` | `:420`, `:430` absolute | bottom 12, right 12 / right 180 (en Espacios) |
| `.chat-fab`/`.chat-panel` | `chat.css` fixed | z 150; FAB bottom 16 right 16 (+lift) |
| `.mini-amb` | `:885` fixed | z 100, bottom 16 right 16 |
| `.tray.floating` | `:585` fixed | bottom 16, left 16, z 100 |
| `.dev-sign` | `:861` fixed | bottom 6, left 14, z base-1 |
| `.drag-ghost` `:831`, `.tooltip` `:272`, `.popover` `:270`, `.scrim` `:263` | fixed | z tokens |
Solapes a vigilar: (1) find-bar/editorbar `:720`/`:323`; (2) key-feedback/insp-over; (3) chat `.large` (`chat.css:15`, top 12, right 12, z 150) bajo insp-over (z 200); (4) mini-amb docked/FAB/tray en la misma esquina inferior; (5) `--kb-inset` en FAB, panel y mini, pero no en `.editorbar` (usa `--vv-top`). Notas ocultan topbar, rail, dock y árbol en `body.notes-full` (`:474-476`).
Tokens z (`theme-cristal.css:17`): base 0, panel 10, dock 100, chat 150, popover 200, modal 300, toast 400, tooltip 500.

## 5. Diagramas (barra y zoom)
- Barra de herramientas del editor: `src/diagrams/editor.tsx:147` (`div.row.wrap.glass[role=toolbar]`, dentro del flujo, **no** fija); botones `:148-157`. Medición de alto de «ajustar»: `editor.tsx:70-80` usa `.topbar` bottom + altura de toolbar.
- Barra flotante de selección: `src/diagrams/toolbar.tsx:128` `FloatBar`, render en `Portal` (`:133`, `.diag-fbar` fixed). Posición calculada en `editor.tsx:170-185`.
- Tablero: `src/diagrams/canvas.tsx:720` `.diag-board` (role application). Escala: `canvas.tsx:138` `stage.style.transform = translate(x) scale(k)` sobre `.diag-board-stage` (`diagram.css:69`). Solo el stage escala; `.diag-tools` (`diagram.css:74`, `canvas.tsx:601`, absolute dentro del board) **no** escala. Chips (`:158`, 44 px) y asas (`:224`) fijos en px; inline editor compensa `scale(1/s)` (`canvas.tsx:625-640`).
- Zoom propio: `src/lib/canvaszoom.ts` (0.1–3). Gestos: `src/diagrams/gestures.ts:47` `wheel`; pinch con `visualViewport` (`canvas.tsx:349`, `:359`). Tope «Ajustar» 300 % (`gestures.ts:14`).
- Pinch del navegador: `index.html:5` viewport sin `maximum-scale` ni `user-scalable=no`, así que el pellizco nativo sigue activo fuera del tablero. `touch-action:none` solo en `.diag-board` (`diagram.css:61-65`) y chips (`:159`).
- Pantalla completa: `.diag-full` fixed z 60 (`diagram.css:100`); `.diag-expand` `:96`; `.diag-grip` `:97`.
- Diagnóstico: la barra no se mueve con zoom. Si «se mueve», es la `FloatBar` (fixed calculado en JS en cada render) o el `.topbar` sticky al cambiar el alto del editor.

## 6. Bug «no puedo borrar/modificar»
- Vault Worker: `src/vault/opfs.worker.ts:17-30` `writeWithSyncHandle`: `createSyncAccessHandle` (`:19`), `finally close` (`:30`). Un handle no cerrado bloquea escrituras siguientes (`NoModificationAllowedError`). Probe `hasSync` `:59`. Errores del Worker `:152` → `postMessage ok:false`.
- Cliente: `src/vault/opfs.ts:6-9` `codeOf`: solo mapea not-found/quota/invalid-path; **`NoModificationAllowedError` cae en `'io'` genérico** (`:8`). `:31-43` `onmessage`; `:43` `onerror → fail()`; `:49` rechaza todo pendiente con `'io'`.
- Apertura: `src/vault/open.ts:79-90`: si OPFS falla, **cae en `MemoryBackend` en silencio** (`:86` solo `console.warn`); `detail` avisa. `src/app.tsx:188` `temporary: vault.kind === 'memory'`. El fallo de sync-handle en open no se muestra como error.
- Handle-fs: `src/vault/handle-fs.ts:227-247` y `:288-317` (`createSyncAccessHandle`, flush, close; `abort` en `:259`, `:317`).
- Diario: `src/vault/safe.ts:66` write, `:145` recover, `:307-308` y `:327-332` limpian temporales con `.catch(() => {})` (errores tragados), `:584`, `:616` `catch {}` silencioso.
- Notas: `src/notes/store.ts:27-37` `saverFor`: falla → `onFail` solo la primera vez (Set `failed`, `:31`), luego re-lanza; `failed.delete` al guardar bien (`:36`), así que vuelve a avisar. Aviso en `src/app.tsx:122` (toast con `e.message` crudo, genérico). `store.ts:85` `refresh` silencia (`.catch(() => null)`).
- Autoguardado: `src/lib/autosave.ts:16-17` `inflight.catch → console.error` (solo consola); `:22`, `:24` `run().catch(() => undefined)` en `pagehide`/hidden: **error silencioso al cerrar**.
- Datos: `src/data/ops.ts:61` rollback en memoria si `appendLog` falla; `src/screens/study.tsx:96`, `:118` revierten estado y relanzan.
- Bloqueo «abierto en el editor»: texto `chat.pv_werr_open` (`es.json:2221`) y `chat.dl_err_open` (`:2273`) del Asistente; no hay chequeo equivalente en `notes`. `noteStore` mantiene `docs` Map (`store.ts:14`) hasta que no quedan listeners; `forget` `:61`.
- Hipótesis de orden: (1) handle OPFS sin cerrar (ver `safe.ts` cola `serial()` `:155`, ¿se propaga el error del Worker?); (2) error tragado en `pagehide` (`autosave.ts:24`); (3) memoria silenciosa si OPFS no abre (`open.ts:86`).

## 7. Tipografía
- Fuente: `src/theme-cristal.css:6` `--font: "Helvetica Neue", Helvetica, -apple-system, "SF Pro Text", Arial, sans-serif`. **Atención: «SF Pro Text» es nombre de fuente de Apple; CLAUDE.md prohíbe marcas de Apple. Revisar.**
- `:7` `--emoji`; `:8` `--mono`. Escala `:18` (`--t-body 1.0625rem`, `--t-note .8125rem`, `--t-foot .75rem`, `--t-1..3`, `--t-large`).
- Aplicación: `:64` `body { font-family: var(--font), var(--emoji); font-size: var(--t-body); line-height: 1.4 }`. `:67` `h1-h4 { letter-spacing:-0.02em; font-weight:500 }`. `:178` `.big` peso 700, `-0.04em`. `:212` `.pomo .time` peso 300. `:119` nav peso 500, `.9375rem`.
- Sin `@font-face` ni Google Fonts en `index.html` (CSP `index.html:19`, `style-src 'self' 'unsafe-inline'`).
- Interletrado apretado: `letter-spacing` negativo en `:67`, `:178`, `:697`.

## 8. Mapa de propiedad propuesto (6 agentes, sin solapes)
Regla: cada agente edita solo sus archivos. CSS nuevo en archivo propio importado desde el componente. Claves i18n con prefijo propio, añadidas al final de cada JSON; un solo agente integra es/en/fr al final si hay conflicto.

| Agente | Archivos propios | Notas |
|---|---|---|
| **A · topbar + reproductor** | `src/app.tsx:321-380` (solo `TopBar`); `src/screens/ambient.tsx`; `src/ui/phonebar.tsx` (no); CSS nuevo `src/ui/topbar.css` (mover `theme-cristal.css:116-125, 217, 599-616, 692, 817-820, 873-894` allí) | Dueño de `.mini-amb`. Avisar a B de nuevas clases. Claves `topbar.*`, `mini.*` |
| **B · chat + mascota + dock** | `src/chat/*` (todo), `src/screens/assistant.tsx`; `src/chat/chat.css` | Lee `.mini-amb` solo con `body:has()`; si A cambia la clase, B actualiza `chat.css:5-6`. Claves `chat.*`, `dock.*` |
| **C · notas (solapes)** | `src/screens/notes.tsx`, `src/notes/editorbar.tsx`, `src/notes/find.tsx`, `src/notes/imagebar.tsx`, `src/ui/keys.tsx` (solo `.key-feedback`); CSS nuevo `src/screens/notes-layout.css` (mover `theme-cristal.css:320-341, 359, 396, 471-478, 720, 769`) | Corrige find-bar/editorbar y key-feedback/insp-over. Claves `notas.*` |
| **D · diagramas** | `src/diagrams/*` (todo), `src/diagrams/diagram.css`; `src/notes/diagramtype.ts` | No tocar `index.html:5`. Claves `diag.*` |
| **E · bug vault/notas** | `src/vault/*` (opfs*, open, safe, handle-fs), `src/notes/store.ts`, `src/lib/autosave.ts`, `src/data/ops.ts`; en `src/app.tsx` solo `:117-125` (`onRejection`/`onNoteSaveFailed`) | Mensajes de error: claves `vault.*` nuevas. Opus si hay concurrencia |
| **F · tipografía global** | `src/theme-cristal.css:1-70` (tokens y `body`/`h1-h4`) y `:178`, `:212`, `:697`; `index.html` solo `<link>`/fuente | Quitar «SF Pro Text». Solo tocar líneas de tokens; no mover otras reglas |

Archivos compartidos y cómo evitar conflicto:
- `src/app.tsx`: A (`:321-380`), E (`:117-125`). Resto de app.tsx = nadie sin aviso; si hace falta, lo hace A al final.
- `src/theme-cristal.css`: F (`:1-70`), A/C/notas-layout movidos a sus CSS. Cada agente borra solo sus líneas; el orden de merge: F primero.
- `src/i18n/{es,en,fr}.json`: prefijos `topbar.*`, `mini.*` (A), `chat.*`/`dock.*` (B), `notas.*` (C), `diag.*` (D), `vault.*` (E). Añadir al final del archivo.
- `src/ui/overlay.tsx`, `src/theme.ts`: nadie edita; son API compartida (Portal, `--kb-inset`).
- Tests: `e2e:phone` debe seguir en 0 px (teléfono no cambia); `e2e:chat`, `e2e:design`, `e2e:diagramas` por agente.

Lo que no está verificado: posición real del mini (medir), causa exacta del bloqueo de escritura (reproducir con dos pestañas o tras error de Worker), comportamiento real en Safari/iPad.
