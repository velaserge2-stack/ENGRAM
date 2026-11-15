# Estado P22 · E2E (`e2e/diagramas.mjs`, Chromium; WebKit no existe en el contenedor)
Resultado: `npm run build && npm run e2e:diagramas` → OK, 77 comprobaciones, 0 fallos, tres corridas seguidas (estable).

## Actualizado al editor nuevo (secciones 1–10, todas conservadas)
- `ask()` escribe en `textarea.diag-inline` (sin `.sheet`); chip `.diag-chip[data-chip=derecha]` en vez de `.diag-handle`; «Ajustar al contenido» antes de tocar nodos fuera del tablero (H1, la flecha tras reconectar).
- Flecha: se deselecciona antes (los chips del nodo seleccionado tapan el punto medio) y se hace clic en el punto del trazo visible más cercano a la mitad (dentro de tablero y ventana).

## Nuevas (Prompt 22 §5, secciones 11–20; ventana 1180×820)
11 tablero ≥ 85 % del alto (612/630 px = 97 %) y del ancho · 12 doble clic edita en el sitio (sin hoja/diálogo, texto seleccionado, ≥ 16 px), Intro, Esc, clic fuera, Tab encadena 5 hijos con 0 hojas · 13 chips: zona 44×44, punto 22 px, no tapan el texto, aria-label, clic crea nodo en el sitio · 14 texto de 1 000 caracteres, palabra de 80 letras y rombo sin desborde (`scrollHeight/Width`), punta de flecha opaca (RGBA …,255 y mismo color que la línea) · 15 color «Azul» y asa SE escriben `color=`/`w=`/`h=` y persisten tras recargar (.md idéntico) · 16 PDF desde la hoja: descarga `%PDF-` y `pdftotext` contiene todo el texto sin «…» · 17 recargar conserva nodos y .md · 18 misma nota en Notas y en un panel de Espacios (editar en cada lado se ve en el otro) · 19 `fondo: oscuro` en el frontmatter, sin `# fondo:` en el cuerpo, persiste · 20 asa del bloque (ArrowDown ×4) escribe `alto=480` en el fence y persiste.

## Fallos reales de la app
Ninguno bloqueante. Observaciones de usabilidad (no fallan la prueba):
- «Ajustar» no se reaplica solo al cambiar el acomodo (tras conectar, un nodo queda fuera del tablero); con zoom ×3 los nodos fuera de vista no se pintan, y la barra flotante inferior queda encima de nodos bajos (un clic en el centro de un nodo pulsó una muestra de color).
- Con un nodo seleccionado, sus chips tapan el punto medio de una flecha corta: hay que deseleccionar para tocarla.
No cubierto: WebKit/iPad/Pencil/IME/teclado virtual reales (el contenedor solo tiene Chromium).
