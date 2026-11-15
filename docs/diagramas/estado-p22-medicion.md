# Estado P22 · Lógica 2 (medición, flechas, paleta)
Hecho: `measure.ts`, `edges.ts`, `palette.ts`, `layout.ts` (+ `sizes?`), pruebas `tests/diagrams-{measure,edges,palette,layout-sizes}.test.ts`.

- `measure.ts`: `measureNode/measureDoc/setMeasurer/clearMeasureCache`, `MAX_TEXT=5000`, `DEFAULT_MAXW=220` (contrato `maxw`; `maxW` = ancho exterior máximo; el área de texto resta relleno 12 + 16 en io/round y /√2 en rombo). Medidor por defecto: canvas (OffscreenCanvas o `<canvas>`) y, sin él, estimación determinista (0,55 em; CJK/emoji 1 em; negrita ×1,06). Memo LRU de 500 (se omite si se pasa un medidor explícito). Mínimos de caja 56×36. `measureDoc` lee `fs/maxw/w/h` del nodo por cast (types.ts aún no los tiene); en `mapa` fuerza `rect`.
- `layout.ts`: `layoutTree(doc, mode?, sizes?)`, `layoutLayered(doc, dir, sizes?)`; `SizeMap` se declara en layout.ts y measure.ts lo reexporta. `nodeSize` (con su recorte de 200) se conserva como respaldo para las 15 pruebas previas. El recorte de 200 de `export.ts` NO lo toqué (de otro).
- `edges.ts`: `edgeGeometry(from, to, route, {width, ends, gap})`. `from/to` aceptan `shape?` extra (diamond/round) para anclar en la forma real (recta: bisección sobre el borde; curva/orto: punto medio del lado, que en rombo y píldora ya es borde). Exporta `EdgeEnd` local (pasar a types.ts, §P22.2). Línea termina en la base de la punta; punta = 5×grosor (mín. 10; se reduce si los nodos están muy cerca). `head`/`tail` son triángulo (flecha), rombo (4 pts) o círculo (12 pts), rellenos.
- `palette.ts`: `PALETTE_LIGHT/DARK`, `inkOn`, `diagTokens(mode)` (devuelve `--diag-cN` y `--diag-cN-fg`). Reutiliza `contrast` de `src/lib/palette.ts`.

| n | claro | oscuro |
|---|---|---|
| 1 | #e5484d | #c62a2f |
| 2 | #f76b15 | #cc4e00 |
| 3 | #ffc53d | #e2a336 |
| 4 | #30a46c | #218358 |
| 5 | #12a594 | #0d7d6c |
| 6 | #0090ff | #0b68cb |
| 7 | #8e4ec6 | #6e3f99 |
| 8 | #d6409f | #b2357f |
(valores de la coordinadora; `inkOn` da el texto de mayor contraste; ver la prueba por si alguno difiere del `-fg` del CSS)
