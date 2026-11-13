import { t } from '../i18n';
/**
 * Exportar / importar la bóveda como .zip (SPEC §5) con `manifest.json`
 * (versión de formato, fecha, conteos) para validar al reimportar.
 */
import { AsyncZipDeflate, strToU8, unzip, type Unzipped, zip, Zip, ZipDeflate, ZipPassThrough, type Zippable } from 'fflate';
import { normalizePath } from '../vault/paths';
import { JOURNAL_PATH, TMP_DIR } from '../vault/safe';
import type { VaultAdapter } from '../vault/types';
import { decodeText, walk } from '../vault/util';
import { LIMITS, type Limits } from './limits';

const FORMAT = 'engrama-vault';
export const FORMAT_VERSION = 1;
const MANIFEST = 'manifest.json';

export interface Manifest {
  format: typeof FORMAT;
  formatVersion: number;
  app: string;
  createdAt: string;
  counts: { files: number; decks: number; notes: number; media: number; bytes: number };
}

export interface VaultFile {
  path: string;
  data: Uint8Array;
  /** Prompt 11: archivo grande que se escribe por trozos desde el File (sin leerlo antes); `data` va vacío. */
  blob?: Blob;
}

/** No se exportan transitorios del diario ni cachés. */
export function isExportable(path: string): boolean {
  return !(path === JOURNAL_PATH || path === TMP_DIR || path.startsWith(TMP_DIR + '/') || path.startsWith('.app/cache/') || path.startsWith('.app/thumbs/') || path === MANIFEST);
}

export function countFiles(paths: { path: string; size?: number }[]): Manifest['counts'] {
  const c = { files: 0, decks: 0, notes: 0, media: 0, bytes: 0 };
  for (const f of paths) {
    c.files++;
    c.bytes += f.size ?? 0;
    if (f.path.startsWith('decks/') && f.path.endsWith('.md')) c.decks++;
    else if (f.path.startsWith('notes/') && f.path.endsWith('.md')) c.notes++;
    else if (f.path.startsWith('media/')) c.media++;
  }
  return c;
}

export async function collectVault(vault: VaultAdapter, root = ''): Promise<VaultFile[]> {
  const stats = await walk(vault, root, (p) => !isExportable(p));
  const out: VaultFile[] = [];
  for (const s of stats) out.push({ path: s.path, data: await vault.read(s.path) });
  return out;
}

const ALREADY_COMPRESSED = /\.(png|jpe?g|gif|webp|heic|mp3|m4a|wav|mp4|mov|pdf|zip|docx|xlsx)$/i;

export function buildZip(files: VaultFile[], appVersion: string, now = new Date()): Promise<Uint8Array> {
  const manifest: Manifest = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    app: appVersion,
    createdAt: now.toISOString(),
    counts: countFiles(files.map((f) => ({ path: f.path, size: f.data.length }))),
  };
  const z: Zippable = { [MANIFEST]: [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }] };
  for (const f of files) z[f.path] = [f.data, { level: ALREADY_COMPRESSED.test(f.path) ? 0 : 6 }];
  return new Promise((resolve, reject) => zip(z, (err, data) => (err ? reject(err) : resolve(data))));
}

/**
 * Respaldo por partes (Prompt 21 · 3b, cuello #5): lee un archivo, lo pasa al zip y lo suelta. Lo grande
 * se comprime en un Worker de fflate (`AsyncZipDeflate`, uno por archivo) mientras se lee lo siguiente;
 * lo pequeño, aquí mismo (un Worker por nota costaría más que comprimirla); lo ya comprimido va tal cual. Las piezas de salida forman un Blob: nunca están a la vez todos los archivos leídos y el zip
 * entero. Mismo contenido que `collectVault` + `buildZip` (manifiesto primero, mismas exclusiones).
 */
export async function zipVault(vault: VaultAdapter, appVersion: string, now = new Date(), onProgress?: (done: number, total: number) => void): Promise<{ blob: Blob; counts: Manifest['counts'] }> {
  const stats = await walk(vault, '', (p) => !isExportable(p));
  const counts = countFiles(stats);
  const manifest: Manifest = { format: FORMAT, formatVersion: FORMAT_VERSION, app: appVersion, createdAt: now.toISOString(), counts };
  const parts: Uint8Array[] = [];
  let fail: Error | null = null;
  let finish!: () => void;
  const ended = new Promise<void>((res) => (finish = res));
  const z = new Zip((err, chunk, final) => {
    if (err) fail ??= err;
    else parts.push(chunk);
    if (err || final) finish();
  });
  const add = (path: string, data: Uint8Array, store: boolean) => {
    const f = store ? new ZipPassThrough(path) : data.length > 256 * 1024 ? new AsyncZipDeflate(path, { level: 6 }) : new ZipDeflate(path, { level: 6 });
    z.add(f);
    f.push(data, true);
  };
  add(MANIFEST, strToU8(JSON.stringify(manifest, null, 2)), false);
  for (let i = 0; i < stats.length; i++) {
    if (fail) break;
    const s = stats[i]!;
    add(s.path, await vault.read(s.path), ALREADY_COMPRESSED.test(s.path));
    onProgress?.(i + 1, stats.length);
  }
  z.end();
  await ended;
  if (fail) throw fail;
  return { blob: new Blob(parts as BlobPart[], { type: 'application/zip' }), counts };
}

export interface ParsedZip {
  manifest: Manifest | null;
  files: VaultFile[];
  warnings: string[];
}

const KNOWN_ROOTS = new Set(['decks', 'notes', 'media', 'templates', 'exams-bank', 'exams', 'docs', 'calendar', '.app']);

/** Descomprime con límites; sanea rutas; quita una carpeta raíz envolvente (zip de Obsidian, etc.). */
export async function parseZip(bytes: Uint8Array, limits: Limits = LIMITS): Promise<ParsedZip> {
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

  let manifest: Manifest | null = null;
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

  // Carpeta envolvente única ("MiBoveda/decks/...") → quitarla
  const tops = new Set(files.map((f) => f.path.split('/')[0]));
  if (tops.size === 1 && files.every((f) => f.path.includes('/'))) {
    const top = [...tops][0]!;
    if (!KNOWN_ROOTS.has(top)) for (const f of files) f.path = f.path.slice(top.length + 1);
  }

  const mi = files.findIndex((f) => f.path === MANIFEST);
  if (mi >= 0) {
    try {
      const m = JSON.parse(decodeText(files[mi]!.data)) as Manifest;
      if (m.format === FORMAT) {
        manifest = m;
        if (m.formatVersion > FORMAT_VERSION) warnings.push(t('zip.formato_vformatversion_es_mas_nuevo_que', { formatVersion: m.formatVersion, FORMAT_VERSION: FORMAT_VERSION }));
      }
    } catch {
      warnings.push(t('zip.manifest_json_ilegible'));
    }
    files.splice(mi, 1);
  }
  // diario, temporales y cachés nunca se importan (el arranque de SafeVault los ejecutaría)
  for (let i = files.length - 1; i >= 0; i--) if (!isExportable(files[i]!.path)) files.splice(i, 1);
  if (manifest && manifest.counts.files !== files.length) {
    warnings.push(t('zip.el_manifiesto_indica_files_archivos_y', { files: manifest.counts.files, n: files.length }));
  }
  return { manifest, files, warnings };
}
