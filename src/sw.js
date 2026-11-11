/* Service worker de Engrama. Plantilla: el build sustituye VERSION y ASSETS.
 * Cache-first para el app shell versionado (los nombres llevan hash, nunca cambian).
 * La "actualización en segundo plano" es el propio SW: al volver a la app se llama
 * reg.update(); si hay versión nueva se precachea y la UI ofrece "Actualizar".
 * Lo no listado de la misma origen se cachea al primer uso. Sin dependencias remotas. */
const VERSION = '__VERSION__';
const ASSETS = __ASSETS__;
const CACHE = `engrama-${VERSION}`;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('engrama-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // La app es de una sola página con ruteo por hash: siempre el index cacheado
    e.respondWith(caches.match('./', { cacheName: CACHE }).then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req);
      const net = fetch(req)
        .then((res) => {
          if (res.ok && !hit) cache.put(req, res.clone());
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
});
