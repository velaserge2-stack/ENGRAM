# Landing de Engrama · contrato (maqueta)
Salida: `preview.html` (UN archivo, sin red) = `build.mjs` junta `base.css` + `landing.fragment.html` + `acceso.fragment.html` + router. Ejecutar: `node docs/landing/build.mjs`.
- Rutas por hash: `#/` landing · `#/entrar` iniciar sesión · `#/crear` crear cuenta. Enlaces internos entre páginas con `href="#/entrar"`. Para desplazarse dentro de la landing: `<a data-go="precios">` (id de sección `lp-precios`); NO uses `href="#id"`.
- Cada fragmento: `<style>` (solo selectores bajo `#landing` o `#acceso`, clases con prefijo `lp-` / `ac-`), un `<main id="landing">` o `<main id="acceso">` y, si hace falta, UN `<script>` IIFE al final. Usa los tokens y clases de `base.css` (`.btn`, `.pill`, `.seg`, `.card`, `.glass`, `.tile`, `.nav`, `.display`, `.h2`, `.lead`, `.mono`, `.mascot`…). Tema: `window.engTheme.toggle()` / `.set('dark'|'light')`.
- Logo: `{{LOGO}}` se sustituye por un data URI del logo (PNG). Sin imágenes ni fuentes externas; iconos en SVG inline (trazo 2, redondeado, estilo Lucide).
- Tipografía: Helvetica Neue apretada (la de `base.css`), Bold en títulos, mono (`--mono`) para cifras, rutas, atajos y datos.
- Verdad: solo lo de `FUNCIONES.md`. Nada de «NO decir». Precios y cuentas son MARCADORES DE POSICIÓN y se rotulan así en pantalla.
- Accesibilidad: contraste AA, objetivos ≥ 44 px, `aria-label` en iconos, foco visible, `prefers-reduced-motion`. Móvil (390 px) y iPad (1024/1366 px) sin desbordes.
- Cristal: claro por defecto; fondo pintado (ya en `.bg`); sin colores propios (acento opcional apagado).
