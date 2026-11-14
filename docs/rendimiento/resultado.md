# Prompt 21 · resultado (fase 8)

Toda la línea base (`npm run perf`, todos los escenarios, bóvedas S/M/L, mediana de 5) medida **en la misma máquina** sobre `main` antes del Prompt 21-B (`974174a`, ya con las fases 0–2) y sobre la rama `rendimiento-2`. Los grupos arranque, pantallas, estudio y mover se repitieron tras la corrección del punto de control (`c1c9f94`); el resto es de `ceaf813` (sin cambios de código en esas áreas desde entonces). Chromium en el contenedor (no hay WebKit): sirve para comparar, no son cifras del iPad.

## Tabla antes/después
| Métrica | Bóveda | Antes (mediana) | Después (mediana) | Cambio | p95 antes → después |
|---|---|---|---|---|---|
| importar-zip-boveda | S | 3.06 s | 2.27 s | -26 % | 3.06 s → 2.27 s |
| importar-zip-boveda | M | 11.2 s | 5.86 s | -48 % | 11.2 s → 5.86 s |
| importar-zip-boveda | L | 40.1 s | 17.5 s | -56 % | 40.1 s → 17.5 s |
| arranque-frio-hasta-Hoy | S | 720 ms | 736 ms | +2 % | 769 ms → 746 ms |
| arranque-frio-hasta-Hoy | M | 1.31 s | 1.17 s | -11 % | 1.41 s → 1.25 s |
| arranque-frio-hasta-Hoy | L | 2.92 s | 2.85 s | -2 % | 3.02 s → 2.87 s |
| arranque-caliente-hasta-Hoy | S | 500 ms | 540 ms | +8 % | 562 ms → 573 ms |
| arranque-caliente-hasta-Hoy | M | 1.11 s | 1.02 s | -9 % | 1.15 s → 1.07 s |
| arranque-caliente-hasta-Hoy | L | 2.76 s | 2.60 s | -6 % | 2.88 s → 2.63 s |
| pantalla-mazos | M | 85 ms | 68 ms | -20 % | 116 ms → 242 ms |
| pantalla-mazos | L | 54 ms | 55 ms | +2 % | 125 ms → 154 ms |
| pantalla-notas | M | 1.75 s | 440 ms | -75 % | 1.97 s → 1.60 s |
| pantalla-notas | L | 6.83 s | 1.23 s | -82 % | 7.33 s → 5.44 s |
| pantalla-estadisticas | M | 156 ms | 137 ms | -12 % | 176 ms → 184 ms |
| pantalla-estadisticas | L | 280 ms | 250 ms | -11 % | 332 ms → 355 ms |
| pantalla-hoy | M | 149 ms | 163 ms | +9 % | 165 ms → 179 ms |
| pantalla-hoy | L | 273 ms | 279 ms | +2 % | 311 ms → 316 ms |
| ciclo-pantallas | M | 2.14 s | 808 ms | -62 % | — → — |
| ciclo-pantallas | L | 7.44 s | 1.82 s | -76 % | — → — |
| estudio-mostrar | M | 69 ms | 86 ms | +25 % | 77 ms → 87 ms |
| estudio-mostrar | L | 74 ms | 85 ms | +14 % | 102 ms → 90 ms |
| estudio-responder-siguiente | M | 291 ms | 179 ms | -39 % | 398 ms → 275 ms |
| estudio-responder-siguiente | L | 414 ms | 182 ms | -56 % | 508 ms → 279 ms |
| fsrs-100k-reconstruir-y-verificar | L | 2.12 s | 2.24 s | +6 % | 2.25 s → 2.28 s |
| busqueda-indice | M | 1.56 s | 1.28 s | -18 % | 1.71 s → 1.51 s |
| busqueda-indice | L | 6.14 s | 5.18 s | -16 % | 6.75 s → 6.04 s |
| busqueda-consulta | M | 22 ms | 22 ms | +1 % | 38 ms → 35 ms |
| busqueda-consulta | L | 23 ms | 25 ms | +6 % | 33 ms → 39 ms |
| nota-abrir-1MB | nota | 1.84 s | 1.76 s | -5 % | 2.28 s → 2.39 s |
| nota-teclear-50-bloque-1MB | nota | 70 ms | 76 ms | +10 % | 72 ms → 81 ms |
| nota-teclear-50-markdown-1MB | nota | 84 ms | 91 ms | +8 % | 100 ms → 100 ms |
| nota-buscar-en-nota-1MB | nota | 409 ms | 408 ms | 0 % | 426 ms → 417 ms |
| nota-abrir-5MB | nota | 4.05 s | 4.11 s | +1 % | 4.25 s → 4.58 s |
| nota-teclear-50-bloque-5MB | nota | 70 ms | 79 ms | +12 % | 74 ms → 88 ms |
| nota-teclear-50-markdown-5MB | nota | 75 ms | 79 ms | +5 % | 79 ms → 93 ms |
| nota-buscar-en-nota-5MB | nota | 1.87 s | 1.28 s | -32 % | 2.63 s → 1.37 s |
| mover-100-notas | M | 6.71 s | 1.83 s | -73 % | 7.55 s → 2.74 s |
| mover-100-notas | L | 13.8 s | 2.54 s | -82 % | 15.2 s → 6.31 s |
| mover-mazo-5000 | M | 305 ms | 203 ms | -33 % | 418 ms → 213 ms |
| mover-mazo-5000 | L | 926 ms | 611 ms | -34 % | 1.13 s → 623 ms |
| importar-zip-500-archivos | n/a | 7.04 s | 4.03 s | -43 % | 8.09 s → 4.58 s |
| respaldo-crear | L | 8.72 s | 7.40 s | -15 % | 9.41 s → 8.07 s |
| respaldo-restaurar | L | 35.7 s | 17.9 s | -50 % | 36.3 s → 18.1 s |

`estudio-mostrar` («Mostrar respuesta») mide entre el toque y la respuesta en pantalla; `estudio-responder-siguiente`, entre calificar y la tarjeta siguiente. `ciclo-pantallas` = Mazos → Notas → Estadísticas → Hoy. `pantalla-notas` = mediana de 5 visitas (la primera llena la caché de textos).

## Lo principal
- **Mover 100 notas**: M 6.71 → 1.83 s (−73 %), L 13.8 → 2.54 s (−82 %); de 200 escrituras al diario a 1.
- **Restaurar el respaldo de L**: 35.7 → 17.9 s (−50 %); de 2 606 escrituras al diario a 1. **Importar el zip de 500**: 7.04 → 4.03 s (−43 %).
- **Abrir Notas**: L 6.83 → 1.23 s (−82 %); **ciclo de pantallas** L 7.44 → 1.82 s (−76 %).
- **Estudiar** (calificar → siguiente): L 414 → 182 ms (−56 %), p95 508 → 279 ms; una escritura al diario por respuesta y 0 tareas largas en el gesto.
- **Buscar dentro de la nota de 5 MB**: 1.87 → 1.28 s (−32 %). **Crear el respaldo de L**: 8.72 → 7.40 s y pico de memoria 204 → 100–120 MB.
- **Arranque**: −2 % a −11 % (la fase 2 ya lo había bajado; esta tanda no lo empeora).

## Regresiones que quedan
- **«Mostrar respuesta»** en estudio: M 69 → 86 ms (+25 %), L 74 → 85 ms (+14 %; su p95 en L mejora, 102 → 90 ms). Son ~12–17 ms, por debajo de lo perceptible, y no hay causa confirmada: ese gesto no escribe ni lee. Queda anotado para perfilar.
- **FSRS 100 k, reconstruir y verificar**: +6 % (2.12 → 2.24 s), dentro del ruido de esa métrica. Es la repetición completa sin caché, que ya no está en el camino normal (punto de control, fase 4).

## Un fallo encontrado por esta verificación (corregido)
La primera corrida completa mostró el arranque L +16–20 %, Mazos +113 % y Hoy +23 %. Causa: una bóveda creada vacía guardaba el punto de control de FSRS en 0. Tras llenarla por importación (que escribe el historial con el lote, no con `appendLog`), cada arranque reconstruía todas las tarjetas y el punto de control nunca avanzaba. El resultado era correcto (idéntico), solo lento. Corregido en `c1c9f94`, con prueba nueva: al cargar, si hubo entradas nuevas tras el punto de control, se guarda uno actualizado.

## Objetivos de `01-cuellos.md`
| Objetivo | Resultado |
|---|---|
| Mover 100 notas ≤ 2 diarios, < 1 s M, < 2 s L | diarios sí (1); M 1.83 s y L 2.54 s: cerca, no |
| Zip de 500 < 2 s | 4.03 s: no |
| Restaurar L < 10 s | 17.9 s: no |
| Estudio p95 ≤ 100 ms, ≤ 1 diario, 0 tareas largas | diarios y tareas largas sí; p95 279 ms: no |
| Abrir Notas L < 1 s | 1.23 s: cerca, no |
| Respaldo −4 s y −130 MB | −1.3 s y −84 a −104 MB: parcial |

## Verificación final
- `npm test` (476), `npm run typecheck`, `npm run build`.
- Todos los E2E de `CLAUDE.md` → «Comandos» (24) en verde, más `e2e:barra`, sobre la rama: `e2e`, `flows`, `design`, `mejoras`, `mejoras2`, `bloquec`, `p5`, `p6`, `p7`, `p10`, `p12`, `p15`, `glass`, `adherencia`, `p14`, `reproductor`, `pdf`, `share`, `tasks`, `stickies`, `intentos`, `bancos`, `notaspro`.
- `e2e:bloquec` falló **una vez de cuatro**: «antes de recargar: Semana muestra Clase 8:00–10:00 y Estudio 17:00–18:00». Las otras tres pasaron enteras. Es intermitente; probablemente la prueba lee la vista Semana antes de que termine la carga asíncrona del Calendario (que en esta rama lee las notas de la caché). Queda anotado.
- `e2e:phone` contra `main`: **0 píxeles** en 36 capturas.
- Determinismo e integridad: `verifyDeterminism` y la equivalencia bit a bit del punto de control (100 000 repasos, cuatro zonas horarias); recuperación de lotes y de añadidos con muerte en cada paso (también durante la recuperación); la integridad solo reporta.
