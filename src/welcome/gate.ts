import { isStandalone } from '../lib/storage';

/** La presentación solo es para quien llega nuevo desde el navegador: no instalada, sin `?app` ni `?demo`. */
export function showLanding(): boolean {
  try {
    if (isStandalone()) return false;
    return !/[?&](app|demo)(=|&|$)/.test(location.search);
  } catch {
    return false;
  }
}
