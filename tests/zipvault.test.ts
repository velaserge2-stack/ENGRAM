// Prompt 21 · 3b (cuello #5): el respaldo por partes contiene lo mismo que collectVault + buildZip.
import { describe, expect, it } from 'vitest';
import { buildZip, collectVault, parseZip, zipVault } from '../src/io/zip';
import { MemoryBackend } from '../src/vault/memory';
import { SafeVault } from '../src/vault/safe';

describe('zipVault (respaldo por partes)', () => {
  it('mismos archivos y bytes que el respaldo de antes; sin cachés ni temporales; conteos iguales', async () => {
    const v = new SafeVault(new MemoryBackend());
    const big = new Uint8Array(400 * 1024).map((_, i) => (i * 7) % 251); // va por el Worker de fflate
    await v.write('decks/Cardio.md', '# Cardio\nQ:: a\nA:: b\n');
    await v.write('notes/Cardio/ECG/Ondas.md', 'texto '.repeat(500));
    await v.write('notes/Árbol y más/Ñandú.md', 'acentos');
    await v.write('media/foto.jpg', new Uint8Array([255, 216, 255, 1, 2, 3]));
    await v.write('media/grande.bin', big);
    await v.write('.app/reviews.jsonl', '{"id":"x"}\n');
    await v.write('.app/thumbs/x.webp', 'cache');
    await v.write('.app/cache/img/y', 'cache');
    const before = await parseZip(await buildZip(await collectVault(v), 'v', new Date(0)));
    const { blob, counts } = await zipVault(v, 'v', new Date(0));
    const after = await parseZip(new Uint8Array(await blob.arrayBuffer()));
    const map = (z: typeof before) => Object.fromEntries(z.files.map((f) => [f.path, [...f.data].join(',')]));
    expect(map(after)).toEqual(map(before));
    expect(after.manifest).toEqual(before.manifest);
    expect(counts).toEqual(before.manifest!.counts);
    expect(after.files.some((f) => f.path.startsWith('.app/thumbs') || f.path.startsWith('.app/cache'))).toBe(false);
  });
});
