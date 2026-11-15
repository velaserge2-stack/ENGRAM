# Estado P22 · PDF fiel (exportación)
Hecho: `export.ts` (reescrito), nuevo `export-pdf.ts`, pruebas `tests/diagrams-export.test.ts` (8), `tests/diagrams-pdf.test.ts` (9), `tests/diagrams-pdf-text.test.ts` (1, `pdftotext`; se salta si no existe). `tsc` limpio; 178 pruebas de diagramas en verde.

## Firmas para `export-ui.tsx` (no editado)
- `exportLayout(doc, { dir?, mode? }) → { layout, measured }` — `measureDoc` + `layoutTree/layoutLayered(..., sizes)`; lo mismo que la pantalla.
- `diagramToSvg(doc, layout?, measured?, { backdrop? }) → string` (sin `layout` lo calcula).
- `diagramToPngBlob(svg, { maxSide? }) → Promise<Blob|null>`; `svgToPng(svg, w, h, bg?)`; `pngSize` ahora también limita a 16 M px.
- `const { exportPdf, PdfExportError } = await import('./export-pdf')`;
  `exportPdf(doc, layout, measured, { page: 'ajustar'|'a4'|'carta', fit: 'una'|'varias', margin /*pt*/, title?, date?, backdrop? }) → Promise<{ blob, mode: 'vector'|'raster', pages }>`.
  Título y fecha llegan ya traducidos (el módulo no usa `t()`). Si `mode === 'raster'` mostrar `diag.pdf_imagen_aviso`.
- Errores: `PdfExportError.code` = `'paginas'` (> `MAX_PAGES` = 50), `'tamano'` (> 50 MB), `'fallo'` (ni vectorial ni raster). No hay claves i18n para los dos primeros: la UI puede usar `diag.exportar_fallo` o pedir claves.
- Preparar → entregar: llamar `exportPdf` al elegir opciones y construir el `File` antes del toque; `navigator.share` solo en el gesto.

## Escena única
`buildScene(doc, layout, measured, backdrop)` → nodos (`shapePath`: solo M/L/C/Z, la leen SVG y pdf-lib), aristas con `edgeGeometry` (puntas como polígonos rellenos; `fin`, `dash`, `w`, `route` por defecto `curva`; mapa: `curva` sin punta, grosor 2/1,5), etiquetas en `labelAt` con halo del fondo. Colores hex: neutros #f4f4f5/#71717a/#18181b, flechas #1a1a1a, color de nodo = `PALETTE_LIGHT` + `inkOn`; raíz del mapa invertida (#18181b, texto blanco); `nota` sin relleno y trazo discontinuo. `oscuro` → `PALETTE_DARK` y fondo #1c1c1e; `gris` #f2f2f3; `cuadricula`/`puntos` cada 24 px (#e4e4e7) en SVG, PNG y PDF. Sin `CHAR_W`, sin `MAX_TEXT=200`, sin «…» (el único tope es el 5 000 de `measure.ts`).
Estilo de texto por nodo: todo `**…**` = negrita, todo `*…*` = cursiva; mezclas = normal (las líneas medidas ya no llevan marcas).

## Regla de ajuste en Helvetica
Ancho útil de la caja = `w − 24 − (16 en io/round)`, rombo `w/√2 − 24` (mismo que `measure.ts`). Cada línea se pinta a `fontSize × s`; si Helvetica la mide más ancha que el ancho útil, **solo esa línea** baja a `size × útil/medido` (mín. 3 pt) (`fitLineSize`). Centrado horizontal con el ancho real; línea base = centro de su renglón (1,3 em) + 0,35 × tamaño.

## Vectorial / raster
Vectorial (Helvetica, -Bold, -Oblique, -BoldOblique; texto seleccionable) salvo que algún texto (nodos, etiquetas, título, fecha) no pase `font.encodeText` (WinAnsi: emoji, CJK, símbolos) o que la vectorial lance → raster: cada página se divide con `planTiles` en mosaicos ≤ 16 M px y ≤ 8 192 px de lado, cada uno es `sceneToSvg(scene, recorte)` pintado en canvas (fuente del sistema, emoji incluidos) e incrustado como PNG. Densidad 2 px/pt (3 si es pequeño; baja hasta 0,5 si el total pasara de 64 M px). En raster, el título/fecha se escriben en Helvetica quitando los caracteres no codificables. `render` inyectable para pruebas.

## Páginas
`ajustar`: una página a medida + margen (+ encabezado), escala ≤ 1 y lado ≤ 14 400 pt. A4/Carta: orientación automática (horizontal si el diagrama es más ancho; en `varias` se elige la que da menos páginas). `una`: escala ≤ 1 para caber, centrado. `varias`: 1 px = 1 pt, solapamiento 18 pt, recorte por página, marcas de corte en las esquinas y «i/n». Margen 0–144 pt (≤ ¼ del ancho en A4/Carta). Encabezado opcional: título 16 pt negrita y fecha 10 pt.

## Fragmentos (gzip, `npm run build`)
Exportar (`export.ts` + `export-ui.tsx`): 3,8 KB (antes ~2,7). `export-pdf.ts` ≈ 2,9 KB (esbuild; aún no lo importa nadie, irá aparte al usar `import()`). `pdf-lib` en su propio fragmento bajo demanda (~175 KB, compartido con el visor de PDF); no entra en ver ni editar.
