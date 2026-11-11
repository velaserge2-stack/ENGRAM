// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { plainText, renderCloze, renderMarkdown } from '../src/md/render';

describe('markdown', () => {
  it('extensiones', () => {
    const h = renderMarkdown('==alto== [rojo]{.rojo} [[Nota|alias]] ![[x.png]]\n\n- [x] hecha\n\n> [!note] Ojo\n> texto');
    expect(h).toContain('<mark>alto</mark>');
    expect(h).toContain('class="c-rojo"');
    expect(h).toContain('data-wl="Nota"');
    expect(h).toContain('data-media="x.png"');
    expect(h).toContain('checked');
    expect(h).toContain('class="callout"');
  });
  it('sanitiza', () => {
    const h = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=alert(1)>');
    expect(h).not.toContain('<script');
    expect(h).not.toContain('href="javascript');
    expect(h).not.toMatch(/<img[^>]*onerror/);
  });
  it('cloze', () => {
    const t = 'La {{c1::FA}} no tiene {{c2::ondas P::onda}}';
    expect(renderCloze(t, 2, false)).toContain('[onda]');
    expect(renderCloze(t, 2, false)).toContain('FA');
    expect(renderCloze(t, 1, true)).toContain('<span class="cloze">FA</span>');
    expect(plainText(t)).toBe('La FA no tiene ondas P');
  });
});
describe('callout plegable', () => {
  it('se convierte en details', () => {
    const h = renderMarkdown('> [!quote]- Transcripción\n> línea uno\n> línea dos');
    expect(h).toContain('<details');
    expect(h).toContain('<summary class="callout-t">Transcripción</summary>');
    expect(h).toContain('línea dos');
  });
});
