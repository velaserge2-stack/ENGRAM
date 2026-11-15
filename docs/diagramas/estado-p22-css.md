# Estado P22 · CSS/i18n (ola 2)

Tocados: `src/diagrams/diagram.css`, `src/i18n/{es,en,fr}.json`. Sin commit.

## Tokens (`diagram.css`; `:root` = oscuro, `[data-glass="light"]` = claro, como el tema)
Claro / oscuro (relleno; texto #000 o #fff, contraste WCAG ≥ 4.5:1):
- c1 #e5484d / #c62a2f · c2 #f76b15 / #cc4e00 · c3 #ffc53d / #e2a336 · c4 #30a46c / #218358
- c5 #12a594 / #0d7d6c · c6 #0090ff / #0b68cb · c7 #8e4ec6 / #6e3f99 · c8 #d6409f / #b2357f
- Texto `--diag-cN-fg` (nombre del CONTRATO §P22.4; la petición decía `-ink`): c1 #000/#fff, c2 #000/#000, c3 #000/#000, c4 #000/#fff, c5 #000/#fff, c6 #000/#fff, c7 #fff/#fff, c8 #000/#fff (contrastes 4.06–13.31; todos ≥ 4.5 con el negro o blanco elegido).
- `--diag-ink` (tinta opaca de flechas, de `--t1`): claro #1a1a1a, oscuro #f0f0f0.
- Bloques vacíos al final: `==A==` lienzo grande, `==B==` flechas/chips/edición, `==C==` colores y tamaños.

## Claves i18n nuevas (43 `diag.*` en es/en/fr, mismo orden; `pegar_creadas` con `.one`/`.other`)
- Lienzo: expandir, contraer, alto_lienzo, ajustar, editar_texto_nodo, editar_etiqueta, hijo_arriba/abajo/izquierda/derecha
- Color: color, sin_color, color_rojo/naranja/amarillo/verde/verde_azulado/azul/morado/rosa, aplicar_rama
- Fondo: fondo, fondo_cristal/claro/gris/oscuro/cuadricula/puntos
- Flechas: flecha_estilo, grosor, punteado, extremos, extremo_sin/flecha/ambos/circulo/rombo
- Tamaños y asas: tamano_cuadro, tam_pequeno/mediano/grande/automatico, ancho, alto, tamano_letra, ancho_maximo, redimensionar, asa_arriba_izquierda/derecha, asa_abajo_izquierda/derecha, asa_lado_derecho
- Pegar y avisos: pegar_lista, pegar_creadas, texto_largo (`{n}`), nodo_creado, texto_guardado
- PDF: exportar_pdf, pdf, pdf_tamano, pdf_ajustar, pdf_a4, pdf_carta, pdf_una_pagina, pdf_varias_paginas, pdf_margen, pdf_titulo, pdf_fecha, pdf_vista_previa, pdf_guardar, pdf_imagen_aviso

## Verificación
JSON válido en los tres; mismas claves y orden (2024 cada uno); `tests/i18n.test.ts` 6/6.
Pendiente: `palette.ts` debe usar los mismos hex; `texto_largo` recibe `n` ya formateado.
