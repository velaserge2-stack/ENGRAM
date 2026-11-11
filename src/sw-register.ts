/**
 * Registro del service worker y aviso "Nueva versión disponible → Actualizar".
 * El SW nuevo espera hasta que el usuario acepta (SKIP_WAITING), así nunca se
 * cambia el código a mitad de un repaso.
 */
type Apply = () => void;
let notify: ((apply: Apply) => void) | null = null;
let pendingApply: Apply | null = null;

export function onUpdateReady(fn: (apply: Apply) => void): void {
  notify = fn;
  if (pendingApply) fn(pendingApply);
}

function ready(worker: ServiceWorker) {
  const apply = () => worker.postMessage({ type: 'SKIP_WAITING' });
  pendingApply = apply;
  notify?.(apply);
}

export function registerSW(): void {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  let reloading = false;
  // En la primera instalación clients.claim() también dispara controllerchange: no recargar
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker
    .register(new URL('sw.js', document.baseURI), { scope: './' })
    .then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) ready(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) ready(w);
        });
      });
      // Buscar actualizaciones al volver a la app (no hay Background Sync en Safari)
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update().catch(() => {}));
    })
    .catch((e) => console.warn('SW no registrado', e));
}
