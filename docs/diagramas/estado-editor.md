# Estado · editor de diagramas (subagente D, interfaz)

## Qué quedó
- `src/diagrams/editor.tsx` `DiagramEditor({kind, src, onText})`: lienzo + barra superior (deshacer, rehacer, «+ Nodo» en flujos, Ordenar, ver/editar como texto) + barra flotante + diálogos. Sin estado del documento: cada acción es una `Edit` que sale como texto por `onText` (en la nota: `setBody` → NoteStore).
- `src/diagrams/history.tsx`: `History` (pura, 100 pasos). Cada paso guarda `fwd`, `inv` (splice exacto), `before` y `after`. Deshacer aplica el inverso; rehacer las ediciones originales. Si el texto cambió por fuera (modo texto, deshacer de la nota) el historial se vacía.
- `src/diagrams/toolbar.tsx`: `FloatBar` (portal de `overlay.tsx`: hijo, hermano, renombrar, plegar, conectar, eliminar; en flechas: trazo, etiqueta, quitar) y `AskDialog` (en `Sheet`: texto con forma, confirmar, elegir nodo).
- Teclado (con el foco en el nodo seleccionado): Tab hijo, Intro hermano, F2 renombrar, Supr eliminar, ⌘Z / ⌘⇧Z; doble toque renombra; Espacio selecciona (canvas). Eliminar con ramas pide confirmación.
- Accesibilidad: lista alternativa `sr-only` (`role="tree"`/`treeitem` en mapas, lista con flechas en flujos); botones con `aria-label`.
- Más de 300 nodos: solo texto editable con aviso. `DiagramSlot` carga el editor con un único `import()` solo en notas de diagrama; el fence dentro de una nota sigue en vista.
- Pruebas: `tests/diagrams-editor.test.ts` (historial, lote Ordenar, pila acotada, texto externo).

## Claves i18n nuevas (fallback es en el código con `raw(k) ?? …`)
diag.barra, diag.herramientas, diag.hijo, diag.hermano, diag.renombrar, diag.eliminar, diag.plegar, diag.desplegar, diag.conectar, diag.etiqueta, diag.desconectar, diag.trazo_recta, diag.trazo_curva, diag.trazo_orto, diag.forma, diag.forma_rect, diag.forma_round, diag.forma_diamond, diag.forma_io, diag.forma_note, diag.nuevo_nodo, diag.ordenar, diag.ver_texto, diag.ver_diagrama, diag.texto, diag.aceptar, diag.cancelar, diag.confirmar_eliminar, diag.confirmar_eliminar_fin, diag.demasiados_editar. (Reusa `bar.deshacer`/`bar.rehacer`, `diag.lista`.)

## No se probó
Pantalla real, iPad, iPhone, Apple Pencil, teclado físico ni lector de pantalla; la barra flotante no se ha medido contra el minimapa ni el teclado en pantalla; sin pruebas de DOM (solo lógica).
Limitaciones: el canvas no admite fijar la selección desde fuera, así que tras añadir un nodo no queda seleccionado; la raíz del mapa no se renombra con confirmación distinta.
