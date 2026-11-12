/**
 * Fotos y capturas (Notas-Pro · A1): se guarda el archivo original byte a byte en media/
 * (cualquier formato, incluido HEIC; sin decodificar). Lo que se muestra es una miniatura
 * aparte (`src/notes/thumbs.ts`, caché reconstruible). Con «Calidad: Optimizada» se
 * conserva el comportamiento anterior (máx. 2000 px, JPEG 0.88).
 */
import type { VaultAdapter } from '../vault/types';
import { imageSize } from './imgsize';
import { remember } from './thumbs';

let quality: 'original' | 'optimizada' = 'original';
/** La fija la App desde Ajustes; no afecta a las fotos ya guardadas. */
export const setPhotoQuality = (q: 'original' | 'optimizada') => void (quality = q);

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' };

export async function saveImage(vault: VaultAdapter, file: Blob, name = 'imagen', max = 2000): Promise<string> {
  const safe = name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 40) || 'imagen';
  const id = `${Date.now().toString(36)}-${safe}`;
  const ext = EXT[file.type] ?? (/\.([a-z0-9]{2,5})$/i.exec((file as File).name ?? name)?.[1]?.toLowerCase() || 'bin');
  if (quality === 'optimizada') {
    try {
      const bmp = await createImageBitmap(file);
      const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      if (s < 1 || !/png|jpe?g|webp|gif/.test(file.type)) {
        const c = document.createElement('canvas');
        c.width = Math.round(bmp.width * s);
        c.height = Math.round(bmp.height * s);
        c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close();
        const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('codificar'))), 'image/jpeg', 0.88));
        await vault.write(`media/${id}.jpg`, new Uint8Array(await blob.arrayBuffer()));
        return `${id}.jpg`;
      }
      bmp.close();
    } catch {
      /* no se puede decodificar (HEIC…): se guarda el original */
    }
  }
  const path = `media/${id}.${ext}`;
  // SafeVault.writeStream: por trozos y con diario (nunca `writeBlob` del backend, que se salta el diario)
  const sv = vault as VaultAdapter & { writeStream?: (p: string, b: Blob) => Promise<void> };
  if (sv.writeStream) await sv.writeStream(path, file);
  else await vault.write(path, new Uint8Array(await file.arrayBuffer()));
  // proporción desde el encabezado (sin decodificar): la nota reserva su alto antes de tener miniatura
  const d = imageSize(new Uint8Array(await file.slice(0, 262_144).arrayBuffer()));
  if (d) remember(vault, path, d);
  return `${id}.${ext}`;
}
