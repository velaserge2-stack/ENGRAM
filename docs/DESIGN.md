# Tema visual «Cristal»

Sustituye la sección 7 de `docs/SPEC.md` (paleta vibrante y colores por elemento). «Cristal» es el tema por defecto; «Vibrante» queda como alternativa futura.

## Idea central
**La interfaz no tiene color.** El color lo ponen solo el fondo que elige el usuario y los emojis (nombres de mazo, espacios).

- Texto, bordes, botones, gráficas y estados: blanco, negro y grises con transparencia.
- Jerarquía por tamaño, peso, opacidad, relleno frente a contorno, iconos y posición; nunca por tono.
- El único acento es el **invertido**: relleno blanco con texto oscuro en vidrio oscuro, y al revés en claro.
- Estados sin color: cero al 38 %; distinto de cero al 100 %; «Vencidas» > 0 en negrita; seleccionado = píldora de relleno claro; activo = invertido; deshabilitado = 38 %; error = icono + negrita + borde grueso; éxito = ✓.
- Botones de calificación del mismo tamaño, con icono e intervalo; **Bien** invertido y los demás en contorno.
- Mapa de calor: 5 niveles de blanco o negro (alfa .08 / .2 / .35 / .55 / .85).
- Gráficas: grosor, trazo continuo o punteado y trama; leyenda con forma.
- Ritmo del examen: ✓ / ◐ / ⚠ + texto + barra llena, parcial o en contorno.
- Excepción opcional, apagada por defecto: «Color semántico» (solo errores y acciones destructivas).

## Tokens (`src/theme-cristal.css`)
`[data-glass="dark"]` y `[data-glass="light"]` definen `--glass`, `--glass-strong`, `--border`, `--hilite`, `--t1/--t2/--t3`, `--fill`, `--fill-sel`, `--line`, `--shadow`, `--inverse-bg/--inverse-fg` y `--heat`. Radios: `--r-panel` 28, `--r-inner` 20, `--r-row` 14, `--r-pill` 999. `--k` es la intensidad del vidrio (0–1).

### Añadir un tema nuevo
1. Copia los dos bloques `[data-glass=…]` con otros valores (y, si quieres, `--font` y los radios en `:root`).
2. No toques los componentes: todos leen solo tokens.
3. Si el tema usa color en la interfaz, desactiva la prueba «sin color» para ese tema (`e2e/design.mjs`).
4. Ajusta `GLASS` en `src/ui/background.tsx` (color y alfa del velo y del texto) para que el guardián calcule bien el contraste.

## Fondos (`src/ui/background.tsx`)
- Integrados y originales, dibujados en código: Bruma, Aurora, Duna, Bosque, Neón, Niebla, Rayas, Cuadrícula, Grano y Paisaje (una «foto» procedural para pruebas). Colores sólidos y selector libre.
- Imagen propia: se redimensiona a 2400 px y se guarda en `media/.app/fondos/` con miniatura de 256 px; viaja en el respaldo.
- Controles: desenfoque (0–40 px), oscurecer/aclarar (−50 a +50 %), intensidad del vidrio, modo Auto/Oscuro/Claro, modo ligero.
- Capa fija propia (`.bg-layer`), nunca `background-attachment: fixed`. El estudio y los simulacros activan el modo enfoque (fondo más oscuro y desenfocado).

## Guardián de legibilidad
Al cambiar el fondo, el modo, el tamaño de ventana o el DOM: se reduce el fondo a 64 × N px, se calcula para cada panel de vidrio (por su posición) el contraste del texto secundario `--t2` sobre fondo + velo (percentil 5 de las celdas) y, si es < 4.5:1: (1) sube la opacidad del velo, (2) cambia el modo de ese panel, (3) usa un velo casi opaco. Avisa una vez: «Ajustamos el vidrio para que se lea mejor». Las superficies de lectura larga usan `--glass-strong` (≥ 78 %).

## Rendimiento
Un `backdrop-filter` por panel; los paneles anidados usan relleno sin desenfoque; en el lienzo, máximo 4 paneles activos. Modo ligero en Ajustes y aviso automático si al desplazar se miden < 40 fps. Se respetan `prefers-reduced-transparency`, `prefers-reduced-motion` y `prefers-contrast`.

## Pruebas
- `#/design`: todos los componentes sobre 5 fondos de prueba (blanco, negro, rayas, degradado vivo, foto) en claro y oscuro.
- `npm run e2e:design`: recorre el DOM y falla si un color de texto, borde, fondo, sombra o icono tiene **croma > 5 %** (máx − mín de los canales RGB, sobre 255), fuera del fondo, del contenido del usuario (`data-user-content`) y de los emojis; y falla si algún panel queda por debajo de 4.5:1 en cualquiera de los 10 casos.
- Se mide el croma y no la saturación HSL porque esta se dispara en grises casi negros (el propio `rgba(24,24,27)` de los tokens daría 6 %).
