# Estado: embed `![[nota de diagrama]]` y búsqueda de nodos

## Embed
- `src/diagrams/embed.ts` (puro): `embedName(bloque)` y `resolveDiagramEmbed(nombre, notas, textos)`. Lee `tipo:` con `diagramKindOf`; resuelve por título (sin mayúsculas, NFC, con o sin `.md`) o ruta.
- `notes.tsx` (`DiagramEmbedBlock`): vista de solo lectura vía `DiagramSlot` (`import()` de `mount.ts` solo si hay embed de diagrama), «Abrir» (navega) y «Editar aquí» (el editor sobre el mismo documento de `NoteStore`; «Listo» vuelve a la vista).
- Nota inexistente: chip `md.falta_media`. Nota normal: sin cambios. `render.ts` y DOMPurify no se tocaron; el `data-diagram-embed` lo pone el componente, no el HTML saneado.
- Limitación: solo cuenta el embed que ocupa su propio bloque (párrafo `![[nombre]]` sin `|opciones`); uno en medio de una frase sigue como enlace. Un `![[x]]` de bloque propio que no existe ahora muestra el chip en vez del enlace.

## Búsqueda de nodos
- Índice: el cuerpo del `.md` (la gramática) se indexa tal cual; buscar el texto de un nodo encuentra la nota (cubierto en `tests/diagrams-embed.test.ts`).
- «Buscar en esta nota»: `FindBar` recorre los nodos de texto del DOM, y los nodos de la vista son HTML, así que los encuentra y resalta (CSS Custom Highlight) y centra con `scrollIntoView`. `FindBar` se vuelve a ejecutar al montarse un diagrama (evento `engrama:diagram-ready`).
- Limitaciones: no se mueve el paneo/zoom interno del lienzo del diagrama (solo el desplazamiento de la nota); un nodo dentro de una rama plegada o fuera del recorte no está en el DOM y no se encuentra; sin soporte de Custom Highlight (Safari < 17.2) se selecciona la coincidencia.
