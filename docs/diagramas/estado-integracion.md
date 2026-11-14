# Estado · D/E · tipos de nota e integración (parte de `notes.tsx`)

## Qué cambió
- `src/notes/diagramtype.ts` (nuevo, puro): `NoteKind`, `diagramKindOf(text)` (`tipo:`; ausente o desconocido = `'nota'`), `newDiagramText`, `newDiagramNote` (escribe `tipo:` solo al crear), `diagramFence` (bloque ```` ```mapa|flujo|diagrama ````).
- `src/screens/notes.tsx`: selector de tipo en `NewNote` (la plantilla solo se ofrece para «Nota»); entradas «/» `mapa`, `flujo`, `diagrama` (insertan un bloque con fence); `DiagramSlot` (monta con `import('../diagrams/mount')`; mientras carga o si falla se ve el texto); una nota con `tipo:` de diagrama muestra la vista en la vista «Documento» y el texto en «Ver Markdown»; un bloque con fence en una nota normal se pinta con la misma vista. Ruta `#/notas/+nueva-mapa|-flujo|-diagrama` abre «Nueva nota» con el tipo.
- `src/screens/palette.tsx`: acciones «Nueva nota de mapa mental / de diagrama de flujo».
- `src/i18n/{es,en,fr}.json`: `notes.tipo_*`, `palette.nueva_nota_de_*`.
- `tests/diagrams-tipo.test.ts` (5 pruebas). Typecheck, vitest (558) y build en verde.

## Decisiones
- Sin imports estáticos de `src/diagrams/*` desde `notes.tsx`. `src/md/render.ts` y DOMPurify sin tocar: el fence se detecta en `notes.tsx` (`diagramFence`), no en el render.
- Ninguna nota existente se reescribe; las notas normales siguen por el mismo camino (`Html`).

## NO se probó
- Pantalla real (iPad/iPhone/navegador): el aspecto de la vista dentro de la nota y el selector de tipo.
- 0 píxeles en notas normales: no se midió (`e2e` de línea base no ejecutado); el único cambio visible en «Nueva nota» es la fila de tipo.
- Edición del diagrama (editor, D): esta entrega es solo lectura; se edita como texto.
- Add-on `diagrams` (`addons.tsx`) y fence en `render.ts` quedan fuera de esta tarea.
- Las vistas de nota en paneles/lienzo reutilizan `NoteEditor`, no se probaron aparte.
