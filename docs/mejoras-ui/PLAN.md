# Plan · caza de bugs y rediseño de interfaz (Asistente, barras, reproductor)

Rama `mejoras-ui` (desde `main`). Se ejecuta por fases, una a la vez; cada fase termina con commit y resumen. No se fusiona a `main` sin confirmación.
Demos para elegir el diseño: `docs/mejoras-ui/preview.html` (se abre en el iPad/navegador; no usa red).

## Lo que se reporta
1. Menús y barras que «no están estáticos» (se mueven o flotan).
2. Mini reproductor en una zona rara (casi al centro-izquierda).
3. El chat con el agente se ve poco estético y «a veces vuela».
4. Barra superior en formato grande: sin nombres, solo etiqueta al pasar el cursor y nombre cuando estás dentro (como ya hace el iPad).
5. A veces no se puede borrar ni modificar Ankis/notas.
6. Barra del asistente como la imagen de referencia (compacta, con uso por proveedor), mascota más tierna y menos «HTML».
7. Respuestas del asistente más sofisticadas. Tipografía Helvetica Neue apretada, con Bold en lo importante.

## Fases, subagentes y modelos
| Fase | Qué | Modelo | Tope |
|---|---|---|---|
| 0 | Inventario: todo lo `fixed`/`sticky`/flotante, su z-index, esquina y qué lo mueve (teclado, scroll, mini reproductor, Stage Manager). Mapa en `docs/mejoras-ui/INVENTARIO.md` | haiku (Explore) | 25 K |
| 1 | Auditor automático `e2e/ui-audit.mjs` (Playwright, Chromium/WebKit si hay): viewports iPad 1024×768 y 1366×1024, escritorio 1440×900, teléfono. Mide: posición de barras antes/después de scroll, teclado y abrir/cerrar paneles; solapes entre flotantes; elementos fuera de pantalla; objetivos < 44 px. Capturas | sonnet | 70 K |
| 2 | Bug «no puedo borrar/modificar» (ver abajo). Reproducir antes de arreglar | sonnet; opus si la causa es de concurrencia en el vault | 90 K |
| 3 | Zona inferior única: un contenedor que ordena barra del asistente, mini reproductor y avisos para que nunca se solapen ni vuelen; reproductor en su sitio definitivo | sonnet | 90 K |
| 4 | Barra superior grande: solo iconos + etiqueta al pasar el cursor + nombre en la pestaña activa (igual que iPad) | sonnet | 50 K |
| 5 | Barra del asistente (estilo de la referencia), mascota nueva y estados, tipografía y respuestas sofisticadas | sonnet (diseño) | 120 K |
| 6 | i18n es/en/fr, pruebas, `e2e:phone` (el teléfono no debe cambiar salvo lo intencional), `e2e:design`, `e2e:chat`, capas | haiku | 40 K |
| 7 | Revisión final del diff y seguridad (solo diff) | opus | 60 K |

## Bug «a veces no se puede borrar o modificar»
Sospechosos, por orden de probabilidad:
1. **Safari/OPFS**: un archivo queda bloqueado por un acceso anterior sin cerrar (`NoModificationAllowedError`) y todas las escrituras siguientes fallan hasta recargar. Encaja con «a veces». Verificar el cierre del handle en el Worker de OPFS, varias pestañas/ventanas y escrituras solapadas.
2. **Estado «abierto» viejo**: `noteStore` conserva una entrada tras cerrar el editor y la app responde «abierto en el editor» (el mismo defecto que ya corregimos en el asistente, que puede seguir en la app y en otros caminos).
3. **Diario de SafeVault** a medias tras un cierre brusco: recuperación pendiente que bloquea nuevas operaciones.
4. **Cola/estado colgado** tras un error (una promesa rechazada que deja un candado).
Método: (a) mostrar siempre el error real y no uno genérico (la misma línea técnica que ya tiene el asistente, en toda la app); (b) reproducir con inyección de fallos en el vault; (c) arreglar la causa raíz y dejar la prueba que falla antes y pasa después. Si fuera el bloqueo de OPFS, el aviso incluirá «reintentar» y el reintento libera el handle.
Relación con el examen que no se guardaba desde el asistente: puede ser la misma causa; la línea técnica nos lo confirmará.

## Decisiones tuyas (en las demos)
- Dónde va el mini reproductor: A) dentro de la barra del asistente · B) esquina inferior izquierda · C) junto al reloj de la barra superior.
- Mascota: Moti, Nubi o Tico.
- Barra del asistente: siempre visible o solo al invocarla.
- Estilo de respuestas: claro (A) u oscuro de alto contraste (B).

## Reglas que se respetan
Cristal (interfaz sin color, acento opcional), todo lo flotante por `overlay.tsx` y `--z-*`, objetivos ≥ 44 px, `aria-label` en iconos, textos por `t()` (es/en/fr), sin red. Tipografía: `"Helvetica Neue", Helvetica, Arial, system-ui` con interletrado −0,01 a −0,02 em y Bold (700) en títulos y énfasis; no se descarga ninguna fuente (sin red).

## Decisiones confirmadas (2026-11-24)
- **Barra superior grande**: solo iconos; etiqueta al pasar el cursor y nombre en la pestaña activa (como en iPad).
- **Mini reproductor**: junto al reloj (barra superior). Sale de la zona inferior.
- **Mascota**: se llama **GREX**; cuadrado con esquinas redondeadas (squircle), tierna, original (ojos con brillo, mejillas).
- **Barra del chatbot**: se puede **minimizar a la mascota**; la mascota minimizada queda **abajo a la derecha**, en el hueco que deja el reproductor, sin tapar nada (respeta teclado, barra de notas, barras laterales y la firma). Un clic abre la barra.
- **Respuestas del asistente**: estilo de la demo (A, vidrio claro; B opcional).
- **Notas**: verificar y eliminar solapes entre menús, barras laterales, barra del editor, chat y avisos.
- **Diagramas**: menú inferior y espacio de pantalla fijos al hacer zoom (la interfaz no se escala ni se pierde; el zoom solo afecta al lienzo).
- **Tipografía**: Helvetica Neue apretada, Bold en lo importante.

## Reparto sin pisarse (un agente por zona, cada uno en su worktree y con CSS/i18n propios)
A barra superior + reproductor · B chat + GREX + zona inferior · C notas (solapes) · D diagramas (barra inferior y zoom) · E bug borrar/modificar (vault/notas) · F tipografía global. Archivos compartidos (`app.tsx`, `theme-cristal.css`, `i18n/*.json`): CSS en archivos nuevos por agente, claves con prefijo propio (`topbar.*`, `dock.*`, `notas.*`, `diag.*`) y `app.tsx` lo toca un solo agente por turno. Se fusionan en orden y se prueban juntos.

## 2026-11-24 · rediseño de interfaz (mejoras-ui)
Agentes: auditoría haiku (inventario) · A barra superior/reproductor · B chat+GREX+dock · C notas · D diagramas · E vault · F tipografía · G dictado · integración (sonnet, regresión de 29 e2e). Todos en worktrees propios; fusión en orden con resolución de i18n por unión. Verificado en Chromium: 0 solapes en 4 resoluciones (e2e:uiaudit), 1042/1043 pruebas (la roja es de tiempo, preexistente). Sin verificar: Safari/iPad reales, dictado real, teclado real.
