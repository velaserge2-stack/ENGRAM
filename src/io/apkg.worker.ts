/// <reference lib="webworker" />
/** Worker: sql.js (WASM) + conversión .apkg. Así la UI no se congela con mazos grandes. */
import initSqlJs from 'sql.js/dist/sql-wasm-browser.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { convertApkg, type SqlJs } from './apkg';

self.onmessage = async (e: MessageEvent<{ bytes: Uint8Array; history: boolean }>) => {
  try {
    const SQL = (await initSqlJs({ locateFile: () => wasmUrl })) as unknown as SqlJs;
    (self as unknown as Worker).postMessage({ ok: true, result: convertApkg(e.data.bytes, SQL, e.data.history) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: (err as Error).message });
  }
};
