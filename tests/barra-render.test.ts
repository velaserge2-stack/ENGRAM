// @vitest-environment jsdom
// Prompt 17: sintaxis nueva (subrayado, tamaño, alineación) y sanitización (solo lo permitido).
import { describe, expect, it } from 'vitest';
import { plainText, renderMarkdown, sanitize } from '../src/md/render';
import { compatibleMarkdown } from '../src/notes/io';

describe('render de la sintaxis nueva', () => {
  it('++subrayado++, sin tocar c++ ni i++ ni el código', () => {
    expect(renderMarkdown('un ++texto subrayado++ aquí')).toContain('<u>texto subrayado</u>');
    expect(renderMarkdown('en c++ y en i++ no')).not.toContain('<u>');
    expect(renderMarkdown('`a ++b++ c`')).not.toContain('<u>');
    expect(renderMarkdown('```\nx ++y++\n```')).not.toContain('<u>');
    expect(renderMarkdown('++ suelto ++')).not.toContain('<u>');
    expect(renderMarkdown('- ++ítem++')).toContain('<li><u>ítem</u></li>');
  });
  it('tamaño y color combinados; clase desconocida = literal', () => {
    expect(renderMarkdown('[grande]{.grande}')).toContain('<span class="t-grande">grande</span>');
    expect(renderMarkdown('[x]{.rojo .muygrande}')).toContain('<span class="c-rojo t-muygrande">x</span>');
    expect(renderMarkdown('[x]{.gigante}')).toContain('[x]{.gigante}');
    expect(renderMarkdown('[x]{.rojo .gigante}')).not.toContain('<span');
  });
  it('alineación de párrafo y título; en listas y código queda literal', () => {
    expect(renderMarkdown('Centrado {.centro}')).toBe('<p class="al-centro">Centrado</p>\n');
    expect(renderMarkdown('## Título {.der}')).toBe('<h2 class="al-der">Título</h2>\n');
    expect(renderMarkdown('Justo {.justificado}')).toContain('class="al-justificado"');
    expect(renderMarkdown('- ítem {.centro}')).toContain('{.centro}');
    expect(renderMarkdown('Hola {.izquierda}')).toContain('{.izquierda}');
    expect(renderMarkdown('`{.centro}`')).not.toContain('al-centro');
  });
  it('las notas de antes se ven igual', () => {
    expect(renderMarkdown('[rojo]{.rojo}')).toContain('<span class="c-rojo">rojo</span>');
    expect(renderMarkdown('==alto== **n** *i* ~~t~~')).toBe('<p><mark>alto</mark> <strong>n</strong> <em>i</em> <s>t</s></p>\n');
    expect(renderMarkdown('```js\nx\n```')).toContain('class="language-js"');
  });
  it('texto plano (búsqueda, voz): sin marcas nuevas', () => {
    expect(plainText('++sub++ [x]{.rojo .grande} Fin {.centro}')).toBe('sub x Fin');
  });
});

describe('sanitización: nada más pasa', () => {
  it('textos hostiles en la sintaxis nueva', () => {
    for (const s of ['[x]{.rojo onmouseover=alert(1)}', '++<img src=x onerror=alert(1)>++', 'Hola {.centro" onclick="x}', '[<script>x</script>]{.grande}', '## T {.der}<b onclick=1>']) {
      const box = document.createElement('div');
      box.innerHTML = renderMarkdown(s);
      const bad = [...box.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.name)).filter((n) => /^on|^style$/.test(n));
      expect(bad).toEqual([]);
      expect(box.querySelector('script, img[onerror]')).toBeNull();
    }
  });
  it('class solo de la lista cerrada', () => {
    const h = sanitize('<p class="al-centro evil"><span class="c-rojo t-grande x-y">a</span><u class="hack">b</u></p>');
    expect(h).toBe('<p class="al-centro"><span class="c-rojo t-grande">a</span><u>b</u></p>');
    expect(sanitize('<div class="callout" data-kind="note" style="color:red">c</div>')).toBe('<div class="callout" data-kind="note">c</div>');
  });
});

describe('exportar compatible', () => {
  it('HTML o texto plano para otros editores', () => {
    const md = '[x]{.rojo .grande} y ++s++\n\nP {.centro}';
    expect(compatibleMarkdown(md, { links: false, colors: 'plain' })).toBe('x y s\n\nP');
    const h = compatibleMarkdown(md, { links: false, colors: 'html' });
    expect(h).toContain('<u>s</u>');
    expect(h).toContain('font-size:1.25em');
    expect(compatibleMarkdown(md, { links: false, colors: 'keep' })).toBe(md);
  });
});

describe('exportar .docx con la sintaxis nueva', () => {
  it('subrayado, tamaño y alineación llegan a Word; el texto no lleva las marcas', async () => {
    const { markdownToDocx } = await import('../src/notes/io');
    const { unzipSync } = await import('fflate');
    const blob = await markdownToDocx('Un ++sub++ y [big]{.grande}\n\n## Título {.centro}\n\nFin {.justificado}', 'P', async () => null);
    const xml = new TextDecoder().decode(unzipSync(new Uint8Array(await blob.arrayBuffer()))['word/document.xml']!);
    expect(xml).toContain('<w:u w:val="single"/>');
    expect(xml).toContain('<w:sz w:val="28"/>');
    expect(xml).toContain('<w:jc w:val="center"/>');
    expect(xml).toContain('<w:jc w:val="both"/>');
    expect(xml).not.toMatch(/\{\.|\+\+/);
  });
});
