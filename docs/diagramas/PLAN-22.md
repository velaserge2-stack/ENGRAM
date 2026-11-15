# Plan · Prompt 22 (mejoras del editor de diagramas) · rama `fix-diagramas`

Estimaciones de tokens por subagente (entrada + salida), no garantías. Freno: una fase > 1,5× su estimación, o el total > 70 % (≈ 2,1 M), se detiene y se pregunta.

| Ola | Qué | Subagente (modelo) | Estimación |
|---|---|---|---|
| 1 | Sección `src/diagrams/` en MAPA + reproducir los 8 puntos con capturas | Explorador (haiku) | 100 k |
| 1 | `CONTRATO.md`: claves nuevas, `measureNode`, `edgeGeometry`, `exportPdf` | Arquitecto (sonnet) | 120 k |
| 2 | Formato: `color`, `w`, `h`, `fs`, flechas, `fondo` (ida y vuelta) | Lógica (sonnet) | 150 k |
| 2 | `measureNode` + acomodo con tamaños medidos | Lógica 2 (sonnet) | 150 k |
| 2 | Tokens de paleta (claro/oscuro, contraste) + i18n es/en/fr | CSS/i18n (haiku) | 80 k |
| 3 | Lienzo grande + Ajustar + alto del bloque | Interfaz (sonnet) | 150 k |
| 3 | Flechas (`edgeGeometry`, puntas `<path>`, anclaje) + chips «+» | Interfaz (sonnet) | 180 k |
| 3 | Colores y tamaños en la UI (barra, asas de tamaño) | Interfaz (sonnet) | 180 k |
| 4 | Edición en el sitio (doble clic, Tab encadenado, pegar lista, IME, deshacer) | Gestos y edición (opus) | 250 k |
| — | **Pausa: prueba en iPad real** | — | — |
| 5 | Exportar PDF fiel (vectorial + raster) + misma medición en SVG/PNG | PDF (opus) + UI (sonnet) | 300 k |
| 6 | E2E, break-ui, security-review | sonnet ×2, haiku | 300 k |
| 7 | Limpieza del diff + docs | sonnet + haiku | 140 k |
| | **Total** | | **≈ 2,1 M** (presupuesto acordado: 3 M) |

Orden de recorte si hace falta (§0): extremos de flecha extra → fondo del lienzo → «aplicar a rama» → PDF vectorial (solo raster). Nunca escritura segura, sanitización ni accesibilidad.
Navegador: el contenedor solo tiene Chromium (sin WebKit); las capturas y E2E se hacen en Chromium y se anota.
