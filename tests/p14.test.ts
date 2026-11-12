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

import { imageSize, neededSide, SAFARI_MAX_PX, scaled, stepFor, tooBig } from '../src/lib/imgview';
describe('versión reducida de imágenes (Prompt 14 · 3)', () => {
  it('tamaño necesario: ancho del panel × densidad (tope 2), sin agrandar', () => {
    expect(neededSide(4000, 3000, 640, 1)).toBe(640);
    expect(neededSide(4000, 3000, 640, 3)).toBe(1280); // dpr se limita a 2
    expect(neededSide(3000, 4000, 640, 2)).toBe(Math.ceil(4000 * (1280 / 3000))); // vertical: lado mayor es el alto
    expect(neededSide(500, 400, 640, 2)).toBe(500); // nunca más que el original
  });
  it('escalones 640 / 1 280 / 2 560 y original si ya es pequeño', () => {
    expect(stepFor(4000, 3000, 640)).toBe(640);
    expect(stepFor(4000, 3000, 700)).toBe(1280);
    expect(stepFor(8000, 6000, 5000)).toBe(2560); // tope
    expect(stepFor(1200, 900, 1100)).toBeNull(); // el escalón (1280) ≥ original: se usa el original
    expect(scaled(8000, 6000, 2560)).toEqual([2560, 1920]);
  });
  it('límite de Safari (~16.7 MP)', () => {
    expect(tooBig(4096, 4096)).toBe(false);
    expect(tooBig(4097, 4096)).toBe(true);
    expect(SAFARI_MAX_PX).toBe(4096 * 4096);
  });
  it('medidas desde la cabecera PNG y JPEG (sin decodificar)', () => {
    const png = new Uint8Array(32); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); new DataView(png.buffer).setUint32(16, 8000); new DataView(png.buffer).setUint32(20, 6000);
    expect(imageSize(png)).toEqual([8000, 6000]);
    // SOI, APP0 (len 16), SOF0 (alto 3000, ancho 4000)
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0), 0xff, 0xc0, 0x00, 0x11, 0x08, 0x0b, 0xb8, 0x0f, 0xa0, 0x03]);
    expect(imageSize(jpg)).toEqual([4000, 3000]);
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
