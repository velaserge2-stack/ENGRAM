# Estado · presupuesto de carga de diagramas

Medido tras `npm run build` (gzip, `gzip -c | wc -c`). Sin cambios de código: la separación ya existía.

## Hallazgo
El «fragmento de ~32 KB» (`c-gBd_qnM1`, 33 608 B) NO es el motor: es el chunk de la pantalla de Notas. Contiene
las cadenas `diag-host`/`mountDiagrams` (barra `diag-embed`, `import('../diagrams/mount')`), pero el motor no está dentro.

## Al ABRIR una nota con diagrama (import de `mount.ts`)
| Pieza | gzip |
|---|---|
| `mount.ts` (c-BU3q3uZG) | 347 B |
| parse + layout + view (c-DgCFqR76) | 6 742 B |
| `view-*.css` | 1 275 B |
| **Total** | **≈ 8,4 KB** (objetivo ≤ 15 KB: cumplido) |

`lucide-preact` no entra aquí (la vista no usa iconos); i18n y preact son chunks compartidos que ya carga el paquete inicial.

## Aparte, solo al EDITAR / EXPORTAR (`import()` ya separados)
- Editor (canvas, gestures, toolbar, history, iconos): c-Dsh__zxf, 11 940 B (más edit/serialize compartidos).
- Exportar (`export-ui` + `export`): chunk propio, 2 668 B, cargado al pulsar «Exportar».

## Antes / después
Ver: 8,4 KB antes y después (sin cambios). Iconos: importados por nombre, sin barril, sin duplicados entre fragmentos.
