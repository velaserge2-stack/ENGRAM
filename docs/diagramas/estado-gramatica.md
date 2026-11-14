# Estado · gramática de diagramas (parse y serialize)

## Qué quedó
- `src/diagrams/types.ts`: tipos del contrato §2 (más `DiagramKind` como alias de `Kind`, `MAX_NODES`, `MAX_LINE`).
- `src/diagrams/parse.ts`: `parseDiagram(text, kind): ParseResult` (`{ doc, errors, truncated, tooBig }`). Sin excepciones, sin `eval`, sin HTML.
- `src/diagrams/serialize.ts`: `serializeDiagram(doc)` reescribe cada línea desde su `raw`.
- `tests/diagrams-parse.test.ts`: 19 pruebas (ida y vuelta de los 3 tipos, corpus con ruido de semilla fija, sangrías, ciclos, huérfanos, tope, XSS como texto).

## Decisiones dentro del contrato
- Se devuelve `ParseResult` (contrato §3), no `DiagramDoc` suelto; `tooBig` es alias de `truncated` para quien lo espere con ese nombre.
- `line` en nodos, aristas y errores es el índice desde 0 en `doc.lines`.
- Ida y vuelta exacta para cualquier texto. CRLF solo si todos los saltos lo son; si no, el `\r` queda dentro de la línea.
- Mapa: la raíz es la primera línea con contenido (sin sangría ni guion). Sangría = (espacios + tab×2) / 2; impar o que salta nivel = error `sangria`.
- Flujo/diagrama: sufijos solo al final de la línea; `{x,y}` y `{plegado}` van al último nodo, `{recta|curva|orto}` a la última arista. Si quitar el sufijo deja una línea inválida (`(A) --> {plegado}`), se reintenta sin quitarlo (decisión 5).
- `[[nota]]` dentro de un texto se copia entero y no cierra la forma. Un nodo que es solo `[[nota]]` no se soporta aún.
- Escapes `\]` `\)` `\}` `\>` `\/` `\\` se resuelven en `text`; serializar usa `raw`, así que `applyEdit` debe re-escapar al regenerar.
- Nodos repetidos (forma + texto): mismo nodo; primera posición escrita gana. Mapa: cada línea es un nodo.
- Línea > 1000 caracteres: error `forma`, conservada. `{c=n}` y `---`/`<-->` en flujo: línea desconocida.
- Error `tope` apunta a la línea del nodo 301.

## Pendientes
- `applyEdit` (`edit.ts`), `diagramText`, `findNode` y la sección Gramática de `docs/SPEC.md` (subagente A, siguiente tarea).
- Aviso de textos repetidos (decisión 1): `DiagramError` no tiene código para ello; añadirlo vía A si la UI lo pide.
- Truncado de texto de nodo a 200 caracteres: se hace al pintar, no aquí.
