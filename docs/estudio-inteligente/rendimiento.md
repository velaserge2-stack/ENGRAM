# Carril G · Rendimiento de la analítica

Medición: `BENCH=1 npx vitest run tests/analytics-bench.test.ts --reporter=verbose` (colección sintética S/M/L de `tests/helpers/synth.ts`, mismos tamaños que `scripts/vault-gen.mjs`: 500/5 000/20 000 tarjetas; 1,7 k / 17 k / 70 k repasos; media de 3 corridas tras calentar, hilo principal de Node). Sin bóveda real: la sintética agrupa repasos en instantes idénticos (peor caso para `confusions`).

## Cifras (ms)
| función | M antes | M después | L antes | L después |
|---|---|---|---|---|
| weaknesses | 18,6 | 10,6 | 12,9 | 15,7 |
| masteryTree | 14,2 | 3,5 | 12,3 | 13,3 |
| forecastRetention | 20,8 | 7,2 | 44,4 | 34,8 |
| relapses | 3,1 | 0,5 | 27,3 | 2,8 |
| **confusions** | 29,7 | 4,1 | **561** | **147** |
| smartNewGoals | 1,8 | 0,8 | 5,0 | 9,5 |
| buildAdaptiveQueue | 27,2 | 8,2 | 72,4 | 73,7 |
| stats (activity, retención, atRisk…) | ≤ 7 | ≤ 3 | ≤ 22 | ≤ 21 |

Presupuesto (M < 50 ms, L < 200 ms por cálculo): cumplido; antes solo `confusions` en L lo rompía. Las diferencias pequeñas en L son ruido de medición.

## Qué cambió
- `confusions`: pares en mapa anidado (sin cadena por par) y mazo precalculado por fallo (561 → 147 ms en L).
- `reviewLog` (undo + orden) se calcula una vez por firma `log.length:último ts` y lo comparten `relapses` y `confusions`.
- `cached.*` en `analytics.ts`: memoización de una entrada por función y colección; clave = firma del historial + `states.size` + `decks.length` + `now` + parámetros. Mismo resultado que la función directa (`tests/analytics-memo.test.ts`).
- Paneles (`analitica.tsx`): cada uno calcula en su propia tarea (`setTimeout 0`), solo al acercarse a la pantalla (`IntersectionObserver`, con alternativa sin él), `now` redondeado al minuto para que los `app.tick` acierten la caché; estado «Calculando…» (`role=status`, `aria-busy`). Mantienen el valor anterior mientras recalculan.
- Dominio con teclado: ↑/↓ mueven entre filas, → despliega, ← pliega, Enter/espacio (botón), `aria-expanded`. Enlaces de Confusiones ≥ 44 px.
- `adaptive.ts` usa las versiones cacheadas.

## Quedó fuera
- `stats.tsx` sigue calculando sus gráficas en cada render (≈ 70 ms sumados en L); cada una cumple el presupuesto. Mejora futura: `useMemo` por `[col, app.tick]` (requiere mover los hooks antes del `return` temprano).
- Sin medición del render real con bóveda L en navegador ni en Safari/iPad.
- Sugerencia para `package.json`: `"bench:analitica": "BENCH=1 vitest run tests/analytics-bench.test.ts --reporter=verbose"`.
