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
