# Registro · Prompt 20 (notas de diagramas)

## Subagentes por tarea
Tokens = total del subagente según la herramienta (entrada + salida). «≈100 k» = el subagente corrió en segundo plano y su total no quedó en el registro; se estima con la media de los medidos (~104 k). La coordinadora no está incluida.

| Ola | Subagente | Tarea | Dificultad | Modelo | Resultado | Tokens |
|---|---|---|---|---|---|---|
| 1 | Explorador | Notas y mapa del código | fácil | haiku | reutilizables y plan | 99 k |
| 1 | Explorador | Regenerar `docs/audit/MAPA.md` (carpetas cambiadas) | fácil | haiku | mapa al día (`ebfc279`) | ≈100 k |
| 1 | Arquitecto | `CONTRATO.md` | media | sonnet | contrato y decisiones abiertas | 92 k |
| 2 | Lógica | Gramática: `parse` y `serialize` (ida y vuelta) | media | sonnet | `parse.ts`, `serialize.ts` | ≈100 k |
| 2 | Algoritmos | Acomodo por capas con ciclos y cruces | difícil | opus | `layout.ts`, 15 pruebas | ≈100 k |
| 2 | Traductor | Claves i18n, tipos y carga | fácil | haiku | `diag.*` es/en/fr | 99 k |
| 3 | Interfaz | Vista Cristal | media | sonnet | `view.tsx`, `mount.ts` | ≈100 k |
| 3 | Interfaz | Conectar tipos de nota | media | sonnet | `diagramtype.ts`, Nueva nota, «/» | 121 k |
| 3 | Probador | Extremos y ciclos | media | sonnet | 16 pruebas | ≈100 k |
| 3 | Probador | Verificación visual en navegador | media | sonnet | 2 fallos hallados (vista vacía, px) | ≈100 k |
| 4 | Interfaz | `applyEdit` con deshacer exacto (2 pasadas) | media | sonnet | `edit.ts`, 16 pruebas | 83 k + ≈100 k |
| 4 | Gestos | Gestos y concurrencia del lienzo | difícil | opus | `canvas.tsx`, `gestures.ts`, 22 pruebas | ≈100 k |
| 4 | Interfaz | Editor: barra, acciones, deshacer | media | sonnet | `editor.tsx`, `toolbar.tsx`, `history.tsx` | ≈100 k |
| 4 | Traductor | Claves del editor y lienzo | fácil | haiku | 31 claves | 94 k |
| 5 | Interfaz | Exportar PNG y SVG | media | sonnet | `export.ts` | 102 k |
| 5 | Interfaz | Botón Exportar | media | sonnet | `export-ui.tsx` | 94 k |
| 5 | Interfaz | Embed `![[ ]]` y búsqueda de nodos | media | sonnet | `embed.ts`, `find.tsx` | 119 k |
| 6 | Seguridad | Revisión del texto de diagramas | media | sonnet | 8 pasa, 1 leve (corregido) | 115 k |
| 6 | Probador | E2E en navegador | media | sonnet | `e2e/diagramas.mjs` | ≈100 k |
| 6 | Interfaz | Pintar etiqueta de flecha en el lienzo | fácil | sonnet | arreglo de 1 archivo | ≈100 k |
| 6 | Probador | Presupuesto del fragmento | fácil | sonnet | medición: ver = 8,4 KB | ≈100 k |
| 7 | Coordinadora | Limpieza, docs, carreras de `e2e:bancos`/`e2e:p5`, batería | — | haiku → opus | este registro | no medido |

## Costo real frente a un solo modelo (estimación)
Precios de lista (USD por millón, entrada / salida): haiku 5.5 0,10 / 0,50 · sonnet 5.5 2 / 10 · opus 5.5 4 / 20. Se supone 90 % entrada y 10 % salida (tarifa mezclada: haiku 0,14 · sonnet 2,80 · opus 5,60 por millón). Son estimaciones: casi la mitad de los totales son aproximados y no se cuenta a la coordinadora.

| Reparto | Tokens | Costo aprox. |
|---|---|---|
| Real: haiku ~0,39 M · sonnet ~1,63 M · opus ~0,20 M | ~2,2 M | **≈ 5,7 USD** |
| Todo en opus | ~2,2 M | ≈ 12,4 USD |
| Todo en sonnet | ~2,2 M | ≈ 6,2 USD |

Ahorro ≈ 54 % frente a usar solo opus y ≈ 8 % frente a usar solo sonnet. Casi todo el gasto es de sonnet (trabajo de dificultad media), así que el ahorro viene de dejar opus solo para el acomodo y los gestos.

## Notas
- Presupuesto de carga (§1): el «fragmento de 32 KB» resultó ser la pantalla de Notas. Ver un diagrama carga ≈ 8,4 KB gzip (límite ~15 KB); editar (11,9 KB) y exportar (2,7 KB) van en fragmentos aparte (`estado-presupuesto.md`).
- Los subagentes de las olas 4–6 se corrieron en el checkout principal y no en *worktrees*: los *worktrees* salían de una base vieja y no se pudo avanzarlos.
- No se hizo la pausa para probar en iPad (ola 4): el usuario pidió seguir sin parar hasta terminar.
