// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { compatibleMarkdown, htmlToMarkdown, markdownToDocx } from '../src/notes/io';

const MD = `# Título

## Sección

Texto con **negrita**, ==resaltado== y [rojo]{.rojo}.

- uno
- dos

1. primero
2. segundo

| A | B |
|---|---|
| 1 | 2 |

> [!note] Ojo
> callout

- [x] tarea hecha
`;

describe('ida y vuelta .md → .docx → .md', () => {
  it('conserva títulos, listas y tablas', async () => {
    const blob = await markdownToDocx(MD, 'Prueba', async () => null);
    expect(blob.size).toBeGreaterThan(2000);
    // mammoth (node) lee el .docx generado y turndown lo devuelve a Markdown
    const mammoth = (await import('mammoth')).default as unknown as { convertToHtml(i: { buffer: Buffer }): Promise<{ value: string }> };
    const html = (await mammoth.convertToHtml({ buffer: Buffer.from(await blob.arrayBuffer()) })).value;
    const back = await htmlToMarkdown(html);
    expect(back).toMatch(/^# Título/m);
    expect(back).toMatch(/^## Sección/m);
    expect(back).toMatch(/^- uno/m);
    expect(back).toMatch(/primero/);
    expect(back).toMatch(/\| A \| B \|/);
    expect(back).toMatch(/\| 1 \| 2 \|/);
    expect(back).toMatch(/\*\*negrita\*\*/);
    expect(back).toContain('☑ tarea hecha');
  });
  it('enlaces compatibles y colores', () => {
    expect(compatibleMarkdown('[[Nota A]] ![[x.png]] [r]{.rojo}', { links: true, colors: 'html' })).toBe('[Nota A](Nota%20A.md) ![](x.png) <span style="color:#C62D23">r</span>');
    expect(compatibleMarkdown('[r]{.rojo}', { links: false, colors: 'plain' })).toBe('r');
  });
  it('HTML pegado de Word se limpia', async () => {
    const md = await htmlToMarkdown('<p style="mso-x:1"><b>Hola</b> <script>x</script><mark>hi</mark></p><img src="media:a.png">');
    expect(md).toBe('**Hola** ==hi==\n\n![[a.png]]\n');
  });
});
