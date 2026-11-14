// Red de seguridad de `parseZip` (límites, rutas, bombas). Se escribió para comparar contra el `Unzip` por entradas
// (descartado: docs/rendimiento/03a-lotes.md, «Tras la fase 3»); la copia `legacyParse` es la referencia para cualquier
// cambio futuro. Incluye 4 000 entradas (`Unzip.push` desbordaba la pila con el zip entero) y cabeceras que mienten.
import { strToU8, unzip, type Unzipped, Zip, ZipDeflate, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { LIMITS, type Limits } from '../src/io/limits';
import { isExportable, parseZip, type ParsedZip, type VaultFile } from '../src/io/zip';
import { t } from '../src/i18n';
import { normalizePath } from '../src/vault/paths';
import { decodeText } from '../src/vault/util';

/** Copia literal de `parseZip` antes del cambio (referencia). */
async function legacyParse(bytes: Uint8Array, limits: Limits = LIMITS): Promise<ParsedZip> {
  const warnings: string[] = [];
  let count = 0;
  let total = 0;
  const unzipped = await new Promise<Unzipped>((resolve, reject) =>
    unzip(
      bytes,
      {
        filter: (f) => {
          if (f.name.endsWith('/')) return false;
          if (/(^|\/)(__MACOSX|\.DS_Store|\.obsidian|\.trash)(\/|$)/.test(f.name)) return false;
          count++;
          if (count > limits.maxFiles) {
            if (count === limits.maxFiles + 1) warnings.push(t('zip.mas_de_maxfiles_archivos_se_ignoro', { maxFiles: limits.maxFiles }));
            return false;
          }
          if (f.originalSize > limits.maxFileBytes) {
            warnings.push(t('import.name_demasiado_grande_omitido', { name: f.name }));
            return false;
          }
          if (f.size > 0 && f.originalSize / f.size > limits.maxRatio && f.originalSize > 1024 * 1024) {
            warnings.push(t('zip.name_compresion_sospechosa_omitido', { name: f.name }));
            return false;
          }
          total += f.originalSize;
          if (total > limits.maxTotalBytes) {
            warnings.push(t('zip.el_zip_excede_el_tamano_total'));
            return false;
          }
          return true;
        },
      },
      (err, data) => (err ? reject(err) : resolve(data)),
    ),
  );
  let manifest: ParsedZip['manifest'] = null;
  const files: VaultFile[] = [];
  for (const [name, data] of Object.entries(unzipped)) {
    let path: string;
    try {
      path = normalizePath(name);
    } catch {
      warnings.push(t('zip.name_ruta_no_permitida_omitido', { name: name }));
      continue;
    }
    if (!path) continue;
    if (path.split('/').length > limits.maxDepth) {
      warnings.push(t('zip.name_demasiado_profundo_omitido', { name: name }));
      continue;
    }
    files.push({ path, data });
  }
  const tops = new Set(files.map((f) => f.path.split('/')[0]));
  if (tops.size === 1 && files.every((f) => f.path.includes('/'))) {
    const top = [...tops][0]!;
    if (!['decks', 'notes', 'media', 'templates', 'exams-bank', 'exams', 'docs', 'calendar', '.app'].includes(top)) for (const f of files) f.path = f.path.slice(top.length + 1);
  }
  const mi = files.findIndex((f) => f.path === 'manifest.json');
  if (mi >= 0) {
    try {
      const m = JSON.parse(decodeText(files[mi]!.data));
      if (m.format === 'engrama-vault') {
        manifest = m;
        if (m.formatVersion > 1) warnings.push(t('zip.formato_vformatversion_es_mas_nuevo_que', { formatVersion: m.formatVersion, FORMAT_VERSION: 1 }));
      }
    } catch {
      warnings.push(t('zip.manifest_json_ilegible'));
    }
    files.splice(mi, 1);
  }
  for (let i = files.length - 1; i >= 0; i--) if (!isExportable(files[i]!.path)) files.splice(i, 1);
  if (manifest && manifest.counts.files !== files.length) warnings.push(t('zip.el_manifiesto_indica_files_archivos_y', { files: manifest.counts.files, n: files.length }));
  return { manifest, files, warnings };
}

const enc = (o: Record<string, string | Uint8Array>) => zipSync(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v])));
const view = (z: ParsedZip) => ({ manifest: z.manifest, warnings: z.warnings, files: z.files.map((f) => [f.path, f.data.length, f.data.reduce((h, b) => (Math.imul(h, 31) + b) | 0, 7)]).sort((a, b) => (a[0]! < b[0]! ? -1 : 1)) }); // el orden de salida de `unzip` depende de los Workers
const same = async (zip: Uint8Array, limits?: Limits) => {
  const [a, b] = [await legacyParse(zip, limits), await parseZip(zip, limits)];
  expect(view(b)).toEqual(view(a));
  return b;
};
const L = (o: Partial<Limits>): Limits => ({ ...LIMITS, ...o });
const noise = (n: number) => new Uint8Array(n).map((_, i) => (i * 2654435761) >>> 13);

describe('parseZip por entradas == implementación anterior', () => {
  it('zip normal (texto, vacío, binario) y manifiesto', async () => {
    const m = { format: 'engrama-vault', formatVersion: 1, app: 'x', createdAt: 'x', counts: { files: 3 } };
    const r = await same(enc({ 'decks/a.md': 'Q:: x\nA:: y', 'notes/vacio.md': '', 'media/f.bin': noise(5000), 'manifest.json': JSON.stringify(m) }));
    expect(r.files).toHaveLength(3);
    expect(r.manifest).not.toBeNull();
  });
  it('manifiesto con otro conteo, ilegible y de formato más nuevo', async () => {
    await same(enc({ 'decks/a.md': 'x', 'manifest.json': JSON.stringify({ format: 'engrama-vault', formatVersion: 9, counts: { files: 5 } }) }));
    await same(enc({ 'decks/a.md': 'x', 'manifest.json': '{no json' }));
  });
  it('carpeta envolvente (y que no se quite si es una raíz conocida)', async () => {
    const r = await same(enc({ 'MiBoveda/decks/a.md': 'x', 'MiBoveda/notes/b.md': 'y' }));
    expect(r.files.map((f) => f.path).sort()).toEqual(['decks/a.md', 'notes/b.md']);
    await same(enc({ 'decks/a.md': 'x', 'decks/b.md': 'y' }));
  });
  it('rutas con "..", absolutas, con barra invertida, con \\0, demasiado profundas', async () => {
    const deep = Array.from({ length: 14 }, (_, i) => 'd' + i).join('/') + '/x.md';
    const r = await same(enc({ 'notes/../../escape.md': 'x', 'C:/Windows/x.md': 'x', '/abs/x.md': 'x', 'notes\\win.md': 'x', 'notes/nul\0.md': 'x', [deep]: 'x', 'notes/ok.md': 'ok' }));
    expect(r.files.some((f) => f.path.includes('..'))).toBe(false);
    expect(r.warnings.length).toBeGreaterThanOrEqual(3);
  });
  it('basura de sistema (__MACOSX, .DS_Store, .obsidian) y carpetas', async () => {
    await same(enc({ '__MACOSX/a': 'x', 'notes/.DS_Store': 'x', '.obsidian/app.json': '{}', 'notes/': new Uint8Array(0), 'notes/a.md': 'a', '.app/journal.json': 'x', '.app/tmp/y': 'x' }));
  });
  it('archivo que supera el tamaño, y total excedido', async () => {
    const z = enc({ 'media/grande.bin': noise(3000), 'notes/a.md': 'hola', 'notes/b.md': 'hola' });
    expect((await same(z, L({ maxFileBytes: 1000 }))).warnings.length).toBe(1);
    const r = await same(z, L({ maxTotalBytes: 3005 }));
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it('razón de compresión sospechosa (bomba) y más archivos que el límite', async () => {
    const bomb = new Uint8Array(4 * 1024 * 1024);
    const r = await same(enc({ 'media/ceros.bin': bomb, 'notes/a.md': 'a' }));
    expect(r.files.map((f) => f.path)).toEqual(['notes/a.md']);
    const many = enc(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`notes/n${i}.md`, 'x' + i])));
    const m = await same(many, L({ maxFiles: 5 }));
    expect(m.files).toHaveLength(5);
  });
  it('profundidad con límite pequeño y nombres duplicados', async () => {
    await same(enc({ 'a/b/c/d.md': 'x', 'a/e.md': 'y' }), L({ maxDepth: 2 }));
  });
  it('entradas en flujo (descriptor de datos, como el respaldo de la app) y varias de más de 512 KB', async () => {
    const parts: Uint8Array[] = [];
    const z = new Zip((e, c) => parts.push(c));
    for (const [name, data] of [['notes/a.md', strToU8('hola '.repeat(100))], ['media/big1.bin', noise(700_000)], ['media/big2.bin', noise(900_000)], ['notes/vacio.md', new Uint8Array(0)]] as const) {
      const f = new ZipDeflate(name, { level: 6 });
      z.add(f);
      f.push(data, true);
    }
    z.end();
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    parts.reduce((at, p) => (all.set(p, at), at + p.length), 0);
    const r = await same(all);
    expect(r.files).toHaveLength(4);
  });
  it('miles de entradas pequeñas (sin desbordar la pila) y entradas de más de un trozo', async () => {
    const many = enc({ ...Object.fromEntries(Array.from({ length: 4000 }, (_, i) => [`notes/n${i}.md`, 'x' + i])), 'media/b.bin': noise(300_000) });
    expect((await same(many)).files).toHaveLength(4001);
  });
  it('un zip corrupto falla igual que antes', async () => {
    const bad = enc({ 'notes/a.md': 'x' }).slice(0, 20);
    await expect(legacyParse(bad)).rejects.toBeDefined();
    await expect(parseZip(bad)).rejects.toBeDefined();
  });
});

describe('parseZip no se fía de la cabecera', () => {
  it('una entrada que declara menos de lo que descomprime se corta a lo declarado (ni se devuelve de más)', async () => {
    const z = enc({ 'notes/a.md': 'a'.repeat(5000) });
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
    // tamaño original declarado = 10 (local en 22, central tras la firma 0x02014b50 en +24)
    dv.setUint32(22, 10, true);
    for (let i = 0; i < z.length - 4; i++) if (dv.getUint32(i, true) === 0x02014b50) dv.setUint32(i + 24, 10, true);
    const out = await parseZip(z);
    expect(out.files[0]!.data.length).toBe(10);
  });
});
