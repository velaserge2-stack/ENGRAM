/**
 * Importar (SPEC §5): .md sueltos, carpetas (webkitdirectory) y .zip de bóveda.
 * Siempre en dos pasos: plan con vista previa → aplicar con la decisión del usuario.
 */
import { parseFrontmatter } from '../lib/frontmatter';
import { basename, extname, normalizePath, withSuffix } from '../vault/paths';
import type { VaultAdapter } from '../vault/types';
import { bytesEqual, decodeText } from '../vault/util';
import { LIMITS } from './limits';
import type { ApkgResult } from './apkg';
import type { LogEntry } from '../srs/engine';
import { parseZip, type VaultFile } from './zip';

const VAULT_ROOTS = ['decks/', 'notes/', 'media/', 'templates/', 'exams-bank/', 'exams/', 'docs/', 'calendar/', '.app/'];
const IMAGE_OR_AUDIO = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg', 'mp3', 'm4a', 'wav', 'ogg']);

export type Kind = 'deck' | 'note' | 'media' | 'doc' | 'app' | 'other';

export function kindOf(path: string): Kind {
  if (path.startsWith('decks/')) return 'deck';
  if (path.startsWith('notes/') || path.startsWith('templates/')) return 'note';
  if (path.startsWith('media/')) return 'media';
  if (path.startsWith('.app/')) return 'app';
  if (path.startsWith('docs/')) return 'doc';
  return 'other';
}

/** Ubica un archivo suelto (sin estructura de bóveda) en su carpeta. */
export function placeLoose(relPath: string, data: Uint8Array): string {
  const p = normalizePath(relPath);
  if (VAULT_ROOTS.some((r) => p.startsWith(r))) return p;
  const ext = extname(p);
  if (ext === 'md' || ext === 'markdown') {
    const fm = parseFrontmatter(decodeText(data.subarray(0, 4096)));
    const name = ext === 'markdown' ? p.replace(/\.markdown$/i, '.md') : p;
    return (fm.data.deck ? 'decks/' : 'notes/') + name;
  }
  if (IMAGE_OR_AUDIO.has(ext)) return 'media/' + basename(p);
  return 'docs/' + p;
}

/** File de un <input>; con carpeta, `webkitRelativePath` trae "Carpeta/sub/archivo". */
export interface IncomingFile {
  name: string;
  relativePath?: string;
  bytes: () => Promise<Uint8Array>;
}

export function fromFileList(list: FileList | File[]): IncomingFile[] {
  return [...list].map((f) => ({
    name: f.name,
    relativePath: (f as File & { webkitRelativePath?: string }).webkitRelativePath || undefined,
    bytes: async () => new Uint8Array(await f.arrayBuffer()),
  }));
}

export interface Gathered {
  files: VaultFile[];
  warnings: string[];
  fromVaultZip: boolean;
  /** historial importado (p. ej. revlog de Anki) para combinar con reviews.jsonl */
  log: LogEntry[];
}

export interface GatherOptions {
  apkg?: (bytes: Uint8Array) => Promise<ApkgResult>;
}

export async function gather(incoming: IncomingFile[], opts: GatherOptions = {}): Promise<Gathered> {
  const files: VaultFile[] = [];
  const warnings: string[] = [];
  const log: LogEntry[] = [];
  let fromVaultZip = false;
  // Carpeta elegida: quitar el primer segmento (nombre de la carpeta) si dentro hay estructura de bóveda
  const rels = incoming.map((f) => f.relativePath).filter(Boolean) as string[];
  const stripRoot =
    rels.length > 0 && rels.some((r) => VAULT_ROOTS.some((root) => r.split('/').slice(1).join('/').startsWith(root)));
  for (const f of incoming) {
    const data = await f.bytes();
    if (data.length > LIMITS.maxFileBytes) {
      warnings.push(`${f.name}: demasiado grande, omitido`);
      continue;
    }
    const ext = extname(f.name);
    if (ext === 'apkg' || ext === 'colpkg') {
      if (!opts.apkg) {
        warnings.push(`${f.name}: importar .apkg no está disponible aquí`);
        continue;
      }
      try {
        const r = await opts.apkg(data);
        warnings.push(...r.warnings.map((w) => `${f.name}: ${w}`));
        for (const d of r.decks) files.push({ path: d.path, data: new TextEncoder().encode(d.text) });
        for (const m of r.media) files.push({ path: `media/${m.name}`, data: m.data });
        log.push(...r.log);
      } catch (e) {
        warnings.push(`${f.name}: ${(e as Error).message}`);
      }
      continue;
    }
    const zipMagic = data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
    // .docx/.xlsx/.apkg también son zip: solo se abren como bóveda los .zip (o sin extensión)
    if (ext === 'zip' || (ext === '' && zipMagic)) {
      try {
        const z = await parseZip(data);
        warnings.push(...z.warnings.map((w) => `${f.name}: ${w}`));
        if (z.manifest) fromVaultZip = true;
        const structured = z.manifest || z.files.some((x) => VAULT_ROOTS.some((r) => x.path.startsWith(r)));
        for (const x of z.files) files.push({ path: structured ? x.path : placeLoose(x.path, x.data), data: x.data });
      } catch {
        warnings.push(`${f.name}: zip dañado o no compatible`);
      }
      continue;
    }
    let rel = f.relativePath || f.name;
    if (stripRoot && f.relativePath) rel = f.relativePath.split('/').slice(1).join('/');
    if (/(^|\/)(\.DS_Store|\.obsidian|\.trash)(\/|$)/.test(rel)) continue;
    try {
      files.push({ path: placeLoose(rel, data), data });
    } catch {
      warnings.push(`${rel}: ruta no permitida, omitido`);
    }
  }
  return { files, warnings, fromVaultZip, log };
}

export type ItemStatus = 'new' | 'same' | 'conflict';
export type Resolution = 'omit' | 'replace' | 'duplicate';

export interface PlanItem extends VaultFile {
  kind: Kind;
  status: ItemStatus;
  preview: string;
}

export async function buildPlan(vault: VaultAdapter, files: VaultFile[]): Promise<PlanItem[]> {
  const seen = new Map<string, VaultFile>();
  for (const f of files) seen.set(f.path, f); // si el lote repite ruta, gana el último
  const plan: PlanItem[] = [];
  for (const f of seen.values()) {
    let status: ItemStatus = 'new';
    if (await vault.exists(f.path)) {
      status = bytesEqual(await vault.read(f.path), f.data) ? 'same' : 'conflict';
    }
    const isText = /\.(md|txt|json|jsonl|csv|ics)$/i.test(f.path);
    plan.push({ ...f, kind: kindOf(f.path), status, preview: isText ? decodeText(f.data.subarray(0, 600)) : '' });
  }
  return plan.sort((a, b) => a.path.localeCompare(b.path));
}

export interface ApplyResult {
  written: string[];
  skipped: string[];
  /** Contenido previo de cada ruta escrita (null = no existía), para deshacer. */
  previous: Map<string, Uint8Array | null>;
}

export async function applyPlan(
  vault: VaultAdapter,
  plan: PlanItem[],
  resolve: (item: PlanItem) => Resolution,
): Promise<ApplyResult> {
  const res: ApplyResult = { written: [], skipped: [], previous: new Map() };
  for (const item of plan) {
    if (item.status === 'same') {
      res.skipped.push(item.path);
      continue;
    }
    let target = item.path;
    if (item.status === 'conflict') {
      const r = resolve(item);
      if (r === 'omit') {
        res.skipped.push(item.path);
        continue;
      }
      if (r === 'duplicate') {
        let n = 2;
        while (await vault.exists(withSuffix(item.path, n))) n++;
        target = withSuffix(item.path, n);
      }
    }
    res.previous.set(target, (await vault.exists(target)) ? await vault.read(target) : null);
    await vault.write(target, item.data);
    res.written.push(target);
  }
  return res;
}

/** Deshace toda una importación: borra lo nuevo y restaura lo reemplazado. */
export async function undoImport(vault: VaultAdapter, res: ApplyResult): Promise<void> {
  for (const [path, prev] of res.previous) {
    if (prev === null) await vault.remove(path);
    else await vault.write(path, prev);
  }
}

/** Combina un historial importado con reviews.jsonl sin duplicar (id + ts). */
export async function mergeLog(vault: VaultAdapter, entries: LogEntry[]): Promise<number> {
  if (!entries.length) return 0;
  const path = '.app/reviews.jsonl';
  const prev = (await vault.exists(path)) ? decodeText(await vault.read(path)) : '';
  const seen = new Set<string>();
  for (const l of prev.split('\n')) {
    try {
      const e = JSON.parse(l) as LogEntry;
      seen.add(`${e.id}@${e.ts}`);
    } catch {
      /* línea vacía */
    }
  }
  const add = entries.filter((e) => !seen.has(`${e.id}@${e.ts}`));
  if (add.length) await vault.write(path, (prev && !prev.endsWith('\n') ? prev + '\n' : prev) + add.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return add.length;
}

export function runApkgWorker(bytes: Uint8Array, history = true): Promise<ApkgResult> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./apkg.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ ok: boolean; result?: ApkgResult; error?: string }>) => {
      w.terminate();
      if (e.data.ok) resolve(e.data.result!);
      else reject(new Error(e.data.error));
    };
    w.onerror = (e) => (w.terminate(), reject(new Error(e.message || 'Error del Worker')));
    w.postMessage({ bytes, history });
  });
}
