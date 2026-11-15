# Contrato de diagramas (Prompt 20) · mapa · flujo · diagrama

Fuente de verdad para todos los subagentes. Cubre la «Fase K» entera. Sin dependencias nuevas, sin red, sin `eval`, sin HTML. El texto manda: el estado vive solo en el `.md` (`NoteStore`).

## 1. Formato

**Frontmatter** (cambio retrocompatible y perezoso): `tipo: mapa | flujo | diagrama`. Una nota sin `tipo` (todas las actuales) es nota normal y no se toca. `tipo` desconocido = nota normal (se conserva). Solo se escribe al crear una nota de diagrama. El cuerpo de la nota es **un único bloque lógico** (todo el cuerpo es la gramática); en una nota normal el mismo texto va dentro de un fence ```` ```mapa ````/```` ```flujo ````/```` ```diagrama ````. Mismo motor para ambos.

**Líneas.** Una instrucción por línea; se ignoran las vacías (se conservan). `#` al inicio de línea = comentario (se conserva). Texto plano + `**negrita**`, `*cursiva*`, `[[nota]]`; nunca HTML (`<`, `>` solo como delimitadores de forma; el texto se escapa al pintar).

### 1.1 `mapa` (árbol por sangría)
- Línea 1 (sin guion, sin sangría) = raíz. Hijos: `- texto`, sangría de 2 espacios por nivel (tabuladores = 2 espacios al leer; se normalizan al escribir con `applyEdit`, no al reproducir).
- Sufijos de nodo, en este orden y separados por espacio, al final de la línea: `{x=120,y=-40}` (enteros, posición absoluta respecto a la raíz en 0,0; solo si el usuario movió a mano), `{plegado}` (oculta la rama, sigue en el texto).
- Sangría que salta más de un nivel o sin padre posible: línea desconocida (§1.5).

### 1.2 `flujo` y `diagrama`
- Declaración de nodo (opcional) o uso en flecha: `[texto]` rectángulo · `(texto)` inicio/fin · `{texto}` decisión · `[/texto/]` entrada/salida · `<<texto>>` nota. Cierre obligatorio de la misma forma; `]`, `)`, `}` no pueden aparecer en el texto (escapar con `\]`).
- **Identidad del nodo = forma + texto exacto**: la misma `[Triaje]` en dos líneas es el mismo nodo (sin ids visibles).
- Arista: `A --> B`, `A -- etiqueta --> B`. Solo en `diagrama` además: `A --- B` (sin flecha), `A <--> B`, `A -- etiqueta --- B`. En `flujo`, `---`/`<-->` son línea desconocida.
- Cadenas: `A --> B --> C` = dos aristas.
- Posición/plegado como en §1.1, tras el nodo: `[Triaje]{x=40,y=0}`. Con varias apariciones del nodo, vale la primera posición escrita; `applyEdit` escribe la posición en la primera aparición.
- Enlace `[[nota]]` dentro del texto: nodo clicable (abre la nota); no cambia la identidad.
- Atributo de trazo de arista (recta/curva/ortogonal): sufijo `{recta}` | `{curva}` | `{orto}` tras el destino; por defecto curva. Color de nodo (opcional, apagado por defecto): sufijo `{c=1..6}` *(reemplazado por §P22.1: clave `color`, 1–8)*, índice de una paleta fija pequeña (contenido del usuario, contraste ≥ 4.5:1 garantizado al pintar).

### 1.3 Ejemplo mínimo
```mapa
Cardiología
- Anatomía {plegado}
  - Cámaras
- Fisiología {x=120,y=-40}
```
```flujo
(Inicio) --> [Triaje] --> {¿Inestable?}
{¿Inestable?} -- sí --> [Reanimación]
```

### 1.4 Límites
- **300 nodos**: se pintan los primeros 300 (orden del texto), el resto se conserva; aviso `warnings: ['tope']` y banner `t('diag.tope')`; la edición queda en solo texto por encima del tope.
- Texto de nodo ≤ 200 caracteres (el resto se recorta al pintar, no al guardar). Línea ≤ 1000 caracteres.

### 1.5 Errores
Línea desconocida o mal formada: se ignora al dibujar, se avisa (`errors: [{line, code}]`, sin romper) y **se conserva literal, en su posición**, al serializar. Nunca se lanza excepción desde `parseDiagram`.

## 2. Tipos (`src/diagrams/types.ts`; solo firmas)
```ts
type Kind = 'mapa' | 'flujo' | 'diagrama';
type Shape = 'rect' | 'round' | 'diamond' | 'io' | 'note';          // mapa: siempre 'rect'
type Dir = 'TB' | 'LR';
interface DiagramNode { id: string /* estable: 'n'+orden de primera aparición */; shape: Shape; text: string;
  x?: number; y?: number; folded?: boolean; color?: 1|2|3|4|5|6; parent?: string /* solo mapa */; depth: number /* solo mapa */; line: number }
interface DiagramEdge { id: string; from: string; to: string; label?: string; arrow: 'to' | 'none' | 'both'; route?: 'recta'|'curva'|'orto'; line: number }
type Line =                                   // preserva el texto original, en orden
  | { t: 'node'; node: string; raw: string }  // línea del mapa o de un nodo suelto
  | { t: 'edge'; edges: string[]; raw: string }
  | { t: 'raw'; raw: string }                 // vacía, comentario o desconocida
interface DiagramDoc { kind: Kind; nodes: DiagramNode[]; edges: DiagramEdge[]; lines: Line[]; eol: '\n' | '\r\n' }
interface DiagramError { line: number; code: 'desconocida' | 'sangria' | 'forma' | 'tope' }
interface ParseResult { doc: DiagramDoc; errors: DiagramError[]; truncated: boolean }
type Edit =                                    // datos puros, serializables, invertibles
  | { op: 'addNode'; shape?: Shape; text: string; parent?: string; x?: number; y?: number }
  | { op: 'rename'; id: string; text: string } | { op: 'remove'; ids: string[] }
  | { op: 'move'; id: string; x: number; y: number } | { op: 'moveMany'; items: { id: string; x: number; y: number }[] }
  | { op: 'reparent'; id: string; parent: string } | { op: 'fold'; id: string; folded: boolean }
  | { op: 'addEdge'; from: string; to: string; label?: string; arrow?: DiagramEdge['arrow'] }
  | { op: 'editEdge'; id: string; label?: string; arrow?: DiagramEdge['arrow']; route?: DiagramEdge['route'] } | { op: 'removeEdge'; id: string }
  | { op: 'setColor'; ids: string[]; color?: DiagramNode['color'] } | { op: 'clearPositions' } /* «Ordenar» */;
interface Applied { doc: DiagramDoc; inverse: Edit[] /* aplicar en orden para deshacer */ }
interface Layout { pos: Map<string, { x: number; y: number; w: number; h: number }>; paths: Map<string, string /* d de SVG */>; bounds: { x: number; y: number; w: number; h: number } }
```

## 3. Funciones puras (`src/diagrams/*.ts`; sin DOM, sin estado, deterministas)
- `parseDiagram(text: string, kind: Kind): ParseResult` · `text` = cuerpo sin frontmatter ni fences; `''` → doc vacío; CRLF aceptado; sin excepciones; >300 nodos → `truncated`.
- `serializeDiagram(doc: DiagramDoc): string` · reescribe cada `Line` desde su `raw` si no cambió; solo regenera líneas tocadas por `applyEdit`; conserva `eol` y las `raw`. **Ida y vuelta**: `serialize(parse(t).doc) === t` para todo `t`, sin normalización (incluye sangría irregular y líneas raras). Normalizan solo las líneas que `applyEdit` regenera: sangría a 2 espacios, un espacio antes de cada sufijo, `-->` con espacios.
- `layoutTree(doc: DiagramDoc, mode?: 'horizontal' | 'radial'): Layout` · respeta `x/y` manuales (relativos a la raíz); ramas plegadas = sin hijos; raíz sola → un nodo; memoizable por `hash(text)`.
- `layoutLayered(doc: DiagramDoc, dir: Dir): Layout` · capas por camino más largo; ciclos se rompen quitando aristas de retroceso (siguen dibujándose); nodos sin aristas en una fila aparte; respeta `x/y` manuales; componentes desconectados lado a lado; `paths` con `route`.
- `applyEdit(doc: DiagramDoc, edit: Edit): Applied` · inmutable (devuelve otro doc); edición inválida (id inexistente, reparent a un descendiente, >300 nodos) = no-op con `inverse: []`; `applyEdit(applyEdit(d,e).doc, ...inverse)` ≡ `d` en texto.
- `diagramText(doc): string` (texto de nodos, para índice y búsqueda) · `findNode(doc, query): string | null`.
- Hoja de pruebas: `fast-check` no se añade; usar propiedades con corpus fijo + ruido aleatorio con semilla.

## 4. Propiedad de archivos
| Subagente | Escribe | No toca |
|---|---|---|
| A · núcleo | `src/diagrams/{types,parse,serialize,edit}.ts`, `tests/diagrams-parse.test.ts`, `tests/diagrams-edit.test.ts`, `docs/SPEC.md` (sección Gramática) | UI |
| B · acomodo | `src/diagrams/{layout-tree,layout-layered,paths}.ts`, `tests/diagrams-layout.test.ts` (incl. 100 y 300 nodos) | parser |
| C · vista | `src/diagrams/{view,diagram.css}.tsx`, `src/diagrams/mount.ts` (punto de `import()`), `tests/diagrams-view.test.tsx` | editor |
| D · editor | `src/diagrams/{editor,toolbar,history}.tsx`, `src/notes/diagramtype.ts` (plantillas `tipo:`), `tests/diagrams-editor.test.tsx`, `e2e/diagramas.mjs` | parser, layout |
| E · integración | únicos cambios fuera de `src/diagrams/` (ver abajo), `src/i18n/{es,en,fr}.json` (claves `diag.*`), `scripts` de e2e en `package.json`, `CLAUDE.md` (línea de mapa) | lógica |
Orden: A y B en paralelo → C → D → E. Nadie edita tipos de `types.ts` sin pasar por A.

**Enganches mínimos (solo E):**
- `src/md/render.ts`: regla `fence` propia solo para `info ∈ {mapa, flujo, diagrama}`: emite `<div class="diag-host" data-kind data-src="…escapado…"><pre><code>…</code></pre></div>` (el texto fuente sigue ahí: alternativa y respaldo). DOMPurify: añadir solo `data-kind` y `data-src` a la lista permitida de ese `div`; sin `style`, sin `svg`. El montaje lo hace `mount.ts` tras renderizar.
- `src/notes/model.ts` `newNoteText`: ramas `mapa|flujo|diagrama` que escriben `tipo:` y un cuerpo de ejemplo mínimo; el resto sin cambios. El parseo de frontmatter ya conserva claves desconocidas (verificar con prueba).
- `src/screens/addons.tsx` `MODULES()`: una entrada `{ id: 'diagrams', …, defaultOn: true, hooks: ['registerView'] }`. Apagado → los fences vuelven a verse como código y las notas con `tipo:` se abren como texto.
- Pantalla de nota: si `tipo ∈ {mapa,flujo,diagrama}` y add-on activo, abre el editor (`import()`); botón «Ver/editar como texto».

## 5. Estilo (solo `src/theme-cristal.css` y tokens; sin color nuevo)
- Clases (prefijo `diag-`, en `diagram.css`): `diag-host`, `diag-canvas` (con `.glass`; **única** superficie con vidrio), `diag-svg`, `diag-node` (+ `.diag-root`, `.diag-l1`, `.diag-l2`, `.diag-decision`, `.diag-round`, `.diag-io`, `.diag-note`, `.diag-sel`, `.diag-folded`), `diag-edge`, `diag-label`, `diag-bar` (barra flotante vía `overlay.tsx`), `diag-warn`.
- Tokens: raíz `--inverse-bg`/`--inverse-fg`; nivel 1 `--fill` + `--border-strong`; niveles 2+ `--fill-2` + `--border`/`--line`; texto `--t1`/`--t2`; conectores `--t2` con grosor 2→1 px por nivel; radios `--r-row`/`--r-pill`; sombra solo `--shadow` en la barra; z con `--z-*`; foco/selección con el acento (`html.acc-*`) o `--fill-sel`. Nodos sin `backdrop-filter`. Animación solo `opacity`/`transform`, apagada en `prefers-reduced-motion`.
- Colores de nodo (`{c=n}`): 6 tonos fijos como contenido del usuario (`data-user-content`); el pintor elige texto claro/oscuro por contraste ≥ 4.5:1.
- Un solo `<svg>` para conectores (`d` calculados por `paths`); los nodos son HTML; ningún `style` con texto del usuario (posiciones por `transform` en `style` numérico generado, no por texto).
- Móvil: CSS solo bajo `html.is-phone`; objetivos ≥ 44 px; iPad/web sin cambios.

## 6. Carga bajo demanda y presupuesto
- Único punto: `src/diagrams/mount.ts` exporta `mountDiagrams(root: HTMLElement)` y se carga con `import('../diagrams/mount')` desde el render de nota **solo si** el HTML contiene `diag-host` o la nota tiene `tipo:` de diagrama. El editor se carga con un segundo `import()` al tocar «Editar».
- Presupuesto: vista (parser + layout + view + css) ≤ ~15 KB gzip bajo demanda; el editor puede sumar ≤ ~10 KB gzip aparte. Nada de esto entra en el paquete inicial (medir con `npm run build` y anotar en `docs/DECISIONS.md`).
- `IntersectionObserver` con altura reservada; layout memoizado por hash del texto; sin trabajo >16 ms por fotograma al arrastrar con 100 nodos.

## 7. Decisiones abiertas
1. ¿`{plegado}`, `{x=,y=}`, `{recta|curva|orto}` y `{c=n}` como sufijos con llaves chocan con la forma decisión `{texto}`? Propuesta: los sufijos solo se reconocen al final de la línea tras un cierre de nodo y con contenido exacto de esas claves.
2. Identidad por forma+texto: dos nodos distintos con el mismo texto no se pueden representar. ¿Se acepta, o se añade id opcional `#n3`?
3. ¿Los `.md` de diagrama usan el cuerpo completo como gramática (propuesto) o un único fence dentro del cuerpo?
4. Paleta de color por nodo (§1.2 `{c=n}`): ¿entra en esta ola o se difiere (apagada por defecto)?
5. Tope de 300 nodos: ¿editar solo texto por encima (propuesto) o rechazar abrir?


## Decisiones confirmadas por el usuario (Prompt 20)
1. **Nodos sin id**: un nodo se identifica por forma y texto. Se aceptan textos repetidos (si ocurren, se avisa; no se añade `#id`).
2. **Cuerpo de la nota = gramática directa**: en una nota de tipo `mapa`, `flujo` o `diagrama`, el cuerpo es el texto de diagrama, sin fence. Las notas normales que insertan un diagrama usan el bloque de código ```mapa``` / ```flujo```.
3. **Color por nodo diferido** *(reemplazado por §P22.1)*: `{c=n}` no entra en esta ola; la gramática lo reserva pero el parser lo trata como línea desconocida hasta una ola posterior.
4. **Tope de 300 nodos**: por encima se abre la nota solo como texto; el lienzo muestra un aviso y la edición visual queda desactivada. Nunca se rechaza la apertura ni se pierde contenido.
5. **Sufijos solo al final de línea**: `{plegado}`, `{x=…,y=…}` y `{recta|curva|orto}` se reconocen únicamente tras el cierre del nodo o de la flecha, con esas claves exactas. Un texto de decisión `{…}` sin sufijo no se confunde con uno.

## Cambio de contrato registrado (ola 4)
- El tipo `Edit` del contrato §2 se sustituyó por el conjunto de la ola 4: `addChild`, `addSibling`, `rename`, `remove`, `connect`, `disconnect`, `move`, `fold`, `reparent`, `style`, `label` y el inverso interno `splice`. Motivo: las operaciones del editor (hijo, hermano, conectar, mover, plegar) son estas; `splice` existe para que deshacer sea exacto en texto.


---
# §P22 · Prompt 22 (rama `fix-diagramas`): estilo, medición, flechas, PDF, edición en el sitio
Todo es retrocompatible y perezoso: nada se reescribe hasta que el usuario edita esa línea; `serialize(parse(t)) === t` sigue valiendo. Las firmas de abajo son el contrato; quien las implementa no las cambia sin pasar por el Arquitecto.

## §P22.1 Formato
**Grupo de sufijos** = `{item,item,…}` al final de la línea; `item` = `clave=valor` o bandera. Cualquier orden, una o varias llaves (`{x=1,y=2} {plegado}` y `{x=1,y=2,plegado,color=3}` valen igual). Un grupo cuenta como sufijo solo si contiene ≥ 1 clave **conocida** (si no, es texto/decisión, como hoy). Claves desconocidas o con valor fuera de rango se conservan literales en su sitio y no se aplican; x/y fuera de ±100 000 invalidan ambos (como hoy).
- Nodo: `x`,`y` (enteros) · `color` 1–8 (ninguno = ausente) · `w`,`h` enteros 24–2000 (mínimo efectivo = medido: `max(medido, manual)`) · `maxw` 80–600 (ancho de ajuste de línea; defecto 220) · `fs` `s|m|l` (13/15/18 px; defecto `m`) · bandera `plegado`.
- Flecha, tras el destino (con o sin etiqueta; alcance = el de `{recta|curva|orto}` hoy): `A -- sí --> B {color=2,w=3,dash,fin=ambos}` · `color` 1–8 · `w` 1–8 (grosor, defecto 2) · bandera `dash` · `fin` = `sin|flecha|ambos|circulo|rombo` (extremo del destino; `ambos` = punta en los dos; sin `fin` se deriva de `arrow`: to→flecha, none→sin, both→ambos) · banderas `recta|curva|orto` (siguen valiendo sueltas).
- **Escritura**: nunca se fusionan grupos ya escritos. `applyEdit` sobre una línea reemplaza o quita ítems dentro de su grupo original (grupo vacío = se quita); las claves nuevas entran en el **último** grupo de la línea, o en un grupo nuevo `{…}` si no había; orden de las nuevas: x,y,color,w,h,maxw,fs,plegado. Un lector antiguo verá `{plegado,color=3}` como texto: aceptado.
- **Fondo** (`type Backdrop = 'cristal'|'claro'|'gris'|'oscuro'|'cuadricula'|'puntos'`, defecto `cristal` = sin marca): nota de diagrama → frontmatter `fondo:`; bloque ```` ```flujo ```` → primera línea no vacía `# fondo: puntos` (comentario `#` ya existente, legible por versiones antiguas). Prevalece el frontmatter. `readBackdrop(text: string, fm?: string): Backdrop` en `parse.ts`; valor desconocido = `cristal` y la línea queda literal.
- **Alto recordado**: bloque en nota normal → info del fence ```` ```mapa alto=420 ```` (el contenedor vuelve a mostrarlo así); nota de diagrama y `![[Mi mapa]]` → frontmatter `alto: 420` de la nota de diagrama. Entero 160–2000; fuera de rango = ignorado y literal. `readHeight(info?: string, fm?: string): number | undefined` en `parse.ts`.
- **Sufijo a mitad de línea**: un grupo `{…}` que no está al final de la línea (p. ej. `[A] {w=0} --> [B]`) no cuenta como sufijo. La línea entera queda literal con error `forma`: no se crean nodos ni flecha, y no se pierde texto.

## §P22.2 Tipos (los aplica Lógica en `types.ts`; sustituyen lo anterior)
```ts
type Color = 1|2|3|4|5|6|7|8;  type FontSize = 's'|'m'|'l';  type EdgeEnd = 'sin'|'flecha'|'ambos'|'circulo'|'rombo';
interface NodeAttrs { color?: Color; w?: number; h?: number; maxw?: number; fs?: FontSize; folded?: boolean; x?: number; y?: number }
interface EdgeAttrs { color?: Color; w?: number; dash?: boolean; fin?: EdgeEnd; route?: Route }
// DiagramNode += NodeAttrs (color pasa de 1..6 a Color) + extra?: string[]  // ítems literales no entendidos
// DiagramEdge += EdgeAttrs + extra?: string[]
interface TreeItem { text: string; depth: number /* 0 = hijo directo; sube como mucho +1 */; shape?: Shape }
type Edit = /* existentes */ | { op: 'attrs'; ids: string[]; set?: NodeAttrs; unset?: (keyof NodeAttrs)[] }
  | { op: 'edgeAttrs'; ids: string[]; set?: EdgeAttrs; unset?: (keyof EdgeAttrs)[] }
  | { op: 'addTree'; parent: string; items: TreeItem[] }        // «pegar lista»: un solo paso, solo mapa
  | { op: 'backdrop'; value?: Backdrop };                       // fence: escribe/quita `# fondo:`; ausente = cristal
```
`style` (solo `route`) se mantiene como alias de `edgeAttrs`. Inverso de `attrs`/`edgeAttrs`/`addTree`/`backdrop` = un `splice` exacto. `addTree` inválido (>300 nodos, parent inexistente, saltos de profundidad, no-mapa) = no-op. `parseOutline(text: string): TreeItem[]` (puro, en `edit.ts`): viñetas `-`,`*`,`•`, numeración `1.`/`1)`, sangría relativa (tab = 2 espacios), líneas vacías fuera; sin viñetas = una línea por hijo.

## §P22.3 Medición (`src/diagrams/measure.ts`, nuevo, puro salvo el medidor por defecto)
```ts
type Measurer = (text: string, font: string) => number;          // ancho en px; `font` = CSS shorthand
interface MeasureIn { text: string; shape: Shape; fontSize: number; maxW: number; manualW?: number; manualH?: number }
interface Measured { w: number; h: number; lines: string[] }
function measureNode(i: MeasureIn, m?: Measurer): Measured;
function measureDoc(doc: DiagramDoc, m?: Measurer): Map<string, Measured>;   // por id; aplica fs/maxw/w/h del nodo
function setMeasurer(m: Measurer | null): void; function clearMeasureCache(): void;   // pruebas
type SizeMap = Map<string, { w: number; h: number }>;
```
Texto sin marcas `**`,`*`,`[[ ]]`; tope 5 000 caracteres (el resto no se mide ni se pinta; no se recorta el archivo); ajuste por palabras, palabra sin espacios más ancha que el área = corte por caracteres. Relleno 12×8 px, interlínea 1.3×fontSize; rombo: caja de texto √2 en cada eje; `io` +16 px laterales; `round` radio = h/2 y relleno lateral +8. Memo por `font|maxW|shape|text`. Medidor por defecto = `canvas.measureText` (feature detection) con respaldo `0.55×fontSize×n`. `layoutTree(doc, mode?, sizes?: SizeMap)` y `layoutLayered(doc, dir, sizes?: SizeMap)`: `sizes` opcional; falta un id = `nodeSize` actual (se conserva, sus pruebas no cambian). `CHAR_W` y `MAX_TEXT=200` de `export.ts` se eliminan: SVG/PNG/PDF pintan `Measured.lines`.

## §P22.4 Flechas y paleta
```ts
type Box = { x: number; y: number; w: number; h: number };       // x,y = centro (como `Layout.pos`)
function edgeGeometry(from: Box, to: Box, route: Route, opts: { width: number; ends: EdgeEnd; gap?: number /* 4 */ }):
  { d: string; head?: { d: string }; tail?: { d: string }; labelAt: { x: number; y: number } };   // `src/diagrams/edges.ts`
```
Ancla en el borde (rombo: sobre el rombo, no su caja) del lado más cercano con hueco 4 px; la línea termina en la base de la punta; punta ≈ 5×grosor (mín. 10 px): `flecha` triángulo, `rombo` rombo, `circulo` círculo (polígono en `<path>`), siempre `fill` relleno sin trazo. Misma función en pantalla (`view`/`canvas`) y exportación; `Layout.paths` queda como respaldo y para `hitEdge`.
Paleta (`src/diagrams/palette.ts`, nuevo): `PALETTE_LIGHT`, `PALETTE_DARK: readonly string[8]` (hex) e `inkOn(bg: string): '#ffffff'|'#000000'` (el de mayor contraste, ≥ 4.5:1 garantizado por prueba). `diagram.css` define `--diag-c1..c8`, `--diag-c1-fg..c8-fg` en claro y oscuro (mecanismo de tema de `theme-cristal.css`) y `--diag-ink` = color opaco derivado de `--t1` (flechas); una prueba compara los tokens del CSS con `palette.ts`.

## §P22.5 PDF (`src/diagrams/export-pdf.ts`, nuevo)
```ts
interface PdfOpts { page: 'ajustar'|'a4'|'carta'; fit: 'una'|'varias'; margin: number /* pt */; title?: string; date?: string }
function exportPdf(doc: DiagramDoc, layout: Layout, measured: Map<string, Measured>, opts: PdfOpts): Promise<{ blob: Blob; mode: 'vector'|'raster' }>;
```
`pdf-lib` con `import()` (confirmar que está en `package.json`; si no, es la única dependencia a pedir al usuario). Vectorial con Helvetica solo si todo el texto cabe en WinAnsi; si no, o si falla, `raster` (PNG por mosaicos, canvas ≤ 16 M px por mosaico en Safari). Lado máximo 14 400 pt (`ajustar` escala; `varias` pagina). Usa `edgeGeometry`, `measured.lines` y la paleta clara fija (fondo `oscuro` → `PALETTE_DARK`). Fondo `cuadricula`/`puntos` se dibujan en SVG, PNG y PDF.

## §P22.6 Edición en el sitio y crear sin modal (estado en `canvas.tsx`, puro en `inline.ts` si hace falta)
```ts
type Inline = { mode: 'edit'; id: string; text: string }
  | { mode: 'new'; parent?: string; after?: string; shape: Shape; x?: number; y?: number; text: string };  // «fantasma»
```
Un nodo nuevo **no entra en el documento** hasta confirmar: el lienzo pinta un fantasma con el `<textarea>`; confirmar con texto = un único `addChild`/`addSibling` (con `attrs` si ya eligió color) = un paso de historial; vacío o Esc = se descarta sin escribir nada. `edit`: confirmar = `rename` solo si cambió; vacío = se restaura el texto (nunca borra). Enter confirma, Mayús+Enter salto de línea, Tab = confirmar y crear hijo, Esc cancela. Pegar varias líneas en un fantasma = `addTree` con `parseOutline`.

## §P22.7 Propiedad de archivos (olas 2–5); nadie edita un archivo que no es suyo
- **Ola 2 (paralelo, sin solapes)**: *Lógica* = `types.ts`, `parse.ts`, `serialize.ts`, `edit.ts`, `tests/diagrams-parse*`, `tests/diagrams-edit*`. *Lógica 2* = `measure.ts`, `palette.ts`, `edges.ts`, `layout.ts`, `tests/diagrams-{measure,edges,layout,palette}*`. *CSS/i18n* = `diagram.css` (tokens §P22.4 y **tres bloques vacíos** `/* ==A== */…/* ==/A== */`, `==B==`, `==C==`), `src/i18n/{es,en,fr}.json` (todas las claves `diag.*` nuevas de las olas 3–4, para que nadie más toque i18n).
- **Ola 3**: *A* (lienzo grande, Ajustar) = `gestures.ts` (`fitView`, `FIT_MAX`), `editor.tsx`, contenedor en `src/screens/notes*.tsx`, bloque CSS `==A==`. *B* (flechas, chips «+», edición en el sitio, pintar color/tamaño en vista y lienzo) = `canvas.tsx`, `view.tsx`, bloque `==B==`; usa `edgeGeometry`/`measureDoc`; no borra `exitPoint`/`straight` de `gestures.ts` (A lo posee). *C* (colores, tamaños, asas) = `toolbar.tsx`, nuevo `handles.tsx`, bloque `==C==`; **C empieza cuando B termina** y es el único que puede añadir un montaje en `canvas.tsx` (sólo tras B). A y B corren en paralelo; los bloques CSS se editan con Edit, nunca con Write del archivo entero.
- **Ola 4**: *Exportar* = `export.ts`, `export-pdf.ts`, `export-ui.tsx`, `tests/diagrams-export*`. **Ola 5**: *Integración* = `src/md/render.ts` (`alto=` del fence), `src/notes/{model,diagramtype}.ts` (`fondo:`/`alto:`), `mount.ts`, `e2e/diagramas.mjs`, `package.json`, `CLAUDE.md`, `docs/DECISIONS.md`.
