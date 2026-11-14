# Estado · E2E de diagramas (`npm run e2e:diagramas`)

Chromium (WebKit no existe en el contenedor). 34 comprobaciones: 33 PASS, 1 FALLA. Repetido dos veces con el mismo resultado.
Cubre: tipos de nota por «Nueva nota» y por «/», 10 cajitas, conectar y etiquetar, mover (`{x=,y=}` en el .md leído de OPFS),
plegar/desplegar, Ordenar + deshacer/rehacer (botón y Ctrl+Z / Ctrl+Shift+Z), recarga, exportar PNG (768×1224), carga bajo
demanda (por contenido del fragmento: `diag-node` + `diag-board`, `diag-fbar`, CSS `.diag-node`) y consola limpia.

## Hallazgo (comprobación en rojo, app sin tocar)
- **«la etiqueta de la flecha se ve en el lienzo de edición»: FALLA.** Etiquetar una flecha escribe bien `[Alfa] -- sí --> [Beta]`
  en el .md (y sobrevive a la recarga), pero el lienzo de edición no pinta la etiqueta.
- Captura: `e2e/out/diagramas-etiqueta.png`.
- Hipótesis: `src/diagrams/canvas.tsx:305-317` solo dibuja los `<path>` de las flechas; no hay equivalente de los `<span class="diag-label">`
  que sí emite la vista de solo lectura en `src/diagrams/view.tsx:94-96`. Hay que añadirlos al lienzo (posición = punto medio de la flecha,
  con la `transform` numérica como en la vista y actualizada también durante el arrastre).

## Notas del guion
- El lienzo recorta lo que queda fuera: se usa viewport 1180×1500 y «Ajustar al contenido» antes de conectar; `scrollIntoView` sobre
  nodos mueve el lienzo interno y falsea los arrastres (no usarlo).
- Con la bóveda de ejemplo el PNG se descarga por `<a download>` (en Chromium Linux no hay `navigator.share` con archivos).
- «10 cajitas»: el mapa nuevo trae 3 nodos; se añaden 10 hijos (13 en la vista). Sin repetición por tiempo: no hizo falta.
