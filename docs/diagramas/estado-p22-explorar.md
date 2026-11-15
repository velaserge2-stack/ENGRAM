# P22 · Explorar: problemas de diagramas reproducidos

Rama `fix-diagramas` (commit 71280d9). Chromium (no hay WebKit en el contenedor), viewport 1180×820, DSF 1, locale es-MX, build de `npm run build`. Script de reproducción: `/tmp/claude-0/-home-user-ENGRAM/6d5815c1-fa83-51d2-bee9-a6b69147fb7d/scratchpad/p22-repro.mjs` (resultados crudos en `.../scratchpad/p22-results.json`). Tema claro. Capturas en `docs/diagramas/p22/`.

## 1. Lienzo chico: reproducido sí (con matiz)
- Mapa de 4 nodos, `Ajustar al contenido`: el tablero mide 494×574 px (89 % del ancho de la nota, 554 px).
- El contenido ocupa solo el 19,6 % del área del tablero; márgenes 115 px (izq./der.) y 182 px (arr./aba.). Está centrado.
- Causa probable: el zoom de ajuste está acotado por `FIT_MAX = 1.5` (`gestures.ts:14`), así que con pocos nodos queda ~80 % vacío.
- Captura: `docs/diagramas/p22/antes-1.png`.

## 2. Doble clic abre diálogo: NO reproducido como se describe
- Doble clic (Playwright `dblclick` y `page.mouse.dblclick`) sobre un nodo: no abre `.sheet` ni `[role=dialog]` ni editor en el sitio. No hace nada visible.
- F2 sobre el nodo seleccionado sí abre el diálogo de texto (`.sheet input.input`).
- Captura (estado tras el doble clic): `docs/diagramas/p22/antes-2.png`.

## 3. Color por nodo `{c=3}`: reproducido (peor de lo descrito)
- Flujo `[A] {c=3} --> [B]` / `[B] --> [C]`: el nodo A no se dibuja y tampoco su flecha. Solo se ven B y C, ambos con el fondo por defecto `rgba(0,0,0,0.06)`.
- La clave no queda en el texto de ningún nodo; la línea entera se descarta (se trata como desconocida).
- Causa: `types.ts:14` marca `color` como «reservado: el parser aún no lo lee», y `stripSuffixes` (`parse.ts:25`) no conoce `{c=N}`.
- Captura: `docs/diagramas/p22/antes-3.png`.

## 4. Flechas con alfa: reproducido
- `path.diag-edge`: `stroke: rgba(0, 0, 0, 0.6)`; opacidad del trazo 1 (sin opacidad en ancestros).
- `.diag-head` (punta): `fill: rgba(0, 0, 0, 0.6)`. Viene de `--t2: #0009` (alfa 0,6).
- Captura completa: `docs/diagramas/p22/antes-4.png`. Zoom de la punta: `docs/diagramas/p22/antes-4-zoom.png`, pero sale a ~60 px (877 bytes): el cambio de DSF a 4 para el clip no tuvo efecto, así que el zoom no es útil; repetir con otro método si se necesita.
- Dark mode no medido.

## 5. Asa `.diag-handle`: reproducido en parte
- Solo aparece en flujos: con un nodo de mapa seleccionado no existe (`null`).
- En flujo: 44×44 px, `pointer-events: none`, `display: block`.
- Posición: nodo B seleccionado en (544,432) 96×66 → centro (592,465). El centro del asa queda en (662,465): mismo Y, 70 px desplazada en X.
- Captura: `docs/diagramas/p22/antes-5.png`.

## 6. «Añadir hijo» abre cuadro modal: reproducido
- Con un nodo de mapa seleccionado, el botón `Añadir hijo (Tab)` abre `.sheet` con `input.input` (diálogo modal, no edición en el sitio).
- Captura: `docs/diagramas/p22/antes-6.png`.

## 7. Texto largo: reproducido en parte
- Nodo con 300 caracteres: se pinta cortado a 200 + «…» (textLen 201). Es el límite de `MAX_TEXT` del contrato, no un fallo, pero el usuario no ve el texto completo en el lienzo.
- Mismo nodo: `scrollHeight 176 > clientHeight 172` (desborde vertical de 4 px).
- Palabra de 60 letras: se parte (`overflow-wrap: anywhere`), sin desborde horizontal (`scrollWidth = clientWidth = 216`), pero desborda 4 px en vertical (`76 > 72`).
- Negrita `**negrita larga**`: se renderiza como `<strong>` (1), sin asteriscos. Sin desborde.
- Francés: omitido. No hay `?lang=fr`; el idioma sale de `navigator.languages`, y la negrita no depende del idioma.
- Exportar SVG: 1 «…» en el SVG (`diagrama.svg`, 1790 bytes), y el nodo largo aparece truncado. La palabra de 60 letras no aparece de una vez en el SVG (0 coincidencias de `A{60}`): va partida en líneas o tspans.
- Capturas: `docs/diagramas/p22/antes-7.png`.

## 8. Menú «Exportar»: reproducido (es lista)
- Botones de la hoja: `SVG`, `PNG`. El campo «Texto fuente» solo aparece si falla el PNG (`export-ui.tsx:56-58`).
- Captura: `docs/diagramas/p22/antes-8.png`.

## Consola
- Sin errores de consola ni de página durante toda la sesión.

## Otros hallazgos
- `MAPA.md`, spot-check de 10 exports citados: 9 coinciden, 1 desfasado (`NotePanel`: citado `notes.tsx:205`, real `notes.tsx:207`).
