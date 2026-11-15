/**
 * Un medio de un .apkg como Blob, producido al pedirlo (de uno en uno, al aplicar el plan):
 * sin comprimir → `slice` del archivo (no se copia nada); deflate → `Inflate` por trozos; zstd (formato nuevo)
 * → por trozos desde `apkg.ts` (carga perezosa: fzstd no entra en el paquete inicial). Todo con tope de salida.
 */
import { Inflate } from 'fflate';
import { t } from '../i18n';
import { LIMITS } from './limits';
import { dataStart, type ZipRef } from './zipindex';

const STEP = 1 << 20;
const bad = (name: string) => Object.assign(new Error(t('apkg.medio_ilegible', { name })), { code: 'corrupt' });
const big = (mb: number) => Object.assign(new Error(t('apkg.descomprimido_demasiado_grande', { mb })), { code: 'too-big' });

export async function mediaBlob(file: Blob, ref: ZipRef, name: string, max = LIMITS.maxApkgEntryBytes): Promise<Blob> {
  let at: number;
  try { at = await dataStart(file, ref); } catch { throw bad(name); }
  const raw = file.slice(at, at + ref.csize);
  const mb = Math.round(max / 1048576);
  if (ref.method === 0) {
    const head = new Uint8Array(await raw.slice(0, 4).arrayBuffer());
    if (head[0] === 0x28 && head[1] === 0xb5 && head[2] === 0x2f && head[3] === 0xfd) {
      try { return await (await import('./apkg')).unzstdToBlob(raw, max); } catch (e) { throw (e as { code?: string }).code === 'too-big' ? big(mb) : bad(name); }
    }
    if (ref.csize > max) throw big(mb);
    return raw;
  }
  if (ref.method !== 8) throw bad(name);
  const parts: Uint8Array[] = [];
  let total = 0, over = false;
  const inf = new Inflate((c) => { total += c.length; if (total > max) over = true; else parts.push(c); });
  try {
    for (let i = 0; i < raw.size && !over; i += STEP) inf.push(new Uint8Array(await raw.slice(i, i + STEP).arrayBuffer()), i + STEP >= raw.size);
    if (!raw.size) inf.push(new Uint8Array(0), true);
  } catch { throw bad(name); }
  if (over) throw big(mb);
  return new Blob(parts as BlobPart[]);
}

/** Tamaño exacto del medio sin producirlo (deflate lo trae el directorio; sin comprimir salvo zstd, cuyo tamaño solo se sabe al descomprimir). */
export async function exactSize(file: Blob, ref: ZipRef): Promise<number | null> {
  if (ref.method === 8) return ref.usize;
  if (ref.method !== 0) return null;
  try {
    const at = await dataStart(file, ref);
    const h = new Uint8Array(await file.slice(at, at + 4).arrayBuffer());
    return h[0] === 0x28 && h[1] === 0xb5 && h[2] === 0x2f && h[3] === 0xfd ? null : ref.csize;
  } catch { return null; }
}
