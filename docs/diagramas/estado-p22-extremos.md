# Estado · P22 Probador de extremos (rama `fix-diagramas`)

Prueba: `tests/diagrams-p22-extremos.test.ts` (24 casos: 23 pasan, 1 `it.fails`). Sin cambios en `src/`.
Ejecución: `npx vitest run tests/diagrams-p22-extremos.test.ts`.

## Casos Vitest (todos: no lanza, ida y vuelta exacta, resultado con sentido)
- 300 nodos completos y tooBig en 301; mapa vacío, solo saltos de línea, un nodo, flujo vacío; ciclos en flujo.
- Texto de 5 000 caracteres medido completo; 5 001 → aviso `tope`, medida truncada a 5 000.
- Palabra de 2 000 letras: corte por caracteres, sin desbordar el ancho. Emoji, CJK y árabe: ida y vuelta y medida finita.
- `**` sin cerrar y `*` suelto: sin lanzar; las marcas no salen en la medida.
- 200 líneas con sangrías raras (tabs, saltos de 3 niveles, 5 tipos de viñeta): `parseOutline` sube como mucho +1 y no pierde ítems; `addTree` en un paso (202 nodos) y deshacer exacto.
- Valores absurdos (`w=0`, `w=-5`, `w=999999`, `h=abc`, `color=9`, `color=0`, `fs=xl`): literales y no aplicados en flujo y mapa.
- `applyEdit` con valores fuera de rango: no escribe nada (texto y memoria iguales); control con `w=300` sí aplica.
- `{color=1,color=2}` no lanza; `{}` queda como texto; `# fondo: inventado` = `cristal`, línea literal.
- `alto=-1` y `alto=99999` en el fence: `diagramFence(...).alto` indefinido y `setFenceAlto` no cambia el bloque.
- SVG de texto de 5 000 caracteres finito; PDF (`exportPdf`, 120 nodos, a4/varias) devuelve vector o error tipado.

## Fallos reales
- **Menor (hipotético)**: `src/diagrams/measure.ts:109`. Un medidor que devuelve `NaN` contamina `w`/`h` (`Math.ceil(Math.max(NaN, 56))` = NaN). El `measureText` real no devuelve NaN, por eso el caso va como `it.fails`.

## Observaciones (no son fallos)
- `[A] {w=0,…} --> [B] {w=-5}` (sufijo de nodo a mitad de línea): la línea da error `forma` (`src/diagrams/parse.ts:232-241`) y no crea nodos ni arista. Queda literal y sin pérdida de texto. Es gramática, no un bug; conviene documentarlo en el contrato.

## Chromium (build `dist/`, viewport 1180×820, DSF 1, `scratchpad/p22-extremos.mjs`)
- Flujo de 300 nodos: 300 pintados en ~0,5–0,6 s (`requestAnimationFrame` tras el primer frame con 300 nodos).
- Arrastre de un nodo visible, 60 pasos de ratón con un frame de espera cada uno: el nodo se movió (240,120 px) y el peor intervalo entre fotogramas fue 49–62 ms. Medición en headless con render por software; no es cifra de iPad.
- Nota con nodo de 5 000 caracteres: 0 nodos con recorte (`scrollWidth`/`scrollHeight`), sin «…», nodo de 606 px de alto. Sin errores de consola ni de página.
- Calibración: la primera pasada eligió nodos bajo la barra superior (un `button` recibía el puntero). Corregido en el script; no es fallo de la app.
- Capturas: `scratchpad/p22x-flujo300.png` y `scratchpad/p22x-texto5000.png`.
