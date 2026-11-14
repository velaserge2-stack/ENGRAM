# Estado del acomodo de diagramas (`src/diagrams/layout.ts`)

Funciones puras y deterministas (sin azar, fecha ni DOM): `layoutLayered(doc, dir)` para `flujo`/`diagrama` y `layoutTree(doc, mode)` para `mapa`. `pos` guarda el **centro** de cada nodo y su tamaño (`nodeSize`, estimado por el texto); `paths` va por id de arista (en `mapa`, por id del nodo hijo). `dir` acepta `'TB' | 'LR'` (contrato) y también `'tb' | 'lr'`.

## Capas (`layoutLayered`)
1. **Ciclos**: DFS iterativo en orden del texto; cada arista de retroceso se invierte solo para el cálculo. El trazado recorre su cadena al revés y la flecha conserva su dirección real. Lazos propios: bucle al costado.
2. **Capas por camino más largo** (Kahn). Aristas que saltan capas → nodos virtuales (puntos de paso de la curva).
3. **Cruces**: baricentro, como mucho 4 pasadas (cada una = bajada + subida); se cuentan cruces (Fenwick, O(E log V) por par de filas) y se queda el mejor orden visto; empates por posición previa (estable). Para antes si llega a 0.
4. **Coordenadas**: filas empacadas y centradas; 4 pasadas alternas que acercan cada nodo al promedio de sus vecinos sin cambiar el orden ni solaparse. Grosor de capa = nodo más grueso.
5. **Componentes** (unión-búsqueda) lado a lado en orden del primer nodo; **nodos sin aristas** en una franja aparte al final, envuelta a lo ancho.
6. `x/y` manuales mandan; si un extremo es manual, la arista va directa (sin puntos de paso).
7. Trazo por `route`: `curva` (Bézier cúbicas, por defecto), `orto` (codos), `recta` (polilínea).

## Árbol (`layoutTree`)
- `horizontal`: raíz en 0,0, columnas por nivel con borde izquierdo alineado, altura por subárbol. `radial`: anillos por nivel, ángulo proporcional a las hojas.
- Plegado = sin hijos (los ocultos no reciben posición). `x/y` manual relativo a la raíz y arrastra a los descendientes sin posición propia. Padres inexistentes o en ciclo: árbol aparte, sin colgarse.

## Medidas
- 300 nodos + 449 aristas (aleatorio con semilla): ~13 ms en Vitest (Node). El test solo avisa si pasa de 50 ms.

## Límites y pendientes
- Tamaño de nodo estimado (7 px/carácter, ≤ 220 px de ancho); la vista puede medir y volver a llamar.
- Aristas paralelas (mismo par) se dibujan superpuestas; falta separarlas.
- Sin posición de etiqueta en `Layout` (la vista usa el punto medio del trazado).
- Radial: el radio evita choques por conteo por nivel, no por ancho real del texto.
- El contrato reparte el código en `layout-tree.ts`/`layout-layered.ts`/`paths.ts`; aquí va en un solo `layout.ts` (pedido del orquestador).
- Memoización por hash del texto: a cargo de quien llama (la función es pura).
