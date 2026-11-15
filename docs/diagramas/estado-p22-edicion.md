# Estado P22 · Gestos y edición (ola 4, §2.2 y §2.6)
Archivos: `canvas.tsx`, `editor.tsx`, nuevo `inline.ts` (puro), bloque `==B==` de `diagram.css`, `tests/diagrams-inline.test.ts` (19). `history.tsx` sin cambios (un `apply` = un paso). Sin claves i18n nuevas: `diag.editar_texto_nodo`, `diag.editar_etiqueta`, `diag.nodo_creado`, `diag.texto_guardado`, `diag.pegar_creadas`.

## Qué quedó
- Edición en el sitio: doble clic (`dblclick` del ratón), doble toque, F2, o Intro sobre el nodo seleccionado abren un `<textarea role=textbox>` DENTRO del nodo (hereda fondo, color y fuente, escala con el lienzo). Se selecciona todo al entrar; el nodo crece en vivo: se pinta `previewText` (texto + borrador con `rename`/`addChild`) re-medido con `measureNode`, sin escribir el archivo.
- Intro confirma, ⇧Intro salto de línea, Esc cancela, tocar/clic fuera o perder el foco confirma, Tab confirma y abre un hijo del nodo confirmado (encadena). Confirmar = UNA edición (`rename` solo si cambió; vacío restaura) = un paso de ⌘Z.
- Fantasma (§P22.6): «Añadir hijo/hermano» (barra), chips «+», Tab y doble clic en el vacío crean un nodo que NO está en el documento: se pinta ya colocado por el acomodo (`applyEdit` sobre una copia) y entra con un solo `addChild`/`addSibling`/`splice` al confirmar; vacío o Esc = nada. Forma heredada del origen. Flujo/diagrama: doble clic en el vacío = nodo suelto con `{x,y}`; `onChipDrop` en el vacío = hijo con `{x,y}`; mapa: hijo del seleccionado o de la raíz.
- Flechas: doble clic/toque en la flecha (o su etiqueta) edita la etiqueta en el sitio; sin etiqueta, la agrega. El acierto usa ahora el trazo pintado (`[data-hit]`) y, si no, `hitEdge`.
- Tras confirmar, el nodo queda seleccionado y con foco; en ese estado («cadena») Intro = hermano y las flechas cambian de nodo (`neighbor`); fuera de la cadena las flechas siguen moviendo el nodo (WCAG 2.5.7). Nuevo `control` (`CanvasControl`) para que el editor fije selección y pida crear/editar. Quitados los `setAsk` de hijo/hermano/renombrar/etiqueta; quedan la confirmación de eliminar y «Conectar con…».
- Pegar ≥ 2 líneas (en edición, en un fantasma o sobre el nodo seleccionado): mapa = un `addTree` con `parseOutline`; flujo = cadena de `addChild` en un solo `onEdits` (un paso). Una línea = pegado normal.
- Espacio sostenido + arrastre con ratón = paneo. Zoom propio 0,1–4 (`zoomAt4`/`pinch4`/`wheel4`/`zoomBy4` en `inline.ts`); `ZOOM_MAX` compartido y `FIT_MAX` (3) sin tocar.
- Accesibilidad: `aria-label` traducido, región `role=status aria-live=polite` («Nodo creado», «Texto guardado», «Creadas N ramas»), foco de vuelta al nodo. Teclado completo.

## Doble toque frente a paneo y pellizco
Solo cuenta un gesto que terminó como «toque» (< 8 px de movimiento, `DRAG_SLOP`); un paneo o arrastre nunca registra toque. El segundo dedo convierte en pellizco y borra el último toque. Doble = mismo objetivo, < 300 ms y < 10 px (`isDoubleTap`). El tablero ya tiene `touch-action: none`: el navegador no hace zoom por doble toque. Sobre el `<textarea>` no empieza ningún gesto (ni paneo, ni arrastre, ni pellizco).

## IME y teclado virtual
- IME: no se confirma con Intro si `isComposing`, `keyCode 229` o entre `compositionstart` y `compositionend`. El cuadro no es controlado (el valor solo se lee en `input`), para no romper la composición.
- iOS: el font-size calculado del cuadro es ≥ 16 px (×s) y se compensa con `scale(1/s)`; foco con `preventScroll`. Con `visualViewport`, en `resize`/`scroll` se hace el paneo mínimo (`ensureVisible`) para que el nodo quede entre el borde del tablero y el teclado, sin saltos.

## Límites
- El formato guarda una línea por nodo: el salto de ⇧Intro se escribe como espacio (lo hace `edit.ts`).
- Teléfono: igual, sin chips; tocar el nodo ya seleccionado lo edita (toques simples).
- Fantasma con el mismo texto y forma que otro nodo de flujo: el formato los une (es el mismo nodo).
- E2E (`npm run e2e:diagramas`, Chromium): falla en «2. Mapa con 10 cajitas» porque `ask()` espera `.sheet input.input`. Con una copia en el scratchpad que escribe en `textarea.diag-inline`: 1 y 2 (10 cajitas) pasan; «Tab sobre H1» falla igual que en la ola 3 (H1 fuera del tablero: pulsar «Ajustar» antes); la 3 usa `.diag-handle` (quitado en la ola 3: usar el chip) y el punto medio de la flecha por `getScreenCTM` cae fuera del tablero tras desplazar; con esos tres arreglos 4–10 pasan y la consola queda limpia. Corregir en `e2e/diagramas.mjs` (ola 5).
- Capturas `p22/despues-2.png` y `despues-6.png` con `scratchpad/p22-edicion.mjs` (también comprueba doble clic en vacío y en flecha). Sin probar en iPad/iPhone reales: teclado virtual y `visualViewport`, IME real, zoom de iOS al enfocar, doble toque con Apple Pencil, Safari.
