# Estado P22 · Interfaz C (estilo, asas, fondo)
Archivos: `toolbar.tsx` (barra + ediciones puras `colorEdit`/`presetEdit`/`sizeFieldEdit`/`fsEdit`/`maxwEdit`/`edgeStyleEdit`), nuevo `handles.tsx`, `editor.tsx` (conexión), `canvas.tsx` (un montaje de `<Handles>`), bloque `==C==` de `diagram.css`, `tests/diagrams-p22-estilo.test.ts` (12). Clave nueva `diag.todas_flechas` (es/en/fr).

## Qué quedó
- Nodo: fila de 8 muestras (`--diag-c1..c8`, `aria-label` traducido, zona de 44 px, círculo de 24) + «Sin color»; «Aplicar a toda la rama» (mapas con hijos) = un `attrs` con todos los ids = un paso. Botón regla abre el panel: S/M/L/Automático (96×44, 160×56, 240×80; Automático borra `w`/`h`), ancho, alto y ancho máximo (inputs 16 px; se confirman con Intro o al salir del campo), letra S/M/L (`fs`; M borra la clave). Todo tamaño se sube al mínimo medido (`nodeMin` = `measureNode` sin `w`/`h`).
- Asas (`handles.tsx`): 4 esquinas + costado derecho, punto de 10 px, zona de 44 px, Pointer Events con `setPointerCapture`, ⇧ = rejilla de 8. Arrastre solo en el DOM (nodo y asas); al soltar UNA `attrs` con `w`/`h` redondeados (el costado solo `w`); sin cambio o cancelar restaura el DOM. Cambio simétrico respecto al centro (la esquina sigue al puntero; la vista previa coincide con el acomodo). ⌥+flechas con el foco en el nodo = ±8 px (ancho ←→, alto ↑↓), manejado en el editor en captura. Ocultas en teléfono (`phone`/`html.is-phone`) y al editar en el sitio.
- Choque con chips: las asas van antes que los chips en el DOM (el chip gana donde se solapan); la zona del costado derecho se corre 12 px hacia dentro y el punto queda sobre el borde.
- Flecha: muestras de color (1–8; «sin color» = tinta por defecto; no hay grises en el formato), grosor 1–4, punteado, extremos sin/flecha/ambos/círculo/rombo, casilla «Aplicar a todas las flechas» (ids de todas las flechas, un paso).
- Fondo: selector en la barra del editor (`BackdropPicker`) con la op `backdrop` (`# fondo:` en el bloque). Props nuevas `backdrop`/`onBackdrop` en `DiagramEditor`: si el padre pasa `onBackdrop`, el selector lo llama en vez de escribir en el bloque.

## Pendiente de integración
- Nota de diagrama completa: `notes.tsx` debe pasar `backdrop` (de `fondo:`) y `onBackdrop` (escribir el frontmatter); hoy escribe `# fondo:` en el cuerpo, que el frontmatter anularía. `export-ui` sigue sin recibir el fondo.
- Durante el arrastre de un asa las flechas no siguen al nodo hasta soltar.
- `NODE_ONLY` no incluye `w`: en una línea con flecha, `w` de un nodo se escribe en línea propia (`[B] {w=240}`) y `h` en el grupo de la flecha (es el diseño del formato; el parser lo lee bien).
- Fuera de ámbito: teclado ⌥ no se probó con VoiceOver; sin probar en iPad/Safari reales. Capturas `docs/diagramas/p22/despues-3b.png`, `despues-tam.png` (script `scratchpad/p22-estilo.mjs`: color + asa + recarga, persiste en el `.md`).
