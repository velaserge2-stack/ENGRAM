import { beforeEach, describe, expect, it } from 'vitest';
import { fetchNovedades, markSeen, parseNovedades } from '../src/lib/novedades';
import real from '../public/novedades.json';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
});
const J = { id: 'v1', es: { mejoro: ['a'], nuevo: ['b'] }, en: { mejoro: ['x'], nuevo: [] } };
const ok = (j: unknown) => (async () => new Response(JSON.stringify(j), { status: 200 })) as typeof fetch;

describe('novedades de la barra de actualización', () => {
  it('elige el idioma y cae a español', () => {
    expect(parseNovedades(J, 'en')).toEqual({ id: 'v1', mejoro: ['x'], nuevo: [] });
    expect(parseNovedades(J, 'fr')).toEqual({ id: 'v1', mejoro: ['a'], nuevo: ['b'] });
  });
  it('solo texto plano, recortado y acotado; basura → null', () => {
    const n = parseNovedades({ id: 'v', es: { mejoro: ['<img src=x onerror=1>', 5, null, 'z'.repeat(500), 'b', 'c', 'd'], nuevo: [] } }, 'es')!;
    expect(n.mejoro).toHaveLength(3);
    expect(n.mejoro[1]).toHaveLength(90);
    expect(parseNovedades({ id: '', es: { mejoro: ['a'] } }, 'es')).toBeNull();
    expect(parseNovedades({ id: 'v', es: { mejoro: [], nuevo: [] } }, 'es')).toBeNull();
    expect(parseNovedades(null, 'es')).toBeNull();
    expect(parseNovedades('x', 'es')).toBeNull();
  });
  it('no repite las novedades ya vistas y tolera fallos de red', async () => {
    expect((await fetchNovedades('es', ok(J)))?.id).toBe('v1');
    markSeen('v1');
    expect(await fetchNovedades('es', ok(J))).toBeNull();
    expect(await fetchNovedades('es', (async () => { throw new Error('offline'); }) as typeof fetch)).toBeNull();
    expect(await fetchNovedades('es', (async () => new Response('x', { status: 404 })) as typeof fetch)).toBeNull();
    expect(await fetchNovedades('es', (async () => new Response('no json', { status: 200 })) as typeof fetch)).toBeNull();
  });
  it('el archivo publicado es válido en los tres idiomas', () => {
    for (const l of ['es', 'en', 'fr']) {
      const n = parseNovedades(real, l)!;
      expect(n, l).toBeTruthy();
      expect(n.mejoro.length && n.nuevo.length, l).toBeTruthy();
    }
  });
});
