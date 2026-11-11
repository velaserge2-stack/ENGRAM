/** Imágenes de fotos/capturas: redimensionar a máx. 2000 px y guardar en media/. */
import type { VaultAdapter } from '../vault/types';

export async function saveImage(vault: VaultAdapter, file: Blob, name = 'imagen', max = 2000): Promise<string> {
  const safe = name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 40) || 'imagen';
  const id = `${Date.now().toString(36)}-${safe}`;
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (s === 1 && /png|jpe?g|webp|gif/.test(file.type)) {
      const ext = file.type.split('/')[1]!.replace('jpeg', 'jpg');
      await vault.write(`media/${id}.${ext}`, new Uint8Array(await file.arrayBuffer()));
      return `${id}.${ext}`;
    }
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s);
    c.height = Math.round(bmp.height * s);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('codificar'))), 'image/jpeg', 0.88));
    await vault.write(`media/${id}.jpg`, new Uint8Array(await blob.arrayBuffer()));
    return `${id}.jpg`;
  } catch {
    // HEIC u otro formato que el navegador no decodifica: se guarda tal cual
    const ext = (file as File).name?.split('.').pop()?.toLowerCase() || 'bin';
    await vault.write(`media/${id}.${ext}`, new Uint8Array(await file.arrayBuffer()));
    return `${id}.${ext}`;
  }
}
