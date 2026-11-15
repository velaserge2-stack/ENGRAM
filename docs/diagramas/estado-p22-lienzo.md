# P22 · Interfaz A (lienzo grande, Ajustar)

Archivos tocados: `src/diagrams/gestures.ts`, `src/diagrams/editor.tsx`, `src/screens/notes.tsx` (`DiagramView`/`DiagramSlot`/`DiagramFull`), bloque `==A==` de `diagram.css`, `tests/diagrams-fit.test.ts` (nuevo) y `tests/diagrams-gestures.test.ts` (dos cifras: 1.5 → 3).

## Hecho
- `fitView`: `FIT_MAX` 1.5 → 3 (300 %); por eje, si el contenido llena ≥ 85 % se centra, si no se alinea arriba-izquierda con margen. Ajustar sigue llamándose al abrir sin vista y con el botón (canvas.tsx, de B).
- Nota de diagrama completa: `DiagramEditor fill` mide el DOM (`.topbar` + barra de herramientas del editor) y fija `--diag-h` (`fillHeight`, mínimo 360); sin re-render por fotograma. Quitado el `max-width` de la columna (`doc-inner`) para estas notas. El tablero se alcanza desplazando la nota.
- Bloque y embed: marco compacto (320 px) con botón «Expandir» (pantalla completa por `overlay.tsx`: `useLayer` modal + `Portal`, Esc o «Contraer») y asa inferior de 44 px (`role=slider`, Pointer Events + `setPointerCapture`, flechas ↑/↓ de 40 px), 160–2000 (`clampHeight`).
- Medido (Chromium 1180×820, mapa de 4 nodos): tablero 612 px = 94 % del alto libre (ventana − barra − herramientas); contenido 90 % del ancho tras «Ajustar». Captura `docs/diagramas/p22/despues-1.png`.

## Límites / pendiente (anotado)
- El alto de bloque/embed se recuerda solo en memoria: `diagramFence` (`notes/diagramtype.ts`) no acepta `alto=` aún y el bloque es de solo lectura; la escritura de `alto=`/`alto:` es de la ola 5.
- Paneo con espacio + arrastre: NO hecho; requiere `canvas.tsx` (ola B). Pellizco, rueda y dos dedos siguen igual.
- Zoom manual máximo sigue en 300 % (`ZOOM_MAX` de `src/lib/canvaszoom.ts`, compartido con el Lienzo); 400 % pedía tocarlo.
- `html.is-phone .diag-board` (60vh) queda superado por `--diag-h` en la nota completa; fuera de diagramas no cambia nada (no corrí `e2e:phone`).
- i18n: usadas `diag.expandir`, `diag.contraer`, `diag.alto_lienzo`; sin claves nuevas.
- Con k = 3 al abrir un mapa chico, el texto del nodo raíz se parte («Tem/a»): es de medición/canvas (B).

## Pruebas
- Vitest `tests/diagrams*`: 160 pasan; `tsc` limpio; `npm run build` ok.
- `npm run e2e:diagramas`: 1 FALLO (sección 2, «Tab» sobre H1): tras 10 hijos el zoom inicial (×3 con 3 nodos) deja H1 fuera del tablero y `click()` por coordenadas no lo alcanza. Arreglo en `e2e/diagramas.mjs` (ola 5): pulsar «Ajustar al contenido» antes.
