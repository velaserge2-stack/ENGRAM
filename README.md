# Engrama

Tarjetas de estudio con repetición espaciada y notas, como app web instalable (PWA) para **Safari en iPad**. Sin servidores, sin cuentas, sin analítica, 100 % offline.

**Tus datos son archivos de texto que te pertenecen**: mazos y notas en Markdown, historial en JSONL. Si la app desaparece, los `.md` siguen siendo útiles.

> Estado: **fase 1 (base)** de 11 — almacenamiento, importar/exportar, diseño y pantalla Hoy. El repaso con FSRS llega en la fase 2. Ver `docs/SPEC.md` y `docs/DECISIONS.md`.

## Instalar en el iPad
1. Abre la URL de la app en **Safari** (debe ser `https://`; ver *Publicar*).
2. Toca **Compartir** (cuadro con flecha) → **Añadir a pantalla de inicio**.
3. Abre Engrama desde su ícono. Desde ese momento funciona sin conexión.

Safari no tiene botón de "Instalar" automático; la app muestra estas instrucciones hasta que se abre instalada.

## Respaldar (importante)
Safari guarda tu bóveda en un espacio privado que **no se ve en Archivos**. Exporta regularmente para tener una copia visible:

- **Respaldo → Preparar respaldo (.zip) → Guardar en Archivos** y elige una carpeta (iCloud Drive, En mi iPad…).
- Para restaurar: **Importar → Elegir archivos** → el `.zip`. Verás una vista previa y podrás deshacer.
- La app te recuerda respaldar (aviso discreto, sin notificaciones) si pasan más de 7 días.

## Formato de la bóveda
```
decks/<Mazo>.md            mazos (frontmatter con deck:)
decks/<Carpeta>/<Sub>.md   submazos
notes/**/*.md              notas
media/**                   imágenes y audio
templates/*.md             plantillas
.app/settings.json         ajustes
.app/reviews.jsonl         historial de repasos (fase 2)
```
Ejemplo de mazo en `examples/boveda/decks/Cardiología.md`.

## Desarrollo
```bash
npm install
npm run dev          # servidor local
npm test             # pruebas unitarias (Vitest)
npm run build        # typecheck + build en dist/
npm run e2e          # prueba de humo con Playwright contra el build (WebKit si está instalado)
```

## Publicar (GitHub Pages)
`.github/workflows/ci.yml` corre pruebas y build en cada push y publica `dist/` en Pages al hacer push a `main`. Activa **Settings → Pages → Source: GitHub Actions**. Todas las rutas son relativas (`base: './'`) y el ruteo es por hash, así que funciona en una subcarpeta.

## Límites conocidos de Safari
- Sin `showDirectoryPicker`: la bóveda vive en el almacenamiento privado (OPFS); exportar es la única copia visible.
- Sin `beforeinstallprompt`, Background Sync, notificaciones push fiables ni vibración.
- El almacenamiento puede ser expulsado: la app pide `navigator.storage.persist()` y muestra el resultado en Ajustes. Instalarla en la pantalla de inicio ayuda.
- `navigator.share` solo funciona dentro de un toque; por eso el respaldo se prepara y luego se entrega.
- Más detalle y lo que falta validar en un iPad real: `docs/DECISIONS.md`.

## Licencias de terceros
Preact (MIT), fflate (MIT), Lucide (ISC). Sin SF Symbols ni recursos de Apple.
