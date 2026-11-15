# Estado · gestos del lienzo (`src/diagrams/canvas.tsx`, `gestures.ts`)

## Qué quedó
- `DiagramCanvas({ text, kind, onEdit, onSelect?, phone? })`: lee el texto (parse + acomodo con `useMemo([text, kind])`) y cada gesto acaba en UNA `Edit` por `onEdit`; no guarda documento. Estado propio: vista (`k, x, y` en un ref), selección y gesto en curso.
- Gestos (Pointer Events, captura en el lienzo): toque < 8 px selecciona nodo/flecha (fondo = nada); arrastrar nodo → una `move` al soltar (enteros, centro en coordenadas del acomodo; mapa: arrastra también los descendientes sin posición propia; la raíz no se arrastra); asa (44 px, a la derecha del nodo seleccionado, solo flujo/diagrama) arrastrada hasta otro nodo → una `connect`; fondo → paneo; dos dedos → pellizco + paneo; rueda → paneo, Ctrl/Cmd + rueda (o pellizco de trackpad) → zoom anclado; barra − / + / «Ajustar» (44 px, `aria-label`). Teclado: Enter selecciona, flechas = una `move` de 16 px (alternativa al arrastre), Esc cancela.
- Concurrencia: si el texto cambia a mitad del gesto, el nodo se vuelve a encontrar por forma + texto (`resolveNode`); si ya no existe, el gesto se descarta. Un segundo dedo o `pointercancel` cancelan el arrastre sin `Edit` y devuelven el DOM al acomodo.
- Rendimiento: durante el gesto no hay re-render ni reacomodo; se escribe `transform` del nodo (y descendientes) y `d` de sus conectores (trazo recto provisional, `straight`). El acomodo real llega cuando el padre aplica la `move`.
- Teléfono (`isPhone()` al empezar cada gesto; CSS bajo `html.is-phone`): selección y paneo; arrastrar un nodo desplaza la vista; sin asa ni `connect`.
- `touch-action: none` solo en `.diag-board`. Estilos nuevos en `diagram.css` con tokens de Cristal; z-index de la barra con `--z-panel`.

## Pruebas
- `tests/diagrams-gestures.test.ts` (11): umbral, mundo↔pantalla, pellizco (topes, dedos juntos), rueda, ajustar, nodo/asa/flecha bajo el punto, arrastre de flujo y mapa, `resolveNode`, tiempo.
- `tests/diagrams-canvas.test.ts` (11, happy-dom): toque, arrastre (30 fotogramas → 1 `move`), conectar, flecha, pellizco, teléfono, raíz del mapa, texto cambiado a mitad, `pointercancel`, tiempo.

## Rendimiento medido (Linux, Node; avisa sin fallar si ≥ 16 ms)
- `dragFrame` con 100 nodos (raíz con más flechas): peor fotograma ≈ 0,11 ms; inicio + 120 fotogramas ≈ 0,55 ms.
- `pointermove` completo en happy-dom con 100 nodos: media ≈ 0,04 ms, peor ≈ 0,36 ms (sin pintura real).

## No se pudo probar
- Pellizco real en iPad, Apple Pencil (se trata como un puntero más), trackpad (Ctrl+rueda), inercia, captura de puntero real y aspecto (happy-dom no pinta ni da tamaños: la vista inicial es escala 1 sin «Ajustar» automático).
- Que Safari no haga zoom de página al pellizcar dentro del lienzo (depende de `touch-action: none`).

## Para D/E
- Claves i18n: `diag.lienzo` (aria-roledescription; hoy con respaldo «lienzo» vía `raw`). Reutiliza `pdf.acercar`, `pdf.alejar`, `spaces.ajustar_al_contenido`.
- `onSelect` informa la selección (para borrar/estilo/etiqueta de flecha en la barra del editor). Sin «Ordenar», sin seleccionar varios.
- `view.tsx` pone `width`/`height` numéricos en `style` (Preact 11 no añade `px`): revisar (no lo toqué).
