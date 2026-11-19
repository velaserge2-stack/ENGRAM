/// <reference lib="webworker" />
/** Worker: sql.js (WASM) + escritura del .apkg (v11). Entrada: mazos ya mapeados y bytes de los medios. */
import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import type { MapResult } from './map';
import { ApkgExportError, buildApkg, type AnkiRevlog, type AnkiSched } from './write';

export interface ExportRequest {
  decks: MapResult[];
  /** original (como en `MapResult.media`) → bytes de `media/<original>`; los que falten se cuentan. */
  media: Map<string, Uint8Array>;
  sched?: Map<number, AnkiSched>;
  revlog?: AnkiRevlog[];
}

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<ExportRequest>) => {
  try {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const { media, ...rest } = e.data;
    const { bytes, stats } = await buildApkg({ SQL, ...rest, readMedia: (name) => media.get(name), onProgress: (progress) => post({ progress }) });
    post({ ok: true, result: { bytes, stats } }, [bytes.buffer]);
  } catch (err) {
    post({ ok: false, error: (err as Error).message, code: err instanceof ApkgExportError ? err.code : 'apkg_export_failed' });
  }
};
