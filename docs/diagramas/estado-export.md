# Estado · exportar diagramas (ola 5)

## Qué quedó
- `src/diagrams/export.ts`: `diagramToSvg(doc, layout)` (puro), `svgSize`, `pngSize`, `diagramToPngBlob(svg, { maxSide })`.
- SVG autocontenido en tema claro fijo (fondo #fff, relleno #f4f4f5, trazo #52525b, texto #18181b; sin `var()`).
- Texto escapado (`& < > " '`), recortado a 200 caracteres, sin marcas `**`/`[[ ]]`, ajustado en líneas. Sin `<script>`, sin `href`, sin manejadores `on…`.
- Formas: rectángulo, píldora, rombo, paralelogramo (io), nota discontinua; conectores como `<path>`; flechas con `<marker>` propio.
- PNG: `Image` (data URI) + `OffscreenCanvas` si existe (feature detection) o `<canvas>`; lado mayor ≤ `maxSide` (2048 por defecto), escala hasta 2×; fondo blanco. Devuelve `null` si algo falla.
- `tests/diagrams-export.test.ts`: escape, sin script/javascript:/on…=/href, dimensiones, mapa, tope del PNG.

## No se probó
- Rasterizado real en Safari/iPad (el SVG con `Image` + canvas; fuentes del sistema; límites de área del canvas).
- Compartir/descargar: no hay interfaz aún.

## Decisiones
- No se creó `export-ui.tsx`: el menú no se tocó. Cuando se conecte, debe cargarse con `import()` al pulsar «Exportar», preparar el `File` (SVG o PNG) antes y entregarlo en el gesto con `navigator.share({ files })` o descarga (patrón de `src/share/sheet.tsx`). Si el PNG da `null`, mostrar el texto fuente con aviso.
- Sin claves i18n nuevas (no hay texto de interfaz en este módulo).
- Sin fuentes incrustadas: se usa la pila del sistema, así el SVG no depende de archivos externos.
