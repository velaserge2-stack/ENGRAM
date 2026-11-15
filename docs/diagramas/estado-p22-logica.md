# Estado P22 · Lógica (ola 2)
Hecho: `types.ts`, `parse.ts`, `edit.ts` (`serialize.ts` sin cambios: sigue siendo `raw` por línea, ida y vuelta exacta).
Pruebas nuevas: `tests/diagrams-p22-formato.test.ts` (18). `tsc` limpio.

## Firmas
- types: `Color`, `FontSize`, `EdgeEnd`, `Backdrop`, `BACKDROPS`, `NodeAttrs`, `EdgeAttrs`, `TreeItem`, `MAX_TEXT=5000`; `DiagramNode extends NodeAttrs` (+`extra?`), `DiagramEdge extends EdgeAttrs` (+`extra?`).
- Edit nuevas: `attrs{ids,set?,unset?}`, `edgeAttrs{ids,set?,unset?}`, `addTree{parent,items}`, `backdrop{value?}`; `style`, `move`, `fold` se resuelven por `edgeAttrs`/`attrs`. `addChild`/`addSibling` ganan `attrs?: NodeAttrs`.
- parse: `readBackdrop(text, fm?)`, `readHeight(info?, fm?)`, `stripSuffixes(s) -> {rest, groups}`, `suffixCandidates`, `readNodeItems`, `readEdgeItems`, `NODE_ONLY`.
- edit: `applyEdit` (igual), `parseOutline(text)`.

## Reglas aplicadas
- En líneas con flechas: x,y,h,maxw,fs,plegado son del último nodo; color,w,dash,fin,recta|curva|orto de la última flecha. Para color/w de un nodo en una línea con flechas se escribe una línea propia `[N] {color=3}`.
- Lectura en 3 intentos (sufijos conocidos, sin sufijos, cualquier `{k=v}` final): `[A] {c=3}` ya aparece, con `extra:['c=3']`.
- Las claves nuevas van al último grupo; `move`/`fold`/`style` también (antes abrían un grupo nuevo: `{x=1,y=2,plegado}`). Tres pruebas viejas de `diagrams-edit` se actualizaron a eso.
- Edición con varios ids: una por id en cadena sobre el texto ya cambiado, un solo `splice` inverso.

## Desviaciones
- `MAX_LINE` pasó de 1000 a 5500 (si no, el tope de 5000 del texto no se alcanza nunca). Texto de nodo > 5000 = línea literal con error `tope`. Pruebas de «línea > 1000» (parse, extremos) cambiadas a 5001/6000.
- `edges.ts`: único cambio autorizado, reexporta `EdgeEnd` desde `types.ts`.
- Con `ids` múltiples en `edgeAttrs` el ids de aristas se asume estable tras separar líneas (lo es: mismo orden).
- Pendiente ajeno: `tests/diagrams-gestures` («ajustar encuadra…») falla por `gestures.ts` en curso de otro subagente.
