# Rendimiento · Fase 2 · arranque y paquete (Prompt 21)

Método: medir → cambiar → medir. Chromium 153 (no hay WebKit en el contenedor), bóveda **L**, mediana de 5 corridas con `npm run perf` (`SIZES=L ONLY=inicio,pantallas,estudio REUSE=1`) y, para la primera interacción, un guion aparte (Hoy → Notas de inmediato, 5 corridas). La dispersión entre corridas del banco es de ±10 %; las mejoras que dependían de esa diferencia se repitieron en pares A/B. Un commit por optimización; las tablas están también en el mensaje de cada commit.

## Aplicadas

### 1 · Integridad en reposo (`c9598a8`, cuello #4)
`checkIntegrity` arranca en `requestIdleCallback` (timeout 3 s; `setTimeout` 1.5 s si no existe) y, antes de cada lectura, espera (25 ms, tope 200 ms por archivo y 60 s en total) a que no haya operaciones en la cola del Worker de OPFS (`VaultAdapter.queued?()`, solo OPFS). Sigue recorriendo y reportando todo; nunca borra ni corrige; «Comprobar de nuevo» en Ajustes es inmediato.

| Primera interacción (L) | Antes | Después | Cambio |
|---|---|---|---|
| Hoy interactivo (ms) | 2594 | 2724 | ruido |
| Notas abierta justo tras Hoy (ms) | 9092 | 5526 | **-39 %** |
| Hoy + Notas (ms) | 11650 | 8250 | **-29 %** |

El banco normal casi no lo ve (espera a que la cola esté quieta antes de medir): arranque frío -4 %, caliente -9 %, p95 de Notas 9035 → 5810 ms.

### 2 · `dayKey` con desfase por hora UTC (`4f5ccc8`, cuello #7)
Cache por (zona, hora UTC) del desfase; si el desfase al inicio y al final de la hora difiere (cambio de horario) se calcula directo con `Intl`. Prueba de equivalencia `tests/daykey-equiv.test.ts` (miles de ts aleatorios, barrido cada 37 min durante 2 años y minuto a minuto alrededor de cambios de horario; Mexico_City, Santiago, Madrid, Kolkata, Lord_Howe, UTC; `dayStartHour` 0 y 4).

| Métrica (L, ms) | Antes | Después | Cambio |
|---|---|---|---|
| Pantalla Hoy | 1208 | 267 | **-78 %** |
| Pantalla Estadísticas | 466 | 221 | **-53 %** |
| Pantalla Mazos | 115 | 76 | -34 % |
| Ciclo de pantallas | 7021 | 5953 | -15 % |
| Arranque frío / caliente | 2728 / 2544 | 2547 / 2422 | -7 % / -5 % |

### 3 · `profile.tsx` (`29c2a3c`)
`useProfile` y `Avatar` pasan a `src/ui/avatar.tsx`; `ProfileScreen` queda en su fragmento y desaparece el aviso `INEFFECTIVE_DYNAMIC_IMPORT`. Paquete inicial 315.3 → 313.5 KB gzip (**-0.6 %**): mejora pequeña, se conserva por ser una corrección sin costo en ejecución (no cumple el 5 % del resto; decisión del coordinador si prefiere revertirla).

### 4 · Paquete inicial (`107b609`)
Con sourcemaps (`vite build --sourcemap --outDir <tmp>`): markdown-it + entities + linkify (≈ 240 KB de fuente), DOMPurify, minisearch, fflate y las pantallas Ajustes, Estadísticas, Estudio, Explorar y editor de mazos estaban en la entrada. Ahora van con `import()` (router: Deck, Explorar, Ajustes, Estadísticas, Estudio; app: hoja «Añadir tarjeta» y paleta) y `InstallSteps` pasa a `src/screens/install.tsx`. Hoy y Mazos siguen estáticos (Hoy usa `DeckPanel`). El SW precachea todos los fragmentos (83 de 83 en `sw.js`).

| (L) | Antes | Después | Cambio |
|---|---|---|---|
| Paquete inicial gzip | 313.5 KB | 225.8 KB | **-28 %** |
| Paquete inicial raw | 918.6 KB | 672.0 KB | -27 % |
| Transferido en frío | ≈ 358 KB | 275 KB | -23 % |
| Peticiones en frío | 26 | 31 | +5 |
| Arranque frío / ciclo de pantallas (A/B) | 2645 / 6489 | 2455 / 5880 | dentro del ruido (-7 % / -9 %) |

Iconos lucide: ya se importan por nombre (65 KB de fuente en la entrada, sin barril).

## Descartadas
Ninguna. Pendiente (fuera de esta fase): `DeckPanel` obliga a que `decks.tsx` (con `move`, `zip`/fflate) siga en la entrada; separarlo permitiría sacar unos KB más. Medir en WebKit/iPad cuando exista.

## Verificación
`typecheck`, `vitest` (450), `build`, `e2e`, `e2e:flows`, `e2e:design`, `e2e:mejoras` en verde (Chromium); `e2e:phone` MODE=compare contra la línea base del commit `e12a6a0`: **0 píxeles en 36 capturas** (iPad y web).
