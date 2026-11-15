# Estado P22 · UI de exportar (PDF)
Hecho: `src/diagrams/export-ui.tsx` con botón «PDF» (alterna opciones): tamaño (ajustar/A4/Carta), una/varias páginas (solo A4/Carta), margen 0/12/24/36 pt, título (vacío = sin título) y fecha. `exportPdf` se carga con `import()` solo al elegir PDF.
- Preparar → entregar: el `File` `<título>.pdf` se construye en un efecto al cambiar opciones; «Guardar» llama a `navigator.share({files})` solo si `canShare`, si no `<a download>` (URL revocada a los 4 s); `AbortError` ignorado.
- Vista previa: «Saldrán N páginas» + PNG del diagrama (si se pudo crear). Aviso `diag.pdf_imagen_aviso` si `mode === 'raster'`.
- Errores `paginas`/`tamano` con mensaje propio; `fallo` muestra el texto fuente (como PNG).
- Claves nuevas es/en/fr: `diag.pdf_err_{paginas,tamano,fallo}`, `diag.pdf_paginas.{one,other}`, `diag.pdf_preparando`.
- CSS: bloque `==E==` al final de `diagram.css`.
- Pruebas: `tests/diagrams-export-ui.test.ts` (6). `tsc` limpio; 185 pruebas de diagramas en verde.
Pendiente para el integrador: la hoja acepta `title?` (título de la nota) pero `editor.tsx` aún no lo pasa (y `DiagramDoc` no tiene `backdrop`; no se envía a `exportPdf`). Sin probar en Safari/iPad reales.
