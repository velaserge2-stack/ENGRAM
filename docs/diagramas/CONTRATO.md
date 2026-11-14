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
- Atributo de trazo de arista (recta/curva/ortogonal): sufijo `{recta}` | `{curva}` | `{orto}` tras el destino; por defecto curva. Color de nodo (opcional, apagado por defecto): sufijo `{c=1..6}`, índice de una paleta fija pequeña (contenido del usuario, contraste ≥ 4.5:1 garantizado al pintar).

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
3. **Color por nodo diferido**: `{c=n}` no entra en esta ola; la gramática lo reserva pero el parser lo trata como línea desconocida hasta una ola posterior.
4. **Tope de 300 nodos**: por encima se abre la nota solo como texto; el lienzo muestra un aviso y la edición visual queda desactivada. Nunca se rechaza la apertura ni se pierde contenido.
5. **Sufijos solo al final de línea**: `{plegado}`, `{x=…,y=…}` y `{recta|curva|orto}` se reconocen únicamente tras el cierre del nodo o de la flecha, con esas claves exactas. Un texto de decisión `{…}` sin sufijo no se confunde con uno.

## Cambio de contrato registrado (ola 4)
- El tipo `Edit` del contrato §2 se sustituyó por el conjunto de la ola 4: `addChild`, `addSibling`, `rename`, `remove`, `connect`, `disconnect`, `move`, `fold`, `reparent`, `style`, `label` y el inverso interno `splice`. Motivo: las operaciones del editor (hijo, hermano, conectar, mover, plegar) son estas; `splice` existe para que deshacer sea exacto en texto.
