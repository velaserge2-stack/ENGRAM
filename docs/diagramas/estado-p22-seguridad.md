# Diagramas · seguridad P22

Alcance: diff `origin/main...HEAD` de `src/diagrams`, `diagramtype.ts`, `notes.tsx` (diagramas) y `render.ts` (sin cambios de diagramas). Pruebas: `tests/diagrams-p22-seguridad.test.ts` (20 pasan, 5 `it.fails`). `src/` sin tocar. Sigue `estado-seguridad.md` (la x/y sin tope, 6c, ya está acotada a ±100 000).

| # | Punto | Resultado |
|---|-------|-----------|
| 1 | Inyección SVG/PDF/PNG/print | PASA. `esc()` en texto, etiquetas y `d`; colores = hex de paleta/tema; sin `href`, `style`, `on*`, `foreignObject`. PDF dibuja texto con pdf-lib. `print.ts` usa `<img src="data:…">` (no ejecuta scripts). |
| 2 | `<textarea>` y pegado | PASA. Nodos de Preact; el HTML pegado es texto de nodo. Cero `innerHTML` en `src/diagrams`. |
| 3 | Claves nuevas | PASA. `color` 1–8, `w/h` 24–2000, `maxw` 80–600, `fs` s/m/l, `fin` lista, `fondo` lista, `alto` 160–2000: lo inválido va a `extra` y nunca a `var(--diag-c${n})`; sin `calc()`/`url()`. |
| 4 | Límites | PASA: texto 5 000 (`tope`), 300 nodos, `addTree` > 300 rechazado, PDF ≤ 50 páginas / ≤ 14 400 pt, mosaicos ≤ 16 M px. HALLAZGOS: 4a, 4b, 4c, 4d. |
| 5 | `alto=` / `setFenceAlto` | PASA: solo toca la línea de apertura (CRLF, cuerpo con `alto=`, info basura). HALLAZGO 5a. |
| 6 | Compartir / blob | PASA: `navigator.share` síncrono con el `File` ya hecho; cada `createObjectURL` se revoca. |
| 7 | Red / eval | PASA: sin `fetch`, `eval`, `new Function`, URLs externas; `pdf-lib` por `import()` local. |

## Hallazgos (todos con `it.fails`)
- **4a · medio** · `parse.ts:69` `readArrow`: `/^--\s+(.*?)\s*(-->|---)/` es cúbico. `MAX_LINE` pasó de 1 000 a 5 500: `[a] --` + 4 000 espacios ≈ 7 s, 5 000 ≈ 14 s por línea, en cada render y pulsación; una nota ajena así bloquea la pestaña al abrirla. Arreglo: `/^--\s+(.*?)(-->|---)/` + recortar la etiqueta, o límite de espacios.
- **4b · medio** · `export.ts` `gridPath('puntos')`: sin tope. `x/y=±100000` + `# fondo: puntos` → ~69 M puntos al exportar o imprimir (`print.ts` en `beforeprint`). Arreglo: acotar la rejilla (p. ej. omitirla si el área > 4 M px).
- **4c · leve** · `inline.ts:106-116`: pegar N líneas en flujo = N `addChild` con reanálisis total, sin tope (3 000 ≈ 5 s). Arreglo: `if (items.length > MAX_NODES) return null`.
- **4d · leve** · `edit.ts` (`addChild`/`rename` de flujo): sin `MAX_TEXT`; 5 200 caracteres se «aplican» y el parser los descarta como `tope` (el nodo desaparece; el archivo conserva el texto).
- **5a · leve** · `notes.tsx:785`: guardar el alto hace `blocks.join('\n\n')` con `splitBlocks`, que normaliza líneas en blanco y no cubre `~~~`: arrastrar el asa reescribe todo el espaciado de la nota, contra lo prometido por `setFenceAlto`. Arreglo: reemplazar solo el bloque en el texto original (por desplazamiento).
Observación (sin prueba): el respaldo de descarga revoca el blob a los 4 s; un PDF muy grande podría no haber empezado a leerse en Safari.

## Correcciones
- **4a** `readArrow` (`parse.ts`): cierre con `indexOf` en lugar de regex perezosa; mismas líneas aceptadas; 5 000 espacios < 50 ms.
- **4b** `gridPath` (`export.ts`): tope de 20 000 elementos subiendo el paso (múltiplo de 24, alineado a 0); vale para SVG, PNG, PDF y `print.ts` (todos la usan).
- **4c** `pasteEdits` (`inline.ts`): flujo/diagrama rechaza > `MAX_PASTE` = 500 líneas; el lienzo avisa con `diag.pegar_tope` (es/en/fr).
- **4d** `edit.ts`: `addChild`/`addSibling`/`rename`/`label` de flujo rechazan texto > `MAX_TEXT`; el lienzo muestra `diag.texto_largo`.
- **5a** `replaceBlockAt` (`diagramtype.ts`) + `notes.tsx`: el alto se escribe solo en el bloque dentro del texto crudo; resto byte a byte (CRLF, líneas en blanco, `~~~`).
- **NaN** `measure.ts`: un medidor no finito cae a `estimate`.
- Los 6 `it.fails` pasan a `it`. tsc, vitest (771) y build verdes.
