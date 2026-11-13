/**
 * Entregar un archivo al usuario (SPEC §5). En iPad: hoja de compartir →
 * "Guardar en Archivos". `navigator.share` exige activación transitoria, así
 * que esta función debe llamarse DIRECTAMENTE desde el manejador del toque,
 * con el File ya construido (por eso la UI prepara primero y entrega después).
 */
export type DeliverResult = 'shared' | 'downloaded' | 'cancelled';

function canShareFile(file: File): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export function download(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function deliver(file: File): Promise<DeliverResult> {
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
      // NotAllowedError (se perdió el gesto) u otro: caer a descarga
    }
  }
  download(file);
  return 'downloaded';
}

export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
