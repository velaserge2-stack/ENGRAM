# Decisiones y límites encontrados

## Fase 1 · Base (2026-11-11)

### Qué quedó
- **PWA**: `manifest.webmanifest` (standalone, scope/start_url relativos), íconos 180/192/512 + máscara, metas de iOS, `viewport-fit=cover`, `theme-color` claro/oscuro, CSP estricta sin red externa.
- **Service worker** generado en el build (`vite.config.ts` → `sw.js`): lista exacta del app shell y versión = hash del contenido. Cache-first; el SW nuevo espera y la UI muestra "Nueva versión disponible → Actualizar" (`SKIP_WAITING`). Se busca actualización al volver a la app (`visibilitychange`), porque Safari no tiene Background Sync.
- **VaultAdapter** con tres backends: OPFS en Worker dedicado (por defecto), File System Access (solo si existe `showDirectoryPicker`; el handle se recuerda en IndexedDB y se pide permiso de nuevo con un gesto) y memoria ("modo temporal" con aviso si OPFS no responde, p. ej. navegación privada).
- **Escritura segura** (`SafeVault`): temporal → diario con tamaño y suma FNV-1a → destino → limpiar. Al arrancar `recover()` rehace o descarta y la UI informa. Operaciones serializadas.
- **Integridad** al abrir: conteo por carpeta, UTF-8 estricto, frontmatter, JSON/JSONL. Solo reporta.
- **Importar**: `.md`, carpetas (`webkitdirectory`), `.zip` (detectado también por firma `PK` si llega sin extensión), imágenes/audio. Clasificación por frontmatter (`deck:` → `decks/`). Vista previa con estado nuevo/igual/ya existe y resolución omitir/reemplazar/duplicar global o por archivo. **Deshacer importación** completo.
- **Exportar**: bóveda `.zip` con `manifest.json` (formato, versión, fecha, conteos) y un mazo `.md`. Sin diario ni temporales.
- **Diseño**: tokens CSS claro/oscuro, vidrio con intensidad configurable, `prefers-reduced-transparency/motion/contrast`, bento de Hoy, cuadro de mazos de vidrio denso, listas agrupadas, interruptores, segmentados, hojas con grabber, título grande que se colapsa, barra lateral (≥ 861 px) o barra de pestañas flotante.
- **Hoy**: resumen, vencidas, nuevas (conteo preliminar), racha, tiempo, retención (pendiente), respaldo, mapa de adherencia 53×7 desde `reviews.jsonl` con corte de día a las 4:00 y zona horaria.
- **Ajustes**: persistencia (`storage.persist()` + `estimate()`), nota honesta de Safari, respaldo y recordatorio, tema, tamaño de texto, vidrio, acento, inicio del día, racha mínima, integridad, guía de instalación manual.

### Decisiones
- **Preact sin Babel**: Vite 8 compila JSX con `jsxImportSource: preact` del `tsconfig`. Menos dependencias.
- **Frontmatter propio** (subconjunto YAML: escalares, `[a, b]`, listas `- x`) en vez de una librería YAML: la SPEC no lista una y los archivos de Engrama son simples. Lo que no entiende lo reporta.
- **Respaldo en dos pasos** (Preparar → Guardar en Archivos): `navigator.share` exige activación transitoria y construir el zip es asíncrono; llamar a `share` tras `await` largos falla con `NotAllowedError` en Safari. Si falla igual, cae a `<a download>`.
- **Mosaicos**: vidrio con tinte del color del mosaico y número en color de texto (no texto blanco sobre color sólido). Blanco sobre `#007AFF`/`#34C759`/`#FF9500` no llega a AA (4.02/2.2/2.1). Los "chips" de icono usan blanco o negro según contraste. Para rellenos con texto (botón primario, selección) se usa `--accent-fill`, una variante hasta 20 % más oscura que alcanza 4.5:1 con blanco; si no se puede (amarillo, verde), texto negro.
- **Conteo de tarjetas preliminar** por prefijo de línea hasta que llegue el parser real (fase 2). Etiquetado así en la UI.
- **Mover archivos** = copiar + borrar (con diario): `FileSystemHandle.move()` no es fiable en todos los Safari.
- **FSAccessBackend** sin diario adicional: va envuelto en `SafeVault` igual que OPFS.

### Límites encontrados (navegadores)
- **Chromium (Playwright 1243) rechaza nombres de ARCHIVO no ASCII en OPFS** (`getFileHandle('Cardiología.md', {create:true})` → `TypeMismatchError`; los directorios sí funcionan). Solución: el Worker de OPFS codifica cada segmento con `encodeURIComponent` si no es ASCII seguro (biyectivo; los nombres con `%` siempre se codifican). OPFS es privado: el usuario nunca ve esos nombres y las exportaciones usan las rutas lógicas. **Verificar en Safari** si también aplica (la codificación es inocua si no).
- `clients.claim()` dispara `controllerchange` en la primera instalación del SW: solo se recarga si ya había un controlador (actualización real).
- Safari 15.x: los métodos de `FileSystemSyncAccessHandle` devolvían promesas; se usa `await` en todos (inocuo en versiones nuevas).
- WebKit de Playwright no está instalado en este entorno: la E2E corrió en Chromium. En CI con `npx playwright install webkit` corre en WebKit.

### Pendiente de validar en iPad real
- Instalar en pantalla de inicio, modo avión, cerrar y reabrir 24 h después (persistencia y exención de ITP de 7 días para PWA instaladas).
- `navigator.share({files})` con `.zip` → "Guardar en Archivos".
- `webkitdirectory` desde Archivos (puede no ofrecer carpetas en iPadOS).
- `navigator.storage.persist()` en Safari: resultado real instalada vs. pestaña.
- Que la codificación de nombres OPFS funcione igual en Safari y que la estrategia sea `createSyncAccessHandle`.
- Rotación, Stage Manager, Split View, teclado externo.
