# Estado · edición de diagramas (`src/diagrams/edit.ts`)

`applyEdit(doc, edit): Applied` es puro e inmutable. Pruebas: `tests/diagrams-edit.test.ts` (16).

## Ediciones (`Edit` en `types.ts`)
`addChild`, `addSibling`, `rename`, `remove`, `connect` (origen, destino, trazo y `arrow` opcional), `disconnect`, `move`, `fold`, `reparent`, `style` (recta/curva/orto), `label`, y `splice` (el inverso).

## Cómo funciona
Cada edición calcula las líneas nuevas del texto, regenera solo las tocadas (sangría de 2, un espacio antes de cada sufijo) y reanaliza. El inverso es un `splice` de líneas (diferencia por prefijo y sufijo), por lo que deshacer da el mismo texto por construcción. Un `splice` también es una edición válida.

## Decisiones
- `Edit` de `types.ts` reemplaza al del contrato §2 (`addNode`, `moveMany`, `setColor`…): se pidió el conjunto de la tarea. Nadie lo usaba aún.
- No-op (`inverse: []`, devuelve el mismo `doc`): id inexistente, texto vacío, reparent a descendiente, más de 300 nodos al añadir, línea > 1000 caracteres, o sin cambio real.
- Flujo/diagrama: `addSibling` conecta el nodo nuevo desde los padres de `id` (sin padres, nodo suelto). `remove` conserva como nodos sueltos los que quedarían sin aparecer. `style` en una flecha que no es la última de una cadena la separa en su propia línea. `move`/`fold` escriben el sufijo en la última ficha de la primera línea donde el nodo cierra; si nunca cierra, añaden una línea suelta.
- `rename` cambia todas las apariciones; si choca con otro nodo, se fusionan. Se escapa `\` y el cierre de la forma (no los `[[enlaces]]`).
- `reparent` solo en mapa; `connect` no en mapa; `arrow` distinto de `to` solo en diagrama.

## No está
- `{c=n}` (color, diferido), `moveMany`, «Ordenar» (`clearPositions`), quitar un trazo explícito.
- Texto mixto LF/CRLF: tras editar puede normalizarse el salto; el deshacer exacto no está garantizado en ese caso.
- Mover o reparentar nodos de flujo entre cadenas, y alta de nodos en un documento vacío (no hay id al cual colgar).
