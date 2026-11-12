// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import DOMPurify from 'dompurify';
import { renderCacheSize, renderMarkdown, renderMarkdownCached, sanitize } from '../src/md/render';
import { acquireMediaUrl, mediaUrl, releaseMediaUrl } from '../src/ui/background';
import { MemoryBackend } from '../src/vault/memory';

const XSS = ['<img src=x onerror=alert(1)>', '<script>alert(1)</script>hola', '[a](javascript:alert(1))', '<a href="java\tscript:alert(1)">x</a>', '<svg><g onload=alert(1)></g></svg>', '<iframe src=//x></iframe>', '![[foto.png]] ==res== [[Nota|alias]] [rojo]{.rojo}'];

describe('HTML por bloque (Prompt 14)', () => {
  it('la instancia con configuración fija sanea igual que pasar la configuración en cada llamada', () => {
    const cfg = { ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|blob|media):|#|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i, ADD_ATTR: ['data-media', 'data-wl', 'data-kind', 'target'], FORBID_TAGS: ['style', 'iframe', 'form', 'object', 'embed'], ADD_TAGS: ['details', 'summary'] };
    for (const x of XSS) expect(sanitize(x)).toBe(DOMPurify.sanitize(x, cfg) as string);
    for (const x of XSS) {
      const d = document.createElement('div');
      d.innerHTML = renderMarkdown(x);
      expect(d.querySelector('script, iframe')).toBeNull();
      for (const el of d.querySelectorAll('*')) {
        expect([...el.attributes].some((a) => /^on/i.test(a.name))).toBe(false);
        expect(/^\s*javascript:/i.test(el.getAttribute('href') ?? '')).toBe(false);
      }
    }
  });
  it('la caché devuelve exactamente lo mismo que renderMarkdown (ya saneado)', () => {
    for (const x of [...XSS, '# Título', '- [ ] tarea', '> [!note] T\n> cuerpo', '| a | b |\n|---|---|\n| 1 | 2 |']) {
      expect(renderMarkdownCached(x)).toBe(renderMarkdown(x));
      expect(renderMarkdownCached(x)).toBe(renderMarkdown(x)); // segunda vez, desde la caché
    }
  });
  it('tiene límite (LRU)', () => {
    for (let i = 0; i < 20050; i++) renderMarkdownCached(`bloque ${i}`);
    expect(renderCacheSize()).toBe(20000);
  });
});

describe('préstamo de URLs de medios (Prompt 14)', () => {
  const vault = () => { const v = new MemoryBackend(); return v; };
  it('se revoca cuando nadie la tiene prestada; las fijas (mediaUrl) no', async () => {
    const v = vault();
    await v.write('media/a.png', new Uint8Array([1, 2, 3]));
    await v.write('media/b.png', new Uint8Array([4]));
    const revoked: string[] = [];
    const orig = URL.revokeObjectURL;
    URL.revokeObjectURL = (u: string) => (revoked.push(u), orig(u));
    const a1 = await acquireMediaUrl(v, 'media/a.png');
    const a2 = await acquireMediaUrl(v, 'media/a.png');
    expect(a1).toBe(a2);
    releaseMediaUrl('media/a.png');
    expect(revoked).toEqual([]);
    releaseMediaUrl('media/a.png');
    expect(revoked).toEqual([a1]);
    const b = await mediaUrl(v, 'media/b.png');
    await acquireMediaUrl(v, 'media/b.png');
    releaseMediaUrl('media/b.png');
    expect(revoked).not.toContain(b);
    URL.revokeObjectURL = orig;
  });
  it('devuelta antes de terminar de leer: no se crea la URL (sin fuga)', async () => {
    const v = vault();
    await v.write('media/c.png', new Uint8Array([9]));
    let created = 0;
    const orig = URL.createObjectURL;
    URL.createObjectURL = (o: Blob | MediaSource) => (created++, orig(o));
    const p = acquireMediaUrl(v, 'media/c.png');
    releaseMediaUrl('media/c.png');
    expect(await p).toBeNull();
    expect(created).toBe(0);
    URL.createObjectURL = orig;
  });
});

