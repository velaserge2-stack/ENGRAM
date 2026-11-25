// Modo demo: cierra el paso a todo almacenamiento persistente y a la red. Se instala antes de abrir nada.
// `window.__demoGuard` cuenta los accesos (las pruebas exigen que sean 0 hacia lo persistente real).
type G = { storage: string[]; idb: number; caches: number; sw: number; net: number };

function memStorage(g: G): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => { g.storage.push(k); return m.get(k) ?? null; },
    setItem: (k: string, v: string) => { g.storage.push(k); m.set(k, String(v)); },
    removeItem: (k: string) => { g.storage.push(k); m.delete(k); },
    clear: () => m.clear(),
  } as Storage;
}

export function installGuard(): void {
  const g: G = { storage: [], idb: 0, caches: 0, sw: 0, net: 0 };
  (window as unknown as { __demoGuard: G }).__demoGuard = g;
  const def = (o: object, k: string, get: () => unknown) => { try { Object.defineProperty(o, k, { get, configurable: true }); } catch { /* ya inerte */ } };
  const ls = memStorage(g), ss = memStorage(g);
  def(window, 'localStorage', () => ls);
  def(window, 'sessionStorage', () => ss);
  def(window, 'indexedDB', () => { g.idb++; return undefined; });
  def(window, 'caches', () => { g.caches++; return undefined; });
  def(navigator, 'storage', () => { g.caches++; return undefined; });
  def(navigator, 'locks', () => undefined); // el origen opaco la niega con SecurityError; sin ella la app sigue (detección de función)
  def(navigator, 'serviceWorker', () => { g.sw++; return undefined; });
  const deny = () => { g.net++; throw new TypeError('demo: sin red'); };
  window.fetch = () => { g.net++; return Promise.reject(new TypeError('demo: sin red')); };
  XMLHttpRequest.prototype.open = deny as never;
  navigator.sendBeacon = () => { g.net++; return false; };
  for (const k of ['WebSocket', 'EventSource']) def(window, k, () => deny);
  // segunda barrera: aunque algo se escapara, el navegador bloquea toda conexión desde este documento
  const m = document.createElement('meta');
  m.httpEquiv = 'Content-Security-Policy';
  m.content = "connect-src 'none'";
  document.head.append(m);
}
