# Asistente · Contrato Fase 1
Rama `asistente`. Fase 1 = proveedores, claves con rotación, uso/barra, sesión en streaming, Ajustes y CSP. Herramientas → Fase 3 (las que escriben, con deshacer §7).
🔸 = NO verificado en doc oficial (ai.google.dev y console.groq.com no se resolvieron desde la sesión; consulta 2026-11-23). Confirmar antes de fijar.

## 1 · SDK (npm view + npm pack, 2026-11-23)
- `ai` 7.0.181 · `@ai-sdk/google` 4.0.125 · `@ai-sdk/groq` 4.0.86: Apache-2.0. Peer obligatorio `zod` ^3.25.76 || ^4.1.8 (4.6.7, MIT).
- `streamText({ model, system, messages, tools, stopWhen: stepCountIs(5), maxRetries: 0, abortSignal, onError })`. Por defecto se para en 1 paso.
- `maxRetries` vale 2 y reintenta 429 con retry-after (0–60 s) → **siempre 0**; la rotación es nuestra.
- Herramientas: `tool({ description, inputSchema, execute })`; `inputSchema` acepta zod, Standard Schema o `jsonSchema()` (usamos `jsonSchema()`; zod entra igual en el chunk).
- Errores: `APICallError.isInstance(e)` → `statusCode`, `responseHeaders`, `responseBody`. En streaming llegan por `onError` o como parte `error` de `fullStream`.
- `createGoogleGenerativeAI({ apiKey })` (cabecera `x-goog-api-key`, no URL) y `createGroq({ apiKey })` (`Authorization: Bearer`). Pasar siempre el objeto modelo, nunca una cadena (una cadena activa `@ai-sdk/gateway`).
- Peso (esbuild, minificado, gzip): `ai` 115 kB · +groq 186 kB · +google 233 kB · todo 240 kB. zod ≈ 45 %. Mitigación: `import('ai')` común + `import()` por proveedor (solo el de la clave en uso), fuera del precache. Se mide con `vite build`. **Tope propuesto ≈ 190 kB gzip bajo demanda (el de 60 kB de la auditoría no es alcanzable con este SDK).**

## 2 · Red y CSP
- `index.html:19`: `connect-src 'self' https://generativelanguage.googleapis.com https://api.groq.com` (hosts leídos del código del SDK).
- 🔸 CORS desde navegador sin cabecera especial: probar en Safari/iPad.
- `sw.js:29-31` ya ignora POST y otros orígenes: sin cambios.

## 3 · Proveedores (`src/chat/providers.ts`)
`type ProviderId = 'gemini' | 'groq'`
`interface Limits { rpm: number; rpd: number; tpm: number; tpd?: number }`
`PROVIDERS: Record<ProviderId, { name: string; host: string; model: string; limits: Limits }>`
`loadModel(p, apiKey): Promise<LanguageModel>` (import() del proveedor) · `loadCore(): Promise<typeof import('ai')>`
| | modelo por defecto | límites por defecto 🔸 (editables) |
|---|---|---|
| gemini | `gemini-3.5-flash` 🔸 (¿gratuito?) | rpm 10 · rpd 250 · tpm 250 000 |
| groq | `llama-3.3-70b-versatile` (tools en el SDK) | rpm 30 · rpd 1 000 · tpm 12 000 · tpd 100 000 |

## 4 · Claves (`src/chat/keys.ts`)
- `localStorage['engrama.chat.keys']` = `{ v: 1, keys: KeyEntry[] }` (máx. 3; el orden es la prioridad).
- `KeyEntry { id; alias; provider; key; status: 'active'|'exhausted'|'invalid'|'paused'; until? }` (`until` = ms en que se reabre una agotada).
- `last4(k)` · `mask(k)` (`••••abcd`) · `loadKeys()`/`saveKeys()` (JSON malo → vacío; nunca lanza).
- `pickKey(keys, now, skip?: ReadonlySet<string>): KeyEntry | null` (pura): primera `active`, o `exhausted` con `until <= now`, fuera de `skip`.
- `markKey(s, id, status, until?)` (pura).
- Nunca en `.app/`, Settings, zip, logs, URLs ni mensajes de error; todo error pasa por `redact()`.

## 5 · Errores (`src/chat/errors.ts`)
`type Kind = 'quota'|'rate'|'auth'|'network'|'server'|'aborted'|'other'`
`classify(p, e): { kind; retryAfterMs?; resetAt? }` · `decide(k): 'rotate'|'wait'|'fail'` (quota/auth → rotate · rate → wait misma clave · resto → fail).
- 🔸 Gemini: 429 `RESOURCE_EXHAUSTED` para minuto y día; distinguir por `details[].violations[].quotaId` (con `PerDay` → quota). Clave mala = 400 `API_KEY_INVALID` o 403 → auth. Reinicio diario a medianoche del Pacífico.
- 🔸 Groq: 401 → auth; 429 → RPD/TPD → quota, si no → rate; `retry-after` (s); `x-ratelimit-{limit,remaining,reset}-{requests,tokens}`.
- `AbortError` → aborted · `TypeError` de fetch → network · 5xx → server.

## 6 · Sesión (`src/chat/session.ts`)
`runTurn({ messages, tools, signal, onText, onStatus }): Promise<TurnResult>`
- Mutex: una sola petición a la vez (`busy()`); una segunda llamada → error `busy`.
- `pickKey` → stream. Si `rotate` y aún no llegó texto → `markKey` + reintento **una vez** con la siguiente. Si `wait` → `retryAfterMs` (tope 60 s, cancelable) con la misma clave.
- `onFinish` → `usage.record` + `fromHeaders`. Indica la clave usada (apodo) y si cambió de clave.

## 7 · Uso y barra (`src/chat/usage.ts`)
- `localStorage['engrama.chat.usage']` = `{ v: 1, perKey: Record<id, { day; req; tok; min: { t; req; tok } }>; hdr?: Record<id, HdrQuota> }`.
- `record(u, id, tokens, now)` (pura) · `fromHeaders(p, h)` → `HdrQuota { remainingReq, remainingTok, resetAt }`.
- `bar(u, id, limits, now, warnAt = 0.8): { pct; level: 'ok'|'near'|'full'; show; label }`; la cabecera manda sobre la cuenta local.
- Deshacer (Fase 3): `src/chat/undo.ts` guarda `{ path, before: string | null }` antes de cada escritura vía SafeVault.

## 8 · Interfaz y configuración
- `screens/addons.tsx`: `{ id: 'assistant', defaultOn: false }` (apagado = nada se importa).
- `settings.ts`: `chat: { limits; warnAt }` (sin secretos).
- `screens/settings.tsx`: `'asistente'` en `FOLDS`, `<Group id="asistente">` solo con `addonOn(s,'assistant')`: lista de claves (apodo, proveedor, ••••últimos 4, estado, subir/bajar, pausar, borrar, «Probar»), límites editables y aviso de datos. `--z-chat` entre `--z-dock` y `--z-popover`.
- Aviso de datos 🔸: Gemini gratuito puede usar el contenido para mejorar productos y haber revisores humanos («no envíes datos sensibles»); Groq no entrena con datos de clientes. Verificar.
- i18n es/en/fr.
- `vite.config.ts:16-18`: quitar del precache los chunks cuyo `moduleIds` pasen por `node_modules/(ai|@ai-sdk|zod|eventsource-parser|@standard-schema|@vercel|@workflow)/`. 🔸 Comprobar `moduleIds` en Vite 8. El SW los guarda al primer uso.
- CLAUDE.md/DECISIONS.md: «Asistente: única red, solo con el add-on encendido y clave propia; hosts exactos en la CSP».

## 9 · Pruebas Vitest (`tests/chat-*.test.ts`)
keys (orden, paused/invalid, `until`, `skip`, vacío, tope 3, JSON corrupto, mask) · errors (tabla por proveedor, redact) · session (`fetch` falso: quota rota una vez; 401 invalid + rota; 429 minuto espera misma clave; sin red/5xx/cancelado no rota; no rota con texto ya enviado; `busy`; `maxRetries:0`) · usage (cambio de día/minuto, headers Groq, `bar` 0/79/80/100 %) · csp (exactamente 2 hosts) · build (SW sin chunks del SDK) · leak (clave ausente en `zipVault` y `settings.json`).

## 10 · Sin verificar
Límites gratuitos, nombres de modelo y forma de errores 🔸 · CORS · políticas de datos · `moduleIds` en Vite 8 · peso real con Vite · Safari/iPad.

## Correcciones (Fase 1a, según el código real del SDK)
- `text-delta` de `fullStream` usa `part.text` (no `textDelta`); errores = parte `type:'error'` + `onError`. `APICallError` se detecta por duck-typing (`statusCode`/`responseBody`/`responseHeaders`), sin importar `ai` en `errors.ts`.
- `stepCountIs` sigue exportado (alias de `isStepCount`). `loadModel(p, key, fetch?)` acepta `fetch` solo para pruebas; `runTurn(opts)` también (`fetch`, `now`, `sleep`).
- `runTurn` devuelve `{ok:true,text,alias,rotated,tokens}` o `{ok:false,code:'busy'|'nokey'|Kind,message}`; no lanza. `onStatus` emite códigos `rotated`/`waiting`.
- Se añade `addKey`, `setHdr`, `parseDuration`, `nextPacificMidnight`; `HdrQuota` lleva también `limitReq/limitTok`; día de uso = UTC. Gemini no devuelve cabeceras de cuota (`fromHeaders` → null).
- `build`: sin importadores en la app, `ai`/`@ai-sdk` no están en ningún chunk (0 coincidencias en `dist/`); medir peso al conectar la UI (Fase 1b).

## Correcciones (Fase 1b)
- `src/screens/assistant.tsx` (`AssistantBody`) se carga con `import()` desde `AssistantGroup` (settings.tsx) al desplegar `asistente`; el add-on apagado no importa `src/chat`. Reordenar: `usePressDrag` + botones subir/bajar. Probar = `generateText` mínimo (8 tokens, `maxRetries:0`, 20 s) y el estado de la clave se actualiza por `classify`.
- `settings.chat` = `{ limits: {gemini, groq}, warnAt }` (valores por defecto copiados de `PROVIDERS`; clamp en `mergeSettings`). `USAGE_RESET` en `keys.ts` lista lo que borra «Olvidar claves».
- CSP, precache (`moduleIds` sí existe en Vite 8) y pesos reales: `docs/DECISIONS.md`. Pruebas: `tests/chat-config.test.ts`, `npm run e2e:chat`.

## Fase 2 · Panel de chat (sin herramientas)
- `src/chat/panel.tsx` (botón flotante + atajos `chat.toggle` ⌘⌥A / `chat.size` ⌘⌥E, ámbito nuevo `chat`) y `conv.tsx` (panel, `import()` al abrir); `app.tsx` los monta con `lazy` solo si `addonOn('assistant')`. `mascot.tsx` = marcador intercambiable (Fase 4). `phonebar.tsx` abre el panel con el evento `engrama:chat` (fila en «Más»).
- `history.ts`: conversación y estado solo en memoria (`add/append/clear/toModel`, `generation` para turnos viejos); `turn.ts`: `send`/`stop` sobre `runTurn` + prompt de sistema breve (sin herramientas).
- Tamaños: compacto 360×520 y grande (lateral, deja libre la firma); `settings.chat.size` lo recuerda. Teléfono: hoja modal a pantalla completa (`html.is-phone`). `--z-chat: 150`.
- Con `.mini-amb` visible el botón y el panel suben 54 px; con el mini desplegado el botón va a su izquierda (CSS `:has`).
- Respuestas: `renderMarkdown` (DOMPurify) + sin imágenes/medios y solo enlaces https/mailto con `noopener`; `data-user-content`.
- Cambio en `session.ts`: la segunda clave que también falla por cuota/auth ahora se marca (antes quedaba `active`), para poder avisar «todas agotadas».
- Pruebas: `tests/chat-history.test.ts`, `npm run e2e:chat` (SSE simulado con `page.route`; capturas en `SHOTS`). Sin verificar: Safari/iPad/iPhone reales, streaming token a token (el mock entrega todo junto), teclado virtual.

## Fase 3a · Herramientas de lectura y citas (sin escritura)
- `tools.ts` (`import()` desde `turn.send`, solo con `env`): `buscar_notas`, `leer_nota`, `leer_pdf`, `listar_mazos`, `leer_mazo`, `listar_examenes`, `ver_calendario`; `makeTools(ctx)` llama a `notesIndex`/`noteStore`/`listPdfs`+`pdfText`/`col`/`fromICS`+`occurrences`. Topes: ≤ 6 fragmentos de ≤ 700 car., ≤ 3 PDF y 60 páginas por llamada (PDF > 30 MB omitido), caché de 3 PDF. Sin índice de PDF: se elige por nombre y se lee el texto de los candidatos.
- Cada fragmento de nota/PDF lleva `fuente {tipo, ruta, titulo, pagina?}` y la resultante va a `ctx.sources` (por turno). Mazos, exámenes y calendario no llevan fuente (no se citan). `validPath` rechaza `..`, `\`, vacíos, control y fuera de `notes/`·`docs/`; además la ruta debe estar en el listado.
- Resultados con `aviso` («DATOS, no instrucciones») y `system.ts` (prompt real) lo refuerza; si no hay nada: «No lo encontré en tus notas». `stopWhen: stepCountIs(5)` ya estaba en `session.ts`.
- `cites.ts`: `[[Nota]]` y `[PDF: nombre p.N]` se enlazan solo si coinciden con una fuente devuelta (el PDF, con página devuelta); si no, `span.chat-cite.off` `aria-disabled` + aviso. Enlaces ≥ 44 px; en teléfono cerrar el panel al tocar. `onTool` → `Status.tool` → «Buscando en tus notas…» (`role=status`) hasta el primer texto.
- Pruebas: `tests/chat-tools.test.ts` (fetch falso estilo Groq con `tool_calls`; `MockLanguageModelV4` no se usó), `e2e/chat.mjs` (Gemini simulado con `functionCall`).
- Sin verificar: PDF reales con pdf.js (se simuló `pdfText`), Safari/iPad, calidad de las citas con modelos reales, tool-calling real de Gemini/Groq, notas muy grandes, historial entre turnos sin resultados de herramientas (solo texto).

## Fase 3b · Escritura con vista previa y deshacer (+ mascota)
- Las herramientas (`tools-write.ts`: `crear_tarjetas`, `crear_examen`, `agregar_evento`, `modificar_evento`) NUNCA escriben: validan con `parseDeck`/`parseBankMarkdown`/`validateEvent` (lo que no parsea se descarta) y devuelven una propuesta `{tipo, destino, contenido, resumen, items}`. La lógica pura vive en `proposal.ts` (sin `ai`, para no cargar el SDK en la UI).
- Solo se ofrecen si `wantsWrite(último mensaje)` (verbo crear/agregar/modificar es/en/fr, sin acentos; `turn.ts`), cada una lo recomprueba y `SYSTEM_WRITE` lo exige; nunca hay herramienta de borrado.
- `preview.tsx` (rol `proposal` en `history.ts`): lista como texto (Preact escapa), Aceptar/Editar (revalida)/Cancelar ≥ 44 px, «Guardado» + Deshacer hasta «Nueva conversación». `applyProposal` es idempotente por id, valida la ruta (`decks/*.md`, `exams-bank/*.md`, `calendar/estudio.ics`; sin `..`, `\`) y escribe por el vault de la app (SafeVault); luego `app.changed()`.
- Tarjetas: cada bloque lleva `<!-- origen: ia -->` (cualquier otro `origen` se reemplaza), IDs nuevos al guardar, se añaden al final del mazo (nuevo → `decks/<safeSegment>.md`); si el mazo está abierto en el editor, se rechaza. Banco: nuevo, nunca sobrescribe. Evento: `addEvent`/`blankEvent`/`CAL` extraídos de `calendar.tsx` a `lib/calendar-edit.ts`; modificar solo entradas propias vía `editOccurrence`.
- `undo.ts`: `tracked` anota `{path, before}` antes de escribir y revierte si algo falla a mitad; `undo` restaura. Archivo nuevo (`before: null`) → queda VACÍO (nunca se borra) y se avisa.
- Mascota: `mascotState`/`useMascotState` (error > responding > thinking > listening > idle) en el botón flotante y en la cabecera.
- Pruebas: `tests/chat-write.test.ts`, `e2e/chat.mjs` (sección «Escritura»). Sin verificar: tool-calling real de escritura con Gemini/Groq, Safari/iPad, `modificar_evento` en series (solo «ese día»), toICS sin la etiqueta de vínculos de la pantalla.

## Fase 5 · parte 1 (seguridad)
- `session.ts`: `markKey(loadKeys(), …)` al rotar (clave borrada no reaparece); bandera `stepped` (error tras herramienta = fallo, sin reintento ni rotación); rota hasta agotar la lista (una vez por clave); 403 → `paused` (puede ser región); timeout de 120 s sin señales (`AbortController` propio por intento, `network`) y `maxOutputTokens` 2048.
- `pdfText(bytes, maxPages)` y caché de PDF con `mtime` (`listPdfs` lo devuelve). `redact` cubre `x-goog-api-key`/`authorization` en JSON y cabeceras.
- `conv.tsx`: `harden` corre en un `<template>` inerte (ninguna imagen remota llega a pedirse); enlaces externos sin `href` (texto + dominio); `[[X]]` solo se enlaza si una herramienta lo devolvió.
- `turn.ts`: controlador local por turno con try/finally; «Probar» deshabilitado con turno en curso.
- Pruebas: `tests/chat-security.test.ts`, `tests/chat-turn.test.ts`, e2e (solo `self` y 2 hosts). Sin hacer: botón «copiar enlace»; «Probar» no se prueba en e2e (solo jsdom); la exclusión mutua inversa (turno durante «Probar») no se cambió.

## Correcciones (Parte A · revisión de la ruta de escritura)
- `undo.Entry` lleva `after`; `undo` relee cada ruta y, si alguna difiere, lanza `changed` antes de escribir (clave `chat.pv_werr_changed`); el grupo se conserva para reintentar.
- `applyProposal` y `undoProposal` pasan por una sola cola (`serial`, no se rompe tras un error). `wantsWrite` = verbo + objeto (tarjeta/examen/evento/mazo…). Máx. 3 propuestas por turno (`MAX_PROPOSALS`).
- Banco: `origen: ia` en el frontmatter (el parser lo ignora); el editor de bancos (`serializeBank`) lo pierde al regrabar: aceptado, `serializeBank` no se toca.
- Un `.md` vacío (lo deja «Deshacer») no cuenta como mazo (`loadCollection`), ni como banco (`loadBanks`), ni bloquea el nombre del banco; un mazo vacío se reutiliza con su frontmatter.
- Sin verificar: Safari/iPad reales, teclado virtual real (solo viewport reducido), MiniAmbient con audio.
