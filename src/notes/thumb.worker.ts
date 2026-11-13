/// <reference lib="webworker" />
import { makeThumb } from './thumb-core';

// Decodificar y reducir fuera del hilo de la interfaz (si hay OffscreenCanvas en el Worker).
self.onmessage = async (e: MessageEvent<{ id: number; blob: Blob; dims: { w: number; h: number } | null }>) => {
  const { id, blob, dims } = e.data;
  try {
    if (typeof OffscreenCanvas === 'undefined') throw new Error('sin OffscreenCanvas');
    (self as unknown as Worker).postMessage({ id, ok: true, res: await makeThumb(blob, dims) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: String(err) });
  }
};
