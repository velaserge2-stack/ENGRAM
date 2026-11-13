import { t as tr } from '../i18n';
/**
 * Extracción de texto "mejor esfuerzo" (SPEC §9c, §10b): DOCX con mammoth, PDF
 * con pdfjs-dist. Bibliotecas cargadas bajo demanda. Todo archivo es no confiable.
 */
import { extname } from '../vault/paths';
import { checksum } from '../vault/util';

const MAX_DOC_BYTES = 60 * 1024 * 1024;

export async function pdfjs() {
  const lib = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  lib.GlobalWorkerOptions.workerSrc = worker;
  return lib;
}

export interface PdfText {
  pages: { lines: { text: string; size: number }[] }[];
}

/** Texto por página, agrupado en líneas por coordenada Y (con tamaño de fuente para detectar títulos). */
export async function pdfText(bytes: Uint8Array): Promise<PdfText> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: bytes.slice() });
  const doc = await task.promise;
  const pages: PdfText['pages'] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const rows = new Map<number, { x: number; s: string; size: number }[]>();
    for (const it of tc.items as { str: string; transform: number[]; height: number }[]) {
      if (!('str' in it) || !it.str) continue;
      const y = Math.round(it.transform[5]! / 2) * 2;
      const size = Math.round(Math.hypot(it.transform[0]!, it.transform[1]!));
      (rows.get(y) ?? rows.set(y, []).get(y)!).push({ x: it.transform[4]!, s: it.str, size });
    }
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, r]) => {
      r.sort((a, b) => a.x - b.x);
      return { text: r.map((x) => x.s).join(' ').replace(/\s+/g, ' ').trim(), size: Math.max(...r.map((x) => x.size)) };
    }).filter((l) => l.text);
    pages.push({ lines });
    page.cleanup();
  }
  await task.destroy();
  return { pages };
}

export async function docxToHtml(bytes: Uint8Array): Promise<{ html: string; images: { name: string; data: Uint8Array; type: string }[] }> {
  const mammoth = (await import('mammoth')).default;
  const images: { name: string; data: Uint8Array; type: string }[] = [];
  const res = await mammoth.convertToHtml({ arrayBuffer: bytes.slice().buffer as ArrayBuffer }, {
    convertImage: mammoth.images.imgElement(async (img: { contentType: string; read: (enc: 'base64') => Promise<string> }) => {
      const b64 = await img.read('base64');
      const ext = (img.contentType.split('/')[1]?.replace('jpeg', 'jpg') ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'png';
      const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      // nombre por contenido: abrir el mismo .docx otra vez no crea copias nuevas en media/
      const name = `docx-${checksum(data)}-${data.length.toString(36)}.${ext}`;
      if (!images.some((x) => x.name === name)) images.push({ name, data, type: img.contentType });
      return { src: `media:${name}` };
    }),
  });
  return { html: res.value, images };
}

export async function extractText(name: string, bytes: Uint8Array): Promise<{ text: string; warnings: string[] }> {
  const ext = extname(name);
  const warnings: string[] = [];
  if (bytes.length > MAX_DOC_BYTES) return { text: '', warnings: [tr('extract.archivo_demasiado_grande')] };
  if (ext === 'docx') {
    const mammoth = (await import('mammoth')).default;
    const r = await mammoth.extractRawText({ arrayBuffer: bytes.slice().buffer as ArrayBuffer });
    return { text: r.value, warnings };
  }
  if (ext === 'pdf') {
    const t = await pdfText(bytes);
    const text = t.pages.map((p) => p.lines.map((l) => l.text).join('\n')).join('\n\n');
    if (text.trim().length < 20) warnings.push(tr('extract.el_pdf_no_tiene_texto_seleccionable'));
    else warnings.push(tr('extract.pdf_las_columnas_complejas_pueden_mezclar'));
    return { text, warnings };
  }
  return { text: new TextDecoder().decode(bytes), warnings };
}
