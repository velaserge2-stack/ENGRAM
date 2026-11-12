/**
 * Exportar/importar notas (SPEC §10b): .md (con opción de enlaces compatibles),
 * .docx (biblioteca `docx`, MIT), .pdf vía impresión; importar .docx
 * (mammoth → HTML saneado → turndown) y .pdf (pdfjs, títulos por tamaño de fuente).
 */
import { imageSize } from './imgsize';
import { IMG_EXT, parseEmbed } from '../md/embed';
import type MarkdownItType from 'markdown-it';
import { sanitize } from '../md/render';
import { pdfText } from '../io/extract';

type Tok = ReturnType<InstanceType<typeof MarkdownItType>['parse']>[number];

const COLORS: Record<string, string> = { azul: '0A6FD8', verde: '1F8A3C', indigo: '4B48C7', naranja: 'B35C00', rosa: 'C8204A', rojo: 'C62D23', morado: '8E3DB8', turquesa: '00738A', menta: '007D78', amarillo: '8A6D00' };

/** [[Nota]] → [Nota](Nota.md); colores → HTML o texto plano. */
export function compatibleMarkdown(md: string, opts: { links: boolean; colors: 'keep' | 'html' | 'plain' }): string {
  let out = md;
  if (opts.links) out = out.replace(/(?<!!)\[\[([^\]|#]+)(?:\|([^\]]+))?\]\]/g, (_, t: string, a?: string) => `[${a ?? t}](${encodeURI(t.trim())}.md)`).replace(/!\[\[([^\]|]+)\]\]/g, (_, f: string) => `![](${encodeURI(f.trim())})`);
  if (opts.colors === 'html') out = out.replace(/\[([^\]\n]+)\]\{\.([a-z]+)\}/g, (_, t: string, c: string) => `<span style="color:#${COLORS[c] ?? '000000'}">${t}</span>`);
  if (opts.colors === 'plain') out = out.replace(/\[([^\]\n]+)\]\{\.[a-z]+\}/g, '$1');
  return out;
}

/** Formatos que Word incrusta de forma fiable; los demás (HEIC, WebP, AVIF, SVG) se convierten solo al exportar. */
const DOCX_IMG: Record<string, 'jpg' | 'png' | 'gif' | 'bmp'> = { jpg: 'jpg', jpeg: 'jpg', png: 'png', gif: 'gif', bmp: 'bmp' };
export interface DocxOpts {
  /** Convierte a JPEG/PNG lo que Word no incrusta (necesita el navegador: canvas). */
  convert?: (bytes: Uint8Array, name: string) => Promise<{ data: Uint8Array; type: 'jpg' | 'png' } | null>;
  /** Se llena con los nombres de las imágenes convertidas (para el informe de exportación). */
  converted?: string[];
}

export async function markdownToDocx(md: string, title: string, loadImage: (name: string) => Promise<Uint8Array | null>, opts: DocxOpts = {}): Promise<Blob> {
  const d = await import('docx');
  const MarkdownIt = (await import('markdown-it')).default;
  const tokens = new MarkdownIt({ html: false, linkify: true }).parse(md.replace(/^---\n[\s\S]*?\n---\n/, ''), {});
  type Run = InstanceType<typeof d.TextRun> | InstanceType<typeof d.ImageRun> | InstanceType<typeof d.ExternalHyperlink>;
  const children: (InstanceType<typeof d.Paragraph> | InstanceType<typeof d.Table>)[] = [];

  let centered = false; // el párrafo lleva una imagen `|centro`
  /** `![[foto.jpg|300|izq|alt …]]`: el original, con su proporción real y el tamaño y lugar de la nota (A2). */
  async function image(inner: string): Promise<Run | null> {
    const e = parseEmbed(inner);
    if (!IMG_EXT.test(e.name)) return null;
    let data = await loadImage(e.name);
    if (!data) return null;
    let type = DOCX_IMG[e.name.split('.').pop()!.toLowerCase()];
    if (!type) {
      const c = await opts.convert?.(data, e.name);
      if (!c) return null;
      ({ data, type } = c);
      opts.converted?.push(e.name);
    }
    const dims = imageSize(data);
    const MAX = 600; // ancho útil de la página en px (A4/carta con márgenes de Word)
    const w = Math.round(e.w ? (e.w.unit === '%' ? (MAX * e.w.v) / 100 : Math.min(MAX, e.w.v)) : Math.min(420, dims?.w ?? 420));
    const h = Math.round(dims ? (w * dims.h) / dims.w : (w * 2) / 3);
    if (e.align === 'centro') centered = true;
    const floating = e.align === 'izq' || e.align === 'der' ? {
      horizontalPosition: { relative: d.HorizontalPositionRelativeFrom.MARGIN, align: e.align === 'izq' ? d.HorizontalPositionAlign.LEFT : d.HorizontalPositionAlign.RIGHT },
      verticalPosition: { relative: d.VerticalPositionRelativeFrom.PARAGRAPH, align: d.VerticalPositionAlign.TOP },
      wrap: { type: d.TextWrappingType.SQUARE, side: e.align === 'izq' ? d.TextWrappingSide.RIGHT : d.TextWrappingSide.LEFT },
      margins: { left: 114300, right: 114300, top: 57150, bottom: 57150 },
    } : undefined;
    return new d.ImageRun({ data, type, transformation: { width: w, height: h }, ...(floating ? { floating } : {}), ...(e.alt ? { altText: { name: e.name, description: e.alt, title: e.alt } } : {}) });
  }

  async function runs(inline: Tok): Promise<Run[]> {
    centered = false;
    const out: Run[] = [];
    let bold = false, italic = false, strike = false, link: string | null = null;
    const text = (s: string) => {
      // ==resaltado==, [texto]{.color}, [[wikilink]]
      const parts = s.split(/(==[^=]+==|\[[^\]\n]+\]\{\.[a-z]+\}|\[\[[^\]]+\]\])/g).filter(Boolean);
      for (const p of parts) {
        let m: RegExpExecArray | null;
        const base = { bold, italics: italic, strike };
        if ((m = /^==([^=]+)==$/.exec(p))) out.push(new d.TextRun({ ...base, text: m[1]!, highlight: 'yellow' }));
        else if ((m = /^\[([^\]]+)\]\{\.([a-z]+)\}$/.exec(p))) out.push(new d.TextRun({ ...base, text: m[1]!, color: COLORS[m[2]!] ?? '000000' }));
        else if ((m = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/.exec(p))) out.push(new d.TextRun({ ...base, text: m[2] ?? m[1]!, underline: {} }));
        else if (link) out.push(new d.ExternalHyperlink({ link, children: [new d.TextRun({ ...base, text: p, style: 'Hyperlink' })] }));
        else out.push(new d.TextRun({ ...base, text: p }));
      }
    };
    for (const c of inline.children ?? []) {
      if (c.type === 'text') {
        // embeds en cualquier parte del párrafo (p. ej. `![[foto|240|izq]] Texto…`)
        for (const part of c.content.split(/(!\[\[[^\]\n]+\]\])/)) {
          if (!part) continue;
          const m = /^!\[\[([^\]\n]+)\]\]$/.exec(part);
          const run = m ? await image(m[1]!) : null;
          if (run) out.push(run);
          else text(part);
        }
      } else if (c.type === 'strong_open') bold = true;
      else if (c.type === 'strong_close') bold = false;
      else if (c.type === 'em_open') italic = true;
      else if (c.type === 'em_close') italic = false;
      else if (c.type === 's_open') strike = true;
      else if (c.type === 's_close') strike = false;
      else if (c.type === 'link_open') link = String(c.attrGet('href') ?? '');
      else if (c.type === 'link_close') link = null;
      else if (c.type === 'code_inline') out.push(new d.TextRun({ text: c.content, font: 'Menlo' }));
      else if (c.type === 'softbreak' || c.type === 'hardbreak') out.push(new d.TextRun({ text: '', break: 1 }));
    }
    return out;
  }

  const list: { ordered: boolean }[] = [];
  let quote = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type === 'heading_open') {
      const lvl = Number(t.tag.slice(1));
      const H = [d.HeadingLevel.HEADING_1, d.HeadingLevel.HEADING_2, d.HeadingLevel.HEADING_3, d.HeadingLevel.HEADING_4, d.HeadingLevel.HEADING_5, d.HeadingLevel.HEADING_6];
      children.push(new d.Paragraph({ heading: H[lvl - 1], children: await runs(tokens[i + 1]!) }));
      i += 2;
    } else if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') list.push({ ordered: t.type === 'ordered_list_open' });
    else if (t.type === 'bullet_list_close' || t.type === 'ordered_list_close') list.pop();
    else if (t.type === 'blockquote_open') quote++;
    else if (t.type === 'blockquote_close') quote--;
    else if (t.type === 'paragraph_open') {
      const inline = tokens[i + 1]!;
      let r = await runs(inline);
      const task = /^\[([ xX])\]\s/.exec(inline.content);
      if (task) {
        inline.children![0]!.content = inline.children![0]!.content.replace(/^\[[ xX]\]\s/, '');
        r = [new d.TextRun({ text: task[1] === ' ' ? '☐ ' : '☑ ' }), ...(await runs(inline))];
      }
      const callout = quote && /^\[!(\w+)\][+-]?\s*/.exec(inline.content);
      if (callout) {
        inline.children![0]!.content = inline.children![0]!.content.replace(/^\[!\w+\][+-]?\s*/, '');
        r = [new d.TextRun({ text: `${callout[1]!.toUpperCase()}: `, bold: true }), ...(await runs(inline))];
      }
      const lvl = list.length - 1;
      children.push(new d.Paragraph({
        children: r,
        ...(centered ? { alignment: d.AlignmentType.CENTER } : {}),
        ...(list.length ? (list[lvl]!.ordered ? { numbering: { reference: 'num', level: lvl } } : { bullet: { level: lvl } }) : {}),
        ...(quote ? { border: { left: { style: d.BorderStyle.SINGLE, size: 12, color: '888888', space: 8 }, top: callout ? { style: d.BorderStyle.SINGLE, size: 4, color: '888888', space: 4 } : undefined, bottom: callout ? { style: d.BorderStyle.SINGLE, size: 4, color: '888888', space: 4 } : undefined, right: callout ? { style: d.BorderStyle.SINGLE, size: 4, color: '888888', space: 4 } : undefined }, indent: { left: 240 } } : {}),
      }));
      i += 2;
    } else if (t.type === 'fence' || t.type === 'code_block') {
      children.push(new d.Paragraph({ children: t.content.split('\n').map((l, k) => new d.TextRun({ text: l, font: 'Menlo', break: k ? 1 : 0 })) }));
    } else if (t.type === 'table_open') {
      const rows: InstanceType<typeof d.TableRow>[] = [];
      let cells: InstanceType<typeof d.TableCell>[] = [];
      let header = false;
      for (i++; i < tokens.length && tokens[i]!.type !== 'table_close'; i++) {
        const x = tokens[i]!;
        if (x.type === 'thead_open') header = true;
        if (x.type === 'tbody_open') header = false;
        if (x.type === 'tr_open') cells = [];
        if (x.type === 'th_open' || x.type === 'td_open') {
          const r = await runs(tokens[i + 1]!);
          cells.push(new d.TableCell({ children: [new d.Paragraph({ children: header ? r.map((y) => y) : r })] }));
        }
        if (x.type === 'tr_close') rows.push(new d.TableRow({ children: cells, tableHeader: header }));
      }
      children.push(new d.Table({ rows, width: { size: 100, type: d.WidthType.PERCENTAGE } }));
    } else if (t.type === 'hr') children.push(new d.Paragraph({ thematicBreak: true, children: [] }));
  }
  const doc = new d.Document({
    title,
    creator: 'Engrama',
    numbering: { config: [{ reference: 'num', levels: [0, 1, 2, 3].map((level) => ({ level, format: d.LevelFormat.DECIMAL, text: `%${level + 1}.`, alignment: d.AlignmentType.START, style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } } })) }] },
    sections: [{ children }],
  });
  return d.Packer.toBlob(doc);
}

/** HTML (de Word, de mammoth o pegado) → Markdown, con tablas e imágenes de la bóveda. */
export async function htmlToMarkdown(html: string): Promise<string> {
  const TurndownService = (await import('turndown')).default;
  const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*' });
  td.addRule('mediaImg', { filter: (n) => n.nodeName === 'IMG' && ((n as HTMLImageElement).getAttribute('src') ?? '').startsWith('media:'), replacement: (_c, n) => `![[${(n as HTMLImageElement).getAttribute('src')!.slice(6)}]]` });
  td.addRule('mark', { filter: ['mark'], replacement: (c) => `==${c}==` });
  td.addRule('table', {
    filter: 'table',
    replacement: (_c, node) => {
      const rows = [...(node as HTMLTableElement).querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()));
      if (!rows.length) return '';
      const w = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) => `| ${Array.from({ length: w }, (_, i) => r[i] ?? '').join(' | ')} |`;
      return `\n\n${line(rows[0]!)}\n| ${Array(w).fill('---').join(' | ')} |\n${rows.slice(1).map(line).join('\n')}\n\n`;
    },
  });
  td.remove(['script', 'style', 'meta', 'title' as keyof HTMLElementTagNameMap]);
  return td.turndown(sanitize(html)).replace(/^(\s*)([-*]|\d+\.)\s{2,}/gm, '$1$2 ').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

export async function docxToMarkdown(bytes: Uint8Array): Promise<{ md: string; images: { name: string; data: Uint8Array }[] }> {
  const { docxToHtml } = await import('../io/extract');
  const { html, images } = await docxToHtml(bytes);
  return { md: await htmlToMarkdown(html), images };
}

export async function pdfToMarkdown(bytes: Uint8Array): Promise<{ md: string; scanned: boolean }> {
  const t = await pdfText(bytes);
  const sizes = t.pages.flatMap((p) => p.lines.map((l) => l.size)).sort((a, b) => a - b);
  const med = sizes[Math.floor(sizes.length / 2)] ?? 10;
  const out: string[] = [];
  for (const p of t.pages) {
    for (const l of p.lines) {
      if (l.size >= med * 1.6) out.push(`\n# ${l.text}\n`);
      else if (l.size >= med * 1.25) out.push(`\n## ${l.text}\n`);
      else if (/^[•·▪-]\s/.test(l.text)) out.push(`- ${l.text.slice(2)}`);
      else out.push(l.text);
    }
    out.push('');
  }
  const md = out.join('\n').replace(/([^\n])\n(?=[a-záéíóúñ])/g, '$1 ').replace(/\n{3,}/g, '\n\n').trim();
  return { md, scanned: md.length < 20 };
}
