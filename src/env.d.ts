/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
  const url: string;
  export default url;
}
declare module 'mammoth' {
  const m: {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }, opts?: object): Promise<{ value: string; messages: unknown[] }>;
    extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
    images: { imgElement(fn: (img: { contentType: string; read: (enc: 'base64') => Promise<string> }) => Promise<{ src: string }>): unknown };
  };
  export default m;
}
declare module 'turndown' {
  interface Rule { filter: string | string[] | ((node: Node) => boolean); replacement: (content: string, node: Node) => string }
  export default class TurndownService {
    constructor(opts?: object);
    addRule(name: string, rule: Rule): this;
    remove(f: string[]): this;
    turndown(html: string): string;
  }
}
declare module 'sql.js/dist/sql-wasm-browser.js' {
  const init: (cfg: { locateFile: (f: string) => string }) => Promise<unknown>;
  export default init;
}
declare module 'sql.js/dist/sql-wasm-browser.wasm?url' {
  const url: string;
  export default url;
}
declare module 'sql.js';
