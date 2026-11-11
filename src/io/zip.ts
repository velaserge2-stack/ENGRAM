/**
 * Exportar / importar la bóveda como .zip (SPEC §5) con `manifest.json`
 * (versión de formato, fecha, conteos) para validar al reimportar.
 */
import { strToU8, unzip, type Unzipped, zip, type Zippable } from 'fflate';
import { normalizePath } from '../vault/paths';
import { JOURNAL_PATH, TMP_DIR } from '../vault/safe';
import type { VaultAdapter } from '../vault/types';
import { decodeText, walk } from '../vault/util';
import { LIMITS, type Limits } from './limits';

export const FORMAT = 'engrama-vault';
export const FORMAT_VERSION = 1;
export const MANIFEST = 'manifest.json';

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
}

/** No se exportan transitorios del diario ni cachés. */
export function isExportable(path: string): boolean {
  return !(path === JOURNAL_PATH || path === TMP_DIR || path.startsWith(TMP_DIR + '/') || path.startsWith('.app/cache/') || path === MANIFEST);
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
            if (count === limits.maxFiles + 1) warnings.push(`Más de ${limits.maxFiles} archivos: se ignoró el resto`);
            return false;
          }
          if (f.originalSize > limits.maxFileBytes) {
            warnings.push(`${f.name}: demasiado grande, omitido`);
            return false;
          }
          if (f.size > 0 && f.originalSize / f.size > limits.maxRatio && f.originalSize > 1024 * 1024) {
            warnings.push(`${f.name}: compresión sospechosa, omitido`);
            return false;
          }
          total += f.originalSize;
          if (total > limits.maxTotalBytes) {
            warnings.push('El zip excede el tamaño total permitido: se ignoró el resto');
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
      warnings.push(`${name}: ruta no permitida, omitido`);
      continue;
    }
    if (!path) continue;
    if (path.split('/').length > limits.maxDepth) {
      warnings.push(`${name}: demasiado profundo, omitido`);
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
        if (m.formatVersion > FORMAT_VERSION) warnings.push(`Formato v${m.formatVersion} es más nuevo que esta app (v${FORMAT_VERSION})`);
      }
    } catch {
      warnings.push('manifest.json ilegible');
    }
    files.splice(mi, 1);
  }
  if (manifest && manifest.counts.files !== files.length) {
    warnings.push(`El manifiesto indica ${manifest.counts.files} archivos y el zip trae ${files.length}`);
  }
  return { manifest, files, warnings };
}
