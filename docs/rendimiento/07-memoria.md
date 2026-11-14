# Fase 7 · Memoria y ciclo de vida (Prompt 21-B)

Auditoría del código más las cifras de memoria de las fases anteriores. **No hubo cambios de código en esta fase**: no apareció nada que justificara uno con la regla de «medir, cambiar, medir».

## Pico de memoria (Chromium, `JSHeapUsedSize` del hilo principal por CDP)
| Escenario | Antes | Después | Fuente |
|---|---|---|---|
| Crear el respaldo de L | 204 MB | **100–120 MB** (−45 %) | fase 3, `zipVault` por partes |
| Abrir la nota de 5 MB | 89–429 MB (varía mucho) | 122–367 MB | fase 5 (sin cambio de fondo: sigue saneando todo al abrir) |
| Buscar en la nota de 5 MB | 274–365 MB | 273–408 MB | fase 5 (la búsqueda binaria quita tiempo, no memoria) |
| Estudiar en L | 69 MB | 64 MB | fase 4 |
| 3 PDF grandes | — | — | ya medido por `npm run e2e:perf` (Prompt 11: visor virtualizado con presupuesto de píxeles); no se tocó |

`JSHeapUsedSize` no cuenta los búferes externos (`ArrayBuffer` de lecturas y zips) ni los Workers. Por eso la cifra del respaldo es la que más se acerca al gasto real; la del iPad hay que mirarla en el dispositivo.

## Auditoría
- **URLs `blob:`**: los medios de las notas y del lienzo van por préstamo (`acquireMediaUrl`/`releaseMediaUrl`, Prompt 14) y se revocan cuando nadie los tiene. Las miniaturas (`thumbs.ts`) se sueltan con un temporizador. Las fijas (`mediaUrl`: fondo activo, foto de perfil, avatar de la imagen compartida) son pocas y se revocan al cambiar el archivo (`forgetMediaUrl`). Compartir y Respaldo revocan su URL al cerrar o tras descargar. Sin fugas.
- **Cachés en memoria**: el HTML saneado por bloque tiene LRU (`md/render.ts`). `noteStore` suelta las notas cerradas (`forget` y `closed`). `days.ts` guarda formatos por zona y un desfase por hora UTC (≈ 44 000 números como máximo en 5 años de historial): acotado en la práctica. La caché de textos de notas vive en IndexedDB, no en memoria; el mapa de textos de la vista Notas es del tamaño de las notas, como antes.
- **Archivos grandes sin copias**: el respaldo ya lee y suelta archivo por archivo. Los PDF se escriben por trozos (`writeStream`) y se abren por rangos (Prompt 11). Importar un zip sigue descomprimiéndolo entero en memoria (`parseZip`, con el tope de `LIMITS`). Se probó hacerlo por entradas (`Unzip` de fflate): no bajó el pico (el resultado retiene todos los archivos) y empeoró restaurar L (+10 %, tareas largas de 2 s); descartado (`03a-lotes.md`, «Tras la fase 3»). El pico del respaldo con `readMany` sigue en ~120 MB.
- **Workers**: el de OPFS debe vivir mientras la app esté abierta (cola única, vigilante con reinicio). El índice de búsqueda vive en su Worker: cerrarlo en reposo obligaría a reconstruir el índice al volver (≈ 0.8 s), y el ahorro de memoria (los textos de las notas) no compensa. Los de `.apkg`, miniaturas y PDF se crean bajo demanda. No se cambió nada.
- **Segundo plano**: `state.json` se guarda al ocultar la página (`visibilitychange`) y en `pagehide`, sin `beforeunload` (fase 4). Al volver no hay trabajo pendiente que reanudar: el diario de `SafeVault` se recupera antes de la siguiente escritura.
