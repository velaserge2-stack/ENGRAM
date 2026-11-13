// @vitest-environment jsdom
// Notas-Pro · Fase A: fotos (tamaño del encabezado, sintaxis, sanitización, miniaturas, exportar el original).
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { imageSize } from '../src/notes/imgsize';
import { nthImageEmbed, parseEmbed, rewriteImageEmbed, serializeEmbed, textBeside } from '../src/md/embed';
import { renderMarkdown, sanitize } from '../src/md/render';
import { markdownToDocx } from '../src/notes/io';
import { MemoryBackend } from '../src/vault/memory';
import { isExportable } from '../src/io/zip';
import { REGENERABLE } from '../src/lib/usage';

vi.mock('../src/notes/thumb-core', () => ({
  THUMB_LONG: 1200,
  makeThumb: vi.fn(async () => ({ blob: new Blob([png(1200, 900) as BlobPart], { type: 'image/jpeg' }), w: 1200, h: 900 })),
}));

function png(w: number, h: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}
/** JPEG mínimo: SOI, APP1 Exif (orientación), SOF0 con alto y ancho. */
function jpeg(w: number, h: number, orientation = 1, pad = 0): Uint8Array {
  const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0, 0, 0];
  const app1 = [0xff, 0xe1, 0, 2 + 6 + tiff.length, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const sof = [0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  const out = new Uint8Array(2 + app1.length + sof.length + pad + 2);
  out.set([0xff, 0xd8, ...app1, ...sof]);
  out.set([0xff, 0xd9], out.length - 2);
  return out;
}

describe('imageSize (solo encabezado)', () => {
  it('PNG, JPEG, GIF y WebP', () => {
    expect(imageSize(png(640, 480))).toEqual({ w: 640, h: 480 });
    expect(imageSize(jpeg(4032, 3024))).toEqual({ w: 4032, h: 3024 });
    expect(imageSize(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x03, 0x58, 0x02]))).toEqual({ w: 800, h: 600 });
    const vp8x = new Uint8Array(30);
    vp8x.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58]);
    vp8x.set([0x7f, 0x02, 0x00, 0xdf, 0x01, 0x00], 24); // 640×480 (menos 1)
    expect(imageSize(vp8x)).toEqual({ w: 640, h: 480 });
    const vp8l = new Uint8Array(30);
    vp8l.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c]);
    const v = (100 - 1) | ((50 - 1) << 14);
    vp8l.set([0x2f, v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255], 20);
    expect(imageSize(vp8l)).toEqual({ w: 100, h: 50 });
  });
  it('orientación EXIF 6 (foto en vertical del iPad) intercambia ancho y alto', () => {
    expect(imageSize(jpeg(4032, 3024, 6))).toEqual({ w: 3024, h: 4032 });
    expect(imageSize(jpeg(4032, 3024, 3))).toEqual({ w: 4032, h: 3024 });
  });
  it('archivo corrupto o desconocido → null, sin lanzar', () => {
    expect(imageSize(new Uint8Array([0xff, 0xd8, 0x00]))).toBeNull();
    expect(imageSize(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(imageSize(new Uint8Array(0))).toBeNull();
    expect(imageSize(png(0, 10))).toBeNull();
  });
});

describe('sintaxis ![[foto|ancho|alineación|alt]]', () => {
  it('orden libre, alias y %', () => {
    expect(parseEmbed('a.jpg|izq|300')).toMatchObject({ name: 'a.jpg', w: { v: 300, unit: 'px' }, align: 'izq' });
    expect(parseEmbed('a.jpg|40%|right')).toMatchObject({ w: { v: 40, unit: '%' }, align: 'der' });
    expect(parseEmbed('a.jpg|center')).toMatchObject({ w: null, align: 'centro' });
  });
  it('valores inválidos se ignoran al mostrar y se conservan al guardar', () => {
    const e = parseEmbed('a.jpg|9999|3%|abajo');
    expect(e.w).toBeNull();
    expect(e.align).toBeNull();
    expect(e.rest).toEqual(['9999', '3%', 'abajo']);
    expect(serializeEmbed(e)).toBe('a.jpg|9999|3%|abajo');
    expect(parseEmbed('a.jpg|9999|300').w).toEqual({ v: 300, unit: 'px' }); // el primero válido manda
    expect(parseEmbed('a.jpg|NaN|Infinity|1e3').w).toBeNull();
  });
  it('alt al final, con | dentro', () => {
    const e = parseEmbed('a.jpg|300|izq|alt ECG | derivación II');
    expect(e.alt).toBe('ECG | derivación II');
    expect(serializeEmbed(e)).toBe('a.jpg|300|izq|alt ECG | derivación II');
    expect(serializeEmbed({ ...e, alt: 'con ]] corchetes' })).toBe('a.jpg|300|izq|alt con  corchetes');
  });
  it('reescribir la n-ésima imagen sin tocar lo demás', () => {
    const t = 'x ![[n.md|alias]] ![[a.png]] y ![[b.jpg|200]]';
    expect(rewriteImageEmbed(t, 1, (e) => ({ ...e, align: 'der' }))).toBe('x ![[n.md|alias]] ![[a.png]] y ![[b.jpg|200|der]]');
    expect(nthImageEmbed(t, 0)?.name).toBe('a.png');
    expect(rewriteImageEmbed(t, 5, (e) => e)).toBe(t);
  });
  it('«Texto al lado» mueve el embed al inicio del párrafo siguiente', () => {
    expect(textBeside(['![[a.png|240|izq]]', 'Texto largo.'], 0, 0)).toEqual({ blocks: ['![[a.png|240|izq]] Texto largo.'], edit: 0 });
    expect(textBeside(['Antes ![[a.png|izq]]', '## Título'], 0, 0)).toEqual({ blocks: ['Antes', '![[a.png|izq]] ', '## Título'], edit: 1 });
    const already = ['![[a.png|izq]] Ya al lado'];
    expect(textBeside(already, 0, 0)).toEqual({ blocks: already, edit: 0 });
  });
});

describe('render y sanitización', () => {
  it('data-w y data-align validados', () => {
    const h = renderMarkdown('![[a.png|40%|izq|alt Un tubo]] Texto');
    expect(h).toContain('data-w="40%"');
    expect(h).toContain('data-align="izq"');
    expect(h).toContain('alt="Un tubo"');
    expect(renderMarkdown('![[a.png|9999|arriba]]')).not.toMatch(/data-w|data-align|width/);
  });
  it('nada más pasa: ni style ni otros atributos', () => {
    const h = sanitize('<img data-media="a.png" data-w="10" data-align="izq" style="position:fixed" data-x="1" onerror="x()" class="c">');
    expect(h).toContain('data-w="10"');
    expect(h).toContain('data-align="izq"');
    expect(h).not.toMatch(/style=|data-x|onerror/);
  });
  it('las notas de antes se ven igual', () => {
    expect(renderMarkdown('![[x.png]]')).toBe('<p><img data-media="x.png" alt="x.png"></p>\n');
    expect(renderMarkdown('![[x.png|300]]')).toBe('<p><img data-media="x.png" alt="x.png" width="300" data-w="300"></p>\n');
    expect(renderMarkdown('![[Nota|alias]]')).toContain('!<a class="wl"');
  });
});

describe('miniaturas (caché reconstruible)', () => {
  beforeAll(() => {
    let n = 0;
    URL.createObjectURL = () => `blob:t${++n}`;
    URL.revokeObjectURL = () => {};
  });
  afterEach(() => vi.useRealTimers());
  it('original pequeño se muestra tal cual; grande genera miniatura; vaciar y se regenera', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { mediaThumbUrl, releaseThumb, clearThumbs, THUMBS_DIR } = await import('../src/notes/thumbs');
    const { makeThumb } = await import('../src/notes/thumb-core');
    const v = new MemoryBackend();
    await v.write('media/chica.png', png(300, 200));
    const small = await mediaThumbUrl(v, 'media/chica.png');
    expect(small).toMatchObject({ w: 300, h: 200 });
    expect(await v.exists(`${THUMBS_DIR}/chica.png.jpg`)).toBe(false);

    await v.write('media/foto.jpg', jpeg(4032, 3024, 1, 1_200_000));
    const big = await mediaThumbUrl(v, 'media/foto.jpg');
    expect(big).toMatchObject({ w: 1200, h: 900 });
    expect(await v.exists(`${THUMBS_DIR}/foto.jpg.jpg`)).toBe(true);
    expect(makeThumb).toHaveBeenCalledTimes(1);

    // vaciar la caché no toca el original; al volver a verla se regenera
    releaseThumb('media/foto.jpg');
    vi.advanceTimersByTime(30_000);
    await clearThumbs(v);
    expect(await v.exists('media/foto.jpg')).toBe(true);
    expect(await v.exists(`${THUMBS_DIR}/foto.jpg.jpg`)).toBe(false);
    await mediaThumbUrl(v, 'media/foto.jpg');
    expect(await v.exists(`${THUMBS_DIR}/foto.jpg.jpg`)).toBe(true);
    expect(makeThumb).toHaveBeenCalledTimes(2);
  });
  it('la caché no viaja en el respaldo y cuenta como regenerable', () => {
    expect(isExportable('.app/thumbs/foto.jpg.jpg')).toBe(false);
    expect(isExportable('media/foto.jpg')).toBe(true);
    expect(REGENERABLE('.app/thumbs/x.jpg')).toBe(true);
  });
});

describe('exportar .docx con el original', () => {
  it('bytes idénticos, proporción real y lista de convertidas', async () => {
    const photo = jpeg(4032, 3024, 6, 64);
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    const converted: string[] = [];
    const conv = png(10, 10);
    const blob = await markdownToDocx('![[foto.jpg|300|izq]] Texto al lado\n\n![[otra.webp|50%|centro]]', 'P', async (n) => (n === 'foto.jpg' ? photo : webp), {
      convert: async () => ({ data: conv, type: 'png' }), converted,
    });
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const media = Object.entries(files).filter(([k]) => k.startsWith('word/media/')).map(([, b]) => b);
    expect(media.some((b) => b.length === photo.length && b.every((x, i) => x === photo[i]))).toBe(true);
    expect(converted).toEqual(['otra.webp']);
    const xml = new TextDecoder().decode(files['word/document.xml']);
    // 300 px de ancho y alto con la proporción real orientada (3024×4032 → 400): EMU = px × 9525
    expect(xml).toContain(`cx="${300 * 9525}" cy="${400 * 9525}"`);
    expect(xml).toContain('wp:anchor'); // flotante (izq)
    expect(xml).toMatch(/<w:jc w:val="center"\/>/); // centrada
  });
});
